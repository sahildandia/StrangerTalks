# StrangerTalk

Anonymous one-to-one text chat for adults, with React + TypeScript + Vite, Supabase, and Capacitor Android. The source contains real database-backed matching and messaging. There are no bots, simulated messages, or invented online counts.

**Status:** source generated and local checks performed; see `docs/VERIFICATION.md`. Supabase must be provisioned and connected. A usable Android APK has not yet been built. No real-device or hosted Supabase testing is claimed.

## Start here — only Step 1 for now

On your Android phone, open [GitHub signup](https://github.com/signup) in Chrome. Create a **free personal account** and verify your email. If you already have one, sign in. Then tell the assistant **“GitHub ready”**. It will guide the next step. You do not need a laptop, Android Studio, or programming knowledge.

The rest of this document is a reference for later. You can stop reading here.

## What is included

- Animated splash, dark welcome screen, search, chat, disconnected screen, settings, light theme, privacy policy, and guidelines.
- Anonymous Supabase authentication; device-persistent credentials; explicit 18+ and policy acceptance recorded on the server.
- Atomic random matching, one active membership per identity, two-way block checks, and a 30-second pause before rematching the same identity.
- Server-side membership checks, messages with idempotent retry, timestamps, typing expiry, Realtime subscriptions and 3-second reconciliation polling.
- Next, end, cancel (including a match arriving during cancellation), report/block, flood limits, and a small basic phrase/link filter.
- Short message retention, private report evidence, scheduled cleanup, and owner moderation helpers.
- Native Android source, launcher icons, splash images, Internet permission only, backups disabled, HTTPS-only network traffic, and release signing configuration.
- GitHub Actions workflows for database setup, verification, and signed APK builds. Phone scripts store private values in GitHub secrets.

The database's `SECURITY DEFINER` functions are the backend endpoints. They authenticate the caller, serialize matchmaking, check consent, enforce session membership, and apply limits within the transaction. This MVP does not require separate Edge Functions or a service-role key in the app.

## Later phone-only setup reference

Use Chrome's **⋮ → Desktop site** when a dashboard hides an option. The assistant should walk through these one at a time; no code editing is required.

### Create the backend

1. Visit [Supabase](https://supabase.com/dashboard) and sign up using your GitHub account. Use the Free plan.
2. Tap **New project**, select/create your personal organization, name the project `StrangerTalk`, save a strong database password in your password manager, choose a nearby region, and create it. Wait for it to finish.
3. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**, then save. Dashboard wording can vary. Disable email/password signup if you do not intend to use it.
4. In **Project Settings → API / API Keys** (or the project's **Connect** panel), locate the project URL and **publishable** key (`sb_publishable_…`). The old public `anon` JWT also works. Neither a secret key (`sb_secret_…`) nor a `service_role` JWT belongs in the app.
5. For the backend deployment workflow, create an access token at [Supabase account tokens](https://supabase.com/dashboard/account/tokens). Keep the token and database password private; the assistant does not need to see them. The project reference is the 20-letter code in the project URL.

### Put the generated ZIP into a private repository

1. Download `StrangerTalk-source.zip` to your phone.
2. At [GitHub new repository](https://github.com/new), name the repository `strangertalk`, choose **Private**, select **Add a README file**, and create it. Private protects signing operations and avoids accidental sharing of project settings. Private Actions has an included usage quota.
3. Open the repository, tap **Code → Codespaces → Create codespace on main**. This runs a temporary computer in your browser, not on a laptop. Use a 2-core machine. If this is difficult on a phone, request Desktop site and rotate your phone.
4. In Codespaces' file explorer, use the folder menu's **Upload…** to upload `StrangerTalk-source.zip`. If the assistant already uploaded the source for you, skip the ZIP upload and extraction. The workspace uses a lightweight Ubuntu image; the setup script installs missing configuration/signing tools automatically. Android builds run in GitHub Actions. If an older configuration leaves the workspace in recovery mode, run `git pull --ff-only`, then use **Command Palette → Codespaces: Rebuild Container**.
5. Open **Terminal → New Terminal**, paste this short command, and press Enter:

   ```sh
   unzip -o StrangerTalk-source.zip
   ```

   The ZIP contains the project files directly, including `.github` and `.devcontainer`. It replaces the initial README. You never need to edit the source.

6. Run the following command and answer its short prompts with your project URL, public key, and monitored support email:

   ```sh
   bash scripts/phone-setup.sh
   ```

   The script saves public settings as repository variables, generates a permanent release signing key, and saves its four signing values as GitHub secrets. Secret values are supplied through standard input. It preserves an existing remote signing key.

7. In the explorer, download **signing-backup.zip** using its file menu's **Download** action. Store it privately with your password manager or encrypted personal backup. It contains the signing key and password. Do not upload it to the repository or share it in chat. Losing the key prevents compatible updates to your existing APK. Downloading a ZIP to your phone does not require opening it there.

8. Store backend credentials with the next script; its secret prompts hide your input:

   ```sh
   bash scripts/backend-setup.sh
   ```

9. Use Codespaces **Source Control → Stage All Changes**, enter `Add StrangerTalk`, then **Commit → Sync Changes**. The ignore rules keep backups, passwords, app builds, local test data, and ZIPs out of Git. If GitHub requests authorization for repository secrets or workflow changes, authorize your own private repository. A failure from `gh` should be resolved by signing in with `gh auth login --web`; do not paste an access token into a command or source file.

### Deploy the backend and enable cleanup

1. Open the GitHub repository's **Actions** tab and enable workflows if asked.
2. Choose **Set up Supabase backend → Run workflow → Run workflow**. It applies both SQL migrations, including Cron. Wait for a green check. Use a fresh Supabase project; the first migration is not designed to overwrite an existing unrelated application.
3. In Supabase **Integrations → Cron / Database → Cron**, confirm `strangertalk-retention` runs every minute and has successful runs. The private scheduler performs expiry and deletion. If the migration cannot install Cron, enable the `pg_cron` extension in **Database → Extensions**, then rerun the backend workflow. Do not distribute the app while this is failing.
4. Keep Supabase's exposed schemas restricted to the normal public API schemas; **never expose `private`**. The migration publishes only `chat_sessions` and `chat_messages` to Realtime and enforces RLS reads. No write permissions are given to app clients.
5. The backend workflow token can be revoked after deployment, and its GitHub secret removed. Future migrations will need a new token. Keep your database password private.

### Build, download, and install the signed APK

1. In GitHub **Actions**, choose **Build Android APK → Run workflow**. Leave **release** selected, then tap **Run workflow**.
2. Wait for the green check. This is the point at which an APK has actually been built and its signature verified. If red, open the failed step and share its error text with the assistant, excluding secret values.
3. Open the successful run, scroll to **Artifacts**, and tap **StrangerTalk-release-…**. You must be signed into GitHub to download it. GitHub downloads a ZIP containing `StrangerTalk-release.apk` and its checksum.
4. In Android's Files app, open Downloads, tap the ZIP and choose **Extract**, then tap the APK. When Android asks, enable **Allow from this source** for your Files app and tap **Install**. Menu names vary by phone. Restore that permission afterward if desired. Keep Android's security scanning enabled.
5. Open StrangerTalk, read the policies, confirm you are an adult, and accept the guidelines. For a real match, a second adult must install the same APK on another device and start chatting too. With one user, searching continues honestly.

The `debug` workflow choice is only for temporary testing: a cloud debug key can change between runs. Release builds use your persistent private key. Android version codes follow the workflow run number. Do not reset that sequence or change the application ID if you want compatible updates. No Play Store account is required for direct APK installation; Play Store publication is separate work.

### Optional CAPTCHA before broader distribution

Supabase recommends CAPTCHA for anonymous sign-ins. This project includes an **hCaptcha** widget. [hCaptcha does not accept localhost as a registered site hostname](https://docs.hcaptcha.com/). To enable it for the Android wrapper, first use an HTTPS hostname you control (a free hosted site subdomain can qualify), register that hostname in hCaptcha, and set GitHub variable `CAPACITOR_HOSTNAME` to it without `https://`. Capacitor serves the bundled app at that local virtual origin; it does not download the app from that site. Keep the hostname stable after release because changing the origin can reset browser-backed state.

Then enable hCaptcha in Supabase Auth's bot/abuse protection, save the hCaptcha **secret** in Supabase only, and set its matching **public site key** as GitHub variable `VITE_HCAPTCHA_SITE_KEY`. Rebuild the APK and test first login on a real Android WebView. The release validator rejects CAPTCHA settings without an appropriate hostname. Native CAPTCHA remains unverified until that device test passes. Do not enable CAPTCHA in Supabase without matching app settings. Do not disable provider rate limits.

For a small two-person private test, CAPTCHA can remain off; Supabase still applies its provider authentication limits. Per-identity app limits alone cannot stop someone repeatedly creating new identities. A public launch requires working CAPTCHA, monitored reports, and a tested moderation process.

## Owner safety operations

The support address supplied during setup appears in the app's policy and safety screens. You must monitor it. Reporting stores a record; it does **not** send an email or promise a review time. This is not a staffed moderation service.

In Supabase's Table Editor, use the schema dropdown to open **private → user_reports**. Read the reason and limited evidence privately. Set `reviewed_at` when reviewed. Only project administrators should access this area. Avoid copying evidence into public issues or logs. The public `profiles` table contains `banned_until`, which is protected from app clients.

The SQL Editor can call the owner-only helper `private.st_moderate(identity_uuid, hours, review_note)` to restrict/unrestrict an identity, log the action, and end its active conversation. The assistant can prepare an exact command using a specific report when needed. Zero hours removes a restriction. Do not grant execution or schema access to clients. Reinstalling or clearing app data can create a new identity and evade identity-based bans; this MVP does not claim device-level blocking or verified ages.

## Retention and limits

- Heartbeat every 3 seconds while foregrounded. A user absent for 75 seconds loses queue/conversation membership. Short connection gaps recover through session status and message reconciliation; long gaps end the chat. Chat maximum: one hour.
- Live chat shows the latest 200 messages, not a permanent archive.
- Message limit: 2,000 characters; minimum 600 ms between messages; maximum 30 accepted messages per minute per identity; repeated identical messages within 10 seconds rejected.
- Match/Next limited to 12 requests per minute per action; server side locking serializes mutations. This is an MVP architecture, not a high-volume sharded matcher. Typing updates are throttled and expire after 4 seconds.
- With healthy minute Cron: ordinary messages removed approximately within 11 minutes of chat end or 61 minutes of sending, whichever comes first. Ended session metadata is removed after one day.
- A report retains at most 20 messages in a restricted evidence record for 30 days. Reports use IDs rather than names. Identities and their block/consent records expire after 90 days of inactivity; moderation log records after 90 days.
- Provider access logs/backups have their own retention. Messages use HTTPS/WSS transport encryption and provider database storage protections, **not end-to-end encryption**.
- No reliable global online count is shown. All matching candidates are actual authenticated users with recent heartbeats; a modified or automated client can still create an identity, so “no bots supplied by this app” is not an anti-bot guarantee.

## Costs and service limits

Checked against provider documentation on 17 October 2026; pricing and quotas can change.

- [Supabase Free](https://supabase.com/docs/guides/platform/billing-on-supabase): 500 MB database and 200 peak Realtime connections per project. There are additional authentication, traffic and Realtime message quotas. This is for a small MVP, not unlimited usage.
- [Free Supabase projects may pause](https://supabase.com/docs/guides/platform/free-project-pausing) after seven days of low activity. Pausing also stops matching and cleanup; resume the project and confirm successful cleanup before reuse. Retention time targets assume the scheduler is running.
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions): standard runners are free for public repositories; private repositories use plan allowances (GitHub Free personal has 2,000 included minutes/month). Artifacts/storage also have quotas. This project keeps APK artifacts for seven days. Set a zero spending budget if you want no usage charges, and do not upgrade or add paid usage to follow this guide.
- [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces): GitHub Free personal includes 120 core-hours and 15 GB-month storage. A 2-core Codespace uses two core-hours per elapsed hour. Stop it when done and delete it after backing up the signing key; stopped storage still counts. New/account-restricted users may need to resolve GitHub eligibility first.
- Android tools run in GitHub Actions. You do not install them on your phone. A self-signed APK is free; service/account identity checks and Play Store rules are separate from the build.

## Developer reference

Use Node 22.12+, Java 21, and Android SDK 36 for native development. Android minimum is API 24 (Android 7); the device also needs a current compatible System WebView. Newer Android/SDK policies may require updates before public release.

```sh
npm ci
npm test
npm run build
npm run android:sync
npm run assets
```

`npm test` runs config checks and, if `TEST_DATABASE_URL` exists, a PostgreSQL integration suite. The database suite is destructive **only to a dedicated database whose name ends in `_test`**. It creates auth fixtures and Supabase roles rather than contacting hosted authentication. Use a clean disposable instance, never your live database. GitHub's verification workflow supplies one automatically.

For browser UI checks, run `npx playwright install chromium`, then `npx playwright test`. Set `PLAYWRIGHT_CHROMIUM_PATH` when using an existing local Chrome. Those UI checks run with no backend settings and verify the honest unconfigured state, not a simulated conversation.

Development uses `.env.local` with the public values from `.env.example`; the file is ignored by Git. GitHub builds get public config from variables. Hosted auth enablement is a dashboard step: `supabase/config.toml` configures local Supabase, not the hosted project's Auth settings.

The lockfile fixes the installed dependencies. `xcode`'s `uuid` override patches a build-time dependency; the project targets Android. Icons are project-native SVG and generated PNG; fonts are bundled locally and their package licenses remain in their packages. No Google Fonts network request is needed.

See `docs/TEST-PLAN.md` for the two-device acceptance checklist and `docs/VERIFICATION.md` for what has actually been verified.
