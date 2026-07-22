$ErrorActionPreference = "Stop"

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HaiDouHelper"
$installed = Get-ItemProperty -Path $uninstallKey -ErrorAction SilentlyContinue
$installDirectory = if ($null -ne $installed) { [string]$installed.InstallLocation } else { "" }
if ([string]::IsNullOrWhiteSpace($installDirectory) -or -not [System.IO.Path]::IsPathRooted($installDirectory)) {
  throw "无法确认海斗数据助手的安装目录，已停止卸载以保护其他文件。"
}

$installDirectory = [System.IO.Path]::GetFullPath($installDirectory)
$markerPath = Join-Path $installDirectory ".haidou-helper-install"
$expectedHelperPath = Join-Path $installDirectory "HaiDouHelper.exe"
$marker = if (Test-Path -LiteralPath $markerPath -PathType Leaf) { Get-Content -LiteralPath $markerPath -Raw } else { "" }
if (-not $marker.StartsWith("HaiDouHelper|") -or -not (Test-Path -LiteralPath $expectedHelperPath -PathType Leaf)) {
  throw "安装标记或助手程序缺失，已停止自动删除。请手动检查：$installDirectory"
}

$volumeRoot = [System.IO.Path]::GetPathRoot($installDirectory).TrimEnd('\')
if ($installDirectory.TrimEnd('\') -ieq $volumeRoot) {
  throw "安装目录不能是磁盘根目录，已停止自动删除。"
}

$connection = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 3212 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $connection) {
  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  if ($null -ne $process -and $process.ProcessName -eq "HaiDouHelper") {
    Stop-Process -Id $process.Id -Force
  }
}

Remove-Item -Path "HKCU:\Software\Classes\haidou-helper" -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "HaiDouHelper" -Force -ErrorAction SilentlyContinue
Remove-Item -Path $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue

$encodedTarget = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($installDirectory))
$cleanupPath = Join-Path $env:TEMP ("haidou-helper-cleanup-{0}.ps1" -f [Guid]::NewGuid().ToString("N"))
$cleanup = @'
param([string]$EncodedTarget)
Start-Sleep -Seconds 2
$target = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($EncodedTarget))
$markerPath = Join-Path $target ".haidou-helper-install"
$marker = if (Test-Path -LiteralPath $markerPath -PathType Leaf) { Get-Content -LiteralPath $markerPath -Raw } else { "" }
if ($marker.StartsWith("HaiDouHelper|") -and (Split-Path -Leaf $target) -ieq "HaiDouHelper") {
  [System.IO.Directory]::Delete($target, $true)
}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'@
Set-Content -LiteralPath $cleanupPath -Value $cleanup -Encoding UTF8
Start-Process -FilePath (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") -ArgumentList "-NoProfile", "-File", ('"{0}"' -f $cleanupPath), $encodedTarget -WindowStyle Hidden
