# Runs Sturoids on this PC in the Android emulator.
#   .\scripts\run-on-pc.ps1                       start the emulator (and the app, if it is installed)
#   .\scripts\run-on-pc.ps1 -Apk <file or URL>    also install that APK first (an EAS build's .apk link works)
# The emulator is "Sturoids_Pixel" (Android 14, Pixel 6, 2 GB), set up under %LOCALAPPDATA%\Android\Sdk.
param([string]$Apk = '')

$ErrorActionPreference = 'Continue'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$adb = "$sdk\platform-tools\adb.exe"
$emu = "$sdk\emulator\emulator.exe"
$pkg = 'com.sanjay.studenthub'

if (-not (Test-Path $emu)) { Write-Host 'The Android emulator is not installed under' $sdk; exit 1 }

# start the emulator unless one is already running
$running = (& $adb devices) -match 'emulator-\d+\s+device'
if (-not $running) {
  Write-Host 'Starting the emulator...'
  Start-Process -FilePath $emu -ArgumentList '-avd', 'Sturoids_Pixel', '-gpu', 'auto', '-netdelay', 'none', '-netspeed', 'full' | Out-Null
  & $adb wait-for-device
  Write-Host 'Waiting for Android to finish starting (a cold start can take a few minutes on this PC)...'
  do { Start-Sleep -Seconds 3; $done = (& $adb shell getprop sys.boot_completed 2>$null) } until ($done -match '1')
}

if ($Apk) {
  $file = $Apk
  if ($Apk -match '^https?://') {
    $file = Join-Path $env:TEMP 'sturoids.apk'
    Write-Host 'Downloading the APK...'
    Invoke-WebRequest -Uri $Apk -OutFile $file -UseBasicParsing
  }
  Write-Host 'Installing...'
  & $adb install -r -d $file
}

# open the app when it is installed
if ((& $adb shell pm list packages $pkg) -match $pkg) {
  & $adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 | Out-Null
  Write-Host 'Sturoids is open in the emulator window.'
} else {
  Write-Host 'The emulator is running. Install the app with: .\scripts\run-on-pc.ps1 -Apk <the .apk link from your EAS build>'
}
