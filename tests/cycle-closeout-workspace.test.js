import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canGroupAction, GROUP_ACTION } from "../src/modules/group-access/group-access.service.js";
import { readActionResponse } from "../src/lib/client/safe-response.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("close-out route derives state on the server and exposes all seven guided steps", () => {
  const page = read("../src/app/(protected)/groups/[id]/cycles/[cycleId]/closeout/page.js");
  const component = read("../src/components/cycle-closeout-workspace.js");
  assert.match(page, /getCloseoutWorkspace/);
  assert.match(page, /GROUP_ACTION\.SHAREOUT_VIEW/);
  for (const label of ["Final Meeting", "Share-out", "Next Cycle", "Social Fund", "Final Check", "Close Cycle", "Start Next Cycle"])
    assert.ok(component.includes(label), label);
  assert.match(component, /router\.refresh\(\)/);
  assert.doesNotMatch(component, /wizard_step|localStorage/);
});

test("closed latest meeting is authoritative for Share-out and payouts without a dummy meeting", () => {
  const service = read("../src/modules/shareout/shareout.service.js");
  assert.match(service, /status<>'CANCELLED' ORDER BY meeting_number DESC LIMIT 1/);
  assert.match(service, /state\.meeting_status !== "CLOSED"/);
  assert.match(service, /ctx\.meeting_status !== "CLOSED"/);
  assert.doesNotMatch(service, /ctx\.meeting_status !== "OPEN"/);
  assert.doesNotMatch(read("../src/components/cycle-closeout-workspace.js"), /api\/v1\/groups\/\$\{groupId\}\/meetings[^`]*method.*create/i);
});

test("final-meeting attendance is aggregated independently from reconciliation and loan blockers", () => {
  const service = read("../src/modules/shareout/closeout.service.js");
  assert.match(service, /LEFT JOIN LATERAL\(\s*SELECT COUNT\(\*\)::int member_count/);
  assert.match(service, /FROM meeting_attendance a WHERE a\.meeting_id=m\.id/);
  assert.doesNotMatch(service, /JOIN loan_requests|JOIN loans/);
  assert.doesNotMatch(service, /GROUP BY m\.id,lr\.id/);
});

test("closed meeting UI does not request loan eligibility", () => {
  const component = read("../src/components/meeting-loans.js");
  assert.match(component, /if \(!open \|\| !canRequest \|\| !memberId\) return/);
});

test("workspace reuses existing guarded APIs and preserves deliberate close then activate actions", () => {
  const component = read("../src/components/cycle-closeout-workspace.js");
  for (const endpoint of ["shareout/prepare", "/approve", "/payouts", "/complete", "}/cycles", "social-fund/carry-forward", "final-reconciliation", "/close", "/activate"])
    assert.ok(component.includes(endpoint) || read("../src/components/final-reconciliation-refresh.js").includes(endpoint), endpoint);
  assert.doesNotMatch(component, /close[^\n]+activate[^\n]+Promise\.all/);
  assert.match(component, /Close Cycle/);
  assert.match(component, /Start Cycle/);
});

test("actions use safe response parsing, synchronous double-click locking and stable idempotency keys", () => {
  const component = read("../src/components/cycle-closeout-workspace.js");
  assert.match(component, /readActionResponse/);
  assert.match(component, /if \(lock\.current/);
  assert.match(component, /keyFor\("approve"\)/);
  assert.match(component, /keyFor\("social"\)/);
});

test("safe action response handles an HTML error without JSON parse failure", async () => {
  const result = await readActionResponse(new Response("<!DOCTYPE html><h1>Error</h1>", { status: 500, headers: { "content-type": "text/html" } }));
  assert.equal(result.error.message, "We couldn't complete this action. Please try again.");
  assert.match(result.error.detail, /DOCTYPE/);
});

test("close-out authorization remains action-specific", () => {
  const member = { roles: ["VSLA_MEMBER"] };
  const base = { operation_mode: "MEMBER_MANAGED", cycle_status: "CLOSING", member_status: "ACTIVE", linked_member_id: "member", active_cycle_id: "cycle", has_program_scope: false, is_assigned_facilitator: false, has_facilitator_scope: false };
  const chair = { ...base, officer_position: "CHAIRPERSON", isChairperson: true, isRecordKeeper: false };
  const keeper = { ...base, officer_position: "RECORD_KEEPER", isChairperson: false, isRecordKeeper: true };
  assert.equal(canGroupAction(member, chair, GROUP_ACTION.SHAREOUT_APPROVE), true);
  assert.equal(canGroupAction(member, chair, GROUP_ACTION.CYCLE_CLOSE), true);
  assert.equal(canGroupAction(member, keeper, GROUP_ACTION.SHAREOUT_APPROVE), false);
  assert.equal(canGroupAction(member, keeper, GROUP_ACTION.CYCLE_CLOSE), false);
  assert.equal(canGroupAction(member, keeper, GROUP_ACTION.SHAREOUT_PAYOUT), true);
  assert.equal(canGroupAction(member, keeper, GROUP_ACTION.RECONCILIATION_OPERATE), true);
});
