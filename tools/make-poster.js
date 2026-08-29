/* Builds the A2 promo poster as SVG.
   ────────────────────────────────────────────────────────────────
   Everything that carries meaning is vector: the type, the rules, the
   illustration and — importantly — the QR, emitted as geometry rather than a
   resampled bitmap. The only rasters are the two supplied logos, embedded as
   data URIs so the file travels as one piece, and placed small enough to stay
   above 300dpi at A2.

   A note on the splash frame: it is a 1280x720 video still. It cannot be
   vectorised — auto-tracing a photographic image produces mush — and at A2 it
   only holds up to about 140mm wide before it goes soft. The hero band here
   is therefore drawn, in the app's own palette, rather than pretending a
   video frame can fill a 420mm sheet. See print/README.md.

       node tools/make-poster.js                                          */
var fs = require('fs');

var W = 420, H = 594;                 /* A2 in mm; 1 SVG user unit = 1 mm */
var C = {
  bg: '#04161f', deep: '#06222e', accent: '#36c9c0',
  gold: '#f3c64f', text: '#eaf6fb', muted: '#9fc3d2'
};
var F = 'Helvetica Neue, Helvetica, Arial, sans-serif';

var QR = JSON.parse(fs.readFileSync('print/qr.json', 'utf8'));
function b64(p) { return fs.readFileSync(p).toString('base64'); }

/* ── QR as vector ──────────────────────────────────────────────────
   One rect per dark module, concatenated into a single path. A printed code
   is scanned from a phone at arm's length; crisp edges matter more here than
   anywhere else on the sheet. */
function qrPath(x, y, size) {
  var n = QR.n, m = size / n, d = '';
  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      if (QR.rows[r][c] !== '1') continue;
      d += 'M' + (x + c * m).toFixed(3) + ' ' + (y + r * m).toFixed(3) +
           'h' + m.toFixed(3) + 'v' + m.toFixed(3) + 'h-' + m.toFixed(3) + 'z';
    }
  }
  return d;
}

/* ── light through water, the way the app draws it ── */
function shafts() {
  var o = '';
  for (var i = 0; i < 7; i++) {
    var x = 16 + i * 62, w = 24 + (i % 3) * 11;
    o += '<path d="M' + x + ' 0 l' + w + ' 0 L' + (x + w + 58) + ' ' + H +
         ' L' + (x + 44) + ' ' + H + ' Z" fill="#bfefff" opacity="' +
         (0.028 + (i % 2) * 0.015).toFixed(3) + '"/>';
  }
  return o;
}

function bubbles() {
  var o = '', seed = 7;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (var i = 0; i < 52; i++) {
    var x = rnd() * W, y = rnd() * H, r = 0.6 + rnd() * 3.2;
    o += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(2) +
         '" fill="none" stroke="#8fd8e8" stroke-width="0.32" opacity="' +
         (0.09 + rnd() * 0.20).toFixed(2) + '"/>';
  }
  return o;
}

/* ── creatures, drawn rather than traced ── */
var seadragon =
  '<path d="M6 26 C22 8 52 3 74 11 C88 16 96 23 106 26 C96 29 88 33 76 37' +
  ' C54 46 22 43 6 26 Z"/>' +
  '<path d="M106 26 l15 -10 l-4 10 l4 10 z"/>' +
  '<path d="M30 13 l-8 -12 l13 7 z M52 8 l-5 -13 l11 9 z M73 11 l2 -13 l8 11 z"/>' +
  '<path d="M28 38 l-9 12 l14 -7 z M50 43 l-3 13 l11 -9 z"/>';

var ray =
  '<path d="M60 3 C93 3 117 19 117 33 C117 46 96 56 60 56 C24 56 3 46 3 33' +
  ' C3 19 27 3 60 3 Z"/>' +
  '<path d="M60 56 c-3 13 -4 27 -2 42 l4 0 c2 -15 1 -29 -2 -42 z"/>';

var shark =
  '<path d="M6 30 C26 12 60 7 92 13 C105 15 113 22 119 28 C113 34 105 41 92 44' +
  ' C60 50 26 47 6 30 Z"/>' +
  '<path d="M52 11 l6 -17 l15 15 z"/>' +
  '<path d="M6 30 l-13 -13 l4 13 l-4 13 z"/>';

function txt(x, y, s, fill, size, weight, extra) {
  return '<text x="' + x + '" y="' + y + '" fill="' + fill + '" font-family="' + F +
    '" font-size="' + size + '" font-weight="' + (weight || 400) +
    '" text-anchor="middle"' + (extra || '') + '>' + s + '</text>';
}

var s = [];
s.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"');
s.push('     width="' + W + 'mm" height="' + H + 'mm" viewBox="0 0 ' + W + ' ' + H + '">');
s.push('<title>Sydney Dive Challenge — A2 poster</title>');

s.push('<defs>');
s.push('<linearGradient id="sea" x1="0" y1="0" x2="0.22" y2="1">' +
  '<stop offset="0" stop-color="#0a4a63"/>' +
  '<stop offset="0.55" stop-color="' + C.deep + '"/>' +
  '<stop offset="1" stop-color="' + C.bg + '"/></linearGradient>');
s.push('<linearGradient id="cta" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#2ad3b6"/><stop offset="1" stop-color="#0f8f7c"/></linearGradient>');
s.push('<radialGradient id="vig" cx="0.5" cy="0.36" r="0.78">' +
  '<stop offset="0.55" stop-color="#000" stop-opacity="0"/>' +
  '<stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient>');
s.push('</defs>');

s.push('<rect width="' + W + '" height="' + H + '" fill="url(#sea)"/>');
s.push(shafts());
s.push(bubbles());
s.push('<rect width="' + W + '" height="' + H + '" fill="url(#vig)"/>');

/* logos — 122mm wide from a 1600px source is ~333dpi */
s.push('<image x="112" y="26" width="122" height="58" preserveAspectRatio="xMidYMid meet"' +
  ' xlink:href="data:image/png;base64,' + b64('images/branding/Go-Diving-Show-Logo-2024.png') + '"/>');
s.push('<rect x="246" y="34" width="0.7" height="42" fill="' + C.muted + '" opacity="0.45"/>');
s.push('<image x="260" y="30" width="50" height="50"' +
  ' xlink:href="data:image/png;base64,' + b64('images/branding/vizlogo.png') + '"/>');

s.push(txt(210, 132, 'FREE TO PLAY &#183; ALL AGES', C.accent, 11.5, 700, ' letter-spacing="4.6"'));
s.push(txt(210, 190, 'WIN PRIZES', C.gold, 60, 800, ' letter-spacing="1.5"'));
s.push(txt(210, 228, 'SYDNEY DIVE CHALLENGE', C.text, 26, 800, ' letter-spacing="2.1"'));
s.push('<rect x="150" y="242" width="120" height="0.9" fill="' + C.accent + '" opacity="0.85"/>');

s.push('<g fill="' + C.accent + '" opacity="0.9">');
s.push('<g transform="translate(24,268) scale(0.84)">' + seadragon + '</g>');
s.push('<g transform="translate(180,262) scale(0.60)">' + ray + '</g>');
s.push('<g transform="translate(282,274) scale(0.78)">' + shark + '</g>');
s.push('</g>');

s.push(txt(210, 360, '21 quick games about what really lives', C.text, 15.5, 500));
s.push(txt(210, 381, 'on Sydney&#8217;s reefs &#8212; and what it takes to dive them.', C.text, 15.5, 500));
s.push(txt(210, 407, 'Two minutes is enough to get on the board.', C.muted, 13.5, 400));

/* the call to action */
s.push('<rect x="30" y="428" width="360" height="120" rx="12" fill="url(#cta)"/>');
s.push(txt(146, 474, 'PLAY NOW', '#04211d', 34, 800, ' letter-spacing="1.2"'));
s.push(txt(146, 500, 'On your phone,', '#04211d', 15.5, 700));
s.push(txt(146, 519, 'or on the computers here', '#04211d', 15.5, 700));

s.push('<rect x="272" y="442" width="92" height="92" rx="7" fill="#ffffff"/>');
s.push('<path d="' + qrPath(280, 450, 76) + '" fill="#04161f" shape-rendering="crispEdges"/>');
s.push(txt(318, 543, 'SCAN TO PLAY', '#04211d', 9.5, 800, ' letter-spacing="1.6"'));

s.push('<rect x="30" y="562" width="360" height="0.7" fill="' + C.muted + '" opacity="0.3"/>');
s.push(txt(210, 578, 'Go Diving Show &#183; 5&#8211;6 September 2026 &#183; the VIZ stand',
  C.muted, 12, 600));

s.push('</svg>');

fs.writeFileSync('print/dive-challenge-A2.svg', s.join('\n'));
console.log('wrote print/dive-challenge-A2.svg (' +
  Math.round(fs.statSync('print/dive-challenge-A2.svg').size / 1024) + ' KB)');
console.log('QR: ' + QR.n + 'x' + QR.n + ' modules, vector, encodes ' + QR.url);
