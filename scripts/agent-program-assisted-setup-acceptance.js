import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const base = process.env.APP_URL || 'http://localhost:3000';
const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
const password = 'Agent-Setup-Test-2026!';
const results = [];
const proof = {};
let adminCookie;
const pass = (number, scenario, evidence) => results.push({ number, scenario, result: 'PASS', evidence });

async function api(method, path, body, expected = 200, cookie = adminCookie) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-forwarded-for': `127.31.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const json = await response.json().catch(() => ({}));
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) throw new Error(`${method} ${path}: expected ${allowed}, received ${response.status}: ${json.error?.code}/${json.error?.message}`);
  return { status: response.status, data: json.data, error: json.error, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] };
}

async function login(email, secret = password) {
  return (await api('POST', '/api/v1/auth/login', { email, password: secret }, 200, null)).cookie;
}

await db.connect();
try {
  adminCookie = await login(process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD);
  const admin = (await db.query('SELECT organization_id FROM users WHERE lower(email)=lower($1)', [process.env.SEED_ADMIN_EMAIL])).rows[0];
  const scope = (await db.query(`SELECT p.id project_id,s.id state_id,l.id lga_id,(SELECT id FROM communities WHERE lga_id=l.id LIMIT 1) community_id FROM projects p CROSS JOIN states s JOIN lgas l ON l.state_id=s.id WHERE p.organization_id=$1 AND p.status='ACTIVE' AND s.name='Niger' ORDER BY community_id NULLS LAST LIMIT 1`, [admin.organization_id])).rows[0];
  async function makeAgent(name) {
    return (await api('POST', '/api/v1/facilitators', { firstName: name, lastName: 'Setup Agent', email: `setup.${name.toLowerCase()}.${suffix}@example.org`, staffCode: `SETUP-${name}-${suffix}`, password, projectId: scope.project_id, stateId: scope.state_id, lgaId: scope.lga_id, groupIds: [] }, 201)).data.facilitator;
  }
  const grace = await makeAgent('Grace');
  const hope = await makeAgent('Hope');
  const graceCookie = await login(grace.email);
  const hopeCookie = await login(hope.email);
  const groupBody = { name: `Unity Setup Group ${suffix}`, projectId: scope.project_id, stateId: scope.state_id, lgaId: scope.lga_id, communityId: scope.community_id, dateFormed: new Date().toISOString().slice(0, 10), meetingLocation: 'Unity community hall', expectedMemberCount: 20, notes: 'Agent setup acceptance fixture', groupType: 'SUPERVISED', status: 'ACTIVE' };
  const group = (await api('POST', '/api/v1/groups', groupBody, 201, graceCookie)).data;
  const members = [];
  for (let index = 1; index <= 15; index += 1) members.push((await api('POST', `/api/v1/groups/${group.id}/members`, { firstName: `Setup${index}`, lastName: 'Member', sex: index <= 8 ? 'FEMALE' : 'MALE', dateJoined: new Date().toISOString().slice(0, 10), status: 'ACTIVE' }, 201, graceCookie)).data);
  const inactive = (await api('POST', `/api/v1/groups/${group.id}/members`, { firstName: 'Inactive', lastName: 'Member', dateJoined: new Date().toISOString().slice(0, 10), status: 'INACTIVE' }, 201, graceCookie)).data;

  await api('POST', `/api/v1/groups/${group.id}/officers`, { cycleId: crypto.randomUUID(), memberId: members[0].id, positionCode: 'CHAIRPERSON' }, 400, graceCookie);
  pass(8, 'Officer assignment without cycle blocked', 'CYCLE_REQUIRED_FOR_OFFICERS');
  const constitutionBody = { shareValue: '1000.00', minSharesPerMeeting: 1, maxSharesPerMeeting: 5, socialFundContribution: '200.00', loanMaxMultiple: 3, loanServiceChargeRate: 5, loanMaxTermMonths: 3, meetingFrequency: 'WEEKLY', fineRules: [] };
  const constitution = (await api('POST', `/api/v1/groups/${group.id}/constitution`, constitutionBody, 201, graceCookie)).data;
  pass(1, 'Assigned Agent creates constitution draft', constitution.id);
  await api('POST', `/api/v1/groups/${group.id}/constitution/${constitution.id}/approve`, {}, 403, hopeCookie);
  pass(3, 'Foreign Agent constitution approval', 'HTTP 403');
  const approved = (await api('POST', `/api/v1/groups/${group.id}/constitution/${constitution.id}/approve`, {}, 200, graceCookie)).data;
  if (approved.status !== 'APPROVED' || approved.version_number !== 1) throw new Error('Initial constitution approval mismatch');
  pass(2, 'Assigned Agent approves initial constitution', approved.id);
  await api('PATCH', `/api/v1/groups/${group.id}/constitution/${constitution.id}`, { shareValue: '2000.00' }, 409, graceCookie);
  pass(4, 'Approved constitution immutable', 'HTTP 409');
  const cycleCountBefore = (await db.query('SELECT COUNT(*)::int n FROM vsla_cycles WHERE group_id=$1', [group.id])).rows[0].n;
  await api('POST', `/api/v1/groups/${group.id}/cycles`, { constitutionId: constitution.id, cycleNumber: 1, startDate: '2026-08-20', expectedEndDate: '2026-08-19', status: 'READY' }, 400, graceCookie);
  const cycleCountAfter = (await db.query('SELECT COUNT(*)::int n FROM vsla_cycles WHERE group_id=$1', [group.id])).rows[0].n;
  if (cycleCountBefore !== cycleCountAfter) throw new Error('Invalid cycle partially created');
  pass(6, 'Invalid cycle dates rejected', { before: cycleCountBefore, after: cycleCountAfter });
  const validCycle = { constitutionId: constitution.id, cycleNumber: 1, startDate: new Date().toISOString().slice(0, 10), expectedEndDate: '2027-07-31', expectedShareoutDate: '', meetingDayOfWeek: '', status: 'READY' };
  await api('POST', `/api/v1/groups/${group.id}/cycles`, validCycle, 403, hopeCookie);
  pass(7, 'Foreign Agent cycle save', 'HTTP 403');
  const cycle = (await api('POST', `/api/v1/groups/${group.id}/cycles`, validCycle, 201, graceCookie)).data;
  pass(5, 'Agent saves valid initial cycle', { id: cycle.id, status: cycle.status, optionalEmptyFieldsAccepted: true });
  const foreignMember = (await db.query(`SELECT id FROM group_members WHERE group_id<>$1 AND status='ACTIVE' LIMIT 1`, [group.id])).rows[0];
  await api('POST', `/api/v1/groups/${group.id}/officers`, { cycleId: cycle.id, memberId: foreignMember.id, positionCode: 'CHAIRPERSON' }, 400, graceCookie);
  pass(10, 'Cross-group officer rejected', 'HTTP 400');
  await api('POST', `/api/v1/groups/${group.id}/officers`, { cycleId: cycle.id, memberId: inactive.id, positionCode: 'CHAIRPERSON' }, 400, graceCookie);
  pass(11, 'Inactive member officer rejected', 'HTTP 400');
  for (const [position, index] of [['CHAIRPERSON', 0], ['RECORD_KEEPER', 1], ['BOX_KEEPER', 2], ['MONEY_COUNTER_1', 3], ['MONEY_COUNTER_2', 4]]) await api('POST', `/api/v1/groups/${group.id}/officers`, { cycleId: cycle.id, memberId: members[index].id, positionCode: position, appointedAt: new Date().toISOString().slice(0, 10) }, 201, graceCookie);
  pass(9, 'Agent records five group-selected officers', 5);
  async function digital(member, label) {
    const email = `setup.${label}.${suffix}@example.org`;
    const result = (await api('POST', `/api/v1/groups/${group.id}/members/${member.id}/digital-access`, { mode: 'CREATE_USER', firstName: member.first_name, lastName: member.last_name, email, password }, 201, graceCookie)).data;
    return { ...result, email, cookie: await login(email) };
  }
  const chair = await digital(members[0], 'chair');
  const recordKeeper = await digital(members[1], 'recordkeeper');
  pass(12, 'Chairperson digital access', chair.user.id);
  pass(13, 'Record-Keeper digital access', recordKeeper.user.id);
  await api('POST', `/api/v1/groups/${group.id}/activate`, {}, 200, graceCookie);
  const readiness = (await api('GET', `/api/v1/groups/${group.id}/member-managed-readiness`, undefined, 200)).data;
  if (!readiness.ready) throw new Error(`Readiness failed: ${readiness.blockingIssues}`);
  pass(14, 'Member-managed readiness', true);
  const financialBefore = (await db.query(`SELECT (SELECT COUNT(*)::int FROM financial_transactions WHERE group_id=$1) transactions,(SELECT COUNT(*)::int FROM ledger_entries e JOIN financial_transactions t ON t.id=e.financial_transaction_id WHERE t.group_id=$1) entries`, [group.id])).rows[0];
  await api('POST', `/api/v1/groups/${group.id}/operation-mode`, { operationMode: 'MEMBER_MANAGED' }, 200);
  pass(15, 'Valid handover', 'MEMBER_MANAGED');
  const financialAfter = (await db.query(`SELECT (SELECT COUNT(*)::int FROM financial_transactions WHERE group_id=$1) transactions,(SELECT COUNT(*)::int FROM ledger_entries e JOIN financial_transactions t ON t.id=e.financial_transaction_id WHERE t.group_id=$1) entries`, [group.id])).rows[0];
  if (JSON.stringify(financialBefore) !== JSON.stringify(financialAfter)) throw new Error('Handover changed financial rows');
  pass(16, 'Handover creates no financial rows', { before: financialBefore, after: financialAfter });
  await api('POST', `/api/v1/groups/${group.id}/constitution`, constitutionBody, 403, graceCookie);
  pass(18, 'Agent constitution mutation after handover', 'HTTP 403');
  await api('POST', `/api/v1/groups/${group.id}/officers`, { cycleId: cycle.id, memberId: members[5].id, positionCode: 'CHAIRPERSON' }, 403, graceCookie);
  pass(19, 'Agent officer mutation after handover', 'HTTP 403');
  const meeting = (await api('POST', `/api/v1/groups/${group.id}/meetings`, { meetingDate: new Date().toISOString().slice(0, 10) }, 201, recordKeeper.cookie)).data;
  const transaction = (await api('POST', `/api/v1/groups/${group.id}/meetings/${meeting.id}/savings`, { memberId: members[2].id, numberOfShares: 1, idempotencyKey: `setup-rk-${suffix}` }, 201, recordKeeper.cookie)).data.transaction;
  pass(20, 'Record-Keeper financial mutation after handover', transaction.id);
  const mutationBefore = (await db.query('SELECT COUNT(*)::int n FROM financial_transactions WHERE group_id=$1', [group.id])).rows[0].n;
  await api('POST', `/api/v1/groups/${group.id}/meetings/${meeting.id}/savings`, { memberId: members[2].id, numberOfShares: 1, idempotencyKey: `setup-agent-${suffix}` }, 403, graceCookie);
  const mutationAfter = (await db.query('SELECT COUNT(*)::int n FROM financial_transactions WHERE group_id=$1', [group.id])).rows[0].n;
  if (mutationBefore !== mutationAfter) throw new Error('Denied Agent financial request posted data');
  pass(17, 'Agent financial mutation after handover', { status: 403, before: mutationBefore, after: mutationAfter });
  await api('POST', `/api/v1/groups/${group.id}/meetings/${meeting.id}/transactions/${transaction.id}/reverse`, { idempotencyKey: `setup-reverse-${suffix}` }, 201, recordKeeper.cookie);
  await api('POST', `/api/v1/groups/${group.id}/meetings/${meeting.id}/cancel`, { reason: 'Completed Agent setup acceptance fixture' }, 200, recordKeeper.cookie);
  proof.central = { groupId: group.id, graceUserId: grace.user_id, constitutionId: constitution.id, cycleId: cycle.id, chairUserId: chair.user.id, recordKeeperUserId: recordKeeper.user.id, handoverFinancialRows: { before: financialBefore, after: financialAfter }, recordKeeperTransactionId: transaction.id };

  const reassigned = (await api('POST', '/api/v1/groups', { ...groupBody, name: `Reassigned Setup Group ${suffix}` }, 201, graceCookie)).data;
  await api('POST', `/api/v1/facilitators/${hope.id}/groups/assign`, { groupIds: [reassigned.id], reassignmentReason: 'Acceptance reassignment coverage' }, 200);
  await api('POST', `/api/v1/groups/${reassigned.id}/constitution`, constitutionBody, 403, graceCookie);
  const hopeDraft = (await api('POST', `/api/v1/groups/${reassigned.id}/constitution`, constitutionBody, 201, hopeCookie)).data;
  const provenance = (await db.query('SELECT created_by_facilitator_id,facilitator_user_id FROM vsla_groups WHERE id=$1', [reassigned.id])).rows[0];
  if (provenance.created_by_facilitator_id !== grace.id || provenance.facilitator_user_id !== hope.user_id) throw new Error('Creator/current Agent distinction failed');
  pass(21, 'Creator vs assigned-Agent authority', { creator: grace.id, currentAgent: hope.id, hopeDraft: hopeDraft.id });
  const adminGroup = (await api('POST', '/api/v1/groups', { ...groupBody, name: `Admin Support Group ${suffix}` }, 201, graceCookie)).data;
  const adminDraft = (await api('POST', `/api/v1/groups/${adminGroup.id}/constitution`, constitutionBody, 201)).data;
  pass(23, 'Programme Admin regression', adminDraft.id);
  const deactivatedGroup = (await api('POST', '/api/v1/groups', { ...groupBody, name: `Deactivated Agent Group ${suffix}` }, 201, hopeCookie)).data;
  await api('POST', `/api/v1/facilitators/${hope.id}/deactivate`, { replacementFacilitatorId: grace.id }, 200);
  await api('POST', `/api/v1/groups/${deactivatedGroup.id}/constitution`, constitutionBody, [401, 403], hopeCookie);
  pass(22, 'Deactivated Agent denied', 'HTTP 401/403');
  console.log(JSON.stringify({ fixture: suffix, results: results.sort((a, b) => a.number - b.number), proof }, null, 2));
} finally {
  await db.query("UPDATE vsla_groups SET public_visibility='HIDDEN',membership_intake_status='CLOSED',status='ARCHIVED',operation_mode='PROGRAM_ASSISTED' WHERE name LIKE $1", [`%${suffix}%`]).catch(() => {});
  await db.end();
}
