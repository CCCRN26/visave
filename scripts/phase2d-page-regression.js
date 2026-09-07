import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) { const match = line.match(/^([^#][^=]*)=(.*)$/); if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, ""); }
const login = await fetch("http://localhost:3000/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie").split(";", 1)[0];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const fixture = (await db.query(`SELECT g.id group_id,s.cycle_id FROM vsla_groups g JOIN cycle_shareouts s ON s.group_id=g.id WHERE g.group_code LIKE 'PHASE2D-%' ORDER BY s.created_at DESC LIMIT 1`)).rows[0]; await db.end();
if (!fixture) throw new Error("Phase 2D page fixture not found");
const paths = [`/groups/${fixture.group_id}/cycle`, `/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/shareout`];
const results = [];
for (const path of paths) { const response = await fetch(`http://localhost:3000${path}`, { headers: { cookie } }); const html = await response.text(); if (response.status !== 200 || /Invalid Date|\[object Date\]/.test(html)) throw new Error(`${path}: status=${response.status}`); results.push({ path, status: response.status, invalidDate: false, objectDate: false }); }
console.log(JSON.stringify(results, null, 2));
