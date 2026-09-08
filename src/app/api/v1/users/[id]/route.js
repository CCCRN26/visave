import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { assertUserInManagementScope } from "@/modules/users/user-access.service";
import { userUpdateSchema } from "@/modules/common/schemas";
import { revokeUserSessions } from "@/modules/auth/auth.repository";

export async function GET(_request, { params }) {
  try {
    const { id } = await params; const user = await requireAuth(); requirePermission(user, "user.view");
    await assertUserInManagementScope(pool, user, id);
    return ok((await pool.query("SELECT id,first_name,last_name,email,phone,status,last_login_at FROM users WHERE id=$1", [id])).rows[0]);
  } catch (error) { return fail(error); }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params; const user = await requireAuth(); requirePermission(user, "user.update");
    const data = parse(userUpdateSchema, await request.json());
    const updated = await withTransaction(async (client) => {
      await assertUserInManagementScope(client, user, id);
      const current = (await client.query("SELECT id,organization_id,first_name,last_name,email,phone,status FROM users WHERE id=$1 AND organization_id=$2 FOR UPDATE", [id, user.organization_id])).rows[0];
      const next = { firstName: data.firstName ?? current.first_name, lastName: data.lastName ?? current.last_name, phone: Object.hasOwn(data, "phone") ? data.phone : current.phone, status: data.status ?? current.status };
      const changed = Object.fromEntries(Object.entries({ firstName: current.first_name, lastName: current.last_name, phone: current.phone, status: current.status }).filter(([key, value]) => next[key] !== value).map(([key, value]) => [key, { before: value, after: next[key] }]));
      const value = (await client.query(`UPDATE users SET first_name=$2,last_name=$3,phone=$4,status=$5,updated_at=now() WHERE id=$1 AND organization_id=$6
        RETURNING id,first_name,last_name,email,phone,status`, [id, next.firstName, next.lastName, next.phone, next.status, user.organization_id])).rows[0];
      if (current.status === "ACTIVE" && next.status !== "ACTIVE") await revokeUserSessions(client, id);
      await writeAudit(client, { organizationId: user.organization_id, actorUserId: user.id, action: "USER_UPDATED", entityType: "USER", entityId: id, oldValues: Object.fromEntries(Object.entries(changed).map(([key, value]) => [key, value.before])), newValues: Object.fromEntries(Object.entries(changed).map(([key, value]) => [key, value.after])) });
      return value;
    });
    return ok(updated);
  } catch (error) { return fail(error); }
}
