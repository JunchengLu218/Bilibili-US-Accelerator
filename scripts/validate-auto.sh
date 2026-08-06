#!/usr/bin/env bash
set -euo pipefail

plugin="Bilibili-US-Auto-Accelerator.plugin"
script="scripts/bilibili-auto-cdn.js"
test_file="test/bilibili-auto-cdn.test.js"
prepare_script="scripts/prepare-auto-test-plugin.sh"
node_bin="${NODE_BIN:-node}"

test -f "$plugin"
test -f "$script"
test -f "$test_file"
test -f "$prepare_script"

grep -Eq '^#!version = [0-9]+\.[0-9]+\.[0-9]+$' "$plugin"
grep -Fq '#!loon_version = 3.5.0(969)' "$plugin"
grep -Fq 'https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/main/scripts/bilibili-auto-cdn.js' "$plugin"
grep -Fq '#!type = normal' "$plugin"
grep -Fq 'Mode = select,"manual"' "$plugin"
grep -Fq 'generic script-path=' "$plugin"
grep -Eq '^generic .*tag=Bilibili CDN 测速并应用.*timeout=120.*img-url=speedometer\.system.*enable=true' "$plugin"
grep -Fq 'X-Bili-CDN-Probe' "$script"
grep -Fq '"binary-mode": true' "$script"
grep -Fq '"auto-redirect": false' "$script"
grep -Fq 'status !== 206' "$script"
grep -Fq 'Content-Range' "$script"
grep -Fq 'network:unknown' "$script"

# The stable plugin remains independent; the experimental plugin must not use
# old header Rewrite rules or redirect Akamai without the script-side switch.
if grep -Eq '^\[Rewrite\]| header https?://' "$plugin"; then
  echo "experimental plugin must use the classified script, not blanket Rewrite rules" >&2
  exit 1
fi

request_count="$(grep -Ec '^http-request ' "$plugin")"
if [[ "$request_count" != "5" ]]; then
  echo "expected 5 classified http-request entries; found $request_count" >&2
  exit 1
fi

"$node_bin" --check "$script"
"$node_bin" "$test_file"

# Also exercise the deployment helper so a future URL edit cannot silently
# make the test plugin load JavaScript from main.
temporary_plugin="$(mktemp "${TMPDIR:-/tmp}/bili-auto-cdn.XXXXXX")"
trap 'rm -f "$temporary_plugin"' EXIT
bash -n "$prepare_script"
bash "$prepare_script" loon-3.5.0-test "$temporary_plugin" >/dev/null
grep -Fq '/loon-3.5.0-test/scripts/bilibili-auto-cdn.js?test=' "$temporary_plugin"
grep -Eq '^generic .*tag=Bilibili CDN 测速并应用.*timeout=120.*img-url=speedometer\.system.*enable=true' "$temporary_plugin"
if grep -Fq '/main/scripts/bilibili-auto-cdn.js' "$temporary_plugin"; then
  echo "generated test plugin must not load the main-branch script" >&2
  exit 1
fi

echo "auto plugin validation passed"
