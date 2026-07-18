param(
  [ValidateSet('all', 'nba', 'pvl')]
  [string]$Module = 'all',
  [switch]$NoPublish
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here ("refresh-{0}.log" -f $Module)

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

# Publish the public mirror (sports-public.json) to GitHub Pages so the
# no-sign-in shared page (sports.html) stays current. Best-effort: the Firestore
# write already succeeded, so a git failure here never breaks the refresh.
if ($proc.ExitCode -eq 0 -and -not $NoPublish) {
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
