/* ════════════════════════════════════════════════════════════════
   QR.JS — a minimal, self-contained QR encoder.

   WHY NOT A CDN: the arcade already loads supabase-js from jsdelivr,
   and on exhibition-hall wifi that is a real failure mode. The QR is
   the entire booth-machine-to-phone handoff for prize tickets, so it
   has to work with no network at all. Nothing here fetches anything.

   SCOPE: byte mode, error correction level M, versions 1-10
   (up to 213 bytes). The ticket URL is ~53 bytes and lands on
   version 4, a stable 33x33. Level M tolerates ~15% damage, which
   is the right trade-off for a phone camera pointed at a glossy
   monitor across a crowded stand.

   NO ECI HEADER is emitted, so per spec the default charset is
   ISO-8859-1 and non-ASCII content depends on scanner heuristics.
   Irrelevant for ticket URLs, which are pure ASCII.

   Implements ISO/IEC 18004. Verified module-for-module against an
   independent reference encoder, and round-tripped through a real
   decoder — see tests/qr.test.js.
   ════════════════════════════════════════════════════════════════ */
var QRCode = (function () {
  'use strict';

  /* ── GF(256), primitive polynomial 0x11D ────────────────────── */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function rsGenerator(degree) {
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var ng = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= g[j] ? EXP[(LOG[g[j]] + i) % 255] : 0;
      }
      g = ng;
    }
    return g;
  }

  function rsRemainder(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var rem = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      rem.shift(); rem.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) {
          rem[j] ^= EXP[(LOG[factor] + LOG[gen[j + 1]]) % 255];
        }
      }
    }
    return rem;
  }

  /* ── Level M block structure, versions 1-10 ──────────────────
     [ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data] */
  var ECB_M = {
    1:  [10, 1, 16, 0, 0],
    2:  [16, 1, 28, 0, 0],
    3:  [26, 1, 44, 0, 0],
    4:  [18, 2, 32, 0, 0],
    5:  [24, 2, 43, 0, 0],
    6:  [16, 4, 27, 0, 0],
    7:  [18, 4, 31, 0, 0],
    8:  [22, 2, 38, 2, 39],
    9:  [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44]
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  var FORMAT_BITS_M = 0;   /* L=1, M=0, Q=3, H=2 */

  function dataCapacity(v) {
    var e = ECB_M[v];
    return e[1] * e[2] + e[3] * e[4];
  }

  function toBytes(str) {
    /* UTF-8; ticket URLs are ASCII but this keeps it honest */
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c < 0xD800 || c >= 0xE000) { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
      else {
        i++;
        c = 0x10000 + (((c & 0x3FF) << 10) | (str.charCodeAt(i) & 0x3FF));
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  /* ── bit stream -> codewords ─────────────────────────────────── */
  function encodeData(bytes, version) {
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }

    push(0x4, 4);                                  /* byte mode */
    push(bytes.length, version <= 9 ? 8 : 16);     /* char count */
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var cap = dataCapacity(version) * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);   /* terminator */
    while (bits.length % 8 !== 0) bits.push(0);                      /* byte align */

    var cw = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      cw.push(v);
    }
    var pad = [0xEC, 0x11], p = 0;
    while (cw.length < dataCapacity(version)) cw.push(pad[p++ % 2]);
    return cw;
  }

  /* ── split into blocks, add ECC, interleave ──────────────────── */
  function buildCodewords(dataCw, version) {
    var e = ECB_M[version], ecLen = e[0];
    var blocks = [], ecBlocks = [], off = 0, i, j;

    for (i = 0; i < e[1]; i++) { blocks.push(dataCw.slice(off, off + e[2])); off += e[2]; }
    for (i = 0; i < e[3]; i++) { blocks.push(dataCw.slice(off, off + e[4])); off += e[4]; }
    for (i = 0; i < blocks.length; i++) ecBlocks.push(rsRemainder(blocks[i], ecLen));

    var out = [], maxData = Math.max(e[2], e[4]);
    for (i = 0; i < maxData; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
    }
    for (i = 0; i < ecLen; i++) {
      for (j = 0; j < ecBlocks.length; j++) out.push(ecBlocks[j][i]);
    }
    return out;
  }

  /* ── matrix construction ─────────────────────────────────────── */
  function makeMatrix(version) {
    var n = version * 4 + 17;
    var m = [], fn = [], i;
    for (i = 0; i < n; i++) { m.push(new Array(n).fill(false)); fn.push(new Array(n).fill(false)); }
    return { n: n, m: m, fn: fn };
  }

  function setFn(g, x, y, dark) { g.m[y][x] = dark; g.fn[y][x] = true; }

  function drawFinder(g, cx, cy) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < g.n && y >= 0 && y < g.n) setFn(g, x, y, d !== 2 && d !== 4);
      }
    }
  }

  function drawFunction(g, version) {
    var n = g.n, i, j;
    /* timing */
    for (i = 0; i < n; i++) { setFn(g, 6, i, i % 2 === 0); setFn(g, i, 6, i % 2 === 0); }
    /* finders + separators */
    drawFinder(g, 3, 3); drawFinder(g, n - 4, 3); drawFinder(g, 3, n - 4);
    /* alignment */
    var a = ALIGN[version];
    for (i = 0; i < a.length; i++) {
      for (j = 0; j < a.length; j++) {
        /* skip the three that would sit on a finder */
        if ((i === 0 && j === 0) || (i === 0 && j === a.length - 1) || (i === a.length - 1 && j === 0)) continue;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            setFn(g, a[i] + dx, a[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
    /* reserve format areas (values written later) */
    for (i = 0; i <= 8; i++) { if (i !== 6) { setFn(g, 8, i, false); setFn(g, i, 8, false); } }
    for (i = 0; i < 8; i++) { setFn(g, 8, n - 1 - i, false); setFn(g, n - 1 - i, 8, false); }
    setFn(g, 8, n - 8, true);   /* dark module */

    /* version info, v7+ */
    if (version >= 7) {
      var rem = version;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var bits = (version << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bit = ((bits >>> i) & 1) === 1;
        var p = n - 11 + i % 3, q = Math.floor(i / 3);
        setFn(g, p, q, bit); setFn(g, q, p, bit);
      }
    }
  }

  function drawFormat(g, mask) {
    var data = (FORMAT_BITS_M << 3) | mask, rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var bit = function (k) { return ((bits >>> k) & 1) === 1; };
    var n = g.n;
    for (i = 0; i <= 5; i++) setFn(g, 8, i, bit(i));
    setFn(g, 8, 7, bit(6)); setFn(g, 8, 8, bit(7)); setFn(g, 7, 8, bit(8));
    for (i = 9; i < 15; i++) setFn(g, 14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) setFn(g, n - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) setFn(g, 8, n - 15 + i, bit(i));
    setFn(g, 8, n - 8, true);
  }

  function drawData(g, cw) {
    var n = g.n, i = 0;
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                       /* skip vertical timing */
      for (var vert = 0; vert < n; vert++) {
        for (var k = 0; k < 2; k++) {
          var x = right - k;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? n - 1 - vert : vert;
          if (!g.fn[y][x] && i < cw.length * 8) {
            g.m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  function maskFn(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
    return false;
  }

  function applyMask(g, mask) {
    for (var y = 0; y < g.n; y++) {
      for (var x = 0; x < g.n; x++) {
        if (!g.fn[y][x] && maskFn(mask, x, y)) g.m[y][x] = !g.m[y][x];
      }
    }
  }

  /* ── penalty scoring, ISO 18004 §8.8.2 ───────────────────────── */
  function penalty(g) {
    var n = g.n, m = g.m, score = 0, x, y, i;

    /* rule 1: runs of 5+ */
    function runs(get) {
      var s = 0;
      for (var a = 0; a < n; a++) {
        var run = 1;
        for (var b = 1; b < n; b++) {
          if (get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) s += 3 + (run - 5); run = 1; }
        }
        if (run >= 5) s += 3 + (run - 5);
      }
      return s;
    }
    score += runs(function (r, c) { return m[r][c]; });
    score += runs(function (c, r) { return m[r][c]; });

    /* rule 2: 2x2 blocks */
    for (y = 0; y < n - 1; y++) {
      for (x = 0; x < n - 1; x++) {
        var v = m[y][x];
        if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
      }
    }

    /* rule 3: finder-like patterns */
    var P1 = [true, false, true, true, true, false, true, false, false, false, false];
    var P2 = [false, false, false, false, true, false, true, true, true, false, true];
    function match(arr, pat) {
      for (var k = 0; k < pat.length; k++) if (arr[k] !== pat[k]) return false;
      return true;
    }
    for (y = 0; y < n; y++) {
      for (x = 0; x <= n - 11; x++) {
        var row = [], col = [];
        for (i = 0; i < 11; i++) { row.push(m[y][x + i]); col.push(m[x + i][y]); }
        if (match(row, P1) || match(row, P2)) score += 40;
        if (match(col, P1) || match(col, P2)) score += 40;
      }
    }

    /* rule 4: dark/light balance */
    var dark = 0;
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (m[y][x]) dark++;
    var pct = dark * 100 / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ── public ──────────────────────────────────────────────────── */
  function matrix(text) {
    var bytes = toBytes(text), version = 0;
    for (var v = 1; v <= 10; v++) {
      var header = 4 + (v <= 9 ? 8 : 16);
      if (bytes.length * 8 + header <= dataCapacity(v) * 8) { version = v; break; }
    }
    if (!version) throw new Error('QR: content too long (max 213 bytes at level M, version 10)');

    var cw = buildCodewords(encodeData(bytes, version), version);

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var g = makeMatrix(version);
      drawFunction(g, version);
      drawData(g, cw);
      drawFormat(g, mask);
      applyMask(g, mask);
      var s = penalty(g);
      if (s < bestScore) { bestScore = s; best = g; best.mask = mask; }
    }
    best.version = version;
    return best;
  }

  function canvas(text, opts) {
    opts = opts || {};
    var g = matrix(text);
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var total = g.n + quiet * 2;
    var size = opts.size || 150;
    var scale = Math.max(1, Math.floor(size / total));
    var c = document.createElement('canvas');
    c.width = c.height = total * scale;
    c.style.width = c.style.height = size + 'px';
    var ctx = c.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = opts.dark || '#000000';
    for (var y = 0; y < g.n; y++) {
      for (var x = 0; x < g.n; x++) {
        if (g.m[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    return c;
  }

  return { matrix: matrix, canvas: canvas };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QRCode;
