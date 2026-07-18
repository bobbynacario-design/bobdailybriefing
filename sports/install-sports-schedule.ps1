param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('nba', 'pvl')]
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
} else {
  $taskName = 'BobDailyBriefing-NbaRefresh'
  $triggers = @((New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '09:00'))
  $description = 'NBA offseason refresh each Sunday at 09:00 PHT. Replace with in-season cadence when the schedule resumes.'
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Description $description -Force | Out-Null
Write-Host ("Installed {0}. Successful validation days: {1}." -f $taskName, ($successfulDays -join ', '))
