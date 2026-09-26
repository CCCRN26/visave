"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GoogleMeetIntegrationPanel({ status }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function disconnect() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/integrations/google/disconnect", { method: "POST" });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(result.error?.message || "Unable to disconnect Google Meet.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="panel" style={{ padding: 24, marginTop: 18 }} aria-labelledby="google-meet-integration-title">
      <p className="eyebrow">Organization integration</p>
      <h2 id="google-meet-integration-title">Google Meet Integration</h2>
      <p>Status: <strong>{status.connected ? "Connected" : "Not connected"}</strong></p>
      {status.connected ? (
        <>
          <p>Connected account: <strong>{status.connectedEmail}</strong></p>
          <button type="button" className="secondary-button" disabled={busy} onClick={disconnect}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </>
      ) : (
        <a className="button" href="/api/v1/integrations/google/connect">Connect Google Account</a>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
