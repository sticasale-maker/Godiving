#!/usr/bin/env bash
# Assemble the publishable site into dist/.
#
# The repo root holds several unrelated apps (arcade, simulator, video
# splashes). Serving the root would publish all of them, so the build picks
# out only what the planner needs.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/images/branding
cp agenda.html                                   dist/index.html
cp -r images/speakers images/stands              dist/images/
cp images/branding/Go-Diving-Show-Logo-2024.png  dist/images/branding/

echo "built dist/ ($(find dist -type f | wc -l) files, $(du -sh dist | cut -f1))"
