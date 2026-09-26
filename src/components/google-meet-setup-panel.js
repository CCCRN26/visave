"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

export default function GoogleMeetSetupPanel({
  groupId,
  meetingId,
  connected,
  hasMeetLink,
  googleCreated,
  operatorEmailConfigured,
  joinUrl,
  initialCohostStatus = "READY",
  initialNotice = "",
}) {
  const [virtualMeetingUrl, setVirtualMeetingUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [cohostStatus, setCohostStatus] = useState(initialCohostStatus);
  const automaticRetryStarted = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  const save = useCallback(async (method, body, automatic = false) => {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch(`/api/v1/groups/${groupId}/meetings/${meetingId}/google-meet`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(result.error?.message || "Unable to prepare Google Meet.");
      return;
    }
    const nextCohostStatus = result.data.cohostAssignment;
    if (nextCohostStatus) setCohostStatus(nextCohostStatus);
    if (result.data.cohostWarning) setNotice(result.data.cohostWarning);
    else if (["READY", "ALREADY_ASSIGNED"].includes(nextCohostStatus)) {
      setNotice("The meeting operator is assigned as a Google Meet co-host.");
      if (automatic) router.replace(pathname);
    } else if (nextCohostStatus === "PENDING") {
      setNotice("Preparing Google Meet…");
    }
    router.refresh();
  }, [groupId, meetingId, pathname, router]);

  useEffect(() => {
    if (initialCohostStatus !== "PENDING" || automaticRetryStarted.current) return;
    automaticRetryStarted.current = true;
    save("POST", undefined, true);
  }, [initialCohostStatus, save]);

  if (hasMeetLink) {
    return googleCreated ? (
      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <strong>Host reminder</strong>
        <p className="muted">Some participants may need to request entry. Only admit recognized group members.</p>
        {cohostStatus === "PENDING" && <p role="status">Preparing Google Meet…</p>}
        {!operatorEmailConfigured && !notice && (
          <p>Google Meet was created. <Link href="/settings">Add a Google Meet email to your profile</Link> to be assigned automatically as a co-host.</p>
        )}
        {notice && cohostStatus !== "PENDING" && <p role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {joinUrl && cohostStatus !== "PENDING" && <a className="button" href={joinUrl} target="_blank" rel="noopener noreferrer">Join Meeting</a>}
        {operatorEmailConfigured && (
          <button type="button" className="secondary-button" disabled={busy || !connected} onClick={() => save("POST")} style={{ marginLeft: 10 }}>
            {busy ? "Assigning co-host…" : "Retry co-host assignment"}
          </button>
        )}
        {!connected && <p className="form-error">Google Meet must be reconnected before co-host assignment can be retried.</p>}
      </div>
    ) : null;
  }

  return (
    <section className="panel" style={{ padding: 20, marginBottom: 14 }} aria-labelledby="google-meet-setup-title">
      <h2 id="google-meet-setup-title">Google Meet Setup</h2>
      {!connected && (
        <p className="form-error">Google Meet is not connected. Ask a Visave administrator to connect the organization Google account, or use an existing Meet link.</p>
      )}
      {connected && (
        <button type="button" disabled={busy} onClick={() => save("POST")}>
          {busy ? "Creating Google Meet…" : "Retry Google Meet"}
        </button>
      )}
      <div style={{ marginTop: 18 }}>
        <label>
          Google Meet Link
          <input
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://meet.google.com/abc-defg-hij"
            value={virtualMeetingUrl}
            onChange={(event) => setVirtualMeetingUrl(event.target.value)}
          />
          <span className="muted">Or paste an existing Google Meet link for this meeting.</span>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !virtualMeetingUrl.trim()}
          onClick={() => save("PATCH", { virtualMeetingUrl })}
          style={{ marginTop: 10 }}
        >
          Use Existing Meet Link
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
