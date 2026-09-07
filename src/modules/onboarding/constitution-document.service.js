import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, NotFoundError } from "@/lib/errors";
import { stagePdf, finalizePrivateFile, removePrivateFile, readPrivateFile } from "@/lib/private-storage";
import { assertGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";

export async function listConstitutionDocuments(groupId, user, client = pool) {
  await assertGroupAction(user, groupId, GROUP_ACTION.CONSTITUTION_VIEW, client);
  return (await client.query(`SELECT d.id,d.constitution_id,d.original_filename,d.mime_type,d.file_size_bytes,d.sha256,d.uploaded_at,d.uploaded_by_user_id,d.replaced_by_document_id,d.archived_at FROM constitution_documents d JOIN group_constitutions c ON c.id=d.constitution_id AND c.group_id=d.group_id WHERE d.group_id=$1 AND d.organization_id=$2 ORDER BY d.uploaded_at DESC`, [groupId,user.organization_id])).rows;
}

export async function uploadConstitutionDocument(groupId, constitutionId, file, reason, user) {
  const staged = await stagePdf(file);
  try {
    return await withTransaction(async (client) => {
      await assertGroupAction(user, groupId, GROUP_ACTION.CONSTITUTION_MANAGE, client);
      const constitution = (await client.query("SELECT * FROM group_constitutions WHERE id=$1 AND group_id=$2 AND organization_id=$3 FOR UPDATE", [constitutionId,groupId,user.organization_id])).rows[0];
      if (!constitution) throw new NotFoundError("Constitution version not found");
      const current = (await client.query("SELECT * FROM constitution_documents WHERE constitution_id=$1 AND archived_at IS NULL FOR UPDATE", [constitutionId])).rows[0];
      if (current && (!reason || reason.trim().length < 5)) throw new AppError("A reason is required when replacing a signed Constitution", "CONSTITUTION_DOCUMENT_REPLACEMENT_REASON_REQUIRED", 422);
      if (current) await client.query("UPDATE constitution_documents SET archived_at=now() WHERE id=$1", [current.id]);
      const document = (await client.query(`INSERT INTO constitution_documents(organization_id,group_id,constitution_id,original_filename,storage_key,mime_type,file_size_bytes,sha256,uploaded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [user.organization_id,groupId,constitutionId,staged.originalFilename,staged.storageKey,staged.mimeType,staged.size,staged.sha256,user.id])).rows[0];
      if (current) await client.query("UPDATE constitution_documents SET replaced_by_document_id=$2 WHERE id=$1", [current.id,document.id]);
      await writeAudit(client,{organizationId:user.organization_id,actorUserId:user.id,action:current?"CONSTITUTION_DOCUMENT_REPLACED":"CONSTITUTION_DOCUMENT_UPLOADED",entityType:"CONSTITUTION_DOCUMENT",entityId:document.id,oldValues:current?{documentId:current.id}:null,newValues:{groupId,constitutionId,filename:staged.originalFilename,size:staged.size,sha256:staged.sha256,reason:reason||null}});
      await finalizePrivateFile(staged);
      return document;
    });
  } catch (error) { await removePrivateFile(staged.temporaryKey); await removePrivateFile(staged.storageKey); throw error; }
}

export async function downloadConstitutionDocument(groupId, constitutionId, user) {
  await assertGroupAction(user, groupId, GROUP_ACTION.CONSTITUTION_VIEW);
  const document = (await pool.query(`SELECT d.* FROM constitution_documents d JOIN group_constitutions c ON c.id=d.constitution_id WHERE d.constitution_id=$1 AND d.group_id=$2 AND d.organization_id=$3 AND d.archived_at IS NULL AND c.group_id=$2`, [constitutionId,groupId,user.organization_id])).rows[0];
  if (!document) throw new NotFoundError("Signed Constitution document not found");
  return { document, bytes: await readPrivateFile(document.storage_key) };
}
