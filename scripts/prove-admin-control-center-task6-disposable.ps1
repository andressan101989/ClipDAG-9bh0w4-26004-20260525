param(
  [string]$PgBin = 'D:\CodexTemp\postgres-17.11-disposable\pgsql\bin',
  [switch]$ExpectMigrationFailure
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tempRoot = (Resolve-Path 'D:\CodexTemp').Path
$nonce = [guid]::NewGuid().ToString('N')
$clusterRoot = Join-Path $tempRoot "control-center-task6-fix1-$nonce"
$dataDir = Join-Path $clusterRoot 'data'
$phase = if ($ExpectMigrationFailure) { 'red' } else { 'green' }
$evidenceDir = Join-Path $repoRoot ".superpowers\sdd\2026-10-30-superuser-control-center\task-6-fix1-disposable-$phase"
$null = New-Item -ItemType Directory -Path $clusterRoot
$null = New-Item -ItemType Directory -Path $evidenceDir -Force
Set-Content -LiteralPath (Join-Path $clusterRoot 'task6-only.marker') -Value $nonce
$priorPg = @{}
foreach ($entry in Get-ChildItem Env: | Where-Object Name -Like 'PG*') {
  $priorPg[$entry.Name] = $entry.Value
  Remove-Item -LiteralPath "Env:$($entry.Name)"
}
$env:PGHOST = '127.0.0.1'
$env:PGHOSTADDR = '127.0.0.1'
$env:PGSSLMODE = 'disable'
$env:PGCONNECT_TIMEOUT = '3'
$env:PGCLIENTENCODING = 'UTF8'
$started = $false
$startAttempted = $false
$dbCreated = $false
$dropped = $false
$stopped = $true
$removed = $false
$port = 0
$script:toolCounter = 0
function Read-SharedText([string]$Path) {
  $stream = [IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  $reader = [IO.StreamReader]::new($stream)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Invoke-PgTool([string]$Name, [string[]]$Arguments, [switch]$AllowFailure) {
  $script:toolCounter++
  $stdout = Join-Path $evidenceDir "$($script:toolCounter)-$Name.out"
  $stderr = Join-Path $evidenceDir "$($script:toolCounter)-$Name.err"
  # Start-Process -Wait waits for the entire Windows child tree. Instead wait
  # only for the tool process; PostgreSQL intentionally remains running.
  $quoted = foreach ($argument in $Arguments) { '"' + ($argument -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
  $process = Start-Process -FilePath (Join-Path $PgBin "$Name.exe") -ArgumentList ($quoted -join ' ') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if (-not $process.WaitForExit(40000)) { throw "$Name exceeded the 40-second tool bound" }
  $code = $process.ExitCode
  $outText = Read-SharedText $stdout
  $errText = Read-SharedText $stderr
  $message = ("$outText$errText").Trim()
  $process.Dispose()
  Write-Host "$Name exit=$code"
  if ($message) { Write-Host $message }
  if ($code -ne 0 -and -not $AllowFailure) { throw "$Name failed with exit $code" }
  return [pscustomobject]@{ ExitCode = $code; Output = $message }
}
try {
  $null = Invoke-PgTool 'postgres' @('--version')
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  Write-Host "Task6-only fresh cluster: $clusterRoot; loopback port=$port"
  $null = Invoke-PgTool 'initdb' @('-D', $dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C')
  $startAttempted = $true
  $null = Invoke-PgTool 'pg_ctl' @('-D', $dataDir, '-l', (Join-Path $evidenceDir 'server.log'), '-o', "-h 127.0.0.1 -p $port", '-w', '-t', '20', 'start')
  $started = $true
  $stopped = $false
  $dbCreated = $true
  $null = Invoke-PgTool 'createdb' @('--no-password', '-h', '127.0.0.1', '-p', "$port", '-U', 'postgres', 'task6fix1')
  $connection = @('-X', '--no-password', '-h', '127.0.0.1', '-p', "$port", '-U', 'postgres', '-d', 'task6fix1', '-v', 'ON_ERROR_STOP=1')
  $null = Invoke-PgTool 'psql' ($connection + @('-f', (Join-Path $repoRoot 'tests\fixtures\adminControlCenterTask6Predecessor.sql')))
  $migration = Invoke-PgTool 'psql' ($connection + @('-f', (Join-Path $repoRoot 'supabase\migrations\20261031032022_superuser_control_center_overview.sql'))) -AllowFailure
  if ($ExpectMigrationFailure) {
    if ($migration.ExitCode -eq 0 -or $migration.Output -notmatch 'v_rows.*not a known variable') {
      throw 'Expected the original undeclared-v_rows PostgreSQL compilation failure'
    }
    $rollback = "select task6_proof.assert(to_regprocedure('public.get_admin_control_center_overview_v1(text,date,date)') is null,'failed migration rolls back overview'); select task6_proof.assert(to_regprocedure('public.search_admin_advertising_ads(text,integer)') is not null,'failed migration restores predecessor review identity'); select task6_proof.assert(task6_proof.row_snapshot()=(select snapshot from task6_proof.baseline),'failed migration preserves every domain row'); select 'EXPECTED TASK6 RED: undeclared variables rejected and transaction rolled back';"
    $null = Invoke-PgTool 'psql' ($connection + @('-c', $rollback))
  } else {
    if ($migration.ExitCode -ne 0) { throw 'Full focal migration did not apply' }
    $null = Invoke-PgTool 'psql' ($connection + @('-f', (Join-Path $repoRoot 'tests\fixtures\adminControlCenterTask6Assertions.sql')))
  }
} finally {
  try {
    if ($startAttempted) {
      $initialStatus = Invoke-PgTool 'pg_ctl' @('-D', $dataDir, 'status') -AllowFailure
      if ($initialStatus.ExitCode -eq 3) { $stopped = $true }
      elseif ($initialStatus.ExitCode -ne 0) { throw 'Unable to establish disposable cluster status' }
      else {
      try {
        if ($dbCreated) {
          $null = Invoke-PgTool 'dropdb' @('--no-password', '-h', '127.0.0.1', '-p', "$port", '-U', 'postgres', '--maintenance-db=postgres', '--if-exists', 'task6fix1')
          $dropped = $true
        }
      } finally {
        $null = Invoke-PgTool 'pg_ctl' @('-D', $dataDir, '-w', '-t', '20', '-m', 'fast', 'stop')
        $status = Invoke-PgTool 'pg_ctl' @('-D', $dataDir, 'status') -AllowFailure
        $stopped = $status.ExitCode -eq 3
        if (-not $stopped) { throw 'Refusing to remove a cluster without a stopped-server check' }
      }
      }
    }
    # Retain the stopped cluster directory as local evidence. Automatic review
    # rejected recursive deletion of the first stopped Task6 directory.
    $resolved = (Resolve-Path -LiteralPath $clusterRoot).Path
    if ([IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or
        -not [IO.Path]::GetFileName($resolved).StartsWith('control-center-task6-fix1-') -or
        (Get-Content -LiteralPath (Join-Path $resolved 'task6-only.marker') -Raw).Trim() -ne $nonce -or
        -not $stopped) { throw 'Task6 cluster cleanup target validation failed' }
    Write-Host "Retained stopped Task6-only cluster directory: $resolved"
  } finally {
    foreach ($entry in Get-ChildItem Env: | Where-Object Name -Like 'PG*') { Remove-Item -LiteralPath "Env:$($entry.Name)" }
    foreach ($name in $priorPg.Keys) { Set-Item -LiteralPath "Env:$name" -Value $priorPg[$name] }
    $cleanup = [ordered]@{ Cluster = $clusterRoot; Port = $port; DatabaseDropped = $dropped; ServerStopped = $stopped; DirectoryRemoved = $removed }
    $cleanup | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceDir 'cleanup.json')
    Write-Host ('CLEANUP: ' + ($cleanup | ConvertTo-Json -Compress))
  }
}
