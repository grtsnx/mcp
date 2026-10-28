import { z } from 'zod';
import { twoStepRefinement } from '../define-tool.js';

const PROPOSE_FIELDS = ['lessonId', 'reason'];

// MCP needs one plain object at the root, so both steps share this object and a refinement
// decides which fields each step needs.
export const sessionCancelInputSchema = z
  .object({
    step: z.enum(['propose', 'confirm']),
    sessionId: z.string().min(1).max(256),
    lessonId: z.uuid().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    confirmationToken: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine(twoStepRefinement(PROPOSE_FIELDS));

// One flat object for all three outcomes; `status` says which fields are present.
export const sessionCancelOutputSchema = z
  .object({
    status: z.enum(['proposed', 'cancelled', 'unconfirmed']),
    lessonId: z.string(),
    confirmationToken: z.string().optional(),
    timezone: z.string().optional(),
    scheduledStart: z.string().optional(),
    scheduledEnd: z.string().optional(),
    whenLocal: z.string().optional(),
    durationMinutes: z.number().int().optional(),
    reason: z.string().optional(),
    expiresInSeconds: z.number().int().optional(),
    lateCancellationNotice: z.string().optional(),
    message: z.string().optional(),
  })
  .strict();
