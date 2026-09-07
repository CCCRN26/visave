import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { pool } from "@/lib/db/pool";
import { ok, fail } from "@/lib/errors/response";
import { assertUserInManagementScope } from "@/modules/users/user-access.service";

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
    await assertUserInManagementScope(pool, user, id);
    const data = await request.json();
    return ok((await pool.query(`UPDATE users SET first_name=COALESCE($2,first_name),last_name=COALESCE($3,last_name),
      phone=COALESCE($4,phone),status=COALESCE($5,status),updated_at=now() WHERE id=$1
      RETURNING id,first_name,last_name,email,phone,status`, [id, data.firstName, data.lastName, data.phone, data.status])).rows[0]);
  } catch (error) { return fail(error); }
}
