#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo 'Run in your private GitHub Codespace. Do not paste secrets into chat or source files.'
gh auth status >/dev/null 2>&1 || { echo 'Sign in first with: gh auth login --web'; exit 1; }
read -r -p 'Paste your Supabase project reference (letters in its URL): ' ST_REF
[[ "$ST_REF" =~ ^[a-z0-9]{20}$ ]] || { echo 'Expected the 20-character project reference from Supabase settings.'; exit 1; }
read -r -s -p 'Paste your Supabase account access token (hidden): ' ST_TOKEN; echo
read -r -s -p 'Paste the database password you saved when creating the project (hidden): ' ST_DB_PASS; echo
test -n "$ST_TOKEN" && test -n "$ST_DB_PASS" || { echo 'Both secret values are required.'; exit 1; }
gh variable set SUPABASE_PROJECT_ID --body "$ST_REF"
printf '%s' "$ST_TOKEN" | gh secret set SUPABASE_ACCESS_TOKEN
printf '%s' "$ST_DB_PASS" | gh secret set SUPABASE_DB_PASSWORD
unset ST_TOKEN ST_DB_PASS
echo 'Credentials stored as GitHub secrets. Run Set up Supabase backend from the Actions tab.'
