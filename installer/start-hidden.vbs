Option Explicit
Dim fso, shell, helperPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
helperPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "HaiDouHelper.exe")
shell.Run Chr(34) & helperPath & Chr(34), 0, False
