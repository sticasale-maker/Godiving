# Deployment

The app is a Cloudflare Worker, built from this repo on every push to `main`
by Workers Builds. `git push` is the whole deploy — there is no second copy
to keep in step.

| Setting        | Value                      |
| -------------- | -------------------------- |
| Worker         | `godiving`                 |
| Build command  | `bash cloudflare/build.sh` |
| Deploy command | `npx wrangler deploy`      |
| Production URL | `https://godiving.sticasale.workers.dev` |

`cloudflare/build.sh` assembles `dist/` — only the planner and its images.
The repo root also holds the arcade, the simulator and two video splashes,
and serving the root would publish all of them.

## How access works

Two layers, and both earn their place:

**Cloudflare Access** protects the Worker — production *and* preview URLs —
with per-person email one-time PINs. Cloudflare strips client-supplied
`Cf-Access-Jwt-Assertion` headers at the edge, so the header cannot be
spoofed from outside on a protected hostname.

**`worker/index.js`** is a shared-code gate behind it. On the hostname named
by `ACCESS_HOST` it defers to Access, so authorised people see one login
rather than two. Anywhere else it demands `GATE_PASSWORD`. With neither
variable set it refuses every request — an unconfigured deployment fails
closed.

### Variables (Settings > Variables and Secrets)

* `GATE_PASSWORD` — **secret**. The shared fallback code.
* `ACCESS_HOST` — plain. `godiving.sticasale.workers.dev`. Set this only
  once Access is confirmed live on that hostname; setting it earlier trusts
  a protection that is not there.

## Verify after every deploy

Two separate misconfigurations have left this app fully public: a `functions/`
directory in the wrong place on Pages, and a missing `assets.run_worker_first`
here. In both cases the code was correct, the deploy reported success, and the
gate simply was not in the request path. Only an unauthenticated fetch caught
it, so run one:

    curl -s -o /dev/null -w '%{http_code}\n' https://godiving.sticasale.workers.dev/

**302** (to `cloudflareaccess.com`) is correct. **503** means the variables
are missing — closed, but misconfigured. **200 is a leak**: the gate is not
running. Check `run_worker_first` is still `true` in `wrangler.jsonc`.
