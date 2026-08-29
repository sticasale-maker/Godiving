/* Nav Trainer feasibility check.
   Holding a bearing against a current means kicking often enough to cancel
   it. Each kick adds `kick` deg/s that decays with TAU, so one kick is worth
   kick*TAU degrees, and the diver must kick f = current/(kick*TAU) times a
   second. The heading drifts between kicks by current/f — which simplifies to
   kick*TAU, i.e. the swing is the SAME whatever the current is.

   So the gate has one hard floor: it must be wider than a kick's worth of
   drift, or the leg cannot be held however well it is played. Narrowing the
   gate per leg is the main difficulty lever, which is exactly why this is
   worth checking rather than eyeballing.
       node tools/check-nav.js                                            */
var fs = require('fs');
var src = fs.readFileSync('arcade.html', 'utf8');

function num(re) {
  var m = src.match(re);
  if (!m) throw new Error('cannot read ' + re);
  return parseFloat(m[1]);
}

var TAU         = num(/[^_A-Z]TAU:([0-9.]+)/);
var COOLDOWN    = num(/[^_A-Z]COOLDOWN:([0-9]+)/);   /* not HIT_COOLDOWN */
var LEG_GATE    = num(/LEG_GATE:([0-9.]+)/);
var LEG_CURRENT = num(/LEG_CURRENT:([0-9.]+)/);

var tiers = {};
var re = /'([A-Za-z ]+)'\s*:\s*\{legs:([0-9]+),kick:([0-9.]+),gate:([0-9.]+),current:([0-9.]+),\s*secs:([0-9.]+)\}/g;
var m;
while ((m = re.exec(src))) {
  tiers[m[1]] = { legs: +m[2], kick: +m[3], gate: +m[4], current: +m[5], secs: +m[6] };
}

var names = Object.keys(tiers);
if (names.length !== 3) {
  console.log('FAIL — parsed ' + names.length + ' tiers, expected 3: ' + names.join(', '));
  process.exit(1);
}

var fail = 0;
var maxF = 1000 / COOLDOWN;
console.log('TAU ' + TAU + '  cooldown ' + COOLDOWN + 'ms  gate ramp ' +
            LEG_GATE + '  current ramp ' + LEG_CURRENT + '\n');

names.forEach(function (name) {
  var t = tiers[name];
  var swing = t.kick * TAU;           /* degrees of drift between kicks */
  var total = 0;
  for (var leg = 1; leg <= t.legs; leg++) {
    var gate = t.gate * Math.pow(LEG_GATE, leg - 1);
    var cur  = t.current * Math.pow(LEG_CURRENT, leg - 1);
    var f    = cur / swing;           /* kicks per second needed to hold */
    total += t.secs;
    var holdable = gate > swing;
    var kickable = f <= maxF * 0.5;   /* half the cooldown ceiling, for rhythm */
    if (!holdable || !kickable) fail++;
    console.log('  ' + name.padEnd(15) + ' leg ' + leg +
      ' | gate ' + gate.toFixed(1) + ' vs ' + swing.toFixed(1) + ' swing ' +
      (holdable ? 'OK  ' : 'FAIL') +
      ' | ' + f.toFixed(2) + ' kicks/s of ' + maxF.toFixed(1) + ' ' +
      (kickable ? 'OK' : 'FAIL'));
  }
  var lastGate = t.gate * Math.pow(LEG_GATE, t.legs - 1);
  var ramps = t.legs < 2 || lastGate < t.gate;
  if (!ramps) fail++;
  console.log('  ' + name.padEnd(15) + ' swim ' + total + 's total' +
              '  ·  later legs harder: ' + (ramps ? 'yes' : 'NO') + '\n');
});

console.log(fail ? ('FAIL — ' + fail + ' problem(s)') : 'ok — every leg is holdable');
process.exit(fail ? 1 : 0);
