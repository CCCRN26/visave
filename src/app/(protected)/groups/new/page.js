'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewGroup() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [states, setStates] = useState([]);
  const [lgas, setLgas] = useState([]);
  const [stateId, setStateId] = useState('');
  const [lgaId, setLgaId] = useState('');
  const [agentOptions, setAgentOptions] = useState(null);
  const [error, setError] = useState('');
  const [locationLoading, setLocationLoading] = useState('');
  const availableLgas = agentOptions
    ? [...new Map(agentOptions.filter((row) => row.state_id === stateId && row.lga_id).map((row) => [row.lga_id, { id: row.lga_id, name: row.lga_name }])).values()]
    : lgas;

  useEffect(() => {
    async function load() {
      const scoped = await fetch('/api/v1/agent/group-creation-options');
      if (scoped.ok) {
        const result = await scoped.json();
        const rows = result.data || [];
        setAgentOptions(rows);
        setProjects([...new Map(rows.map((row) => [row.project_id, { id: row.project_id, name: row.project_name }])).values()]);
        setStates([...new Map(rows.map((row) => [row.state_id, { id: row.state_id, name: row.state_name }])).values()]);
        return;
      }
      const [projectResponse, stateResponse] = await Promise.all([
        fetch('/api/v1/projects?pageSize=100'),
        fetch('/api/v1/locations/states'),
      ]);
      const [projectResult, stateResult] = await Promise.all([projectResponse.json(), stateResponse.json()]);
      setProjects(projectResult.data?.items || []);
      setStates(stateResult.data || []);
    }
    load().catch(() => setError('Unable to load group creation options.'));
  }, []);

  useEffect(() => {
    if (!stateId) return;
    if (agentOptions) return;
    const controller = new AbortController();
    fetch(`/api/v1/locations/lgas?stateId=${stateId}`, { signal: controller.signal }).then(async (response) => { const result=await response.json(); if(!response.ok) throw new Error(result.error?.message||'Unable to load LGAs.'); setLgas(result.data || []); }).catch((reason) => { if(reason.name!=='AbortError') setError(reason.message); }).finally(() => { if(!controller.signal.aborted) setLocationLoading(''); });
    return () => controller.abort();
  }, [stateId, agentOptions]);

  function changeState(event) {
    const nextStateId = event.target.value;
    setStateId(nextStateId);
    setLgaId('');
    setLgas([]);
    setLocationLoading(nextStateId && !agentOptions ? 'lgas' : '');
  }

  function changeLga(event) {
    setLgaId(event.target.value);
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    body.communityName = body.communityName.trim() || null;
    if (body.expectedMemberCount) body.expectedMemberCount = Number(body.expectedMemberCount);
    const response = await fetch('/api/v1/groups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error?.message || 'Unable to create savings group.');
      return;
    }
    router.push(`/groups/${result.data.id}/onboarding`);
    router.refresh();
  }

  return <>
    <h1>Create Savings Group</h1>
    <p className="muted">New Agent-created groups begin in programme-assisted onboarding and remain private until explicitly published.</p>
    <form onSubmit={submit} className="panel grid" style={{ padding: 24, maxWidth: 760 }}>
      <label>Group name<input name="name" required maxLength={180} /></label>
      <label>Project<select name="projectId" required><option value="">Select project</option>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>State<select name="stateId" required value={stateId} onChange={changeState}><option value="">Select state</option>{states.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>LGA<select name="lgaId" required disabled={!stateId||locationLoading==='lgas'} value={lgaId} onChange={changeLga}><option value="">{locationLoading==='lgas'?'Loading LGAs…':'Select LGA'}</option>{availableLgas.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Community<input name="communityName" maxLength={300} placeholder="e.g. Nkaliki Village" /></label>
      <label>Date formed<input name="dateFormed" type="date" /></label>
      <label>Meeting location / general locality<input name="meetingLocation" maxLength={240} /></label>
      <label>Expected member count<input name="expectedMemberCount" type="number" min="1" max="1000" /></label>
      <label>Optional notes<textarea name="notes" maxLength={2000} rows={4} /></label>
      <input name="groupType" type="hidden" value="SUPERVISED" />
      <input name="status" type="hidden" value="ONBOARDING" />
      {error && <p role="alert" style={{ color: '#c33' }}>{error}</p>}
      <button>Create Savings Group</button>
    </form>
  </>;
}
