import {formatCurrency} from "@/lib/utils/money";
import {formatDate} from "@/lib/utils/date";
import {DashboardEmptyState,DashboardGroupCard,DashboardPageHeader,DashboardSection,DashboardStatCard} from "@/components/dashboard-primitives";

function StatGrid({items,className=""}){return <div className={`dashboard-kpis ${className}`}>{items.map(item=><DashboardStatCard key={item.label} {...item}/>)}</div>}

function GroupsGrid({groups,showAgent=false}){if(!groups.length)return <DashboardEmptyState title="No groups assigned yet" description="Groups assigned to you will appear here."/>;return <div className="dashboard-group-grid">{groups.map(group=><DashboardGroupCard group={group} showAgent={showAgent} key={group.id}/>)}</div>}

function savingsItems(metrics){return[
  {label:"Total Savings Ever",value:formatCurrency(metrics.total_savings_ever),helperText:"Net member savings across all completed and current cycles.",icon:"savings",tone:"financial"},
  {label:"Current Cycle Savings",value:formatCurrency(metrics.current_cycle_savings),helperText:"Net savings in currently active cycles.",icon:"savings",tone:"financial"},
]}

function socialFundItems(metrics){return[
  {label:"Total Social Fund Contributions",value:formatCurrency(metrics.total_social_fund_contributions),helperText:"All member contributions recorded historically. Carry-forward is not counted again.",icon:"social",tone:"social"},
  {label:"Current Social Fund Balance",value:formatCurrency(metrics.current_social_fund_balance),helperText:"Social Fund currently available in active cycles.",icon:"social",tone:"social"},
]}

function FinancialMetrics({metrics}){return <div className="dashboard-financial-groups"><section className="dashboard-financial-group" aria-labelledby="dashboard-savings-heading"><h3 id="dashboard-savings-heading">Savings</h3><StatGrid items={savingsItems(metrics)} className="dashboard-financial-pair"/></section><section className="dashboard-financial-group" aria-labelledby="dashboard-social-fund-heading"><h3 id="dashboard-social-fund-heading">Social Fund</h3><StatGrid items={socialFundItems(metrics)} className="dashboard-financial-pair"/></section><section className="dashboard-financial-group dashboard-financial-loans" aria-labelledby="dashboard-loans-heading"><h3 id="dashboard-loans-heading">Loans</h3><StatGrid items={[{label:"Outstanding Loans",value:formatCurrency(metrics.outstanding_loans),helperText:"Principal currently outstanding",icon:"loans",tone:"financial"}]} className="dashboard-financial-single"/></section></div>}

export default function DashboardView({data}){
  const{scope,metrics,groups}=data;
  if(scope.scopeType==="NO_ACTIVE_GROUP")return <><DashboardPageHeader eyebrow="Group workspace" title="Group Dashboard" description="Your current digitally linked officer assignments determine the information shown here." scope="No active group"/><DashboardEmptyState title="No active group assignment" description="Your dashboard will become available once you are digitally linked to a current officer assignment. Contact a programme administrator if you believe this is incorrect."/></>;

  const facilitator=scope.scopeType==="FACILITATOR",chairperson=scope.scopeType==="GROUPS",group=groups[0];
  const scopeLabel=chairperson?`Scope: ${group?.name||"Assigned group"}`:facilitator?`Scope: ${metrics.total_groups} ${metrics.total_groups===1?"group":"groups"}`:"Scope: All authorized groups";
  const header=chairperson?{
    eyebrow:"Officer dashboard",title:groups.length===1?(group?.name||"Group Dashboard"):"My Group Portfolio",description:"Current cycle and operational information for your digitally linked officer assignments.",scope:scopeLabel,meta:groups.length===1?[group?.community,group?.status?.replaceAll("_"," ").toLowerCase(),group?.cycle_number?`Cycle ${group.cycle_number}`:"No active cycle"].filter(Boolean).join(" · "):`${groups.length} linked groups`,
  }:facilitator?{
    eyebrow:"Portfolio overview",title:"My Groups",description:"Overview of the VSLA groups you facilitate.",scope:scopeLabel,
  }:{
    eyebrow:"Program overview",title:"Dashboard",description:"Performance and activity across all authorized VSLA groups.",scope:scopeLabel,
  };

  const primary=chairperson?[
    {label:"Active Members",value:metrics.total_members,helperText:"Current active membership",icon:"members",href:group&&`/groups/${group.id}/members`},
    {label:"Current Cycle",value:group?.cycle_number?`Cycle ${group.cycle_number}`:"No active cycle",helperText:group?.cycle_number?"Active operating cycle":"Financial activity unavailable",icon:"cycle",href:group&&`/groups/${group.id}/cycle`},
    {label:"Meetings Held",value:metrics.meetings_held,helperText:"Closed meetings",icon:"meetings",href:group&&`/groups/${group.id}/meetings`},
    {label:"Active Borrowers",value:metrics.active_borrowers,helperText:"Loans not yet settled",icon:"borrowers",href:group&&`/groups/${group.id}/loans`},
  ]:facilitator?[
    {label:"Groups Facilitated",value:metrics.total_groups,helperText:"Only your assigned portfolio",icon:"groups",href:"/groups"},
    {label:"Active Members",value:metrics.total_members,helperText:`Across ${metrics.total_groups} assigned ${metrics.total_groups===1?"group":"groups"}`,icon:"members"},
    {label:"Active Cycles",value:metrics.active_cycles,helperText:"Across assigned groups",icon:"cycle"},
    {label:"Meetings Held",value:metrics.meetings_held,helperText:"Closed meetings in portfolio",icon:"meetings"},
  ]:[
    {label:"Total Groups",value:metrics.total_groups,helperText:"Non-archived groups in scope",icon:"groups",href:"/groups"},
    {label:"Active Groups",value:metrics.active_groups,helperText:"Currently operating",icon:"cycle",href:"/groups?status=ACTIVE"},
    {label:"Active Members",value:metrics.total_members,helperText:`Across ${metrics.active_groups} active ${metrics.active_groups===1?"group":"groups"}`,icon:"members"},
    {label:"Assigned Agents",value:metrics.total_facilitators,helperText:`Supporting ${metrics.total_groups} ${metrics.total_groups===1?"group":"groups"}`,icon:"agents",href:"/facilitators"},
  ];

  return <div className="dashboard-view"><DashboardPageHeader {...header}/><DashboardSection eyebrow={chairperson?"Group overview":facilitator?"Assigned portfolio":"Program overview"} title={chairperson?"At a glance":facilitator?"Portfolio at a glance":"Program at a glance"}><StatGrid items={primary}/></DashboardSection><DashboardSection eyebrow="Financial overview" title="Lifetime Contributions and Current Balances" description="Historical member contributions are shown separately from activity and balances in currently active cycles."><FinancialMetrics metrics={metrics}/></DashboardSection>{chairperson&&groups.length===1?<DashboardSection eyebrow="Cycle details" title={group.cycle_number?`Cycle ${group.cycle_number}`:"No active cycle"} description={group.cycle_number?"Important dates and rules for the current operating cycle.":"Activate a cycle to view current-cycle financial activity."}><section className="panel group-cycle-summary"><dl><div><dt>Group status</dt><dd>{group.status.replaceAll("_"," ").toLowerCase()}</dd></div><div><dt>Share value</dt><dd>{group.share_value?formatCurrency(group.share_value):"Not available"}</dd></div><div><dt>Cycle start</dt><dd>{formatDate(group.start_date)}</dd></div><div><dt>Expected end</dt><dd>{formatDate(group.expected_end_date)}</dd></div></dl></section></DashboardSection>:<DashboardSection eyebrow={chairperson?"My groups":facilitator?"My groups":"Authorized scope"} title={chairperson?"Groups linked to your officer assignments":facilitator?"Groups you facilitate":"Groups in this overview"} description={chairperson?"Only groups where you are a current digitally linked officer appear here.":facilitator?"Open a group to review members, meetings and current-cycle activity.":"A concise view of the groups contributing to these totals."}><GroupsGrid groups={groups} showAgent={!facilitator}/></DashboardSection>}</div>;
}
