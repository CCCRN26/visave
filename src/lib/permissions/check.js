import { AuthorizationError } from "../errors/index.js";
export function requirePermission(user,permission){if(!user.permissions?.includes(permission))throw new AuthorizationError();}
