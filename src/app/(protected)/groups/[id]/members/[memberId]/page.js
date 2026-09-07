import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getMember } from "@/modules/onboarding/onboarding.service";
import { pool } from "@/lib/db/pool";
import { memberCycleHistory, memberCurrentCycleSummary } from "@/modules/onboarding/member-profile.repository";
import { query } from "@/lib/db/query";
import { POSITION_LABELS } from "@/modules/onboarding/constants";
import GroupNav from "@/components/group-nav";
import MemberDigitalAccess from "@/components/member-digital-access";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/money";

export default async function Member({ params }) {
  const { id, memberId } = await params;
  const user = await requireAuth();
  const actor = await requireGroupRouteAction(user, id, "member.view", GROUP_ACTION.MEMBER_VIEW);
  const member = await getMember(id, memberId);
  const officerLabel = POSITION_LABELS[member.position_code];
  const fields = [
    ["Member Code", member.member_code],
    ["Sex", member.sex],
    ["Date of Birth", formatDate(member.date_of_birth)],
    ["Phone", member.phone],
    ["Date Joined", formatDate(member.date_joined)],
    ["Status", member.status],
    ["Officer Position", officerLabel],
    ["Digital Access", member.linked_user_id ? "Enabled" : "Not enabled"],
  ];
  const [summary, cycleHistory] = await Promise.all([
    memberCurrentCycleSummary(pool, id, memberId),
    memberCycleHistory(pool, id, memberId),
  ]);
  const history = await query(
    `SELECT t.*,COALESCE(s.amount,sf.amount,f.amount) amount
    FROM financial_transactions t
    LEFT JOIN savings_transactions s ON s.financial_transaction_id=t.id
    LEFT JOIN social_fund_transactions sf ON sf.financial_transaction_id=t.id
    LEFT JOIN fine_transactions f ON f.financial_transaction_id=t.id
    WHERE t.member_id=$1 AND t.group_id=$2 ORDER BY t.created_at DESC LIMIT 50`,
    [memberId,id],
  );

  return (
    <>
      <h1>{member.first_name} {member.middle_name || ""} {member.last_name}</h1>
      <GroupNav id={id} />
      <div className="panel" style={{ padding: 24 }}>
        {fields.map(([label, value]) => <p key={label}><b>{label}:</b> {value || "—"}</p>)}
      </div>
      <div className="panel" style={{ padding: 24, marginTop: 20 }}>
        <h2>Cycle participation</h2>
        {cycleHistory.map((cycle) => <p key={cycle.id}>
          Cycle {cycle.cycle_number}: {cycle.participates ? "Participating" : "Not participating"}
          {cycle.status === "ACTIVE" ? " (current cycle)" : ""}
        </p>)}
      </div>
      <MemberDigitalAccess
        groupId={id}
        member={member}
        officerLabel={officerLabel}
        canManage={user.permissions.includes("member_access.manage") && canGroupAction(user, actor, GROUP_ACTION.DIGITAL_ACCESS_MANAGE)}
      />
      <div className="grid cards" style={{ marginTop: 20 }}>
        {[
          ["Current Cycle Shares", summary.shares],
          ["Current Cycle Loans", summary.loans],
          ["Current Cycle Savings", formatCurrency(summary.savings)],
          ["Current Cycle Social Fund", formatCurrency(summary.social)],
          ["Current Cycle Fines", formatCurrency(summary.fines)],
        ].map(([label, value]) => (
          <article className="panel" style={{ padding: 18 }} key={label}>
            <small className="muted">{label}</small><h3>{value}</h3>
          </article>
        ))}
      </div>
      <div className="panel table-wrap" style={{ marginTop: 20 }}>
        <h2 style={{ padding: "0 16px" }}>Financial history</h2>
        <table>
          <thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Amount</th></tr></thead>
          <tbody>{history.map((entry) => (
            <tr key={entry.id}>
              <td>{formatDateTime(entry.created_at)}</td><td>{entry.reference_code}</td>
              <td>{entry.transaction_type}</td><td>{formatCurrency(entry.amount)}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="muted" style={{ padding: 16 }}>Loan activity is available from the group Loans workspace.</p>
      </div>
    </>
  );
}
