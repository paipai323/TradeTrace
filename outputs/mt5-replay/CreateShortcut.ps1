$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'Start.cmd'
$icon = Join-Path $PSScriptRoot 'journal.ico'
$shortcutPath = Join-Path $PSScriptRoot 'MT5 Journal.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
$shortcut.Arguments = '/d /c ""' + $launcher + '""'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Open your MT5 trading journal and replay'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output "Created: $shortcutPath"
