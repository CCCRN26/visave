import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}

const login = await fetch("http://localhost:3000/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }),
});
if (!login.ok) throw new Error(`Admin login failed with HTTP ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
const paths = ["/groups", "/groups/new", "/projects", "/users", "/facilitators"];
const pages = [];
for (const path of paths) {
  const response = await fetch(`http://localhost:3000${path}`, { headers: { cookie }, redirect: "manual" });
  const html = await response.text();
  pages.push({ path, status: response.status, invalidDate: html.includes("Invalid Date"), objectDate: html.includes("[object Date]") });
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const happy = (await db.query(`SELECT g.group_code,g.status,
  (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id=g.id AND m.status='ACTIVE') active_members,
  (SELECT COUNT(*)::int FROM group_constitutions c WHERE c.group_id=g.id AND c.status='APPROVED') approved_constitutions,
  (SELECT COUNT(*)::int FROM vsla_cycles c WHERE c.group_id=g.id AND c.status='ACTIVE') active_cycles,
  (SELECT COUNT(*)::int FROM group_officer_assignments o WHERE o.group_id=g.id AND o.status='ACTIVE') active_officers
  FROM vsla_groups g WHERE g.group_code='CCCRN-NIG-0005'`)).rows;
const audit = (await db.query(`SELECT action,entity_type,COUNT(*)::int count FROM audit_logs
  WHERE action IN ('MEMBER_CREATED','MEMBER_UPDATED','MEMBER_REMOVED','CONSTITUTION_CREATED','CONSTITUTION_UPDATED','CONSTITUTION_APPROVED','CYCLE_CREATED','CYCLE_UPDATED','OFFICER_ASSIGNED','OFFICER_CHANGED','OFFICER_REMOVED','GROUP_ACTIVATED')
  GROUP BY action,entity_type ORDER BY action,entity_type`)).rows;
await db.end();

if (pages.some((page) => page.status !== 200 || page.invalidDate || page.objectDate)) throw new Error(`Page regression failed: ${JSON.stringify(pages)}`);
console.log(JSON.stringify({ pages, happy, audit }, null, 2));
