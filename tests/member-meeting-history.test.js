import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canGroupAction, GROUP_ACTION } from "../src/modules/group-access/group-access.service.js";
import { getMyMeeting, listMyMeetings } from "../src/modules/member-meetings/member-meeting.service.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const user = { id: "user-1", organization_id: "org-1", roles: ["VSLA_MEMBER"], permissions: [] };

function memberMeetingClient({ status = "OPEN", mode = "VIRTUAL", access = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("vm.virtual_meeting_url")) return { rows: access ? [{
        id: "meeting-1", group_id: "group-a", group_name: "Group A", group_code: "GA",
        meeting_number: 4, meeting_code: "GA-C01-M004", meeting_date: "2026-09-26",
        status, meeting_mode: mode, virtual_meeting_url: "https://meet.google.com/abc-defg-hij",
        attendance_status: "PRESENT", member_id: "member-self",
      }] : [] };
      if (sql.includes("CONCAT_WS(' ',m.first_name")) return { rows: [
        { member_id: "member-self", member_name: "Member One", savings_amount: "500.00", social_fund_amount: "50.00" },
        { member_id: "member-two", member_name: "Member Two", savings_amount: "300.00", social_fund_amount: "50.00" },
      ] };
      if (sql.includes("meeting_savings_total")) return { rows: [{ meeting_savings_total: "800.00", meeting_social_fund_total: "100.00" }] };
      if (sql.includes("ORDER BY vm.meeting_date DESC")) return { rows: [{
        id: "meeting-1", group_id: "group-a", group_name: "Group A", group_code: "GA",
        meeting_number: 4, meeting_code: "GA-C01-M004", meeting_date: "2026-09-26",
        status, meeting_mode: mode, attendance_status: "PRESENT",
      }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("digitally enabled member sees Meeting History navigation", () => {
  const sidebar = read("../src/components/sidebar.js");
  assert.match(sidebar, /memberSections[\s\S]*Meeting History[\s\S]*\/my-meetings/);
});

test("member meeting list is derived from linked membership and attendance snapshots", async () => {
  const client = memberMeetingClient();
  const meetings = await listMyMeetings(user, client);
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].groupName, "Group A");
  assert.match(client.calls[0].sql, /m\.linked_user_id=\$1/);
  assert.match(client.calls[0].sql, /JOIN meeting_attendance/);
  assert.deepEqual(client.calls[0].params, ["user-1", "org-1"]);
});

test("member can open own OPEN or CLOSED meeting read-only and cross-group access is denied", async () => {
  for (const status of ["OPEN", "CLOSED"]) {
    const client = memberMeetingClient({ status });
    const result = await getMyMeeting("group-a", "meeting-1", user, client);
    assert.equal(result.meeting.status, status);
    assert.equal(result.contributions[0].memberName, "Member One");
  }
  const denied = memberMeetingClient({ access: false });
  await assert.rejects(
    getMyMeeting("group-b", "meeting-1", user, denied),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(denied.calls.length, 1);
  assert.deepEqual(denied.calls[0].params, ["meeting-1", "group-b", "org-1", "user-1"]);
});

test("member Join URL is available only for OPEN Virtual or Hybrid meetings", async () => {
  for (const mode of ["VIRTUAL", "HYBRID"]) {
    const open = await getMyMeeting("group-a", "meeting-1", user, memberMeetingClient({ status: "OPEN", mode }));
    assert.equal(open.meeting.joinUrl, "https://meet.google.com/abc-defg-hij");
    const closed = await getMyMeeting("group-a", "meeting-1", user, memberMeetingClient({ status: "CLOSED", mode }));
    assert.equal(closed.meeting.joinUrl, null);
  }
  const physical = await getMyMeeting("group-a", "meeting-1", user, memberMeetingClient({ status: "OPEN", mode: "PHYSICAL" }));
  assert.equal(physical.meeting.joinUrl, null);
});

test("member activity uses authoritative posted savings and Social Fund data only", async () => {
  const client = memberMeetingClient();
  const result = await getMyMeeting("group-a", "meeting-1", user, client);
  assert.deepEqual(result.summary, {
    meetingSavingsTotal: "800.00",
    meetingSocialFundTotal: "100.00",
    ownSavings: "500.00",
    ownSocialFund: "50.00",
  });
  assert.match(client.calls[1].sql, /FROM savings_transactions/);
  assert.match(client.calls[1].sql, /FROM social_fund_transactions/);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["phone", "email", "signature", "audit", "loan", "repayment", "fine", "google_meet_space_name"]) {
    assert.doesNotMatch(serialized.toLowerCase(), new RegExp(forbidden));
  }
});

test("member meeting endpoint and polling are GET-only and expose no mutation controls", () => {
  const route = read("../src/app/api/v1/me/groups/[id]/meetings/[meetingId]/route.js");
  const component = read("../src/components/member-meeting-live-view.js");
  const page = read("../src/app/(protected)/my-groups/[id]/meetings/[meetingId]/page.js");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|DELETE)/);
  assert.match(component, /method: "GET"/);
  assert.match(component, /setInterval\(\(\) => refresh\(true\), 12000\)/);
  assert.match(component, /clearInterval/);
  assert.doesNotMatch(`${component}\n${page}`, /MeetingMode|MeetingLoans|\/close|\/savings|\/social-fund|\/loans|\/reconcile/);
});

test("ordinary membership read access does not grant MEETING_OPERATE", () => {
  const context = {
    operation_mode: "MEMBER_MANAGED", linked_member_id: "member-self", member_status: "ACTIVE",
    active_cycle_id: "cycle-1", cycle_membership_id: "membership-1", cycle_status: "ACTIVE",
    officer_position: null, isChairperson: false, isRecordKeeper: false,
    has_program_scope: false, is_assigned_facilitator: false, is_active_facilitator: false, has_facilitator_scope: false,
  };
  assert.equal(canGroupAction(user, context, GROUP_ACTION.MEETING_OPERATE), false);
});
