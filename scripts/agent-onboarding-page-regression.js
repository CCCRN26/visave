import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const fixture = (await db.query(`SELECT g.id group_id,j.id request_id,u.email FROM vsla_groups g JOIN facilitator_profiles fp ON fp.user_id=g.facilitator_user_id JOIN users u ON u.id=fp.user_id LEFT JOIN LATERAL(SELECT id FROM vsla_join_requests WHERE group_id=g.id ORDER BY created_at DESC LIMIT 1)j ON true WHERE g.name LIKE 'Unity Savings Group %' AND u.status='ACTIVE' ORDER BY g.created_at DESC LIMIT 1`)).rows[0];
await db.end();
if (!fixture?.request_id) throw new Error('Phase 2F-A.1 retained acceptance fixture not found');

const login = await fetch('http://localhost:3000/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.21.1.1' }, body: JSON.stringify({ email: fixture.email, password: 'Phase2FA1-Test-2026!' }) });
if (!login.ok) throw new Error(`Agent login failed: ${login.status}`);
const cookie = login.headers.get('set-cookie').split(';', 1)[0];
const paths = ['/dashboard', '/my-groups', '/groups/new', `/groups/${fixture.group_id}/onboarding`, `/groups/${fixture.group_id}/constitution`, `/groups/${fixture.group_id}/cycle`, `/groups/${fixture.group_id}/officers`, `/groups/${fixture.group_id}/members`, '/membership-requests', `/membership-requests/${fixture.request_id}`, '/notifications'];
const results = [];
for (const path of paths) {
  const response = await fetch(`http://localhost:3000${path}`, { headers: { cookie }, redirect: 'manual' });
  const html = await response.text();
  const invalid = ['Invalid Date', '[object Object]', 'NaN', '>undefined<'].filter((token) => html.includes(token));
  if (response.status !== 200 || invalid.length) throw new Error(JSON.stringify({ path, status: response.status, invalid }));
  results.push({ path, status: response.status, invalid });
}
console.log(JSON.stringify(results, null, 2));
