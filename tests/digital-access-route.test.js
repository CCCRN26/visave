import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const routePath = "src/app/api/v1/groups/[id]/members/[memberId]/digital-access/route.js";
const componentPath = "src/components/member-digital-access.js";

test("canonical digital-access App Router handler exposes POST and DELETE", () => {
  const route = fs.readFileSync(routePath, "utf8");
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /const \{ id, memberId \} = await params/);
  assert.match(route, /GROUP_ACTION\.DIGITAL_ACCESS_MANAGE/);
  assert.match(route, /enableDigitalAccess\(id, memberId/);
  assert.match(route, /disableDigitalAccess\(id, memberId/);
});

test("digital-access client calls only the canonical route", () => {
  const component = fs.readFileSync(componentPath, "utf8");
  assert.match(component, /`\/api\/v1\/groups\/\$\{groupId\}\/members\/\$\{member\.id\}\/digital-access`/);
  assert.equal((component.match(/\/digital-access`/g) || []).length, 2);
});

test("create and disable submissions always clear busy state and tolerate non-JSON errors", () => {
  const component = fs.readFileSync(componentPath, "utf8");
  assert.match(component, /headers\.get\("content-type"\).*includes\("application\/json"\)/);
  assert.match(component, /response\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(component, /Unable to create login\. Please try again\./);
  assert.match(component, /Unable to disable digital access\. Please try again\./);
  assert.equal((component.match(/finally \{\s*setBusy\(false\);\s*\}/g) || []).length, 2);
});
