Set WshShell = CreateObject("WScript.Shell")
appData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
WshShell.Run "node.exe """ & appData & "\ByeDPI\bridge.mjs""", 0, False
