# Git push / deploy workflow — Godiving

**Standing authorization:** you may commit and push to `main` without asking first. Finish the work, run any checks, push, then report what landed. Only pause if a check fails or the diff contains something not asked for.

## Repo
- Remote: `https://github.com/sticasale-maker/Godiving`, branch `main`
- Public repo, GitHub Pages enabled

## Deployment
No build step — **there is no GitHub Actions workflow in this repo.** Pushing to `main` is the deploy: GitHub Pages serves the repository content directly, unprocessed. Unlike some of my other projects, there's no auto-generated build stamp to preserve — a plain `git add` / `git commit` / `git push` of your real changes is the whole deploy.

Live site: `https://app.viz.net.au/Godiving/` — this is my GitHub Pages **user site**'s custom domain, and every repo under my account inherits it automatically at `/<repo-name>/`. No per-repo DNS, no separate hosting credentials, no FTP/rsync.

## Auth
Push auth is whatever your normal git credential setup already provides (stored credential helper / SSH key) — confirm `git push` works without an interactive prompt before relying on autonomous pushes.

## After pushing — verify it deployed
A push is not automatically a deploy confirmation. Check:
- `https://api.github.com/repos/sticasale-maker/Godiving/actions/runs` — the built-in "pages build and deployment" run's `conclusion` should be `success`
- Then confirm the live page actually shows your change: `https://app.viz.net.au/Godiving/` (cache-bust with `?cb=<random>` if needed — GitHub's Fastly CDN caches for several minutes)

## Guardrails to keep
- Never force-push
- Never edit anything under `.github/` without asking (there isn't one yet — creating one, e.g. to add a build step, should be confirmed first)
- Always show the diff before committing
