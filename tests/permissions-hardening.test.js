import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
test("protected pages and GET APIs use matching resource actions", () => {
  const pairs = [
    ["src/app/(protected)/groups/[id]/members/page.js", "src/app/api/v1/groups/[id]/members/route.js", "MEMBER_VIEW"],
    ["src/app/(protected)/groups/[id]/cycle/page.js", "src/app/api/v1/groups/[id]/cycles/route.js", "CYCLE_VIEW"],
    ["src/app/(protected)/groups/[id]/meetings/page.js", "src/app/api/v1/groups/[id]/meetings/route.js", "MEETING_VIEW"],
    ["src/app/(protected)/groups/[id]/loans/page.js", "src/app/api/v1/groups/[id]/loans/route.js", "LOAN_VIEW"],
    ["src/app/(protected)/groups/[id]/cycles/[cycleId]/shareout/page.js", "src/app/api/v1/groups/[id]/cycles/[cycleId]/shareout/route.js", "SHAREOUT_VIEW"],
  ];
  for (const [page, route, action] of pairs) {
    assert.match(read(page), new RegExp(`GROUP_ACTION\\.${action}`), page);
    assert.match(read(route), new RegExp(`GROUP_ACTION\\.${action}`), route);
  }
});

test("digital access accepts any active member without manufacturing officer eligibility", () => {
  const service = read("src/modules/member-managed/member-managed.service.js");
  assert.match(service, /member\.status!=='ACTIVE'/);
  assert.match(service, /DIGITAL_ACCESS_REQUIRES_ACTIVE_MEMBER/);
  assert.doesNotMatch(service, /DIGITAL_ACCESS_REQUIRES_CURRENT_LEADER/);
  assert.doesNotMatch(service, /INSERT INTO group_officer_assignments/);
});

test("foundation bootstrap is RBAC-only and includes current scoped roles", () => {
  const sql = read("database/bootstrap/001_rbac.sql");
  for (const role of ["SUPER_ADMIN", "PROJECT_ADMIN", "STATE_COORDINATOR", "FACILITATOR", "VSLA_MEMBER"]) assert.match(sql, new RegExp(role));
  assert.doesNotMatch(sql, /INSERT INTO (organizations|projects|users|vsla_groups)/i);
  assert.match(read("package.json"), /"db:bootstrap": "node scripts\/bootstrap\.js"/);
});
