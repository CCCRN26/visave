'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DependentLocationFields from './dependent-location-fields';

export default function GroupEditForm({group,states}){
  const router=useRouter();
  const [location,setLocation]=useState({stateId:group.state_id||'',lgaId:group.lga_id||'',communityId:''});
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event){
    event.preventDefault();setBusy(true);setMessage('');
    const form=new FormData(event.currentTarget),communityName=String(form.get('communityName')||'').trim();
    const body={name:form.get('name'),stateId:location.stateId,lgaId:location.lgaId,meetingLocation:form.get('meetingLocation')||null,dateFormed:form.get('dateFormed')||null};
    if(communityName!==(group.display_community_name||''))body.communityName=communityName||null;
    const response=await fetch(`/api/v1/groups/${group.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),json=await response.json();
    setBusy(false);if(!response.ok)return setMessage(json.error?.message||'Unable to update group.');router.push(`/groups/${group.id}`);router.refresh();
  }
  return <form onSubmit={submit} className="panel grid" style={{padding:24,maxWidth:760}}><label>Group name<input name="name" defaultValue={group.name} required maxLength={180}/></label><DependentLocationFields states={states} value={location} onChange={setLocation} includeCommunity={false} requiredLga/><label>Community<input name="communityName" defaultValue={group.display_community_name||''} maxLength={300} placeholder="e.g. Nkaliki Village"/></label><label>Date formed<input name="dateFormed" type="date" defaultValue={group.date_formed||''}/></label><label>Meeting location<input name="meetingLocation" defaultValue={group.meeting_location||''} maxLength={500}/></label>{message&&<p role="alert" style={{color:'#c33'}}>{message}</p>}<button disabled={busy}>{busy?'Saving…':'Save changes'}</button></form>;
}
