import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { query } from "@/lib/db/query";
import { getFacilitator } from "@/modules/facilitators/facilitator.service";
import FacilitatorForm from "@/components/facilitator-form";

export default async function EditFacilitator({ params }) {
  const { id } = await params, user = await requireAuth();
  requirePermission(user, "facilitator.update");
  const [{ facilitator, groups }, projects, states] = await Promise.all([
    getFacilitator(id, user),
    query("SELECT id,name FROM projects WHERE organization_id=$1 AND status='ACTIVE' ORDER BY name", [user.organization_id]),
    query("SELECT id,name FROM states ORDER BY name"),
  ]);
  const initial = { firstName: facilitator.first_name, lastName: facilitator.last_name, email: facilitator.email, phone: facilitator.phone || "", staffCode: facilitator.staff_code, projectId: facilitator.project_id, stateId: facilitator.state_id, lgaId: facilitator.lga_id || "", groupIds: groups.map((group) => group.id), reassignmentReason: "" };
  return <><h1>Edit Agent</h1><FacilitatorForm projects={projects} states={states} initial={initial} facilitatorId={id}/></>;
}
