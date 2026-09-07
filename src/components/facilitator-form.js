"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export default function FacilitatorForm({
  projects,
  states,
  initial,
  facilitatorId,
}) {
  const router = useRouter(),
    editing = Boolean(facilitatorId),
    [form, setForm] = useState(
      initial || {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        staffCode: "",
        password: "",
        projectId: "",
        stateId: "",
        lgaId: "",
        groupIds: [],
      },
    ),
    [lgas, setLgas] = useState([]),
    [groups, setGroups] = useState([]),
    [message, setMessage] = useState(""),
    [groupSearch, setGroupSearch] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!form.stateId) return;
    const controller = new AbortController();
    fetch(`/api/v1/locations/lgas?stateId=${form.stateId}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => setLgas(j.data || []))
      .catch((error) => { if (error.name !== 'AbortError') setMessage('Unable to load LGAs.'); });
    return () => controller.abort();
  }, [form.stateId]);
  useEffect(() => {
    if (!form.projectId || !form.stateId) return;
    fetch(
      `/api/v1/groups?projectId=${form.projectId}&stateId=${form.stateId}&pageSize=100`,
    )
      .then((r) => r.json())
      .then((j) => setGroups(j.data?.items || []));
  }, [form.projectId, form.stateId]);
  const set = (key) => (event) =>
    setForm((value) => ({ ...value, [key]: event.target.value, ...(key === 'stateId' ? { lgaId: '', groupIds: [] } : {}) }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const body = { ...form, lgaId: form.lgaId || null };
    if (editing) {
      delete body.password;
      delete body.groupIds;
      delete body.reassignmentReason;
    }
    const response = await fetch(
        editing
          ? `/api/v1/facilitators/${facilitatorId}`
          : "/api/v1/facilitators",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      json = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(json.error?.message || "Unable to save facilitator");
      return;
    }
    if (editing) {
      const assignmentResponse = await fetch(`/api/v1/facilitators/${facilitatorId}/groups/assign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupIds: form.groupIds || [], reassignmentReason: form.reassignmentReason || undefined }) });
      const assignmentJson = await assignmentResponse.json();
      if (!assignmentResponse.ok) { setMessage(assignmentJson.error?.message || "Unable to update assigned groups"); return; }
    }
    router.push(`/facilitators/${json.data.facilitator.id}`);
    router.refresh();
  }
  return (
    <form
      onSubmit={submit}
      className="panel"
      style={{ padding: 24, display: "grid", gap: 18 }}
    >
      <h2>Personal Information</h2>
      <div className="grid cards">
        <label>
          First Name
          <input required value={form.firstName} onChange={set("firstName")} />
        </label>
        <label>
          Surname
          <input required value={form.lastName} onChange={set("lastName")} />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={set("email")}
          />
        </label>
        <label>
          Phone Number
          <input value={form.phone || ""} onChange={set("phone")} />
        </label>
        <label>
          Facilitator Code
          <input required value={form.staffCode} onChange={set("staffCode")} />
        </label>
      </div>
      <h2>Project and Geographic Scope</h2>
      <div className="grid cards">
        <label>
          Project
          <select required value={form.projectId} onChange={set("projectId")}>
            <option value="">Select project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          State
          <select required value={form.stateId} onChange={set("stateId")}>
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          LGA
          <select disabled={!form.stateId} value={form.lgaId || ""} onChange={set("lgaId")}>
            <option value="">All LGAs in state</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!editing && (
        <>
          <h2>Login Account</h2>
          <label>
            Initial Password
            <input
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set("password")}
            />
            <small className="muted">
              The facilitator must change this password. It is never displayed
              again.
            </small>
          </label>
          <h2>Groups — Optional</h2>
          <div>
            {groups
              .filter((group) => !form.lgaId || group.lga_id === form.lgaId)
              .map((group) => (
                <label key={group.id} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={form.groupIds.includes(group.id)}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        groupIds: event.target.checked
                          ? [...value.groupIds, group.id]
                          : value.groupIds.filter((id) => id !== group.id),
                      }))
                    }
                  />{" "}
                  {group.group_code} · {group.name}
                </label>
              ))}
          </div>
        </>
      )}
      {editing && <><h2>Assigned Groups</h2><p className="muted">Only groups inside this Agent&apos;s project and geographic scope are available.</p><label>Search groups<input type="search" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search name or group code" /></label><div className="assignment-checklist">{groups.filter((group) => !form.lgaId || group.lga_id === form.lgaId).filter((group) => `${group.group_code} ${group.name}`.toLowerCase().includes(groupSearch.toLowerCase())).map((group) => <label key={group.id}><input type="checkbox" checked={(form.groupIds || []).includes(group.id)} onChange={(event) => setForm((value) => ({ ...value, groupIds: event.target.checked ? [...(value.groupIds || []), group.id] : (value.groupIds || []).filter((id) => id !== group.id) }))} /> <span><strong>{group.name}</strong><small>{group.group_code}</small></span></label>)}</div><label>Reason for reassignment<input value={form.reassignmentReason || ""} onChange={set("reassignmentReason")} placeholder="Required if a selected group currently has another Agent" /><small className="muted">Recorded in the audit trail for reassignments.</small></label></>}
      {message && <p style={{ color: "#c33" }}>{message}</p>}
      <button disabled={busy}>
        {busy ? "Saving…" : editing ? "Save Changes" : "Create Facilitator"}
      </button>
    </form>
  );
}
