/* The show schedule lives in three places and they must agree:
     prize.js      SHOW.days[].draws   — when a prize is settled
     arcade.html   SESSION_DAYS        — when the board freezes
     attract.html  SESSION_DAYS        — the countdown on the big screen

   They disagreed once, and the failure was invisible until the worst moment:
   the session table ended at closing time (17:00 / 16:00) while the final
   draw ran a quarter of an hour earlier, so everyone who finished in the last
   fifteen minutes of each day was shown a countdown to a freeze that no draw
   would ever settle. Busiest part of the day, no prize round.

       node tools/check-schedule.js                                        */
var fs = require('fs');

function sessionTable(file) {
  var src = fs.readFileSync(file, 'utf8');
  var block = (src.match(/var SESSION_DAYS\s*=\s*\{[\s\S]*?\};/) || [])[0];
  if (!block) throw new Error(file + ': SESSION_DAYS not found');
  var out = {}, re = /'(\d{4}-\d{2}-\d{2})'\s*:\s*\[([^\]]*)\]/g, m;
  while ((m = re.exec(block))) {
    out[m[1]] = (m[2].match(/\d{2}:\d{2}/g) || []);
  }
  return out;
}

var PRIZE = require(require('path').resolve('prize.js'));
PRIZE.setRehearsal(null);

var draws = {};
PRIZE.draws().forEach(function (d) {
  /* draw times are pinned to +10:00 (AEST) */
  var local = new Date(d.at.getTime() + 10 * 3600000).toISOString();
  (draws[local.slice(0, 10)] = draws[local.slice(0, 10)] || []).push(local.slice(11, 16));
});

var files = ['arcade.html', 'attract.html'];
var fail = 0;

files.forEach(function (f) {
  var t = sessionTable(f);
  console.log(f);
  Object.keys(t).forEach(function (day) {
    var marks = t[day];
    var freezes = marks.slice(1);            /* first mark is the day's open */
    var dr = draws[day] || [];
    var missingDraw = freezes.filter(function (x) { return dr.indexOf(x) < 0; });
    var missingFreeze = dr.filter(function (x) { return freezes.indexOf(x) < 0; });
    var ok = !missingDraw.length && !missingFreeze.length;
    if (!ok) fail++;
    console.log('  ' + day + '  opens ' + marks[0] +
                '  freezes ' + freezes.join(' ') + '  ' + (ok ? 'OK' : 'MISMATCH'));
    if (missingDraw.length)
      console.log('     freeze with no draw : ' + missingDraw.join(', '));
    if (missingFreeze.length)
      console.log('     draw with no freeze : ' + missingFreeze.join(', '));
  });
});

/* the two HTML copies must also match each other */
var a = JSON.stringify(sessionTable('arcade.html'));
var b = JSON.stringify(sessionTable('attract.html'));
console.log('');
console.log('arcade and attract tables identical: ' + (a === b ? 'yes' : 'NO'));
if (a !== b) fail++;

console.log('');
console.log(fail ? ('FAIL — ' + fail + ' problem(s)')
                 : 'ok — every session freeze lands on a prize draw');
process.exit(fail ? 1 : 0);
