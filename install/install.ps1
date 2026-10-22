# Furina DSH pack installer (Windows PowerShell 5.1+)
# Installs the theme and its packaged startup-animation plugin into the DSH web profile.
param(
  [string]$Profile = "web",
  [switch]$NoPause
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$theme = Join-Path $here "furina-dsh-theme-1.1.1.tgz"
$startup = Join-Path $here "dsh-startup-screen-1.1.0.tgz"

foreach ($f in @($theme, $startup)) {
  if (-not (Test-Path -LiteralPath $f)) { throw "missing package next to installer: $f" }
}

$dshCmd = Get-Command dsh.cmd -ErrorAction SilentlyContinue
if (-not $dshCmd) { $dshCmd = Get-Command dsh -ErrorAction SilentlyContinue }

function Invoke-Dsh([string[]]$dshArgs) {
  if ($dshCmd) { & $dshCmd.Source @dshArgs }
  else { & npx --yes @deepseek-ai/dsh @dshArgs }
  if ($LASTEXITCODE -ne 0) { throw "dsh command failed with exit code $LASTEXITCODE" }
}

Write-Host ""
Write-Host "Furina DSH pack installer" -ForegroundColor Cyan
Write-Host "  profile: $Profile"
Write-Host ""

Write-Host "[1/2] Installing Furina theme..." -ForegroundColor Yellow
Invoke-Dsh @("plugin", "--profile", $Profile, "add", ("file:" + $theme.Replace('\', '/')))

Write-Host "[2/2] Installing startup animation..." -ForegroundColor Yellow
Invoke-Dsh @("plugin", "--profile", $Profile, "add", ("file:" + $startup.Replace('\', '/')))

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Next: restart the DSH web process once, then refresh the page."
Write-Host "Controls: Settings -> Furina theme -> Startup block"
Write-Host "Uninstall: dsh plugin --profile $Profile remove furina-dsh-theme; dsh plugin --profile $Profile remove dsh-startup-screen"
if (-not $NoPause) { Read-Host "Press Enter to close" | Out-Null }
