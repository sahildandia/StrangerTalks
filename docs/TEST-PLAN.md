# Two-device acceptance test — not yet performed

Use a dedicated Supabase test project and two consenting adults. Never seed fake strangers into the production queue.

1. Install the successful release artifact on two Android devices. Both should have a current System WebView. Confirm branding, splash, small-screen keyboard behavior, Back navigation, light theme, and accessible text.
2. On a new install, confirm age and policy controls prevent Start until selected. Verify anonymous login succeeds without asking for email/phone. If configured, complete CAPTCHA on an actual device and verify an expired/invalid token fails.
3. Start A alone: it must keep searching and never fabricate a stranger or online count. Start B: both must reach the same conversation.
4. Send A→B and B→A messages; confirm sender attribution, ordering, timestamps, automatic scroll, and fast Realtime updates. Briefly interrupt Realtime and confirm polling reconciles without duplicate messages. Verify the latest-200 display limit during a long test.
5. Type on A without sending: B must see typing, which expires. Clear/send the draft and check it clears promptly.
6. Test rapid sends, duplicate text, >2,000 characters through an API client, links, and safety phrases: the backend must reject them. Disconnect immediately after sending and retry: reuse of the same nonce must not duplicate a message.
7. Tap Next on A: B must see a disconnect. A must search or join a different available adult. A and B should not immediately rematch for 30 seconds. Double-tapping or parallel requests must not create multiple active memberships.
8. End chat on A: both must leave active status; A returns home. Cancel search alone and at the instant a match arrives: neither device may remain in an unnoticed active chat.
9. Block B: no report evidence should be created. Restart both searches after the rematch pause and confirm they still do not pair. A third adult should be able to match with an eligible unblocked identity.
10. Report another session: confirm it ends and blocks the identity. In the owner dashboard, confirm the report contains at most 20 messages, correct target/reporter, reason, and 30-day expiry; another client must not read it.
11. Airplane mode on A for 10–20 seconds: the UI must pause sends, show reconnection, and reconcile after return. Repeat for >75 seconds: the old conversation must end, with no restored active membership. Background for >75 seconds and verify the same expiry behavior.
12. Force-stop/reopen, rotate, suspend, and switch networks during search/send/Next. Confirm a fresh app controller can't drive the same identity while the old lease is active. Retry after lease expiry, not by resetting identity.
13. With a third authenticated user, attempt arbitrary session UUID reads/writes, sender spoofing, report reads, private function calls, and direct table updates. All must be denied or return no rows. The automated PostgreSQL tests cover these boundaries, but hosted RLS/Realtime should also be checked.
14. Confirm Cron successful runs. End a chat, wait 12 minutes, and verify ordinary messages are gone. Test expired reports with an owner-created test record. Never change the production clock for testing.
15. Use the owner-only moderation helper on a test identity. Confirm the active session ends, future RPCs fail for that identity, the moderation log is written, and zero-hour unban restores eligibility.
16. Install a later release over the first without uninstalling. Android must accept the same signing key and higher version code. Confirm the existing anonymous identity survives the update.

Record each result, APK SHA256, device model, Android/WebView version, backend project, and test time. Passing source/database tests does not substitute for these checks.
