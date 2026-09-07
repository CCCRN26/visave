import { pool } from "@/lib/db/pool";
import { resolveDashboardScope } from "./dashboard-scope.js";
import { dashboardGroups, dashboardMetrics } from "./dashboard.repository.js";

export async function getDashboard(user, client = pool) {
  const scope = await resolveDashboardScope(user, client);
  if (scope.scopeType === "NO_ACTIVE_GROUP") return { scope, metrics: null, groups: [] };
  const [metrics, groups] = await Promise.all([
    dashboardMetrics(client, user, scope),
    dashboardGroups(client, user, scope),
  ]);
  return { scope, metrics, groups };
}

