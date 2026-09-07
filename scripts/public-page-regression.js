import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
}

const base = 'http://localhost:3000';
const marker = `public-page-${crypto.randomUUID()}@example.org`;
const results = [];
for (const path of ['/', '/about', '/find-a-group', '/join-a-group', '/contact', '/login']) {
  const response = await fetch(base + path, { redirect: 'manual' });
  const html = await response.text();
  const bad = ['Invalid Date', '[object Object]', 'NaN', '>undefined<'].filter((token) => html.includes(token));
  if (response.status !== 200 || bad.length) throw new Error(JSON.stringify({ path, status: response.status, bad }));
  results.push({ path, status: response.status, bad });
}

async function contact(body, expected, ip) {
  const response = await fetch(`${base}/api/public/contact`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });
  if (response.status !== expected) throw new Error(`Contact expected ${expected}, received ${response.status}: ${await response.text()}`);
  return response.status;
}

const valid = { name: 'Public Page Tester', email: marker, category: 'SAVINGS_GROUP_INFORMATION', message: 'Please provide information about the savings group programme.' };
results.push({ scenario: 'valid contact', status: await contact(valid, 201, '127.20.1.1') });
results.push({ scenario: 'malformed contact', status: await contact({ name: 'X', message: 'short' }, 400, '127.20.1.2') });
results.push({ scenario: 'excessive contact', status: await contact({ ...valid, message: 'x'.repeat(10001) }, 400, '127.20.1.3') });
for (let attempt = 1; attempt <= 6; attempt += 1) {
  const expected = attempt === 6 ? 429 : 201;
  await contact({ ...valid, email: `rate-${attempt}-${marker}` }, expected, '127.20.1.4');
}
results.push({ scenario: 'contact rate limit', status: 429 });

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query("DELETE FROM contact_requests WHERE email=$1 OR email LIKE $2", [marker, `rate-%-${marker}`]);
await db.end();
console.log(JSON.stringify(results, null, 2));
