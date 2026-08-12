#!/usr/bin/env bash
set -euo pipefail

plugin="Bilibili-US-Accelerator.plugin"
script="scripts/bilibili-auto-cdn.js"
icon="assets/bilibili-blue.png"
node_bin="${NODE_BIN:-node}"
expected_candidates='Candidates = input,"upos-sz-mirrorcosov.bilivideo.com,upos-sz-mirroraliov.bilivideo.com,upos-sz-mirrorhwov.bilivideo.com,upos-sz-mirrorali.bilivideo.com,upos-tf-all-hw.bilivideo.com,upos-sz-mirrorhw.bilivideo.com,upos-sz-mirrorcos.bilivideo.com,upos-tf-all-tx.bilivideo.com"'

test -f "$plugin"
test -f "$script"
test -s "$icon"

grep -Eq '^#!version = [0-9]+\.[0-9]+\.[0-9]+$' "$plugin"
grep -Fq '#!loon_version = 3.5.0(969)' "$plugin"
grep -Fq '#!icon = https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/main/assets/bilibili-blue.png' "$plugin"
grep -Fq 'https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/main/scripts/bilibili-auto-cdn.js' "$plugin"
grep -Fq '#!type = normal' "$plugin"
grep -Fq 'Mode = select,"manual"' "$plugin"
grep -Fq "$expected_candidates" "$plugin"
grep -Eq '^generic .*tag=Bilibili CDN 测速并应用.*timeout=180.*img-url=atom\.system.*enable=true' "$plugin"

if grep -Fq 'Mode = select,"first-request"' "$plugin"; then
  echo "stable plugin must remain manual-only" >&2
  exit 1
fi

if grep -Eq '^\[Rewrite\]| header https?://' "$plugin"; then
  echo "stable manual plugin must use classified scripts, not blanket Rewrite rules" >&2
  exit 1
fi

request_count="$(grep -Ec '^http-request ' "$plugin")"
if [[ "$request_count" != "5" ]]; then
  echo "expected 5 classified http-request entries; found $request_count" >&2
  exit 1
fi

benchmark_timeout_count="$(grep -Ec '^http-request .*timeout=180,' "$plugin")"
if [[ "$benchmark_timeout_count" != "4" ]]; then
  echo "expected 4 benchmarkable request entries with a 180-second timeout; found $benchmark_timeout_count" >&2
  exit 1
fi

"$node_bin" --check "$script"

echo "stable manual plugin validation passed"
