import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const component=fs.readFileSync(new URL("../src/components/shareout-panel.js",import.meta.url),"utf8");

test("cycle-end UI presents readiness, deliberate approval, correction history and closure actions",()=>{
  for(const text of ["Share-out readiness","Total net savings","Collected fines","Included members","window.confirm","History","Social Fund carry-forward","Cycle closure readiness","Close cycle","Activate Cycle"])
    assert.ok(component.includes(text),text);
});

test("completed UI cannot render payout reversal and exposes no raw IDs",()=>{
  assert.match(component,/shareout\.status!=="COMPLETED"/);
  assert.doesNotMatch(component,/>\{item\.id\}</);
  assert.match(component,/No Social Fund balance requires carry-forward/);
});
