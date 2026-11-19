param(
  [int]$Port = 55433
)

$ErrorActionPreference = 'Stop'
$ContainerName = 'sxs-paddle-rehearsal-' + [guid]::NewGuid().ToString('N')
$password = 'sxs_disposable_only'
$database = 'paddle_scratch'
$url = "postgresql://postgres:${password}@127.0.0.1:${Port}/${database}?schema=public"

function Assert-Scratch([string]$candidate) {
  if ($candidate -ne $url) { throw 'Refusing to operate outside the disposable PostgreSQL guard' }
}

$null = & $env:ComSpec /d /c 'docker version >nul 2>nul'
if ($LASTEXITCODE -ne 0) {
  Write-Output 'BLOCKED: Docker daemon unavailable; no database operation was attempted.'
  exit 2
}

$containerStarted = $false
try {
  docker run -d --name $ContainerName -e "POSTGRES_PASSWORD=$password" -e "POSTGRES_DB=$database" -p "127.0.0.1:${Port}:5432" postgres:17
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start disposable PostgreSQL' }
  $containerStarted = $true

  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    docker exec $ContainerName psql -U postgres -d $database -tAc 'select pg_postmaster_start_time()' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready' }

  Assert-Scratch $url
  $env:DATABASE_URL = $url
  $env:DIRECT_URL = $url

  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Migration deploy failed' }
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Repeat migration deploy failed' }

  Write-Output 'PASS: disposable migrations applied and repeated; connection details were not emitted.'
}
finally {
  if ($containerStarted) {
    $null = & $env:ComSpec /d /c "docker rm -f $ContainerName >nul 2>nul"
  }
}
