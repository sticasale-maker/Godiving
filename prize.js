/* ════════════════════════════════════════════════════════════════
   PRIZE.JS — hourly draw engine, shared by arcade.html and ticket.html
   ────────────────────────────────────────────────────────────────
   Go Diving Show, Sydney — 5–6 September 2026, stand 440.

   DESIGN: winners are COMPUTED, never stored.

   Every device derives the same winner list from the same scores
   table by running the same deterministic algorithm. There is no
   "draw" write, so two screens can never disagree, and a draw can
   never be half-committed. The only field ever written back is
   claimed_at, by staff, when a compass is physically handed over.

   Determinism relies on a total ordering with no ties:
     1. score        descending
     2. ts           ascending   (earlier submission beats later)
     3. id           ascending   (final tiebreak, uuid string compare)

   Load with a plain <script src="prize.js"></script> — no build step.
   ════════════════════════════════════════════════════════════════ */
var PRIZE = (function () {
  'use strict';

  /* ── Show configuration ───────────────────────────────────────
     Draw times are absolute instants pinned to UTC+10 (AEST).
     September is before NSW daylight saving starts (first Sunday
     in October), so there is no DST transition to worry about, and
     pinning the offset means a phone set to another timezone still
     computes the correct draw.

     The short final draw each day is deliberate: a draw AT closing
     time is useless because nobody can collect. 16:45 and 15:45
     leave winners 15 minutes to reach the stand.                  */
  var SHOW = {
    stand: '440',
    days: [
      { day: 1, date: '2026-09-05', open: '09:30', close: '17:00',
        draws: ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '16:45'] },
      { day: 2, date: '2026-09-06', open: '09:30', close: '16:00',
        draws: ['11:00', '12:00', '13:00', '14:00', '15:00', '15:45'] }
    ]
  };

  /* ── Prize rules (overridable from the admin console) ────────── */
  var DEFAULTS = {
    stock: 120,              /* plastic compasses purchased          */
    reserveForInstant: 45,   /* held back for Golden Compass wins     */
    winnersPerGroup: 2,      /* per age group, per draw               */
    maxPerPlayerPerDay: 1,   /* stops one keen kid taking eight       */
    claimExpiresAtClose: true
  };

  var GROUPS = ['Young Explorer', 'Teen Explorer', 'Adult Explorer'];

  /* ── Ticket codes ─────────────────────────────────────────────
     Alphabet excludes 0/O, 1/I/L — these get read aloud across a
     noisy stand and handwritten on cards, so ambiguity is costly.
     31^4 ≈ 923k, ample for a two-day show.                        */
  var ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

  function newCode() {
    var s = '';
    for (var i = 0; i < 4; i++) {
      s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    return 'VIZ-' + s;
  }

  function normaliseCode(raw) {
    if (!raw) return '';
    var t = String(raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (t.indexOf('VIZ') === 0) t = t.slice(3);
    /* forgive the ambiguous characters we deliberately never issue */
    t = t.replace(/O/g, '0').replace(/[IL]/g, '1');
    t = t.replace(/0/g, '').replace(/1/g, '');
    return t ? 'VIZ-' + t.slice(0, 4) : '';
  }

  /* ── Schedule ─────────────────────────────────────────────────── */
  function at(dateStr, timeStr) {
    return new Date(dateStr + 'T' + timeStr + ':00+10:00');
  }

  /* Test mode collapses the whole two-day schedule into draws every
     N minutes starting a minute from now, so the full flow (play →
     ticket → countdown → draw → win/lose → claim) can be rehearsed
     end to end without waiting for September. */
  var testMode = null;

  function enableTestMode(intervalMin, count) {
    var iv = intervalMin || 3, n = count || 8;
    var base = Date.now() + 60000;
    var list = [];
    for (var i = 0; i < n; i++) {
      list.push({
        day: 1,
        at: new Date(base + i * iv * 60000),
        label: 'T' + (i + 1),
        closesAt: new Date(base + (i + 1) * iv * 60000)
      });
    }
    testMode = { draws: list, openFrom: new Date(base - 60 * 60000) };
    return list;
  }

  function isTestMode() { return !!testMode; }

  /* All draws across the show, chronological. */
  function draws() {
    if (testMode) return testMode.draws.slice();
    var out = [];
    SHOW.days.forEach(function (d) {
      d.draws.forEach(function (t) {
        out.push({
          day: d.day,
          at: at(d.date, t),
          label: t,
          dayOpen: at(d.date, d.open),
          dayClose: at(d.date, d.close)
        });
      });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  /* Which show day a timestamp falls on, or null if outside the show.
     Runs from midnight so early arrivals are captured, and ends at
     the published closing time. */
  function showDayFor(t) {
    for (var i = 0; i < SHOW.days.length; i++) {
      var d = SHOW.days[i];
      if (t >= at(d.date, '00:00').getTime() && t <= at(d.date, d.close).getTime()) return d;
    }
    return null;
  }

  /* The draw a score belongs to: the first draw at or after it,
     ON THE SAME DAY. A score from 09:30 (before the first draw)
     falls into the 11:00 draw. A score after the day's final draw
     returns null — that player is told the last draw has passed and
     is covered by the Golden Compass instant-win pool instead. A
     late Saturday score must never roll into a Sunday draw; that
     player has gone home. */
  function drawFor(ts) {
    var t = ts instanceof Date ? ts.getTime() : Number(ts);
    var all = draws(), i;

    if (testMode) {
      for (i = 0; i < all.length; i++) if (t <= all[i].at.getTime()) return all[i];
      return null;
    }

    var day = showDayFor(t);
    if (!day) return null;
    for (i = 0; i < all.length; i++) {
      if (all[i].day === day.day && t <= all[i].at.getTime()) return all[i];
    }
    return null;
  }

  function nextDraw(now) {
    var t = (now instanceof Date ? now.getTime() : Number(now)) || Date.now();
    var all = draws();
    for (var i = 0; i < all.length; i++) {
      if (all[i].at.getTime() > t) return all[i];
    }
    return null;
  }

  function hasDrawn(draw, now) {
    var t = (now instanceof Date ? now.getTime() : Number(now)) || Date.now();
    return !!draw && draw.at.getTime() <= t;
  }

  /* ── Deterministic ordering ───────────────────────────────────── */
  function rank(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (a.ts !== b.ts) return a.ts - b.ts;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  }

  /* One human. Name+group rather than device, so the same kid moving
     from a booth machine to their phone is still capped. Imperfect
     with duplicate names, but staff can override at the stand. */
  function playerKey(e) {
    return String(e.name || '').trim().toLowerCase() + '|' + (e.group || '');
  }

  /* ── The draw ─────────────────────────────────────────────────
     Processes every draw in chronological order, carrying forward
     the per-day per-player cap and the remaining stock. Runners-up
     are promoted when someone above them is skipped by the cap.

     Returns:
       byCode   { CODE -> result }   result for any one ticket
       byDraw   [ { draw, groups:{ group -> {winners,board} } } ]
       issued   total compasses awarded by hourly draws
  */
  function compute(scores, cfg) {
    var c = Object.assign({}, DEFAULTS, cfg || {});
    var hourlyStock = Math.max(0, c.stock - c.reserveForInstant);

    var all = (scores || []).filter(function (e) {
      return e && typeof e.score === 'number' && e.ts;
    });

    /* bucket every score into its draw */
    var buckets = {};
    all.forEach(function (e) {
      var d = drawFor(e.ts);
      if (!d) return;
      var k = d.at.getTime();
      (buckets[k] = buckets[k] || []).push(e);
    });

    var dayWins = {};      /* day -> playerKey -> count */
    var issued = 0;
    var byCode = {};
    var byDraw = [];

    draws().forEach(function (d) {
      var pool = buckets[d.at.getTime()] || [];
      var groups = {};
      dayWins[d.day] = dayWins[d.day] || {};

      GROUPS.forEach(function (g) {
        var board = pool.filter(function (e) { return e.group === g; }).sort(rank);
        var winners = [];

        for (var i = 0; i < board.length; i++) {
          if (winners.length >= c.winnersPerGroup) break;
          if (issued >= hourlyStock) break;
          var e = board[i], key = playerKey(e);
          /* already won today — skip and promote the next player */
          if ((dayWins[d.day][key] || 0) >= c.maxPerPlayerPerDay) continue;
          dayWins[d.day][key] = (dayWins[d.day][key] || 0) + 1;
          winners.push(e);
          issued++;
        }

        groups[g] = { winners: winners, board: board };

        board.forEach(function (e, idx) {
          if (!e.code) return;
          var isWinner = winners.indexOf(e) > -1;
          byCode[e.code] = {
            entry: e,
            draw: d,
            group: g,
            rank: idx + 1,
            fieldSize: board.length,
            won: isWinner,
            /* what the player in the last winning slot scored — the
               number a non-winner has to beat next round */
            cutoff: winners.length ? winners[winners.length - 1].score : null,
            winnersPerGroup: c.winnersPerGroup
          };
        });
      });

      byDraw.push({ draw: d, groups: groups });
    });

    return {
      byCode: byCode,
      byDraw: byDraw,
      issued: issued,
      hourlyStock: hourlyStock,
      config: c
    };
  }

  /* Live standing for a ticket whose draw has not run yet. Cheaper
     than a full compute and safe to call on every realtime update. */
  function provisional(scores, entry, cfg) {
    var c = Object.assign({}, DEFAULTS, cfg || {});
    var d = drawFor(entry.ts);
    if (!d) return null;
    var board = (scores || []).filter(function (e) {
      return e.group === entry.group && e.ts && drawFor(e.ts) &&
             drawFor(e.ts).at.getTime() === d.at.getTime();
    }).sort(rank);

    var idx = -1;
    for (var i = 0; i < board.length; i++) {
      if (board[i].code === entry.code) { idx = i; break; }
    }
    var n = c.winnersPerGroup;
    return {
      draw: d,
      rank: idx < 0 ? board.length : idx + 1,
      fieldSize: board.length,
      inWinningSlots: idx > -1 && idx < n,
      winnersPerGroup: n,
      /* the score that would knock this ticket out of the prizes */
      threatScore: board.length > n ? board[n].score : null,
      cutoff: board.length >= n ? board[n - 1].score : null
    };
  }

  return {
    SHOW: SHOW,
    GROUPS: GROUPS,
    DEFAULTS: DEFAULTS,
    newCode: newCode,
    normaliseCode: normaliseCode,
    draws: draws,
    drawFor: drawFor,
    nextDraw: nextDraw,
    hasDrawn: hasDrawn,
    compute: compute,
    provisional: provisional,
    rank: rank,
    enableTestMode: enableTestMode,
    isTestMode: isTestMode
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PRIZE;
