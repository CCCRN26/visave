import { pool } from "@/lib/db/pool";
import { AuthorizationError } from "@/lib/errors";
import { isGoogleMeetUrl } from "@/modules/meetings/meeting-url";

export async function listMyMeetings(user, client = pool) {
  const rows = (await client.query(
    `SELECT vm.id,vm.group_id,g.name group_name,g.group_code,vm.meeting_number,
       vm.meeting_code,vm.meeting_date,vm.status,vm.meeting_mode,ma.attendance_status
     FROM group_members m
     JOIN meeting_attendance ma ON ma.member_id=m.id AND ma.group_id=m.group_id
     JOIN vsla_meetings vm ON vm.id=ma.meeting_id AND vm.group_id=m.group_id
     JOIN vsla_groups g ON g.id=vm.group_id AND g.organization_id=vm.organization_id
     WHERE m.linked_user_id=$1 AND m.organization_id=$2
     ORDER BY vm.meeting_date DESC,vm.meeting_number DESC`,
    [user.id, user.organization_id],
  )).rows;
  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    groupCode: row.group_code,
    meetingNumber: row.meeting_number,
    meetingCode: row.meeting_code,
    meetingDate: row.meeting_date,
    status: row.status,
    meetingMode: row.meeting_mode || "PHYSICAL",
    attendanceStatus: row.attendance_status,
  }));
}

export async function getMyMeeting(groupId, meetingId, user, client = pool) {
  const access = (await client.query(
    `SELECT vm.id,vm.group_id,g.name group_name,g.group_code,vm.meeting_number,
       vm.meeting_code,vm.meeting_date,vm.status,vm.meeting_mode,vm.virtual_meeting_url,
       ma.attendance_status,m.id member_id
     FROM group_members m
     JOIN meeting_attendance ma ON ma.member_id=m.id AND ma.group_id=m.group_id
     JOIN vsla_meetings vm ON vm.id=ma.meeting_id AND vm.group_id=m.group_id
     JOIN vsla_groups g ON g.id=vm.group_id AND g.organization_id=vm.organization_id
     WHERE vm.id=$1 AND vm.group_id=$2 AND vm.organization_id=$3
       AND m.linked_user_id=$4`,
    [meetingId, groupId, user.organization_id, user.id],
  )).rows[0];
  if (!access) throw new AuthorizationError("This meeting is not available for your membership.");

  const [contributionRows, totals] = await Promise.all([
    client.query(
      `SELECT a.member_id,CONCAT_WS(' ',m.first_name,m.middle_name,m.last_name) member_name,
         COALESCE((SELECT SUM(CASE s.transaction_kind WHEN 'PURCHASE' THEN s.amount ELSE -s.amount END)
           FROM savings_transactions s WHERE s.meeting_id=$1 AND s.member_id=a.member_id),0)::numeric(18,2) savings_amount,
         COALESCE((SELECT SUM(CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN sf.amount ELSE -sf.amount END)
           FROM social_fund_transactions sf WHERE sf.meeting_id=$1 AND sf.member_id=a.member_id),0)::numeric(18,2) social_fund_amount
       FROM meeting_attendance a
       JOIN group_members m ON m.id=a.member_id AND m.group_id=a.group_id
       WHERE a.meeting_id=$1
       ORDER BY m.member_number`,
      [meetingId],
    ),
    client.query(
      `SELECT
         COALESCE((SELECT SUM(CASE transaction_kind WHEN 'PURCHASE' THEN amount ELSE -amount END)
           FROM savings_transactions WHERE meeting_id=$1),0)::numeric(18,2) meeting_savings_total,
         COALESCE((SELECT SUM(CASE transaction_kind WHEN 'CONTRIBUTION' THEN amount ELSE -amount END)
           FROM social_fund_transactions WHERE meeting_id=$1),0)::numeric(18,2) meeting_social_fund_total`,
      [meetingId],
    ).then((result) => result.rows[0]),
  ]);
  const contributions = contributionRows.rows;
  const own = contributions.find((row) => row.member_id === access.member_id);
  const mayJoin = access.status === "OPEN"
    && ["VIRTUAL", "HYBRID"].includes(access.meeting_mode)
    && isGoogleMeetUrl(access.virtual_meeting_url);

  return {
    meeting: {
      id: access.id,
      groupId: access.group_id,
      groupName: access.group_name,
      groupCode: access.group_code,
      meetingNumber: access.meeting_number,
      meetingCode: access.meeting_code,
      meetingDate: access.meeting_date,
      status: access.status,
      meetingMode: access.meeting_mode || "PHYSICAL",
      attendanceStatus: access.attendance_status,
      joinUrl: mayJoin ? access.virtual_meeting_url : null,
    },
    summary: {
      meetingSavingsTotal: totals.meeting_savings_total,
      meetingSocialFundTotal: totals.meeting_social_fund_total,
      ownSavings: own?.savings_amount || "0.00",
      ownSocialFund: own?.social_fund_amount || "0.00",
    },
    contributions: contributions.map((row) => ({
      memberName: row.member_name,
      savingsAmount: row.savings_amount,
      socialFundAmount: row.social_fund_amount,
    })),
    refreshedAt: new Date().toISOString(),
  };
}
