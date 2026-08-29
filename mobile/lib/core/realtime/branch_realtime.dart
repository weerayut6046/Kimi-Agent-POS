import 'dart:async';
import 'dart:collection';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _topicPrefix = 'pos-invalidation-v1';
const _invalidationEvent = 'invalidate';
const _eventVersion = 1;
const _maximumRememberedEventIds = 256;

@immutable
class BranchInvalidationEvent {
  const BranchInvalidationEvent({
    required this.eventId,
    required this.branchId,
  });

  final String eventId;
  final int branchId;

  static BranchInvalidationEvent? fromBroadcast(Map<String, dynamic> message) {
    final rawPayload = message['payload'];
    if (rawPayload is! Map) return null;
    final payload = Map<String, dynamic>.from(rawPayload);
    const expectedKeys = {'version', 'eventId', 'scope', 'branchId'};
    if (payload.length != expectedKeys.length ||
        !payload.keys.every(expectedKeys.contains)) {
      return null;
    }

    final eventId = payload['eventId'];
    final branchId = payload['branchId'];
    if (payload['version'] != _eventVersion ||
        payload['scope'] != 'branch' ||
        eventId is! String ||
        eventId.length < 16 ||
        eventId.length > 128 ||
        branchId is! int ||
        branchId <= 0) {
      return null;
    }
    return BranchInvalidationEvent(eventId: eventId, branchId: branchId);
  }
}

class BranchInvalidationTracker {
  BranchInvalidationTracker({
    this.maximumRemembered = _maximumRememberedEventIds,
  });

  final int maximumRemembered;
  final LinkedHashSet<String> _seen = LinkedHashSet<String>();

  bool shouldRefresh(BranchInvalidationEvent event, int branchId) {
    if (event.branchId != branchId || _seen.contains(event.eventId)) {
      return false;
    }
    _seen.add(event.eventId);
    while (_seen.length > maximumRemembered) {
      _seen.remove(_seen.first);
    }
    return true;
  }
}

final branchRealtimeRevisionProvider = NotifierProvider.autoDispose
    .family<BranchRealtimeRevision, int, int>(BranchRealtimeRevision.new);

/// Maintains one private Realtime channel per active branch.
///
/// Business rows are never sent through Realtime. The server broadcasts only
/// an opaque invalidation event; screens then fetch fresh, authorized data
/// through the normal API.
class BranchRealtimeRevision extends Notifier<int> {
  BranchRealtimeRevision(this.branchId);

  final int branchId;
  final BranchInvalidationTracker _tracker = BranchInvalidationTracker();
  SupabaseClient? _client;
  RealtimeChannel? _channel;
  bool _disposed = false;

  @override
  int build() {
    ref.onDispose(() {
      _disposed = true;
      final channel = _channel;
      final client = _client;
      _channel = null;
      if (channel != null && client != null) {
        unawaited(client.removeChannel(channel));
      }
    });
    scheduleMicrotask(_connect);
    return 0;
  }

  Future<void> _connect() async {
    try {
      final client = Supabase.instance.client;
      final session = client.auth.currentSession;
      if (_disposed || session == null) return;

      _client = client;
      await client.realtime.setAuth(session.accessToken);
      if (_disposed) return;

      final channel = client
          .channel(
            '$_topicPrefix:$branchId',
            opts: const RealtimeChannelConfig(private: true),
          )
          .onBroadcast(event: _invalidationEvent, callback: _handleBroadcast);
      _channel = channel;
      channel.subscribe((status, error) {
        if (_disposed || _channel != channel) return;
        if (status == RealtimeSubscribeStatus.subscribed) {
          // Close the fetch-before-subscribe race and refresh after reconnects.
          state++;
        }
      });
    } catch (error) {
      // Realtime must remain an enhancement: normal API reads and manual
      // refresh continue to work if a device temporarily cannot subscribe.
      if (error is AssertionError &&
          error.toString().contains('initialize the supabase instance')) {
        return;
      }
      assert(() {
        debugPrint('PumpPOS Realtime connection failed: $error');
        return true;
      }());
    }
  }

  void _handleBroadcast(Map<String, dynamic> message) {
    if (_disposed) return;
    final event = BranchInvalidationEvent.fromBroadcast(message);
    if (event == null || !_tracker.shouldRefresh(event, branchId)) return;
    state++;
  }
}
