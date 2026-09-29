import { AppError } from "@/lib/errors";

export function assertPasswordChangeComplete(user) {
  if (user.must_change_password) {
    throw new AppError("Create a new password before continuing.", "PASSWORD_CHANGE_REQUIRED", 403);
  }
  return user;
}
