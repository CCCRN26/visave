"use client";
export default function DashboardError({reset}){return <section className="panel dashboard-error" role="alert"><span aria-hidden="true">!</span><h1>Unable to load dashboard information</h1><p>Please try again. If the problem continues, contact your programme administrator.</p><button type="button" onClick={()=>reset()}>Try again</button></section>}
