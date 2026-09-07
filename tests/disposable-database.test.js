import test from "node:test";
import assert from "node:assert/strict";
import { databaseUrlFor, requireDisposableDatabaseName } from "../scripts/lib/disposable-database.js";

test("only the two explicit disposable databases are accepted", () => {
  assert.equal(requireDisposableDatabaseName("cccrn_vsla_acceptance"), "cccrn_vsla_acceptance");
  assert.equal(requireDisposableDatabaseName("cccrn_vsla_upgrade_acceptance"), "cccrn_vsla_upgrade_acceptance");
  for (const name of ["", "cccrn_vsla_demo", "cccrn_vsla", "production", "cccrn_vsla_acceptance_typo"])
    assert.throws(() => requireDisposableDatabaseName(name), /required|Refusing/);
});

test("database URL construction never substitutes a fallback target", () => {
  assert.equal(databaseUrlFor("postgres://user:pass@localhost:5432/postgres", "cccrn_vsla_upgrade_acceptance").pathname, "/cccrn_vsla_upgrade_acceptance");
  assert.throws(() => databaseUrlFor("postgres://user:pass@localhost:5432/postgres", undefined), /required/);
});
