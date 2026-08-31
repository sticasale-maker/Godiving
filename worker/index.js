/* Access gate, as a Worker.
 *
 * Cloudflare now creates new projects as Workers rather than Pages, so the
 * same logic runs here and serves static files through the ASSETS binding
 * instead of calling next().
 *
 * Runs at Cloudflare's edge before any file is served, so an unauthorised
 * request never receives the app — not the HTML, not the images, not the
 * data inside it. This is the part a client-side password check could
 * never do: there, the file has already been delivered before the check
 * runs.
 *
 * The password lives in the GATE_PASSWORD environment secret, never in
 * anything the browser receives. The cookie holds a hash of it, so the
 * password itself is not sitting in the visitor's browser either.
 */

const COOKIE = 'gds_gate';

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Compare in constant time. Overkill for a demo gate, but a length-varying
   early return is the kind of thing that is embarrassing to leave in. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function loginPage(msg) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>GO Diving Show planner — access</title>
<style>
:root{--bg:#00172f;--surface:#073157;--line:rgba(255,255,255,.16);--text:#eaf3fb;
  --muted:#9db8d2;--accent:#16a085}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
  background:var(--bg);color:var(--text);padding:24px;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.box{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);
  border-radius:16px;padding:24px 20px}
h1{font-size:20px;margin:0 0 8px}
p{color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 18px}
input{width:100%;padding:14px;border-radius:12px;border:1px solid var(--line);
  background:#052a4d;color:var(--text);font-size:16px;font-family:inherit}
button{width:100%;margin-top:10px;padding:15px;border:0;border-radius:12px;font-size:16px;
  font-weight:800;font-family:inherit;cursor:pointer;color:#04211d;
  background:linear-gradient(180deg,#1abc9c,#0e7f6a)}
.err{color:#ff9f9f;font-size:13.5px;margin:0 0 12px}
.foot{color:var(--muted);font-size:11.5px;line-height:1.6;margin:18px 0 0;text-align:center}
</style></head><body>
<div class="box">
  <h1>GO Diving Show planner</h1>
  <p>This is a private preview. Enter the access code you were given.</p>
  ${msg ? `<p class="err">${msg}</p>` : ''}
  <form method="POST">
    <input type="password" name="code" placeholder="Access code" autofocus
           autocomplete="current-password" aria-label="Access code">
    <button type="submit">Open the planner</button>
  </form>
  <p class="foot">&copy; 2026 VIZ — Sydney Diving Visibility Reports.<br>
  Supplied for evaluation only. Not licensed for redistribution or reuse.</p>
</div></body></html>`;
}

/* Cloudflare Access protects the production hostname only. Every wrangler
 * deploy also mints a per-deployment URL like <hash>.godiving-planner.pages.dev,
 * and Access does not cover those — one of them served the whole app to the
 * open internet until it was deleted.
 *
 * So: on the production hostname, trust Access (unauthenticated requests
 * never reach this code — the edge redirects them first). Everywhere else,
 * fall back to the shared code. The hostname check matters: the Access
 * header can be forged by anyone on a hostname Access is NOT protecting, so
 * it may only be trusted on the one hostname where Access is.
 *
 * This also fails safe. If the Access application is ever removed, the
 * production hostname stops presenting the header and falls back to the
 * code gate rather than opening to everyone.
 */
/* Which hostname Cloudflare Access protects, set as a Pages environment
 * variable so it survives the project being recreated with a new
 * *.pages.dev name. Unset means trust nothing and demand the code
 * everywhere, which is the safe default for a fresh deployment. */
function accessHost(env) { return (env && env.ACCESS_HOST) || ''; }

async function gate(request, env) {
  const secret = env.GATE_PASSWORD;

  const url = new URL(request.url);
  const host = accessHost(env);
  if (host && url.hostname === host) {
    const cookies0 = request.headers.get('Cookie') || '';
    const viaAccess = request.headers.get('Cf-Access-Jwt-Assertion') ||
                      /(?:^|;\s*)CF_Authorization=/.test(cookies0);
    if (viaAccess) return env.ASSETS.fetch(request);
  }

  // Fail closed. A missing secret must lock the site, never open it.
  if (!secret) {
    return new Response('Gate not configured.', {
      status: 503,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    });
  }

  const expected = await sha256(secret);
  const cookies = request.headers.get('Cookie') || '';
  const m = cookies.match(/(?:^|;\s*)gds_gate=([a-f0-9]{64})/);
  if (m && same(m[1], expected)) return env.ASSETS.fetch(request);

  if (request.method === 'POST') {
    const form = await request.formData();
    const given = String(form.get('code') || '');
    if (same(await sha256(given), expected)) {
      return new Response(null, {
        status: 303,
        headers: {
          'Location': new URL(request.url).pathname,
          'Set-Cookie': `${COOKIE}=${expected}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return new Response(loginPage('That code was not recognised.'), {
      status: 401,
      headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return new Response(loginPage(''), {
    status: 401,
    headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    return gate(request, env);
  },
};
