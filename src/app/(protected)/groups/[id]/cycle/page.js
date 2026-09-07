import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, getGroupCapabilities, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getConstitutions, getCycles } from "@/modules/onboarding/onboarding.service";
import GroupNav from "@/components/group-nav";
import NextCyclePanel from "@/components/next-cycle-panel";
import ActivateCycleButton from "@/components/activate-cycle-button";
import { formatDate, formatDateTime } from "@/lib/utils/date";
const days = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export default async function Cycle({ params, searchParams }) {
  const { id } = await params,
    u = await requireAuth();
  await requireGroupRouteAction(u, id, "cycle.view", GROUP_ACTION.CYCLE_VIEW);
  const [rows, constitutions, access, query] = await Promise.all([getCycles(id), getConstitutions(id), getGroupCapabilities(u, id), searchParams]);
  const latest = rows[0];
  const mayCreateNext = access.capabilities.CYCLE_MANAGE && latest?.status === "CLOSING";
  return (
    <>
      <h1>Cycles</h1>
      <GroupNav id={id} />
      {mayCreateNext && <NextCyclePanel groupId={id} previousCycle={latest} constitutions={constitutions} initiallyOpen={query?.createNext === "1"} />}
      {rows.map((c) => (
        <article className="panel" style={{ padding: 24 }} key={c.id}>
          <h2>
            Cycle {c.cycle_number} <span className="badge">{c.status}</span>
          </h2>
          <p>
            {formatDate(c.start_date)} – {formatDate(c.expected_end_date)}
          </p>
          <p>Expected share-out: {formatDate(c.expected_shareout_date)}</p>
          <p>
            {c.meeting_frequency} ·{" "}
            {days[c.meeting_day_of_week] || "Meeting day not selected"}
          </p>
          <p>Constitution version {c.version_number}</p>
          {c.activated_at && <p>Activated: {formatDateTime(c.activated_at)}</p>}
          {c.status === "READY" && rows.find((item) => Number(item.cycle_number) === Number(c.cycle_number) - 1)?.status !== "CLOSED" && <p className="muted">The previous cycle must be closed before this cycle can be activated.</p>}
          {c.status === "READY" && rows.find((item) => Number(item.cycle_number) === Number(c.cycle_number) - 1)?.status === "CLOSED" && access.capabilities.CYCLE_MANAGE && <ActivateCycleButton groupId={id} cycleId={c.id} cycleNumber={c.cycle_number} />}
          <Link href={`/groups/${id}/cycles/${c.id}/shareout`}>
            Share-out and cycle closure
          </Link>
          {!["DRAFT", "READY", "CANCELLED"].includes(c.status) && <p><Link className="button" href={`/groups/${id}/cycles/${c.id}/closeout`}>Continue Cycle Close-out</Link></p>}
        </article>
      ))}
    </>
  );
}
