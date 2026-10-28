import { z } from 'zod';
import { twoStepRefinement } from '../define-tool.js';

const PROPOSE_FIELDS = ['learnerId', 'lessonId', 'reason'];

// There is no tutor id here on purpose: the model never supplies one. The tutor is taken from the
// lesson, so a request can only name the tutor of a lesson that belongs to the learner.
export const tutorChangeRequestCreateInputSchema = z
  .object({
    step: z.enum(['propose', 'confirm']),
    sessionId: z.string().min(1).max(256),
    learnerId: z.uuid().optional(),
    lessonId: z.uuid().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    confirmationToken: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine(twoStepRefinement(PROPOSE_FIELDS));

// One flat object for both outcomes; `status` says which fields are present. The first names are
// there so the parent can check who the request is about; no ids of the tutor are returned.
export const tutorChangeRequestCreateOutputSchema = z
  .object({
    status: z.enum(['proposed', 'filed']),
    confirmationToken: z.string().optional(),
    learnerFirstName: z.string().nullable().optional(),
    tutorFirstName: z.string().nullable().optional(),
    tutorLastName: z.string().nullable().optional(),
    reason: z.string().optional(),
    alreadyPending: z.boolean().optional(),
    expiresInSeconds: z.number().int().optional(),
    requestStatus: z.literal('pending').optional(),
    note: z.string().optional(),
  })
  .strict();
