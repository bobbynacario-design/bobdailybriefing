param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('nba', 'pvl', 'tennis')]
  [string]$Module,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$historyPath = Join-Path $here 'run-history.json'

if (-not (Test-Path -LiteralPath $historyPath)) {
  throw 'No sports/run-history.json exists. Complete three successful manual refresh days first.'
}

$history = Get-Content -LiteralPath $historyPath -Raw | ConvertFrom-Json
$successfulDays = @($history | Where-Object {
  $_.completedAt -and $_.modules.$Module -and $_.modules.$Module.refreshStatus -eq 'ok'
} | ForEach-Object {
  ([DateTimeOffset]::Parse($_.completedAt).ToOffset([TimeSpan]::FromHours(8))).ToString('yyyy-MM-dd')
} | Sort-Object -Unique)

if (-not $Force -and $successfulDays.Count -lt 3) {
  throw ("Schedule gate blocked for {0}: {1}/3 successful PHT days. Run refresh-sports.ps1 -Module {0} on {2} more distinct day(s)." -f $Module, $successfulDays.Count, (3 - $successfulDays.Count))
}

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$refreshScript = Join-Path $here 'refresh-sports.ps1'
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Module {1}' -f $refreshScript, $Module
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $here

if ($Module -eq 'pvl') {
  $taskName = 'BobDailyBriefing-PvlRefresh'
  $triggers = @(
    (New-ScheduledTaskTrigger -Daily -At '08:00'),
    (New-ScheduledTaskTrigger -Daily -At '21:30')
  )
  $description = 'Official PVL schedule, result, standings and player-leader refresh at 08:00 and 21:30 PHT.'
} elseif ($Module -eq 'tennis') {
  $taskName = 'BobDailyBriefing-TennisRefresh'
  $triggers = @(
    (New-ScheduledTaskTrigger -Daily -At '08:00'),
    (New-ScheduledTaskTrigger -Daily -At '20:00')
  )
  $description = 'ATP/WTA tennis (Grand Slams, Masters 1000, 500s) refresh at 08:00 and 20:00 PHT. Locks and scores per-match projections so the accuracy journal accrues. ESPN feed only, no OpenAI cost.'
} else {
  $taskName = 'BobDailyBriefing-NbaRefresh'
  $triggers = @((New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '09:00'))
  $description = 'NBA offseason refresh each Sunday at 09:00 PHT. Replace with in-season cadence when the schedule resumes.'
}

# Match the hand-fixed settings on the radar/miro/ph tasks. The cmdlet defaults
# are actively wrong for this box: DisallowStartIfOnBatteries and
# StopIfGoingOnBatteries BOTH default to $true, so an unplugged laptop would
# silently skip the run, or kill it mid-flight if it was unplugged while running.
# WakeToRun matters because this is a Modern Standby (S0) machine that is asleep
# at 08:00 / 09:00 — it needs "Allow wake timers" enabled on battery too, which
# is a machine-level power-plan setting, not a task setting.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Description $description -Force | Out-Null
Write-Host ("Installed {0}. Successful validation days: {1}." -f $taskName, ($successfulDays -join ', '))
