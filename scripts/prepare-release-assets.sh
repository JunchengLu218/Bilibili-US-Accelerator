#!/usr/bin/env bash
set -euo pipefail

# Build immutable GitHub Release assets. The canonical repository plugins use
# /main/ URLs so Raw installs follow future updates. Release downloads should
# instead load JavaScript and icons from the version tag that created them.

release_ref="${1:-}"
output_dir="${2:-dist}"
repo_slug="${GITHUB_REPOSITORY:-JunchengLu218/Bilibili-US-Accelerator}"
stable_plugin="Bilibili-US-Accelerator.plugin"
automatic_plugin="Bilibili-US-Auto-Accelerator.plugin"

if [[ ! "$release_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <vMAJOR.MINOR.PATCH> [output-directory]" >&2
  exit 2
fi

if [[ ! "$repo_slug" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "invalid GitHub owner/repository: $repo_slug" >&2
  exit 2
fi

stable_version="$(sed -n 's/^#!version = //p' "$stable_plugin")"
if [[ "$release_ref" != "v${stable_version}" ]]; then
  echo "release tag ${release_ref} does not match stable plugin v${stable_version}" >&2
  exit 1
fi

mkdir -p "$output_dir"

for source_plugin in "$stable_plugin" "$automatic_plugin"; do
  destination_plugin="${output_dir}/${source_plugin}"
  sed \
    -e "s#https://raw.githubusercontent.com/${repo_slug}/main/scripts/#https://raw.githubusercontent.com/${repo_slug}/${release_ref}/scripts/#g" \
    -e "s#https://raw.githubusercontent.com/${repo_slug}/main/assets/#https://raw.githubusercontent.com/${repo_slug}/${release_ref}/assets/#g" \
    "$source_plugin" > "$destination_plugin"

  if grep -Fq "https://raw.githubusercontent.com/${repo_slug}/main/" "$destination_plugin"; then
    echo "release asset still contains a mutable main-branch URL: $destination_plugin" >&2
    exit 1
  fi

  grep -Fq "https://raw.githubusercontent.com/${repo_slug}/${release_ref}/scripts/bilibili-auto-cdn.js" "$destination_plugin"
  grep -Fq "https://raw.githubusercontent.com/${repo_slug}/${release_ref}/assets/" "$destination_plugin"
done

echo "prepared stable and experimental release assets in $output_dir for $release_ref"
