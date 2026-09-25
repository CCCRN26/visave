"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MEETING_TYPES = [
  ["PHYSICAL", "Physical"],
  ["VIRTUAL", "Virtual"],
  ["HYBRID", "Hybrid"],
];

export default function StartMeetingForm({ groupId, today }) {
  const [date, setDate] = useState(today);
  const [meetingMode, setMeetingMode] = useState("PHYSICAL");
  const [virtualMeetingUrl, setVirtualMeetingUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const needsMeetLink = meetingMode !== "PHYSICAL";

  function changeMeetingMode(nextMode) {
    setMeetingMode(nextMode);
    if (nextMode === "PHYSICAL") setVirtualMeetingUrl("");
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const body = {
      meetingDate: date,
      meetingMode,
      ...(needsMeetLink ? { virtualMeetingUrl } : {}),
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

    router.push(`/groups/${groupId}/meetings/${result.data.id}`);
    router.refresh();
  }

  return (
    <form className="panel" style={{ padding: 24, maxWidth: 520 }} onSubmit={submit}>
      <label>
        Meeting date
        <input
          type="date"
          required
          max={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>

      <fieldset style={{ marginTop: 18 }}>
        <legend>Meeting Type</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {MEETING_TYPES.map(([value, label]) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="radio"
                name="meetingMode"
                value={value}
                checked={meetingMode === value}
                onChange={() => changeMeetingMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {needsMeetLink && (
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

      {error && <p style={{ color: "#c33" }}>{error}</p>}
      <button disabled={busy}>{busy ? "Starting…" : "Start meeting"}</button>
    </form>
  );
}
