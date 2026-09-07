import Link from "next/link";
import GroupNav from "@/components/group-nav";
import MemberStatementView from "@/components/member-statement-view";
import { requireAuth } from "@/lib/auth/session";
import { getMemberStatement } from "@/modules/reports/member-statement.service";

export const metadata = { title: "Member Statement" };
export default async function MemberStatementPage({ params }) {
  const { id, cycleId, memberId } = await params;
  const report = await getMemberStatement(await requireAuth(), id, cycleId, memberId);
  const base = `/api/v1/groups/${id}/cycles/${cycleId}/members/${memberId}/reports`;
  return <><div className="report-page-heading"><div><p className="eyebrow">Visave member statement</p><h1>{report.metadata.memberName} · Cycle {report.metadata.cycleNumber}</h1></div><div><a className="button" href={`${base}/excel`}>Download Excel</a><a className="button secondary" href={`${base}/pdf`}>Download PDF</a></div></div><GroupNav id={id}/><p><Link href={`/groups/${id}/reports/cycles/${cycleId}`}>← Cycle report</Link></p><MemberStatementView report={report}/></>;
}
