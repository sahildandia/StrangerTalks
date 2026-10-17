#!/usr/bin/env bash
# Sourced by the phone helpers. Install missing tools only inside GitHub Codespaces.
ST_PACKAGES=()
command -v node >/dev/null || ST_PACKAGES+=(nodejs)
command -v keytool >/dev/null || ST_PACKAGES+=(default-jdk-headless)
command -v zip >/dev/null || ST_PACKAGES+=(zip)
ST_NEEDS_GH=false
if ! command -v gh >/dev/null || ! gh variable --help >/dev/null 2>&1; then ST_NEEDS_GH=true; fi
if [ "${#ST_PACKAGES[@]}" -eq 0 ] && [ "$ST_NEEDS_GH" = false ]; then return 0; fi
if [ "${CODESPACES:-}" != true ] && [ -z "${CODESPACE_NAME:-}" ]; then
  echo 'Run setup in your GitHub Codespace. It needs node, keytool, zip and the GitHub CLI.'
  return 1
fi
command -v apt-get >/dev/null || { echo 'This workspace needs an Ubuntu/Debian container. Send this message to the assistant.'; return 1; }
ST_SUDO=()
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || { echo 'This workspace cannot install the missing tools. Send this message to the assistant.'; return 1; }
  ST_SUDO=(sudo)
fi
echo 'Installing missing workspace tools. This may take a few minutes; no code editing is needed.'
"${ST_SUDO[@]}" apt-get update
if [ "$ST_NEEDS_GH" = true ]; then
  "${ST_SUDO[@]}" apt-get install -y ca-certificates curl
  "${ST_SUDO[@]}" install -d -m 755 /etc/apt/keyrings
  curl --retry 3 -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | "${ST_SUDO[@]}" tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  "${ST_SUDO[@]}" chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' "$(dpkg --print-architecture)" | "${ST_SUDO[@]}" tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  "${ST_SUDO[@]}" apt-get update
  ST_PACKAGES+=(gh)
fi
"${ST_SUDO[@]}" apt-get install -y "${ST_PACKAGES[@]}"
for ST_TOOL in node keytool zip gh; do
  command -v "$ST_TOOL" >/dev/null || { echo "Setup tool still missing: $ST_TOOL"; return 1; }
done
unset ST_PACKAGES ST_NEEDS_GH ST_SUDO ST_TOOL
