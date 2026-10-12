' MusicBridge - Bildirim Alani (Tray) Sessiz Baslatici
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = ScriptDir
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ScriptDir & "\MusicBridge-Tray.ps1""", 0, False
Set WshShell = Nothing
Set FSO = Nothing
