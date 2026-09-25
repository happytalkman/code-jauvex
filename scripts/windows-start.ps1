# The web version on Windows, from nothing to running, in one command (PowerShell):
#   irm https://raw.githubusercontent.com/happytalkman/code-jauvex/claude/awesome-pasteur-ndvvom/scripts/windows-start.ps1 | iex
# or, in a copy already here: double-click start-windows.cmd. What is missing is installed (Node and Git with winget, the app's packages,
# the voice with npm run voice:setup), what is there is kept, and the app starts (npm run web) and opens the browser. Run it again any time:
# it only does what is still missing, then starts the app. JAUVEX_DIR moves the copy (default: <home>\jauvex), JAUVEX_BRANCH picks the branch,
# JAUVEX_NO_START=1 stops before starting it (the Windows check, .github/workflows/windows.yml).
$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/happytalkman/code-jauvex'
$branch = if ($env:JAUVEX_BRANCH) { $env:JAUVEX_BRANCH } else { 'claude/awesome-pasteur-ndvvom' }
function Say($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "`n$t" -ForegroundColor Red; if (-not $env:CI) { Read-Host 'Press Enter to close' }; exit 1 }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Winget($id, $what) {
  if (-not (Has 'winget')) { Fail "$what is missing and winget is not here to install it. Install $what yourself, then run this again." }
  Say "Installing $what (winget)"; winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

# Node 22.18 or newer: the app's scripts are TypeScript that Node runs as it is.
function Node-Ok { if (-not (Has 'node')) { return $false }; try { [version]((node -v).TrimStart('v')) -ge [version]'22.18.0' } catch { $false } }
if (-not (Node-Ok)) {
  if (Has 'node') { Write-Host "Node $(node -v) is too old: the app needs 22.18 or newer." -ForegroundColor Yellow }
  Winget 'OpenJS.NodeJS.LTS' 'Node.js'
  if (-not (Node-Ok)) { $env:Path = "$env:ProgramFiles\nodejs;$env:Path" } # an older Node earlier on the PATH still answers first
  if (-not (Node-Ok)) { Fail 'Node.js 22.18 or newer is not reachable yet: close this window, open a new PowerShell, run the same command again. (An older Node from nvm or another installer may come first on the PATH.)' }
}
if (-not (Has 'git')) { Winget 'Git.Git' 'Git'; if (-not (Has 'git')) { Fail 'Git was installed but this window does not see it yet: close it, open a new PowerShell, run the same command again.' } }

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

# Claude and Codex themselves come with npm install; their command lines are only for signing in (the app signs no one in).
$signIn = @{ claude = 'npm install -g @anthropic-ai/claude-code, then: claude auth login'; codex = 'npm install -g @openai/codex, then: codex login'; zcode = 'build it from github.com/zai-org/ZCode (pnpm build:zcode) and put zcode on the PATH' }
foreach ($p in $signIn.Keys) { if (-not (Has $p)) { Write-Host "No $p command here. To use its sessions: $($signIn[$p])" -ForegroundColor Yellow } }
if ($env:JAUVEX_NO_START -eq '1') { Say "Ready in $dir (not started: JAUVEX_NO_START)"; return }
Say 'Starting the app: the browser opens on it. Ctrl+C here stops it.'
npm.cmd run web
