import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
}

const base = 'http://localhost:3000';
const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
const password = 'Phase2FA1-Atomic-2026!';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function request(method, path, body, expected, cookie) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json', 'x-forwarded-for': `127.8.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify(body),
  });
  if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, received ${response.status}: ${await response.text()}`);
  return { data: (await response.json()).data, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] };
}

await db.connect();
try {
  const adminLogin = await request('POST', '/api/v1/auth/login', { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }, 200);
  const admin = (await db.query('SELECT organization_id FROM users WHERE lower(email)=lower($1)', [process.env.SEED_ADMIN_EMAIL])).rows[0];
  const scope = (await db.query(`SELECT p.id project_id,s.id state_id,l.id lga_id,(SELECT id FROM communities WHERE lga_id=l.id LIMIT 1) community_id FROM projects p CROSS JOIN states s JOIN lgas l ON l.state_id=s.id WHERE p.organization_id=$1 AND p.status='ACTIVE' AND s.name='Niger' ORDER BY community_id NULLS LAST LIMIT 1`, [admin.organization_id])).rows[0];
  const email = `p2fa1.atomic.${suffix}@example.org`;
  const agent = (await request('POST', '/api/v1/facilitators', { firstName: 'Atomic', lastName: 'Agent', email, staffCode: `P2FA1-AT-${suffix}`, password, projectId: scope.project_id, stateId: scope.state_id, lgaId: scope.lga_id, groupIds: [] }, 201, adminLogin.cookie)).data;
  const agentLogin = await request('POST', '/api/v1/auth/login', { email, password }, 200);
  const name = `Atomic Group ${suffix}`;
  const before = (await db.query(`SELECT (SELECT COUNT(*)::int FROM vsla_groups WHERE name=$1) AS group_rows,(SELECT COUNT(*)::int FROM audit_logs WHERE action='GROUP_CREATED_BY_AGENT' AND actor_user_id=$2) AS audit_rows`, [name, agent.facilitator.user_id])).rows[0];
  await db.query(`CREATE FUNCTION phase2fa1_fail_group_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='GROUP_CREATED_BY_AGENT' THEN RAISE EXCEPTION 'controlled group audit failure'; END IF; RETURN NEW; END$$`);
  await db.query('CREATE TRIGGER phase2fa1_fail_group_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION phase2fa1_fail_group_audit()');
  await request('POST', '/api/v1/groups', { name, projectId: scope.project_id, stateId: scope.state_id, lgaId: scope.lga_id, communityId: scope.community_id, dateFormed: new Date().toISOString().slice(0, 10), meetingLocation: 'Atomic fixture hall', expectedMemberCount: 15, notes: 'Controlled rollback fixture', groupType: 'SUPERVISED', status: 'ACTIVE' }, 500, agentLogin.cookie);
  await db.query('DROP TRIGGER phase2fa1_fail_group_audit ON audit_logs');
  await db.query('DROP FUNCTION phase2fa1_fail_group_audit()');
  const after = (await db.query(`SELECT (SELECT COUNT(*)::int FROM vsla_groups WHERE name=$1) AS group_rows,(SELECT COUNT(*)::int FROM audit_logs WHERE action='GROUP_CREATED_BY_AGENT' AND actor_user_id=$2) AS audit_rows`, [name, agent.facilitator.user_id])).rows[0];
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Atomicity failed: ${JSON.stringify({ before, after })}`);
  console.log(JSON.stringify({ result: 'PASS', agentId: agent.facilitator.id, before, after }, null, 2));
} finally {
  await db.query('DROP TRIGGER IF EXISTS phase2fa1_fail_group_audit ON audit_logs').catch(() => {});
  await db.query('DROP FUNCTION IF EXISTS phase2fa1_fail_group_audit()').catch(() => {});
  await db.end();
}
