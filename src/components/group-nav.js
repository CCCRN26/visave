import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { getGroupActorContext, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { canAccessCycleReports } from "@/modules/reports/cycle-report.service";
export default async function GroupNav({ id }) {
  const user = await requireAuth();
  const actor = await getGroupActorContext(user, id);
  const canEdit = user.permissions.includes("group.update") && canGroupAction(user, actor, GROUP_ACTION.GROUP_MANAGE);
  const canReport = canAccessCycleReports(user, actor);
  const tabs = [
    ["Overview", `/groups/${id}`],
    ...(canEdit ? [["Edit", `/groups/${id}/edit`]] : []),
    ["Members", `/groups/${id}/members`],
    ["Officers", `/groups/${id}/officers`],
    ["Constitution", `/groups/${id}/constitution`],
    ["Cycle", `/groups/${id}/cycle`],
    ["Meetings", `/groups/${id}/meetings`],
    ["Savings", `/groups/${id}/meetings`],
    ["Loans", `/groups/${id}/loans`],
    ["Social Fund", `/groups/${id}/meetings`],
    ["Share-out", `/groups/${id}/cycle`],
    ...(canReport ? [["Reports", `/groups/${id}/reports`]] : []),
  ];
  return (
    <nav
      className="panel table-wrap"
      style={{ display: "flex", gap: 4, padding: 8, marginBottom: 20 }}
    >
      {tabs.map(([n, h]) => (
        <Link
          key={n}
          href={h}
          style={{
            padding: "9px 12px",
            textDecoration: "none",
            color: "var(--text)",
            whiteSpace: "nowrap",
          }}
        >
          {n}
        </Link>
      ))}
    </nav>
  );
}
