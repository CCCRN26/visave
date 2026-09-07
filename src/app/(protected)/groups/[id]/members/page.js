import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import {
  requireGroupRouteAction,
  canGroupAction,
  GROUP_ACTION,
} from "@/modules/group-access/group-access.service";
import { getMembers } from "@/modules/onboarding/onboarding.service";
import { query } from "@/lib/db/query";
import { POSITION_LABELS, MEMBER_LIMITS } from "@/modules/onboarding/constants";
import DataTable from "@/components/data-table";
import GroupNav from "@/components/group-nav";
import MemberCycleJoinPanel from "@/components/member-cycle-join-panel";
import { formatDate } from "@/lib/utils/date";
export default async function Members({ params, searchParams }) {
  const { id } = await params,
    q = await searchParams,
    user = await requireAuth(),
    actor = await requireGroupRouteAction(
      user,
      id,
      "member.view",
      GROUP_ACTION.MEMBER_VIEW,
    ),
    r = await getMembers(id, {
      page: Number(q.page) || 1,
      pageSize: 20,
      search: q.search || "",
      status: q.status,
    }),
    active = (await getMembers(id, { page: 1, pageSize: 1, status: "ACTIVE" }))
      .total,
    cycle = (
      await query(
        `SELECT * FROM vsla_cycles WHERE group_id=$1 AND status='ACTIVE'`,
        [id],
      )
    )[0],
    participants = cycle
      ? await query(
          `SELECT member_id FROM cycle_memberships WHERE cycle_id=$1`,
          [cycle.id],
        )
      : [],
    participantIds = new Set(participants.map((x) => x.member_id)),
    eligible = cycle
      ? await query(
          `SELECT m.id,m.member_code,m.first_name,m.last_name,m.date_joined::text FROM group_members m
           WHERE m.group_id=$1 AND m.status='ACTIVE'
             AND NOT EXISTS(SELECT 1 FROM cycle_memberships cm WHERE cm.cycle_id=$2 AND cm.member_id=m.id)
           ORDER BY m.member_number`,
          [id, cycle.id],
        )
      : [],
    openMeeting = cycle
      ? (
          await query(
            `SELECT id,meeting_number,meeting_date::text FROM vsla_meetings WHERE cycle_id=$1 AND status='OPEN'`,
            [cycle.id],
          )
        )[0]
      : null,
    canManage = canGroupAction(
      user,
      actor,
      GROUP_ACTION.CYCLE_PARTICIPATION_MANAGE,
    );
  return (
    <>
      <h1>Group Members</h1>
      <p className="muted">
        Group Members: {r.total} · Active identities: {active} /{" "}
        {MEMBER_LIMITS.minimum}–{MEMBER_LIMITS.maximum}
        {cycle ? ` · Current Cycle Participants: ${participantIds.size}` : ""}
      </p>
      <GroupNav id={id} />
      {cycle && (
        <MemberCycleJoinPanel
          groupId={id}
          cycle={cycle}
          eligibleMembers={eligible}
          openMeeting={openMeeting}
          canManage={canManage}
        />
      )}
      <form
        className="panel"
        style={{ padding: 14, display: "flex", gap: 10, marginBottom: 15 }}
      >
        <input
          name="search"
          placeholder="Search member"
          defaultValue={q.search}
        />
        <select name="status" defaultValue={q.status || ""}>
          <option value="">All statuses</option>
          {["ACTIVE", "INACTIVE", "LEFT", "REMOVED", "DECEASED"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button>Filter</button>
      </form>
      <DataTable
        rows={r.items}
        columns={[
          { key: "member_code", label: "Member Code" },
          {
            key: "name",
            label: "Name",
            render: (m) => (
              <Link href={`/groups/${id}/members/${m.id}`}>
                {m.first_name} {m.last_name}
              </Link>
            ),
          },
          {
            key: "cycle",
            label: cycle ? `Cycle ${cycle.cycle_number}` : "Participation",
            render: (m) =>
              participantIds.has(m.id) ? "Participating" : "Not participating",
          },
          { key: "sex", label: "Sex" },
          { key: "phone", label: "Phone" },
          {
            key: "date_joined",
            label: "Date Joined",
            render: (m) => formatDate(m.date_joined),
          },
          {
            key: "position_code",
            label: "Officer Position",
            render: (m) => POSITION_LABELS[m.position_code] || "—",
          },
          { key: "status", label: "Group Status" },
        ]}
      />
    </>
  );
}
