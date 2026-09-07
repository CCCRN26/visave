"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import CycleScheduleForm from "@/components/cycle-schedule-form";
import { readActionResponse } from "@/lib/client/safe-response";

export default function NextCyclePanel({ groupId, previousCycle, constitutions, initiallyOpen = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const nextNumber = Number(previousCycle.cycle_number) + 1;

  async function createCycle(body) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/groups/${groupId}/cycles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readActionResponse(response);
      if (!response.ok) throw new Error(result.error?.message || "Cycle creation failed");
      setMessage(`Cycle ${nextNumber} was created as READY. Return to Share-out to carry the Social Fund forward.`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 24, marginBottom: 20 }}>
      <h2>Prepare the next cycle</h2>
      <p>Cycle {previousCycle.cycle_number} is <span className="badge">{previousCycle.status}</span>. A READY next cycle is required before the Social Fund can be carried forward.</p>
      {message && <p role="status">{message}</p>}
      {!open ? <button type="button" onClick={() => setOpen(true)}>Create Next Cycle</button> : (
        <div className="grid" style={{ gap: 16 }}>
          <div><strong>Create Cycle {nextNumber}</strong><br /><span className="muted">Previous cycle: Cycle {previousCycle.cycle_number} — {previousCycle.status}</span></div>
          <CycleScheduleForm constitutions={constitutions} busy={busy} onSubmit={createCycle} cycleNumber={nextNumber} fixedCycleNumber submitLabel="Create Cycle" />
          <button className="secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
      <p><Link href={`/groups/${groupId}/cycles/${previousCycle.id}/shareout`}>Return to Share-out</Link></p>
    </section>
  );
}
