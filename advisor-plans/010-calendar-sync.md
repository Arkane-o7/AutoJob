# Plan 010: Google Calendar reminder sync

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: Plan 009
- **Planned at**: `4eee456`, 2026-08-02
- **Status**: IN PROGRESS

## Outcome

Let users explicitly connect their primary Google Calendar, synchronize Scout
actions as 30-minute events, and download any open action as a portable `.ics`
event. Scout remains the source of truth and calendar failures never block CRM
work.

## Implementation scope

- Use Chrome Identity with the single
  `calendar.events.owned` scope and an environment-injected production client
  ID. Never persist access tokens.
- Store Google event mapping and non-blocking sync status directly on the
  existing action record.
- Create, update, deduplicate, and remove primary-calendar events as open Scout
  actions change; retry one 401 after evicting the cached token.
- Add explicit per-action controls, optional new-action auto-sync, sync-all,
  disconnect, connection status, and the required privacy disclosure.
- Generate standards-based `.ics` downloads locally with a stable action UID
  and ten-minute alarm.
- Cover authorization, lifecycle, failures, duplicate prevention, settings,
  token handling, ICS output, and packaged-extension persistence with mocks.

## Release gate

Keep this plan **IN PROGRESS** until one installed Scout build creates, updates,
and deletes an event in a real Google Calendar test account. The mocked
integration and all repository gates must pass before the draft pull request is
opened.

## Verification — 2026-08-02

- `npm run verify`: PASS
- Production configuration build/check with deployment-shaped placeholder
  values: PASS; production fails closed without a Google OAuth client ID
- Unit tests: 102/102, including 14 focused Calendar authorization, lifecycle,
  failure, de-duplication, settings, token-storage, and `.ics` assertions
- Packaged MV3 browser regression: 10/10 ATS fixtures plus the mocked Google
  Calendar connect, create, update, delete, reload, and `.ics` lifecycle
- Database tests: 63/63 pgTAP assertions
- Database lint: 0 warnings
- Repository hygiene: `git diff --check` passes and no release archive or
  generated output is included

The real-account installed-extension smoke test remains pending, so this plan
is intentionally not marked DONE.

## Deliberately out of scope

Two-way sync, event import, Microsoft or Apple authentication, webhooks,
polling, Gmail, scheduling, availability, calendar selection, recurrence, and
meeting automation remain deferred.
