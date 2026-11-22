import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/operations/data/operations_repository.dart';
import 'package:pumppos/features/operations/presentation/database_admin_actions.dart';

final class _BackupFile extends PlatformFile {
  @override
  String get name => 'station.posbackup';
  @override
  Future<int> length() async => 1;
  @override
  Future<Uint8List> readAsBytes() async => Uint8List.fromList([42]);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FilePicker extends FilePickerPlatform {
  @override
  Future<PlatformFile?> pickFile({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    AndroidOptions androidOptions = const AndroidOptions(),
    WindowsOptions windowsOptions = const WindowsOptions(),
    LinuxOptions linuxOptions = const LinuxOptions(),
    WebOptions webOptions = const WebOptions(),
  }) async => _BackupFile();
}

class _RestoreRepository extends Fake implements OperationsRepository {
  _RestoreRepository(this.legacy);
  final bool legacy;
  @override
  Future<Object?> mutateProcedure(
    String procedure, {
    required int branchId,
    Object? input,
  }) async {
    expect(procedure, 'dbadmin.restoreUpload');
    expect(branchId, 1);
    expect(input, {
      'fileName': 'station.posbackup',
      'contentBase64': 'Kg==',
      'confirmation': 'กู้คืนข้อมูล',
    });
    return {
      'restored': {
        'legacyBackup': legacy,
        'fileName': 'station.posbackup',
        'totalRows': 8,
      },
    };
  }
}

void main() {
  for (final legacy in [false, true]) {
    testWidgets(
      'mobile restore confirms the file and reports missing legacy data (legacy=$legacy)',
      (tester) async {
        final original = FilePickerPlatform.instance;
        FilePickerPlatform.instance = _FilePicker();
        addTearDown(() => FilePickerPlatform.instance = original);
        await tester.binding.setSurfaceSize(const Size(390, 844));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => restoreDatabase(
                    context: context,
                    repository: _RestoreRepository(legacy),
                    branchId: 1,
                  ),
                  child: const Text('เลือกไฟล์'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('เลือกไฟล์'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('ไฟล์รุ่น 1 ไม่มีต้นทุนยกมาน้ำมัน'),
          findsOneWidget,
        );
        final confirm = find.widgetWithText(FilledButton, 'กู้คืนฐานข้อมูล');
        expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
        await tester.enterText(find.byType(TextField), 'กู้คืนข้อมูล');
        await tester.pump();
        await tester.ensureVisible(confirm);
        await tester.tap(confirm);
        await tester.pumpAndSettle();
        expect(
          find.textContaining('กู้คืน 8 แถวจาก station.posbackup สำเร็จ'),
          findsOneWidget,
        );
        expect(
          find.textContaining('ก่อนใช้รายงานกำไรหรือคำนวณค่าแรง'),
          legacy ? findsOneWidget : findsNothing,
        );
      },
    );
  }
}
