import Link from 'next/link';
import {notFound} from 'next/navigation';
import PublicNav from '@/components/public-nav';
import PublicJoinForm from '@/components/public-join-form';
import {publicGroup} from '@/modules/public/public.service';
import {formatCurrency} from '@/lib/utils/money';

export const dynamic='force-dynamic';

const words=(value)=>String(value||'').replaceAll('_',' ').toLowerCase();
const location=(group)=>[group.community,`${group.lga} LGA`,`${group.state} State`].filter(Boolean).join(', ');

export default async function Group({params,searchParams}) {
  let group;
  try { group=await publicGroup((await params).id); } catch { return notFound(); }
  const join=(await searchParams).join;
  const constitution=group.constitution;
  const details=constitution?[
    ['Share value',formatCurrency(constitution.share_value)],
    ['Shares per meeting',`${constitution.min_shares_per_meeting}–${constitution.max_shares_per_meeting}`],
    ['Social Fund contribution',formatCurrency(constitution.social_fund_contribution)],
    ['Loan limit',`Up to ${Number(constitution.loan_max_multiple)}× member savings`],
    constitution.loan_service_charge_rate!==null?['Service charge',`${Number(constitution.loan_service_charge_rate)}%`]:null,
    ['Maximum loan term',`${constitution.loan_max_term_months} month${constitution.loan_max_term_months===1?'':'s'}`],
    ['Meeting frequency',words(constitution.meeting_frequency)],
    constitution.quorum_percentage!==null?['Quorum',`${Number(constitution.quorum_percentage)}%`]:null,
    constitution.loan_freeze_weeks_before_shareout!==null?['Loan freeze before share-out',`${constitution.loan_freeze_weeks_before_shareout} week${constitution.loan_freeze_weeks_before_shareout===1?'':'s'}`]:null,
  ].filter(Boolean):[];

  return <div className="public-site public-inner"><PublicNav/><main>
    <header className="public-group-hero"><div><p className="section-kicker">Savings group profile</p><h1>{group.group_name}</h1><p>{location(group)}</p></div><span className="public-status">{words(group.group_status)}</span></header>
    <section className="public-tool-section public-group-detail"><Link href="/find-a-group">← Back to group search</Link>
      <section className="public-profile-summary" aria-labelledby="about-group"><div><p className="section-kicker">About this group</p><h2 id="about-group">A community-led savings group.</h2><p>Review the group’s public information and approved savings rules before requesting membership.</p></div><dl><div><dt>Location</dt><dd>{location(group)}</dd></div><div><dt>Active members</dt><dd>{group.member_count}</dd></div>{group.year_formed&&<div><dt>Year formed</dt><dd>{group.year_formed}</dd></div>}<div><dt>Membership intake</dt><dd>{words(group.membership_intake_status)}</dd></div></dl></section>
      <section className="public-constitution" aria-labelledby="constitution-summary"><div className="public-section-heading"><div><p className="section-kicker">Group rules</p><h2 id="constitution-summary">Constitution</h2></div>{constitution?.has_document&&<a className="button-secondary" href={`/api/public/groups/${group.public_id}/constitution`}>Download Constitution</a>}</div>
        {!constitution?<p className="public-empty-state">No Constitution information is currently available.</p>:<><div className="constitution-summary-grid">{details.map(([label,value])=><article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>{constitution.fine_rules.length>0&&<div className="public-fine-rules"><h3>Fine rules</h3><div>{constitution.fine_rules.map((rule)=><article key={`${rule.name}-${rule.amount}`}><span><strong>{rule.name}</strong>{rule.description&&<small>{rule.description}</small>}</span><b>{formatCurrency(rule.amount)}</b></article>)}</div></div>}{!constitution.has_document&&<p className="public-document-note">Constitution document has not been uploaded.</p>}</>}
      </section>
      <div className="join-area"><p className="section-kicker">Membership request</p><h2>{join?'Tell the group about yourself.':'Interested in joining?'}</h2><p>Submitting this form does not automatically make you a member. Your request will be reviewed by the savings group and its assigned Agent.</p>{join?<PublicJoinForm group={group}/>:<Link className="button" href={`/find-a-group/${group.public_id}?join=1`}>Request to Join</Link>}</div>
    </section>
  </main></div>;
}
