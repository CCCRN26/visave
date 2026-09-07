const blocked = /password|secret|token/i;
function sanitize(value) { if(!value||typeof value!=="object") return value; return Object.fromEntries(Object.entries(value).filter(([k])=>!blocked.test(k)).map(([k,v])=>[k,typeof v==="object"?sanitize(v):v])); }
export async function writeAudit(client,{organizationId,actorUserId,action,entityType,entityId,oldValues,newValues,ipAddress,userAgent}) {
  await client.query(`INSERT INTO audit_logs (organization_id,actor_user_id,action,entity_type,entity_id,old_values,new_values,ip_address,user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[organizationId||null,actorUserId||null,action,entityType||null,entityId||null,oldValues?JSON.stringify(sanitize(oldValues)):null,newValues?JSON.stringify(sanitize(newValues)):null,ipAddress||null,userAgent||null]);
}
