import { z } from 'zod';

/** Legacy clients may deactivate, but permanent removal requires explicit intent. */
export const catalogDeleteSchema = z.object({
  mode: z.enum(['deactivate', 'permanent']).default('deactivate'),
});
