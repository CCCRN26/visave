import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canGroupAction, GROUP_ACTION } from "../src/modules/group-access/group-access.service.js";
import { closeMeeting } from "../src/modules/meetings/meeting.service.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const user = (roles = ["VSLA_MEMBER"], permissions = []) => ({
  id: "user-1", organization_id: "org-1", roles, permissions,
});
const context = (overrides = {}) => ({
  operation_mode: "PROGRAM_ASSISTED",
  linked_member_id: null,
  member_status: null,
  active_cycle_id: "cycle-1",
  cycle_membership_id: null,
  cycle_status: "ACTIVE",
  officer_position: null,
  isChairperson: false,
  isRecordKeeper: false,
  has_program_scope: false,
  is_assigned_facilitator: false,
  is_active_facilitator: false,
  has_facilitator_scope: false,
  ...overrides,
});
const currentOfficer = (position) => context({
  linked_member_id: "member-1",
  member_status: "ACTIVE",
  cycle_membership_id: "membership-1",
  officer_position: position,
  isChairperson: position === "CHAIRPERSON",
  isRecordKeeper: position === "RECORD_KEEPER",
});

function closeHarness(actor, { status = "OPEN", unmarked = 0, reconciliation = true } = {}) {
  let updates = 0;
  const meeting = {
    id: "meeting-1", group_id: "group-1", cycle_id: "cycle-1", organization_id: "org-1",
    status, meeting_mode: "PHYSICAL", google_meet_space_name: null,
  };
  const client = { query: async (sql) => {
    if (sql.includes("FROM vsla_groups g")) return { rows: [actor] };
    if (sql.includes("SELECT cy.id FROM vsla_cycles")) return { rows: [{ id: "cycle-1" }] };
    if (sql.includes("FROM vsla_cycles cy JOIN vsla_meetings")) return { rows: [{ ...meeting, group_status: "ACTIVE", cycle_status: "ACTIVE" }] };
    if (sql.includes("attendance_status='UNMARKED'")) return { rows: [{ n: unmarked }] };
    if (sql.includes("FROM meeting_reconciliations r")) return { rows: reconciliation ? [{
      id: "reconciliation-1", savings_loan_difference: "0.00", social_fund_difference: "0.00",
      expected_savings_loan_balance: "100.00", expected_social_fund_balance: "20.00",
    }] : [] };
    if (sql.includes("account_code='SAVINGS_LOAN_CASH'")) return { rows: [{ savings_loan: "100.00", social_fund: "20.00" }] };
    if (sql.includes("UPDATE vsla_meetings SET status='CLOSED'")) { updates += 1; return { rows: [{ ...meeting, status: "CLOSED" }] }; }
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (sql.includes("WITH meeting_totals AS")) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { client, get updates() { return updates; } };
}

test("Program Assisted close allows only Super Admin, assigned Facilitator, and current digital Chairperson", () => {
  assert.equal(canGroupAction(user(["SUPER_ADMIN"]), context(), GROUP_ACTION.MEETING_CLOSE), true);
  assert.equal(canGroupAction(user(["FACILITATOR"]), context({
    is_assigned_facilitator: true, is_active_facilitator: true, has_facilitator_scope: true,
  }), GROUP_ACTION.MEETING_CLOSE), true);
  assert.equal(canGroupAction(user(), currentOfficer("CHAIRPERSON"), GROUP_ACTION.MEETING_CLOSE), true);

  const denied = [
    ["PROJECT_ADMIN", context({ has_program_scope: true })],
    ["STATE_COORDINATOR", context({ has_program_scope: true })],
    ["FACILITATOR", context({ is_active_facilitator: true, has_facilitator_scope: true })],
    ["FACILITATOR", context({ is_assigned_facilitator: true, is_active_facilitator: false, has_facilitator_scope: true })],
    ["VSLA_MEMBER", currentOfficer("RECORD_KEEPER")],
    ["VSLA_MEMBER", currentOfficer("BOX_KEEPER")],
    ["VSLA_MEMBER", currentOfficer("MONEY_COUNTER_1")],
    ["VSLA_MEMBER", currentOfficer("MONEY_COUNTER_2")],
    ["VSLA_MEMBER", context()],
    ["VSLA_MEMBER", context({ linked_member_id: "former-chair", member_status: "ACTIVE", officer_position: "CHAIRPERSON", isChairperson: true })],
    ["VSLA_MEMBER", context()],
  ];
  for (const [role, actor] of denied) {
    assert.equal(canGroupAction(user([role], ["meeting.manage"]), actor, GROUP_ACTION.MEETING_CLOSE), false, role);
  }
});

test("Member Managed close policy remains identical to existing meeting-operation policy", () => {
  const actors = [
    currentOfficer("CHAIRPERSON"), currentOfficer("RECORD_KEEPER"), currentOfficer("BOX_KEEPER"), context(),
    context({ is_assigned_facilitator: true, is_active_facilitator: true, has_facilitator_scope: true }),
    context({ has_program_scope: true }),
  ].map((actor) => ({ ...actor, operation_mode: "MEMBER_MANAGED" }));
  const users = [user(), user(["FACILITATOR"]), user(["PROJECT_ADMIN"], ["meeting.manage"]), user(["SUPER_ADMIN"], ["meeting.manage"])];
  for (const actor of actors) for (const actorUser of users) {
    assert.equal(
      canGroupAction(actorUser, actor, GROUP_ACTION.MEETING_CLOSE),
      canGroupAction(actorUser, actor, GROUP_ACTION.MEETING_OPERATE),
    );
  }
});

test("each allowed Program Assisted actor closes an otherwise valid meeting through the service", async () => {
  const cases = [
    [user(["SUPER_ADMIN"]), context()],
    [user(["FACILITATOR"]), context({ is_assigned_facilitator: true, is_active_facilitator: true, has_facilitator_scope: true })],
    [user(), currentOfficer("CHAIRPERSON")],
  ];
  for (const [actorUser, actor] of cases) {
    const harness = closeHarness(actor);
    const result = await closeMeeting("group-1", "meeting-1", actorUser, {
      transaction: (work) => work(harness.client),
      smsOptions: { env: { TWILIO_SMS_ENABLED: "false" }, log: () => {} },
    });
    assert.equal(result.status, "CLOSED");
    assert.equal(harness.updates, 1);
  }
});

test("authorized actors cannot bypass meeting state, attendance, or signed reconciliation requirements", async () => {
  const chair = currentOfficer("CHAIRPERSON");
  for (const [options, expected] of [
    [{ status: "CLOSED" }, /Meeting is not open/],
    [{ unmarked: 1 }, /All attendance must be marked/],
    [{ reconciliation: false }, /balanced signed reconciliation/],
  ]) {
    const harness = closeHarness(chair, options);
    await assert.rejects(
      closeMeeting("group-1", "meeting-1", user(), { transaction: (work) => work(harness.client) }),
      expected,
    );
    assert.equal(harness.updates, 0);
  }
});

test("direct close service invocation rejects an unauthorized Program Assisted actor with 403 before lifecycle mutation", async () => {
  let queries = 0;
  const client = { query: async (sql) => {
    queries += 1;
    if (sql.includes("FROM vsla_groups g")) return { rows: [context({ has_program_scope: true })] };
    throw new Error(`Close progressed past authorization: ${sql}`);
  } };
  await assert.rejects(
    closeMeeting("group-1", "meeting-1", user(["PROJECT_ADMIN"], ["meeting.manage"]), {
      transaction: (work) => work(client),
    }),
    (error) => error.statusCode === 403 && error.code === "FORBIDDEN",
  );
  assert.equal(queries, 1);
});

test("close UI is unique and follows Transaction History and the Loan section", () => {
  const component = read("../src/components/meeting-mode.js");
  const page = read("../src/app/(protected)/groups/[id]/meetings/[meetingId]/page.js");
  assert.equal((component.match(/<h2>6\. Close Meeting<\/h2>/g) || []).length, 1);
  assert.ok(component.indexOf("{children}") < component.indexOf("<h2>6. Close Meeting</h2>"));
  assert.ok(component.indexOf("Transaction History") < component.indexOf("{children}"));
  assert.match(page, /<MeetingMode[\s\S]*<MeetingLoans[\s\S]*<\/MeetingMode>/);
  assert.match(page, /close: canGroupAction\(user, actor, GROUP_ACTION\.MEETING_CLOSE\)/);
});

test("close endpoint delegates to service enforcement and close service preserves lifecycle, signature, and audit gates", () => {
  const route = read("../src/app/api/v1/groups/[id]/meetings/[meetingId]/close/route.js");
  const service = read("../src/modules/meetings/meeting.service.js");
  const closeout = read("../src/app/(protected)/groups/[id]/cycles/[cycleId]/closeout/page.js");
  assert.match(route, /requireAuth/);
  assert.match(route, /closeMeeting\(id,meetingId,u\)/);
  assert.doesNotMatch(route, /MEETING_OPERATE/);
  assert.match(service, /assertMeetingClose\(user,groupId,c\)/);
  assert.match(service, /m\.status!=='OPEN'/);
  assert.match(service, /attendance_status='UNMARKED'/);
  assert.match(service, /reconciliation_signatures/);
  assert.match(service, /Reconciliation has a variance or became stale/);
  assert.match(service, /action:'MEETING_CLOSED'/);
  assert.match(closeout, /finishMeeting: canGroupAction\(user, actor, GROUP_ACTION\.MEETING_CLOSE\)/);
});
