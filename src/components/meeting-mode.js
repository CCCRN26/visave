"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils/money";
import SignaturePad from "@/components/signature-pad";
export default function MeetingMode({ groupId, initial, capabilities = {} }) {
  const [data, setData] = useState(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    router = useRouter(),
    meetingOpen = data.meeting.status === "OPEN",
    canAttendance = meetingOpen && capabilities.attendance,
    canFinancial = meetingOpen && capabilities.financial,
    canReverse = meetingOpen && capabilities.reverse,
    canReconcile = meetingOpen && capabilities.reconcile,
    canClose = meetingOpen && capabilities.close;
  const counts = useMemo(
    () =>
      Object.fromEntries(
        ["PRESENT", "LATE", "ABSENT", "EXCUSED", "UNMARKED"].map((s) => [
          s,
          data.attendance.filter((a) => a.attendance_status === s).length,
        ]),
      ),
    [data.attendance],
  );
  const memberHistory = useMemo(() => data.attendance.map((member) => {
    const memberTransactions = data.transactions.filter((transaction) => transaction.member_id === member.member_id && !transaction.reversal_of_transaction_id);
    const savings = memberTransactions.find((transaction) => transaction.transaction_type === "SAVINGS_PURCHASE");
    const social = memberTransactions.find((transaction) => transaction.transaction_type === "SOCIAL_FUND_CONTRIBUTION");
    return { ...member, savings, social, complete: Boolean(savings && !savings.reversed && (Number(data.meeting.social_fund_contribution) === 0 || (social && !social.reversed))) };
  }), [data.attendance, data.transactions, data.meeting.social_fund_contribution]);
  async function call(path, body, method = "POST") {
    setBusy(true);
    setMessage("");
    const r = await fetch(
        `/api/v1/groups/${groupId}/meetings/${data.meeting.id}${path}`,
        {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setMessage(j.error?.message || "Action failed");
      return null;
    }
    router.refresh();
    location.reload();
    return j.data;
  }
  async function attendance(memberId, status) {
    await call("/attendance", { updates: [{ memberId, status }] }, "PATCH");
  }
  return (
    <div className="meeting-mode">
      <div className="grid cards">
        {[
          ["Opening Savings/Loan", data.summary.openingSavingsLoan],
          ["Savings Received", data.summary.savings],
          ["Fines Received", data.summary.fines],
          ["Current Savings/Loan", data.summary.currentSavingsLoan],
          ["Opening Social Fund", data.summary.openingSocialFund],
          ["Social Fund Received", data.summary.socialFund],
          ["Current Social Fund", data.summary.currentSocialFund],
        ].map(([k, v]) => (
          <article className="panel" style={{ padding: 16 }} key={k}>
            <small className="muted">{k}</small>
            <h3>{formatCurrency(v)}</h3>
          </article>
        ))}
      </div>
      {message && (
        <p className="panel" style={{ padding: 12, color: "#c33" }}>
          {message}
        </p>
      )}
      <section className="panel" style={{ padding: 20, marginTop: 18 }}>
        <h2>1. Attendance</h2>
        <p>
          {data.attendance.length} members · Present {counts.PRESENT} · Late{" "}
          {counts.LATE} · Absent {counts.ABSENT} · Excused {counts.EXCUSED} ·
          Unmarked {counts.UNMARKED}
        </p>
        {canAttendance && (
          <button
            disabled={busy}
            onClick={() =>
              call(
                "/attendance",
                {
                  updates: data.attendance.map((a) => ({
                    memberId: a.member_id,
                    status: "PRESENT",
                  })),
                },
                "PATCH",
              )
            }
          >
            Mark all present
          </button>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.attendance.map((a) => (
                <tr key={a.id}>
                  <td>{a.member_name}</td>
                  <td>
                    <select
                      disabled={!canAttendance || busy}
                      value={a.attendance_status}
                      onChange={(e) => attendance(a.member_id, e.target.value)}
                    >
                      {["UNMARKED", "PRESENT", "LATE", "ABSENT", "EXCUSED"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel contribution-section">
        <div className="contribution-section-header">
          <h2>2–4. Contributions, Savings &amp; Fines</h2>
          <p>Record contributions for each attending member.</p>
          <p className="contribution-note">
            <span aria-hidden="true">ⓘ</span> Amounts are calculated
            automatically from the approved constitution.
          </p>
        </div>
        <div className="contribution-column-headings" aria-hidden="true">
          <span>Member</span>
          <span>Social Fund</span>
          <span>Savings</span>
          <span>Fine</span>
        </div>
        <div className="member-contribution-list">
          {data.attendance.map((a) => (
            <MemberActions
              key={a.id}
              a={a}
              data={data}
              open={canFinancial}
              busy={busy}
              call={call}
            />
          ))}
        </div>
      </section>
      <section className="panel" style={{ padding: 20, marginTop: 18 }}>
        <h2>5. Reconciliation</h2>
        <FinancialPosition position={data.financialPosition} />
        {data.reconciliation && (
          <p className="reconciliation-result">
            <span className="badge">{data.reconciliation.status}</span> Savings
            difference{" "}
            {formatCurrency(data.reconciliation.savings_loan_difference)} ·
            Social difference{" "}
            {formatCurrency(data.reconciliation.social_fund_difference)}
          </p>
        )}
        {canReconcile && <Reconcile busy={busy} balances={data.summary} call={call} />}
      </section>
      <section className="panel" style={{ padding: 20, marginTop: 18 }}>
        <h2>6. Close Meeting</h2>
        <p className="muted">
          Requires all attendance marked and a current balanced reconciliation.
        </p>
        {canClose && (
          <button disabled={busy} onClick={() => call("/close", {})}>
            Close meeting
          </button>
        )}
      </section>
      <section className="panel" style={{ padding: 20, marginTop: 18 }}>
        <h2>Transaction History</h2>
        <div className="meeting-progress" aria-label="Meeting contribution progress"><div><span>Present members</span><strong>{counts.PRESENT + counts.LATE}</strong></div><div><span>Savings recorded</span><strong>{memberHistory.filter((row) => row.savings && !row.savings.reversed).length}</strong></div><div><span>Social Fund recorded</span><strong>{memberHistory.filter((row) => row.social && !row.social.reversed).length}</strong></div><div><span>Completed</span><strong>{memberHistory.filter((row) => row.complete).length}</strong></div></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Savings</th>
                <th>Social Fund</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {memberHistory.map((row) => (
                <tr key={row.member_id}>
                  <td>{row.member_name}</td>
                  <td>{row.savings ? (row.savings.reversed ? "Reversed" : formatCurrency(row.savings.amount)) : "—"}</td>
                  <td>{row.social ? (row.social.reversed ? "Reversed" : formatCurrency(row.social.amount)) : "—"}</td>
                  <td>{row.complete ? "Complete" : "Pending"}</td>
                  <td>
                    <div className="row-actions">
                      {canReverse && row.savings && !row.savings.reversed && <button disabled={busy} onClick={() => call(`/transactions/${row.savings.id}/reverse`, {idempotencyKey: crypto.randomUUID()})}>Reverse Savings</button>}
                      {canReverse && row.social && !row.social.reversed && <button disabled={busy} onClick={() => call(`/transactions/${row.social.id}/reverse`, {idempotencyKey: crypto.randomUUID()})}>Reverse Social Fund</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
function MemberActions({ a, data, open, busy, call }) {
  const [shares, setShares] = useState(data.meeting.min_shares_per_meeting);
  const [fineRuleId, setFineRuleId] = useState(data.fineRules[0]?.id || "");
  const selectedFine = data.fineRules.find((fine) => fine.id === fineRuleId),
    activeSavings = data.transactions.some((t) => t.member_id === a.member_id && t.transaction_type === "SAVINGS_PURCHASE" && !t.reversed),
    activeSocial = data.transactions.some((t) => t.member_id === a.member_id && t.transaction_type === "SOCIAL_FUND_CONTRIBUTION" && !t.reversed);
  return (
    <article className="member-contribution-card">
      <header className="member-contribution-identity">
        <strong>{a.member_name}</strong>
        <span>{a.member_code}</span>
      </header>
      <section className="member-financial-panel social-fund-panel">
        <h3>Social Fund</h3>
        <div className="meeting-payment-control">
          <span className="control-label">Required contribution</span>
          <strong className="meeting-payment-amount">
            {formatCurrency(data.meeting.social_fund_contribution)}
          </strong>
          {open && (
            <button
              className="contribution-action"
              disabled={busy || activeSocial}
              onClick={() =>
                call("/social-fund", {
                  memberId: a.member_id,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              {activeSocial ? "Recorded" : "Record"}
            </button>
          )}
        </div>
      </section>
      <section className="member-financial-panel savings-panel">
        <h3>Savings</h3>
        <div className="meeting-payment-control">
          <label htmlFor={`shares-${a.id}`}>Shares</label>
          <select
            id={`shares-${a.id}`}
            disabled={!open}
            value={shares}
            onChange={(e) => setShares(Number(e.target.value))}
          >
            {Array.from(
              {
                length:
                  data.meeting.max_shares_per_meeting -
                  data.meeting.min_shares_per_meeting +
                  1,
              },
              (_, i) => i + data.meeting.min_shares_per_meeting,
            ).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <span className="control-label">Calculated amount</span>
          <strong className="meeting-payment-amount">
            {formatCurrency(Number(shares) * Number(data.meeting.share_value))}
          </strong>
          {open && (
            <button
              className="contribution-action"
              disabled={busy || activeSavings}
              onClick={() =>
                call("/savings", {
                  memberId: a.member_id,
                  numberOfShares: shares,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              {activeSavings ? "Savings Recorded" : "Post Savings"}
            </button>
          )}
        </div>
      </section>
      <section className="member-financial-panel fine-panel">
        <h3>Fine</h3>
        <div className="meeting-payment-control">
          <label htmlFor={`fine-${a.id}`}>Fine type</label>
          <select
            id={`fine-${a.id}`}
            disabled={!open}
            value={fineRuleId}
            onChange={(event) => setFineRuleId(event.target.value)}
          >
            {data.fineRules.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name} · {formatCurrency(f.amount)}
              </option>
            ))}
          </select>
          {selectedFine && (
            <>
              <span className="control-label">Amount</span>
              <strong className="meeting-payment-amount">
                {formatCurrency(selectedFine.amount)}
              </strong>
            </>
          )}
          {open && data.fineRules.length > 0 && (
            <button
              className="contribution-action"
              disabled={busy || !fineRuleId}
              onClick={() =>
                call("/fines", {
                  memberId: a.member_id,
                  fineRuleId,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              Record Fine
            </button>
          )}
        </div>
      </section>
    </article>
  );
}
function MoneyRow({ label, value, strong = false }) {
  return (
    <div className={`position-row${strong ? " position-row-total" : ""}`}>
      <span>{label}</span>
      <strong>{formatCurrency(value ?? "0.00")}</strong>
    </div>
  );
}
function FinancialPosition({ position }) {
  if (!position) return null;
  return (
    <div className="financial-position" aria-label="Meeting and current cycle financial position">
      <div className="position-intro">
        <div>
          <p className="eyebrow">Current meeting activity</p>
          <h3>This meeting only</h3>
        </div>
        <p>These amounts belong to this meeting. They do not include earlier meetings.</p>
      </div>
      <div className="position-grid position-grid-current">
        <section className="position-card" aria-labelledby="current-savings-heading">
          <h4 id="current-savings-heading">Savings</h4>
          <MoneyRow label="Savings received this meeting" value={position.current_savings} strong />
        </section>
        <section className="position-card" aria-labelledby="current-loans-heading">
          <h4 id="current-loans-heading">Loans</h4>
          <MoneyRow label="Loan disbursements this meeting" value={position.current_loan_disbursements} />
          <MoneyRow label="Loan repayments this meeting" value={position.current_loan_repayments} />
        </section>
        <section className="position-card" aria-labelledby="current-other-heading">
          <h4 id="current-other-heading">Other receipts</h4>
          <MoneyRow label="Fines received this meeting" value={position.current_fines} />
          <MoneyRow label="Social Fund this meeting" value={position.current_social_fund} />
        </section>
      </div>

      <div className="position-intro position-cycle-heading">
        <div>
          <p className="eyebrow">Current cycle position</p>
          <h3>Through this meeting</h3>
        </div>
        <p>Read-only totals derived from valid transactions and ledger entries in this cycle.</p>
      </div>
      <div className="position-grid">
        <section className="position-card" aria-labelledby="cycle-savings-heading">
          <h4 id="cycle-savings-heading">Savings position</h4>
          <MoneyRow label="Savings before this meeting" value={position.previous_savings} />
          <MoneyRow label="Savings received this meeting" value={position.current_savings} />
          <MoneyRow label="Current cycle savings to date" value={position.total_savings} strong />
        </section>
        <section className="position-card" aria-labelledby="cycle-loans-heading">
          <h4 id="cycle-loans-heading">Loan position</h4>
          <MoneyRow label="Disbursements before this meeting" value={position.previous_loan_disbursements} />
          <MoneyRow label="Disbursements this meeting" value={position.current_loan_disbursements} />
          <MoneyRow label="Current cycle disbursements to date" value={position.total_loan_disbursements} />
          <MoneyRow label="Repayments before this meeting" value={position.previous_loan_repayments} />
          <MoneyRow label="Repayments this meeting" value={position.current_loan_repayments} />
          <MoneyRow label="Current cycle repayments to date" value={position.total_loan_repayments} />
          <MoneyRow label="Outstanding principal before meeting" value={position.outstanding_principal_before} />
          <MoneyRow label="Outstanding principal now" value={position.outstanding_principal_now} strong />
        </section>
        <section className="position-card" aria-labelledby="cycle-social-heading">
          <h4 id="cycle-social-heading">Social Fund</h4>
          <MoneyRow label="Contributions this meeting" value={position.current_social_fund} />
          <MoneyRow label="Current cycle contributions to date" value={position.total_social_fund} />
          <MoneyRow label="Current Social Fund cash position" value={position.social_fund_balance} strong />
        </section>
      </div>
    </div>
  );
}
function Reconcile({ busy, balances, call }) {
  const [s, setS] = useState(balances.currentSavingsLoan),
    [f, setF] = useState(balances.currentSocialFund),
    [signature, setSignature] = useState(null);
  return (
    <div className="cash-reconciliation-form">
      <div className="cash-reconciliation-heading">
        <p className="eyebrow">Physical cash count</p>
        <h3>Counted fund cash</h3>
        <p>
          Enter the cash physically counted for each fund. These current-cycle fund balances are
          separate from the meeting activity and savings totals above.
        </p>
      </div>
      <label>
        Counted Savings/Loan Fund Cash
        <input inputMode="decimal" value={s} onChange={(e) => setS(e.target.value)} />
        <span>System-calculated cash position: {formatCurrency(balances.currentSavingsLoan)}</span>
      </label>
      <label>
        Counted Social Fund Cash
        <input inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} />
        <span>System-calculated cash position: {formatCurrency(balances.currentSocialFund)}</span>
      </label>
      <SignaturePad disabled={busy} onChange={setSignature} />
      <button
        disabled={busy || !signature}
        onClick={() =>
          call("/reconcile", {
            countedSavingsLoanBalance: s,
            countedSocialFundBalance: f,
            signatureDataUrl: signature,
          })
        }
      >
        Save reconciliation
      </button>
    </div>
  );
}
