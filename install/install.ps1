# Furina DSH pack installer (Windows PowerShell 5.1+)
# Installs the theme and its packaged startup-animation plugin into the DSH web profile.
param(
  [string]$Profile = "web",
  [switch]$NoPause
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$theme = (Get-ChildItem -LiteralPath $here -Filter "furina-dsh-theme-*.tgz" | Sort-Object Name -Descending | Select-Object -First 1).FullName
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

# --- shipped-preset compatibility -------------------------------------------
# dsh 0.2.2-rc.1 + billion-context: that bundle's patch makes the four shipped
# preset rows (standard / ptc / minimal / cordis) wait for
# `biliBasicCompactionPolicy`. On 0.2.2 the service never reaches the preset
# scope, so the rows stay pending and the new-session picker only offers custom
# presets. Clearing `inject` on those four rows restores them; the profile patch
# is applied after every bundle layer, so these rows win. Re-running is a no-op.
function Repair-ShippedPresets {
  $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
  $profileDir = Join-Path (Join-Path $dshHome "profiles") $Profile
  $manifestPath = Join-Path $profileDir "package.json"
  $patchPath = Join-Path $profileDir "cordis.patch.yml"
  $beginMarker = "# [furina-dsh-pack] shipped preset compatibility - begin"
  $endMarker = "# [furina-dsh-pack] shipped preset compatibility - end"

  if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Host "  preset check skipped: no profile manifest at $manifestPath" -ForegroundColor DarkGray
    return
  }
  $bundles = @()
  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) {
      $bundles = @($manifest.dsh.profile.bundles)
    }
  } catch { }
  if (-not ($bundles -contains "billion-context")) {
    Write-Host "  preset check: billion-context is not bundled, nothing to do" -ForegroundColor DarkGray
    return
  }
  if (-not ($bundles -contains "@deepseek-ai/dsh-web-app")) {
    Write-Host "  preset check: profile has no dsh-web-app bundle, nothing to do" -ForegroundColor DarkGray
    return
  }

  $patch = ""
  if (Test-Path -LiteralPath $patchPath) { $patch = [IO.File]::ReadAllText($patchPath) }
  if ($patch.Contains($beginMarker)) {
    Write-Host "  preset check: shipped-preset fix already present" -ForegroundColor DarkGray
    return
  }

  $nl = if ($patch.Contains("`r`n")) { "`r`n" } else { "`n" }
  $block = @(
    "",
    $beginMarker,
    "# dsh 0.2.2 + billion-context: the bundled patch injects biliBasicCompactionPolicy",
    "# into the four shipped preset rows; that service never reaches the preset scope",
    "# on 0.2.2, so the rows stay pending and vanish from the new-session picker.",
    "- id: preset-standard",
    "  inject: []",
    "- id: preset-ptc",
    "  inject: []",
    "- id: preset-minimal",
    "  inject: []",
    "- id: preset-cordis",
    "  inject: []",
    $endMarker,
    ""
  ) -join $nl

  if ($patch.Length -gt 0) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item -LiteralPath $patchPath -Destination ($patchPath + ".furina-preset-fix-" + $stamp + ".bak") -Force
  }
  $next = if ($patch.Length -gt 0) { $patch.TrimEnd() + $nl + $block } else { $block.TrimStart($nl) }
  [IO.File]::WriteAllText($patchPath, $next, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  preset check: cleared the billion-context inject on the four shipped presets" -ForegroundColor Green
}

Write-Host ""
Write-Host "Furina DSH pack installer" -ForegroundColor Cyan
Write-Host "  profile: $Profile"
Write-Host ""

Write-Host "[1/3] Installing Furina theme..." -ForegroundColor Yellow
Invoke-Dsh @("plugin", "--profile", $Profile, "add", ("file:" + $theme.Replace('\', '/')))

Write-Host "[2/3] Installing startup animation..." -ForegroundColor Yellow
Invoke-Dsh @("plugin", "--profile", $Profile, "add", ("file:" + $startup.Replace('\', '/')))

Write-Host "[3/3] Checking the shipped agent presets..." -ForegroundColor Yellow
Repair-ShippedPresets

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Next: restart the DSH web process once, then refresh the page."
Write-Host "Controls: Settings -> Furina theme -> Startup / Persona preset blocks"
Write-Host "The bundled Furina agent preset is opt-in: press the install button in the PERSONA block."
Write-Host "Uninstall: dsh plugin --profile $Profile remove furina-dsh-theme; dsh plugin --profile $Profile remove dsh-startup-screen"
if (-not $NoPause) { Read-Host "Press Enter to close" | Out-Null }
