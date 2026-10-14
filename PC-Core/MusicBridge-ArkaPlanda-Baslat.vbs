' MusicBridge - Sessiz Arka Plan Baslatici (Sifir Pencere & Sistem Tepsisi)
' Eren Teknoloji - 2026
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = ScriptDir

' Eger node_modules yoksa sessizce npm install ws yap
If Not FSO.FolderExists(ScriptDir & "\node_modules") Then
    WshShell.Run "cmd /c npm install ws --no-audit --no-fund", 0, True
End If

' 1. Node.js sunucusunu sifir pencere ile arka planda baslat
WshShell.Run "cmd /c node server.js", 0, False

' 2. Sistem Tepsisi (Tray) simgesini kesinlikle arka planda baslat
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ScriptDir & "\MusicBridge-Tray.ps1""", 0, False

Set WshShell = Nothing
Set FSO = Nothing
