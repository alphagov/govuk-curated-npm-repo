/**
 * Custom error types for Verdaccio storage plugin
 */

export class VerdaccioError extends Error {
  public status: number;
  public statusCode: number;
  public code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.statusCode = status;
    this.code = code ?? "";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends VerdaccioError {
  constructor(message: string) {
    super(message, 404, "ENOENT");
  }
}

export class ForbiddenError extends VerdaccioError {
  constructor(message: string) {
    super(message, 403);
  }
}

export class InternalError extends VerdaccioError {
  constructor(message: string) {
    super(message, 500);
  }
}
