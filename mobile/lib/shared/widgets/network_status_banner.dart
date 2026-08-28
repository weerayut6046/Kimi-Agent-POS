import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final connectivityProvider = StreamProvider<List<ConnectivityResult>>((
  ref,
) async* {
  final connectivity = Connectivity();
  yield await connectivity.checkConnectivity();
  yield* connectivity.onConnectivityChanged;
});

class NetworkStatusBanner extends ConsumerWidget {
  const NetworkStatusBanner({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final results = ref.watch(connectivityProvider).value;
    final offline = results?.contains(ConnectivityResult.none) == true;
    return Column(
      children: [
        if (offline)
          Material(
            color: const Color(0xFFFFF2C6),
            child: SafeArea(
              bottom: false,
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.wifi_off_rounded, size: 18),
                    SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        'ไม่มีเครือข่าย — Mobile ต้องออนไลน์ก่อนบันทึกรายการ',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        Expanded(child: child),
      ],
    );
  }
}
