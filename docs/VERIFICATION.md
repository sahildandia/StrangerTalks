# Verification record — 17 October 2026

Story: an adult accepts the rules → signs in anonymously with Supabase → calls authenticated database endpoints → matches another waiting identity → receives only that conversation's messages → safely ends or reports the chat.

## Locally verified

- TypeScript check and Vite production build succeeded.
- Dependency audit: zero known vulnerabilities at the time checked, after updating sharp and overriding xcode's vulnerable uuid dependency.
- Android native project generated successfully with Capacitor 8; plugins discovered: App, Preferences, Splash Screen. Launcher and splash PNG generation succeeded.
- PostgreSQL 17.11 integration tests ran against an isolated local database using Supabase-compatible auth/role fixtures. Twelve total Node test assertions/subtests passed, including configuration tests and the nine database scenarios below.
- Browser automation in installed desktop Chrome using a 390×844 mobile viewport passed both UI scenarios: eligibility controls/unconfigured-backend behavior/no horizontal overflow; and settings/theme/privacy/guidelines.

Database scenarios: consent and controller lease; wait for second user/shared match/idempotent join; messages/retry/typing/flood/content filter; outsider reads/forged writes/private access denied; Next/end/stale action rejection; report evidence limit/two-way blocks; offline expiry/reconnect/retention; twelve simultaneous users in six disjoint conversations; cancel/moderator restriction and audit logging.

## Still requires connected services / devices

- Hosted Supabase anonymous sign-in, token persistence/refresh, CAPTCHA and hosted API grants.
- Hosted Postgres Changes delivery and RLS subscription checks, with polling recovery.
- Installation and successful execution of Supabase's pg_cron schedule (the local test server does not include that extension).
- A successful Android Gradle/APK build, signature verification, download, install, update, keyboard/lifecycle behavior, and real conversation between two devices.
- Human review of report operations, support contact, public-launch abuse defenses, and the privacy notice for the actual operator and region.

No APK build, cloud deployment, real-device testing, or live Supabase authentication is claimed. See TEST-PLAN.md for the remaining acceptance checks. The app deliberately displays a setup error until actual public backend configuration is supplied.
