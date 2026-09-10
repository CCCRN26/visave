'use client';

import { useState } from 'react';
import { phoneInputProps, sanitizePhoneInput } from '@/lib/validation/phone';

export default function ContactForm() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/public/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) });
    const json = await response.json();
    setBusy(false);
    setMessage(response.ok ? 'Your message has been received.' : json.error?.message || 'Unable to send message');
    if (response.ok) event.currentTarget.reset();
  }

  return <form className="public-form" onSubmit={submit}><div className="form-grid"><label>Name<input name="name" required/></label><label>Phone<input name="phone" {...phoneInputProps} onInput={(event) => { event.currentTarget.value = sanitizePhoneInput(event.currentTarget.value); }}/></label></div><label>Email<input name="email" type="email"/></label><label>Reason<select name="category"><option value="SAVINGS_GROUP_INFORMATION">Savings group information</option><option value="JOINING_A_GROUP">Joining a group</option><option value="FORMING_A_GROUP">Forming a group</option><option value="TECHNICAL_SUPPORT">Technical support</option><option value="OTHER">Other</option></select></label><label>Message<textarea name="message" required maxLength="1500"/></label><button disabled={busy}>{busy ? 'Sending…' : 'Send Message'}</button>{message && <p className="public-form-message" role="status">{message}</p>}</form>;
}
