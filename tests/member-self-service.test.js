import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getMyGroupActivity } from "../src/modules/member-self/member-self.service.js";

const user = { id: "user-1", organization_id: "org-1" };
const membership = {
  group_name: "Safe Group", group_status: "ACTIVE", community_name: "Village", lga_name: "LGA", state_name: "State",
  cycle_id: "cycle-1", cycle_number: 1, member_id: "member-self", member_code: "M001", member_status: "ACTIVE",
  member_name: "Member One", officer_position: null,
};

function clientWithMembership(row = membership) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM group_members m")) return { rows: row ? [row] : [] };
      if (sql.includes("savings_shares")) return { rows: [{ savings_shares: "5", savings_amount: "5000.00", social_fund_amount: "200.00", fines_amount: "50.00" }] };
      if (sql.includes("FROM loans l JOIN loan_requests")) return { rows: [] };
      if (sql.includes("FROM cycle_shareouts")) return { rows: [] };
      if (sql.includes("SELECT activity_date")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("member self activity derives member identity from authenticated linked_user_id", async () => {
  const client = clientWithMembership();
  const result = await getMyGroupActivity("group-a", user, client);
  assert.equal(result.membership.memberName, "Member One");
  assert.equal(result.summary.savingsAmount, "5000.00");
  assert.equal("memberId" in result.membership, false);
  assert.equal("cycleId" in result.membership, false);
  assert.match(client.calls[0].sql, /m\.linked_user_id=\$3/);
  assert.deepEqual(client.calls[0].params, ["group-a", "org-1", "user-1"]);
  for (const call of client.calls.slice(1)) assert.deepEqual(call.params, ["group-a", "cycle-1", "member-self"]);
});

test("unlinked or inactive membership is denied before financial queries", async () => {
  const client = clientWithMembership(null);
  await assert.rejects(() => getMyGroupActivity("group-a", user, client), (error) => error.code === "FORBIDDEN");
  assert.equal(client.calls.length, 1);
});

test("self-service API and UI never accept a browser memberId", () => {
  const service = fs.readFileSync("src/modules/member-self/member-self.service.js", "utf8");
  const route = fs.readFileSync("src/app/api/v1/me/groups/[id]/activity/route.js", "utf8");
  const page = fs.readFileSync("src/app/(protected)/my-groups/[id]/my-activity/page.js", "utf8");
  assert.match(service, /linked_user_id=\$3/);
  assert.doesNotMatch(route, /memberId/);
  assert.doesNotMatch(page, /memberId/);
  for (const forbidden of ["record savings", "approve loan", "manage officers"]) assert.doesNotMatch(page.toLowerCase(), new RegExp(forbidden));
});
