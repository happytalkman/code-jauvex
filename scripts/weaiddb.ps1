# WEAIDdb (github.com/happytalkman/WEAIDdb, a fork of HydraDB: a graph database, AGPL-3.0) beside the app, as a Docker container: its own
# Dockerfile builds the image from the fork, and the container runs one plaintext development node on this machine only (127.0.0.1), its
# data and token in <home>\.jauvex\weaiddb. The agents reach it with scripts/graph.ts and the graph_query tool (shared/graph.ts).
# Docker Desktop is the user's to install (it needs an administrator and WSL 2); this script says so when it is missing.
#   powershell -File scripts/weaiddb.ps1 setup    get or update the fork, build the image when the fork moved (the first build: 15-30 min)
#   powershell -File scripts/weaiddb.ps1 start    start the container (setup first when there is no image), wait until it is ready
#   powershell -File scripts/weaiddb.ps1 stop | status
# WEAIDDB_DIR moves the clone (<home>\weaiddb), WEAIDDB_REPO/WEAIDDB_BRANCH pick the source, WEAIDDB_HOME the data (<home>\.jauvex\weaiddb).
param([string]$Command = 'status')
$ErrorActionPreference = 'Stop'
$repo = if ($env:WEAIDDB_REPO) { $env:WEAIDDB_REPO } else { 'https://github.com/happytalkman/WEAIDdb' }
$dir = if ($env:WEAIDDB_DIR) { $env:WEAIDDB_DIR } else { Join-Path $HOME 'weaiddb' }
$data = if ($env:WEAIDDB_HOME) { $env:WEAIDDB_HOME } else { Join-Path (Join-Path $HOME '.jauvex') 'weaiddb' }
$image = 'weaiddb:local'; $name = 'weaiddb'
function Say($t) { Write-Host "== $t" -ForegroundColor Cyan }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Docker-Ok { if (-not (Has 'docker')) { return $false }; $ErrorActionPreference = 'Continue'; docker info *> $null; return $LASTEXITCODE -eq 0 }
function Need-Docker { if (-not (Docker-Ok)) { Write-Host 'WEAIDdb runs in Docker, and Docker is not running here. Install Docker Desktop (https://www.docker.com/products/docker-desktop/, it asks for an administrator and WSL 2), start it, then run this again.' -ForegroundColor Yellow; exit 1 } }
function Ready { try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9090/readyz' -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }
function Built { $ErrorActionPreference = 'Continue'; $l = docker image inspect $image --format '{{ index .Config.Labels "weaiddb.commit" }}' 2>$null; if ($LASTEXITCODE) { '' } else { "$l".Trim() } }

function Setup {
  Need-Docker
  if (-not (Test-Path (Join-Path $dir 'Dockerfile'))) { Say "Getting WEAIDdb into $dir"; git clone --depth 1 $(if ($env:WEAIDDB_BRANCH) { @('-b', $env:WEAIDDB_BRANCH) }) $repo $dir; if ($LASTEXITCODE) { throw 'git clone of WEAIDdb failed' } }
  else { Say 'Bringing WEAIDdb up to date'; git -C $dir pull --ff-only; if ($LASTEXITCODE) { Write-Host 'Could not update WEAIDdb: building the copy as it is.' -ForegroundColor Yellow } }
  $head = (git -C $dir rev-parse HEAD).Trim()
  if ((Built) -eq $head) { Say "The image is built from $($head.Substring(0, 7))"; return }
  Say "Building the WEAIDdb image from $($head.Substring(0, 7)) (its own Dockerfile; the first build takes 15-30 minutes)"
  docker build --label "weaiddb.commit=$head" -t $image $dir; if ($LASTEXITCODE) { throw 'docker build failed (see above)' }
}

function Start-Node {
  Need-Docker
  if (Ready) { Say 'WEAIDdb is running: http://127.0.0.1:8443 (Bolt 127.0.0.1:7687)'; return }
  if (-not (Built)) { Setup }
  foreach ($d in @($data, (Join-Path $data 'store'), (Join-Path $data 'cache'))) { New-Item -ItemType Directory -Force $d | Out-Null }
  $tokenFile = Join-Path $data 'auth-token'
  if (-not (Test-Path $tokenFile)) { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); Set-Content -Path $tokenFile -Value (($b | ForEach-Object { $_.ToString('x2') }) -join '') -Encoding ascii -NoNewline } # this machine's own: the node reads it, graph.ts sends it
  $ErrorActionPreference = 'Continue'; docker rm -f $name *> $null; $ErrorActionPreference = 'Stop'
  $user = if ($IsLinux -or $IsMacOS) { @('--user', "$(id -u):$(id -g)") } else { @() } # a bind mount on Linux is the host user's; Docker Desktop maps it
  Say 'Starting WEAIDdb'
  docker run -d --name $name --restart unless-stopped @user -p 127.0.0.1:7687:7687 -p 127.0.0.1:8443:8443 -p 127.0.0.1:9090:9090 -v "${data}:/data" `
    -e CLOUD_PROVIDER=local -e LOCAL_PATH=/data/store -e GRAPH_NAMESPACE=default -e GRAPH_ID=default -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 `
    -e GRAPH_NODE_ID=node-0 -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 -e GRAPH_DATA_CACHE_DIR=/data/cache `
    -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 $image | Out-Null
  if ($LASTEXITCODE) { throw 'docker run failed (see above)' }
  for ($i = 0; $i -lt 60 -and -not (Ready); $i++) { Start-Sleep 1 }
  if (Ready) { Say 'WEAIDdb is ready: http://127.0.0.1:8443 (Bolt 127.0.0.1:7687); the agents reach it with scripts/graph.ts' }
  else { Write-Host 'WEAIDdb did not become ready in a minute. Its log:' -ForegroundColor Yellow; docker logs --tail 40 $name; exit 1 }
}

switch ($Command) {
  'setup' { Setup }
  'start' { Start-Node }
  'stop' { Need-Docker; $ErrorActionPreference = 'Continue'; docker rm -f $name *> $null; Say 'WEAIDdb is stopped (its data stays in the data folder)' }
  'status' { if (Ready) { Say 'WEAIDdb is running: http://127.0.0.1:8443' } elseif (-not (Docker-Ok)) { Say 'WEAIDdb: Docker is not running here' } else { Say "WEAIDdb is not running (image: $(if (Built) { 'built' } else { 'not built yet' }))" } }
  default { Write-Host 'usage: scripts/weaiddb.ps1 setup | start | stop | status'; exit 2 }
}
