"use client";

import { useState } from "react";

export default function GoogleMeetEmailPanel({ initialEmail }) {
  const [googleMeetEmail, setGoogleMeetEmail] = useState(initialEmail || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/v1/me/google-meet-email", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ googleMeetEmail }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(result.error?.message || "Unable to save Google Meet email.");
      return;
    }
    setGoogleMeetEmail(result.data.googleMeetEmail || "");
    setMessage(result.data.googleMeetEmail
      ? "Google Meet email saved."
      : "Google Meet email removed.");
  }

  return (
    <form className="panel" style={{ padding: 24 }} onSubmit={submit}>
      <h2>Meeting operator profile</h2>
      <label>
        Google Meet Email
        <input
          type="email"
          autoComplete="email"
          maxLength={254}
          value={googleMeetEmail}
          onChange={(event) => setGoogleMeetEmail(event.target.value)}
        />
        <span className="muted">Optional. Used to assign this user as a co-host when they operate a virtual Visave meeting.</span>
      </label>
      {message && <p role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? "Saving…" : "Save Google Meet Email"}</button>
    </form>
  );
}
