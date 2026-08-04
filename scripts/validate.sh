#!/usr/bin/env bash
set -euo pipefail

plugin="Bilibili-US-Accelerator.plugin"

test -f "$plugin"
grep -Eq '^#!version = [0-9]+\.[0-9]+\.[0-9]+$' "$plugin"
grep -Fq 'force-http-engine-hosts = *:80, *:4480, *:4483, *:8000, *:8082, *:9102' "$plugin"
grep -Fq 'header http://upos-sz-mirrorali.bilivideo.com' "$plugin"
grep -Fq 'header https://upos-sz-mirrorali.bilivideo.com' "$plugin"
grep -Fq 'header http://proxy-tf-all-ws.bilivideo.com' "$plugin"
grep -Fq 'header https://proxy-tf-all-ws.bilivideo.com' "$plugin"
grep -Fq 'hostname = upos-sz-mirror*.bilivideo.com, upos-tf-all-*.bilivideo.com, cn-hk-eq-*.bilivideo.com, *.mcdn.bilivideo.cn, *.mcdn.bilivideo.com, *.mcdn.bilivideo.net, proxy-tf-all-ws.bilivideo.com' "$plugin"

rewrite_count="$(grep -Ec '^\^https?:' "$plugin")"
if [[ "$rewrite_count" != "4" ]]; then
  echo "expected exactly 4 rewrite rules; found $rewrite_count" >&2
  exit 1
fi

if grep -E '^\^https?:.*akamaized' "$plugin"; then
  echo "Akamai must not be rewritten" >&2
  exit 1
fi

if grep -E '^\^https?:.*bstar' "$plugin"; then
  echo "BStar Akamai must not be rewritten in stable plugin" >&2
  exit 1
fi

echo "plugin validation passed"
