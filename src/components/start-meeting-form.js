"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MEETING_TYPES = [
  ["PHYSICAL", "Physical"],
  ["VIRTUAL", "Virtual"],
  ["HYBRID", "Hybrid"],
];

export default function StartMeetingForm({ groupId, today, googleMeetConnected = false }) {
  const [date, setDate] = useState(today);
  const [meetingMode, setMeetingMode] = useState("PHYSICAL");
  const [meetSetup, setMeetSetup] = useState(googleMeetConnected ? "AUTOMATIC" : "MANUAL");
  const [virtualMeetingUrl, setVirtualMeetingUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const needsMeetSetup = meetingMode !== "PHYSICAL";
  const needsManualLink = needsMeetSetup && meetSetup === "MANUAL";

  function changeMeetingMode(nextMode) {
    setMeetingMode(nextMode);
    if (nextMode === "PHYSICAL") setVirtualMeetingUrl("");
  }

  function changeMeetSetup(nextSetup) {
    setMeetSetup(nextSetup);
    if (nextSetup === "AUTOMATIC") setVirtualMeetingUrl("");
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      meetingDate: date,
      meetingMode,
      meetSetup: needsMeetSetup ? meetSetup : "MANUAL",
      ...(needsManualLink ? { virtualMeetingUrl } : {}),
    };
    const response = await fetch(`/api/v1/groups/${groupId}/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(result.error?.message || "Unable to start meeting");
      return;
    }
    const cohostStatus = result.data.googleMeetCohostAssignment;
    const notice = ["MISSING_EMAIL", "FAILED", "PENDING"].includes(cohostStatus)
      ? `?googleMeetCohost=${cohostStatus}`
      : "";
    router.push(`/groups/${groupId}/meetings/${result.data.id}${notice}`);
    router.refresh();
  }

  return (
    <form className="panel" style={{ padding: 24, maxWidth: 560 }} onSubmit={submit}>
      <label>
        Meeting date
        <input type="date" required max={today} value={date} onChange={(event) => setDate(event.target.value)}/>
      </label>

      <fieldset style={{ marginTop: 18 }}>
        <legend>Meeting Type</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {MEETING_TYPES.map(([value, label]) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="radio" name="meetingMode" value={value} checked={meetingMode === value} onChange={() => changeMeetingMode(value)}/>
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {needsMeetSetup && (
        <fieldset style={{ marginTop: 18 }}>
          <legend>Google Meet Setup</legend>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="radio"
                name="meetSetup"
                value="AUTOMATIC"
                disabled={!googleMeetConnected}
                checked={meetSetup === "AUTOMATIC"}
                onChange={() => changeMeetSetup("AUTOMATIC")}
              />
              Create Google Meet automatically
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="radio" name="meetSetup" value="MANUAL" checked={meetSetup === "MANUAL"} onChange={() => changeMeetSetup("MANUAL")}/>
              Use existing Google Meet link
            </label>
          </div>
          {!googleMeetConnected && (
            <p className="muted">Google Meet is not connected. Ask a Visave administrator to connect the organization Google account, or use an existing Meet link.</p>
          )}
        </fieldset>
      )}

      {needsManualLink && (
        <label style={{ marginTop: 18 }}>
          Google Meet Link
          <input
            type="url"
            required
            inputMode="url"
            autoComplete="url"
            placeholder="https://meet.google.com/abc-defg-hij"
            value={virtualMeetingUrl}
            onChange={(event) => setVirtualMeetingUrl(event.target.value)}
          />
          <span className="muted">Paste the Google Meet link for this meeting.</span>
        </label>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? "Starting…" : "Start meeting"}</button>
    </form>
  );
}
