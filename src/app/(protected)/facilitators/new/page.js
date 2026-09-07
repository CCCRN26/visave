import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { query } from "@/lib/db/query";
import FacilitatorForm from "@/components/facilitator-form";
export default async function NewFacilitator() { const user = await requireAuth(); requirePermission(user, "facilitator.create"); const [projects, states] = await Promise.all([query("SELECT id,name FROM projects WHERE organization_id=$1 AND status='ACTIVE' ORDER BY name", [user.organization_id]), query("SELECT id,name FROM states ORDER BY name")]); return <><h1>Add Facilitator</h1><p className="muted">Create the login, facilitator profile, scope, role and initial assignments in one transaction.</p><FacilitatorForm projects={projects} states={states}/></>; }
