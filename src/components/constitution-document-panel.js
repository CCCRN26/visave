"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConstitutionDocumentPanel({ groupId, constitution, document, canManage }) {
  const [file,setFile]=useState(null),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const router=useRouter();
  async function upload(event){event.preventDefault();setBusy(true);setError("");const body=new FormData();body.set("file",file);if(reason)body.set("reason",reason);const response=await fetch(`/api/v1/groups/${groupId}/constitution/${constitution.id}/document`,{method:"POST",body}),json=await response.json();setBusy(false);if(!response.ok)return setError(json.error?.message||"Unable to upload the signed Constitution");setFile(null);setReason("");router.refresh()}
  return <section className="constitution-document"><h3>Signed Constitution</h3>{document?<><p><strong>{document.original_filename}</strong><br/><small>Uploaded {new Intl.DateTimeFormat("en-NG",{dateStyle:"medium"}).format(new Date(document.uploaded_at))}</small></p><a className="button-secondary" href={`/api/v1/groups/${groupId}/constitution/${constitution.id}/document`}>Download Constitution</a></>:<p className="muted">No signed constitution document uploaded.</p>}{canManage&&<form onSubmit={upload}><label>{document?"Replace signed PDF":"Upload signed PDF"}<input type="file" accept="application/pdf,.pdf" required onChange={(event)=>setFile(event.target.files?.[0]||null)}/></label>{document&&<label>Reason for replacement *<input required minLength={5} maxLength={1000} value={reason} onChange={(event)=>setReason(event.target.value)}/></label>}<button disabled={busy||!file}>{busy?"Uploading…":document?"Replace PDF":"Upload PDF"}</button>{error&&<p className="form-error" role="alert">{error}</p>}<small className="muted">PDF only, maximum 10 MB. Previous signed evidence is preserved when replaced.</small></form>}</section>;
}
