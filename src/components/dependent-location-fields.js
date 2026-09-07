'use client';
import { useEffect, useState } from 'react';

export default function DependentLocationFields({ states, value, onChange, apiBase='/api/v1/locations', includeCommunity=true, requiredLga=false }) {
  const [lgas,setLgas]=useState([]),[communities,setCommunities]=useState([]),[loadedStateId,setLoadedStateId]=useState(''),[loadedLgaId,setLoadedLgaId]=useState(''),[error,setError]=useState('');
  const loadingLgas=Boolean(value.stateId&&loadedStateId!==value.stateId);
  const loadingCommunities=Boolean(includeCommunity&&value.lgaId&&loadedLgaId!==value.lgaId);

  useEffect(()=>{if(!value.stateId)return;const controller=new AbortController();fetch(`${apiBase}/lgas?stateId=${value.stateId}`,{signal:controller.signal}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Unable to load LGAs.');setLgas(j.data||[]);setLoadedStateId(value.stateId)}).catch(e=>{if(e.name!=='AbortError'){setError(e.message);setLoadedStateId(value.stateId)}});return()=>controller.abort()},[apiBase,value.stateId]);
  useEffect(()=>{if(!includeCommunity||!value.lgaId)return;const controller=new AbortController();fetch(`${apiBase}/communities?lgaId=${value.lgaId}`,{signal:controller.signal}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Unable to load Communities.');setCommunities(j.data||[]);setLoadedLgaId(value.lgaId)}).catch(e=>{if(e.name!=='AbortError'){setError(e.message);setLoadedLgaId(value.lgaId)}});return()=>controller.abort()},[apiBase,includeCommunity,value.lgaId]);

  function changeState(event){setLgas([]);setCommunities([]);setLoadedStateId('');setLoadedLgaId('');setError('');onChange({...value,stateId:event.target.value,lgaId:'',communityId:''})}
  function changeLga(event){setCommunities([]);setLoadedLgaId('');setError('');onChange({...value,lgaId:event.target.value,communityId:''})}

  return <><label>State<select name="stateId" required value={value.stateId} onChange={changeState}><option value="">Select state</option>{states.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>LGA<select name="lgaId" required={requiredLga} disabled={!value.stateId||loadingLgas} value={value.lgaId} onChange={changeLga}><option value="">{loadingLgas?'Loading LGAs…':'Select LGA'}</option>{lgas.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>{includeCommunity&&<label>Community<select name="communityId" disabled={!value.lgaId||loadingCommunities} value={value.communityId} onChange={e=>onChange({...value,communityId:e.target.value})}><option value="">{loadingCommunities?'Loading Communities…':'Select community'}</option>{communities.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}{error&&<p role="alert" className="muted">{error}</p>}</>;
}
