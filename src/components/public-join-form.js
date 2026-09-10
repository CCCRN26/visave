'use client';

import { useState } from 'react';
import { phoneInputProps, sanitizePhoneInput } from '@/lib/validation/phone';

export default function PublicJoinForm({ group }) {
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/public/groups/${group.public_id}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: form.get('firstName'), surname: form.get('surname'), phone: form.get('phone'), email: form.get('email') || undefined, stateId: form.get('stateId'), lgaId: form.get('lgaId'), communityId: form.get('communityId') || undefined, residenceText: form.get('residenceText') || undefined, message: form.get('message') || undefined }),
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(json.error?.message || 'Unable to submit request');
    setDone(true);
    setMessage(`Your request has been received. Reference: ${json.data.reference_code}`);
  }

  if (done) return <div className="public-form"><h3>Request received</h3><p>{message}</p><p>The Agent responsible for this savings group will review and follow up.</p></div>;
  return <form className="public-form" onSubmit={submit}><input type="hidden" name="stateId" value={group.state_id || ''}/><input type="hidden" name="lgaId" value={group.lga_id || ''}/><input type="hidden" name="communityId" value={group.community_id || ''}/><div className="form-grid"><label>First name<input name="firstName" required maxLength="100"/></label><label>Surname<input name="surname" required maxLength="100"/></label></div><div className="form-grid"><label>Phone number<input name="phone" required {...phoneInputProps} onInput={(event) => { event.currentTarget.value = sanitizePhoneInput(event.currentTarget.value); }}/></label><label>Email (optional)<input name="email" type="email"/></label></div><label>Residence / location<input name="residenceText" maxLength="300"/></label><label>Why would you like to join?<textarea name="message" maxLength="1000"/></label><button disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</button>{message && <p className="public-form-message" role="alert">{message}</p>}</form>;
}
