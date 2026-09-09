export class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   * @param {{ code?: string, details?: unknown }} [opts]
   */
  constructor(statusCode, message, opts = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = opts.code || 'APP_ERROR';
    this.details = opts.details;
  }
}

export const badRequest = (msg, details) =>
  new AppError(400, msg, { code: 'BAD_REQUEST', details });
export const unauthorized = (msg = 'Unauthorized') =>
  new AppError(401, msg, { code: 'UNAUTHORIZED' });
export const forbidden = (msg = 'Forbidden') => new AppError(403, msg, { code: 'FORBIDDEN' });
export const ipAccessDenied = (currentIp) =>
  new AppError(
    403,
    'Access denied. Your current IP address is not authorized to access Achakan.',
    {
      code: 'IP_ACCESS_DENIED',
      details: { current_ip: currentIp || null },
    }
  );
export const notFound = (msg = 'Not Found') => new AppError(404, msg, { code: 'NOT_FOUND' });
export const conflict = (msg = 'Conflict') => new AppError(409, msg, { code: 'CONFLICT' });
