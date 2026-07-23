!define BAKAMUSIC_INNO_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\{BakaMusic}_is1"

; Preserve the install scope and directory selected with the former Inno Setup
; installer. The old uninstall entry is removed only after NSIS has installed
; the replacement successfully.
!macro customInit
  ReadRegStr $0 HKCU "${BAKAMUSIC_INNO_UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 != ""
    WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$0"
  ${EndIf}

  ${If} ${UAC_IsAdmin}
    ReadRegStr $0 HKLM "${BAKAMUSIC_INNO_UNINSTALL_KEY}" "InstallLocation"
    ${If} $0 != ""
      WriteRegStr HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$0"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstallMode
  ReadRegStr $0 HKCU "${BAKAMUSIC_INNO_UNINSTALL_KEY}" "InstallLocation"
  ReadRegStr $1 HKLM "${BAKAMUSIC_INNO_UNINSTALL_KEY}" "InstallLocation"

  ${If} $0 != ""
  ${AndIf} $1 == ""
    StrCpy $isForceCurrentInstall "1"
  ${ElseIf} $0 == ""
  ${AndIf} $1 != ""
    StrCpy $isForceMachineInstall "1"
  ${EndIf}
!macroend

!macro customInstall
  DeleteRegKey SHELL_CONTEXT "${BAKAMUSIC_INNO_UNINSTALL_KEY}"
  ${If} $installMode == "all"
    DeleteRegKey HKCU "${BAKAMUSIC_INNO_UNINSTALL_KEY}"
  ${EndIf}

  Delete "$INSTDIR\unins???.dat"
  Delete "$INSTDIR\unins???.exe"
  Delete "$INSTDIR\unins???.msg"
!macroend
