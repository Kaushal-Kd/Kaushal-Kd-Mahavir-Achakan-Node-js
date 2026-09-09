import { ZodError } from 'zod';

import { badRequest } from './errors.js';

/**
 * Validate data against a Zod schema, throwing an AppError(400) on failure.
 * @template T
 * @param {import('zod').ZodSchema<T>} schema
 * @param {unknown} data
 * @returns {T}
 */
export function validate(schema, data) {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      }));
      throw badRequest('Validation failed', details);
    }
    throw err;
  }
}
