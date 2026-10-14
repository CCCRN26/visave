import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { AuthorizationError } from "../src/lib/errors/index.js";
import { assistedPasswordResetSchema } from "../src/modules/auth/assisted-password-reset.schemas.js";
import {
  assistedPasswordResetWithClient,
  authorizeAssistedPasswordReset,
  generateTemporaryPassword,
  runAssistedPasswordReset,
} from "../src/modules/auth/assisted-password-reset.service.js";
import { changeForcedPasswordWithClient } from "../src/modules/auth/password-change.service.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/modules/auth/password-policy.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const actor = (role, values = {}) => ({ id: `${role.toLowerCase()}-actor`, organization_id: "org-1", roles: [role], ...values });
const target = (roles = ["VSLA_MEMBER"], values = {}) => ({ id: "target-1", organization_id: "org-1", status: "ACTIVE", roles, ...values });
const scopedClient = (fullyScoped = true, groups = []) => ({ query: async (sql) => {
  if (sql.includes("AS fully_scoped")) return { rows: [{ fully_scoped: fullyScoped }] };
  if (sql.includes("SELECT gm.group_id")) return { rows: groups.map((group_id) => ({ group_id })) };
  throw new Error(`Unexpected SQL: ${sql}`);
} });
const allowedManagerDependencies = { assertManagementScope: async () => {} };

test("route authenticates before invoking assisted reset and has no generic permission bypass", () => {
  const route = read("src/app/api/v1/users/[id]/assisted-password-reset/route.js");
  assert.match(route, /await requireAuth\(\)/);
  assert.match(route, /assistedPasswordReset\(actor, id, data\.reason\)/);
  assert.doesNotMatch(route, /isAdmin|user\.manage|requirePermission/);
});

test("reason and confirmation are server-validated, trimmed, required, bounded, and strict", () => {
  assert.equal(assistedPasswordResetSchema.safeParse({ reason: "  trusted support request  ", confirmed: true }).data.reason, "trusted support request");
  assert.equal(assistedPasswordResetSchema.safeParse({ reason: "   ", confirmed: true }).success, false);
  assert.equal(assistedPasswordResetSchema.safeParse({ reason: "x".repeat(501), confirmed: true }).success, false);
  assert.equal(assistedPasswordResetSchema.safeParse({ reason: "valid", confirmed: false }).success, false);
  assert.equal(assistedPasswordResetSchema.safeParse({ reason: "valid", confirmed: true, targetRole: "SUPER_ADMIN" }).success, false);
});

test("SUPER_ADMIN is authorized in-organization and cross-organization targets are unavailable", async () => {
  assert.deepEqual(await authorizeAssistedPasswordReset(scopedClient(), actor("SUPER_ADMIN"), target()), { authorityRole: "SUPER_ADMIN" });
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    assistedPasswordResetWithClient(client, actor("SUPER_ADMIN"), "other-org-user", "support request"),
    (error) => error.code === "NOT_FOUND" && error.statusCode === 404,
  );
});

test("PROJECT_ADMIN is limited to fully authoritative project scope", async () => {
  const projectAdmin = actor("PROJECT_ADMIN");
  assert.deepEqual(await authorizeAssistedPasswordReset(scopedClient(true), projectAdmin, target(["STATE_COORDINATOR"]), allowedManagerDependencies), { authorityRole: "PROJECT_ADMIN" });
  await assert.rejects(
    authorizeAssistedPasswordReset(scopedClient(false), projectAdmin, target(), allowedManagerDependencies),
    (error) => error.code === "FORBIDDEN" && error.statusCode === 403,
  );
  await assert.rejects(
    authorizeAssistedPasswordReset(scopedClient(true), projectAdmin, target(["SUPER_ADMIN"]), allowedManagerDependencies),
    (error) => error.code === "FORBIDDEN",
  );
});

test("STATE_COORDINATOR is limited to fully authoritative state/project scope", async () => {
  const coordinator = actor("STATE_COORDINATOR");
  assert.deepEqual(await authorizeAssistedPasswordReset(scopedClient(true), coordinator, target(["FACILITATOR"]), allowedManagerDependencies), { authorityRole: "STATE_COORDINATOR" });
  await assert.rejects(
    authorizeAssistedPasswordReset(scopedClient(false), coordinator, target(), allowedManagerDependencies),
    (error) => error.code === "FORBIDDEN",
  );
  await assert.rejects(
    authorizeAssistedPasswordReset(scopedClient(true), coordinator, target(["PROJECT_ADMIN"]), allowedManagerDependencies),
    (error) => error.code === "FORBIDDEN",
  );
});

test("only a currently authorized facilitator can reset a managed member login", async () => {
  const facilitator = actor("FACILITATOR");
  const allowed = await authorizeAssistedPasswordReset(scopedClient(true, ["group-1"]), facilitator, target(), {
    assertDigitalAccess: async (_actor, groupId) => assert.equal(groupId, "group-1"),
  });
  assert.deepEqual(allowed, { authorityRole: "FACILITATOR", groupId: "group-1" });
  await assert.rejects(authorizeAssistedPasswordReset(scopedClient(true, []), facilitator, target()), (error) => error.code === "FORBIDDEN");
  await assert.rejects(authorizeAssistedPasswordReset(scopedClient(true, ["former-group"]), facilitator, target(), {
    assertDigitalAccess: async () => { throw new AuthorizationError(); },
  }), (error) => error.code === "FORBIDDEN");
  await assert.rejects(authorizeAssistedPasswordReset(scopedClient(true, ["other-group"]), facilitator, target(), {
    assertDigitalAccess: async () => { throw new AuthorizationError(); },
  }), (error) => error.code === "FORBIDDEN");
});

test("facilitators cannot reset privileged staff accounts", async () => {
  for (const role of ["SUPER_ADMIN", "PROJECT_ADMIN", "STATE_COORDINATOR", "FACILITATOR"]) {
    await assert.rejects(
      authorizeAssistedPasswordReset(scopedClient(true, ["group-1"]), actor("FACILITATOR"), target([role]), {
        assertDigitalAccess: async () => {},
      }),
      (error) => error.code === "FORBIDDEN",
    );
  }
});

test("officer status and ordinary membership confer no assisted-reset authority", async () => {
  for (const officer of ["CHAIRPERSON", "RECORD_KEEPER", "BOX_KEEPER", "MONEY_COUNTER", null]) {
    await assert.rejects(
      authorizeAssistedPasswordReset(scopedClient(true, ["group-1"]), actor("VSLA_MEMBER", { officer }), target()),
      (error) => error.code === "FORBIDDEN",
    );
  }
});

test("a direct reset attempt by an authenticated unauthorized user returns the 403 domain result", async () => {
  const client = { query: async (sql) => {
    if (sql.startsWith("SELECT u.id")) return { rows: [{ ...target(), first_name: "Ada", last_name: "User", email: "ada@example.org" }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await assert.rejects(
    assistedPasswordResetWithClient(client, actor("VSLA_MEMBER"), "target-1", "manual API request"),
    (error) => error.code === "FORBIDDEN" && error.statusCode === 403,
  );
});

test("self-assisted reset is denied with its dedicated domain response", async () => {
  const superAdmin = actor("SUPER_ADMIN");
  await assert.rejects(
    assistedPasswordResetWithClient({ query: async () => assert.fail("database should not be queried") }, superAdmin, superAdmin.id, "reason"),
    (error) => error.code === "SELF_ASSISTED_RESET_NOT_ALLOWED" && error.statusCode === 403,
  );
});

test("temporary passwords use crypto, satisfy policy, contain each character class, and vary", () => {
  const source = read("src/modules/auth/assisted-password-reset.service.js");
  assert.match(source, /from "node:crypto"/);
  assert.doesNotMatch(source, /Math\.random/);
  const generated = new Set();
  for (let index = 0; index < 20; index += 1) {
    const password = generateTemporaryPassword();
    generated.add(password);
    assert.ok(password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
  }
  assert.equal(generated.size, 20);
});

test("reset replaces the hash, forces change, revokes only target sessions, and writes a secret-free audit", async () => {
  const oldPassword = "Old-Password-2026";
  const temporaryPassword = "Temp-Password-2026!";
  const permanentPassword = "Permanent-Password-2026!";
  const state = {
    password_hash: await bcrypt.hash(oldPassword, 4),
    must_change_password: false,
    sessions: { "target-session-1": true, "target-session-2": true, "manager-session": true },
  };
  const audits = [];
  const client = { query: async (sql, params = []) => {
    if (sql.startsWith("SELECT u.id")) return { rows: [{ ...target(), first_name: "Ada", last_name: "User", email: "ada@example.org" }] };
    if (sql.startsWith("UPDATE users SET password_hash=$2,must_change_password=true")) {
      state.password_hash = params[1]; state.must_change_password = true; return { rows: [{ id: "target-1" }] };
    }
    if (sql.startsWith("SELECT password_hash")) return { rows: [{ password_hash: state.password_hash, must_change_password: state.must_change_password }] };
    if (sql.startsWith("UPDATE users SET password_hash=$2,must_change_password=false")) {
      state.password_hash = params[1]; state.must_change_password = false; return { rows: [{ id: "target-1" }] };
    }
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await assistedPasswordResetWithClient(client, actor("SUPER_ADMIN"), "target-1", "Identity verified in person", {
    authorize: async () => ({ authorityRole: "SUPER_ADMIN" }),
    passwordGenerator: () => temporaryPassword,
    passwordTools: { hash: async (value, cost) => {
      assert.equal(value, temporaryPassword); assert.equal(cost, 12); return bcrypt.hash(value, 4);
    } },
    revokeSessions: async (_client, userId) => {
      assert.equal(userId, "target-1"); state.sessions["target-session-1"] = false; state.sessions["target-session-2"] = false;
    },
    audit: async (_client, event) => audits.push(event),
  });

  assert.equal(result.temporaryPassword, temporaryPassword);
  assert.equal(await bcrypt.compare(oldPassword, state.password_hash), false);
  assert.equal(await bcrypt.compare(temporaryPassword, state.password_hash), true);
  assert.equal(state.must_change_password, true);
  assert.deepEqual(state.sessions, { "target-session-1": false, "target-session-2": false, "manager-session": true });
  assert.equal(audits[0].action, "USER_ASSISTED_PASSWORD_RESET");
  assert.equal(audits[0].actorUserId, "super_admin-actor");
  assert.equal(audits[0].entityId, "target-1");
  assert.equal(audits[0].newValues.reason, "Identity verified in person");
  assert.doesNotMatch(JSON.stringify(audits[0]), new RegExp(temporaryPassword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(audits[0]), /password_hash|\$2[aby]\$/i);

  await changeForcedPasswordWithClient(client, { id: "target-1", organization_id: "org-1" }, permanentPassword, bcrypt);
  assert.equal(state.must_change_password, false);
  assert.equal(await bcrypt.compare(permanentPassword, state.password_hash), true);
  assert.equal(await bcrypt.compare(temporaryPassword, state.password_hash), false);
});

test("transaction rollback restores password, force flag, and sessions when auditing fails", async () => {
  const state = { password_hash: "old-hash", must_change_password: false, sessionsActive: true };
  let snapshot;
  const calls = [];
  const client = { query: async (sql, params = []) => {
    calls.push(sql);
    if (sql === "BEGIN") { snapshot = { ...state }; return { rows: [] }; }
    if (sql === "ROLLBACK") { Object.assign(state, snapshot); return { rows: [] }; }
    if (sql === "COMMIT") return { rows: [] };
    if (sql.startsWith("SELECT u.id")) return { rows: [{ ...target(), first_name: "Ada", last_name: "User", email: "ada@example.org" }] };
    if (sql.startsWith("UPDATE users")) { state.password_hash = params[1]; state.must_change_password = true; return { rows: [{ id: "target-1" }] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release: () => {} };
  const dbPool = { connect: async () => client };

  await assert.rejects(runAssistedPasswordReset(dbPool, actor("SUPER_ADMIN"), "target-1", "support request", {
    authorize: async () => ({ authorityRole: "SUPER_ADMIN" }),
    passwordGenerator: () => "Temp-Password-2026!",
    passwordTools: { hash: async () => "new-hash" },
    revokeSessions: async () => { state.sessionsActive = false; },
    audit: async () => { throw new Error("audit unavailable"); },
  }), /audit unavailable/);

  assert.deepEqual(state, { password_hash: "old-hash", must_change_password: false, sessionsActive: true });
  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(!calls.includes("COMMIT"));
});

test("UI gates the action, requires confirmation/reason, and displays the generated password once", () => {
  const component = read("src/components/assisted-password-reset.js");
  const memberPage = read("src/app/(protected)/groups/[id]/members/[memberId]/page.js");
  const usersPage = read("src/app/(protected)/users/page.js");
  assert.match(memberPage, /canAssistedPasswordReset/);
  assert.match(usersPage, /resettable\.has\(row\.id\)/);
  assert.match(component, /Reason for reset/);
  assert.match(component, /name="confirmed" type="checkbox" required/);
  assert.match(component, /Copy Password/);
  assert.match(component, /only be shown once/i);
  assert.match(component, /required to create a new password/i);
  assert.match(component, /setTemporaryPassword\(""\)/);
  assert.doesNotMatch(component, /old password|existing password.*display/i);
  assert.doesNotMatch(component, /localStorage|sessionStorage|URLSearchParams/);
});

