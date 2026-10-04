import test from "node:test";
import assert from "node:assert/strict";
import { closeMeeting } from "@/modules/meetings/meeting.service";
import { runTransaction } from "@/lib/db/transaction";

const user = { id: "super-admin", organization_id: "org-1", roles: ["SUPER_ADMIN"], permissions: ["meeting.manage"] };

function harness({ mode = "PROGRAM_ASSISTED", status = "OPEN", unmarked = 0, signed = true, stale = false, auditFailure = false, commitFailure = false } = {}) {
  const events = [], pending = [], committed = [];
  let meetingStatus = status;
  const meeting = { id: "meeting-1", organization_id: "org-1", group_id: "group-1", cycle_id: "cycle-1",
    meeting_number: 1, meeting_date: "2026-10-01", google_meet_space_name: "spaces/test", status };
  const client = {
    release() { events.push("RELEASE"); },
    async query(sql, params) {
      if (sql === "BEGIN") { events.push("BEGIN"); return { rows: [] }; }
      if (sql === "COMMIT") {
        events.push("COMMIT");
        if (commitFailure) throw new Error("commit failed");
        committed.push(...pending);
        meetingStatus = "CLOSED";
        return { rows: [] };
      }
      if (sql === "ROLLBACK") { events.push("ROLLBACK"); pending.length = 0; return { rows: [] }; }
      if (sql.includes("FROM vsla_groups g")) return { rows: [{ operation_mode: mode }] };
      if (sql.includes("SELECT cy.id FROM vsla_cycles")) return { rows: [{ id: meeting.cycle_id }] };
      if (sql.includes("FROM vsla_cycles cy JOIN vsla_meetings")) return { rows: [{ ...meeting, status: meetingStatus, cycle_status: "ACTIVE", group_status: "ACTIVE" }] };
      if (sql.includes("attendance_status='UNMARKED'")) return { rows: [{ n: unmarked }] };
      if (sql.includes("FROM meeting_reconciliations r")) {
        assert.match(sql, /EXISTS.*reconciliation_signatures/);
        return { rows: signed ? [{ savings_loan_difference: stale ? "1.00" : "0.00", social_fund_difference: "0.00",
          expected_savings_loan_balance: "100.00", expected_social_fund_balance: "20.00" }] : [] };
      }
      if (sql.includes("account_code='SAVINGS_LOAN_CASH'")) return { rows: [{ savings_loan: "100.00", social_fund: "20.00" }] };
      if (sql.includes("UPDATE vsla_meetings SET status='CLOSED'")) { events.push("CLOSE"); return { rows: [{ ...meeting, status: "CLOSED" }] }; }
      if (sql.includes("INSERT INTO audit_logs")) {
        assert.equal(params[2], "MEETING_CLOSED");
        events.push("AUDIT");
        if (auditFailure) throw new Error("audit failed");
        return { rows: [] };
      }
      if (sql.includes("WITH meeting_totals AS")) {
        events.push("RECIPIENTS");
        return { rows: [{ member_id: "member-1", phone: "08000000001", member_name: "Fixture",
          meeting_total_savings: "10.00", meeting_total_loans_disbursed: "0.00", group_total_savings: "100.00", member_total_savings: "10.00" }] };
      }
      if (sql.includes("INSERT INTO meeting_notifications")) {
        events.push("OUTBOX");
        pending.push({ id: "outbox-1", status: params[7] });
        return { rows: [pending.at(-1)] };
      }
      throw new Error("Unexpected fixture query");
    },
  };
  const options = {
    transaction: (work) => runTransaction({ connect: async () => client }, work),
    endConference: async () => { assert.equal(meetingStatus, "CLOSED"); events.push("GOOGLE"); },
    processSms: async () => {
      assert.equal(meetingStatus, "CLOSED");
      assert.equal(committed.length, 1);
      events.push("SMS");
    },
  };
  return { events, committed, options, get status() { return meetingStatus; } };
}

test("both operating models persist SMS outbox and audit in the close transaction before post-commit providers", async () => {
  for (const mode of ["PROGRAM_ASSISTED", "MEMBER_MANAGED"]) {
    const h = harness({ mode });
    const result = await closeMeeting("group-1", "meeting-1", user, h.options);
    assert.equal(result.status, "CLOSED");
    assert.deepEqual(h.events, ["BEGIN", "CLOSE", "AUDIT", "RECIPIENTS", "OUTBOX", "COMMIT", "RELEASE", "GOOGLE", "SMS"]);
    assert.equal(h.committed[0].status, "PENDING");
    await assert.rejects(closeMeeting("group-1", "meeting-1", user, h.options), /Meeting is not open/);
    assert.equal(h.committed.length, 1);
  }
});

test("failed validation, audit, or commit never persists SMS records or starts providers", async () => {
  for (const input of [{ unmarked: 1 }, { signed: false }, { stale: true }, { auditFailure: true }, { commitFailure: true }]) {
    const h = harness(input);
    await assert.rejects(closeMeeting("group-1", "meeting-1", user, h.options));
    assert.equal(h.status, "OPEN");
    assert.equal(h.committed.length, 0);
    assert.ok(h.events.includes("ROLLBACK"));
    assert.ok(!h.events.includes("SMS"));
    assert.ok(!h.events.includes("GOOGLE"));
  }
});

test("post-commit SMS failure preserves CLOSED result, outbox, audit, and Google finalization", async () => {
  const h = harness();
  const result = await closeMeeting("group-1", "meeting-1", user, {
    ...h.options, processSms: async () => { throw new Error("synthetic SMS persistence failure"); },
  });
  assert.equal(result.status, "CLOSED");
  assert.equal(result.googleMeetConferenceEnded, true);
  assert.equal(h.committed.length, 1);
  assert.ok(!h.events.includes("ROLLBACK"));
});

test("Google finalization failure still permits independent post-commit SMS processing", async () => {
  const h = harness();
  const result = await closeMeeting("group-1", "meeting-1", user, {
    ...h.options, endConference: async () => { throw new Error("synthetic Google failure"); },
  });
  assert.equal(result.status, "CLOSED");
  assert.match(result.googleMeetWarning, /could not be ended/);
  assert.ok(h.events.includes("SMS"));
});
