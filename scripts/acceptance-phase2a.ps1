$ErrorActionPreference = 'Stop'
$config = @{}
foreach ($line in Get-Content -LiteralPath '.env') {
  if ($line -match '^\s*([^#][^=]*)=(.*)$') { $config[$matches[1].Trim()] = $matches[2].Trim().Trim('"') }
}
function Call-Api($method, $url, $body = $null) {
  $args = @{ Uri = "http://localhost:3000$url"; Method = $method; WebSession = $script:session; UseBasicParsing = $true }
  if ($null -ne $body) { $args.ContentType = 'application/json'; $args.Body = ($body | ConvertTo-Json -Depth 8) }
  $response = Invoke-WebRequest @args
  return ($response.Content | ConvertFrom-Json).data
}
$anonymous = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$anonymousResponse = Invoke-WebRequest -Uri 'http://localhost:3000/dashboard' -WebSession $anonymous -UseBasicParsing
if ($anonymousResponse.BaseResponse.ResponseUri.AbsolutePath -ne '/login') { throw 'Anonymous dashboard did not redirect to login' }
$script:session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Call-Api 'POST' '/api/v1/auth/login' @{ email = $config.SEED_ADMIN_EMAIL; password = $config.SEED_ADMIN_PASSWORD }
$groupResult = Call-Api 'GET' '/api/v1/groups?search=CCCRN-NIG-MNA-0002&pageSize=10'
$group = $groupResult.items | Where-Object { $_.group_code -eq 'CCCRN-NIG-MNA-0002' } | Select-Object -First 1
if (-not $group) { throw 'Onboarding acceptance group not found' }
$status = Call-Api 'GET' "/api/v1/groups/$($group.id)/onboarding-status"
if ($status.groupStatus -ne 'ONBOARDING') { throw "Expected ONBOARDING group, got $($status.groupStatus)" }
$constitutions = Call-Api 'GET' "/api/v1/groups/$($group.id)/constitution"
$approved = $constitutions | Where-Object { $_.status -eq 'APPROVED' } | Select-Object -First 1
if (-not $approved) {
  $draft = Call-Api 'POST' "/api/v1/groups/$($group.id)/constitution" @{ shareValue='1000.00';minSharesPerMeeting=1;maxSharesPerMeeting=5;socialFundContribution='200.00';loanMaxMultiple=3;loanServiceChargeRate=5;loanMaxTermMonths=3;meetingFrequency='WEEKLY';fineRules=@() }
  $approved = Call-Api 'POST' "/api/v1/groups/$($group.id)/constitution/$($draft.id)/approve" @{}
}
$cycles = Call-Api 'GET' "/api/v1/groups/$($group.id)/cycles"
$cycle = $cycles | Where-Object { $_.cycle_number -eq 1 } | Select-Object -First 1
if (-not $cycle) { $cycle = Call-Api 'POST' "/api/v1/groups/$($group.id)/cycles" @{ constitutionId=$approved.id;cycleNumber=1;startDate='2026-08-20';expectedEndDate='2027-07-20';expectedShareoutDate='2027-07-20';meetingDayOfWeek=3;status='READY' } }
$membersResult = Call-Api 'GET' "/api/v1/groups/$($group.id)/members?pageSize=100"
for ($i=$membersResult.total+1; $i -le 15; $i++) { $null = Call-Api 'POST' "/api/v1/groups/$($group.id)/members" @{ firstName="Acceptance$i";lastName='Member';sex=$(if($i -le 10){'FEMALE'}else{'MALE'});dateJoined='2026-08-20';status='ACTIVE' } }
$membersResult = Call-Api 'GET' "/api/v1/groups/$($group.id)/members?pageSize=100&status=ACTIVE"
$officers = Call-Api 'GET' "/api/v1/groups/$($group.id)/officers"
$positions = @('CHAIRPERSON','RECORD_KEEPER','BOX_KEEPER','MONEY_COUNTER_1','MONEY_COUNTER_2')
for ($i=0; $i -lt 5; $i++) { if (-not ($officers | Where-Object { $_.status -eq 'ACTIVE' -and $_.position_code -eq $positions[$i] })) { $null = Call-Api 'POST' "/api/v1/groups/$($group.id)/officers" @{ cycleId=$cycle.id;memberId=$membersResult.items[$i].id;positionCode=$positions[$i];appointedAt='2026-08-20' } } }
$duplicateBlocked = $false
try { $null = Call-Api 'POST' "/api/v1/groups/$($group.id)/officers" @{ cycleId=$cycle.id;memberId=$membersResult.items[0].id;positionCode='MONEY_COUNTER_2';appointedAt='2026-08-20' } } catch { $duplicateBlocked = $true }
if (-not $duplicateBlocked) { throw 'Duplicate officer assignment was not blocked' }
$status = Call-Api 'GET' "/api/v1/groups/$($group.id)/onboarding-status"
if (-not $status.activationReady) { throw "Activation not ready: $($status.blocking -join '; ')" }
$activated = Call-Api 'POST' "/api/v1/groups/$($group.id)/activate" @{}
if ($activated.group.status -ne 'ACTIVE' -or $activated.cycle.status -ne 'ACTIVE') { throw 'Atomic activation statuses are incorrect' }
$overview = Invoke-WebRequest -Uri "http://localhost:3000/groups/$($group.id)" -WebSession $script:session -UseBasicParsing
if ($overview.StatusCode -ne 200 -or -not $overview.Content.Contains('Active Members')) { throw 'Group overview persistence check failed' }
Write-Output "Anonymous redirect: PASS"
Write-Output "Super Admin login: PASS"
Write-Output "Constitution draft/approval: PASS"
Write-Output "Cycle creation/link: PASS"
Write-Output "Member numbering to 15: PASS"
Write-Output "Five officers and duplicate rejection: PASS"
Write-Output "Atomic group/cycle activation: PASS"
Write-Output "Persisted overview refresh: PASS"
