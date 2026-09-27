import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync("src/components/meeting-loans.js", "utf8");
const service = fs.readFileSync("src/modules/loans/loan.service.js", "utf8");
const approveRoute = fs.readFileSync(
  "src/app/api/v1/groups/[id]/meetings/[meetingId]/loan-requests/[requestId]/approve/route.js",
  "utf8",
);
const rejectRoute = fs.readFileSync(
  "src/app/api/v1/groups/[id]/meetings/[meetingId]/loan-requests/[requestId]/reject/route.js",
  "utf8",
);

test("loan decisions use the canonical approve and reject routes", () => {
  assert.match(component, /call\(`\/loan-requests\/\$\{request\.id\}\/approve`/);
  assert.match(component, /call\(`\/loan-requests\/\$\{request\.id\}\/reject`/);
  assert.match(approveRoute, /export async function POST/);
  assert.match(rejectRoute, /export async function POST/);
});

test("decision routes preserve Chairperson authorization and service enforcement", () => {
  for (const route of [approveRoute, rejectRoute]) {
    assert.match(route, /requireGroupRouteAction\(u,id,'loan\.approve',GROUP_ACTION\.LOAN_DECIDE\)/);
  }
  assert.match(service, /assertGroupAction\(user, groupId, GROUP_ACTION\.LOAN_DECIDE, c\)/);
  assert.match(service, /LOAN_SEPARATION_OF_DUTIES_VIOLATION/);
});

test("approve and reject pass the correct transition to the loan service", () => {
  assert.match(approveRoute, /decideLoan\([^;]+u,'APPROVED'\)/);
  assert.match(rejectRoute, /decideLoan\([^;]+u,'REJECTED'\)/);
  assert.match(service, /UPDATE loan_requests SET status=\$2,updated_at=now\(\) WHERE id=\$1/);
  assert.match(service, /\[r\.id, decision\]/);
});

test("a failed loan action always clears the busy state", () => {
  assert.match(component, /catch \{[\s\S]*The loan action could not be completed\. Please try again\.[\s\S]*\} finally \{\s*setBusy\(false\);/);
  assert.match(component, /response\.json\(\)\.catch\(\(\) => null\)/);
});
