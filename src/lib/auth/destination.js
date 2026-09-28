const STAFF_ROLES = ["SUPER_ADMIN", "PROJECT_ADMIN", "STATE_COORDINATOR", "FACILITATOR"];

export function authenticatedHome(user) {
  const roles = user?.roles || [];
  const memberOnly = roles.includes("VSLA_MEMBER") && !roles.some((role) => STAFF_ROLES.includes(role));
  return memberOnly ? "/my-groups" : "/dashboard";
}
