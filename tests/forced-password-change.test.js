import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forcedPasswordChangeSchema } from "../src/modules/auth/auth.schemas.js";
import { assertPasswordChangeComplete } from "../src/lib/auth/password-state.js";
import { changeForcedPasswordWithClient } from "../src/modules/auth/password-change.service.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("forward migration preserves existing users and leaves the default off", () => {
  const sql = read("database/migrations/053_force_password_change.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(sql, /UPDATE users SET must_change_password = false/i);
  assert.match(sql, /ALTER COLUMN must_change_password SET DEFAULT false/i);
});

test("all administrator-supplied new-login paths opt in, while existing-account linking does not", () => {
  const facilitator = read("src/modules/facilitators/facilitator.service.js");
  const users = read("src/app/api/v1/users/route.js");
  const members = read("src/modules/member-managed/member-managed.service.js");
  assert.match(facilitator, /must_change_password,created_by\) VALUES\([^`]+true/);
  assert.match(users, /must_change_password,created_by\)[\s\S]+VALUES\([^`]+true/);
  assert.match(members, /data\.mode==='CREATE_USER'[\s\S]+must_change_password,created_by\)[^`]+true/);
  const linkBranch = members.match(/}else\{([\s\S]+?)if\(\(await client\.query\('SELECT 1 FROM group_members/)?.[1] || "";
  assert.match(linkBranch, /SELECT id,organization_id,first_name,last_name,email,phone,status FROM users/);
  assert.doesNotMatch(linkBranch, /UPDATE users|must_change_password/);
});

test("login carries the forced-change state without treating a valid password as invalid", () => {
  const repository = read("src/modules/auth/auth.repository.js");
  const service = read("src/modules/auth/auth.service.js");
  const page = read("src/app/login/page.js");
  assert.match(repository, /status,must_change_password FROM users/);
  assert.match(service, /bcrypt\.compare\(password,user\.password_hash\)/);
  assert.doesNotMatch(service, /must_change_password[^\n]+INVALID_CREDENTIALS/);
  assert.match(page, /json\.data\?\.user\?\.must_change_password/);
  assert.match(page, /router\.replace\("\/change-password"\)/);
});

test("shared page and API guards block normal access until password change", () => {
  assert.throws(
    () => assertPasswordChangeComplete({ must_change_password: true }),
    (error) => error.code === "PASSWORD_CHANGE_REQUIRED" && error.statusCode === 403,
  );
  const user = { must_change_password: false };
  assert.equal(assertPasswordChangeComplete(user), user);
  assert.match(read("src/app/(protected)/layout.js"), /if\(user\.must_change_password\)redirect\("\/change-password"\)/);
  assert.match(read("src/lib/auth/session.js"), /requireAuth\(\).*assertPasswordChangeComplete/);
  assert.match(read("src/app/api/v1/auth/me/route.js"), /requireAuth\(\)/);
});

test("forced-change endpoint is session-bound to the authenticated user", () => {
  const route = read("src/app/api/v1/auth/change-password/route.js");
  const service = read("src/modules/auth/password-change.service.js");
  assert.match(route, /requireSessionUser\(\)/);
  assert.match(route, /changeForcedPassword\(data, user\)/);
  assert.doesNotMatch(route, /params|userId/);
  assert.match(service, /WHERE id=\$1/);
  assert.match(service, /\[user\.id/);
});

test("forced password schema enforces confirmation and the existing 12-character policy", () => {
  assert.equal(forcedPasswordChangeSchema.safeParse({ newPassword: "short", confirmPassword: "short" }).success, false);
  assert.equal(forcedPasswordChangeSchema.safeParse({ newPassword: "New-Password-2026", confirmPassword: "different-value" }).success, false);
  assert.equal(forcedPasswordChangeSchema.safeParse({ newPassword: "New-Password-2026", confirmPassword: "New-Password-2026" }).success, true);
});

test("successful forced change stores only a hash, clears the flag, and audits", async () => {
  const calls = [];
  const client = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT password_hash")) return { rows: [{ password_hash: "old-hash", must_change_password: true }] };
    if (sql.startsWith("UPDATE users")) return { rows: [{ id: "user-1" }] };
    return { rows: [] };
  } };
  const passwordTools = { compare: async () => false, hash: async (value, rounds) => {
    assert.equal(value, "New-Password-2026");
    assert.equal(rounds, 12);
    return "synthetic-hash";
  } };
  const result = await changeForcedPasswordWithClient(client, { id: "user-1", organization_id: "org-1" }, "New-Password-2026", passwordTools);
  assert.deepEqual(result, { changed: true });
  const update = calls.find((call) => call.sql.startsWith("UPDATE users"));
  assert.equal(update.params[1], "synthetic-hash");
  assert.notEqual(update.params[1], "New-Password-2026");
  assert.match(update.sql, /must_change_password=false/);
  assert.ok(calls.some((call) => call.params.includes("USER_FORCED_PASSWORD_CHANGED")));
});

test("failed password update leaves forced state uncleared", async () => {
  let auditCalled = false;
  const client = { query: async (sql) => {
    if (sql.startsWith("SELECT password_hash")) return { rows: [{ password_hash: "old-hash", must_change_password: true }] };
    if (sql.startsWith("UPDATE users")) return { rows: [] };
    auditCalled = true;
    return { rows: [] };
  } };
  await assert.rejects(
    changeForcedPasswordWithClient(client, { id: "user-1", organization_id: "org-1" }, "New-Password-2026", { compare: async () => false, hash: async () => "synthetic-hash" }),
    (error) => error.code === "PASSWORD_CHANGE_FAILED",
  );
  assert.equal(auditCalled, false);
});

test("the change page offers logout and normal accounts are sent to their workspace", () => {
  const page = read("src/app/change-password/page.js");
  const form = read("src/components/forced-password-change-form.js");
  assert.match(page, /if \(!user\.must_change_password\) redirect\(authenticatedHome\(user\)\)/);
  assert.match(form, /\/api\/v1\/auth\/logout/);
  assert.match(form, />Log Out</);
});
