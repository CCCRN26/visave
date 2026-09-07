import { requireAuth } from "@/lib/auth/session";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import DashboardView from "@/components/dashboard-view";

export default async function Dashboard() {
  const user = await requireAuth();
  const data = await getDashboard(user);
  return <DashboardView data={data}/>;
}
