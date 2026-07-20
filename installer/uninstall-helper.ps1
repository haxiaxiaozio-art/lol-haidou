$ErrorActionPreference = "SilentlyContinue"

$installDirectory = Join-Path $env:LOCALAPPDATA "HaiDouHelper"
$expectedHelperPath = Join-Path $installDirectory "HaiDouHelper.exe"
$connection = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 3212 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $connection) {
  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  if ($null -ne $process -and $process.ProcessName -eq "HaiDouHelper") {
    Stop-Process -Id $process.Id -Force
  }
}

Remove-Item -Path "HKCU:\Software\Classes\haidou-helper" -Recurse -Force
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "HaiDouHelper" -Force
Remove-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HaiDouHelper" -Recurse -Force

$cleanupPath = Join-Path $env:TEMP "haidou-helper-cleanup.cmd"
$cleanup = "@echo off`r`ntimeout /t 2 /nobreak >nul`r`nrmdir /s /q `"$installDirectory`"`r`ndel /q `"%~f0`"`r`n"
Set-Content -LiteralPath $cleanupPath -Value $cleanup -Encoding Ascii
Start-Process -FilePath (Join-Path $env:SystemRoot "System32\cmd.exe") -ArgumentList "/d", "/c", ('"{0}"' -f $cleanupPath) -WindowStyle Hidden
