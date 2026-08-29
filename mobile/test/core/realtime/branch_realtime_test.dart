import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/core/realtime/branch_realtime.dart';

void main() {
  const eventId = '12345678-1234-1234-1234-123456789abc';

  test('parses the server broadcast envelope', () {
    final event = BranchInvalidationEvent.fromBroadcast({
      'event': 'invalidate',
      'type': 'broadcast',
      'payload': {
        'version': 1,
        'eventId': eventId,
        'scope': 'branch',
        'branchId': 3,
      },
    });

    expect(event?.eventId, eventId);
    expect(event?.branchId, 3);
  });

  test('rejects malformed or expanded business-data payloads', () {
    expect(
      BranchInvalidationEvent.fromBroadcast({
        'payload': {
          'version': 1,
          'eventId': eventId,
          'scope': 'branch',
          'branchId': 3,
          'customerName': 'must never travel over realtime',
        },
      }),
      isNull,
    );
    expect(
      BranchInvalidationEvent.fromBroadcast({
        'payload': {
          'version': 2,
          'eventId': eventId,
          'scope': 'branch',
          'branchId': 3,
        },
      }),
      isNull,
    );
  });

  test('deduplicates events and enforces branch isolation', () {
    final tracker = BranchInvalidationTracker(maximumRemembered: 2);
    const event = BranchInvalidationEvent(eventId: eventId, branchId: 3);

    expect(tracker.shouldRefresh(event, 3), isTrue);
    expect(tracker.shouldRefresh(event, 3), isFalse);
    expect(
      tracker.shouldRefresh(
        const BranchInvalidationEvent(
          eventId: '22345678-1234-1234-1234-123456789abc',
          branchId: 4,
        ),
        3,
      ),
      isFalse,
    );
  });
}
