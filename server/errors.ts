export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResponse(): ApiErrorResponse {
    const error: ApiErrorResponse["error"] = {
      code: this.code,
      message: this.message,
    };
    if (this.details) {
      error.details = this.details;
    }
    return { error };
  }
}

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  BAD_REQUEST: "BAD_REQUEST",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export const ErrorMessages = {
  [ErrorCodes.VALIDATION_ERROR]: "Error de validación",
  [ErrorCodes.UNAUTHORIZED]: "No autorizado",
  [ErrorCodes.FORBIDDEN]: "Acceso denegado",
  [ErrorCodes.NOT_FOUND]: "Recurso no encontrado",
  [ErrorCodes.CONFLICT]: "Conflicto con el estado actual",
  [ErrorCodes.INTERNAL_ERROR]: "Error interno del servidor",
  [ErrorCodes.BAD_REQUEST]: "Solicitud inválida",
  [ErrorCodes.RATE_LIMITED]: "Demasiadas solicitudes",
} as const;

export function createValidationError(details: unknown): ApiError {
  return new ApiError(
    ErrorCodes.VALIDATION_ERROR,
    ErrorMessages[ErrorCodes.VALIDATION_ERROR],
    400,
    details
  );
}

export function createUnauthorizedError(message?: string): ApiError {
  return new ApiError(
    ErrorCodes.UNAUTHORIZED,
    message || ErrorMessages[ErrorCodes.UNAUTHORIZED],
    401
  );
}

export function createForbiddenError(message?: string): ApiError {
  return new ApiError(
    ErrorCodes.FORBIDDEN,
    message || ErrorMessages[ErrorCodes.FORBIDDEN],
    403
  );
}

export function createNotFoundError(resource?: string): ApiError {
  const message = resource
    ? `${resource} no encontrado`
    : ErrorMessages[ErrorCodes.NOT_FOUND];
  return new ApiError(ErrorCodes.NOT_FOUND, message, 404);
}

export function createConflictError(message?: string): ApiError {
  return new ApiError(
    ErrorCodes.CONFLICT,
    message || ErrorMessages[ErrorCodes.CONFLICT],
    409
  );
}

export function createInternalError(details?: unknown): ApiError {
  return new ApiError(
    ErrorCodes.INTERNAL_ERROR,
    ErrorMessages[ErrorCodes.INTERNAL_ERROR],
    500,
    details
  );
}
