#!/bin/sh
# Stage exactly the files the site serves, for the GitHub Pages workflow.
#
# Why this exists: Pages served the repository root, so app.py, tests/,
# requirements-dev.txt and the README were all fetchable from the public URL.
# A static host cannot be given an allowlist, so the deploy stages a directory
# with only the page's own files instead.
#
#   sh tools/stage_site.sh [outdir]     # default: _site
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-_site}

rm -rf "$out"
mkdir -p "$out/i18n" "$out/assets" "$out/docs"

# the page itself
cp "$root/index.html" "$out/"
cp "$root/.nojekyll" "$out/"
cp "$root/assets/styles.css" "$root/assets/app.js" "$out/assets/"
cp "$root"/i18n/*.js "$out/i18n/"

# the two images the markup draws, and the social card the meta tag points at
cp "$root/aol-figure.png" "$root/win-flag.png" "$out/"
cp "$root/docs/im-window.png" "$out/docs/"

# nothing else. In particular: no app.py, no tests/, no requirements files, no
# README, no security.json (the policy ships in the meta tag), no tools/.
find "$out" -type f | sed "s|$out/||" | sort