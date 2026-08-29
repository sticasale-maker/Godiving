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
    /* There is no stock figure. There used to be: 120 compasses with 45 held
       back, which capped the hourly draw at 75 and then silently stopped
       naming winners — a player who came first was told they had not won,
       with nothing on any screen explaining why. Nobody had a real number to
       put in it, so the cap was guesswork enforced as fact.

       Supply is controlled by winnersPerGroup instead, which staff already
       dial down when the box runs low, applies from the next draw, and is
       visible on every screen as "only the first N qualify". */
    /* Must stay in step with PODIUM in arcade.html and rank.html. Those
       two screens tell a player "the top N win"; this is the number that
       actually decides it. When they disagreed at 3 and 2, someone
       finishing third was congratulated by the booth machine and told
       they had lost by the phone in their hand. */
    winnersPerGroup: 3,      /* per age group, per draw               */
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
  /* Rehearsal draws are labelled by clock time like real ones, so every
     screen that prints draw.label reads the same in both modes. */
  function hhmmOf(d) {
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* ── Rehearsal ────────────────────────────────────────────────
     The show is two days in September. Everything here — the hourly
     freeze, the countdown, the win/lose verdict, the claim at the
     stand — only happens on those two dates, which makes the whole
     prize flow untestable for the months beforehand.

     Rehearsal collapses the schedule into fixed slots of a few
     minutes so the full path (play → ticket → countdown → draw →
     win or lose → claim) runs end to end in the time it takes to
     make a coffee.

     The anchor is a SHARED ABSOLUTE TIMESTAMP, not "a minute from
     whenever this device called enable". That distinction is the
     whole point: the previous test mode started counting when each
     browser happened to switch it on, so a booth laptop and the
     phone that scanned its QR sat on different schedules and the
     handoff — the single most valuable thing to rehearse — could
     not be rehearsed at all. Given the same {started, minutes},
     every device computes an identical list of draws.

     Slots are generated rather than stored so a rehearsal left
     running does not run out of draws.                            */
  var rehearsal = null;      /* { minutes, started } */
  var REHEARSAL_SLOTS = 400; /* ~33h at 5min: longer than any rehearsal */

  /* Accepts the raw settings value, so every page can hand over what
     it read from the shared row without unpacking it first. */
  function setRehearsal(cfg) {
    if (!cfg || !cfg.on || !cfg.started) { rehearsal = null; return null; }
    var mins = Number(cfg.minutes) || 5;
    if (mins < 1) mins = 1;
    rehearsal = { minutes: mins, started: Number(cfg.started) };
    return rehearsal;
  }

  function getRehearsal() { return rehearsal; }

  /* Which rehearsal slot a timestamp falls in. Before the anchor
     counts as the first slot, so a score submitted in the seconds
     between two devices adopting the setting is not orphaned. */
  function rehearsalSlot(t) {
    var span = rehearsal.minutes * 60000;
    var n = Math.floor((t - rehearsal.started) / span);
    return n < 0 ? 0 : n;
  }

  /* Kept so ?prizetest=1 still works on a single device without any
     database round trip. It simply anchors a rehearsal at now. */
  function enableTestMode(intervalMin) {
    setRehearsal({ on: true, minutes: intervalMin || 3, started: Date.now() });
    return draws();
  }

  function isTestMode() { return !!rehearsal; }

  /* All draws across the show, chronological. */
  function draws() {
    if (rehearsal) {
      var span = rehearsal.minutes * 60000, list = [], i;
      for (i = 1; i <= REHEARSAL_SLOTS; i++) {
        var at_ = new Date(rehearsal.started + i * span);
        list.push({
          day: 1,
          at: at_,
          label: hhmmOf(at_),
          dayOpen: new Date(rehearsal.started),
          dayClose: new Date(rehearsal.started + REHEARSAL_SLOTS * span)
        });
      }
      return list;
    }
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

    /* Indexed rather than scanned: a rehearsal running for hours has
       hundreds of slots, and drawFor is called once per score per
       render. The slot a score sits in is the one that closes it. */
    if (rehearsal) return all[rehearsalSlot(t)] || null;

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
    isTestMode: isTestMode,
    setRehearsal: setRehearsal,
    getRehearsal: getRehearsal
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PRIZE;
