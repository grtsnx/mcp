import { z } from 'zod';

export const pingInputSchema = z.object({}).strict();

export const pingOutputSchema = z.object({ ok: z.literal(true) }).strict();
