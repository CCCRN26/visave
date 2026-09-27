import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { query } from "@/lib/db/query";
import { notFound } from "next/navigation";
import OnboardingWizard from "@/components/onboarding-wizard";

export default async function Onboarding({ params }) {
  const { id } = await params;
  const user = await requireAuth();
  const actor = await requireGroupRouteAction(user, id, "group.update", GROUP_ACTION.MEMBER_MANAGE);
  const [group] = await query(`SELECT g.*,p.name project_name,s.name state_name,l.name lga_name,concat(u.first_name,' ',u.last_name) facilitator_name FROM vsla_groups g JOIN projects p ON p.id=g.project_id LEFT JOIN states s ON s.id=g.state_id LEFT JOIN lgas l ON l.id=g.lga_id LEFT JOIN users u ON u.id=g.facilitator_user_id WHERE g.id=$1 AND g.organization_id=$2`, [id, user.organization_id]);
  if (!group) notFound();
  const canManageOfficers = canGroupAction(user, actor, GROUP_ACTION.CYCLE_PARTICIPATION_MANAGE);
  return <><h1>Onboard {group.name}</h1><p className="muted">Progress is calculated from persisted group data. Save and return at any time.</p><OnboardingWizard group={group} canManageOfficers={canManageOfficers}/></>;
}
