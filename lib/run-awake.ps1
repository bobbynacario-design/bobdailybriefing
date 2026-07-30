# Keep-awake wrapper for scheduled Node refreshes.
#
# On this Modern Standby (S0) laptop, WakeToRun wakes the machine to run a task,
# but during a long network wait (e.g. radar's multi-minute OpenAI catalyst step)
# nothing marks the system as "required awake", so the OS dozes back to low power
# and terminates the process (Task Scheduler LastResult 0x40010004) before it can
# write its Firestore doc. This wrapper holds the system awake with
# SetThreadExecutionState for the whole run, then releases it, so the refresh
# actually finishes.
#
# Usage (from a scheduled task action):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<repo>\lib\run-awake.ps1" `
#     -Dir "<repo>\radar" -Script refresh-radar.js -Log refresh.log
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Script,
  [string]$Log = 'refresh.log'
)

Add-Type -Name Power -Namespace Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = [uint32]'0x80000000'
$ES_SYSTEM_REQUIRED = [uint32]'0x00000001'
[void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

try {
  Set-Location -LiteralPath $Dir
  $node = $null
  try { $node = (Get-Command node.exe -ErrorAction Stop).Source } catch { }
  if (-not $node) { $node = 'C:\nvm4w\nodejs\node.exe' }
  # Run through cmd.exe so the >> append + 2>&1 redirect behaves exactly like the
  # original task action (avoids PowerShell 5.1 wrapping native stderr as errors).
  & cmd.exe /c "`"$node`" $Script >> `"$Log`" 2>&1"
  exit $LASTEXITCODE
} finally {
  # Release the awake request so the machine can sleep normally again.
  [void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
}
