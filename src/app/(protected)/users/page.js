import { requireAuth } from "@/lib/auth/session";
import { query } from "@/lib/db/query";
import { formatDateTime } from "@/lib/utils/date";
import DataTable from "@/components/data-table";

export default async function Users() {
  const user = await requireAuth();
  const rows = await query(
    `SELECT
       u.id,
       CONCAT_WS(' ', u.first_name, u.last_name) AS display_name,
       u.email,
       u.phone,
       u.status,
       u.last_login_at,
       STRING_AGG(DISTINCT r.code, ', ') AS role_codes,
       STRING_AGG(DISTINCT p.name, ', ') AS project_names,
       STRING_AGG(DISTINCT s.name, ', ') AS state_names
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN projects p ON p.id = ur.project_id
     LEFT JOIN states s ON s.id = ur.state_id
     WHERE u.organization_id = $1
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT 20`,
    [user.organization_id],
  );
  const columns = [
    { key: "display_name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "role_codes", label: "Role" },
    { key: "project_names", label: "Project" },
    { key: "state_names", label: "State" },
    { key: "status", label: "Status" },
    { key: "last_login_at", label: "Last Login", render: (row) => formatDateTime(row.last_login_at) },
  ];
  return <><h1>Users</h1><p className="muted">Accounts, roles, projects, and location scope.</p><DataTable rows={rows} columns={columns} /></>;
}
