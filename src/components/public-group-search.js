'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function PublicGroupSearch({ joining = false }) {
  const [states, setStates] = useState([]);
  const [lgas, setLgas] = useState([]);
  const [state, setState] = useState('');
  const [lga, setLga] = useState('');
  const [groups, setGroups] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState('');

  useEffect(() => {
    fetch('/api/public/locations/states').then((response) => response.json()).then((result) => setStates(result.data || []));
  }, []);

  useEffect(() => {
    if (!state) return;
    const controller=new AbortController();fetch(`/api/public/locations/lgas?stateId=${state}`,{signal:controller.signal}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Unable to load LGAs.');setLgas(result.data||[])}).catch(error=>{if(error.name!=='AbortError')setMessage(error.message)}).finally(()=>{if(!controller.signal.aborted)setLoading('')});return()=>controller.abort();
  }, [state]);

  function changeState(event) {
    const nextState = event.target.value;
    setState(nextState);
    setLga('');
    setLgas([]);
    setGroups([]);
    setMessage('');
    setLoading(nextState ? 'lgas' : '');
  }

  function changeLga(event) {
    setLga(event.target.value);
    setGroups([]);
  }

  async function search(event) {
    event.preventDefault();
    setMessage('');
    const query = new URLSearchParams({ state_id: state, lga_id: lga });
    const response = await fetch(`/api/public/groups?${query}`);
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error?.message || 'Search failed');
      return;
    }
    setGroups(result.data);
  }

  return <>
    <form className="public-filter-panel" onSubmit={search}>
      <label>State<select required value={state} onChange={changeState}><option value="">Select state</option>{states.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>LGA<select required disabled={!state||loading==='lgas'} value={lga} onChange={changeLga}><option value="">{loading==='lgas'?'Loading LGAs…':'Select LGA'}</option>{lgas.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <button>Find Groups</button>
    </form>
    {message && <p className="public-form-message" role="alert">{message}</p>}
    <div className="public-results">
      {groups.map((item) => <article className="public-group-card" key={item.public_id}><span className="public-status">{item.membership_intake_status.replaceAll('_', ' ').toLowerCase()}</span><h2>{item.group_name}</h2><p className="group-location">{item.community || item.lga}, {item.state}</p><dl><div><dt>Members</dt><dd>{item.member_count}</dd></div><div><dt>Membership intake</dt><dd>{item.membership_intake_status.replaceAll('_', ' ').toLowerCase()}</dd></div></dl><Link className="button" href={joining ? `/find-a-group/${item.public_id}?join=1` : `/find-a-group/${item.public_id}`}>{joining ? 'Request to Join' : 'View Group'}</Link></article>)}
      {lga && !groups.length && <div className="public-empty"><strong>No groups currently match this location.</strong><p>Try another LGA or check again later.</p></div>}
    </div>
  </>;
}
