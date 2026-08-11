param(
  [ValidateSet('all', 'nba', 'pba', 'tennis')]
  [string]$Module = 'all',
  [switch]$PublishLegacy
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here ("refresh-{0}.log" -f $Module)

# Keep five 5 MiB local logs. Full data documents are no longer printed, but a
# bounded fallback log remains useful when this compatibility runner is used.
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -ge 5MB) {
  for ($logIndex = 4; $logIndex -ge 1; $logIndex--) {
    $sourceLog = if ($logIndex -eq 1) { $log } else { "$log.$($logIndex - 1)" }
    $targetLog = "$log.$logIndex"
    if (Test-Path -LiteralPath $sourceLog) {
      Move-Item -LiteralPath $sourceLog -Destination $targetLog -Force
    }
  }
}

Set-Location $here

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
"`n===== Sports refresh $stamp =====" | Out-File -FilePath $log -Encoding utf8 -Append

$node = (Get-Command node.exe -ErrorAction Stop).Source

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node
$psi.Arguments = 'refresh-sports.js --module ' + $Module
$psi.WorkingDirectory = $here
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()

if ($stdout) { $stdout | Out-File -FilePath $log -Encoding utf8 -Append }
if ($stderr) { $stderr | Out-File -FilePath $log -Encoding utf8 -Append }

# Legacy escape hatch only. Managed refresh-sports.yml now publishes a Pages
# artifact without committing generated data to main.
if ($proc.ExitCode -eq 0 -and $PublishLegacy) {
  try {
    $repo = Split-Path -Parent $here
    Push-Location $repo
    $changed = git status --porcelain sports-public.json
    if ($changed) {
      git add sports-public.json | Out-File -FilePath $log -Encoding utf8 -Append
      git commit -m "chore(sports): refresh public mirror" | Out-File -FilePath $log -Encoding utf8 -Append
      git push | Out-File -FilePath $log -Encoding utf8 -Append
    } else {
      "public mirror unchanged - no commit" | Out-File -FilePath $log -Encoding utf8 -Append
    }
    Pop-Location
  } catch { "git publish failed: $_" | Out-File -FilePath $log -Encoding utf8 -Append }
}

exit $proc.ExitCode
