import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getConstitutions } from "@/modules/onboarding/onboarding.service";
import { listConstitutionDocuments } from "@/modules/onboarding/constitution-document.service";
import GroupNav from "@/components/group-nav";
import ConstitutionDocumentPanel from "@/components/constitution-document-panel";
import { formatDateTime } from "@/lib/utils/date";

export default async function Constitution({params}){
  const{id}=await params,user=await requireAuth(),actor=await requireGroupRouteAction(user,id,"constitution.view",GROUP_ACTION.CONSTITUTION_VIEW);
  const[rows,documents]=await Promise.all([getConstitutions(id),listConstitutionDocuments(id,user)]),currentByConstitution=new Map(documents.filter(document=>!document.archived_at).map(document=>[document.constitution_id,document]));
  const canManage=canGroupAction(user,actor,GROUP_ACTION.CONSTITUTION_MANAGE);
  return <><h1>Constitution</h1><GroupNav id={id}/>{rows.length?rows.map(c=><article className="panel constitution-card" key={c.id}><h2>Version {c.version_number} <span className="badge">{c.status}</span></h2>{c.approved_at&&<p className="muted">Approved {formatDateTime(c.approved_at)}</p>}<div className="grid cards"><p><b>Share value</b><br/>{c.share_value} NGN</p><p><b>Shares per meeting</b><br/>{c.min_shares_per_meeting}–{c.max_shares_per_meeting}</p><p><b>Social Fund</b><br/>{c.social_fund_contribution} NGN</p><p><b>Loan multiple</b><br/>{c.loan_max_multiple}×</p><p><b>Loan term</b><br/>{c.loan_max_term_months} months</p><p><b>Meeting</b><br/>{c.meeting_frequency}</p></div><ConstitutionDocumentPanel groupId={id} constitution={c} document={currentByConstitution.get(c.id)||null} canManage={canManage}/></article>):<div className="panel muted" style={{padding:30}}>No constitution configured. Continue onboarding to create one.</div>}</>;
}
