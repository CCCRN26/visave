export class AppError extends Error { constructor(message, code="INTERNAL_ERROR", statusCode=500, details) { super(message); this.name=this.constructor.name; this.code=code; this.statusCode=statusCode; this.details=details; } }
export class ValidationError extends AppError { constructor(message="Invalid request", details) { super(message,"VALIDATION_ERROR",400,details); } }
export class AuthenticationError extends AppError { constructor(message="Authentication required") { super(message,"AUTHENTICATION_REQUIRED",401); } }
export class AuthorizationError extends AppError { constructor(message="You do not have permission to perform this action") { super(message,"FORBIDDEN",403); } }
export class NotFoundError extends AppError { constructor(message="Resource not found") { super(message,"NOT_FOUND",404); } }
export class ConflictError extends AppError { constructor(message="Resource already exists") { super(message,"CONFLICT",409); } }
