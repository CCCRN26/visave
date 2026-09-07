import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
const target = new URL(process.env.DATABASE_URL);
console.log(`Dashboard scope acceptance database: ${target.pathname.slice(1)}`);
console.log("Mode: READ ONLY (no fixtures or writes)");

const [{ pool }, { resolveDashboardScope }, repo] = await Promise.all([
  import("../src/lib/db/pool.js"),
  import("../src/modules/dashboard/dashboard-scope.js"),
  import("../src/modules/dashboard/dashboard.repository.js"),
]);

async function usersFor(role) {
  return (await pool.query(
    `SELECT u.id,u.organization_id,u.first_name,u.last_name,
       ARRAY_AGG(DISTINCT r.code) roles
     FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     WHERE u.status='ACTIVE' AND EXISTS(
       SELECT 1 FROM user_roles x JOIN roles xr ON xr.id=x.role_id WHERE x.user_id=u.id AND xr.code=$1
     ) GROUP BY u.id ORDER BY u.id`,
    [role],
  )).rows;
}

async function inspect(user, label) {
  const scope=await resolveDashboardScope(user,pool);
  if(scope.scopeType==="NO_ACTIVE_GROUP")return {label,scope:scope.scopeType,result:"SAFE_EMPTY"};
  const [metrics,groups]=await Promise.all([repo.dashboardMetrics(pool,user,scope),repo.dashboardGroups(pool,user,scope)]);
  if(metrics.total_groups!==groups.length)throw new Error(`${label}: aggregate/group-row scope mismatch`);
  if(scope.scopeType==="FACILITATOR"&&groups.some(group=>group.facilitator_user_id!==user.id))throw new Error(`${label}: foreign facilitated group leaked into dashboard`);
  if(scope.scopeType==="GROUP"&&(groups.length!==1||groups[0].id!==scope.groupId))throw new Error(`${label}: foreign group leaked into Chairperson dashboard`);
  return {label,scope:scope.scopeType,groups:metrics.total_groups,members:metrics.total_members,groupRows:groups.length,result:"PASS"};
}

try {
  const [admins,facilitators,members]=await Promise.all([usersFor("SUPER_ADMIN"),usersFor("FACILITATOR"),usersFor("VSLA_MEMBER")]);
  const results=[];
  if(admins[0])results.push(await inspect(admins[0],"Admin"));
  for(const [index,user] of facilitators.slice(0,2).entries())results.push(await inspect(user,`Facilitator ${index+1}`));
  const chairUsers=[];
  for(const user of members){const scope=await resolveDashboardScope(user,pool);if(scope.scopeType==="GROUP")chairUsers.push(user);if(chairUsers.length===1)break}
  if(chairUsers[0])results.push(await inspect(chairUsers[0],"Chairperson"));
  else results.push({label:"Chairperson",result:"NOT_AVAILABLE_IN_CURRENT_DATA"});
  for(const result of results)console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
