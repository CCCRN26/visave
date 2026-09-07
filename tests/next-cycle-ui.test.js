import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
test("Cycle page exposes the server-authorized next-cycle action only for CLOSING", () => {
  const page = read("../src/app/(protected)/groups/[id]/cycle/page.js");
  assert.match(page, /capabilities\.CYCLE_MANAGE && latest\?\.status === "CLOSING"/);
  assert.match(page, /NextCyclePanel/);
});
test("onboarding and next-cycle creation share one cycle form contract", () => {
  assert.match(read("../src/components/onboarding-wizard.js"), /CycleScheduleForm/);
  assert.match(read("../src/components/next-cycle-panel.js"), /fixedCycleNumber/);
  assert.match(read("../src/components/cycle-schedule-form.js"), /name="status" value="READY"/);
  assert.match(read("../src/components/cycle-schedule-form.js"), /max=\{endDate \|\| undefined\}/);
  assert.match(read("../src/components/cycle-schedule-form.js"), /Expected Share-out date must be on or before/);
  assert.match(read("../src/components/next-cycle-panel.js"), /readActionResponse/);
});
test("share-out deep-links to the visible next-cycle form", () => assert.match(read("../src/components/shareout-panel.js"), /cycle\?createNext=1/));
test("cycle API translates date-domain failures before repository insertion", () => {
  const route = read("../src/app/api/v1/groups/[id]/cycles/route.js");
  const service = read("../src/modules/onboarding/onboarding.service.js");
  assert.match(route, /INVALID_CYCLE_DATES/);
  assert.match(route, /400/);
  assert.ok(service.indexOf("INVALID_CYCLE_DATES") < service.indexOf("repo.insertCycle"));
});
