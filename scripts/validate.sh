#!/usr/bin/env bash
set -euo pipefail

plugin="Bilibili-US-Accelerator.plugin"

test -f "$plugin"
grep -Eq '^#!version = [0-9]+\.[0-9]+\.[0-9]+$' "$plugin"
grep -Fq 'force-http-engine-hosts = *:80, *:4480, *:4483, *:8000, *:8082, *:9102' "$plugin"
grep -Fq 'header http://upos-sz-mirrorali.bilivideo.com' "$plugin"
grep -Fq 'header https://upos-sz-mirrorali.bilivideo.com' "$plugin"
grep -Fq 'upos-bstar[0-9]*-mirrorakam\.akamaized\.net' "$plugin"
grep -Fq 'hostname = upos-sz-mirror*.bilivideo.com, upos-tf-all-*.bilivideo.com, cn-hk-eq-*.bilivideo.com, upos-bstar*-mirrorakam.akamaized.net' "$plugin"

rewrite_count="$(grep -Ec '^\^https?:' "$plugin")"
if [[ "$rewrite_count" != "4" ]]; then
  echo "expected exactly 4 rewrite rules; found $rewrite_count" >&2
  exit 1
fi

# 测试分支只允许改写 BStar Akamai，禁止改写 hz 等其它 akamaized。
if grep -E '^\^https?:.*upos-hz.*akamaized' "$plugin"; then
  echo "non-BStar Akamai (hz) must not be rewritten on this test branch" >&2
  exit 1
fi

echo "plugin validation passed"
