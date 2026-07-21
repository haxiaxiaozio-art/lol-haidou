$ErrorActionPreference = "Stop"

$productVersion = "0.3.1"
$sourceDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDirectory = Join-Path $env:LOCALAPPDATA "HaiDouHelper"
$helperPath = Join-Path $installDirectory "HaiDouHelper.exe"
$launcherPath = Join-Path $installDirectory "start-hidden.vbs"
$websiteUrl = "https://haxiaxiaozio-art.github.io/lol-haidou/?v=6"

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
Copy-Item -LiteralPath (Join-Path $sourceDirectory "HaiDouHelper.exe") -Destination $helperPath -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory "start-hidden.vbs") -Destination $launcherPath -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory "uninstall-helper.ps1") -Destination (Join-Path $installDirectory "uninstall-helper.ps1") -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory "README.txt") -Destination (Join-Path $installDirectory "README.txt") -Force

$protocolRoot = "HKCU:\Software\Classes\haidou-helper"
New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:HaiDou Data Helper Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
$protocolCommand = New-Item -Path (Join-Path $protocolRoot "shell\open\command") -Force
Set-Item -Path $protocolCommand.PSPath -Value ('"{0}" "{1}" "%1"' -f (Join-Path $env:SystemRoot "System32\wscript.exe"), $launcherPath)

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name "HaiDouHelper" -Value ('"{0}" "{1}"' -f (Join-Path $env:SystemRoot "System32\wscript.exe"), $launcherPath) -PropertyType String -Force | Out-Null

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HaiDouHelper"
New-Item -Path $uninstallKey -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "HaiDou Data Helper" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $productVersion -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "HaiDou Report" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $installDirectory "uninstall-helper.ps1")) -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installDirectory -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

Start-Process -FilePath (Join-Path $env:SystemRoot "System32\wscript.exe") -ArgumentList ('"{0}"' -f $launcherPath) -WindowStyle Hidden
Start-Sleep -Seconds 1
Start-Process $websiteUrl
