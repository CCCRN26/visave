import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const primitives=fs.readFileSync("src/components/dashboard-primitives.js","utf8");
const view=fs.readFileSync("src/components/dashboard-view.js","utf8");
const css=fs.readFileSync("src/app/globals.css","utf8");

test("all role dashboards share the same explicit KPI card primitive",()=>{
  assert.match(primitives,/function DashboardStatCard/);
  assert.match(primitives,/dashboard-stat-content/);
  assert.match(view,/DashboardStatCard/);
  assert.doesNotMatch(view,/function StatCard/);
  assert.doesNotMatch(css,/dashboard-stat:not\(:has/);
});

test("dashboard exposes scope, loading, error and accessible linked-card states",()=>{
  assert.match(primitives,/DashboardScopeBadge/);
  assert.match(primitives,/DashboardSkeleton/);
  assert.match(primitives,/aria-label/);
  assert.match(css,/dashboard-stat-card>a:focus-visible/);
  assert.ok(fs.existsSync("src/app/(protected)/dashboard/loading.js"));
  assert.ok(fs.existsSync("src/app/(protected)/dashboard/error.js"));
});

test("dashboard card grid defines desktop, tablet and mobile layouts",()=>{
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:1100px\).*dashboard-kpis/);
  assert.match(css,/@media\(max-width:650px\).*dashboard-kpis/);
  assert.match(css,/@media\(max-width:360px\).*dashboard-stat-content/);
});
