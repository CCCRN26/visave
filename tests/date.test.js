import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateForInput, formatDateTime } from "../src/lib/utils/date.js";
import { renderCellValue } from "../src/lib/utils/render-cell.js";

test("date formatter handles absent and invalid values", () => {
  for (const value of [null, undefined, "", "not-a-date"]) assert.equal(formatDate(value), "—");
});

test("date-only string retains its calendar day", () => {
  assert.equal(formatDate("2026-08-20"), "20 Aug 2026");
  assert.equal(formatDate("2026-08-20T00:00:00.000Z"), "20 Aug 2026");
  assert.notEqual(formatDate("2026-08-20"), "19 Aug 2026");
  assert.notEqual(formatDate("2026-08-20"), "21 Aug 2026");
});

test("date formatter accepts a valid Date object", () => {
  assert.equal(formatDate(new Date(2026, 7, 20)), "20 Aug 2026");
  assert.equal(formatDate(new Date("invalid")), "—");
});

test("date-time formatter uses Africa/Lagos and fails safely", () => {
  const rendered = formatDateTime("2026-08-20T17:35:00.000Z");
  assert.match(rendered, /20 Aug 2026/);
  assert.match(rendered, /6:35/);
  assert.equal(formatDateTime("invalid"), "—");
});

test("date input formatter returns stable YYYY-MM-DD values", () => {
  assert.equal(formatDateForInput("2026-08-20T00:00:00.000Z"), "2026-08-20");
  assert.equal(formatDateForInput(new Date(2026, 7, 20)), "2026-08-20");
  assert.equal(formatDateForInput(null), "");
});

test("table cell fallback safely handles supported values and objects", () => {
  assert.equal(renderCellValue("member"), "member");
  assert.equal(renderCellValue(20), 20);
  assert.equal(renderCellValue(null), "—");
  assert.equal(renderCellValue(true), "Yes");
  assert.equal(renderCellValue(new Date(2026, 7, 20)), "20 Aug 2026");
  assert.equal(renderCellValue({ unexpected: true }), "—");
});
