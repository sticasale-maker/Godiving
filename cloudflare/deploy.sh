#!/usr/bin/env bash
# Rebuild the Cloudflare preview from the repo and deploy it.
#
# The Cloudflare site serves a COPY of agenda.html, not the file GitHub Pages
# serves. Pushing to main updates GitHub Pages only. Without running this,
# the gated preview silently keeps serving whatever was deployed last — which
# is how you end up demoing a version you fixed two days ago.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .cfdeploy
mkdir -p .cfdeploy/functions .cfdeploy/public/images/branding
cp cloudflare/functions/_middleware.js .cfdeploy/functions/
cp agenda.html                          .cfdeploy/public/index.html
cp -r images/speakers images/stands     .cfdeploy/public/images/
cp images/branding/Go-Diving-Show-Logo-2024.png .cfdeploy/public/images/branding/

cd .cfdeploy
npx wrangler pages deploy public \
  --project-name=godiving-planner --branch=main --commit-dirty=true

cd ..
echo
echo "--- checks (production must be 302, preview must be 401) ---"
curl -s -o /dev/null -w "  production : %{http_code}\n" \
  "https://godiving-planner.pages.dev/?z=$RANDOM$RANDOM"
echo "  now check the new <hash> URL above returns 401, then delete superseded"
echo "  deployments:  npx wrangler pages deployment list --project-name=godiving-planner"
