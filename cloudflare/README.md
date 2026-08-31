# Cloudflare Pages deployment (gated preview)

The gated preview at `https://godiving-planner.pages.dev` is built from this
repo but deployed separately, because GitHub Pages cannot gate access and
cannot serve from a private repo on a free plan.

## Layout

Wrangler compiles Functions from a `functions/` directory that sits *beside*
the assets directory, not inside it. Putting `functions/` inside the assets
folder uploads the middleware as a static file and the gate silently does
nothing — the site serves to everyone and looks fine.

    .cfdeploy/
      functions/_middleware.js   <- this file, copied from cloudflare/
      public/index.html          <- agenda.html
      public/images/...

## Deploy

    rm -rf .cfdeploy
    mkdir -p .cfdeploy/functions .cfdeploy/public/images/branding
    cp cloudflare/functions/_middleware.js .cfdeploy/functions/
    cp agenda.html .cfdeploy/public/index.html
    cp -r images/speakers images/stands .cfdeploy/public/images/
    cp images/branding/Go-Diving-Show-Logo-2024.png .cfdeploy/public/images/branding/
    cd .cfdeploy && npx wrangler pages deploy public \
      --project-name=godiving-planner --branch=main --commit-dirty=true

## The access code

Held as the `GATE_PASSWORD` secret on the Pages project, never in this repo.
To rotate it:

    npx wrangler pages secret put GATE_PASSWORD --project-name=godiving-planner

Rotating invalidates every existing session cookie immediately, which is how
you revoke access when an evaluation ends.

## Verifying the gate after any deploy

Always check that an unauthenticated request is refused, including assets:

    curl -s -o /dev/null -w '%{http_code}\n' https://godiving-planner.pages.dev/
    curl -s -o /dev/null -w '%{http_code}\n' https://godiving-planner.pages.dev/images/speakers/pete-mesley.jpg

Both must return 401. A 200 means the Functions bundle did not compile and
the site is public.

## Two layers, and why both exist

Cloudflare Access protects the **production hostname only**
(`godiving-planner.pages.dev`). Every deploy also mints a per-deployment URL
like `<hash>.godiving-planner.pages.dev`, and **Access does not cover those**.
One such URL served the entire app to the open internet until it was found
and deleted, so this is not theoretical.

The middleware therefore:

* trusts Access on the production hostname (unauthenticated requests never
  reach the Worker there — the edge redirects them first), so organisers see
  one login, not two;
* requires the shared code on every other hostname, which is what keeps the
  per-deployment URLs closed.

The hostname check is load-bearing. `Cf-Access-Jwt-Assertion` can be sent by
anyone on a hostname Access is *not* protecting, so it may only be trusted on
the one hostname where Access is. It also fails safe: remove the Access
application and production falls back to the code gate rather than opening.

## After every deploy, check all three

    # production: must be 302 to cloudflareaccess.com
    curl -s -o /dev/null -w '%{http_code}\n' https://godiving-planner.pages.dev/

    # the new per-deployment URL: must be 401
    curl -s -o /dev/null -w '%{http_code}\n' https://<hash>.godiving-planner.pages.dev/

    # a forged Access header on that URL: must still be 401
    curl -s -o /dev/null -w '%{http_code}\n' \
      -H 'Cf-Access-Jwt-Assertion: forged' https://<hash>.godiving-planner.pages.dev/

Then delete superseded deployments — each one keeps its URL alive forever:

    npx wrangler pages deployment list --project-name=godiving-planner
    npx wrangler pages deployment delete <id> --project-name=godiving-planner --force
