!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "ยินดีต้อนรับสู่ตัวช่วยติดตั้ง POS ปั๊มน้ำมัน"
!define MUI_WELCOMEPAGE_TEXT "ตัวช่วยนี้จะติดตั้งระบบ POS ปั๊มน้ำมันสำหรับผู้ใช้งานทุกคนในเครื่อง$\r$\n$\r$\nโปรดปิดโปรแกรม POS ที่กำลังเปิดอยู่ แล้วคลิก ‘ถัดไป’ เพื่อดำเนินการต่อ"
!define MUI_LICENSEPAGE_TEXT_TOP "โปรดอ่านข้อตกลงการใช้งานต่อไปนี้อย่างละเอียด"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "หากยอมรับข้อตกลง โปรดเลือกยอมรับแล้วคลิก ‘ถัดไป’"
!define MUI_DIRECTORYPAGE_TEXT_TOP "เลือกโฟลเดอร์ที่ต้องการติดตั้งระบบ POS ปั๊มน้ำมัน"
!define MUI_FINISHPAGE_TITLE "ติดตั้ง POS ปั๊มน้ำมันเสร็จสมบูรณ์"
!define MUI_FINISHPAGE_TEXT "ระบบ POS ปั๊มน้ำมันพร้อมใช้งานแล้ว$\r$\n$\r$\nคลิก ‘เสร็จสิ้น’ เพื่อปิดตัวช่วยติดตั้ง"

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom ReadyPageCreate
!macroend

!ifndef BUILD_UNINSTALLER
Function ReadyPageCreate
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:พร้อมติดตั้ง"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:ตรวจสอบข้อมูลแล้วและพร้อมเริ่มติดตั้งโปรแกรม"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 8u 100% 26u "ตัวช่วยติดตั้งพร้อมติดตั้งระบบ POS ปั๊มน้ำมันลงในคอมพิวเตอร์นี้แล้ว"
  Pop $1
  CreateFont $2 "Leelawadee UI" 10 700
  SendMessage $1 ${WM_SETFONT} $2 1

  ${NSD_CreateLabel} 0 46u 100% 16u "ตำแหน่งติดตั้ง:"
  Pop $1
  ${NSD_CreateText} 0 64u 100% 22u "$INSTDIR"
  Pop $1
  SendMessage $1 ${EM_SETREADONLY} 1 0

  ${NSD_CreateLabel} 0 101u 100% 38u "คลิก ‘ติดตั้ง’ เพื่อเริ่มติดตั้ง หากต้องการตรวจสอบหรือเปลี่ยนตำแหน่งติดตั้งให้คลิก ‘ย้อนกลับ’"
  Pop $1

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:ติดตั้ง"
  nsDialogs::Show
FunctionEnd
!endif
