import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { userUpdateSchema } from "../src/modules/common/schemas.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Phase 1 config disables X-Powered-By and configures restrictive production headers", () => {
  const config = read("next.config.mjs");
  assert.match(config, /poweredByHeader:\s*false/);
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"])
    assert.ok(config.includes(directive));
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /max-age=31536000/);
});

test("user PATCH schema is strict and permits only supported fields", () => {
  assert.equal(userUpdateSchema.safeParse({ firstName: "Ada", phone: null, status: "INACTIVE" }).success, true);
  assert.equal(userUpdateSchema.safeParse({ organization_id: "other" }).success, false);
  assert.equal(userUpdateSchema.safeParse({ roleCode: "SUPER_ADMIN" }).success, false);
  assert.equal(userUpdateSchema.safeParse({ password: "not-allowed" }).success, false);
  assert.equal(userUpdateSchema.safeParse({ status: "DISABLED" }).success, false);
  assert.equal(userUpdateSchema.safeParse({}).success, false);
});

test("failed login audit records only safe metadata", () => {
  const source = read("src/modules/auth/auth.service.js");
  assert.match(source, /action:"USER_LOGIN_FAILED"/);
  assert.match(source, /attemptedEmail:email/);
  assert.match(source, /reason:"INVALID_CREDENTIALS"/);
  const failedAudit = source.match(/action:"USER_LOGIN_FAILED"(.*?)return null/)?.[1] || "";
  assert.doesNotMatch(failedAudit, /password|token/i);
});

test("user PATCH is transactional, audited, and revokes newly inactive user sessions", () => {
  const source = read("src/app/api/v1/users/[id]/route.js");
  assert.match(source, /parse\(userUpdateSchema/);
  assert.match(source, /withTransaction/);
  assert.match(source, /action: "USER_UPDATED"/);
  assert.match(source, /current\.status === "ACTIVE" && next\.status !== "ACTIVE"/);
  assert.match(source, /revokeUserSessions/);
});

test("health response does not disclose database state", () => {
  const source = read("src/app/api/health/route.js");
  assert.match(source, /NextResponse\.json\(\{status:"ok"\}\)/);
  assert.doesNotMatch(source, /database:"connected"|database:"unavailable"/);
});
