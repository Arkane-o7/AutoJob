# Scout extension permission audit

Reviewed July 18, 2026.

| Permission or access | Why Scout needs it | Decision |
| --- | --- | --- |
| `storage` | Keeps the signed-in user's offline cache, session-safe settings, resume cache, reminders, and migration metadata | Keep |
| `unlimitedStorage` | A single permitted resume can be up to 8 MiB and Scout retains account-scoped resume versions plus an offline workspace; Chrome's ordinary local quota is not sufficient for that product behavior | Keep, disclose as local account cache |
| `alarms` | Refreshes follow-ups and retries queued account sync without opening a page | Keep |
| `webNavigation` | Enumerates application frames so user-invoked autofill can reach ATS forms embedded in same-site or third-party frames | Keep |
| `identity` | Runs the user-initiated Google and LinkedIn OAuth redirect flow | Keep |
| `activeTab` | Previously duplicated the broad content-script host access | Removed in v0.11.0; regression suite must remain green without it |
| `http://*/*`, `https://*/*` content-script matches | Job forms appear on thousands of employer-owned domains in addition to known ATS hosts. Scout needs to detect a job and fill only after explicit user action | Keep for current reliability; explain prominently in the Web Store disclosure and re-evaluate optional host access before public submission |
| Localhost Ollama optional hosts | Used only after the user explicitly enables local AI | Keep optional |
| Exact production Supabase origin | Added by the production build for authenticated API, Storage, and Edge Function calls | Keep exact origin only; the build removes broad Supabase and local-development patterns |

## Safety constraints tied to broad page access

- Scout does not run autofill silently. The detected-page prompt requires the
  user to click **Save & autofill**.
- Scout never clicks Next, Apply, Submit, consent, CAPTCHA, or assessment
  controls.
- The post-submission prompt requires recent trusted submit intent, strong
  confirmation evidence, and a second explicit **Yes, mark applied** action.
- Broken-field reports contain only fields selected by the user and a complete
  sanitized preview; entered values and resume contents are excluded.
- Account tokens and cloud operations are owned by the extension service worker,
  not page content scripts.
