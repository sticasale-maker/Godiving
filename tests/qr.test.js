/* QR encoder tests. No dependencies:
 *
 *   node tests/qr.test.js
 *
 * The QR is the entire booth-machine-to-phone handoff for prize
 * tickets. If it silently regresses, nobody finds out until someone
 * is standing at the stand with a phone that will not scan.
 *
 * PROVENANCE OF THE FIXTURES BELOW
 * These matrices were verified two independent ways when written:
 *   1. compared module-for-module against the Python `qrcode`
 *      reference encoder (identical wherever mask choice agreed), and
 *   2. round-tripped through `pyzbar`, a real ZBar-backed decoder —
 *      60 randomly generated ticket URLs plus a length sweep from 1
 *      to 122 bytes spanning versions 1-7, all byte-identical.
 * The hashes pin that verified output so later edits cannot drift.
 *
 * KNOWN LIMITATION: no ECI header is emitted, so per ISO 18004 the
 * default charset is ISO-8859-1 and non-ASCII content is at the mercy
 * of scanner heuristics. Irrelevant here — ticket URLs are ASCII,
 * where ISO-8859-1 and UTF-8 are byte-identical.
 */

const QR = require('../qr.js');
const crypto = require('crypto');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };
const sha = g => crypto.createHash('sha256')
  .update(g.m.map(r => r.map(v => v ? 1 : 0).join('')).join('')).digest('hex').slice(0, 16);

const TICKET = 'https://app.viz.net.au/Godiving/ticket.html?t=VIZ-7K3M';

console.log('=== VERIFIED FIXTURES ===');
[
  [TICKET,          4, 3, 33, '53030a42afb7ea16'],
  ['hello',         1, 0, 21, '99ccedcf0d82e92a'],
  ['VIZ-9QRS',      1, 0, 21, '791665d3096767ff'],
  ['x'.repeat(60),  4, 0, 33, '3b239892bb588062'],
  ['x'.repeat(122), 7, 0, 45, '39fabad74b9daeba']
].forEach(([text, v, mask, n, hash]) => {
  const g = QR.matrix(text);
  const label = text.length > 26 ? text.slice(0, 24) + '..' : text;
  ok(g.version === v && g.mask === mask && g.n === n && sha(g) === hash,
     `${JSON.stringify(label).padEnd(30)} v${g.version} mask${g.mask} ${g.n}x${g.n} ${sha(g)}`);
});

console.log('\n=== STRUCTURE (ISO 18004) ===');
const g = QR.matrix(TICKET);
ok(g.n === g.version * 4 + 17, `module count is 4v+17 (${g.n})`);

const finder = (ox, oy) => {
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
    if (g.m[oy + y][ox + x] !== (d !== 2)) return false;
  }
  return true;
};
ok(finder(0, 0) && finder(g.n - 7, 0) && finder(0, g.n - 7), 'all three finder patterns are correct');

let timing = true;
for (let i = 8; i < g.n - 8; i++) {
  if (g.m[6][i] !== (i % 2 === 0) || g.m[i][6] !== (i % 2 === 0)) timing = false;
}
ok(timing, 'horizontal and vertical timing patterns alternate');
ok(g.m[g.n - 8][8] === true, 'dark module present at (8, 4v+9)');

/* quiet zone is the renderer's job, but the matrix must not assume it */
ok(g.m.length === g.n && g.m.every(r => r.length === g.n), 'matrix is square and fully populated');

console.log('\n=== VERSION SELECTION vs the official level-M byte capacities ===');
/* ISO 18004 byte-mode capacity at error correction level M. Each entry
   must fit exactly, and one byte more must roll to the next version. */
const CAP_M = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };
Object.keys(CAP_M).forEach(k => {
  const v = Number(k), cap = CAP_M[v];
  const at = QR.matrix('x'.repeat(cap)).version;
  const over = v < 10 ? QR.matrix('x'.repeat(cap + 1)).version : null;
  ok(at === v && (over === null || over === v + 1),
     `v${String(v).padEnd(2)} holds exactly ${String(cap).padStart(3)} bytes` +
     (over === null ? ' (ceiling)' : `, ${cap + 1} rolls to v${over}`));
});
let threw = false;
try { QR.matrix('x'.repeat(214)); } catch (e) { threw = true; }
ok(threw, 'past 213 bytes it throws rather than silently truncating');

console.log('\n=== DETERMINISM ===');
ok(sha(QR.matrix(TICKET)) === sha(QR.matrix(TICKET)), 'same input produces the same matrix');

console.log('\n=== REAL TICKET CODES ===');
const AB = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
let allV4 = true, n = 0;
for (let i = 0; i < 200; i++) {
  let c = 'VIZ-';
  for (let k = 0; k < 4; k++) c += AB[Math.floor(Math.random() * AB.length)];
  const m = QR.matrix('https://app.viz.net.au/Godiving/ticket.html?t=' + c);
  if (m.version !== 4) allV4 = false;
  n++;
}
ok(allV4, `all ${n} random ticket URLs land on version 4 (33x33) — stable QR size on the end screen`);

console.log('\n' + (fail ? `*** ${fail} FAILED ***` : '*** ALL PASSED ***'));
process.exit(fail ? 1 : 0);
