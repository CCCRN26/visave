import crypto from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import nextEnv from "@next/env";
import { databaseUrlFor, requireDisposableDatabaseName } from "./lib/disposable-database.js";

nextEnv.loadEnvConfig(process.cwd());
const databaseName = requireDisposableDatabaseName(process.env.DIGITAL_ACCESS_DB || "cccrn_vsla_acceptance");
const base = process.env.DIGITAL_ACCESS_BASE_URL || "http://localhost:3100";
const databaseUrl = databaseUrlFor(new URL(process.env.DATABASE_URL), databaseName).toString();
const db = new pg.Client({ connectionString: databaseUrl });
const token = crypto.randomUUID().slice(0, 8);
const password = "Digital-Access-2026!";
const results = [];
const createdUserIds = [];
const memberIds = [];
let groupId;
let projectId;
let organizationId;

async function api(method, path, body, expected, cookie) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!type.includes("application/json")) throw new Error(`${method} ${path} returned ${response.status} ${type}: ${text.slice(0, 120)}`);
  const json = JSON.parse(text);
  if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(json)}`);
  return { response, json };
}

async function login(email, secret) {
  const { response } = await api("POST", "/api/v1/auth/login", { email, password: secret }, 200);
  return response.headers.get("set-cookie")?.split(";", 1)[0];
}

async function createUser(organizationId, adminId, label) {
  const email = `${label}-${token}@example.test`;
  const id = (await db.query("INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status,created_by) VALUES($1,$2,'Tester',$3,$4,'ACTIVE',$5) RETURNING id", [organizationId, label, email, await bcrypt.hash(password, 12), adminId])).rows[0].id;
  createdUserIds.push(id);
  return { id, email, cookie: await login(email, password) };
}

await db.connect();
try {
  organizationId = (await db.query("INSERT INTO organizations(code,name,status) VALUES($1,$2,'ACTIVE') RETURNING id", [`DA-${token}`, `Digital Access ${token}`])).rows[0].id;
  const adminEmail = `admin-${token}@example.test`;
  const adminId = (await db.query("INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status) VALUES($1,'Route','Admin',$2,$3,'ACTIVE') RETURNING id", [organizationId, adminEmail, await bcrypt.hash(password, 12)])).rows[0].id;
  createdUserIds.push(adminId);
  await db.query("INSERT INTO user_roles(user_id,role_id,created_by) SELECT $1,id,$1 FROM roles WHERE code='SUPER_ADMIN'", [adminId]);
  const admin = { id: adminId, organization_id: organizationId, email: adminEmail };
  const adminCookie = await login(adminEmail, password);
  projectId = (await db.query("INSERT INTO projects(organization_id,code,name,status,created_by) VALUES($1,$2,$3,'ACTIVE',$4) RETURNING id", [organizationId, `P-${token}`, `Digital Access Project ${token}`, adminId])).rows[0].id;
  const project = { id: projectId };
  const location = (await db.query("SELECT s.id state_id,l.id lga_id FROM states s JOIN lgas l ON l.state_id=s.id ORDER BY s.name,l.name LIMIT 1")).rows[0];
  const facilitator = await createUser(admin.organization_id, admin.id, "AssignedFacilitator");
  const unassigned = await createUser(admin.organization_id, admin.id, "UnassignedFacilitator");
  for (const actor of [facilitator, unassigned]) {
    await db.query("INSERT INTO facilitator_profiles(user_id,staff_code,state_id,lga_id,status) VALUES($1,$2,$3,$4,'ACTIVE')", [actor.id, `DA-${token}-${actor.id.slice(0, 4)}`, location.state_id, location.lga_id]);
    await db.query("INSERT INTO user_roles(user_id,role_id,project_id,state_id,created_by) SELECT $1,id,$2,$3,$4 FROM roles WHERE code='FACILITATOR'", [actor.id, project.id, location.state_id, admin.id]);
  }
  groupId = (await db.query("INSERT INTO vsla_groups(organization_id,project_id,group_code,name,state_id,lga_id,facilitator_user_id,date_formed,meeting_location,group_type,status,created_by,operation_mode) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,'Digital Access Hall','SUPERVISED','ACTIVE',$8,'PROGRAM_ASSISTED') RETURNING id", [admin.organization_id, project.id, `DA-${token}`, `Digital Access ${token}`, location.state_id, location.lga_id, facilitator.id, admin.id])).rows[0].id;
  for (let number = 1; number <= 7; number += 1) {
    memberIds.push((await db.query("INSERT INTO group_members(organization_id,group_id,member_number,member_code,first_name,last_name,date_joined,status,created_by) VALUES($1,$2,$3,$4,$5,'Member',CURRENT_DATE,$6,$7) RETURNING id", [admin.organization_id, groupId, number, `DA-${token}-${number}`, `Member${number}`, number === 4 ? "INACTIVE" : "ACTIVE", admin.id])).rows[0].id);
  }
  const path = (memberId) => `/api/v1/groups/${groupId}/members/${memberId}/digital-access`;
  const create = (label) => ({ mode: "CREATE_USER", firstName: label, lastName: "Member", email: `${label.toLowerCase()}-${token}@example.test`, phone: "08012345678", password });

  const adminCreate = await api("POST", path(memberIds[0]), create("AdminCreated"), 201, adminCookie);
  createdUserIds.push(adminCreate.json.data.user.id);
  const proof = (await db.query("SELECT gm.linked_user_id,(SELECT COUNT(*)::int FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=gm.linked_user_id AND r.code='VSLA_MEMBER') member_roles,(SELECT COUNT(*)::int FROM group_officer_assignments oa WHERE oa.member_id=gm.id) officers FROM group_members gm WHERE gm.id=$1", [memberIds[0]])).rows[0];
  if (!proof.linked_user_id || proof.member_roles !== 1 || proof.officers !== 0) throw new Error(`Admin ordinary-member proof failed: ${JSON.stringify(proof)}`);
  results.push({ scenario: "Admin CREATE_USER for ordinary active member", result: "PASS" });

  await api("POST", path(memberIds[0]), create("Duplicate"), 409, adminCookie);
  await api("POST", path(memberIds[3]), create("Inactive"), 400, adminCookie);
  await api("POST", path(memberIds[1]), create("OrdinaryDenied"), 403, await login(adminCreate.json.data.user.email, password));
  results.push({ scenario: "Duplicate, inactive target, and ordinary actor return structured JSON", result: "PASS" });

  const paCreate = await api("POST", path(memberIds[1]), create("PaCreated"), 201, facilitator.cookie);
  createdUserIds.push(paCreate.json.data.user.id);
  await db.query("UPDATE vsla_groups SET operation_mode='MEMBER_MANAGED' WHERE id=$1", [groupId]);
  const mmCreate = await api("POST", path(memberIds[2]), create("MmCreated"), 201, facilitator.cookie);
  createdUserIds.push(mmCreate.json.data.user.id);
  await api("POST", path(memberIds[4]), create("UnassignedDenied"), 403, unassigned.cookie);
  results.push({ scenario: "Assigned PA and MM Facilitator succeed; unassigned Facilitator denied", result: "PASS" });

  const existing = await createUser(admin.organization_id, admin.id, "ExistingMemberUser");
  await api("POST", path(memberIds[5]), { mode: "LINK_EXISTING", userId: existing.id }, 201, adminCookie);
  if ((await db.query("SELECT linked_user_id FROM group_members WHERE id=$1", [memberIds[5]])).rows[0].linked_user_id !== existing.id) throw new Error("LINK_EXISTING did not link the selected user");
  results.push({ scenario: "LINK_EXISTING uses the canonical route", result: "PASS" });
  console.log(JSON.stringify({ database: databaseName, base, results }, null, 2));
} finally {
  if (memberIds.length) await db.query("DELETE FROM audit_logs WHERE entity_id=ANY($1::uuid[])", [memberIds]).catch(() => {});
  if (groupId) {
    await db.query("UPDATE group_members SET linked_user_id=NULL WHERE group_id=$1", [groupId]).catch(() => {});
    await db.query("DELETE FROM group_members WHERE group_id=$1", [groupId]).catch(() => {});
    await db.query("DELETE FROM vsla_groups WHERE id=$1", [groupId]).catch(() => {});
  }
  if (projectId) await db.query("DELETE FROM projects WHERE id=$1", [projectId]).catch(() => {});
  for (const userId of [...new Set(createdUserIds)].reverse()) {
    await db.query("DELETE FROM user_sessions WHERE user_id=$1", [userId]).catch(() => {});
    await db.query("DELETE FROM user_roles WHERE user_id=$1", [userId]).catch(() => {});
    await db.query("DELETE FROM facilitator_profiles WHERE user_id=$1", [userId]).catch(() => {});
    await db.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => {});
  }
  if (organizationId) await db.query("DELETE FROM organizations WHERE id=$1", [organizationId]).catch(() => {});
  await db.end();
}
