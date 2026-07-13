/* =====================================================
   ROULETTE — module (loaded as roulette.js)
   Exposes window.RouletteApp = { open, cashOut }
   European single-zero wheel. Inside-number bets + outside bets.
   "Bots" = visual spectators who place their own bets (independent balance).
===================================================== */
(function () {
  'use strict';

  // European wheel order (clockwise from 0)
  const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
    10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
  ];
  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const BLACK = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);
  const colorOf = n => n === 0 ? 'green' : RED.has(n) ? 'red' : BLACK.has(n) ? 'black' : 'green';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const App = {
    botsCap: 3,
    Settings: { bots: 2, buyIn: 1000 },
    selectedStake: 10,
    bets: [],        // [{ kind, target, amount }]
    spinning: false,
    spectators: [],  // [{ name, balance, bets, chipStack }]
    // Audio state (roulette click-clack): lazy-create AudioContext on
    // the first spin click; lastTickTime is the 80ms rate-limit window
    // so we never fire more than 12.5 ticks per second.
    audioCtx: null,
    lastTickTime: 0,
  };
  function tierBotsCap() { return (window.Casino && Casino.getSpectatorCap) ? Casino.getSpectatorCap() : 3; }
  function tierStakes()  { return (window.Casino && Casino.getRouStakes)  ? Casino.getRouStakes()    : [5, 10, 25, 50]; }
  function snapStake(rawValue, stakes) {
    // Find the closest tier stake to rawValue. Ties go to the smaller
    // stake (strict < comparison), so the slider thumb tracks the user's
    // drag direction without jumping back when crossing the midline.
    if (!stakes || !stakes.length) return 0;
    let best = stakes[0]; let bestDiff = Math.abs(best - rawValue);
    for (const s of stakes) {
      const d = Math.abs(s - rawValue);
      if (d < bestDiff) { best = s; bestDiff = d; }
    }
    return best;
  }
  function applyTierDefaults() {
    App.botsCap = tierBotsCap();
    App.Settings.bots = Math.min(App.Settings.bots, App.botsCap);
    // App.selectedStake is clamped (not resnapped) inside refreshChipStackerButtons().
  }

  function refreshChipStackerButtons() {
    // Stake slider now offers $1 chip increments across the player's
    // full bankroll. The tier-derived `rouStakes` array used to gate
    // allowed values (e.g. [5, 10, 25, 50]) which made the thumb jump
    // in big steps; we now allow any integer so the user can fine-tune.
    const slider = document.getElementById('rouStakeSlider');
    const label = document.getElementById('rouStakeLabel');
    const bal = (window.Wallet && typeof Wallet.balance === 'number') ? Wallet.balance : 1000;
    if (!slider) return;
    slider.min = '1';
    slider.max = String(Math.max(1, bal));
    slider.step = '1';
    // Clamp selectedStake to the new free-form range.
    if (App.selectedStake < 1) App.selectedStake = 1;
    if (App.selectedStake > bal) App.selectedStake = bal;
    slider.value = String(App.selectedStake);
    if (label) label.textContent = String(App.selectedStake);
    window.Casino?.paintSliderProgress?.(slider);
    // Adjust spectator counter ceiling (unchanged)
    const cntValEls = document.querySelectorAll('#rouBotsValue');
    if (cntValEls.length) cntValEls.forEach(e => e.textContent = String(App.Settings.bots));
  }

  function setupLobby() {
    $$('#rouletteScreen .counter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.target === 'buyin') return; // handled by casino.js
        if (btn.dataset.target !== 'rouBots') return;
        const dir = parseInt(btn.dataset.dir, 10);
        App.Settings.bots = Math.max(0, Math.min(App.botsCap, App.Settings.bots + dir));
        $('#rouBotsValue').textContent = App.Settings.bots;
      });
    });
    $('#rouStartBtn').addEventListener('click', startGame);
    $('#rouClearBtn').addEventListener('click', clearBets);
    $('#rouSpinBtn').addEventListener('click', spin);
    // Stake slider: $1 chip increments across the player's full bankroll.
    // No tier-snap: every integer value is allowed so the user can
    // fine-tune their bet rather than jumping between house tiers.
    const slider = document.getElementById('rouStakeSlider');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10) || 0;
        App.selectedStake = v;
        const label = document.getElementById('rouStakeLabel');
        if (label) label.textContent = String(v);
        window.Casino?.paintSliderProgress?.(slider);
      });
    }
    // The lobby already has a "← Back to Casino" data-back button for
    // pre-table cancel. The table-level cancel button was removed by
    // user request — use the top data-back for in-table exit (which
    // calls cashOut and refunds any unspun bets).
  }

  // ---------- Grid rendering ----------
  // The 0-36 grid that previously lived in #rouGrid was removed: its 13-col
  // layout squeezed into a 64px column of .rou-grid-wrap and visually
  // collided with the outside-bet buttons beside it. The dedicated
  // .rou-number-panel below the wheel now owns all per-number betting
  // (1-18, 19-36, plus a standalone green 0 row at the top). Therefore
  // buildBettingGrid() is gone and the only grid rendering helpers below
  // are buildOutsideBets() and buildNumberPanel().

  function buildOutsideBets() {
    const out = $('#rouOuter'); out.innerHTML = '';
    // Note: '1 – 18' and '19 – 36' (low/high) range buttons are gone.
    // Individual number selection happens in buildNumberPanel() so each
    // click places a 35x straight-up bet instead of a 1x range bet.
    const defs = [
      { id: 'red',    label: 'RED',    cls: 'red',    kind: 'red' },
      { id: 'black',  label: 'BLACK',  cls: 'black',  kind: 'black' },
      { id: 'odd',    label: 'ODD',    cls: '',       kind: 'odd' },
      { id: 'even',   label: 'EVEN',   cls: '',       kind: 'even' },
    ];
    defs.forEach(d => {
      const b = document.createElement('div');
      b.className = 'rou-out ' + d.cls;
      b.dataset.kind = d.kind;
      b.innerHTML = `<span>${d.label}</span><div class="rou-cell-stack"></div>`;
      b.addEventListener('click', () => placeBet(d.kind, null));
      out.appendChild(b);
    });
  }

  // Builds the 36-button number panel split into 1–18 and 19–36 rows,
  // replacing the old range buttons. Each clickable for a 35× straight-up bet.
  function buildNumCell(n) {
    const cell = document.createElement('div');
    cell.className = 'rou-num-cell ' + colorOf(n);
    cell.dataset.kind = 'straight';
    cell.dataset.target = String(n);
    cell.innerHTML = `<span>${n}</span><div class="rou-cell-stack"></div>`;
    cell.addEventListener('click', () => placeBet('straight', n));
    return cell;
  }
  // 0 lives in its own row above the 1-18 / 19-36 split so player bets
  // on green don't crowd the 36 straight-up buttons. styling: green chip
  // look matches the wheel hub and felt palette.
  function buildZeroCell() {
    const cell = document.createElement('div');
    cell.className = 'rou-num-cell zero';
    cell.dataset.kind = 'straight';
    cell.dataset.target = '0';
    cell.innerHTML = `<span>0</span><div class="rou-cell-stack"></div>`;
    cell.addEventListener('click', () => placeBet('straight', 0));
    return cell;
  }
  function buildNumberPanel() {
    const zero = document.getElementById('rouNumsZero');
    const low  = document.getElementById('rouNumsLow');
    const high = document.getElementById('rouNumsHigh');
    if (zero) { zero.innerHTML = ''; zero.appendChild(buildZeroCell()); }
    if (!low || !high) return;
    low.innerHTML = '';
    high.innerHTML = '';
    for (let n = 1;  n <= 18; n++) low.appendChild(buildNumCell(n));
    for (let n = 19; n <= 36; n++) high.appendChild(buildNumCell(n));
  }

  // ---------- Bet placement / clearing ----------
  function placeBet(kind, target) {
    if (App.spinning) return;
    if (!window.Wallet || Wallet.balance < App.selectedStake) {
      toast('Not enough chips.');
      return;
    }
    Wallet.adjust(-App.selectedStake, { game: 'roulette bet' });
    App.bets.push({ kind, target, amount: App.selectedStake });
    refreshBetDisplays();
  }
  function clearBets() {
    if (App.spinning) return;
    if (!App.bets.length) return;
    let refund = 0;
    for (const b of App.bets) refund += b.amount;
    if (window.Wallet) Wallet.adjust(refund, { game: 'roulette refund' });
    App.bets = [];
    refreshBetDisplays();
  }
  function refreshBetDisplays() {
    // Clear stacks then redraw the per-cell total badges.
    $$('.rou-cell-stack').forEach(el => el.innerHTML = '');
    // Sum stakes by target cell so multiple clicks on the same number
    // aggregate into one badge (e.g. two 10s on RED = 20).
    const perCell = new Map();
    for (const b of App.bets) {
      const key = b.kind === 'straight' ? `n-${b.target}` : `kind-${b.kind}`;
      perCell.set(key, (perCell.get(key) || 0) + b.amount);
    }
    perCell.forEach((amt, key) => {
      let cell;
      if (key.startsWith('n-')) {
        cell = document.querySelector(`.rou-num-cell[data-target="${key.slice(2)}"]`);
      } else {
        cell = document.querySelector(`.rou-out[data-kind="${key.slice(5)}"]`);
      }
      if (!cell) return;
      const stack = cell.querySelector('.rou-cell-stack');
      stack.innerHTML = '';
      // Single total-amount badge per spot — no chip-pile visualization.
      // Keeps the player's wager legible without occluding button text.
      const total = document.createElement('span');
      total.className = 'rou-cell-total';
      total.textContent = String(amt);
      stack.appendChild(total);
    });
    $('#rouStatus').textContent = `Placed ${App.bets.length} bet${App.bets.length === 1 ? '' : 's'}`;
  }

  // ---------- Specs / payouts ----------
  function betMatches(bet, num) {
    if (bet.kind === 'straight') return bet.target === num;
    if (bet.kind === 'red')    return RED.has(num);
    if (bet.kind === 'black')  return BLACK.has(num);
    if (bet.kind === 'odd')    return num !== 0 && num % 2 === 1;
    if (bet.kind === 'even')   return num !== 0 && num % 2 === 0;
    if (bet.kind === 'low')    return num >= 1 && num <= 18;
    if (bet.kind === 'high')   return num >= 19 && num <= 36;
    return false;
  }
  function betPays(bet) {
    // Returns the multiplier on the bet (e.g., straight = 35, red/black = 1).
    if (bet.kind === 'straight') return 35;
    return 1;
  }

  // ---------- Spectators (bots) ----------
  function setupSpectators() {
    const cont = $('#rouSpectators'); cont.innerHTML = '';
    App.spectators = [];
    for (let i = 0; i < App.Settings.bots; i++) {
      const name = ['Slick Sam','Lucky Lou','Diamond Dan','River Rita'][i % 4];
      App.spectators.push({ name, balance: 500 + Math.floor(Math.random() * 1500), bets: [], chipStack: 0 });
    }
    renderSpectators();
  }
  function renderSpectators() {
    const cont = $('#rouSpectators');
    cont.innerHTML = '';
    App.spectators.forEach(spec => {
      const el = document.createElement('div');
      el.className = 'rou-spec';
      el.innerHTML = `
        <div class="rou-spec-name">${spec.name} <span class="ai-tag">🤖</span></div>
        <div class="rou-spec-bal">♠ ${spec.balance.toLocaleString()}</div>
        <div class="rou-spec-bets" data-bets>${spec.bets.length ? spec.bets.length + ' active bets' : ''}</div>`;
      cont.appendChild(el);
    });
  }
  function spectatorPlaceBets() {
    // Each spectator places 1–3 random bets before the spin.
    for (const spec of App.spectators) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const kindRoll = Math.random();
        let kind, target = null;
        if (kindRoll < 0.4) { kind = 'straight'; target = WHEEL_ORDER[Math.floor(Math.random() * WHEEL_ORDER.length)]; }
        else {
          const opts = ['red', 'black', 'odd', 'even', 'low', 'high'];
          kind = opts[Math.floor(Math.random() * opts.length)];
        }
        const amt = 5 + Math.floor(Math.random() * 4) * 5; // 5, 10, 15, 20
        if (amt > spec.balance) continue;
        spec.balance -= amt;
        spec.bets.push({ kind, target, amount: amt });
      }
    }
    renderSpectators();
  }
  function spectatorsSettle(num) {
    for (const spec of App.spectators) {
      let payout = 0;
      for (const b of spec.bets) {
        if (betMatches(b, num)) payout += b.amount * (1 + betPays(b));
      }
      spec.balance += payout;
      spec.bets = [];
    }
    renderSpectators();
  }

  // ---------- Wheel render ----------
  // 37 red/black/green pockets in the standard European arrangement
  // (from WHEEL_ORDER). Each pocket is an ANNULAR wedge (ring slice), not
  // a pie slice from the center, so the ivory ball has a band to orbit
  // along and visually drop into when the spin settles. Radial gold
  // separators + numbers rotated to read outward sell the casino feel.
  function buildWheel() {
    const svg = $('.rou-wheel-svg');
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 200 200');
    const cx = 100, cy = 100;
    const outerR = 95;
    const innerR = 38;
    const segCount = WHEEL_ORDER.length;
    // Outer rim ring (dark wood, gold pinstripe)
    svg.insertAdjacentHTML('beforeend',
      `<circle cx="${cx}" cy="${cy}" r="${outerR + 4}" fill="#0d0604"/>
       <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="#c9a233" stroke-width="2"/>`);
    // 37 colored pockets + radial separators + radial numbers
    for (let i = 0; i < segCount; i++) {
      const n = WHEEL_ORDER[i];
      const a0 = (i / segCount) * 2 * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / segCount) * 2 * Math.PI - Math.PI / 2;
      const fill = colorOf(n) === 'red' ? '#c0392b' : colorOf(n) === 'black' ? '#1a1a1a' : '#27ae60';
      const path = describeAnnularWedge(cx, cy, outerR - 1, innerR, a0, a1);
      svg.insertAdjacentHTML('beforeend',
        `<path d="${path}" fill="${fill}" stroke="#0d0604" stroke-width="0.4"/>`);
      // Radial gold separators between pockets
      const x0o = cx + Math.cos(a0) * (outerR - 1);
      const y0o = cy + Math.sin(a0) * (outerR - 1);
      const x0i = cx + Math.cos(a0) * innerR;
      const y0i = cy + Math.sin(a0) * innerR;
      svg.insertAdjacentHTML('beforeend',
        `<line x1="${x0o}" y1="${y0o}" x2="${x0i}" y2="${y0i}" stroke="#c9a233" stroke-width="0.5" opacity="0.55"/>`);
      // Number mid-wedge, rotated so it reads outward from the spoke
      const ang = (a0 + a1) / 2;
      const labelR = (outerR + innerR) / 2;
      const x = cx + Math.cos(ang) * labelR;
      const y = cy + Math.sin(ang) * labelR;
      const rotDeg = (ang * 180 / Math.PI) + 90;
      svg.insertAdjacentHTML('beforeend',
        `<text x="${x}" y="${y+3}" fill="#fffaf0" font-size="9" font-weight="800" text-anchor="middle" ` +
        `transform="rotate(${rotDeg} ${x} ${y})">${n}</text>`);
    }
    // Center turret / hub
    svg.insertAdjacentHTML('beforeend',
      `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#1a0e08" stroke="#c9a233" stroke-width="1.5"/>
       <circle cx="${cx}" cy="${cy}" r="${innerR - 6}" fill="#3b231a" stroke="none"/>
       <circle cx="${cx}" cy="${cy}" r="5" fill="#c9a233"/>`);
  }

  // Path string for an annulus sector: outer arc clockwise, line inward
  // to inner radius, inner arc counter-clockwise, close. The opposing
  // sweep flags (1 vs 0) ensure proper fill — without them SVG would
  // mis-trace the band into a spiral.
  function describeAnnularWedge(cx, cy, ro, ri, a0, a1) {
    const x0o = cx + Math.cos(a0) * ro, y0o = cy + Math.sin(a0) * ro;
    const x1o = cx + Math.cos(a1) * ro, y1o = cy + Math.sin(a1) * ro;
    const x0i = cx + Math.cos(a0) * ri, y0i = cy + Math.sin(a0) * ri;
    const x1i = cx + Math.cos(a1) * ri, y1i = cy + Math.sin(a1) * ri;
    return `M ${x0o} ${y0o} A ${ro} ${ro} 0 0 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${ri} ${ri} 0 0 0 ${x0i} ${y0i} Z`;
  }

  // ---------- Spin ----------
  async function spin() {
    // Unlock the WebAudio context synchronously at the top of the
    // click handler — before any await, before any early return —
    // so Safari/iOS strict autoplay lets playTick() fire later in
    // the rAF loop. Calling resume() inside the user's click chain
    // counts as a gesture.
    ensureAudio();
    if (App.spinning) return;
    // Capture a token so cashOut() can invalidate this spin if the user
    // leaves mid-spin. performSpinAnimation() checks App.spinToken at
    // every frame and bails (no settlement, no result, no payout) if
    // cashOut() bumped it.
    const spinToken = App.spinToken = (App.spinToken || 0);
    if (!App.bets.length && !App.spectators.some(s => s.bets.length)) {
      toast('Place a bet first.'); return;
    }
    App.spinning = true;
    $('#rouSpinBtn').disabled = true;
    spectatorPlaceBets();
    await sleep(300);
    $('#rouStatus').textContent = 'No more bets · Spinning…';

    const result = WHEEL_ORDER[Math.floor(Math.random() * WHEEL_ORDER.length)];
    await performSpinAnimation(result, spinToken);
    if (App.spinToken !== spinToken) return;  // user cashed out — abandon settlement

    const res = colorOf(result);
    const $result = $('#rouResult');
    $result.textContent = `${result} (${res})`;
    $result.style.background = res === 'red' ? '#c0392b' : res === 'black' ? '#1a1a1a' : '#27ae60';
    $result.classList.remove('visible');
    void $result.offsetWidth;  // force reflow so re-adding .visible retriggers the pop animation
    $result.classList.add('visible');
    highlightWinner();  // illuminate the winning pocket now that the ball has settled

    // Settle human bets
    let totalPayout = 0;
    for (const b of App.bets) {
      if (betMatches(b, result)) totalPayout += b.amount * (1 + betPays(b));
    }
    if (totalPayout > 0 && window.Wallet) Wallet.adjust(totalPayout, { game: 'roulette win' });
    $('#rouStatus').textContent = totalPayout > 0
      ? `🎉 Won ${totalPayout.toLocaleString()} chips on ${result}`
      : `House wins · ${result}`;
    App.bets = [];
    refreshBetDisplays();
    spectatorsSettle(result);
    Wallet.handsPlayed = (Wallet.handsPlayed || 0) + 1;
    App.spinning = false;
    $('#rouSpinBtn').disabled = false;
  }

  // ---------- Audio ----------
  // WebAudio click-clack fired during the roulette spin. Lazy-creates
  // an AudioContext and resumes it inside the spin click handler
  // (browser autoplay policy requires a user gesture to unlock audio
  // — calling .resume() synchronously inside the click chain, before
  // any await, is required on Safari/iOS).
  function ensureAudio() {
    if (App.audioCtx) {
      if (App.audioCtx.state === 'suspended' && typeof App.audioCtx.resume === 'function') {
        App.audioCtx.resume();
      }
      return App.audioCtx;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      App.audioCtx = new Ctx();
      return App.audioCtx;
    } catch (e) {
      return null;
    }
  }

  // One "tick" = a sine wave whose frequency drops exponentially from
  // ~1100Hz → 140Hz over 50ms, with a 1ms attack and 60ms exponential
  // decay. Reads as a wooden fret clack; a square-wave "tick" sounds
  // like an 8-bit retro beep, which is wrong for roulette. Per-tick
  // frequency detune (Math.random() in setValueAtTime) keeps rapid
  // succession from sounding mechanical.
  function playTick() {
    const ctx = App.audioCtx;
    if (!ctx) return;
    // If the context hasn't fully resumed yet, kick it and skip this
    // tick — the next tick will land when state === 'running'.
    if (ctx.state !== 'running') {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
      return;
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Sharper "tk" carrier — a real wooden fret is a high-frequency
    // impact, not a warm tom. 2.2kHz→600Hz drop over 25ms with a 0.5ms
    // attack and 25ms exponential decay reads as a clean clack.
    osc.frequency.setValueAtTime(2200 + Math.random() * 600, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.025);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.0005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  // Drives wheel rotation (clockwise) AND a small ivory ball that
  // counter-orbits the rim, then spirals inward to settle in the
  // winning pocket under the fixed pointer at 12 o'clock. Both
  // motions share one rAF ticker so they stay frame-locked. The ball
  // has stronger deceleration than the wheel, so it visually "slows
  // first" and settles in the pocket a moment before the wheel
  // itself comes to rest — closer to real roulette feel.
  //
  // Audio Each frame computes the ball's current pocket index from
  // its angular position. When that index increments past the previous
  // one AND at least 80ms have passed since the last tick, playTick()
  // fires one wood-plonk. Excess crossings during the fast early
  // phase are dropped on purpose; a metered click-clack reads better
  // than a buzz. After t=0.86 (ball has dropped into the pocket band)
  // ticks stop.
  //
  // Cancellation: cashOut() bumps App.spinToken. The compare early in
  // this function (and inside the rAF tick) ensures mid-spin abandon
  // is clean — no DOM writes, no settled result, no payout, no further
  // ticks. App.lastTickTime is reset to 0 so next spin starts fresh.
  function performSpinAnimation(result, spinToken) {
    return new Promise((resolve) => {
      const $wheel = $('.rou-wheel-svg');
      const $ball = $('#rouBall');
      const $wrap = $('.rou-wheel');
      const rect = $wrap.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      // Each spin restarts from origin
      $wheel.style.transition = 'none';
      $wheel.style.transform = 'rotate(0deg)';
      $ball.style.display = 'block';

      const winIdx = WHEEL_ORDER.indexOf(result);
      const segAngleDeg = 360 / WHEEL_ORDER.length;
      const fullSpins = 5 + Math.floor(Math.random() * 4);   // 5..8 — dramatic
      const ballSpins = fullSpins - 2;                      // ball trails wheel by 2 turns
      const duration = 6000 + Math.floor(Math.random() * 1500);  // 6.0–7.5 s

      // Math: pocket 0 starts at canvas top (-π/2 in SVG-y-down).
      // After wheel CSS rotation R (CW = positive), pocket i sits at
      // canvas angle (-π/2 + i·segAngle − R). Solve for pocket
      // `winIdx` to land under the fixed pointer at top:
      //   R = −winIdx·segAngleDeg (mod 360) + 360·fullSpins for drama.
      const wheelEndDeg = -winIdx * segAngleDeg + 360 * fullSpins;
      // Ball ends in pocket R, which is at canvas top after the wheel
      // settles, so ball's rotation around wheel center must return
      // to top — −360·ballSpins (CCW = negative).
      const ballEndRad = -2 * Math.PI * ballSpins;
      const startAngRad = -Math.PI / 2;
      const radiusOuter = cx * 0.88;
      const radiusInner = cx * 0.65;

      // Audio tick state. 37 frets = 37 click points per revolution
      // of the ball. We track the integer pocket index the ball is
      // inside; when it advances, we fire one tick (rate-limited).
      const pocketWidth = (2 * Math.PI) / 37;
      let prevPocketIdx = 0;
      App.lastTickTime = 0;  // reset rate-window each spin

      const t0 = performance.now();
      function tick(now) {
        // Cash-out mid-spin — abandon cleanly BEFORE writing to DOM.
        if (App.spinToken !== spinToken) {
          $wheel.style.transform = '';
          $wheel.style.transition = '';
          $ball.style.display = 'none';
          App.lastTickTime = 0;
          return resolve();
        }
        const elapsed = now - t0;
        const t = Math.min(elapsed / duration, 1);

        // Wheel rotation: cubic ease-out (decelerates into final slot)
        const wheelEased = 1 - Math.pow(1 - t, 2.8);
        $wheel.style.transform = `rotate(${wheelEndDeg * wheelEased}deg)`;

        // Ball angle: stronger ease-out, so the ball leads the slow-down
        // and visually settles a moment before the wheel itself stops.
        const ballEased = 1 - Math.pow(1 - t, 1.6);
        const ballAng = startAngRad + ballEndRad * ballEased;

        // Audio ticks (orbit phase only). Track the *current* pocket
        // the ball is in; if it's a new pocket AND 80ms have passed,
        // fire one tick. Excess crossings during the fast early
        // phase are silently dropped — a metered click-clack reads
        // better than a buzz. Past t=0.86 the ball wobbles in the
        // pocket band — no more clicks.
        if (t < 0.86) {
          const curPocket = Math.floor(Math.abs(ballAng - startAngRad) / pocketWidth);
          if (curPocket > prevPocketIdx) {
            prevPocketIdx = curPocket;
            if (now - App.lastTickTime >= 80) {
              playTick();
              App.lastTickTime = now;
            }
          }
        } else {
          prevPocketIdx = -1;
        }

        // Radius profile: orbit rim → spiral inward → micro-wobble settle.
        let ballR;
        if (t < 0.62) {
          ballR = radiusOuter;
        } else if (t < 0.86) {
          const loc = (t - 0.62) / 0.24;
          const easedLoc = 1 - Math.pow(1 - loc, 2);
          ballR = radiusOuter + (radiusInner - radiusOuter) * easedLoc;
        } else {
          // Sub-pixel wobble as the ball comes to rest — feels like the
          // ball has rolled into the pocket rather than snapping.
          const wob = Math.sin((now - t0) * 0.024) * 0.7;
          ballR = radiusInner + wob;
        }
        // -7 centers the 14px ball on its computed point.
        $ball.style.left = (cx + Math.cos(ballAng) * ballR - 7) + 'px';
        $ball.style.top  = (cy + Math.sin(ballAng) * ballR - 7) + 'px';

        if (t < 1) requestAnimationFrame(tick);
        else {
          App.lastTickTime = 0;
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }

  // ---------- Toast ----------
  function toast(msg, ms = 1500) {
    const t = $('#rouToast'); if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // After the ball settles, drops two concentric expanding gold rings
  // over the winning pocket at the top of the wheel, then fades. Feels
  // like a casino light burst pulling the eye to "the marble landed
  // here". Re-fires on every spin via the offsetWidth reflow -> class
  // toggle. Cancellation: cashOut() / startGame() remove .visible.
  function highlightWinner() {
    const $pulse = $('#rouPulse');
    const $wrap = $('.rou-wheel');
    if (!$pulse || !$wrap) return;
    const rect = $wrap.getBoundingClientRect();
    const cx = rect.width / 2;
    const radiusInner = cx * 0.65;  // matches the pocket-band radius the ball drops into
    // Anchored at the same pixel coords as the post-settle ball:
    // top dead-center of the wheel = winning pocket center.
    $pulse.style.left = cx + 'px';
    $pulse.style.top  = (rect.height / 2 - radiusInner) + 'px';
    $pulse.classList.remove('visible');
    void $pulse.offsetWidth;  // force reflow so re-adding .visible re-fires the keyframes
    $pulse.classList.add('visible');
  }

  // ---------- Cash out / lifecycle ----------
  function open() {
    if (!window.Wallet) return;
    // Show the lobby (bot spectator selection area) so the user can
    // configure bot count before taking a seat. The existing "Take a
    // Seat" button in the lobby then calls startGame() to actually
    // enter the table.
    Casino.showScreen('rouletteScreen');
    document.querySelectorAll('#rouletteScreen .screen').forEach(s => s.classList.remove('active'));
    $('#rouletteLobby').classList.add('active');
    refreshChipStackerButtons();
    Casino.refreshAllBalances();
  }

  function startGame() {
    if (!window.Wallet) return;
    // No upfront buy-in deduction: each bet is debited individually
    // as the player clicks numbers in placeBet(), and spin() credits
    // payouts directly to the wallet. This guarantees a Principiante
    // player with 250 chips can enter the table without being locked
    // out by an arbitrary 1,000-chip entry fee.
    // Tier-driven stakes & spectator cap refresh on each start.
    applyTierDefaults();
    Casino.showScreen('rouletteScreen');
    document.querySelectorAll('#rouletteScreen .screen').forEach(s => s.classList.remove('active'));
    $('#rouletteTable').classList.add('active');
    buildOutsideBets();
    buildNumberPanel();
    buildWheel();
    setupSpectators();
    refreshChipStackerButtons();
    refreshBetDisplays();
    Casino.refreshAllBalances();
  }

  async function cashOut() {
    // Forfeit placed bets — the user committed by placing each bet,
    // and leaving the table mid-betting loses the bankroll committed.
    // The cancel/leave option is no longer a "no-loss" action once
    // the user has left the lobby. If there are chips on the table,
    // ask the user to confirm before tearing down the round state.
    let forfeited = 0;
    for (const b of App.bets) forfeited += b.amount;
    if (forfeited > 0) {
      const ok = await Casino.confirmForfeit(
        'Leave the table?',
        `You'll forfeit ${forfeited.toLocaleString()} chips in placed (un-spun) bets. This cannot be undone.`
      );
      if (!ok) return; // user cancelled — stay at the table, bets stay placed
    }
    // Bump the spin token FIRST so an in-flight spin() will abandon
    // its settlement when it wakes from the wheel animation sleep.
    App.spinToken = (App.spinToken || 0) + 1;
    App.bets = [];
    $('#rouSpectators').innerHTML = '';
    App.spinning = false;
    $('#rouSpinBtn').disabled = false;
    document.querySelectorAll('#rouletteScreen .screen').forEach(s => s.classList.remove('active'));
    $('#rouletteLobby').classList.add('active');
    $('.rou-wheel-svg').style.transform = '';
    $('.rou-wheel-svg').style.transition = '';
    $('#rouBall').style.display = 'none';
    $('#rouResult').classList.remove('visible');
    $('#rouPulse').classList.remove('visible');  // cancel any in-flight pulse on cash-out
    App.lastTickTime = 0;  // reset audio tick rate-window so next spin starts clean
    // Tear down the AudioContext so it doesn't keep the audio thread
    // running between sessions. Re-created on the next spin click.
    if (App.audioCtx) {
      try { App.audioCtx.close(); } catch (e) {}
      App.audioCtx = null;
    }
    Casino.refreshAllBalances();
    if (forfeited > 0) toast(`Left the table — forfeited ${forfeited.toLocaleString()} chips.`, 2200);
  }

  // Initial UI bits
  function init() {
    applyTierDefaults();
    $('#rouBotsValue').textContent = App.Settings.bots;
    refreshChipStackerButtons();
  }

  // Expose
  window.RouletteApp = { open, cashOut, startGame, refreshChipStackerButtons };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { setupLobby(); init(); });
  } else {
    setupLobby(); init();
  }
})();
