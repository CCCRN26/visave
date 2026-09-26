"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/date";

const modeLabels = { PHYSICAL: "Physical", VIRTUAL: "Virtual", HYBRID: "Hybrid" };

export default function MemberMeetingLiveView({ groupId, meetingId, initial }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const controller = useRef(null);

  const refresh = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const response = await fetch(`/api/v1/me/groups/${groupId}/meetings/${meetingId}`, {
        method: "GET",
        signal: controller.current.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Unable to refresh meeting activity.");
      setData(result.data);
    } catch (requestError) {
      if (requestError.name !== "AbortError") setError(requestError.message);
    } finally {
      inFlight.current = false;
      if (!silent) setBusy(false);
    }
  }, [groupId, meetingId]);

  useEffect(() => {
    if (data.meeting.status !== "OPEN") return undefined;
    const timer = setInterval(() => refresh(true), 12000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [data.meeting.status, refresh]);

  const virtualEnded = data.meeting.status !== "OPEN"
    && ["VIRTUAL", "HYBRID"].includes(data.meeting.meetingMode);

  return <main>
    <div className="page-header">
      <div>
        <p className="eyebrow">{data.meeting.groupName} · {data.meeting.groupCode}</p>
        <h1>Meeting #{data.meeting.meetingNumber}</h1>
        <p className="muted">{formatDate(data.meeting.meetingDate)} · {modeLabels[data.meeting.meetingMode]} · <span className="badge">{data.meeting.status}</span></p>
      </div>
      {data.meeting.status === "OPEN" && data.meeting.joinUrl && (
        <a className="button" href={data.meeting.joinUrl} target="_blank" rel="noopener noreferrer">Join Meeting</a>
      )}
      {virtualEnded && <strong>Virtual meeting ended</strong>}
    </div>

    <section className="panel" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><strong>My attendance</strong><p className="muted" style={{ margin: 0 }}>{data.meeting.attendanceStatus}</p></div>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => refresh(false)}>{busy ? "Refreshing…" : "Refresh activity"}</button>
      </div>
      {data.meeting.status === "OPEN" && <p className="muted">Activity refreshes automatically about every 12 seconds while this meeting is open.</p>}
      <small className="muted">Last refreshed {formatDateTime(data.refreshedAt)}</small>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>

    <section className="grid cards" aria-label="Meeting contribution summary">
      <article className="panel" style={{ padding: 16 }}><small className="muted">Meeting Savings Total</small><h3>{formatCurrency(data.summary.meetingSavingsTotal)}</h3></article>
      <article className="panel" style={{ padding: 16 }}><small className="muted">Meeting Social Fund Total</small><h3>{formatCurrency(data.summary.meetingSocialFundTotal)}</h3></article>
      <article className="panel" style={{ padding: 16 }}><small className="muted">My Savings This Meeting</small><h3>{formatCurrency(data.summary.ownSavings)}</h3></article>
      <article className="panel" style={{ padding: 16 }}><small className="muted">My Social Fund This Meeting</small><h3>{formatCurrency(data.summary.ownSocialFund)}</h3></article>
    </section>

    <section className="panel" style={{ padding: 20, marginTop: 18 }}>
      <h2>Contribution Activity</h2>
      <p className="muted">Posted Visave savings and Social Fund entries only. Loan, repayment and fine details are not shown.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Member</th><th>Savings</th><th>Social Fund</th></tr></thead>
        <tbody>{data.contributions.map((row) => <tr key={row.memberName}>
          <td>{row.memberName}</td><td>{formatCurrency(row.savingsAmount)}</td><td>{formatCurrency(row.socialFundAmount)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
