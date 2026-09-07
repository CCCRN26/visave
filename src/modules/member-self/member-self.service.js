import { pool } from "../../lib/db/pool.js";
import { AuthorizationError } from "../../lib/errors/index.js";

async function resolveMembership(client, groupId, user, cycleId = null) {
  const cycleFilter=cycleId?'AND cy.id=$4':'';
  const membership = (await client.query(
    `SELECT g.name group_name,g.status group_status,
       COALESCE(NULLIF(TRIM(g.community_name),''),c.name) community_name,
       l.name lga_name,s.name state_name,cy.id cycle_id,cy.cycle_number,
       m.id member_id,m.member_code,m.status member_status,
       CONCAT_WS(' ',m.first_name,m.middle_name,m.last_name) member_name,
       oa.position_code officer_position,(SELECT json_agg(json_build_object('id',hc.id,'cycle_number',hc.cycle_number,'status',hc.status) ORDER BY hc.cycle_number DESC) FROM cycle_memberships hcm JOIN vsla_cycles hc ON hc.id=hcm.cycle_id WHERE hcm.group_id=g.id AND hcm.member_id=m.id) cycle_history
     FROM group_members m
     JOIN vsla_groups g ON g.id=m.group_id AND g.organization_id=m.organization_id
     JOIN cycle_memberships cm ON cm.group_id=g.id AND cm.member_id=m.id
     JOIN vsla_cycles cy ON cy.id=cm.cycle_id ${cycleFilter}
     LEFT JOIN communities c ON c.id=g.community_id
     LEFT JOIN lgas l ON l.id=g.lga_id
     LEFT JOIN states s ON s.id=g.state_id
     LEFT JOIN group_officer_assignments oa ON oa.group_id=g.id AND oa.cycle_id=cy.id
       AND oa.member_id=m.id AND oa.status='ACTIVE'
     WHERE g.id=$1 AND g.organization_id=$2 AND g.status<>'ARCHIVED'
       AND m.linked_user_id=$3 AND m.status='ACTIVE' ORDER BY (cy.status='ACTIVE') DESC,cy.cycle_number DESC LIMIT 1`,
    cycleId?[groupId,user.organization_id,user.id,cycleId]:[groupId,user.organization_id,user.id],
  )).rows[0];
  if (!membership) throw new AuthorizationError("This active membership is not linked to your account.");
  return membership;
}

function publicMembership(membership) {
  return {
    groupName: membership.group_name,
    groupStatus: membership.group_status,
    location: {
      community: membership.community_name || null,
      lga: membership.lga_name || null,
      state: membership.state_name || null,
    },
    cycleNumber: membership.cycle_number,
    memberCode: membership.member_code,
    memberName: membership.member_name,
    membershipStatus: membership.member_status,
    officerPosition: membership.officer_position || null,
  };
}

export async function getMyGroupActivity(groupId, user, client = pool, cycleId = null) {
  const membership = await resolveMembership(client, groupId, user,cycleId);
  const params = [groupId, membership.cycle_id, membership.member_id];
  const [summaryResult, loanResult, shareoutResult, activityResult] = await Promise.all([
    client.query(
      `SELECT
         COALESCE((SELECT SUM(CASE transaction_kind WHEN 'PURCHASE' THEN shares ELSE -shares END) FROM savings_transactions WHERE group_id=$1 AND cycle_id=$2 AND member_id=$3),0)::bigint savings_shares,
         COALESCE((SELECT SUM(CASE transaction_kind WHEN 'PURCHASE' THEN amount ELSE -amount END) FROM savings_transactions WHERE group_id=$1 AND cycle_id=$2 AND member_id=$3),0)::numeric(18,2) savings_amount,
         COALESCE((SELECT SUM(CASE transaction_kind WHEN 'CONTRIBUTION' THEN amount ELSE -amount END) FROM social_fund_transactions WHERE group_id=$1 AND cycle_id=$2 AND member_id=$3),0)::numeric(18,2) social_fund_amount,
         COALESCE((SELECT SUM(CASE transaction_kind WHEN 'FINE' THEN amount ELSE -amount END) FROM fine_transactions WHERE group_id=$1 AND cycle_id=$2 AND member_id=$3),0)::numeric(18,2) fines_amount`,
      params,
    ),
    client.query(
      `SELECT l.principal_disbursed,l.service_charge_rate,l.service_charge_total_due,l.total_contractual_due,
         l.disbursement_date,l.due_date,r.purpose,
         COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYMENT' THEN p.principal_component ELSE -p.principal_component END),0)::numeric(18,2) principal_repaid,
         COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYMENT' THEN p.service_charge_component ELSE -p.service_charge_component END),0)::numeric(18,2) service_charge_repaid,
         COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYMENT' THEN p.payment_amount ELSE -p.payment_amount END),0)::numeric(18,2) amount_repaid,
         (l.principal_disbursed-COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYMENT' THEN p.principal_component ELSE -p.principal_component END),0))::numeric(18,2) principal_outstanding,
         (l.service_charge_total_due-COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYMENT' THEN p.service_charge_component ELSE -p.service_charge_component END),0))::numeric(18,2) service_charge_outstanding,
         (l.total_contractual_due-COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYMENT' THEN p.payment_amount ELSE -p.payment_amount END),0))::numeric(18,2) total_outstanding,
         CASE WHEN l.settled_at IS NOT NULL THEN 'REPAID' WHEN l.defaulted_at IS NOT NULL THEN 'DEFAULTED'
           WHEN CURRENT_DATE>l.due_date THEN 'OVERDUE'
           WHEN COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYMENT' THEN p.payment_amount ELSE -p.payment_amount END),0)>0 THEN 'PARTIALLY_REPAID'
           ELSE 'ACTIVE' END status
       FROM loans l JOIN loan_requests r ON r.id=l.loan_request_id
       LEFT JOIN loan_repayments p ON p.loan_id=l.id
       WHERE l.group_id=$1 AND l.cycle_id=$2 AND l.member_id=$3 AND l.voided_at IS NULL AND l.settled_at IS NULL
       GROUP BY l.id,r.id ORDER BY l.created_at DESC LIMIT 1`,
      params,
    ),
    client.query(
      `SELECT cs.status,e.final_entitlement,
         COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYOUT' THEN p.amount ELSE -p.amount END),0)::numeric(18,2) amount_paid
       FROM cycle_shareouts cs JOIN cycle_shareout_entitlements e ON e.shareout_id=cs.id AND e.member_id=$3
       LEFT JOIN shareout_payouts p ON p.entitlement_id=e.id
       WHERE cs.group_id=$1 AND cs.cycle_id=$2 AND cs.status<>'CANCELLED'
       GROUP BY cs.id,e.id ORDER BY cs.version_number DESC LIMIT 1`,
      params,
    ),
    client.query(
      `SELECT activity_date,meeting_code,activity_type,amount,status FROM (
         SELECT st.created_at activity_date,vm.meeting_code,
           CASE st.transaction_kind WHEN 'PURCHASE' THEN 'Savings' ELSE 'Savings reversal' END activity_type,
           CASE st.transaction_kind WHEN 'PURCHASE' THEN st.amount ELSE -st.amount END amount,
           CASE st.transaction_kind WHEN 'PURCHASE' THEN 'POSTED' ELSE 'REVERSED' END status
         FROM savings_transactions st LEFT JOIN vsla_meetings vm ON vm.id=st.meeting_id
         WHERE st.group_id=$1 AND st.cycle_id=$2 AND st.member_id=$3
         UNION ALL
         SELECT sf.created_at,vm.meeting_code,
           CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN 'Social Fund' ELSE 'Social Fund reversal' END,
           CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN sf.amount ELSE -sf.amount END,
           CASE sf.transaction_kind WHEN 'CONTRIBUTION' THEN 'POSTED' ELSE 'REVERSED' END
         FROM social_fund_transactions sf LEFT JOIN vsla_meetings vm ON vm.id=sf.meeting_id
         WHERE sf.group_id=$1 AND sf.cycle_id=$2 AND sf.member_id=$3
         UNION ALL
         SELECT f.created_at,vm.meeting_code,
           CASE f.transaction_kind WHEN 'FINE' THEN 'Fine' ELSE 'Fine reversal' END,
           CASE f.transaction_kind WHEN 'FINE' THEN f.amount ELSE -f.amount END,
           CASE f.transaction_kind WHEN 'FINE' THEN 'POSTED' ELSE 'REVERSED' END
         FROM fine_transactions f LEFT JOIN vsla_meetings vm ON vm.id=f.meeting_id
         WHERE f.group_id=$1 AND f.cycle_id=$2 AND f.member_id=$3
         UNION ALL
         SELECT l.created_at,vm.meeting_code,'Loan disbursement',l.principal_disbursed,
           CASE WHEN l.voided_at IS NULL THEN 'DISBURSED' ELSE 'REVERSED' END
         FROM loans l LEFT JOIN vsla_meetings vm ON vm.id=l.disbursement_meeting_id
         WHERE l.group_id=$1 AND l.cycle_id=$2 AND l.member_id=$3
         UNION ALL
         SELECT p.created_at,vm.meeting_code,
           CASE p.transaction_kind WHEN 'PAYMENT' THEN 'Loan repayment' ELSE 'Loan repayment reversal' END,
           CASE p.transaction_kind WHEN 'PAYMENT' THEN p.payment_amount ELSE -p.payment_amount END,
           CASE p.transaction_kind WHEN 'PAYMENT' THEN 'POSTED' ELSE 'REVERSED' END
         FROM loan_repayments p LEFT JOIN vsla_meetings vm ON vm.id=p.meeting_id
         WHERE p.group_id=$1 AND p.cycle_id=$2 AND p.member_id=$3
         UNION ALL
         SELECT p.created_at,vm.meeting_code,
           CASE p.transaction_kind WHEN 'PAYOUT' THEN 'Share-out' ELSE 'Share-out reversal' END,
           CASE p.transaction_kind WHEN 'PAYOUT' THEN p.amount ELSE -p.amount END,
           CASE p.transaction_kind WHEN 'PAYOUT' THEN 'PAID' ELSE 'REVERSED' END
         FROM shareout_payouts p LEFT JOIN vsla_meetings vm ON vm.id=p.meeting_id
         WHERE p.group_id=$1 AND p.cycle_id=$2 AND p.member_id=$3
       ) activity ORDER BY activity_date DESC LIMIT 50`,
      params,
    ),
  ]);
  const summary = summaryResult.rows[0];
  const loan = loanResult.rows[0] || null;
  const shareout = shareoutResult.rows[0] || null;
  return {
    membership: publicMembership(membership),
    summary: {
      savingsShares: Number(summary.savings_shares),
      savingsAmount: summary.savings_amount,
      socialFundAmount: summary.social_fund_amount,
      finesAmount: summary.fines_amount,
      outstandingLoan: loan?.total_outstanding || "0.00",
      shareoutAmount: shareout?.final_entitlement || null,
    },
    loan: loan ? {
      purpose: loan.purpose,
      principal: loan.principal_disbursed,
      serviceChargeRate: loan.service_charge_rate,
      serviceCharge: loan.service_charge_total_due,
      totalDue: loan.total_contractual_due,
      principalRepaid: loan.principal_repaid,
      serviceChargeRepaid: loan.service_charge_repaid,
      amountRepaid: loan.amount_repaid,
      principalOutstanding: loan.principal_outstanding,
      serviceChargeOutstanding: loan.service_charge_outstanding,
      totalOutstanding: loan.total_outstanding,
      disbursementDate: loan.disbursement_date,
      dueDate: loan.due_date,
      status: loan.status,
    } : null,
    shareout: shareout ? {
      status: shareout.status,
      entitlement: shareout.final_entitlement,
      amountPaid: shareout.amount_paid,
    } : null,
    cycles:membership.cycle_history||[{id:membership.cycle_id,cycle_number:membership.cycle_number,status:'ACTIVE'}],
    activity: activityResult.rows.map((entry) => ({
      date: entry.activity_date,
      meeting: entry.meeting_code || null,
      type: entry.activity_type,
      amount: entry.amount,
      status: entry.status,
    })),
  };
}
