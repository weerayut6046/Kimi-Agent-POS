@echo off
rem ติดตั้ง PumpPOS root certificate เข้า Trusted Root + Trusted Publisher
rem ใช้ครั้งเดียวต่อเครื่อง เพื่อให้ Windows Smart App Control ยอมรับแอป POS ที่ sign ด้วย cert นี้
rem — ต้องรันด้วยสิทธิ์ Administrator (คลิกขวา -^> Run as administrator)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ผิดพลาด] กรุณาคลิกขวาที่ไฟล์นี้แล้วเลือก "Run as administrator"
  pause
  exit /b 1
)

certutil -addstore -f Root "%~dp0pumpos-codesign.cer"
if %errorlevel% neq 0 goto :fail
certutil -addstore -f TrustedPublisher "%~dp0pumpos-codesign.cer"
if %errorlevel% neq 0 goto :fail

echo.
echo ติดตั้ง certificate เรียบร้อยแล้ว — เปิดแอป POS ได้ตามปกติ
pause
exit /b 0

:fail
echo.
echo [ผิดพลาด] ติดตั้ง certificate ไม่สำเร็จ
pause
exit /b 1
