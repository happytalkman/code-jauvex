# The web version on Windows, from nothing to running, in one command (PowerShell):
#   irm https://raw.githubusercontent.com/happytalkman/code-jauvex/claude/awesome-pasteur-ndvvom/scripts/windows-start.ps1 | iex
# or, in a copy already here: double-click start-windows.cmd. What is missing is installed (Node and Git with winget, the app's packages,
# the voice with npm run voice:setup), what is there is kept, and the app starts (npm run web) and opens the browser. Run it again any time:
# it only does what is still missing, then starts the app. JAUVEX_DIR moves the copy (default: <home>\jauvex), JAUVEX_BRANCH picks the branch,
# JAUVEX_NO_START=1 stops before starting it (the Windows check, .github/workflows/windows.yml), JAUVEX_ZCODE=0 leaves ZCode out,
# JAUVEX_CLAW=0 leaves Claw out, JAUVEX_WEAIDDB=0 leaves WEAIDdb out, JAUVEX_BROWSER=0 the browser agent (jev-ultrafast), JAUVEX_PAPERCLIP=0 Paperclip.
# ZCode (github.com/zai-org/ZCode), the third agent, is built from its source into <home>\zcode (Node 24, pnpm) and its zcode command
# put in <home>\.jauvex\bin, on the user's PATH; it is rebuilt only when its source moved. Its sign-in stays the user's: zcode login zai.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Windows PowerShell's progress bar slows a download many times over
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 # GitHub needs TLS 1.2
$repo = 'https://github.com/happytalkman/code-jauvex'
$branch = if ($env:JAUVEX_BRANCH) { $env:JAUVEX_BRANCH } else { 'claude/awesome-pasteur-ndvvom' }
function Say($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "`n$t" -ForegroundColor Red; if (-not $env:CI) { Read-Host 'Press Enter to close' }; exit 1 }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Install-WithWinget($id, $what) { # not named Winget: PowerShell names ignore case, and winget inside it then called itself until the call depth overflowed
  if (-not (Has 'winget')) { Fail "$what is missing and winget is not here to install it. Install $what yourself, then run this again." }
  Say "Installing $what (winget)"; winget.exe install --id $id -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

# Node 22.18 or newer: the app's scripts are TypeScript that Node runs as it is. ZCode needs 24.
$withZcode = $env:JAUVEX_ZCODE -ne '0'; $withPaperclip = $env:JAUVEX_PAPERCLIP -ne '0'; $withBrowser = $env:JAUVEX_BROWSER -ne '0'
$nodeMin = if ($withPaperclip) { [version]'24.11.0' } elseif ($withZcode) { [version]'24.0.0' } else { [version]'22.18.0' } # Paperclip needs 24.11, ZCode 24, the app 22.18
function Node-Ok { if (-not (Has 'node')) { return $false }; try { [version]((node -v).TrimStart('v')) -ge $nodeMin } catch { $false } }
if (-not (Node-Ok)) {
  if (Has 'node') { Write-Host "Node $(node -v) is too old: this needs $nodeMin or newer." -ForegroundColor Yellow }
  Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js'
  if (-not (Node-Ok)) { $env:Path = "$env:ProgramFiles\nodejs;$env:Path" } # an older Node earlier on the PATH still answers first
  if (-not (Node-Ok)) { Fail "Node.js $nodeMin or newer is not reachable yet: close this window, open a new PowerShell, run the same command again. (An older Node from nvm or another installer may come first on the PATH.)" }
}
if (-not (Has 'git')) { Install-WithWinget 'Git.Git' 'Git'; if (-not (Has 'git')) { Fail 'Git was installed but this window does not see it yet: close it, open a new PowerShell, run the same command again.' } }

# The copy: this folder when the script runs from one, else <home>\jauvex (cloned the first time, brought up to date after).
$here = if ($PSScriptRoot) { Split-Path $PSScriptRoot -Parent } else { $null }
$dir = if ($here -and (Test-Path (Join-Path $here 'package.json'))) { $here } elseif ($env:JAUVEX_DIR) { $env:JAUVEX_DIR } else { Join-Path $HOME 'jauvex' }
if (-not (Test-Path (Join-Path $dir 'package.json'))) { Say "Getting the app into $dir"; git clone -b $branch $repo $dir; if ($LASTEXITCODE) { Fail 'git clone failed.' } }
elseif (Test-Path (Join-Path $dir '.git')) { Say 'Bringing the app up to date'; git -C $dir pull --ff-only; if ($LASTEXITCODE) { Write-Host 'Could not update (local changes?): starting the copy as it is.' -ForegroundColor Yellow } }
Set-Location $dir

# npm's own .ps1 can be refused by the execution policy: npm.cmd is not.
Say 'Installing the app''s packages'; npm.cmd install; if ($LASTEXITCODE) { Fail 'npm install failed (see above).' }
Say 'The voice: whisper-server and the Whisper models (about 250 MB the first time)'
npm.cmd run voice:setup; if ($LASTEXITCODE) { Write-Host 'The voice is not ready (see above); the app runs by text meanwhile. Run this again later to finish it.' -ForegroundColor Yellow }

# <home>\.jauvex\bin: the zcode and claw commands the setup makes, on the user's PATH (and this window's).
$bin = Join-Path $HOME '.jauvex\bin'; New-Item -ItemType Directory -Force $bin | Out-Null
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not (($userPath -split ';') -contains $bin)) { [Environment]::SetEnvironmentVariable('Path', "$bin;$userPath", 'User') }
if (-not (($env:Path -split ';') -contains $bin)) { $env:Path = "$bin;$env:Path" }

# ZCode: its CLI built from its source (about 3 minutes the first time), the zcode command made for it. A failure here leaves the app
# running without ZCode, and says why.
if ($withZcode) {
  $zc = Join-Path $HOME 'zcode'; $cli = Join-Path $zc 'apps\zcode-cli\packages\cli\dist\zcode.cjs'
  try {
    if (-not (Test-Path (Join-Path $zc 'package.json'))) { Say "Getting ZCode into $zc"; git clone --depth 1 https://github.com/zai-org/ZCode $zc; if ($LASTEXITCODE) { throw 'git clone of ZCode failed' } }
    else { Say 'Bringing ZCode up to date'; git -C $zc pull --ff-only; if ($LASTEXITCODE) { Write-Host 'Could not update ZCode: building the copy as it is.' -ForegroundColor Yellow } }
    $head = (git -C $zc rev-parse HEAD).Trim(); $stamp = Join-Path $zc '.jauvex-built'
    if (-not (Test-Path $cli) -or -not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $head) {
      Say 'Building ZCode (its CLI only; a few minutes the first time)'
      Push-Location $zc
      try { # pnpm at ZCode's own version, through npx: corepack enable needs an administrator on Windows
        npx.cmd --yes pnpm@10.33.2 install --frozen-lockfile --filter '@zcode/cli...'; if ($LASTEXITCODE) { throw 'pnpm install failed' }
        npx.cmd --yes pnpm@10.33.2 --filter '@zcode/cli...' build; if ($LASTEXITCODE) { throw 'the build failed' }
      } finally { Pop-Location }
      Set-Content -Path $stamp -Value $head -Encoding ascii
    } else { Say 'ZCode is built and up to date' }
    Set-Content -Path (Join-Path $bin 'zcode.cmd') -Value "@echo off`r`nnode `"$cli`" %*" -Encoding ascii
    Write-Host "zcode: $(zcode.cmd --version)"
  } catch { Write-Host "ZCode is not ready ($($_.Exception.Message)); the app runs without it meanwhile. Run this again to retry." -ForegroundColor Yellow }
}

# Claw (github.com/ultraworkers/claw-code, MIT): claw-code publishes no release, so this repository's release claw-<commit> carries a
# claw.exe built from that commit (.github/workflows/claw-windows.yml), fetched here and checked by size and SHA-256. It runs on an
# Anthropic API key (ANTHROPIC_API_KEY), which stays the user's to set.
if ($env:JAUVEX_CLAW -ne '0') {
  $clawExe = Join-Path $bin 'claw.exe'; $clawUrl = 'https://github.com/happytalkman/code-jauvex/releases/download/claw-08106b0/claw.exe'
  $clawSize = 15736832; $clawSum = '282015d5da92ca1c4f3cdb956c7e44fcc8da1cbb0837d11f78c0e568713c35a0'
  function Claw-Ok { (Test-Path $clawExe) -and (Get-Item $clawExe).Length -eq $clawSize -and (Get-FileHash $clawExe -Algorithm SHA256).Hash.ToLower() -eq $clawSum }
  if (-not $clawSum) { Write-Host 'Claw for Windows is not published yet: the app runs without it meanwhile.' -ForegroundColor Yellow }
  elseif (Claw-Ok) { Say 'Claw is here' }
  else {
    Say 'Getting Claw (claw.exe, built from claw-code)'
    try {
      $part = "$clawExe.part"; Invoke-WebRequest -UseBasicParsing -Uri $clawUrl -OutFile $part
      $got = (Get-FileHash $part -Algorithm SHA256).Hash.ToLower(); if ((Get-Item $part).Length -ne $clawSize -or $got -ne $clawSum) { Remove-Item $part -Force; throw "the download does not match its SHA-256 ($got)" }
      Move-Item $part $clawExe -Force
    } catch { Write-Host "Claw is not ready ($($_.Exception.Message)); the app runs without it meanwhile. Run this again to retry." -ForegroundColor Yellow }
  }
  if ((Test-Path $clawExe) -and -not $env:ANTHROPIC_API_KEY -and -not [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User')) { Write-Host 'Claw runs on an Anthropic API key: set it once with  setx ANTHROPIC_API_KEY sk-ant-...  then run this again.' -ForegroundColor Yellow }
  elseif (-not $env:ANTHROPIC_API_KEY) { $env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User') } # set with setx after this window opened: the app started from here sees it
}

# WEAIDdb (the agents' graph database, scripts/weaiddb.ps1): a Docker container built from the fork. Docker Desktop stays the user's
# to install; without it the app runs without WEAIDdb and says how. The first build takes 15-30 minutes, later starts seconds.
if ($env:JAUVEX_WEAIDDB -ne '0') {
  if (Has 'docker') {
    Say "WEAIDdb, the agents' graph database (the first build takes 15-30 minutes)"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'scripts\weaiddb.ps1') start
    if ($LASTEXITCODE) { Write-Host 'WEAIDdb is not running (see above); the app runs without it meanwhile. Run this again to retry.' -ForegroundColor Yellow }
  } else { Write-Host "WEAIDdb (the agents' graph database) runs in Docker: install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, then run this again." -ForegroundColor Yellow }
}

# The browser agent (jev-ultrafast, shared/browse.ts): its clone in <home>\jev-ultrafast and its uv environment. Its keys stay the
# user's: TypeSafe's (the app's own, TYPESAFE_API_KEY or <home>\.typesafe\token) and the text model's, in that clone's .env.
if ($withBrowser) {
  try {
    if (-not (Has 'uv')) { Install-WithWinget 'astral-sh.uv' 'uv'; if (-not (Has 'uv')) { $env:Path = "$HOME\.local\bin;$env:Path" } }
    if (-not (Has 'uv')) { throw 'uv is not reachable yet (open a new PowerShell and run this again)' }
    $jev = Join-Path $HOME 'jev-ultrafast'
    if (-not (Test-Path (Join-Path $jev 'pyproject.toml'))) { Say "Getting the browser agent (jev-ultrafast) into $jev"; git clone --depth 1 https://github.com/browser-use/jev-ultrafast $jev; if ($LASTEXITCODE) { throw 'git clone failed' } }
    else { git -C $jev pull --ff-only | Out-Null } # stdout only: Windows PowerShell turns a redirected stderr into an error
    Say 'The browser agent: its Python environment (uv sync)'; Push-Location $jev; try { uv sync; if ($LASTEXITCODE) { throw 'uv sync failed' } } finally { Pop-Location }
    if (-not (Test-Path (Join-Path $jev '.env')) -and (Test-Path (Join-Path $jev '.env.example'))) { Copy-Item (Join-Path $jev '.env.example') (Join-Path $jev '.env') }
    if (-not ((Get-Content (Join-Path $jev '.env') -Raw) -match '(?m)^TEXT_MODEL_API_KEY=\S')) { Write-Host "The browser agent types text with a small model: put an OpenRouter key after TEXT_MODEL_API_KEY= in $jev\.env (TypeSafe's key is the app's own)." -ForegroundColor Yellow }
  } catch { Write-Host "The browser agent is not ready ($($_.Exception.Message)); the app runs without it meanwhile." -ForegroundColor Yellow }
}

# Paperclip (shared/paperclip.ts): started in the background on http://127.0.0.1:3100 (the first time: its onboarding, trusted local
# mode, its own database), then this app joins its company once (node scripts/paperclip.ts connect).
if ($withPaperclip) {
  try {
    $up = { try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3100/api/health' -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }
    if (-not (& $up)) {
      $first = -not (Test-Path (Join-Path $HOME '.paperclip\instances\default\config.json'))
      Say "Starting Paperclip$(if ($first) { ' (the first time: its setup and database, a minute or two)' })"
      $log = Join-Path $HOME '.jauvex\paperclip.log'; New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
      $pcArgs = if ($first) { @('-y', 'paperclipai@latest', 'onboard', '--yes', '--no-install-service') } else { @('-y', 'paperclipai@latest', 'run') }
      Start-Process -FilePath 'npx.cmd' -ArgumentList $pcArgs -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" | Out-Null
      for ($i = 0; $i -lt 90 -and -not (& $up); $i++) { Start-Sleep 2 }
    }
    if (& $up) {
      $st = node (Join-Path $dir 'scripts\paperclip.ts') status | ConvertFrom-Json
      if (-not $st.connected) { node (Join-Path $dir 'scripts\paperclip.ts') connect; if ($LASTEXITCODE -eq 2) { node (Join-Path $dir 'scripts\paperclip.ts') connect --company 'Jauvex' } } # a fresh Paperclip has no company yet
      Say 'Paperclip is running: http://127.0.0.1:3100 (the Paperclip item in the sidebar)'
    } else { Write-Host "Paperclip did not come up; its log: $HOME\.jauvex\paperclip.log" -ForegroundColor Yellow }
  } catch { Write-Host "Paperclip is not ready ($($_.Exception.Message)); the app runs without it meanwhile." -ForegroundColor Yellow }
}

# Claude and Codex themselves come with npm install; their command lines are only for signing in (the app signs no one in).
$signIn = @{ claude = 'npm install -g @anthropic-ai/claude-code, then: claude auth login'; codex = 'npm install -g @openai/codex, then: codex login'; zcode = 'run this script again without JAUVEX_ZCODE=0' }
foreach ($p in $signIn.Keys) { if (-not (Has $p)) { Write-Host "No $p command here. To use its sessions: $($signIn[$p])" -ForegroundColor Yellow } }
if (Has 'zcode') { Write-Host 'ZCode needs a model to run on: sign in once, in a new PowerShell, with  zcode login zai  (or open  zcode  and add a provider with an API key).' -ForegroundColor Yellow }
if ($env:JAUVEX_NO_START -eq '1') { Say "Ready in $dir (not started: JAUVEX_NO_START)"; return }
Say 'Starting the app: the browser opens on it. Ctrl+C here stops it.'
npm.cmd run web
