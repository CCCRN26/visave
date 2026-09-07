import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`UPDATE vsla_cycles SET status='CANCELLED',updated_at=now() WHERE group_id IN(SELECT id FROM vsla_groups WHERE group_code LIKE 'PHASE2C-SNAPSHOT-%') AND status='ACTIVE'`);
  await db.query(`UPDATE vsla_groups SET status='ARCHIVED',updated_at=now() WHERE group_code LIKE 'PHASE2C-SNAPSHOT-%'`);
  await db.query("COMMIT");
  const proof = (await db.query(`SELECT
    COUNT(*) FILTER(WHERE g.status<>'ARCHIVED')::int non_archived_fixture_groups,
    COUNT(*) FILTER(WHERE m.status='OPEN')::int open_fixture_meetings,
    COUNT(*) FILTER(WHERE l.settled_at IS NULL AND l.voided_at IS NULL)::int outstanding_fixture_loans
  FROM vsla_groups g LEFT JOIN vsla_meetings m ON m.group_id=g.id LEFT JOIN loans l ON l.group_id=g.id
  WHERE g.group_code LIKE 'PHASE2C-SNAPSHOT-%'`)).rows[0];
  console.log(JSON.stringify(proof, null, 2));
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
