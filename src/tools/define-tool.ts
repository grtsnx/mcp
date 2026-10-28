import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BackendApi } from '@/external/mssuize/backend-client.js';
import {
  BackendError,
  type BackendErrorKind,
} from '@/external/mssuize/backend-error.js';
import { SessionError } from '@/session/session-error.js';
import type { SessionService } from '@/session/session.service.js';

export interface ToolContext {
  backend: BackendApi;
  sessions: SessionService;
  /** The signed-in person's session for this request, from their bearer token. */
  callerSessionId?: string;
}

// Shown when a tool that acts for a person is called without one signed in.
export const SIGN_IN_FIRST = 'Sign in to MsSuzie first, then try again.';

export interface ToolHints {
  readOnly: boolean;
  destructive: boolean;
  /** Defaults to `readOnly`. */
  idempotent?: boolean;
  /** True when the tool reaches outside this service. Defaults to true. */
  openWorld?: boolean;
}

export interface ToolDefinition<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  hints: ToolHints;
  handler: (input: z.output<I>, context: ToolContext) => Promise<z.input<O>>;
  /** Text shown next to the structured result. Defaults to the result as JSON. */
  summarise?: (output: z.input<O>) => string;
  /** Tool-specific wording for backend failures; the rest use the defaults. */
  errorMessages?: Partial<Record<BackendErrorKind, string>>;
}

// The rule for a write tool's single input object (MCP needs a plain object at the root, so both
// steps share it): `propose` needs every proposeField and no token, `confirm` needs only the token.
export function twoStepRefinement(proposeFields: readonly string[]) {
  return (
    input: { step: string; confirmationToken?: unknown } & Record<
      string,
      unknown
    >,
    context: z.core.$RefinementCtx,
  ): void => {
    const complain = (field: string, message: string) =>
      context.addIssue({ code: 'custom', path: [field], message });

    if (input.step === 'propose') {
      for (const field of proposeFields) {
        if (input[field] === undefined) {
          complain(field, `${field} is required when step is propose`);
        }
      }
      if (input.confirmationToken !== undefined) {
        complain(
          'confirmationToken',
          'confirmationToken is only for step confirm',
        );
      }
      return;
    }
    if (input.confirmationToken === undefined) {
      complain(
        'confirmationToken',
        'confirmationToken is required when step is confirm',
      );
    }
    for (const field of proposeFields) {
      if (input[field] !== undefined) {
        complain(field, `${field} is only for step propose`);
      }
    }
  };
}

export interface Tool {
  readonly name: string;
  register(server: McpServer, context: ToolContext): void;
}

const defaultErrorMessages: Record<BackendErrorKind, string> = {
  invalid_request: 'The backend rejected the request as invalid.',
  cannot_reschedule: 'The backend would not allow that change.',
  slot_unavailable: 'That time is not available.',
  outside_availability: "That time is outside the learner's availability.",
  already_pending: 'A request for this tutor is already pending.',
  household_not_found: 'No household could be found for this account.',
  unauthorized: 'The backend did not accept the credentials for this request.',
  forbidden: 'The backend did not allow this request.',
  not_found: 'The backend could not find what was asked for.',
  rate_limited: 'Too many requests. Try again later.',
  rejected: 'The backend rejected the request.',
  unavailable: 'The backend is unavailable. Try again later.',
  timeout: 'The backend did not respond in time. Try again later.',
  unreachable: 'The backend could not be reached. Try again later.',
  unexpected_response: 'The backend returned an unexpected response.',
};

// A fixed message written in code, for a refusal a handler decides itself. It must never carry
// backend text, a token or a person's data.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const UNEXPECTED_FAILURE = 'The tool failed unexpectedly.';

function messageFor(
  error: unknown,
  overrides: Partial<Record<BackendErrorKind, string>> | undefined,
): string {
  if (error instanceof SessionError || error instanceof ToolError) {
    return error.message;
  }
  if (!(error instanceof BackendError)) return UNEXPECTED_FAILURE;
  return overrides?.[error.kind] ?? defaultErrorMessages[error.kind];
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  definition: ToolDefinition<I, O>,
): Tool {
  const { hints } = definition;
  // Unknown input fields are always rejected, whatever the tool author wrote.
  // Typed as plain ZodObject: the SDK cannot resolve its callback types through a generic.
  const input: z.ZodObject = definition.input.strict();
  const output: z.ZodObject = definition.output.strict();
  //1. A tool that acts for a person takes its sessionId from the request's sign-in, never from
  //   the caller. Its published input leaves sessionId out, so no model can choose one.
  //2. The full input, refinements included, is then checked here with the session filled in.
  const forPerson = 'sessionId' in input.shape;
  const published: z.ZodObject = forPerson
    ? z.object(withoutSessionId(input.shape)).strict()
    : input;

  return {
    name: definition.name,
    register(server, context) {
      server.registerTool(
        definition.name,
        {
          title: definition.title,
          description: definition.description,
          inputSchema: published,
          outputSchema: output,
          annotations: {
            readOnlyHint: hints.readOnly,
            destructiveHint: hints.destructive,
            idempotentHint: hints.idempotent ?? hints.readOnly,
            openWorldHint: hints.openWorld ?? true,
          },
        },
        async (args): Promise<CallToolResult> => {
          try {
            let parsed = args as z.output<I>;
            if (forPerson) {
              if (!context.callerSessionId) return failure(SIGN_IN_FIRST);
              const checked = input.safeParse({
                ...args,
                sessionId: context.callerSessionId,
              });
              if (!checked.success)
                return failure(
                  checked.error.issues.map((issue) => issue.message).join(' '),
                );
              parsed = checked.data as z.output<I>;
            }
            const result = await definition.handler(parsed, context);
            const text =
              definition.summarise?.(result) ?? JSON.stringify(result);
            return {
              content: [{ type: 'text', text }],
              structuredContent: result as Record<string, unknown>,
            };
          } catch (error) {
            return failure(messageFor(error, definition.errorMessages));
          }
        },
      );
    },
  };
}

function failure(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

function withoutSessionId(shape: z.ZodRawShape): z.ZodRawShape {
  const { sessionId: _session, ...rest } = shape;
  return rest;
}
