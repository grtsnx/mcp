import type { z } from 'zod';
import type { pingOutputSchema } from './schemas.js';

export async function pingHandler(): Promise<z.input<typeof pingOutputSchema>> {
  return { ok: true };
}
