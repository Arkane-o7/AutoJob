# Google Calendar setup for Scout

Scout uses a Chrome Extension OAuth client and requests only
`https://www.googleapis.com/auth/calendar.events.owned`. The scope can access
events on calendars the user owns. Scout limits its implementation to the
primary calendar and queries only events carrying Scout's private action
identifiers; it does not import or browse unrelated events.

## Google Cloud configuration

1. In the Google Cloud Console, select the production Scout project and enable
   the **Google Calendar API**.
2. Configure the OAuth consent screen with Scout's production name, support
   contact, privacy policy, and authorized domains. Add test users while the app
   remains in testing mode.
3. Create an OAuth client with application type **Chrome Extension**. Use the
   production Scout extension ID shown by Chrome Web Store. Create a separate
   client for an unpacked development ID when real local OAuth testing is
   required.
4. Build the production package with the public Chrome client ID supplied as an
   environment variable:

   ```bash
   SCOUT_GOOGLE_OAUTH_CLIENT_ID="000000000000-example.apps.googleusercontent.com" \
   SCOUT_BUILD_MODE=production \
   SCOUT_SUPABASE_URL="https://PROJECT.supabase.co" \
   SCOUT_SUPABASE_PUBLISHABLE_KEY="sb_publishable_VALUE" \
   npm run build:production
   ```

   OAuth client IDs are public identifiers, but deployment-specific values are
   intentionally not committed to the repository. The build writes the value
   into `dist/manifest.json`.
5. Before public distribution, complete any Google OAuth verification required
   for the consent screen and requested Calendar scope. Keep the published
   privacy disclosure aligned with the final consent-screen configuration.

## Release smoke test

Using a dedicated Google Calendar test account, connect from Scout Settings,
add one open action to the calendar, reschedule the action and confirm the event
updates, then complete the action and confirm the event is deleted. Plan 010
must remain in progress until that flow succeeds in the installed extension.
