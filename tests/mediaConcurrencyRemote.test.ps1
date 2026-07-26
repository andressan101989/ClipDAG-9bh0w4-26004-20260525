param(
  [string]$Workspace = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$assetA = [guid]::NewGuid().ToString()
$assetB = [guid]::NewGuid().ToString()
$runDir = Join-Path $env:TEMP ("clipdag-r2-concurrency-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $runDir | Out-Null

function Write-Sql([string]$name, [string]$content) {
  $path = Join-Path $runDir $name
  [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
  return $path
}

function Start-Query([string]$file, [string]$outName) {
  $stdout = Join-Path $runDir "$outName.out"
  $stderr = Join-Path $runDir "$outName.err"
  $process = Start-Process -FilePath 'npx.cmd' `
    -ArgumentList @('supabase','db','query','--linked','--file',$file) `
    -WorkingDirectory $Workspace -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  return @{ Process=$process; Stdout=$stdout; Stderr=$stderr }
}

function Invoke-Query([string]$file, [string]$outName) {
  $run = Start-Query $file $outName
  $run.Process.WaitForExit()
  $run.Process.Refresh()
  return $run
}

try {
  $setup = Write-Sql 'setup.sql' @"
insert into public.media_assets(
  id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
  mime_type,size_bytes,status,ready_at,public_url
)
select '$assetA',id,'r2','image','post_image','public','clipdag-public-media',
       'diagnostics/$assetA.jpg','image/jpeg',1,'ready',now(),
       'https://diagnostics.invalid/$assetA'
from public.user_profiles order by created_at limit 1;
insert into public.media_assets(
  id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
  mime_type,size_bytes,status,ready_at,public_url
)
select '$assetB',id,'r2','image','post_image','public','clipdag-public-media',
       'diagnostics/$assetB.jpg','image/jpeg',1,'ready',now(),
       'https://diagnostics.invalid/$assetB'
from public.user_profiles order by created_at limit 1;
"@
  $setupRun = Invoke-Query $setup 'setup'
  if ((Get-Content -LiteralPath $setupRun.Stdout -Raw) -notmatch '"rows"') {
    $setupError = Get-Content -LiteralPath $setupRun.Stderr -Raw
    $setupOutput = Get-Content -LiteralPath $setupRun.Stdout -Raw
    throw "concurrency_setup_failed: $setupError $setupOutput"
  }

  # Creation holds the asset row lock. Deletion must wait and then see the link.
  $createFirst = Write-Sql 'create-first.sql' @"
begin;
select set_config('request.jwt.claim.sub',(select owner_id::text from public.media_assets where id='$assetA'),true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.create_photo_post_with_media('concurrency diagnostic','Sin musica','$assetA');
select pg_sleep(5);
commit;
"@
  $deleteSecond = Write-Sql 'delete-second.sql' @"
select public.schedule_media_asset_deletion(
  '$assetA',(select owner_id from public.media_assets where id='$assetA')
) as result;
"@
  $a = Start-Query $createFirst 'create-first'
  Start-Sleep -Seconds 1
  $b = Start-Query $deleteSecond 'delete-second'
  $a.Process.WaitForExit()
  $b.Process.WaitForExit()
  $a.Process.Refresh()
  $b.Process.Refresh()
  if ((Get-Content -LiteralPath $a.Stdout -Raw) -notmatch '"rows"' -or
      (Get-Content -LiteralPath $b.Stdout -Raw) -notmatch '"rows"') {
    throw 'create_first_process_failed'
  }
  if ((Get-Content -LiteralPath $b.Stdout -Raw) -notmatch 'asset_in_use') {
    throw 'create_first_did_not_protect_asset'
  }

  # Deletion holds the asset row lock. Creation must wait, then reject non-ready.
  $deleteFirst = Write-Sql 'delete-first.sql' @"
begin;
select public.schedule_media_asset_deletion(
  '$assetB',(select owner_id from public.media_assets where id='$assetB')
);
select pg_sleep(5);
commit;
"@
  $createSecond = Write-Sql 'create-second.sql' @"
begin;
select set_config('request.jwt.claim.sub',(select owner_id::text from public.media_assets where id='$assetB'),true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.create_photo_post_with_media('must rollback','Sin musica','$assetB');
commit;
"@
  $b2 = Start-Query $deleteFirst 'delete-first'
  Start-Sleep -Seconds 1
  $a2 = Start-Query $createSecond 'create-second'
  $b2.Process.WaitForExit()
  $a2.Process.WaitForExit()
  $b2.Process.Refresh()
  $a2.Process.Refresh()
  if ((Get-Content -LiteralPath $b2.Stdout -Raw) -notmatch '"rows"') {
    throw 'delete_first_process_failed'
  }
  $createError = (Get-Content -LiteralPath $a2.Stderr -Raw) +
    (Get-Content -LiteralPath $a2.Stdout -Raw)
  if ($createError -notmatch 'asset_not_ready_or_owned') {
    throw 'delete_first_did_not_reject_creation'
  }

  $verify = Write-Sql 'verify.sql' @"
select
  (select count(*) from public.media_asset_links where asset_id='$assetA') as linked_after_create_first,
  (select status from public.media_assets where id='$assetA') as status_after_create_first,
  (select count(*) from public.media_asset_links where asset_id='$assetB') as links_after_delete_first,
  (select status from public.media_assets where id='$assetB') as status_after_delete_first;
delete from public.videos where caption in ('concurrency diagnostic','must rollback');
delete from public.media_asset_links where asset_id in ('$assetA','$assetB');
delete from public.media_assets where id in ('$assetA','$assetB');
"@
  $verifyRun = Invoke-Query $verify 'verify'
  if ((Get-Content -LiteralPath $verifyRun.Stdout -Raw) -notmatch '"rows"') {
    throw 'concurrency_verify_failed'
  }
  $verifyOutput = Get-Content -LiteralPath $verifyRun.Stdout -Raw
  if ($verifyOutput -notmatch '"linked_after_create_first": 1' -or
      $verifyOutput -notmatch '"status_after_create_first": "ready"' -or
      $verifyOutput -notmatch '"links_after_delete_first": 0' -or
      $verifyOutput -notmatch '"status_after_delete_first": "delete_pending"') {
    throw 'concurrency_postconditions_failed'
  }
  Write-Output 'CREATE_FIRST=PASS DELETE_FIRST=PASS ZERO_INVALID_LINKS=PASS'
}
finally {
  # Best-effort cleanup if an assertion interrupts the test.
  $cleanup = Write-Sql 'cleanup.sql' @"
delete from public.videos where caption in ('concurrency diagnostic','must rollback');
delete from public.media_asset_links where asset_id in ('$assetA','$assetB');
delete from public.media_assets where id in ('$assetA','$assetB');
"@
  $cleanupRun = Invoke-Query $cleanup 'cleanup'
  Remove-Item -LiteralPath $runDir -Recurse -Force
}
