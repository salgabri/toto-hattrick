[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$At = '07:17',
    [ValidateSet('Daily', 'Weekly')]
    [string]$Frequency = 'Weekly',
    [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
    [string]$DayOfWeek = 'Monday',
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$archiveRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$archiveNode = (Get-Command node.exe -ErrorAction Stop).Source
$archiveNpmCli = Join-Path (Split-Path -Parent $archiveNode) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $archiveNpmCli -PathType Leaf)) {
    throw 'The selected Node installation does not include npm; install Node with npm before registering the task.'
}
$archiveRunner = Join-Path $archiveRepo 'scripts\run-local-update.mjs'
$archiveTaskName = 'Toto Hattrick archive update'
$archiveTime = [DateTime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$archiveArguments = '"' + $archiveRunner + '"'
if ($Publish) { $archiveArguments += ' --publish' }

if (Get-ScheduledTask -TaskName $archiveTaskName -ErrorAction SilentlyContinue) {
    throw 'This task already exists. Review or remove it in Task Scheduler before registering a replacement.'
}
$archiveAction = New-ScheduledTaskAction -Execute $archiveNode -Argument $archiveArguments -WorkingDirectory $archiveRepo
if ($Frequency -eq 'Weekly') {
    $archiveTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $DayOfWeek -At $archiveTime
    $archiveSchedule = "weekly on $DayOfWeek at $At"
} else {
    $archiveFirstRun = [DateTime]::Today.Add($archiveTime.TimeOfDay)
    if ($archiveFirstRun -le (Get-Date)) { $archiveFirstRun = $archiveFirstRun.AddDays(1) }
    $archiveTrigger = New-ScheduledTaskTrigger -Daily -At $archiveFirstRun
    $archiveSchedule = "daily at $At"
}
$archiveSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 120)
# InteractiveToken requires no saved password and runs only while this account is logged in.
# StartWhenAvailable catches missed starts on the next logged-in opportunity; it cannot run
# while the computer is off. Cloud scheduling is a separate opt-in in the runbook.
$archiveIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$archivePrincipal = New-ScheduledTaskPrincipal -UserId $archiveIdentity -LogonType Interactive -RunLevel Limited
if ($PSCmdlet.ShouldProcess($archiveTaskName, "Register a $archiveSchedule local archive update")) {
    Register-ScheduledTask -TaskName $archiveTaskName -Action $archiveAction -Trigger $archiveTrigger -Settings $archiveSettings -Principal $archivePrincipal -Description 'Refresh the private archive, commit validated public data, merge it through GitHub, and let Vercel deploy main.' | Out-Null
    Write-Output "Registered '$archiveTaskName' $archiveSchedule local time. Git/Vercel publication: $Publish. The computer must be on and this account logged in."
}
