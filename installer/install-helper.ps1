$ErrorActionPreference = "Stop"

$productVersion = "0.5.0"
$sourceDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HaiDouHelper"

Add-Type -AssemblyName System.Windows.Forms
$folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
$folderDialog.Description = "请选择海斗数据助手的安装位置。程序会安装到所选目录下的 HaiDouHelper 文件夹，不需要管理员权限。"
$folderDialog.ShowNewFolderButton = $true
$existingInstall = Get-ItemProperty -Path $uninstallKey -ErrorAction SilentlyContinue
$previousInstallDirectory = if ($null -ne $existingInstall) { [string]$existingInstall.InstallLocation } else { "" }
if ($previousInstallDirectory -and (Test-Path -LiteralPath $previousInstallDirectory -PathType Container)) {
  $folderDialog.SelectedPath = Split-Path -Parent $previousInstallDirectory
}
if ($folderDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1223 }

$selectedDirectory = [System.IO.Path]::GetFullPath($folderDialog.SelectedPath)
$installDirectory = if ((Split-Path -Leaf $selectedDirectory) -ieq "HaiDouHelper") { $selectedDirectory } else { Join-Path $selectedDirectory "HaiDouHelper" }
$installDirectory = [System.IO.Path]::GetFullPath($installDirectory)
$volumeRoot = [System.IO.Path]::GetPathRoot($installDirectory).TrimEnd('\')
$protectedRoots = @(
  $env:SystemRoot,
  $env:ProgramFiles,
  ${env:ProgramFiles(x86)},
  $env:ProgramData
) | Where-Object { $_ } | ForEach-Object { [System.IO.Path]::GetFullPath($_).TrimEnd('\') }
foreach ($protectedRoot in $protectedRoots) {
  if ($installDirectory.TrimEnd('\') -ieq $volumeRoot -or $installDirectory.TrimEnd('\') -ieq $protectedRoot -or $installDirectory.StartsWith($protectedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    [System.Windows.Forms.MessageBox]::Show("请选择文档、游戏盘或其他当前用户可写目录，不要选择 Windows、Program Files、ProgramData 或磁盘根目录。", "海斗数据助手", "OK", "Warning") | Out-Null
    exit 5
  }
}
if ([System.Windows.Forms.MessageBox]::Show("海斗数据助手将安装到：`n`n$installDirectory`n`n仅为当前 Windows 用户安装，不申请管理员权限。", "确认安装位置", "OKCancel", "Information") -ne "OK") { exit 1223 }

$helperPath = Join-Path $installDirectory "HaiDouHelper.exe"
$launcherPath = Join-Path $installDirectory "start-hidden.vbs"
$websiteUrl = "https://haxiaxiaozio-art.github.io/lol-haidou/?v=7"

function Stop-HaiDouHelper {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3212/v1/health" -TimeoutSec 1
    if ($health.service -ne "haidou-local-helper") { return }
    $connection = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 3212 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $connection) { return }
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if ($null -ne $process -and @("node", "HaiDouHelper") -contains $process.ProcessName) {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      Start-Sleep -Milliseconds 500
    }
  } catch {
    # No existing HaiDou helper is running.
  }
}

Stop-HaiDouHelper
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
$writeProbe = Join-Path $installDirectory ".write-test"
Set-Content -LiteralPath $writeProbe -Value "ok" -Encoding Ascii
Remove-Item -LiteralPath $writeProbe -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory "HaiDouHelper.exe") -Destination $helperPath -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory "start-hidden.vbs") -Destination $launcherPath -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory "uninstall-helper.ps1") -Destination (Join-Path $installDirectory "uninstall-helper.ps1") -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory "README.txt") -Destination (Join-Path $installDirectory "README.txt") -Force
Set-Content -LiteralPath (Join-Path $installDirectory ".haidou-helper-install") -Value "HaiDouHelper|$productVersion" -Encoding UTF8

$requiredInstalledFiles = @("HaiDouHelper.exe", "start-hidden.vbs", "uninstall-helper.ps1", "README.txt", ".haidou-helper-install")
$missingInstalledFiles = $requiredInstalledFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $installDirectory $_) -PathType Leaf) }
if ($missingInstalledFiles.Count -gt 0) {
  throw "安装文件校验失败，缺少：$($missingInstalledFiles -join '、')。请重新下载安装包后再试。"
}

if ($previousInstallDirectory) { $previousInstallDirectory = [System.IO.Path]::GetFullPath($previousInstallDirectory) }
$legacyInstallDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "HaiDouHelper"))
$previousMarker = if ($previousInstallDirectory -and (Test-Path -LiteralPath (Join-Path $previousInstallDirectory ".haidou-helper-install") -PathType Leaf)) { Get-Content -LiteralPath (Join-Path $previousInstallDirectory ".haidou-helper-install") -Raw } else { "" }
$safePreviousInstall = $previousInstallDirectory -and (Split-Path -Leaf $previousInstallDirectory) -ieq "HaiDouHelper" -and (
  $previousInstallDirectory.Equals($legacyInstallDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or $previousMarker.StartsWith("HaiDouHelper|")
)
if ($safePreviousInstall -and -not $installDirectory.Equals($previousInstallDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
  foreach ($oldName in @("HaiDouHelper.exe", "start-hidden.vbs", "uninstall-helper.ps1", "README.txt", ".haidou-helper-install")) {
    Remove-Item -LiteralPath (Join-Path $previousInstallDirectory $oldName) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $previousInstallDirectory -Force -ErrorAction SilentlyContinue
}

$protocolRoot = "HKCU:\Software\Classes\haidou-helper"
New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:HaiDou Data Helper Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
$protocolCommand = New-Item -Path (Join-Path $protocolRoot "shell\open\command") -Force
Set-Item -Path $protocolCommand.PSPath -Value ('"{0}" "{1}" "%1"' -f (Join-Path $env:SystemRoot "System32\wscript.exe"), $launcherPath)

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name "HaiDouHelper" -Value ('"{0}" "{1}"' -f (Join-Path $env:SystemRoot "System32\wscript.exe"), $launcherPath) -PropertyType String -Force | Out-Null

New-Item -Path $uninstallKey -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "HaiDou Data Helper" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $productVersion -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "HaiDou Report" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value ('powershell.exe -NoProfile -File "{0}"' -f (Join-Path $installDirectory "uninstall-helper.ps1")) -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installDirectory -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

Start-Process -FilePath (Join-Path $env:SystemRoot "System32\wscript.exe") -ArgumentList ('"{0}"' -f $launcherPath) -WindowStyle Hidden
Start-Sleep -Seconds 1
Start-Process $websiteUrl
