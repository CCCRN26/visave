import test from "node:test";
import assert from "node:assert/strict";
import { assertRoleAssignment } from "../src/modules/users/user-access.service.js";

const client = { query: async () => ({ rowCount: 1, rows: [{ id: "target" }] }) };
test("Project Admin cannot assign SUPER_ADMIN", async () => {
  await assert.rejects(assertRoleAssignment(client, { id: "pa", roles: ["PROJECT_ADMIN"] },
    { roleCode: "SUPER_ADMIN", projectId: "project" }), (error) => error.statusCode === 403);
});
test("State Coordinator requires project and state scope", async () => {
  await assert.rejects(assertRoleAssignment(client, { id: "sc", roles: ["STATE_COORDINATOR"] },
    { roleCode: "VSLA_MEMBER", projectId: "project" }), (error) => error.statusCode === 403);
});
test("SUPER_ADMIN may assign supported roles", async () => {
  await assert.doesNotReject(assertRoleAssignment(client, { id: "sa", roles: ["SUPER_ADMIN"] }, { roleCode: "SUPER_ADMIN" }));
});
