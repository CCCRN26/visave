import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import {
  isLoanSameActorSodExempt,
  isLoanSelfRequester,
} from "@/modules/group-access/group-access.service";

const separationViolation = (message) =>
  new AppError(
    message,
    "LOAN_SEPARATION_OF_DUTIES_VIOLATION",
    403,
  );

export function resolveLoanRequestMemberId(user, actor, suppliedMemberId) {
  if (isLoanSelfRequester(user, actor)) {
    if (suppliedMemberId && suppliedMemberId !== actor.linked_member_id) {
      throw new AuthorizationError(
        "A member can only request a loan for their own linked membership",
      );
    }
    return actor.linked_member_id;
  }
  if (!suppliedMemberId) {
    throw new ValidationError("Select an eligible borrower");
  }
  return suppliedMemberId;
}

export function assertLoanDecisionSeparation(user, actor, requestedBy) {
  if (!isLoanSameActorSodExempt(user, actor) && requestedBy === user.id) {
    throw separationViolation(
      "The request recorder cannot approve or reject this request",
    );
  }
}

export function assertLoanDisbursementSeparation(user, actor, decidedBy) {
  if (!isLoanSameActorSodExempt(user, actor) && decidedBy === user.id) {
    throw separationViolation(
      "The loan approver cannot record its disbursement",
    );
  }
}

export function assertSelfRequesterOwnsRequest(user, actor, request) {
  if (
    isLoanSelfRequester(user, actor) &&
    (request.requested_by !== user.id ||
      request.member_id !== actor.linked_member_id)
  ) {
    throw new AuthorizationError(
      "A member can only manage their own loan request",
    );
  }
}
