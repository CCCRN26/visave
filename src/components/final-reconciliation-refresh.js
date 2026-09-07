"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import SignaturePad from "@/components/signature-pad";
import { formatCurrency } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import { readActionResponse } from "@/lib/client/safe-response";

const accountLabels = {
  SAVINGS_LOAN_CASH: "Savings/Loan Cash", SOCIAL_FUND_CASH: "Social Fund Cash",
  LOANS_RECEIVABLE: "Loans Receivable", SHAREOUT_PAYABLE: "Share-out Payable",
  MEMBER_SAVINGS_CONTROL: "Member Savings Control", FINE_INCOME: "Fine Income",
  LOAN_SERVICE_CHARGE_INCOME: "Loan Service Charge Income",
};

export default function FinalReconciliationRefresh({ groupId, cycleId, state, compact = false }) {
  const router = useRouter(), [open, setOpen] = useState(false), [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""), [signature, setSignature] = useState(null),
    [savings, setSavings] = useState(state.balances.SAVINGS_LOAN_CASH || "0.00"),
    [social, setSocial] = useState(state.balances.SOCIAL_FUND_CASH || "0.00");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/groups/${groupId}/cycles/${cycleId}/final-reconciliation`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ countedSavingsLoanBalance: savings, countedSocialFundBalance: social, signatureDataUrl: signature, notes: "Refreshed against the final cycle-closing position." }),
      }), result = await readActionResponse(response);
      if (!response.ok) throw new Error(result.error?.message || "Refresh failed");
      setMessage(`A new ${result.data.status} reconciliation was saved. The previous record remains in history.`);
      setOpen(false); router.refresh();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  const previousExplanation = state.latestReconciliation.status === "BALANCED"
    ? "was valid when recorded and is now stale after cycle-end transactions"
    : "has a variance; a corrected count and new signature are required";
  return <section className={compact ? "closeout-reconciliation" : "panel"} style={{ padding: 20 }}>
    <h2>{compact ? "Confirm Final Balances" : "Refresh Final Reconciliation"}</h2>
    <p>Cycle-end transactions changed the balances after the final meeting. Confirm the current closing balances and add a new signature before closing the cycle.</p>
    {message && <p role="status">{message}</p>}
    {!open ? <button onClick={() => setOpen(true)}>Confirm Final Balances &amp; Sign</button> : <div className="grid" style={{ gap: 16 }}>
      <div><strong>Final Meeting</strong><br />Meeting #{state.meeting.meetingNumber} · {formatDate(state.meeting.meetingDate)} · <span className="badge">{state.meeting.status}</span></div>
      <div><strong>Previous reconciliation</strong><br /><span className="badge">{state.latestReconciliation.status}</span> · {previousExplanation}</div>
      <div><h3>Current closing position</h3><div className="grid grid-3">{Object.entries(accountLabels).map(([code, label]) => <p key={code}><strong>{label}</strong><br />{formatCurrency(state.balances[code] || "0.00")}</p>)}</div></div>
      <label>Counted Savings/Loan Fund Cash<input inputMode="decimal" value={savings} onChange={(event) => setSavings(event.target.value)} /><span>Difference: {formatCurrency((Number(savings) - Number(state.balances.SAVINGS_LOAN_CASH || 0)).toFixed(2))}</span></label>
      <label>Counted Social Fund Cash<input inputMode="decimal" value={social} onChange={(event) => setSocial(event.target.value)} /><span>Difference: {formatCurrency((Number(social) - Number(state.balances.SOCIAL_FUND_CASH || 0)).toFixed(2))}</span></label>
      <SignaturePad disabled={busy} onChange={setSignature} />
      <p className="muted">This creates a new reconciliation record. The previous reconciliation remains in history.</p>
      <div><button disabled={busy || !signature} onClick={save}>Confirm Final Balances &amp; Sign</button> <button className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </div>}
    <details style={{ marginTop: 16 }}><summary>Reconciliation history ({state.history.length})</summary>{state.history.map((item, index) => <p key={item.id}><strong>Reconciliation #{state.history.length - index}</strong> · <span className="badge">{item.status}</span> · {formatDateTime(item.created_at)} · {item.created_by_name}{index === 0 ? " · Latest" : " · Historical"}</p>)}</details>
  </section>;
}
