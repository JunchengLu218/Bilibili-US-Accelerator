#!/usr/bin/env bash
set -euo pipefail

# Generate a temporary plugin whose six remote script URLs point to a GitHub
# test branch instead of main. This lets an iPhone download exactly the code in
# that branch without changing the canonical production plugin.

source_plugin="Bilibili-US-Auto-Accelerator.plugin"
git_ref="${1:-}"
output_plugin="${2:-Bilibili-US-Auto-Accelerator.test.plugin}"
repo_root="$(pwd -P)"

# The canonical repository name is explicit because an old local `origin` may
# survive a GitHub repository rename. Fork maintainers can override it with the
# same GITHUB_REPOSITORY=owner/repo variable used by GitHub Actions.
repo_slug="${GITHUB_REPOSITORY:-JunchengLu218/Bilibili-US-Accelerator}"

if [[ ! "$repo_slug" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "invalid GitHub owner/repository: $repo_slug" >&2
  exit 2
fi

if [[ -z "$git_ref" ]]; then
  echo "usage: $0 <github-branch> [output.plugin]" >&2
  echo "example: $0 codex/loon-3.5.0-test" >&2
  exit 2
fi

# The ref becomes part of a URL. Keep it to Git's normal, human-readable branch
# characters and reject path traversal or ambiguous leading/trailing slashes.
if [[ ! "$git_ref" =~ ^[A-Za-z0-9._/-]+$ ]] ||
   [[ "$git_ref" == /* ]] ||
   [[ "$git_ref" == */ ]] ||
   [[ "$git_ref" == *..* ]]; then
  echo "invalid GitHub branch name: $git_ref" >&2
  exit 2
fi

if [[ "$output_plugin" == "$source_plugin" ]]; then
  echo "refusing to overwrite the canonical plugin; choose a test output name" >&2
  exit 2
fi

test -f "$source_plugin"

# A fresh query value gives Loon a new script URL whenever this file is built,
# which reduces the chance of an older remote script remaining in its cache.
cache_buster="$(date -u +%Y%m%d%H%M%S)"
test_script_url="https://raw.githubusercontent.com/${repo_slug}/${git_ref}/scripts/bilibili-auto-cdn.js?test=${cache_buster}"
test_icon_path="assets/variants/bilibili-black-pink.png"
test_icon_url="https://raw.githubusercontent.com/${repo_slug}/${git_ref}/${test_icon_path}?test=${cache_buster}"

sed \
  -e "s#https://raw.githubusercontent.com/[^/]*/[^/]*/main/scripts/bilibili-auto-cdn\.js#${test_script_url}#g" \
  -e "s#https://raw.githubusercontent.com/[^/]*/[^/]*/main/assets/variants/bilibili-black-pink\.png#${test_icon_url}#g" \
  -e "s/^#!name = Bilibili US Auto Accelerator (Experimental)$/#!name = Bilibili US Auto Accelerator (Automatic 8 Test)/" \
  "$source_plugin" > "$output_plugin"

expected_urls=6
actual_urls="$(grep -Fc "/${git_ref}/scripts/bilibili-auto-cdn.js?test=${cache_buster}" "$output_plugin")"
if [[ "$actual_urls" != "$expected_urls" ]]; then
  echo "expected $expected_urls branch script URLs; generated $actual_urls" >&2
  exit 1
fi

if grep -Fq '/main/scripts/bilibili-auto-cdn.js' "$output_plugin"; then
  echo "generated plugin still contains a main-branch script URL" >&2
  exit 1
fi

if ! grep -Fq "/${git_ref}/${test_icon_path}?test=${cache_buster}" "$output_plugin"; then
  echo "generated plugin does not contain the test-branch icon URL" >&2
  exit 1
fi

if grep -Fq '/main/assets/variants/bilibili-black-pink.png' "$output_plugin"; then
  echo "generated plugin still contains a main-branch icon URL" >&2
  exit 1
fi

echo "prepared $output_plugin for branch $git_ref"

# Only files inside this repository can be fetched from its raw GitHub URL.
if [[ "$output_plugin" == /* ]]; then
  if [[ "$output_plugin" == "$repo_root"/* ]]; then
    output_url_path="${output_plugin#"$repo_root"/}"
  else
    output_url_path=""
  fi
else
  output_url_path="${output_plugin#./}"
fi

if [[ -n "$output_url_path" ]]; then
  echo "after committing and pushing it, add this URL in Loon:"
  echo "https://raw.githubusercontent.com/${repo_slug}/${git_ref}/${output_url_path}"
else
  echo "the output is outside this repository, so it has no GitHub import URL"
fi
