/* Standalone vector QR for print.
   ────────────────────────────────────────────────────────────────
   Reads the verified module matrix in print/qr.json and emits one path, one
   rect per dark module. No bitmap anywhere, so it stays crisp at any size —
   a sticker, a table talker, or a metre-wide banner.

   Two things here are not decoration:

   QUIET ZONE. The spec requires 4 clear modules on every side. Scanners use
   it to find the symbol's edges, and a code cropped tight to its own pixels
   is the single most common reason a printed QR will not read. It is baked
   into the viewBox, so it survives being resized, placed, or exported by
   somebody who does not know it is load-bearing.

   WHITE BACKGROUND. Drawn explicitly rather than left transparent. A
   transparent QR dropped onto a dark background inverts to light-on-dark and
   most scanners refuse it.

       node tools/make-qr-svg.js                                          */
var fs = require('fs');

var QR = JSON.parse(fs.readFileSync('print/qr.json', 'utf8'));
var QUIET = 4;                                  /* modules, per the spec */
var n = QR.n, span = n + QUIET * 2;

/* sanity: a QR without three finder patterns is a rectangle of noise */
var FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
function finderAt(r0, c0) {
  for (var i = 0; i < 7; i++)
    for (var j = 0; j < 7; j++)
      if (QR.rows[r0 + i][c0 + j] !== FINDER[i][j]) return false;
  return true;
}
if (!finderAt(0, 0) || !finderAt(0, n - 7) || !finderAt(n - 7, 0)) {
  console.error('FAIL — finder patterns missing; the matrix is wrong, not the SVG');
  process.exit(1);
}

var d = '';
for (var r = 0; r < n; r++) {
  for (var c = 0; c < n; c++) {
    if (QR.rows[r][c] !== '1') continue;
    d += 'M' + (c + QUIET) + ' ' + (r + QUIET) + 'h1v1h-1z';
  }
}

var MM = 40;   /* default printed size; scale freely, the viewBox is in modules */
var svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + MM + 'mm" height="' + MM + 'mm"' +
  ' viewBox="0 0 ' + span + ' ' + span + '" shape-rendering="crispEdges">\n' +
  '  <title>' + QR.url + '</title>\n' +
  '  <desc>Sydney Dive Challenge. ' + n + 'x' + n + ' modules, ' + QUIET +
  '-module quiet zone included. Vector: safe to scale to any size.</desc>\n' +
  '  <rect width="' + span + '" height="' + span + '" fill="#ffffff"/>\n' +
  '  <path d="' + d + '" fill="#000000"/>\n' +
  '</svg>\n';

fs.writeFileSync('print/qr-arcade.svg', svg);
console.log('wrote print/qr-arcade.svg');
console.log('  encodes   ' + QR.url);
console.log('  modules   ' + n + 'x' + n + ' plus a ' + QUIET + '-module quiet zone (' + span + ' total)');
console.log('  default   ' + MM + 'x' + MM + ' mm, scales to anything');
console.log('  finders   all three verified');
