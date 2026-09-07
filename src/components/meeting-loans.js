"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/utils/money";

const number = (value) => Number(value || 0);

export default function MeetingLoans({ groupId, meetingId, meetingDate, availableFund, attendance, data, open, canRequest = false, canDecide = false, canDisburse = false, canRepay = false }) {
  const [memberId, setMemberId] = useState(attendance.find((x) => x.attendance_status === "PRESENT")?.member_id || "");
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState(1);
  const [purpose, setPurpose] = useState("");
  const [eligibility, setEligibility] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !canRequest || !memberId) return;
    const controller = new AbortController();
    fetch(`/api/v1/groups/${groupId}/meetings/${meetingId}/loan-eligibility/${memberId}`, { signal: controller.signal })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => { if (response.ok) setEligibility(body.data); else setMessage(body.error?.message || "Could not load loan eligibility"); })
      .catch((error) => { if (error.name !== "AbortError") setMessage("Could not load loan eligibility"); });
    return () => controller.abort();
  }, [groupId, meetingId, memberId, open, canRequest]);

  async function call(path, body) {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/v1/groups/${groupId}/meetings/${meetingId}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setBusy(false); setMessage(response.ok ? "Saved successfully" : result.error?.message || "Action failed");
    if (response.ok) location.reload();
  }

  const estimate = useMemo(() => {
    const charge = number(amount) * (number(eligibility?.loan_service_charge_rate) / 100) * number(term);
    return { charge, total: number(amount) + charge };
  }, [amount, term, eligibility]);
  const selectedAttendance = attendance.find((x) => x.member_id === memberId)?.attendance_status;
  const due = new Date(meetingDate); due.setMonth(due.getMonth() + number(term));

  return <section className="panel" style={{ padding: 20, marginTop: 18 }}>
    <h2>5. Loans</h2>
    <p className="muted">Requests require an active borrower marked PRESENT. Approval does not reserve funds; available cash is checked again at disbursement.</p>
    {message && <p role="status">{message}</p>}
    {open && canRequest && <div className="panel" style={{ padding: 16, marginBottom: 18 }}>
      <h3>Record loan request</h3>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        <label>Member<select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Select borrower</option>{attendance.map((x) => <option value={x.member_id} key={x.member_id} disabled={x.attendance_status !== "PRESENT"}>{x.member_name} · {x.attendance_status}</option>)}</select></label>
        <Info label="Attendance" value={selectedAttendance || "Not selected"}/>
        <Info label="Net eligible savings" value={formatCurrency(eligibility?.net_savings || 0)}/>
        <Info label="Maximum multiple" value={`${eligibility?.loan_max_multiple || 0}×`}/>
        <Info label="Maximum eligible" value={formatCurrency(eligibility?.maximum_eligible || 0)}/>
        <label>Requested amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required/></label>
        <label>Term (months)<input type="number" min="1" max={eligibility?.loan_max_term_months || undefined} value={term} onChange={(event) => setTerm(Number(event.target.value))}/></label>
        <Info label="Service-charge rate" value={`${eligibility?.loan_service_charge_rate ?? "—"}% monthly flat`}/>
        <Info label="Estimated charge" value={formatCurrency(estimate.charge)}/>
        <Info label="Estimated total repayment" value={formatCurrency(estimate.total)}/>
        <Info label="Estimated due date" value={Number.isNaN(due.getTime()) ? "—" : due.toLocaleDateString("en-NG")}/>
      </div>
      <label>Purpose<textarea value={purpose} minLength={3} maxLength={2000} onChange={(event) => setPurpose(event.target.value)} placeholder="Purchase farming inputs" required/></label>
      <button disabled={busy || selectedAttendance !== "PRESENT" || purpose.trim().length < 3 || !amount} onClick={() => call("/loan-requests", { memberId, requestedPrincipal: amount, requestedTermMonths: term, purpose: purpose.trim() })}>Record request</button>
      {selectedAttendance && selectedAttendance !== "PRESENT" && <p className="muted">This member cannot borrow because they are not marked PRESENT.</p>}
    </div>}
    <div className="table-wrap"><table><thead><tr><th>Member / purpose</th><th>Requested</th><th>Status</th><th>Recorder</th><th>Actions</th></tr></thead><tbody>{data.requests.map((request) => <RequestRow key={request.id} groupId={groupId} meetingId={meetingId} request={request} open={open} busy={busy} canDecide={canDecide} canDisburse={canDisburse} availableFund={availableFund} call={call}/>)}</tbody></table></div>
    <h3>Outstanding loans</h3>
    <div className="table-wrap"><table><thead><tr><th>Member</th><th>Outstanding</th><th>Status</th><th>Repay</th></tr></thead><tbody>{data.loans.filter((x) => !["REPAID", "VOIDED"].includes(x.display_status)).map((loan) => <LoanRepay key={loan.id} loan={loan} open={open && canRepay} busy={busy} call={call}/>)}</tbody></table></div>
  </section>;
}

function Info({ label, value }) { return <div><small className="muted">{label}</small><br/><strong>{value}</strong></div>; }

function RequestRow({ groupId, meetingId, request, open, busy, canDecide, canDisburse, availableFund, call }) {
  const [approvedPrincipal, setApprovedPrincipal] = useState(request.requested_principal);
  const [approvedTermMonths, setApprovedTermMonths] = useState(request.requested_term_months);
  const [notes, setNotes] = useState("");
  const [currentEligibility, setCurrentEligibility] = useState(null);
  useEffect(() => {
    if (!open || !canDecide || request.status !== "PENDING") return;
    const controller = new AbortController();
    fetch(`/api/v1/groups/${groupId}/meetings/${meetingId}/loan-eligibility/${request.member_id}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => setCurrentEligibility(body.data || null))
      .catch((error) => { if (error.name !== "AbortError") setCurrentEligibility(null); });
    return () => controller.abort();
  }, [groupId, meetingId, request.member_id, request.status, open, canDecide]);
  const charge = number(approvedPrincipal) * (number(request.loan_service_charge_rate) / 100) * number(approvedTermMonths);
  return <tr><td><b>{request.member_name}</b><br/><small>{request.purpose || "Legacy request — no purpose recorded"}</small></td><td>{formatCurrency(request.requested_principal)}<br/><small>{request.requested_term_months} months</small></td><td>{request.status}</td><td>{request.requested_by_name}</td><td>
    {open && canDecide && request.status === "PENDING" && <div className="grid" style={{ minWidth: 260 }}>
      <small>Current maximum eligible: {formatCurrency(currentEligibility?.maximum_eligible || request.maximum_eligible_snapshot)}</small>
      <input aria-label="Approved amount" value={approvedPrincipal} onChange={(event) => setApprovedPrincipal(event.target.value)}/>
      <input aria-label="Approved term" type="number" min="1" max={request.loan_max_term_months} value={approvedTermMonths} onChange={(event) => setApprovedTermMonths(Number(event.target.value))}/>
      <small>Charge {formatCurrency(charge)} · total {formatCurrency(number(approvedPrincipal) + charge)}</small>
      <small>Available loan fund: {formatCurrency(availableFund)}</small>
      <textarea aria-label="Decision note" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decision note"/>
      <span><button disabled={busy} onClick={() => call(`/loan-requests/${request.id}/approve`, { approvedPrincipal, approvedTermMonths, notes: notes.trim() || null })}>Approve</button> <button disabled={busy || notes.trim().length < 3} onClick={() => call(`/loan-requests/${request.id}/reject`, { notes: notes.trim() })}>Reject</button></span>
      <small>Approval does not reserve funds. Available funds are rechecked at disbursement.</small>
    </div>}
    {open && canDisburse && request.status === "APPROVED" && <button disabled={busy} onClick={() => call(`/loan-requests/${request.id}/disburse`, { idempotencyKey: crypto.randomUUID() })}>Disburse {formatCurrency(request.approved_principal)}</button>}
  </td></tr>;
}

function LoanRepay({ loan, open, busy, call }) {
  const [amount, setAmount] = useState("");
  return <tr><td>{loan.member_name}</td><td>{formatCurrency(loan.total_outstanding)}</td><td>{loan.display_status}</td><td>{open && <><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Payment"/><button disabled={busy} onClick={() => call(`/loans/${loan.id}/repayments`, { paymentAmount: amount, idempotencyKey: crypto.randomUUID() })}>Post</button></>}</td></tr>;
}
