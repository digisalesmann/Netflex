# Stop the NetFlex lodge link and remove its startup task. Run as Administrator.
Stop-ScheduledTask -TaskName 'NetFlex Lodge Link' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'NetFlex Lodge Link' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'Removed. Also unpair it in the office: Network -> Lodge link -> Disconnect.'
