# Verification record — 17 October 2026

Story: an adult accepts the rules → signs in anonymously with Supabase → calls authenticated database endpoints → matches another waiting identity → receives only that conversation's messages → safely ends or reports the chat.

## Locally verified

- TypeScript check and Vite production build succeeded.
- Dependency audit: zero known vulnerabilities at the time checked, after updating sharp and overriding xcode's vulnerable uuid dependency.
- Android native project generated successfully with Capacitor 8; plugins discovered: App, Preferences, Splash Screen. Launcher and splash PNG generation succeeded.
- PostgreSQL 17.11 integration tests ran against an isolated local database using Supabase-compatible auth/role fixtures. Twelve total Node test assertions/subtests passed, including configuration tests and the nine database scenarios below.
- Browser automation in installed desktop Chrome using a 390×844 mobile viewport passed both UI scenarios: eligibility controls/unconfigured-backend behavior/no horizontal overflow; and settings/theme/privacy/guidelines.

Database scenarios: consent and controller lease; wait for second user/shared match/idempotent join; messages/retry/typing/flood/content filter; outsider reads/forged writes/private access denied; Next/end/stale action rejection; report evidence limit/two-way blocks; offline expiry/reconnect/retention; twelve simultaneous users in six disjoint conversations; cancel/moderator restriction and audit logging.

## Hosted Supabase verification

- Applied both migrations to project `sqchwdaspzkkfxavidha` and recorded their versions in migration history. Confirmed all ten application tables have RLS enabled.
- Installed the every-minute `strangertalk-retention` pg_cron job and confirmed a successful execution. No active test queue entries or memberships remained afterward.
- Three independent anonymous API clients exercised consent, waiting, shared matching, heartbeats, message persistence, retry deduplication, typing expiry, Next, cancellation, reporting, and blocking.
- Confirmed authenticated Postgres Changes delivery to a recipient. A third, unrelated client could neither read the conversation's messages nor forge a send. Initial subscription startup timed out in the first run; two later runs passed with explicit authentication and subscription warmup. The app also reconciles every three seconds.
- Test clients were signed out and conversations ended. Synthetic test records follow the configured retention policy.

## Signed Android release

- GitHub Actions [release run 3](https://github.com/sahildandia/StrangerTalks/actions/runs/39051748514) succeeded using Java 21, Android SDK 36, and the owner's permanent RSA-4096 signing key. Source commit: `d77ed8344b97c7f1ece57569e081c0ba3e6f85f1`. Subsequent documentation edits do not affect this APK.
- Android `apksigner verify --verbose --print-certs` passed with APK Signature Scheme v2. Certificate SHA-256: `218f6533c7a512c5d47ea815653d8b81ccf0a166eaa044ea697e79454bdf7cc9`.
- Downloaded the artifact and independently checked its embedded APK checksum: `1419af8c13fda72d0e56e879b46bfb40ed75808d851be9f8c37a3a547b9f1d8a` (`StrangerTalk-release.apk`). ZIP digest matched GitHub's artifact digest.
- Artifact: `StrangerTalk-release-3`, 3,189,097 bytes, expires 24 October 2026. A local copy is preserved in the workspace deliverables. Signing material is excluded from both app and source archives.

## Mobile layout update — 1.0.1

- Locked document scrolling and removed the chat's fixed minimum heights. The header and message composer share a bounded flex layout; only the transcript scrolls. Short welcome screens and long policy dialogs retain their own accessible scroll areas.
- Sized the shell to the visible viewport, including keyboard resize, and explicitly configured Capacitor SystemBars CSS insets for status/navigation bars and display cutouts.
- Refined the welcome screen, spacing, consent card, message bubbles, button sizes, and offline feedback. Sending retains input focus; a later draft is preserved if typed while a previous send is pending.
- Replaced document-level `scrollIntoView` with transcript-only scrolling. Reading older messages is preserved when a new message arrives; a New messages button returns to the latest message.
- Seven browser checks passed for consent, settings/theme/policies, no document scrolling, reachable Start controls and bounded dialogs at 320×568, 360×640, 390×844, 412×915 and 740×360.
- An additional isolated chat layout test passed with 45 fixture messages, incoming-message/history behavior, keyboard-sized 360×360 resize, sending and offline banner. This test intercepts the backend module inside its test browser only; it creates no hosted users or messages and is not evidence of device keyboard behavior.
- TypeScript/Vite production build passed. GitHub app/database verification passed on source commit `fd88d7704db735271426af4948da4c6a5cbcad9c`.
- Signed APK [release run 5](https://github.com/sahildandia/StrangerTalks/actions/runs/39053110297) succeeded on that commit. Version name is 1.0.1; version code is 5. Signature verification passed, and the certificate SHA-256 matches release 3, allowing an in-place update.
- Downloaded `StrangerTalk-release-5` and verified ZIP digest `4c12580e3af55e62da67e8fb848f09ad14c9647f0b891a313998e576ba99be4b`. APK SHA-256 is `79dd246d5c81bf4ad9546f243f43c596ee646b44f21eaa753bb9b7f750eefd1f`, matching its bundled checksum. Artifact expires 24 October 2026; a local copy is preserved in deliverables.

## Remaining phone checks for 1.0.1

- Native token persistence/refresh across restarts and optional CAPTCHA on an actual Android WebView.
- Android installation, compatible update, keyboard/lifecycle behavior, and a real conversation between two devices.
- Human review of report operations, support contact, public-launch abuse defenses, and the privacy notice for the actual operator and region.

Hosted checks used automated clients, not people or Android devices. See TEST-PLAN.md for the remaining acceptance checks. Public backend settings are configured; administrative credentials are excluded from the app.
