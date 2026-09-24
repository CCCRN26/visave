export async function summaryRecipients(client, meeting) {
  return (await client.query(`
    WITH meeting_totals AS (
      SELECT COALESCE(SUM(CASE st.transaction_kind WHEN 'PURCHASE' THEN st.amount WHEN 'REVERSAL' THEN -st.amount ELSE 0 END),0)::numeric(18,2) meeting_total_savings
      FROM savings_transactions st
      WHERE st.group_id=$1 AND st.cycle_id=$2 AND st.meeting_id=$3
    ), loan_totals AS (
      SELECT COALESCE(SUM(CASE le.entry_side WHEN 'DEBIT' THEN le.amount ELSE -le.amount END),0)::numeric(18,2) meeting_total_loans_disbursed
      FROM financial_transactions ft
      JOIN ledger_entries le ON le.financial_transaction_id=ft.id
      JOIN ledger_accounts la ON la.id=le.ledger_account_id AND la.account_code='LOANS_RECEIVABLE'
      WHERE ft.group_id=$1 AND ft.cycle_id=$2 AND ft.meeting_id=$3
        AND ft.transaction_type IN ('LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL')
    ), group_savings AS (
      SELECT COALESCE(SUM(CASE st.transaction_kind WHEN 'PURCHASE' THEN st.amount WHEN 'REVERSAL' THEN -st.amount ELSE 0 END),0)::numeric(18,2) group_total_savings
      FROM savings_transactions st WHERE st.group_id=$1 AND st.cycle_id=$2
    )
    SELECT ma.member_id,gm.phone,concat_ws(' ',gm.first_name,gm.middle_name,gm.last_name) member_name,
      mt.meeting_total_savings,lt.meeting_total_loans_disbursed,gs.group_total_savings,
      COALESCE((SELECT SUM(CASE st.transaction_kind WHEN 'PURCHASE' THEN st.amount WHEN 'REVERSAL' THEN -st.amount ELSE 0 END)
        FROM savings_transactions st WHERE st.group_id=$1 AND st.cycle_id=$2 AND st.member_id=ma.member_id),0)::numeric(18,2) member_total_savings
    FROM meeting_attendance ma
    JOIN cycle_memberships cm ON cm.group_id=ma.group_id AND cm.cycle_id=ma.cycle_id AND cm.member_id=ma.member_id
      AND cm.participation_start_date<=$4::date AND (cm.participation_end_date IS NULL OR cm.participation_end_date>=$4::date)
    JOIN group_members gm ON gm.id=ma.member_id AND gm.group_id=ma.group_id
    CROSS JOIN meeting_totals mt CROSS JOIN loan_totals lt CROSS JOIN group_savings gs
    WHERE ma.group_id=$1 AND ma.cycle_id=$2 AND ma.meeting_id=$3 AND ma.attendance_status='PRESENT'
    ORDER BY gm.member_number,gm.member_code`, [meeting.group_id, meeting.cycle_id, meeting.id, meeting.meeting_date])).rows;
}

export async function insertSummary(client, record) {
  return (await client.query(`
    INSERT INTO meeting_notifications(organization_id,group_id,cycle_id,meeting_id,member_id,notification_type,channel,recipient_phone,payload,status,provider)
    VALUES($1,$2,$3,$4,$5,'MEETING_SUMMARY','SMS',$6,$7::jsonb,$8,'TWILIO')
    ON CONFLICT(meeting_id,member_id,notification_type) DO NOTHING
    RETURNING *`, [record.organizationId, record.groupId, record.cycleId, record.meetingId, record.memberId, record.recipientPhone, JSON.stringify(record.payload), record.status])).rows[0] || null;
}

export async function reserveTrialNotifications(client, meetingId, limit) {
  const rows = (await client.query(`
    SELECT n.* FROM meeting_notifications n JOIN vsla_meetings m ON m.id=n.meeting_id
    WHERE n.meeting_id=$1 AND m.status='CLOSED' AND n.status='PENDING' AND n.recipient_phone IS NOT NULL
    ORDER BY n.created_at,n.id FOR UPDATE OF n`, [meetingId])).rows;
  if (!rows.length || limit<1) return [];
  const selected = rows.slice(0, limit);
  const limited = rows.slice(limit);
  if (limited.length) await client.query(`UPDATE meeting_notifications SET status='SKIPPED_TRIAL_LIMIT',updated_at=now() WHERE id=ANY($1::uuid[])`, [limited.map((row) => row.id)]);
  const reserved = [];
  for (const row of selected) {
    const updated = (await client.query(`UPDATE meeting_notifications SET status='PROCESSING',attempt_count=attempt_count+1,updated_at=now() WHERE id=$1 AND status='PENDING' RETURNING *`, [row.id])).rows[0];
    if (updated) reserved.push(updated);
  }
  return reserved;
}

export async function finishSubmission(client, id, sid, providerRecipientPhone) {
  await client.query(`UPDATE meeting_notifications SET status='SUBMITTED',provider_message_sid=$2,provider_recipient_phone=$3,provider_error_code=NULL,provider_error_message=NULL,submitted_at=now(),updated_at=now() WHERE id=$1 AND status='PROCESSING'`, [id, sid, providerRecipientPhone]);
}

export async function finishFailure(client, id, code, message, providerRecipientPhone) {
  await client.query(`UPDATE meeting_notifications SET status='FAILED',provider_recipient_phone=$4,provider_error_code=$2,provider_error_message=$3,updated_at=now() WHERE id=$1 AND status='PROCESSING'`, [id, code, message, providerRecipientPhone]);
}

export async function failPendingForMeeting(client, meetingId, code) {
  await client.query(`UPDATE meeting_notifications SET status='FAILED',provider_error_code=$2,provider_error_message='SMS notification is not approved or configured for delivery.',updated_at=now() WHERE meeting_id=$1 AND status='PENDING' AND recipient_phone IS NOT NULL`, [meetingId, code]);
}
