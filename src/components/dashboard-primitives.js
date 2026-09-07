import Link from "next/link";

const iconPaths={
  groups:<><circle cx="8" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M2.5 20c0-4 2.2-6.5 5.5-6.5s5.5 2.5 5.5 6.5M14 15c3.8 0 6.5 1.7 6.5 5"/></>,
  members:<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-5 3.2-8 8-8s8 3 8 8"/></>,
  agents:<><circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-4.7 2.8-7.5 7-7.5s7 2.8 7 7.5M18 4v5M15.5 6.5h5"/></>,
  cycle:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8.5A7 7 0 0 1 18.5 7M17.9 15.5A7 7 0 0 1 5.5 17"/></>,
  meetings:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M14 14h2M8 17h3"/></>,
  savings:<><path d="M3 7h16a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2z"/><path d="M3 7l13-4v4M16 12h5v4h-5a2 2 0 0 1 0-4z"/></>,
  loans:<><path d="M4 7h16v13H4zM2 7l10-4 10 4M8 11v5M12 11v5M16 11v5M2 20h20"/></>,
  social:<><path d="M12 21S4 16.5 4 10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11z"/></>,
  borrowers:<><circle cx="8" cy="8" r="3"/><path d="M2.5 20c0-4 2.2-6.5 5.5-6.5 2 0 3.6.9 4.6 2.4M15 12h7M18.5 8.5v7"/></>,
};

export function DashboardIcon({name}){return <svg className="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true">{iconPaths[name]||iconPaths.groups}</svg>}

export function DashboardScopeBadge({children}){return <span className="dashboard-scope-badge"><span aria-hidden="true"/>{children}</span>}

export function DashboardPageHeader({eyebrow,title,description,scope,meta}){return <header className="dashboard-page-header"><div><p className="dashboard-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p>{meta&&<small>{meta}</small>}</div>{scope&&<DashboardScopeBadge>{scope}</DashboardScopeBadge>}</header>}

export function DashboardSection({eyebrow,title,description,children,className=""}){return <section className={`dashboard-section ${className}`}><header><p className="dashboard-eyebrow">{eyebrow}</p><h2>{title}</h2>{description&&<p>{description}</p>}</header>{children}</section>}

export function DashboardStatCard({label,value,helperText,icon="groups",href,tone="neutral"}){
  const content=<div className="dashboard-stat-content"><div className={`dashboard-stat-icon tone-${tone}`}><DashboardIcon name={icon}/></div><div className="dashboard-stat-copy"><span>{label}</span><strong title={String(value)}>{value}</strong>{helperText&&<small>{helperText}</small>}</div>{href&&<span className="dashboard-stat-arrow" aria-hidden="true">→</span>}</div>;
  return <article className={`dashboard-stat-card panel tone-${tone}`}>{href?<Link href={href} aria-label={`${label}: ${value}`}>{content}</Link>:content}</article>;
}

export function DashboardEmptyState({title,description}){return <section className="panel dashboard-empty"><span aria-hidden="true"><DashboardIcon name="groups"/></span><h2>{title}</h2><p>{description}</p></section>}

export function DashboardGroupCard({group,showAgent=false}){return <Link className="panel dashboard-group-card" href={`/groups/${group.id}`}><div><span className="badge">{group.status.toLowerCase()}</span><small>{group.group_code}</small></div><h3>{group.name}</h3><p>{group.community||"Location not provided"}</p><dl><div><dt>Members</dt><dd>{group.members}</dd></div><div><dt>Current cycle</dt><dd>{group.cycle_number?`Cycle ${group.cycle_number}`:"No active cycle"}</dd></div>{showAgent&&<div><dt>Agent</dt><dd>{group.facilitator_name||"Not assigned"}</dd></div>}<div><dt>Meetings held</dt><dd>{group.meetings_held}</dd></div></dl><span className="dashboard-card-link">Open group <b aria-hidden="true">→</b></span></Link>}

export function DashboardSkeleton(){return <div className="dashboard-skeleton" aria-label="Loading dashboard"><div className="skeleton-line skeleton-eyebrow"/><div className="skeleton-line skeleton-title"/><div className="skeleton-line skeleton-subtitle"/><div className="dashboard-kpis">{Array.from({length:4},(_,index)=><div className="panel skeleton-card" key={index}><span/><i/><b/></div>)}</div><div className="skeleton-line skeleton-section-title"/><div className="dashboard-kpis">{Array.from({length:3},(_,index)=><div className="panel skeleton-card" key={index}><span/><i/><b/></div>)}</div></div>}
