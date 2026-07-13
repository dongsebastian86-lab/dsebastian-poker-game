/* =========================================================
   CASINO — shared wallet, tier progression, menu, navigation
   Loaded first. Provides Wallet + Casino globals used by
   each game module (poker.js, blackjack.js, roulette.js).

   PROGRESSION:
     5 Italian-themed casinos, each unlocks once the player's
     PEAK bankroll crosses its threshold:
       0          Principiante  · Caffè del Gioco
       500        Novizio       · Casino della Stella
       2,500      Avanzato      · Palazzo del Lusso
       10,000     Esperto       · Salone Reale
       50,000     Professionale · Grand Casino Imperiale

     Each tier scales up minimum bets/buy-ins AND the AI's
     skill scalar — but NEVER changes the underlying odds of
     any individual round. AI gets smarter (better folds,
     better raises, tighter basic strategy in BJ), but every
     card draw, shuffle, and roulette spin remains fair.
========================================================= */
(function () {
  'use strict';

  // --------- Tiers ---------
  const TIERS = [
    { id: 'principiante', short: 'Principiante', name: 'Caffè del Gioco',          minPeak: 0,      blindsBase: 5,     bjMin: 10,    rouStakes: [5, 10, 25, 50],     aiScalar: 1.0,  spectatorCap: 3, theme: { accent: '#d4a574', deep: '#3b2014', glow: 'rgba(212,165,116,0.20)' } },
    { id: 'novizio',       short: 'Novizio',       name: 'Casino della Stella',    minPeak: 500,    blindsBase: 25,    bjMin: 50,    rouStakes: [25, 50, 100, 250],  aiScalar: 1.25, spectatorCap: 4, theme: { accent: '#7ea6e8', deep: '#101f44', glow: 'rgba(126,166,232,0.20)' } },
    { id: 'avanzato',      short: 'Avanzato',      name: 'Palazzo del Lusso',      minPeak: 2500,   blindsBase: 100,   bjMin: 200,   rouStakes: [100, 250, 500, 1000], aiScalar: 1.5,  spectatorCap: 5, theme: { accent: '#c25b6b', deep: '#3a1218', glow: 'rgba(194,91,107,0.22)' } },
    { id: 'esperto',       short: 'Esperto',       name: 'Salone Reale',           minPeak: 10000,  blindsBase: 500,   bjMin: 1000,  rouStakes: [500, 1000, 2500, 5000], aiScalar: 1.75, spectatorCap: 6, theme: { accent: '#d4af37', deep: '#2a1e08', glow: 'rgba(212,175,55,0.22)' } },
    { id: 'professionale', short: 'Professionale', name: 'Grand Casino Imperiale', minPeak: 50000,  blindsBase: 2500,  bjMin: 5000,  rouStakes: [2500, 5000, 10000, 25000], aiScalar: 2.0,  spectatorCap: 6, theme: { accent: '#b892ff', deep: '#1a0a2e', glow: 'rgba(184,146,255,0.25)' } }
  ];
  const STORAGE_KEY = 'casino.v1';

  function tierById(id) { return TIERS.find(t => t.id === id) || TIERS[0]; }
  function tierByPeak(peak) {
    let t = TIERS[0];
    for (const cur of TIERS) if (peak >= cur.minPeak) t = cur;
    return t;
  }
  function nextTierOf(cur) {
    const i = TIERS.indexOf(cur);
    return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
  }
  function progressToNext(peak) {
    const cur = tierByPeak(peak);
    const next = nextTierOf(cur);
    if (!next) return { cur: cur.id, pct: 1.0, remaining: 0, label: 'Maximum tier reached' };
    const span = next.minPeak - cur.minPeak;
    const into = peak - cur.minPeak;
    const pct = peak >= next.minPeak ? 1 : Math.max(0, into / span);
    return { cur: cur.id, pct, remaining: next.minPeak - peak, next: next.id, label: 'Next: ' + next.name };
  }

  // --------- Persistence ---------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.peakBalance !== 'number') return null;
      // Backward-compat: older saves only stored peak + tier. Mirror balance
      // from peak so a returning player retains chips across reloads.
      if (typeof parsed.balance !== 'number') parsed.balance = parsed.peakBalance;
      return parsed;
    } catch (e) { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({
      balance: Wallet.balance,
      peakBalance: Wallet.peakBalance,
      currentTierId: Wallet.currentTierId,
      handsPlayed: Wallet.handsPlayed,
      startBalance: Wallet.startBalance
    })); }
    catch (e) { /* quota / private mode */ }
  }

  // --------- Wallet ---------
  // The starting bankroll is intentionally BELOW the Novizio threshold (500)
  // so a fresh visit begins in Principiante. The user must earn their way up.
  const DEFAULT_BANKROLL = 250;
  const Wallet = {
    balance: DEFAULT_BANKROLL,
    startBalance: DEFAULT_BANKROLL,
    peakBalance: DEFAULT_BANKROLL,
    currentTierId: 'principiante',
    lastTierId: 'principiante',   // for tier-up detection
    handsPlayed: 0,
    history: [],

    init() {
      const saved = loadState();
      if (saved) {
        // Returning player: restore bankroll, peak, tier from saved state.
        this.balance = typeof saved.balance === 'number' ? saved.balance : DEFAULT_BANKROLL;
        this.startBalance = typeof saved.startBalance === 'number' ? saved.startBalance : this.balance;
        this.peakBalance = typeof saved.peakBalance === 'number' ? saved.peakBalance : DEFAULT_BANKROLL;
        this.handsPlayed = typeof saved.handsPlayed === 'number' ? saved.handsPlayed : 0;
        // ALWAYS derive tier from peak — heals any stale / inconsistent
        // saved state where tier and peak were out of sync. THIS is the
        // key invariant that prevents the "click a game card \u2192 insta
        // tier-up overlay" bug.
        this.currentTierId = tierByPeak(this.peakBalance).id;
        this.lastTierId = this.currentTierId;
      } else {
        // First-ever visit: start fresh.
        this.balance = DEFAULT_BANKROLL;
        this.startBalance = DEFAULT_BANKROLL;
        this.peakBalance = DEFAULT_BANKROLL;
        this.currentTierId = tierByPeak(this.peakBalance).id;
        this.lastTierId = this.currentTierId;
        saveState();
      }
      document.body.classList.add('tier-' + this.currentTierId);
      refreshAllBalances();
      renderTierBadge();
      refreshTierShowcase();
    },

    adjust(delta, note) {
      this.balance = Math.max(0, this.balance + delta);
      const oldPeak = this.peakBalance;
      if (this.balance > this.peakBalance) this.peakBalance = this.balance;
      this.history.unshift({ game: note?.game || '?', delta, balanceAfter: this.balance, t: Date.now() });
      // Tier up detection — fires only when the bankroll has just crossed
      // a tier threshold (i.e., previously saved tier is below the new
      // tier derived from peak). With the invariant above (peak-derived
      // tier on every load) this won't spuriously fire on game-card clicks.
      const newTier = tierByPeak(this.peakBalance);
      if (newTier.id !== this.currentTierId) {
        this.currentTierId = newTier.id;
        this.lastTierId = newTier.id;
        document.body.classList.remove('tier-principiante', 'tier-novizio', 'tier-avanzato', 'tier-esperto', 'tier-professionale');
        document.body.classList.add('tier-' + newTier.id);
        showTierUpOverlay(newTier);
      }
      // Persist after every wallet mutation so balance, peak, and tier
      // all stay in sync with localStorage. Without this, a reload can
      // silently reset balance to DEFAULT — softlocking higher tiers.
      saveState();
      refreshAllBalances();
      renderTierBadge();
      refreshTierShowcase();
    },

    // reset() wipes bankroll AND progress — fresh start drops the player
    // back into the tier implied by DEFAULT_BANKROLL (Principiante).
    reset() {
      this.balance = DEFAULT_BANKROLL;
      this.startBalance = DEFAULT_BANKROLL;
      this.peakBalance = DEFAULT_BANKROLL;
      this.currentTierId = tierByPeak(this.peakBalance).id;
      this.lastTierId = this.currentTierId;
      this.handsPlayed = 0;
      this.history = [];
      document.body.classList.remove('tier-principiante', 'tier-novizio', 'tier-avanzato', 'tier-esperto', 'tier-professionale');
      document.body.classList.add('tier-' + this.currentTierId);
      saveState();
      refreshAllBalances();
      renderTierBadge();
      refreshTierShowcase();
    },

    canAfford(amount) { return this.balance >= amount; }
  };

  // --------- Helper: derive tier-relevant game parameters ---------
  function getTier() { return tierById(Wallet.currentTierId); }
  function getAIScalar() { return getTier().aiScalar; }
  function getBlindsBase() { return getTier().blindsBase; }
  function getBjMin() { return getTier().bjMin; }
  function getRouStakes() { return getTier().rouStakes.slice(); }
  function getSpectatorCap() { return getTier().spectatorCap; }

  // --------- UI refresh ---------
  function fmt(n) { return n.toLocaleString(); }
  function refreshAllBalances() {
    const wa = document.getElementById('walletAmount');
    if (wa) wa.textContent = fmt(Wallet.balance);
    const ws = document.getElementById('walletStats');
    if (ws) {
      const net = Wallet.balance - Wallet.startBalance;
      const sign = net > 0 ? '+' : '';
      ws.textContent = `Hands played: ${Wallet.handsPlayed} · Net: ${sign}${fmt(net)}`;
    }
    ['pokerBalance', 'blackjackBalance', 'rouletteBalance'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(Wallet.balance);
    });
    const hint = document.getElementById('buyinHint');
    if (hint) hint.textContent = `Bankroll: ${fmt(Wallet.balance)} · Buy-in deducts on Deal Me In`;
  }

  // Update the static tier showcase in the casino menu's empty area.
  // (The dynamic tier-up modal — #tierUpOverlay — fires only when
  // crossing a threshold and is hidden by default. The showcase is the
  // always-visible "you are currently in X casino" indicator.)
  function refreshTierShowcase() {
    const el = document.querySelector('.tier-showcase');
    if (!el) return;
    const tier = getTier();
    const nameEl = el.querySelector('.tier-showcase-name');
    const subEl = el.querySelector('.tier-showcase-sub');
    const ruleEl = el.querySelector('.tier-showcase-rule');
    if (nameEl) nameEl.textContent = tier.name;
    if (subEl) subEl.textContent = tier.short;
    if (ruleEl) ruleEl.textContent =
      `Minimum bets ${tier.blindsBase} · AI plays at ${tier.aiScalar.toFixed(2)}× skill`;
  }

  function renderTierBadge() {
    const badge = document.getElementById('tierBadge');
    if (!badge) return;
    const tier = getTier();
    badge.className = 'tier-badge tier-badge--' + tier.id;
    const nameEl = badge.querySelector('.tier-badge-name');
    const progEl = badge.querySelector('.tier-badge-progress');
    const barEl  = badge.querySelector('.tier-badge-bar');
    if (nameEl) nameEl.textContent = '✦ ' + tier.name;
    const p = progressToNext(Wallet.peakBalance);
    if (progEl) progEl.textContent = p.label;
    if (barEl) barEl.style.width = (p.pct * 100) + '%';
    const peakEl = badge.querySelector('.tier-badge-peak');
    if (peakEl) peakEl.textContent = 'Peak: ' + fmt(Wallet.peakBalance);
  }

  function showTierUpOverlay(tier) {
    const ov = document.getElementById('tierUpOverlay');
    if (!ov) return;
    ov.className = 'overlay tier-up tier-up--' + tier.id;
    const nm = ov.querySelector('.tier-up-name');
    if (nm) nm.textContent = tier.name;
    const sub = ov.querySelector('.tier-up-sub');
    if (sub) sub.textContent = 'Welcome, ' + tier.short + '.';
    const rule = ov.querySelector('.tier-up-rule');
    if (rule) rule.textContent = `New house rules: minimum bets ${tier.blindsBase}, AI plays at ${tier.aiScalar.toFixed(2)}× skill.`;
    ov.classList.remove('hidden');
    // Only dismiss when the user clicks outside the card (the dim background)
    // OR presses the dismiss button. Clicking inside the card text/heading
    // should NOT dismiss.
    const onClick = (e) => {
      if (e.target === ov || (e.target.closest && e.target.closest('#tierUpDismissBtn'))) {
        ov.classList.add('hidden');
        ov.removeEventListener('click', onClick);
        // Refresh any game UI that depends on tier-derived parameters —
        // e.g. the roulette stake slider needs new min/max/stakes once
        // a higher tier unlocks, and the BJ min-bet slider needs new
        // tier-derived bounds. Without these calls, those sliders stay
        // on the old tier's values until the user next opens the game.
        if (window.RouletteApp && typeof RouletteApp.refreshChipStackerButtons === 'function') {
          RouletteApp.refreshChipStackerButtons();
        }
        if (window.BlackjackApp && typeof BlackjackApp.refreshBjLobbySliders === 'function') {
          BlackjackApp.refreshBjLobbySliders();
        }
      }
    };
    ov.addEventListener('click', onClick);
    renderTierBadge();
  }

  // --------- Navigation ---------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const root = document.getElementById(id);
    if (!root) return;
    root.classList.add('active');
    const innerActive = root.querySelector('.screen.active');
    if (!innerActive) {
      const firstInner = root.querySelector('.screen');
      if (firstInner) firstInner.classList.add('active');
    }
  }

  function backToMenu() {
    if (window.PokerApp && typeof PokerApp.cashOut === 'function') PokerApp.cashOut();
    if (window.BlackjackApp && typeof BlackjackApp.cashOut === 'function') BlackjackApp.cashOut();
    if (window.RouletteApp && typeof RouletteApp.cashOut === 'function') RouletteApp.cashOut();
    showScreen('menu');
    refreshAllBalances();
    renderTierBadge();
  }

  // --------- Buy-in counter for poker lobby ---------
  // The starting value is the smaller of DEFAULT_BANKROLL and the nearest
  // round-number (100/1000) below it. This guarantees the starting buy-in
  // is BELOW the starting balance so the '+' button is visibly responsive.
  // Otherwise _buyin == balance and '+' clicks are clamped (broken UX).
  function _initialBuyin() {
    const tierMin = getBlindsBase();
    const bal = (typeof Wallet !== 'undefined' && Wallet && typeof Wallet.balance === 'number')
      ? Wallet.balance : DEFAULT_BANKROLL;
    const rounded = Math.max(tierMin, Math.min(bal, Math.floor(bal / 100) * 100));
    return rounded;
  }
  let _buyin = _initialBuyin();
  function currentBuyin() { return _buyin; }
  function setBuyin(v) { _buyin = v; refreshAllBalances(); }
  function bumpBuyin(delta) {
    const tierMin = getBlindsBase();
    _buyin = Math.max(tierMin, Math.min(Wallet.balance, _buyin + delta));
    refreshAllBalances();
  }

  // --------- Menu setup ---------
  function setupMenu() {
    document.querySelectorAll('.game-card').forEach(card => {
      card.addEventListener('click', () => {
        const game = card.dataset.game;
        openGame(game);
      });
    });
    // Note: there is intentionally NO "+ 500" top-up button. The bankroll
    // can only grow by winning at single-player (AI / dealer) tables —
    // a top-up would be cheating.
    document.getElementById('resetWalletBtn')?.addEventListener('click', () => {
      if (confirm('Reset bankroll AND casino progress? You will return to Principiante.')) {
        Wallet.reset();
        flashWallet();
      }
    });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', backToMenu));
    refreshAllBalances();
    renderTierBadge();
    refreshTierShowcase();
  }

  function flashWallet() {
    const wa = document.getElementById('walletAmount');
    if (!wa) return;
    wa.animate(
      [{ color: '#ffd76b', transform: 'scale(1.15)' }, { color: '#f0e9d6', transform: 'scale(1)' }],
      { duration: 350, easing: 'ease-out' }
    );
  }

  function openGame(game) {
    if (game === 'poker' && window.PokerApp) PokerApp.open();
    else if (game === 'blackjack' && window.BlackjackApp) BlackjackApp.open();
    else if (game === 'roulette' && window.RouletteApp) RouletteApp.open();
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.counter-btn');
    if (!btn) return;
    const target = btn.dataset.target;
    const dir = parseInt(btn.dataset.dir, 10);
    if (target === 'buyin') {
      bumpBuyin(dir);
      return;
    }
    window.dispatchEvent(new CustomEvent('casino:counter', { detail: { target, dir } }));
  });

  // Paint the left-side "fill" gradient on a range slider by writing
  // a CSS custom property `--progress` that the slider's track pseudo
  // references in its background-gradient. Safe to call any time; reads
  // min/max/value defensively so a malformed slider is a no-op.
  function paintSliderProgress(el) {
    if (!el || !el.min || !el.max) return;
    const min = parseFloat(el.min);
    const max = parseFloat(el.max);
    const val = parseFloat(el.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(val)) return;
    const span = max - min;
    if (span <= 0) return;
    const pct = Math.max(0, Math.min(100, ((val - min) / span) * 100));
    el.style.setProperty('--progress', pct + '%');
  }

  // --------- Generic confirm dialog ---------
  // Used by each game's cashOut() to ask the user before forfeiting
  // chips on leave. Resolves to true on "Yes, leave" or false on
  // "Cancel". Returns true immediately (no dialog) if no overlay
  // markup is present, so missing DOM is a no-op rather than a hang.
  // Only one confirm can be in flight at a time; calling it again
  // while a dialog is open resolves the new caller with false.
  let _confirmInFlight = null;
  function confirmForfeit(title, message) {
    return new Promise(resolve => {
      const ov = document.getElementById('confirmOverlay');
      if (!ov) { resolve(true); return; }
      // If a previous confirm is still open, treat re-callers as a
      // cancel — avoids stacking multiple dialogs on rapid clicks.
      if (_confirmInFlight) { resolve(false); return; }
      const titleEl = document.getElementById('confirmTitle');
      const msgEl = document.getElementById('confirmMessage');
      const yesBtn = document.getElementById('confirmYesBtn');
      const noBtn = document.getElementById('confirmNoBtn');
      if (titleEl) titleEl.textContent = title || 'Leave the table?';
      if (msgEl) msgEl.textContent = message || "You'll forfeit your placed chips.";
      const cleanup = () => {
        ov.classList.add('hidden');
        if (yesBtn) yesBtn.removeEventListener('click', onYes);
        if (noBtn)  noBtn.removeEventListener('click', onNo);
        _confirmInFlight = null;
      };
      const onYes = () => { cleanup(); resolve(true); };
      const onNo  = () => { cleanup(); resolve(false); };
      if (yesBtn) yesBtn.addEventListener('click', onYes);
      if (noBtn)  noBtn.addEventListener('click', onNo);
      _confirmInFlight = { resolve };
      ov.classList.remove('hidden');
    });
  }

  // --------- Expose ---------
  window.Wallet = Wallet;
  window.Casino = {
    showScreen, backToMenu, openGame, refreshAllBalances, renderTierBadge,
    currentBuyin, setBuyin, bumpBuyin, DEFAULT_BANKROLL,
    TIERS, getTier, getAIScalar, getBlindsBase, getBjMin, getRouStakes, getSpectatorCap,
    progressToNext, saveState, paintSliderProgress, confirmForfeit
  };

  // --------- Boot ---------
  function boot() {
    Wallet.init();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupMenu);
    } else {
      setupMenu();
    }
  }
  boot();
})();
