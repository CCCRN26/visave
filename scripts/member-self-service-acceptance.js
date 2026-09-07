import crypto from "node:crypto";
import pg from "pg";
import nextEnv from "@next/env";
import { databaseUrlFor, requireDisposableDatabaseName } from "./lib/disposable-database.js";

nextEnv.loadEnvConfig(process.cwd());
const databaseName = requireDisposableDatabaseName(process.env.MEMBER_ACCEPTANCE_DB || "cccrn_vsla_acceptance");
process.env.DATABASE_URL = databaseUrlFor(new URL(process.env.DATABASE_URL), databaseName).toString();
const { getMyGroupActivity } = await import("../src/modules/member-self/member-self.service.js");
const { getMyGroups } = await import("../src/modules/group-access/group-access.service.js");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const token = crypto.randomUUID().slice(0, 8);
const results = [];
let queryQueue = Promise.resolve();
const serviceClient = {
  query(...args) {
    const result = queryQueue.then(() => client.query(...args));
    queryQueue = result.then(() => undefined, () => undefined);
    return result;
  },
};

await client.connect();
try {
  await client.query("BEGIN");
  const organizationId = (await client.query("INSERT INTO organizations(code,name,status) VALUES($1,$2,'ACTIVE') RETURNING id", [`MS-${token}`, `Member self ${token}`])).rows[0].id;
  const userId = (await client.query("INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status) VALUES($1,'Ordinary','Member',$2,'not-used','ACTIVE') RETURNING id", [organizationId, `member-${token}@example.test`])).rows[0].id;
  const adminId = (await client.query("INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status) VALUES($1,'Fixture','Admin',$2,'not-used','ACTIVE') RETURNING id", [organizationId, `admin-${token}@example.test`])).rows[0].id;
  const projectId = (await client.query("INSERT INTO projects(organization_id,code,name,status,created_by) VALUES($1,$2,$3,'ACTIVE',$4) RETURNING id", [organizationId, `P-${token}`, `Project ${token}`, adminId])).rows[0].id;
  const location = (await client.query("SELECT s.id state_id,l.id lga_id FROM states s JOIN lgas l ON l.state_id=s.id ORDER BY s.name,l.name LIMIT 1")).rows[0];
  const user = { id: userId, organization_id: organizationId, roles: ["VSLA_MEMBER"], permissions: [] };

  async function createGroup(number) {
    const group = (await client.query("INSERT INTO vsla_groups(organization_id,project_id,group_code,name,state_id,lga_id,community_name,date_formed,meeting_location,group_type,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,'Member Hall','SELF_MANAGED','ACTIVE',$8) RETURNING id,name", [organizationId, projectId, `MSG-${token}-${number}`, `Member Group ${number}`, location.state_id, location.lga_id, `Community ${number}`, adminId])).rows[0];
    const constitution = (await client.query("INSERT INTO group_constitutions(organization_id,group_id,version_number,status,share_value,min_shares_per_meeting,max_shares_per_meeting,social_fund_contribution,loan_max_multiple,loan_service_charge_rate,loan_max_term_months,meeting_frequency,approved_at,approved_by,created_by) VALUES($1,$2,1,'APPROVED',1000,1,5,100,3,5,3,'WEEKLY',now(),$3,$3) RETURNING id", [organizationId, group.id, adminId])).rows[0];
    await client.query("INSERT INTO vsla_cycles(organization_id,group_id,constitution_id,cycle_number,start_date,expected_end_date,status,activated_at,created_by) VALUES($1,$2,$3,1,CURRENT_DATE,CURRENT_DATE+INTERVAL '10 months','ACTIVE',now(),$4)", [organizationId, group.id, constitution.id, adminId]);
    const memberId = (await client.query("INSERT INTO group_members(organization_id,group_id,member_number,member_code,first_name,last_name,date_joined,linked_user_id,status,created_by) VALUES($1,$2,1,$3,'Ordinary','Member',CURRENT_DATE,$4,'ACTIVE',$5) RETURNING id", [organizationId, group.id, `M-${token}-${number}`, userId, adminId])).rows[0].id;
    return { ...group, memberId };
  }

  const groupA = await createGroup(1);
  const groupB = await createGroup(2);
  let groups = await getMyGroups(user, serviceClient);
  if (groups.length !== 2 || groups.some((group) => group.has_officer_workspace)) throw new Error("Ordinary multi-group memberships were not returned safely");
  results.push({ scenario: "Two active ordinary memberships appear in My Groups", result: "PASS" });

  const activityA = await getMyGroupActivity(groupA.id, user, serviceClient);
  const activityB = await getMyGroupActivity(groupB.id, user, serviceClient);
  if (activityA.membership.groupName === activityB.membership.groupName || activityA.summary.savingsAmount !== "0.00") throw new Error("Member group activity was not isolated");
  results.push({ scenario: "Self-service SQL parses and isolates each group", result: "PASS" });

  await client.query("UPDATE group_members SET linked_user_id=NULL WHERE id=$1", [groupA.memberId]);
  await getMyGroupActivity(groupA.id, user, serviceClient).then(() => { throw new Error("Revoked group remained accessible"); }, (error) => { if (error.code !== "FORBIDDEN") throw error; });
  groups = await getMyGroups(user, serviceClient);
  if (groups.length !== 1 || groups[0].id !== groupB.id) throw new Error("Revoking one membership affected the wrong group");
  await getMyGroupActivity(groupB.id, user, serviceClient);
  results.push({ scenario: "Revoking Group A preserves Group B", result: "PASS" });

  await client.query("UPDATE group_members SET status='INACTIVE' WHERE id=$1", [groupB.memberId]);
  await getMyGroupActivity(groupB.id, user, serviceClient).then(() => { throw new Error("Inactive membership remained accessible"); }, (error) => { if (error.code !== "FORBIDDEN") throw error; });
  results.push({ scenario: "Inactive membership is denied", result: "PASS" });
  console.log(JSON.stringify({ database: databaseName, results }, null, 2));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
