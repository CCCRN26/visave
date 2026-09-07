"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CycleScheduleForm from "@/components/cycle-schedule-form";
import FinalReconciliationRefresh from "@/components/final-reconciliation-refresh";
import CycleParticipantsPanel from "@/components/cycle-participants-panel";
import { formatCurrency } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/date";
import { readActionResponse } from "@/lib/client/safe-response";

const blockerLabels = {
  GROUP_NOT_ACTIVE: "The group must be active.", CYCLE_NOT_ACTIVE: "This cycle is not ready for Share-out.",
  NO_FINAL_MEETING: "Record a final meeting before starting close-out.", FINAL_MEETING_NOT_CLOSED: "Complete the final meeting first.",
  OPEN_PRIOR_MEETINGS: "Resolve all earlier meetings first.", FINAL_MEETING_NOT_LATEST: "Use the latest valid meeting in this cycle.",
  OUTSTANDING_LOANS: "Settle all outstanding loan principal and service charge.", UNRESOLVED_LOAN_REQUESTS: "Resolve all pending or approved loan requests.",
  LOAN_RECEIVABLE_DISCREPANCY: "The loan balance must reconcile to zero.", SAVINGS_CONTROL_DISCREPANCY: "Member savings do not match the control account.",
  DISTRIBUTABLE_FUND_DISCREPANCY: "The amount available to share does not reconcile.", NO_MEMBER_SHARES: "At least one saved share is required.",
  UNBALANCED_LEDGER: "A financial transaction is not balanced.", SAVINGS_SHARE_VALUE_DISCREPANCY: "A savings entry does not match its recorded share value.",
  CYCLE_NOT_CLOSING: "Approve the Share-out first.", SHAREOUT_NOT_COMPLETED: "Complete all member payouts and the Share-out.",
  FINAL_RECONCILIATION_NOT_BALANCED: "Confirm balanced final cash totals.", FINAL_RECONCILIATION_STALE: "Confirm the current closing balances and sign again.",
  SOCIAL_FUND_NOT_CARRIED_FORWARD: "Carry the Social Fund into the prepared next cycle.",
};
const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const money = (value) => formatCurrency(value ?? "0.00");

function Status({ complete, children }) {
  return <p className={complete ? "closeout-check complete" : "closeout-check"}><span aria-hidden="true">{complete ? "✓" : "○"}</span>{children}</p>;
}
function Step({ number, title, complete, active, children }) {
  return <section className={`panel closeout-step${complete ? " is-complete" : ""}${active ? " is-active" : ""}`}>
    <header><span className="closeout-step-number">{complete ? "✓" : number}</span><div><p className="eyebrow">Step {number} of 7</p><h2>{title}</h2></div>{complete && <span className="closeout-complete">Completed</span>}</header>
    {children}
  </section>;
}

export default function CycleCloseoutWorkspace({ groupId, state, capabilities }) {
  const router = useRouter();
  const lock = useRef(false), keys = useRef({});
  const [busy, setBusy] = useState(""), [message, setMessage] = useState(null);
  const { cycle, finalMeeting, readiness, shareout, transition, finalReconciliation, constitutions, nextBalances, payoutProgress, finalMeetingCurrent } = state;
  const next = transition.nextCycle, closure = transition.closure, financial = readiness.state || {};
  const finalComplete = finalMeeting?.status === "CLOSED";
  const shareoutComplete = shareout?.shareout.status === "COMPLETED";
  const nextPrepared = Boolean(next), membersConfirmed = Boolean(next && state.nextParticipants.length), officersComplete = state.nextOfficers.length === 5;
  const socialComplete = Number(closure.proof.social_cash) === 0;
  const finalCheckComplete = finalMeetingCurrent && closure.blockingIssues.every((code) => code !== "FINAL_RECONCILIATION_STALE" && code !== "FINAL_RECONCILIATION_NOT_BALANCED");
  const cycleClosed = cycle.status === "CLOSED";
  const nextActive = next?.status === "ACTIVE";
  const ordered = [finalComplete, shareoutComplete, nextPrepared, socialComplete, finalCheckComplete, cycleClosed, nextActive];
  const activeStep = ordered.findIndex((done) => !done) + 1 || 7;
  const closeMeetingReady = Boolean(finalMeeting?.status === "OPEN" && finalMeeting.unmarked_attendance === 0 && finalMeeting.latest_reconciliation_status === "BALANCED" && finalMeetingCurrent);
  const roleMessage = cycle.status === "CLOSING" ? "Waiting for an authorized cycle-end operator." : "Only an authorized programme operator or current-cycle officer can complete this step.";

  function keyFor(name) {
    if (!keys.current[name]) keys.current[name] = crypto.randomUUID();
    return keys.current[name];
  }
  async function act(name, path, body = {}, confirmation) {
    if (lock.current || (confirmation && !window.confirm(confirmation))) return;
    lock.current = true; setBusy(name); setMessage(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await readActionResponse(response);
      if (!response.ok) throw new Error(result.error?.message || "We couldn't complete this action. Please try again.");
      keys.current[name] = null;
      router.refresh();
    } catch (error) {
      setMessage({ text: error.message || "We couldn't complete this action. Please try again." });
    } finally { lock.current = false; setBusy(""); }
  }
  function createNext(body) {
    return act("next", `/api/v1/groups/${groupId}/cycles`, body, `Prepare Cycle ${Number(cycle.cycle_number) + 1}? It will not start until Cycle ${cycle.cycle_number} is closed.`);
  }
  const explain = (code) => blockerLabels[code] || code.replaceAll("_", " ").toLowerCase();

  return <div className="closeout-workspace">
    {message && <div className="closeout-alert" role="alert">{message.text}</div>}
    <nav className="closeout-progress" aria-label="Cycle close-out progress">
      {["Final Meeting", "Share-out", "Next Cycle", "Social Fund", "Final Check", "Close Cycle", "Start Next Cycle"].map((label, index) => <div key={label} className={ordered[index] ? "done" : activeStep === index + 1 ? "current" : "future"}><span>{ordered[index] ? "✓" : index + 1}</span><small>{label}</small></div>)}
    </nav>

    <Step number="1" title="Final Meeting" complete={finalComplete} active={activeStep === 1}>
      {finalMeeting ? <><p className="closeout-lead"><strong>Meeting #{finalMeeting.meeting_number}</strong> · {formatDate(finalMeeting.meeting_date)} · {finalMeeting.status === "CLOSED" ? "Completed" : "In progress"}</p>
        <Status complete={finalMeeting.unmarked_attendance === 0}>Attendance completed</Status>
        <Status complete={finalMeeting.latest_reconciliation_status === "BALANCED"}>Meeting cash reconciliation balanced and signed</Status>
        {finalComplete ? <Status complete>Final meeting completed</Status> : closeMeetingReady && capabilities.finishMeeting ? <button disabled={Boolean(busy)} onClick={() => act("meeting", `/api/v1/groups/${groupId}/meetings/${finalMeeting.id}/close`, {}, "Finish this final meeting? Ordinary meeting entries will become read-only.")}>{busy === "meeting" ? "Finishing…" : "Finish Final Meeting"}</button> : <><div className="closeout-blockers">{finalMeeting.unmarked_attendance > 0 && <p>{finalMeeting.unmarked_attendance} members still have unmarked attendance.</p>}{!finalMeeting.latest_reconciliation_id && <p>A signed meeting reconciliation is required.</p>}{finalMeeting.latest_reconciliation_id && !finalMeetingCurrent && <p>The meeting reconciliation must match the current balances.</p>}</div><Link className="button" href={`/groups/${groupId}/meetings/${finalMeeting.id}`}>Fix Meeting</Link></>}
      </> : <p>No valid meeting exists for this cycle.</p>}
    </Step>

    <Step number="2" title="Share-out" complete={shareoutComplete} active={activeStep === 2}>
      <div className="closeout-money-summary"><div><span>Member savings</span><strong>{money(financial.total_savings || shareout?.shareout.total_net_savings)}</strong></div><div><span>Fine income</span><strong>{money(financial.fine_income || shareout?.shareout.fine_income)}</strong></div><div><span>Loan service-charge income</span><strong>{money(financial.charge_income || shareout?.shareout.service_charge_income)}</strong></div><div className="total"><span>Available to share</span><strong>{money(financial.savings_cash || shareout?.shareout.distributable_fund)}</strong></div><div className="social"><span>Social Fund <small>Not included in Share-out</small></span><strong>{money(closure.proof.social_cash || financial.social_cash)}</strong></div></div>
      {!shareout && readiness.blockingIssues.length > 0 && <div className="closeout-blockers"><strong>Before Share-out can begin:</strong>{readiness.blockingIssues.map((code) => <p key={code}>{explain(code)}</p>)}</div>}
      {!shareout && readiness.ready && capabilities.prepare && <button disabled={Boolean(busy)} onClick={() => act("prepare", `/api/v1/groups/${groupId}/meetings/${finalMeeting.id}/shareout/prepare`)}>{busy === "prepare" ? "Preparing…" : "Prepare Share-out"}</button>}
      {!shareout && readiness.ready && !capabilities.prepare && <p className="muted">{roleMessage}</p>}
      {shareout && <><div className="closeout-payout-progress"><strong>{payoutProgress.paidMembers} of {payoutProgress.totalMembers} members paid</strong><span>{money(payoutProgress.paidAmount)} of {money(payoutProgress.entitlementAmount)} · Remaining {money((Number(payoutProgress.entitlementAmount) - Number(payoutProgress.paidAmount)).toFixed(2))}</span></div>
        {shareout.shareout.status === "DRAFT" && (capabilities.approve ? <button disabled={Boolean(busy)} onClick={() => act("approve", `/api/v1/groups/${groupId}/cycles/${cycle.id}/shareout/${shareout.shareout.id}/approve`, { idempotencyKey: keyFor("approve") }, "Approve this Share-out? Entitlements become authoritative and ordinary cycle transactions will stop.")}>{busy === "approve" ? "Approving…" : "Approve Share-out"}</button> : <p className="muted">Waiting for Chairperson approval.</p>)}
        <div className="table-wrap"><table><thead><tr><th>Member</th><th>Savings</th><th>Ratio</th><th>Surplus</th><th>Total payout</th><th>Paid</th><th>Remaining</th><th>Action</th></tr></thead><tbody>{shareout.entitlements.map((item) => { const remaining = Number(item.final_entitlement) - Number(item.net_paid), ratio = Number(shareout.shareout.total_net_shares) ? Number(item.net_shares) / Number(shareout.shareout.total_net_shares) * 100 : 0; const history = item.payout_history || [], reversed = new Set(history.filter((entry) => entry.kind === "REVERSAL").map((entry) => entry.originalPayoutId)), active = history.find((entry) => entry.kind === "PAYOUT" && !reversed.has(entry.id)); return <tr key={item.id}><td>{item.member_name_snapshot}</td><td>{money(item.net_savings)}</td><td>{ratio.toFixed(2)}%</td><td>{money(item.surplus_amount)}</td><td>{money(item.final_entitlement)}</td><td>{money(item.net_paid)}</td><td>{money(remaining)}</td><td><div className="row-actions">{capabilities.payout && remaining === Number(item.final_entitlement) && remaining > 0 && ["APPROVED", "PAYOUT_IN_PROGRESS"].includes(shareout.shareout.status) && <button disabled={Boolean(busy)} onClick={() => act(`payout-${item.id}`, `/api/v1/groups/${groupId}/meetings/${finalMeeting.id}/shareout/${shareout.shareout.id}/payouts`, { entitlementId: item.id, idempotencyKey: keyFor(`payout-${item.id}`) }, `Record ${money(item.final_entitlement)} paid to ${item.member_name_snapshot}?`)}>Record payout</button>}{capabilities.payout && active && shareout.shareout.status !== "COMPLETED" && <button className="secondary" disabled={Boolean(busy)} onClick={() => act(`reverse-${active.id}`, `/api/v1/groups/${groupId}/meetings/${finalMeeting.id}/shareout/${shareout.shareout.id}/payouts/${active.id}/reverse`, { idempotencyKey: keyFor(`reverse-${active.id}`) }, `Reverse the payout for ${item.member_name_snapshot}? The correction will be recorded in the audit history.`)}>Reverse</button>}</div></td></tr>; })}</tbody></table></div>
        {["APPROVED", "PAYOUT_IN_PROGRESS"].includes(shareout.shareout.status) && capabilities.complete && <button disabled={Boolean(busy) || payoutProgress.paidAmount !== payoutProgress.entitlementAmount} onClick={() => act("complete", `/api/v1/groups/${groupId}/cycles/${cycle.id}/shareout/${shareout.shareout.id}/complete`, {}, "Complete Share-out? Completed payouts cannot be reversed.")}>{busy === "complete" ? "Completing…" : "Complete Share-out"}</button>}
        {shareoutComplete && <Status complete>Share-out and all member payouts completed</Status>}
      </>}
    </Step>

    <Step number="3" title={next ? `Cycle ${next.cycle_number} Prepared` : `Prepare Cycle ${Number(cycle.cycle_number) + 1}`} complete={nextPrepared} active={activeStep === 3}>
      {next ? <><Status complete>Cycle {next.cycle_number} is prepared and will start only after Cycle {cycle.cycle_number} closes.</Status><p>{formatDate(next.start_date)} – {formatDate(next.expected_end_date)}</p><hr/><h3>Set Up Cycle {next.cycle_number} Members</h3><CycleParticipantsPanel groupId={groupId} cycle={next} previousParticipants={state.previousParticipants} currentParticipants={state.nextParticipants} eligibleMembers={state.eligibleMembers} canManage={capabilities.participationManage}/><hr/><h3>Assign Cycle {next.cycle_number} Officers</h3><Status complete={membersConfirmed}>{state.nextParticipants.length} Cycle {next.cycle_number} participants selected</Status><Status complete={officersComplete}>{state.nextOfficers.length} of 5 required officers assigned</Status><p>{membersConfirmed ? "Officer candidates are limited to selected cycle participants." : "Confirm cycle members before assigning officers."}</p><Link className="button" href={`/groups/${groupId}/officers?cycleId=${next.id}`}>Assign Cycle {next.cycle_number} Officers</Link></> : shareoutComplete ? <><p>Cycle {Number(cycle.cycle_number) + 1} will be prepared now. It will start only after Cycle {cycle.cycle_number} is fully closed.</p><p className="closeout-date-help"><strong>Previous cycle ended:</strong> {formatDate(cycle.expected_end_date)}<br/><strong>Recommended next start:</strong> {formatDate(state.recommendedNextStart)}</p>{capabilities.cycleManage ? <CycleScheduleForm constitutions={constitutions} busy={Boolean(busy)} onSubmit={createNext} cycleNumber={Number(cycle.cycle_number) + 1} fixedCycleNumber submitLabel={`Prepare Cycle ${Number(cycle.cycle_number) + 1}`} /> : <p className="muted">{roleMessage}</p>}</> : <p className="muted">Complete Share-out before preparing the next cycle.</p>}
    </Step>

    <Step number="4" title="Carry Social Fund Forward" complete={socialComplete} active={activeStep === 4}>
      {socialComplete ? <Status complete>{Number(closure.proof.social_cash) === 0 && !nextBalances.SOCIAL_FUND_CASH ? "No Social Fund balance requires carry-forward." : `Social Fund carried forward to Cycle ${next?.cycle_number}.`}</Status> : <><div className="closeout-money-summary"><div><span>Cycle {cycle.cycle_number} balance</span><strong>{money(closure.proof.social_cash)}</strong></div><div><span>Amount moving to Cycle {next?.cycle_number || Number(cycle.cycle_number) + 1}</span><strong>{money(closure.proof.social_cash)}</strong></div></div>{next?.status === "READY" ? capabilities.operate ? <button disabled={Boolean(busy)} onClick={() => act("social", `/api/v1/groups/${groupId}/cycles/${cycle.id}/social-fund/carry-forward`, { targetCycleId: next.id, idempotencyKey: keyFor("social") }, `Carry ${money(closure.proof.social_cash)} into Cycle ${next.cycle_number}? Social Fund remains separate from member Share-out.`)}>{busy === "social" ? "Carrying forward…" : `Carry ${money(closure.proof.social_cash)} to Cycle ${next.cycle_number}`}</button> : <p className="muted">{roleMessage}</p> : <p className="muted">Prepare the next cycle first.</p>}</>}
    </Step>

    <Step number="5" title="Final Financial Check" complete={finalCheckComplete} active={activeStep === 5}>
      <Status complete={shareoutComplete}>Share-out and member payouts completed</Status><Status complete={Number(finalReconciliation.balances.SAVINGS_LOAN_CASH || 0) === 0}>Savings/Loan Cash cleared</Status><Status complete={socialComplete}>Social Fund handled</Status><Status complete={Number(finalReconciliation.balances.LOANS_RECEIVABLE || 0) === 0}>Outstanding loans cleared</Status><Status complete={Number(finalReconciliation.balances.SHAREOUT_PAYABLE || 0) === 0}>Share-out Payable cleared</Status><Status complete={finalMeetingCurrent}>Final balances confirmed and signed</Status>
      {finalReconciliation.eligible && capabilities.refreshReconciliation && <><p>Balances changed during close-out. Confirm the current closing balances before closing the cycle.</p><FinalReconciliationRefresh groupId={groupId} cycleId={cycle.id} state={finalReconciliation} compact /></>}
      {finalReconciliation.eligible && !capabilities.refreshReconciliation && <p className="muted">Waiting for an authorized operator to confirm and sign the final balances.</p>}
      {!finalReconciliation.eligible && finalReconciliation.unexpectedTransactionTypes.length > 0 && <div className="closeout-blockers"><p>Unexpected activity requires review: {finalReconciliation.unexpectedTransactionTypes.join(", ")}.</p></div>}
    </Step>

    <Step number="6" title={cycleClosed ? `Cycle ${cycle.cycle_number} Closed` : `Close Cycle ${cycle.cycle_number}`} complete={cycleClosed} active={activeStep === 6}>
      {cycleClosed ? <Status complete>Cycle {cycle.cycle_number} is closed. Historical records remain available.</Status> : <>{closure.blockingIssues.length > 0 && <div className="closeout-blockers">{closure.blockingIssues.map((code) => <p key={code}>{explain(code)}</p>)}</div>}{closure.ready && capabilities.close ? <button disabled={Boolean(busy)} onClick={() => act("close", `/api/v1/groups/${groupId}/cycles/${cycle.id}/close`, {}, `Close Cycle ${cycle.cycle_number}? Normal transactions cannot resume, historical records remain available, and Cycle ${next?.cycle_number || Number(cycle.cycle_number) + 1} can then be started.`)}>{busy === "close" ? "Closing…" : `Close Cycle ${cycle.cycle_number}`}</button> : closure.ready && <p className="muted">Waiting for Chairperson or an authorized programme operator to close the cycle.</p>}</>}
    </Step>

    <Step number="7" title={nextActive ? `Cycle ${next.cycle_number} Started` : "Start Next Cycle"} complete={nextActive} active={activeStep === 7}>
      {next ? <><p><strong>Cycle {next.cycle_number}</strong> · {formatDate(next.start_date)} – {formatDate(next.expected_end_date)} · {days[next.meeting_day_of_week] || "Meeting day not selected"}</p><div className="closeout-opening-grid">{[["Member savings", nextBalances.MEMBER_SAVINGS_CONTROL],["Savings/Loan Cash",nextBalances.SAVINGS_LOAN_CASH],["Outstanding loans",nextBalances.LOANS_RECEIVABLE],["Fine income",nextBalances.FINE_INCOME],["Loan service-charge income",nextBalances.LOAN_SERVICE_CHARGE_INCOME],["Share-out payable",nextBalances.SHAREOUT_PAYABLE],["Social Fund",nextBalances.SOCIAL_FUND_CASH]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{money(label === "Member savings" ? Math.abs(Number(value || 0)) : value)}</strong></div>)}</div>{next.status === "READY" && cycleClosed && (capabilities.cycleManage ? <button disabled={Boolean(busy)} onClick={() => act("activate", `/api/v1/groups/${groupId}/cycles/${next.id}/activate`, {}, `Start Cycle ${next.cycle_number}? Members can begin recording its meetings and transactions.`)}>{busy === "activate" ? "Starting…" : `Start Cycle ${next.cycle_number}`}</button> : <p className="muted">{roleMessage}</p>)}{nextActive && <><Status complete>Cycle {next.cycle_number} is active</Status><Link className="button" href={`/groups/${groupId}/cycle`}>Go to Cycle {next.cycle_number}</Link></>}</> : <p>Prepare the next cycle before it can be started.</p>}
    </Step>
  </div>;
}
