# Connecting the app to GitHub (Workers Builds)

Cloudflare now creates new Git-connected projects as **Workers**, not Pages.
The dashboard's Pages path still exists but is de-emphasised, and the Workers
flow has one real advantage here: its built-in Access toggle can protect the
Worker's **production and preview URLs together**, which Pages could not — a
gap that previously left an ungated copy of this app on the open internet.

## Dashboard settings

Workers & Pages > Create > **Import a repository** > `sticasale-maker/Godiving`

| Setting                            | Value                      |
| ---------------------------------- | -------------------------- |
| Project name                       | `godiving`                 |
| Build command                      | `bash cloudflare/build.sh` |
| Deploy command                     | `npx wrangler deploy`      |
| Non-production branch deploy       | `npx wrangler versions upload` |
| Path                               | `/`                        |
| **Protect with Cloudflare Access** | **on**                     |

There is no "build output directory" field in this flow. The output is set in
`wrangler.jsonc` (`assets.directory` = `./dist`), which is why the repo needs
that file — without it `npx wrangler deploy` has nothing to deploy and the
build fails.

## Environment variables (Settings > Variables, production)

* `GATE_PASSWORD` — secret. The shared code. Kept as a fallback: it is what
  guards any hostname Access is not covering.
* `ACCESS_HOST` — the Worker's production hostname, e.g.
  `godiving.<subdomain>.workers.dev`. Set this only once Access is confirmed
  working on that hostname.

Leaving `ACCESS_HOST` unset makes the middleware demand the shared code on
every hostname, production included. That is deliberate — an unconfigured
deployment fails closed rather than open.

## Verify before sharing the link

    # production: must be 302 to cloudflareaccess.com
    curl -s -o /dev/null -w '%{http_code}\n' https://<PROD_HOST>/

    # a preview/version URL: must not serve the app
    curl -s -o /dev/null -w '%{http_code}\n' https://<PREVIEW_HOST>/

    # forged Access header against the preview: must still be refused
    curl -s -o /dev/null -w '%{http_code}\n' \
      -H 'Cf-Access-Jwt-Assertion: forged' https://<PREVIEW_HOST>/

A production 200 with no login means Access is not on that hostname. Stop and
fix it before sending anything.

## Retire the old project

Once the new Worker is verified, delete the direct-upload Pages project or it
keeps serving an unmaintained copy on its own live hostname:

    npx wrangler pages project delete godiving-planner

Then `git push` is the whole deploy, and `cloudflare/deploy.sh` is redundant.
