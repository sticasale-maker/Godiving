/* Draw-engine tests. Run before the show, and after any change to
   prize.js or the draw schedule:

     node tests/prize.test.js

   Exits non-zero on failure. Physical prizes depend on this logic
   being right, so it is worth 10 seconds. */

const P = require('../prize.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };
const T = (day, t) => new Date('2026-09-0' + day + 'T' + t + ':00+10:00').getTime();
const G = ['Young Explorer', 'Teen Explorer', 'Adult Explorer'];

let n = 0;
const S = (name, group, score, day, time) =>
  ({ id: 'id' + (n++), name, group, score, ts: T(day, time), code: 'VIZ-C' + n });

console.log('=== SCHEDULE ===');
const d = P.draws();
ok(d.length === 13, '13 draws across the show');
ok(d.filter(x => x.day === 1).length === 7, '7 draws on Saturday');
ok(d.filter(x => x.day === 2).length === 6, '6 draws on Sunday');
console.log('  Sat: ' + d.filter(x => x.day === 1).map(x => x.label).join(' '));
console.log('  Sun: ' + d.filter(x => x.day === 2).map(x => x.label).join(' '));

console.log('\n=== BUCKETING ===');
ok(P.drawFor(T(5, '09:31')).label === '11:00', 'Sat 09:31 -> 11:00 (doors open before first draw)');
ok(P.drawFor(T(5, '10:59')).label === '11:00', 'Sat 10:59 -> 11:00');
ok(P.drawFor(T(5, '11:01')).label === '12:00', 'Sat 11:01 -> 12:00');
ok(P.drawFor(T(5, '16:44')).label === '16:45', 'Sat 16:44 -> 16:45 (short closing draw)');
ok(P.drawFor(T(5, '16:50')) === null, 'Sat 16:50 -> null, must NOT roll into a Sunday draw');
ok(P.drawFor(T(5, '20:00')) === null, 'Sat 20:00 (after close) -> null');
ok(P.drawFor(T(6, '09:45')).label === '11:00', 'Sun 09:45 -> Sun 11:00');
ok(P.drawFor(T(6, '15:44')).label === '15:45', 'Sun 15:44 -> 15:45');
ok(P.drawFor(T(6, '15:50')) === null, 'Sun 15:50 -> null');
ok(P.drawFor(new Date('2026-09-04T12:00:00+10:00')) === null, 'day before the show -> null');
ok(P.drawFor(T(6, '11:00')).label === '11:00', 'exactly on the draw instant -> that draw');

console.log('\n=== DRAW: top 2 per age group ===');
let sc = [
  S('Ann', 'Adult Explorer', 500, 5, '10:00'),
  S('Bob', 'Adult Explorer', 400, 5, '10:10'),
  S('Cal', 'Adult Explorer', 300, 5, '10:20'),
  S('Dee', 'Young Explorer', 200, 5, '10:30')
];
let r = P.compute(sc);
let g = r.byDraw[0].groups;
ok(g['Adult Explorer'].winners.map(w => w.name).join(',') === 'Ann,Bob', 'Adult winners = Ann,Bob');
ok(g['Young Explorer'].winners.map(w => w.name).join(',') === 'Dee', 'short field awards only what it has');
ok(g['Teen Explorer'].winners.length === 0, 'an empty age group burns no stock');
ok(r.issued === 3, 'issued 3, got ' + r.issued);

console.log('\n=== TIE-BREAK ===');
sc = [S('Late', 'Adult Explorer', 300, 5, '10:20'), S('Early', 'Adult Explorer', 300, 5, '10:05')];
r = P.compute(sc, { winnersPerGroup: 1 });
ok(r.byDraw[0].groups['Adult Explorer'].winners[0].name === 'Early', 'equal scores: earlier submission wins');

console.log('\n=== CAP: one compass per player per day ===');
sc = [
  S('Keen', 'Teen Explorer', 900, 5, '10:00'),
  S('Keen', 'Teen Explorer', 890, 5, '11:30'),
  S('Other', 'Teen Explorer', 100, 5, '11:40')
];
r = P.compute(sc, { winnersPerGroup: 1 });
ok(r.byDraw[0].groups['Teen Explorer'].winners.map(x => x.name).join(',') === 'Keen', '11:00 -> Keen');
ok(r.byDraw[1].groups['Teen Explorer'].winners.map(x => x.name).join(',') === 'Other',
   '12:00 -> Other promoted over the capped Keen');
ok(r.issued === 2, 'Keen tops both boards but only takes one compass');

sc = [S('Keen', 'Teen Explorer', 900, 5, '10:00'), S('Keen', 'Teen Explorer', 900, 6, '10:00')];
r = P.compute(sc, { winnersPerGroup: 1 });
ok(r.issued === 2, 'the cap resets on day 2');

console.log('\n=== STOCK EXHAUSTION ===');
sc = [];
['10:00', '11:30', '12:30', '13:30', '14:30'].forEach((t, di) => {
  G.forEach((grp, gi) => { for (let p = 0; p < 3; p++) sc.push(S('P' + di + gi + p, grp, 500 - p, 5, t)); });
});
r = P.compute(sc, { stock: 100, reserveForInstant: 0, winnersPerGroup: 2 });
ok(r.issued === 30, 'uncapped: 5 draws x 3 groups x 2 = 30, got ' + r.issued);
r = P.compute(sc, { stock: 10, reserveForInstant: 4, winnersPerGroup: 2 });
ok(r.issued === 6, 'capped at stock - reserve = 6, got ' + r.issued);
ok(r.hourlyStock === 6, 'hourlyStock reported as 6');
const spent = r.byDraw.filter(x => Object.keys(x.groups).some(k => x.groups[k].winners.length))
                      .map(x => x.draw.label);
ok(spent.join(',') === '11:00', 'remaining stock goes to the earliest draws first, got: ' + spent.join(','));

console.log('\n=== DETERMINISM ===');
sc = [];
for (let i = 0; i < 60; i++) {
  sc.push(S('N' + (i % 17), G[i % 3], (i * 37) % 500, (i % 2) + 5,
            String(9 + (i % 7)).padStart(2, '0') + ':' + String((i * 7) % 60).padStart(2, '0')));
}
const shape = x => JSON.stringify(x.byDraw.map(dd => Object.keys(dd.groups).map(k => dd.groups[k].winners.map(w => w.id))));
const base = shape(P.compute(sc));
let stable = true;
for (let k = 0; k < 40; k++) {
  const sh = sc.slice().sort(() => Math.random() - 0.5);
  if (shape(P.compute(sh)) !== base) stable = false;
}
ok(stable, '40 shuffles of the same scores produce identical winners');

console.log('\n=== byCode lookup (what one ticket sees) ===');
sc = [S('Ann', 'Adult Explorer', 500, 5, '10:00'),
      S('Bob', 'Adult Explorer', 400, 5, '10:10'),
      S('Cal', 'Adult Explorer', 300, 5, '10:20')];
r = P.compute(sc, { winnersPerGroup: 2 });
ok(r.byCode[sc[0].code].won === true && r.byCode[sc[0].code].rank === 1, 'Ann: won, rank 1');
ok(r.byCode[sc[2].code].won === false && r.byCode[sc[2].code].rank === 3, 'Cal: lost, rank 3');
ok(r.byCode[sc[2].code].cutoff === 400, 'Cal is told the cutoff was 400');

console.log('\n=== provisional() live standing ===');
const p1 = [S('Ann', 'Adult Explorer', 500, 5, '10:00'),
            S('Bob', 'Adult Explorer', 400, 5, '10:05'),
            S('Cal', 'Adult Explorer', 300, 5, '10:10')];
let pr = P.provisional(p1, p1[2], { winnersPerGroup: 2 });
ok(pr.rank === 3 && pr.fieldSize === 3, 'Cal is 3rd of 3');
ok(pr.inWinningSlots === false, 'Cal is outside the winning slots');
ok(pr.cutoff === 400, 'Cal must beat 400 to get in');
pr = P.provisional(p1, p1[0], { winnersPerGroup: 2 });
ok(pr.inWinningSlots === true, 'Ann is inside the winning slots');
ok(pr.threatScore === 300, 'Ann is told the score chasing her');

console.log('\n=== CODE NORMALISATION (read aloud, handwritten) ===');
ok(P.normaliseCode('viz-7k3m') === 'VIZ-7K3M', 'lowercase');
ok(P.normaliseCode('7K3M') === 'VIZ-7K3M', 'bare code without prefix');
ok(P.normaliseCode('VIZ 7K3M') === 'VIZ-7K3M', 'space instead of dash');
ok(P.normaliseCode('VIZ-7K3O') === 'VIZ-7K3', 'ambiguous O stripped (never issued)');

console.log('\n=== TEST MODE (dress rehearsal) ===');
const td = P.enableTestMode(3, 8);
ok(P.isTestMode() === true, 'test mode enabled');
ok(td.length === 8, '8 synthetic draws, 3 minutes apart');
ok(P.drawFor(Date.now()) !== null, 'a score right now buckets into a test draw');
ok(P.nextDraw(Date.now()) !== null, 'nextDraw resolves in test mode');

console.log('\n' + (fail ? ('*** ' + fail + ' FAILED ***') : '*** ALL ' + '35+ CHECKS PASSED ***'));
process.exit(fail ? 1 : 0);
