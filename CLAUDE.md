# MCP Agents Instructions

## What this repo is

The MCP server for the MsSuzie agents platform. It is a thin layer between the agents and `ms-backend`:

```text
agents  --(MCP)-->  mcp-agents (this repo)  --(HTTPS, service identity)-->  ms-backend (Go)
```

- Agents only talk to this service. They never call `ms-backend` directly.
- Each MCP tool wraps one `ms-backend` capability (for example "reschedule session") and calls its HTTP API.
- This repo owns no business data and no database. `ms-backend` stays the source of truth and enforces the rules.
- Started from the `grtsnx/nestyagent` boilerplate. The MCP endpoint with `ping`, shared tool pattern and backend request helper exist. The backend service identity flow and `whoami` tool are not built yet.
- Parent authentication must use the trusted agent identity flow described below. Never accept a parent's password through an MCP tool.

## Stack

- NestJS 12, TypeScript 6 (ESM, `.js` import suffixes), Express platform
- Bun 1.3.14 for install, scripts and tests; Node 24+ for the production runtime
- zod for config and tool-input validation; class-validator for HTTP DTOs
- Vitest for tests, oxlint + Prettier for lint and format
- MCP: use the official `@modelcontextprotocol/sdk`. Do not depend on a community NestJS wrapper unless it is actively maintained

## Commands

```bash
cp .env.example .env
bun install --frozen-lockfile
bun run start:dev        # http://localhost:3000, Swagger at /api, Scalar at /docs
bun run format:check && bun run lint && bun run typecheck
bun run test && bun run test:e2e && bun run build
```

All of these must pass before a PR. Tests live under `test/` (`test/unit`, `test/e2e`), never next to the source.

## Layout

- `src/main.ts`, `src/bootstrap/` — app start, Swagger/Scalar
- `src/config/` — zod-validated environment (bad config stops startup) and `bearer.ts`, the bearer-token parsing and comparison used by the MCP guard
- `src/middleware/` — request ID, response envelope, global exception filter
- `src/app/` — health routes (`/v1/health/live`, `/v1/health/ready`)
- `src/mcp/` — the MCP endpoint only: controller, module and `mcp-server.ts` (loops over the tool list, never edited for a new tool)
- `src/middleware/guard/` — the MCP bearer guard (`mcp-auth.guard.ts`) and the stateless request handler (`mcp.handler.ts`)
- `src/tools/` — `define-tool.ts` (the pattern every tool uses), one folder per tool (each with `schemas.ts`, `handler.ts` and `index.ts`), and `index.ts`, the single list of tools
- `src/session/` — in-memory sign-in sessions and all token handling (`SessionService`); it reaches the backend only through `src/external/mssuize/`
- `src/external/mssuize/` — the only code that calls `ms-backend`: a bounded `BackendClient.request()` helper (timeout, JSON, zod response validation, error mapping), an `auth` hook for the future service identity, `auth-api.ts` (refresh, `/auth/me`, logout) and the household, scheduling, weekly-update and tutor-change API modules
- Put new work in feature modules, one folder per responsibility

## Tools

- Add a tool as `src/tools/<tool-name>/` (kebab-case folder, snake_case tool name) plus one line in `src/tools/index.ts`. The step-by-step and a template are in `README.md` ("Adding a new tool"); copy `test/unit/tools/tool.template.spec.ts` for its test.
- Define a tool with `defineTool()`. It makes input and output strict, sets the MCP hints and turns backend failures into short tool errors with no backend detail.
- A tool calls the backend only through `context.backend.request(...)`. Never use `fetch` in a tool.
- **Sign-in is the standard MCP way.** `POST /mcp` takes either `MCP_API_KEY` (a trusted agent, `ping` only) or a person's own ms-backend access token as the bearer token. `McpAuthGuard` checks the token with `SessionService.signIn` (`/auth/me`), and the request's tools act for that person. Never accept a password, and never add a login or logout tool.
- **No tool takes a `sessionId`.** `defineTool` leaves it out of the published input and fills it from the request's sign-in (`ToolContext.callerSessionId`); without a signed-in person a tool answers `SIGN_IN_FIRST`. Handlers still read `input.sessionId`.
- `household_get`, `household_learners` and `household_members` (`src/tools/household-*/`) are read-only (`readOnlyHint: true`). They take no input from the caller (learners an optional `status`, a zod enum) and reach the backend through `SessionService.withHousehold(...)` and `src/external/mssuize/household-api.ts`.
- `learner_sessions_list`, `household_sessions_list`, `session_get`, `session_reschedule_options_day` and `session_reschedule_options_week` (`src/tools/learner-sessions-list/`, `household-sessions-list/`, `session-get/`, `session-reschedule-options-day/`, `session-reschedule-options-week/`) are read-only (`readOnlyHint: true`) and use only the guardian-facing routes, never `/agent/...`. They reach the backend through `SessionService` and `src/external/mssuize/scheduling-api.ts`.
- `session_reschedule` (`src/tools/session-reschedule/`) is the first write tool: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`. See "Write tools" below. Do not add booking, weekly-schedule update, tutor-change or bulk tools without the same rules. Never add a tool that calls the bulk-cancel route.
- `learner_weekly_schedule_get` and `learner_weekly_schedule_preview` (`src/tools/learner-weekly-schedule-get/`, `learner-weekly-schedule-preview/`) are read-only (`readOnlyHint: true`) and use only `GET /learners/{id}/weekly-schedule-v2` and `POST .../weekly-schedule-v2/preview`. See "Weekly schedule rules" below.
- `session_cancel` (`src/tools/session-cancel/`) is the second write tool: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`. It cancels a real lesson and cannot be undone with these tools. It follows "Write tools" below.
- `learner_weekly_schedule_update` (`src/tools/learner-weekly-schedule-update/`) is a write tool: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`. It reuses the preview tool's window schema, `checkWindows`, `loadWeeklyPreview` and `buildWeeklyPreviewRequest`. See "Weekly schedule rules" and "Write tools" below.
- `tutor_change_request_create` (`src/tools/tutor-change-request-create/`) is a write tool (`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`) and `tutor_change_request_list` (`src/tools/tutor-change-request-list/`) is read-only. See "Tutor-change rules" below.
- `session_me` (who is signed in) is not `whoami`: the name `whoami` stays reserved for the agent identity route in build step 3.

## Household data rules

- **The household id comes from the session, never from the model.** No household tool has a `householdId` input, and inputs are strict, so one is rejected. This keeps the agent to its own signed-in person's household. A session with no household id gives a short tool error.
- **Minimise what leaves the service.** Learners are children and members are other people. Return only the fields a tool documents: `household_get` returns id, name, timezone, currentLearnerId, recordingConsent; `household_learners` returns id, firstName, lastName, gradeLevel, actualGradeLevel, status, age; `household_members` returns id, firstName, lastName, role, status, accessScope, learnerIds and never email or phone.
- Backend reply schemas in `household-api.ts` list only the fields the tools return, so everything else is dropped when the reply is parsed. When adding a household tool, list only what it needs.
- Never log household data, and keep it out of error messages. A backend 403 becomes `Not allowed to access this household.`; no backend body appears in any message.
- Restrict free-text filters the backend does not validate: it answers an unknown learner `status` with an empty list, so the tool accepts only `active | paused | archived | unarchived | all`.

## Write tools

`session_reschedule` is the pattern for every write tool. These rules are not optional:

- **Two steps, and the first changes nothing.** One strict object with `step: 'propose' | 'confirm'` (MCP needs a plain object at the root, so a refinement decides which fields each step needs). Propose checks everything and stores a proposal on the sign-in session; it must never call a write route. The description tells the model to show the proposal to the person in plain words and get an explicit yes before confirming, and never to confirm on its own.
- **The confirmation token is single-use, session-bound and short-lived.** It is random (256 bits), expires in 5 minutes, and only the sign-in session that proposed it can use it (`SessionService.createProposal` / `takeProposal`). It is removed before the backend is called, so a repeat can never send a second request. Unknown, used, expired and another session's token all give the same error.
- **Never retry a write.** `ms-backend` has no retry key on the reschedule route, so a repeat could move a lesson twice and notify twice. There is no retry code in the client or a tool. The single exception is a `401` because the access token expired: the backend rejects that before it runs anything, so `SessionService.withAccessToken` refreshes once and sends the request once more. After a timeout, a network error, a 5xx or any other reply, send nothing again.
- **Unknown outcome.** If the write was sent and then timed out, hit a network error, got a 5xx or an unreadable reply, the backend may have saved it first. Return an error that says the result is unknown, that the model must NOT try again, and that it must read the real state (`session_get`) before telling the person anything. A failure before the write was sent (for example refreshing the token) is not unknown: report it normally.
- **Verify after a write.** Read the object back and return the read-back values; if they do not show the change, return `unconfirmed` and point to `session_get`.
- **Send only what is needed.** The reschedule body is exactly `new_start`, `new_end` and `reason`. The backend's `force` field is never sent.
- **Fixed error wording, never the backend text.** The backend's 400 replies are told apart by matching their text (`errorPhrases` in `BackendClient`, the phrase list `rescheduleErrorPhrases` in `scheduling-api.ts`), and only a fixed message is returned. **This relies on matching backend wording, so it is fragile**: if the backend rewords an error, the match falls back to the generic "not accepted" message. Re-check it when `ms-backend`'s reschedule handler changes.
- **Pre-check what the backend turns into a 500.** Several backend rules (same length, in the future, must differ, end after start) return a 500, not a 400, so propose checks them itself (same length, an exactly offered slot, scheduled, `canReschedule`) before anything is sent.
- The move uses the signed-in person's own token, so the backend records that person as the actor, not an agent.
- **The shared pieces, so a new write tool does not copy them.** `twoStepRefinement(proposeFields)` in `define-tool.ts` is the input rule (propose needs every field and no token, confirm needs only the token). A proposal carries an `action` (`'reschedule' | 'cancel'`): `SessionService.createProposal` stores it, and `takeProposal(sessionId, token, action)` refuses a token made for another action exactly like an unknown one and leaves it usable for its own action. `SessionService.sendWrite(sessionId, send)` sends the write once (one refresh and one resend after a 401 only) and returns `{ status: 'done', value }` or `{ status: 'unknown' }` for a timeout, network error, 5xx or unreadable reply; every other failure is thrown. `ToolError` is a fixed message written in code. Do not add a retry anywhere.
- **Proposals carry their own details.** `ProposalDetails` in `session.types.ts` is a union by `action`: `reschedule`, `cancel`, `weekly_update` (the exact request, a snapshot of the current schedule and a preview fingerprint) and `tutor_change` (the learner, the lesson, the tutor id taken from it, and the reason). Add a new action there; `takeProposal` already refuses a token made for another action.
- **`learner_weekly_schedule_update` specifics.** Propose runs the same preview as the preview tool and stores the request, the current schedule and `previewFingerprint`; it always returns `previewIsIncomplete: true` and the fixed warning. Confirm needs `parentAcknowledgesLessonsMayBeChanged: true` (checked in the input schema, so a missing flag does not burn the token), takes the token first, then re-checks before any write: the ownership check, the schedule against the snapshot (`scheduleKey`) and the preview against the fingerprint (`previewFingerprint`); on any difference it sends nothing and says "Things changed since the proposal. Make a new proposal and ask the parent again." Then exactly one `PUT` (`updateWeeklySchedule`, body exactly `{ windows, subjectPreferences }`), then a read-back compared with `savedMatches`. Timeout, network error or 5xx is "unknown, do not retry, call `learner_weekly_schedule_get` first" and nothing is read back on its own. The result text always says the backend adjusts upcoming lessons separately.
- **`session_cancel` specifics.** Propose reads the lesson and needs `status === 'scheduled'` and `canCancel === true`. If the lesson starts in under 24 hours (or has started) it adds the fixed `lateCancellationNotice`, with no amount and no claim that a fee is charged. Confirm marks the token used first, sends one `POST /sessions/{id}/cancel` with exactly `{ reason }`, and reads the lesson back. After a 500, timeout or network error it reads back once: cancelled is reported as cancelled, still scheduled as "did not go through", and a failed read-back as "unknown, do not retry, call `session_get`". The backend answers 403 only for "not allowed" and 500 for every other failure, so a 500 never says whether it happened.

## Scheduling data rules

- **`lessonId` is the tutoring class.** In tool inputs and outputs the backend's session id is always `lessonId`; the signed-in person always comes from the request, never from an input. Every scheduling tool's description says so in one sentence. Every id input is a UUID (`z.uuid()`).
- The household id for the learner's lessons comes from the stored session, never from the model; no scheduling tool has a `householdId` input.
- **Minimise what leaves the service.** Learners are children. Never return signed photo links, the tutor's email or id, actor ids, event payloads, or video and meeting fields; return only the documented fields, and never log or echo any of it. The reply schemas in `scheduling-api.ts` list only those fields, so the rest is dropped at parse time.
- **Compute durations; do not trust `durationMinutes`.** The backend's list reports 0 even for a 60 minute class, so `durationMinutes` comes from `scheduledStart` and `scheduledEnd` (`minutesBetween`).
- **Validate filters before the call.** The backend ignores an unreadable `status`, `startAfter` or `startBefore` instead of rejecting it, so `status` is a zod enum, dates are ISO 8601 with seconds and an offset, `targetDate` is a real calendar date (`z.iso.date()`), and `timezone` is an IANA name. When no `timezone` is given, none is sent.
- **Check the role locally.** `SessionService.assertRole` allows only guardian, delegate and admin before any call, so a tutor gets the same `Not allowed to access this learner or lesson.` message even where the backend leaves a route open (`GET /sessions/{id}`).
- Error wording for the read tools: 403 is `Not allowed to access this learner or lesson.`, 404 is `Lesson not found.` (`Learner not found.` for the list), a 400 from the day preview is `That date is not valid.`. A refresh that fails with a 401 ends the session. No backend body appears in any message.

## Weekly schedule rules

- **Windows are ranges the family offers, not lesson times.** `dayOfWeek` is 0 for Sunday up to 6 for Saturday (Go's `Weekday()`, compared in the window's own timezone); the tools return `dayName` too. The GET returns active windows and preferences only.
- **The backend does not check learner ownership on these routes.** The handlers check the caller is signed in and has a guardian, delegate or admin role, but the services take no user id. So both tools call `assertLearnerInHousehold` (the household learners list, which the backend does enforce) inside `SessionService.withHousehold` before any weekly-schedule route, and refuse with `Not allowed to access this learner.`. Keep that check first.
- **The preview sends the learner's current subject preferences unchanged, and accepts no status, notes, date range or subject field.** `buildWeeklyPreviewRequest` carries a kept window's other settings over (extra range, status, dates as RFC 3339, notes, timezone) and normalises times to `HH:MM:SS`. Duplicate (day, start, end) windows, a duplicate `windowId`, an `endTime` not after the `startTime`, and more than 14 or no windows are refused before any call. An unknown `windowId` is refused before the preview is sent.
- **The preview was read end to end and writes nothing** (handler, service, `buildLearnerWeeklyScheduleV2Payload`, `computeReconcileSeriesAssignment`, `planAvailabilitySession`, the transaction's SELECT helpers, the repository getters and the settings read, plus a scan of every function reachable from it). That is a source read, not a live run, and it does not cover database triggers. The route that saves is the same path without `/preview` and is never called. Re-read the backend if its preview handler changes.
- **What the save (`PUT`) does, as read.** Plan limits are checked on the preferences sent; one transaction saves the schedule (anything left out is marked inactive, not deleted); for a learner's own change, affected future lessons are rescheduled to the nearest mutual free slot or left as they are, and never cancelled (`availabilityForcedCancellationPlan` and `availabilityCancellationFallbackPlan` return nothing for a learner); a reschedule writes history, resets reminders and re-syncs the baseline designation; every guardian of the household and the tutor get a `session.rescheduled` notification (best effort, outside the transaction); the recurring template is then moved or flagged outside the transaction with errors only logged; matching starts only for newly active subjects (none, with unchanged preferences). Removing or reducing a subject preference would delete lessons, and the tools never send one. The full account is in the README. Re-read the backend if its update handler changes.
- **The preview differs from the save.** The learner preview lists only reschedules, its cancel count is hard-coded to 0, it omits lessons it would leave unchanged, and it plans against the learner's own windows while the save uses the forced learner availability setting when on. Never treat an empty preview as proof that nothing will move.
- **The preview is incomplete by design of the backend.** For the learner path it never plans a cancel of its own and leaves out lessons it would leave unchanged, so an empty `entries` list does not prove every lesson fits. The tool's description says so.

## Tutor-change rules

- **The model never supplies a tutor id.** The backend's `POST /tutor-change-requests` checks neither that the person may act for the learner nor that the tutor is the learner's. `tutor_change_request_create` therefore takes `learnerId` and `lessonId`, checks the learner is in the signed-in household (`assertLearnerInHousehold`) and that the lesson's `learnerId` is that learner, and takes the tutor from the lesson (`tutorId` is read by `lessonDetailSchema` and kept in the proposal; no tool returns it). Do not add a tutor id input.
- **Every failure of these routes is a 400 with raw internal text** (it can include database text). Never forward it. `tutor-change-api.ts` compares the text only: `pending request already exists` gives `already_pending`, `could not determine household` gives `household_not_found`, every other 400 stays `invalid_request`. This relies on the backend's wording.
- **The parent list has no paging or filter parameters and sends only id, learner id, tutor name, reason, status and created time** (the admin list, which has paging and more fields, is a different route and is never called). `tutor_change_request_list` filters the reply to the signed-in household's learners, because the backend picks the household from the person's membership.
- **`could not determine household`.** The list handler looks the household up only in `household_members`, but primary guardians are not stored there (the household is on `households.primary_guardian_id`), so it very likely fails for a primary guardian. Handle it as a normal answer with the fixed message; do not work around it by guessing a household.
- A request goes to the school's staff by Slack and email and they decide; the tool description says so and that the tutor does not change by itself. Confirm is never retried (same rules as the other writes), and an unknown outcome points at `tutor_change_request_list`.

## Sessions and tokens

- A person signs in by sending their own ms-backend access token. `SessionService.signIn` checks it with `/auth/me` (a check is reused for a minute) and keeps **one in-memory session per person**; a newer token updates it, so pending proposals survive the client refreshing its token.
- No refresh token is held: the client keeps its token fresh, as with any MCP server. When ms-backend refuses the token during a call, the session ends and the tool tells the model to ask the person to sign in again. Never retry with another token.
- Tokens never appear in a tool output, log or error. Tools get the token only through `SessionService.withAccessToken(...)`.
- `GET /.well-known/oauth-protected-resource` (RFC 9728) lists `MCP_AUTHORIZATION_SERVERS`; a refused token gets `401` with `WWW-Authenticate: Bearer resource_metadata="…"`.
- **Single instance only.** The store is in memory and capped (`SESSION_MAX_COUNT`, `SESSION_IDLE_TTL_SECONDS`). A restart loses pending proposals; each person's next request signs them in again. A shared store needs a design agreed with the team first.

## How this service talks to ms-backend

The backend side is already built in `ms-backend` (Go). Read its docs before writing a client:

- `docs/agent-identity.md` — how a bot logs in
- `docs/agent-change-record.md` — how agent actions are recorded
- `docs/agent-retries.md` — safe retries (may still be in an open PR; check the backend repo)

Rules this service must follow on every call:

1. **Log in as a bot.** Sign a client assertion with an Ed25519 key (RFC 7523), exchange it for a short-lived token, call `/api/v1/agent/*`. Discovery is at `/.well-known/agent-configuration`. Refresh the token before it expires.
2. **Send a retry key on every write.** A repeated request must never double-book or double-charge.
3. **Identify who acted.** Pass the run id, agent version, who it acts for, and the reason, so the backend change record is complete.
4. **No shortcuts.** Never write to the backend database, and never bypass its checks.
5. **Risky actions need approval.** Cancelling, rescheduling and anything involving money go through an approval step before the call.
6. **Events from the backend to here do not exist yet** (planned in the backend). Do not build against them until they ship.

## Build order

Do these in order, one PR each. Do not start a step until the previous one passes all checks.

1. **MCP endpoint.** Done. Streamable HTTP at `POST /mcp` in `src/mcp/`, stateless, bearer key from env, tool `ping`, tested with the SDK's own client in `test/e2e`. Tools now follow the shared pattern in "Tools" above.
2. **Backend client.** Partly done: `src/external/mssuize/` has the request helper (timeout on every call, JSON, response validation, error mapping) and the `auth` hook. Still to build: reading discovery from `/.well-known/agent-configuration`, logging in with the Ed25519 signed assertion, caching the token, logging in again on `401 invalid_token` (once), and backing off on `503`. Test against a fake HTTP server.
3. **First real tool: `whoami`.** Not started. Wraps `GET /api/v1/agent/me`. It proves the whole chain agent → MCP → backend works.
4. **Backend work (in `ms-backend`, separate repo and PR).** Today the backend's only agent route is `/me` and the only scope is `agent:self`. Each new tool needs an agent route and scope added there first (read-only ones first, such as viewing a session, then reschedule and cancel). Agree each route with the backend team before building its tool.
5. **Write tools** (reschedule, cancel). Retry key on every write, who-acted fields, approval step before the call.
6. **Events from the backend** (when they exist there). Verify signatures, ignore repeats.

## Code style

- Keep comments minimal: one line, only when the "why" is not obvious. Never describe a change in terms of the code it replaced
- Keep files under 500 lines; split by responsibility
- Validate every tool input with zod. Reject unknown fields
- Return errors in the shared response envelope; never leak internal details to the client
- No `any` unless the value is truly arbitrary

## Security

- Never log tokens, keys, passwords or personal data
- Secrets come from environment variables only. `.env` is gitignored; add new variables to `.env.example` and to `src/config/environment.ts`
- CORS: exact origins only, never `*`
- Production requires HTTPS for `BACKEND_BASE_URL` and an `MCP_API_KEY` of at least 32 characters; backend URLs cannot include credentials, query strings or fragments
- Backend response bodies are capped before JSON parsing; preserve the bound when changing the shared client
- Every external call has a timeout. Retries only on safe errors, with backoff
- The service owns no business data. The only state is the in-memory sign-in session store (single instance, lost on restart). Add any other state, or a shared store, only with a design agreed with the team first

## Docs and PRs

- Update `README.md` and `.env.example` in the same PR as any behaviour or config change
- One topic per PR; small PRs
- Do not push or release without the team agreeing. Releases are semantic-version tags (`vX.Y.Z`) handled by `.github/workflows/release.yml`

## What NOT to do

- Don't put business rules here; they belong in `ms-backend`
- Don't call `ms-backend` from anywhere except the backend client module (tools use `context.backend.request`, never `fetch`)
- Don't add a database to this service
- Don't copy-paste code between tools; share it in the backend client or a common module
