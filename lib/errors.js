/**
 * Typed HTTP application error classes so server.js never exposes internal hints.
 */

export class AppError extends Error {
  constructor(status, message, { code = "APP_ERROR", details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message, opts = {}) {
    super(400, message, { code: "BAD_REQUEST", ...opts });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Request payload exceeds the 5 MB limit.", opts = {}) {
    super(413, message, { code: "PAYLOAD_TOO_LARGE", ...opts });
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please wait a minute and try again.", opts = {}) {
    super(429, message, { code: "RATE_LIMITED", ...opts });
  }
}

export class UpstreamError extends AppError {
  constructor(message = "Live search service is temporarily unavailable.", opts = {}) {
    super(502, message, { code: "UPSTREAM_ERROR", ...opts });
  }
}
