#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo 'StrangerTalk phone setup. Keep this Codespace private.'
source scripts/ensure-setup-tools.sh
gh auth status >/dev/null 2>&1 || { echo 'Sign in first with: gh auth login --web'; exit 1; }
read -r -p 'Paste your Supabase project URL: ' ST_URL
read -r -p 'Paste your PUBLIC publishable key: ' ST_PUBLIC_KEY
read -r -p 'Enter your monitored support email: ' ST_EMAIL
VITE_SUPABASE_URL="$ST_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$ST_PUBLIC_KEY" VITE_SUPPORT_EMAIL="$ST_EMAIL" node scripts/check-config.mjs
gh variable set VITE_SUPABASE_URL --body "$ST_URL"
gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --body "$ST_PUBLIC_KEY"
gh variable set VITE_SUPPORT_EMAIL --body "$ST_EMAIL"
ST_SECRET_NAMES="$(gh secret list --json name --jq '.[].name')"
if printf '%s\n' "$ST_SECRET_NAMES" | grep -qx ANDROID_KEYSTORE_BASE64; then
  for ST_REQUIRED in ANDROID_STORE_PASSWORD ANDROID_KEY_PASSWORD ANDROID_KEY_ALIAS; do
    printf '%s\n' "$ST_SECRET_NAMES" | grep -qx "$ST_REQUIRED" || { echo 'Signing secrets are incomplete. Preserve signing-backup.zip and ask the assistant to restore its values; do not generate a new key.'; exit 1; }
  done
  echo 'Existing signing key preserved.'
else
  command -v keytool >/dev/null || { echo 'Java keytool is missing. Use the supplied Codespaces configuration.'; exit 1; }
  if [ -d signing-backup ]; then echo 'A local signing backup already exists. Restore its secrets instead of replacing your key.'; exit 1; fi
  mkdir -m 700 signing-backup
  ST_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  export ST_SIGN_PASSWORD="$ST_PASSWORD"
  keytool -genkeypair -noprompt -keystore signing-backup/strangertalk.jks -storetype PKCS12 -storepass:env ST_SIGN_PASSWORD -keypass:env ST_SIGN_PASSWORD -alias strangertalk -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=StrangerTalk Android, O=StrangerTalk'
  base64 -w 0 signing-backup/strangertalk.jks | gh secret set ANDROID_KEYSTORE_BASE64
  printf '%s' "$ST_PASSWORD" | gh secret set ANDROID_STORE_PASSWORD
  printf '%s' "$ST_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD
  printf '%s' 'strangertalk' | gh secret set ANDROID_KEY_ALIAS
  printf 'Store password: %s\nKey password: %s\nAlias: strangertalk\nKeep this file and key private. Never commit them.\n' "$ST_PASSWORD" "$ST_PASSWORD" > signing-backup/KEEP-PRIVATE.txt
  chmod 600 signing-backup/*
  (umask 077; zip -q -r signing-backup.zip signing-backup)
  unset ST_SIGN_PASSWORD ST_PASSWORD
  echo 'Signing key saved as repository secrets. Download signing-backup.zip privately before deleting this Codespace.'
fi
echo 'Setup complete. Commit the source, then run Build Android APK from the Actions tab with release selected.'
