; StreamBro NSIS installer customizations (1.1.0)
;  - registers streambro:// URL protocol so the website can deep-link back
;    into the app after registration / login
;  - cleans up the protocol on uninstall
; Notes:
;   electron-builder's `protocols` block in package.json already adds the
;   protocol entries via its built-in registry hooks; this macro is here as a
;   safety net in case the user ran the installer with the deep-link option
;   blocked by AV software.

!macro customHeader
  RequestExecutionLevel user
!macroend

!macro customInstall
  ; Register streambro:// protocol (per-user — matches NSIS perMachine:false)
  WriteRegStr HKCU "Software\Classes\streambro" "" "URL:StreamBro Protocol"
  WriteRegStr HKCU "Software\Classes\streambro" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\streambro\DefaultIcon" "" "$INSTDIR\StreamBro.exe,1"
  WriteRegStr HKCU "Software\Classes\streambro\shell\open\command" "" '"$INSTDIR\StreamBro.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\streambro"
!macroend
