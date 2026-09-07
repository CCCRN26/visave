"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ActivateCycleButton({ groupId, cycleId, cycleNumber }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function activate() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/groups/${groupId}/cycles/${cycleId}/activate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Cycle activation failed");
      router.refresh();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <><button disabled={busy} onClick={activate}>Activate Cycle {cycleNumber}</button>{message && <p role="alert">{message}</p>}</>;
}
