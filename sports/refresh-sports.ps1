$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'refresh.log'

Set-Location $here

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
"`n===== Sports refresh $stamp =====" | Out-File -FilePath $log -Encoding utf8 -Append

$node = (Get-Command node.exe -ErrorAction Stop).Source

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node
$psi.Arguments = 'refresh-sports.js'
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

exit $proc.ExitCode
