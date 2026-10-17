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

## Still requires devices / further acceptance checks

- Native token persistence/refresh across restarts and optional CAPTCHA on an actual Android WebView.
- Android installation, compatible update, keyboard/lifecycle behavior, and a real conversation between two devices.
- Human review of report operations, support contact, public-launch abuse defenses, and the privacy notice for the actual operator and region.

Hosted checks used automated clients, not people or Android devices. See TEST-PLAN.md for the remaining acceptance checks. Public backend settings are configured; administrative credentials are excluded from the app.
