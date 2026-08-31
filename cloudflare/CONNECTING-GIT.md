# Connecting the Pages project to GitHub

Cloudflare cannot convert a direct-upload project to a Git-connected one:

> "Currently, you cannot add Git integration to existing Pages applications.
> If you have already deployed your application, you need to create a new
> Pages application in order to add Git integration to it."

So `godiving-planner` stays as it is, and a **new** project is created. Leave
the old one running until the new one is verified — then delete it, or it
keeps serving an unmaintained copy on its own hostname.

## 1. Create the project (dashboard — requires the GitHub App)

Workers & Pages > **Create application** > **Pages** > **Connect to Git**.
Authorise the Cloudflare GitHub App for `sticasale-maker/Godiving` if asked.

Build settings:

| Setting                 | Value                    |
| ----------------------- | ------------------------ |
| Production branch       | `main`                   |
| Build command           | `bash cloudflare/build.sh` |
| Build output directory  | `dist`                   |
| Root directory          | `/`                      |

`functions/` at the repo root is picked up automatically — that is the gate.

## 2. Set the environment variables

Both are required, on the **Production** environment:

* `GATE_PASSWORD` — the shared code (secret). Guards the per-deployment
  preview URLs, which Access does not cover.
* `ACCESS_HOST` — the new production hostname, e.g. `godiving-plan.pages.dev`.
  Until this is set the middleware demands the code on every hostname,
  including production. That is deliberate: unset means trust nothing.

## 3. Move Cloudflare Access to the new hostname

The Access application points at `godiving-planner.pages.dev`. Edit its
destination to the new hostname, or the new site will have no Access in
front of it and only the shared code will be protecting it.

## 4. Verify before sending the link to anyone

    # production: must be 302 to cloudflareaccess.com
    curl -s -o /dev/null -w '%{http_code}\n' https://<NEW_HOST>/

    # a per-deployment URL: must be 401
    curl -s -o /dev/null -w '%{http_code}\n' https://<hash>.<project>.pages.dev/

    # forged Access header against that URL: must still be 401
    curl -s -o /dev/null -w '%{http_code}\n' \
      -H 'Cf-Access-Jwt-Assertion: forged' https://<hash>.<project>.pages.dev/

If production returns 200 without a login, `ACCESS_HOST` is set but Access is
not actually protecting that hostname. Fix that before sharing anything.

## 5. Retire the old project

    npx wrangler pages project delete godiving-planner

Once this is done, `git push` is the whole deploy: Cloudflare rebuilds from
the repo and GitHub Pages updates too, so the two copies cannot drift.
`cloudflare/deploy.sh` becomes unnecessary.
