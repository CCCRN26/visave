import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parse } from "@/lib/validation/parse";
import { listSchema, userSchema } from "@/modules/common/schemas";
import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { ok, fail } from "@/lib/errors/response";
import { assertRoleAssignment, userScopePredicate } from "@/modules/users/user-access.service";

export async function GET(request) {
  try {
    const user = await requireAuth(); requirePermission(user, "user.view");
    const q = parse(listSchema, Object.fromEntries(request.nextUrl.searchParams));
    const scope = userScopePredicate(user, 6);
    const params = [user.organization_id, q.search, q.status || null, q.pageSize, (q.page - 1) * q.pageSize, ...scope.params];
    const rows = (await pool.query(`SELECT u.id,u.first_name,u.last_name,u.email,u.phone,u.status,u.last_login_at,
      string_agg(DISTINCT r.code,', ') roles,string_agg(DISTINCT p.name,', ') projects,string_agg(DISTINCT s.name,', ') states,
      COUNT(*) OVER()::int total FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
      LEFT JOIN projects p ON p.id=ur.project_id LEFT JOIN states s ON s.id=ur.state_id WHERE u.organization_id=$1
      AND ($2='' OR concat(u.first_name,' ',u.last_name) ILIKE '%'||$2||'%' OR u.email ILIKE '%'||$2||'%')
      AND ($3::text IS NULL OR u.status=$3) AND ${scope.sql}
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`, params)).rows;
    return ok({ items: rows, total: rows[0]?.total || 0, page: q.page, pageSize: q.pageSize });
  } catch (error) { return fail(error); }
}

export async function POST(request) {
  try {
    const actor = await requireAuth(); requirePermission(actor, "user.create");
    const data = parse(userSchema, await request.json());
    const value = await withTransaction(async (client) => {
      await assertRoleAssignment(client, actor, data);
      const hash = await bcrypt.hash(data.password, 12);
      const created = (await client.query(`INSERT INTO users(organization_id,first_name,last_name,email,phone,password_hash,status,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,first_name,last_name,email,phone,status`,
      [actor.organization_id, data.firstName, data.lastName, data.email, data.phone || null, hash, data.status, actor.id])).rows[0];
      await client.query(`INSERT INTO user_roles(user_id,role_id,project_id,state_id,created_by)
        SELECT $1,id,$2,$3,$4 FROM roles WHERE code=$5`, [created.id, data.projectId || null, data.stateId || null, actor.id, data.roleCode]);
      await writeAudit(client, { organizationId: actor.organization_id, actorUserId: actor.id, action: "USER_CREATED", entityType: "USER", entityId: created.id, newValues: created });
      return created;
    });
    return ok(value, 201);
  } catch (error) { return fail(error); }
}
