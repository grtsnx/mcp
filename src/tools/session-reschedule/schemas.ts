import { z } from 'zod';
import { twoStepRefinement } from '../define-tool.js';

const dateTimeWithOffset = z.iso.datetime({ offset: true });

const PROPOSE_FIELDS = ['lessonId', 'newStart', 'newEnd', 'reason'];

// MCP needs one plain object at the root, not a union, so both steps share this object and a
// refinement decides which fields each step needs. There is no `force` field: the backend ignores
// it for guardians, and an unknown field is rejected.
export const sessionRescheduleInputSchema = z
  .object({
    step: z.enum(['propose', 'confirm']),
    sessionId: z.string().min(1).max(256),
    lessonId: z.uuid().optional(),
    newStart: dateTimeWithOffset.optional(),
    newEnd: dateTimeWithOffset.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    confirmationToken: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine(twoStepRefinement(PROPOSE_FIELDS));

// One flat object for all three outcomes; `status` says which fields are present.
export const sessionRescheduleOutputSchema = z
  .object({
    status: z.enum(['proposed', 'rescheduled', 'unconfirmed']),
    lessonId: z.string(),
    confirmationToken: z.string().optional(),
    // Which child and subject, so the parent can see whose lesson is moving.
    learnerName: z.string().optional(),
    subjects: z.array(z.string()).optional(),
    timezone: z.string().optional(),
    currentStart: z.string().optional(),
    currentEnd: z.string().optional(),
    currentWhenLocal: z.string().optional(),
    newStart: z.string().optional(),
    newEnd: z.string().optional(),
    newWhenLocal: z.string().optional(),
    durationMinutes: z.number().int().optional(),
    reason: z.string().optional(),
    expiresInSeconds: z.number().int().optional(),
    message: z.string().optional(),
  })
  .strict();
