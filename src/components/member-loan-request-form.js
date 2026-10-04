"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/utils/money";

const number = (value) => Number(value || 0);

function Info({ label, value }) {
  return <div><small className="muted">{label}</small><br/><strong>{value}</strong></div>;
}

export default function MemberLoanRequestForm({ groupId, memberName, requestContext, eligibility }) {
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState(1);
  const [purpose, setPurpose] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const estimate = useMemo(() => {
    const charge = number(amount) * (number(eligibility.loan_service_charge_rate) / 100) * number(term);
    return { charge, total: number(amount) + charge };
  }, [amount, term, eligibility.loan_service_charge_rate]);
  const due = new Date(requestContext.meetingDate);
  due.setMonth(due.getMonth() + number(term));
  const present = requestContext.attendanceStatus === "PRESENT";

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/groups/${groupId}/meetings/${requestContext.meetingId}/loan-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestedPrincipal: amount,
          requestedTermMonths: term,
          purpose: purpose.trim(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(result?.error?.message || "Your loan request could not be submitted.");
        return;
      }
      setMessage("Your loan request was submitted successfully.");
      location.reload();
    } catch {
      setMessage("Your loan request could not be submitted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel member-loan-card" aria-labelledby="member-loan-request-title">
    <p className="eyebrow">Member loan request</p>
    <h2 id="member-loan-request-title">Request Loan</h2>
    <p>This request is for your own account: <strong>{memberName}</strong>. Your linked membership is verified by Visave; there is no borrower selector.</p>
    {message && <p role="status">{message}</p>}
    <form onSubmit={submit}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        <Info label="Attendance" value={requestContext.attendanceStatus || "Not marked"}/>
        <Info label="Net eligible savings" value={formatCurrency(eligibility.net_savings || 0)}/>
        <Info label="Maximum multiple" value={`${eligibility.loan_max_multiple || 0}×`}/>
        <Info label="Maximum eligible" value={formatCurrency(eligibility.maximum_eligible || 0)}/>
        <label>Requested amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required/></label>
        <label>Term (months)<input type="number" min="1" max={eligibility.loan_max_term_months || undefined} value={term} onChange={(event) => setTerm(Number(event.target.value))}/></label>
        <Info label="Service-charge rate" value={`${eligibility.loan_service_charge_rate ?? "—"}% monthly flat`}/>
        <Info label="Estimated charge" value={formatCurrency(estimate.charge)}/>
        <Info label="Estimated total repayment" value={formatCurrency(estimate.total)}/>
        <Info label="Estimated due date" value={Number.isNaN(due.getTime()) ? "—" : due.toLocaleDateString("en-NG")}/>
      </div>
      <label>Purpose<textarea value={purpose} minLength={3} maxLength={2000} onChange={(event) => setPurpose(event.target.value)} placeholder="Purchase farming inputs" required/></label>
      <button disabled={busy || !present || purpose.trim().length < 3 || !amount}>{busy ? "Submitting…" : "Request Loan"}</button>
      {!present && <p className="muted">You can submit during an open meeting after you are marked PRESENT.</p>}
    </form>
  </section>;
}
