/* Neutral (tunnel) feasibility check.

   Two budgets govern this game and the file says so in a comment. Both move
   when SPEEDS changes, which is why this exists rather than eyeballing it:

   REACH    the diver must out-descend the steepest part of the tunnel.
            Sink speed is fixed in px/s; the centreline's slope depends on
            how fast the cave scrolls past. nuRoamH() already caps the wander
            so REACH_MIN always holds — this checks the cap is doing that and
            reports the margin.
   ON-SCREEN the rock has to stay in frame:
            0.5 - roam - OPEN/2*(1 + PINCH/2) > 0

       node tools/check-neutral.js                                        */
var fs = require('fs');
var src = fs.readFileSync('arcade.html', 'utf8');

function num(re) {
  var m = src.match(re);
  if (!m) throw new Error('cannot read ' + re);
  return parseFloat(m[1]);
}
var NU = {
  LUNG_MIN: num(/LUNG_MIN:(-?[0-9.]+)/), LUNG_MAX: num(/LUNG_MAX:([0-9.]+)/),
  DRAG: num(/DRAG:([0-9.]+)/),           G: num(/[^A-Z]G:([0-9.]+)/),
  PXM: num(/PXM:([0-9]+)/),
  ROAM1: num(/ROAM1:([0-9.]+)/),         L1: num(/L1:([0-9]+)/),
  ROAM2: num(/ROAM2:([0-9.]+)/),         L2: num(/L2:([0-9]+)/),
  ROAM_H: num(/ROAM_H:([0-9]+)/),        REACH_MIN: num(/REACH_MIN:([0-9.]+)/),
  CHIRP: num(/CHIRP:([0-9.]+)/),
  PINCH: num(/PINCH:([0-9.]+)/),         SECS: num(/SECS:([0-9]+)/)
};
var speeds = {}, open = {}, m;
var reSp = /'([A-Za-z ]+)':([0-9]+)(?=[,}]|$)/g;
var spBlock = src.match(/SPEEDS:\{([^}]*)\}/);
if (!spBlock) throw new Error('cannot read SPEEDS');
while ((m = reSp.exec(spBlock[1]))) speeds[m[1]] = +m[2];
var opBlock = src.match(/OPEN:\{([^}]*)\}/);
if (!opBlock) throw new Error('cannot read OPEN');
var reOp = /'([A-Za-z ]+)':([0-9.]+)/g;
while ((m = reOp.exec(opBlock[1]))) open[m[1]] = +m[2];

var sink = Math.sqrt(Math.abs(NU.LUNG_MIN * 1.03) * NU.G / NU.DRAG) * NU.PXM;
/* The cave chirps: waves arrive (1+CHIRP)x as often at the exit as at the
   mouth, so the steepest slope is at the end. Budget against that, not the
   average, or the last third can be unsurvivable while this still reads OK. */
var perPx = (NU.ROAM1 * 6.283 / NU.L1 + NU.ROAM2 * 6.283 / NU.L2) * (1 + NU.CHIRP);
var fail = 0;
if (NU.G < 9 || NU.G > 10) { console.log('FAIL - gravity parsed as ' + NU.G); process.exit(1); }
var names = Object.keys(speeds);
if (names.length !== 3 || Object.keys(open).length !== 3) {
  console.log('FAIL — parsed ' + names.length + ' speeds and ' +
              Object.keys(open).length + ' openings, expected 3 of each');
  process.exit(1);
}
console.log('parsed: ' + names.map(function (g) {
  return g.split(' ')[0] + ' sp=' + speeds[g] + ' open=' + open[g];
}).join('  '));
console.log('constants: LUNG_MIN=' + NU.LUNG_MIN + ' DRAG=' + NU.DRAG +
            ' G=' + NU.G + ' PXM=' + NU.PXM + ' SECS=' + NU.SECS);

console.log('sink ' + sink.toFixed(1) + ' px/s   reach floor ' + NU.REACH_MIN + '\n');
Object.keys(speeds).forEach(function (g) {
  var sp = speeds[g];
  [330, 560, 900].forEach(function (h) {
    var roamH = Math.min(h, NU.ROAM_H, (sink / sp) / NU.REACH_MIN / perPx);
    var a1 = roamH * NU.ROAM1, a2 = roamH * NU.ROAM2;
    /* worst case: the exit, where the frequency has wound all the way up */
    var slope = (a1 * 6.283 / NU.L1 + a2 * 6.283 / NU.L2) * (1 + NU.CHIRP);
    var reach = (sink / sp) / slope;
    var margin = 0.5 - (roamH / h) * (NU.ROAM1 + NU.ROAM2)
                     - open[g] / 2 * (1 + NU.PINCH / 2);
    var okReach = reach >= NU.REACH_MIN - 1e-9, okScreen = margin > 0;
    if (!okReach || !okScreen) fail++;
    console.log('  ' + g.split(' ')[0].padEnd(6) + ' sp=' + String(sp).padStart(3) +
      ' h=' + String(h).padStart(3) +
      ' | reach ' + reach.toFixed(2) + ' ' + (okReach ? 'OK  ' : 'FAIL') +
      ' | on-screen margin ' + margin.toFixed(3) + ' ' + (okScreen ? 'OK' : 'FAIL'));
  });
  console.log('  ' + g.split(' ')[0].padEnd(6) + ' course ' + Math.round(sp * NU.SECS) +
              'px over ' + NU.SECS + 's\n');
});
console.log(fail ? ('FAIL — ' + fail + ' case(s)') : 'ok — reach and framing hold at every size');
process.exit(fail ? 1 : 0);
