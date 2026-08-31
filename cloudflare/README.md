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
