/* =====================================================
   BLACKJACK — module (loaded as blackjack.js)
   Modes:
     - vs Bots    : you + 1–3 AI players + dealer
     - Hot-Seat   : 2–6 humans + dealer, pass-and-play
===================================================== */
(function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANK_LABELS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const SUIT_IS_RED = { '♠': false, '♣': false, '♥': true, '♦': true };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Fresh deck per round (no shoe tracking needed for casual play)
  function freshDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++)
      d.push({ rank: r, suit: s, isRed: SUIT_IS_RED[s] });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  function cardValue(c) {
    if (c.rank === 14) return 11;
    if (c.rank >= 11) return 10;
    return c.rank;
  }
  // Compute total; ace counts as 11 while possible, else 1.
  function handTotal(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (c.rank === 14) { aces++; total += 11; }
      else if (c.rank >= 11) total += 10;
      else total += c.rank;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0, bust: total > 21 };
  }
  function isBlackjack(cards) {
    return cards.length === 2 &&
      ((cards[0].rank === 14 && cards[1].rank >= 10) ||
       (cards[1].rank === 14 && cards[0].rank >= 10));
  }

  function cardEl(card, opts = {}) {
    const size = opts.size || '';
    const el = document.createElement('div');
    if (card === null) { el.className = 'card back ' + size; return el; }
    el.className = 'card ' + (card.isRed ? 'red' : 'black') + ' ' + size;
    el.innerHTML = `
      <div class="corner"><span class="rank">${RANK_LABELS[card.rank - 2]}</span><span class="suit">${card.suit}</span></div>
      <span class="center-suit">${card.suit}</span>
      <div class="corner-br"><span class="rank">${RANK_LABELS[card.rank - 2]}</span><span class="suit">${card.suit}</span></div>`;
    return el;
  }
  function cardHtmlInline(card) {
    return `<span class="card ${card.isRed ? 'red' : 'black'} tiny">
      <div class="corner"><span class="rank">${RANK_LABELS[card.rank - 2]}</span><span class="suit">${card.suit}</span></div>
      <span class="center-suit">${card.suit}</span></span>`;
  }

  // -------------------- App state --------------------
  const App = {
    Settings: { mode: 'bots', bots: 1, hotCount: 2,
                minBet: (window.Casino && Casino.getBjMin) ? Casino.getBjMin() : 10 },
    deck: [],
    seats: [],          // [{ name, isAI, hand, bet, finished, doubled, bust, blackjack }]
    dealer: { hand: [], finished: false },
    humanSeatIdxs: [],
    currentSeatIdx: -1,
    roundOver: false,
    runToken: 0,        // bumped on session start / cashOut; async coroutines check this
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }

  // Returns true if the current async chain is still the active one.
  function stillActive(token) { return token === App.runToken; }

  function clearTableUI() {
    $('#bjDealerHand').innerHTML = '';
    $('#bjDealerScore').textContent = '—';
    $('#bjSeats').innerHTML = '';
  }

  function renderDealer(reveal) {
    const hand = $('#bjDealerHand');
    hand.innerHTML = '';
    App.dealer.hand.forEach((c, i) => {
      const isHole = (i === 0 && !reveal);
      const el = cardEl(isHole ? null : c, { size: '' });
      el.classList.add('deal-anim');
      hand.appendChild(el);
    });
    if (reveal) {
      const t = handTotal(App.dealer.hand);
      $('#bjDealerScore').textContent = t.total + (t.soft ? '*' : '');
    } else {
      const visible = App.dealer.hand[1];
      $('#bjDealerScore').textContent = visible ? cardValue(visible) : '—';
    }
  }

  function renderSeats() {
    const container = $('#bjSeats');
    container.innerHTML = '';
    App.seats.forEach((s, idx) => {
      const seat = document.createElement('div');
      seat.className = 'bj-seat';
      seat.dataset.idx = idx;
      if (idx === App.currentSeatIdx) seat.classList.add('bj-active');
      if (s.finished) seat.classList.add('bj-done');
      if (s.bust) seat.classList.add('bj-bust');
      if (s.blackjack) seat.classList.add('bj-natural');
      const cardsHtml = s.hand.map(c => cardHtmlInline(c)).join('');
      const t = s.hand.length ? handTotal(s.hand) : null;
      seat.innerHTML = `
        <div class="bj-seat-frame">
          <div class="bj-seat-name">${escapeHtml(s.name)} ${s.isAI ? '🤖' : ''}</div>
          <div class="bj-cards">${cardsHtml}</div>
          <div class="bj-seat-foot">
            <span class="bj-bet">Bet: ${s.bet}</span>
            <span class="bj-score">${t ? t.total + (t.soft ? '*' : '') : '—'}</span>
          </div>
        </div>`;
      container.appendChild(seat);
    });
  }

  function toast(msg, ms = 1500) {
    const t = $('#bjToast'); if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function buildSeatsFromSettings() {
    App.seats = [];
    App.humanSeatIdxs = [];
    if (App.Settings.mode === 'bots') {
      App.seats.push({ name: 'You', isAI: false, hand: [], bet: 0, finished: false, doubled: false, bust: false, blackjack: false });
      for (let i = 0; i < App.Settings.bots; i++)
        App.seats.push({ name: 'Bot ' + (i + 1), isAI: true, hand: [], bet: 0, finished: false, doubled: false, bust: false, blackjack: false });
    } else {
      for (let i = 0; i < App.Settings.hotCount; i++) {
        App.seats.push({ name: 'Player ' + (i + 1), isAI: false, hand: [], bet: 0, finished: false, doubled: false, bust: false, blackjack: false });
        App.humanSeatIdxs.push(i);
      }
    }
  }

  function dealRound(token) {
    if (!stillActive(token)) return;
    App.deck = freshDeck();
    App.dealer = { hand: [], finished: false };
    App.roundOver = false;
    for (const s of App.seats) {
      s.hand = []; s.bet = 0; s.finished = false; s.bust = false;
      s.blackjack = false; s.doubled = false;
      s.bet = App.Settings.minBet;
    }
    // 2 cards to each player; dealer gets 1 hole + 1 visible.
    // Push dealer cards only on pass 0 — the bug previously pushed
    // a visible card on every pass, leaving the dealer with 3 cards
    // at the start of every round.
    for (let pass = 0; pass < 2; pass++) {
      for (const s of App.seats) s.hand.push(App.deck.pop());
      if (pass === 0) {
        App.dealer.hand.push(App.deck.pop()); // hole (face-down)
        App.dealer.hand.push(App.deck.pop()); // visible
      }
    }
    for (const s of App.seats) s.blackjack = isBlackjack(s.hand);
    if (App.Settings.mode === 'bots') {
      App.currentSeatIdx = 0;
    } else {
      App.currentSeatIdx = App.humanSeatIdxs[0];
    }
    renderDealer(false);
    renderSeats();
    updateActionUI();
    $('#bjStatus').textContent = 'Round in progress';

    if (App.Settings.mode === 'bots') startHumanTurnMaybe(token);
    else showHotSeatOverlay();
  }

  function showHotSeatOverlay() {
    const s = App.seats[App.currentSeatIdx];
    if (!s) return;
    $('#bjHotName').textContent = s.name + ' — your turn';
    $('#bjHotOverlay').classList.remove('hidden');
    $('#bjStatus').textContent = 'Pass the device · ' + s.name;
  }
  function hideHotSeatOverlay() { $('#bjHotOverlay').classList.add('hidden'); }

  function updateActionUI() {
    const s = App.seats[App.currentSeatIdx];
    const visible = !!s && !s.finished;
    $('#bjActions').classList.toggle('hidden', !visible);
    if (!visible) return;
    const doubleBtn = $('.bj-action[data-bj="double"]');
    if (doubleBtn) doubleBtn.disabled = !(s.hand.length === 2 && !s.doubled);
  }

  async function startHumanTurnMaybe(token) {
    if (!stillActive(token)) return;
    const s = App.seats[App.currentSeatIdx];
    if (!s) return;
    if (s.isAI) {
      await sleep(700 + Math.random() * 600);
      if (!stillActive(token)) return;
      botPlay(s);
      return advanceToNextOrSettle(token);
    }
    updateActionUI();
  }

  // Tier-driven bot strategy: bots READ the dealer's visible card and
  // consult a basic-strategy look-up table. At low skill (Principiante),
  // decisions are nearly random; at high skill (Professionale), the
  // bot plays textbook basic strategy. The dealer rules and deck are
  // NEVER modified — only the bot's decisions change.
  function dealerUpValue() {
    const up = App.dealer.hand && App.dealer.hand[1];
    if (!up) return 6;
    if (up.rank === 14) return 14;                      // Ace
    if (up.rank >= 10)  return 10;                      // 10 / J / Q / K
    return up.rank;
  }
  // Returns true if the bot should HIT given hand total t and dealer up d.
  function basicStrategyHit(t, d, skill) {
    if (t.bust) return false;
    const weak = d >= 2 && d <= 6;
    const isTen = (d === 10);
    const isAce = (d === 14);
    // Smooth transition: at skill 0 → random (50/50); at skill 1 → deterministic.
    function obey(correctAnswer) {
      if (skill >= 0.92) return correctAnswer;
      if (skill <= 0.05) return Math.random() < 0.5;
      return (Math.random() < skill) ? correctAnswer : !correctAnswer;
    }
    if (!t.soft) {
      // Hard totals
      if (t.total <= 8)  return true;
      if (t.total === 9)  return !weak;             // double vs 3-6 (≈ hit otherwise)
      if (t.total === 10) return !(weak || isAce);  // double vs 2-9, hit vs 10/A
      if (t.total === 11) return false;              // always double
      if (t.total === 12) return !(d >= 4 && d <= 6); // hit vs 2-3 and 7-A
      if (t.total >= 13 && t.total <= 16) return d >= 7; // hit vs 7-A
      return obey(false);                            // hard 17+ stand
    } else {
      // Soft totals (A counted as 11)
      if (t.total <= 14) return obey(true);
      if (t.total === 15) return obey(true);
      if (t.total === 16) return obey(true);
      if (t.total === 17) return obey(!weak || isTen || isAce); // soft 17: hit vs 7-10/A
      if (t.total === 18) return obey(isTen || isAce);          // soft 18: hit vs 10 or A
      return obey(false);                                          // soft 19+ stand
    }
  }

  function botPlay(seat) {
    const t = handTotal(seat.hand);
    const skill = (window.Casino && Casino.getAIScalar)
      ? clamp(Casino.getAIScalar() - 1, 0, 1)
      : 0;
    // Doubling: always on 11; on 10 only at higher skill; on 9 vs 3-6 at high skill.
    if (seat.hand.length === 2 && !seat.doubled) {
      const d = dealerUpValue();
      const weak = d >= 2 && d <= 6;
      const isAce = (d === 14);
      const doDouble = (t.total === 11) ||
                       (t.total === 10 && (weak || (d >= 7 && d <= 9))) ||
                       (t.total === 9  && skill > 0.6 && d >= 3 && d <= 6);
      if (doDouble) { performDouble(seat); return; }
    }
    if (basicStrategyHit(t, dealerUpValue(), skill) === false) {
      seat.finished = true;
      return;
    }
    seat.hand.push(App.deck.pop());
    renderSeats();
    if (handTotal(seat.hand).bust) { seat.finished = true; seat.bust = true; return; }
    botPlay(seat);
  }

  function performDouble(seat) {
    if (seat.hand.length !== 2 || seat.doubled) return;
    seat.doubled = true;
    seat.bet *= 2;
    seat.hand.push(App.deck.pop());
    const t = handTotal(seat.hand);
    if (t.bust) seat.bust = true;
    seat.finished = true;
    renderSeats();
  }

  async function advanceToNextOrSettle(token) {
    if (!stillActive(token)) return;
    if (App.Settings.mode === 'hotseat') {
      hideHotSeatOverlay();
      await sleep(300);
      if (!stillActive(token)) return;
    }
    let nextIdx = -1;
    for (let i = App.currentSeatIdx + 1; i < App.seats.length; i++) {
      if (!App.seats[i].finished) { nextIdx = i; break; }
    }
    if (nextIdx === -1) return dealerTurn(token);
    App.currentSeatIdx = nextIdx;
    renderSeats();
    if (App.Settings.mode === 'bots') return startHumanTurnMaybe(token);
    if (App.Settings.mode === 'hotseat') showHotSeatOverlay();
  }

  async function dealerTurn(token) {
    if (!stillActive(token)) return;
    renderDealer(true);
    await sleep(600);
    if (!stillActive(token)) return;
    while (true) {
      const t = handTotal(App.dealer.hand);
      if (t.bust) break;
      // S17 house rule: stand on every total ≥ 17 (covers hard 17
      // and soft 17). The previous `t.total === 17 && t.soft` check
      // was dead — the `t.total >= 17` line above catches every 17
      // before the soft check could run.
      if (t.total >= 17) break;
      App.dealer.hand.push(App.deck.pop());
      renderDealer(true);
      await sleep(450);
      if (!stillActive(token)) return;
    }
    App.dealer.finished = true;
    settleRound();
  }

  function settleRound() {
    App.roundOver = true;
    const dh = handTotal(App.dealer.hand);
    const dealerBust = dh.bust;
    const dealerHasBJ = isBlackjack(App.dealer.hand);

    let totalNet = 0;
    const results = [];
    for (const s of App.seats) {
      const t = handTotal(s.hand);
      let outcome, payout = 0;
      if (s.bust) { outcome = 'Bust'; payout = 0; }
      else if (s.blackjack && dealerBust) { outcome = 'Blackjack · dealer busts'; payout = s.bet + Math.floor(s.bet * 1.5); }
      else if (s.blackjack && !dealerHasBJ) { outcome = 'Blackjack 3:2'; payout = s.bet + Math.floor(s.bet * 1.5); }
      else if (s.blackjack && dealerHasBJ) { outcome = 'Push · both BJ'; payout = s.bet; }
      else if (dealerBust) { outcome = 'Dealer busts · Win'; payout = s.bet * 2; }
      else if (t.total > dh.total) { outcome = 'Win'; payout = s.bet * 2; }
      else if (t.total === dh.total) { outcome = 'Push'; payout = s.bet; }
      else { outcome = 'Lose'; payout = 0; }
      results.push({ seat: s, outcome, payout, pnl: payout - s.bet });
      totalNet += (payout - s.bet);
    }
    const html = results.map(r => `
      <div class="bj-result-row ${r.pnl > 0 ? 'win' : r.pnl < 0 ? 'lose' : 'push'}">
        <div class="bj-r-name">${escapeHtml(r.seat.name)}:</div>
        <div class="bj-r-outcome">${r.outcome}</div>
        <div class="bj-r-pnl">${r.pnl > 0 ? '+' : ''}${r.pnl}</div>
      </div>`).join('');
    $('#bjRoundResults').innerHTML = `
      <div class="bj-dealer-result">Dealer: ${dh.total}${dh.bust ? ' (BUST)' : ''} · ${App.dealer.hand.map(c => cardHtmlInline(c)).join('')}</div>
      ${html}`;
    $('#bjRoundTitle').textContent = totalNet >= 0 ? 'You Win!' : 'House Wins';
    $('#bjRoundOverlay').classList.remove('hidden');
    settleToWallet(results);
  }

  function settleToWallet(results) {
    // Hot-seat is sandboxed: nothing transfers to/from the wallet.
    if (App.Settings.mode === 'hotseat') return;
    // The player cashed out mid-round: forfeit already deducted the
    // bet, and App.seats was cleared. Skip the second adjustment.
    if (!App.seats || !App.seats.length) return;
    const humanIdxs = (App.Settings.mode === 'bots') ? [0] : App.humanSeatIdxs;
    if (!window.Wallet) return;
    let humanDelta = 0;
    let humanHands = 0;
    for (const idx of humanIdxs) {
      const r = results.find(x => x.seat === App.seats[idx]);
      if (!r) continue;
      // Each round's wallet delta is `r.pnl` (= payout − bet), which
      // already includes the net result of:
      //   win   → +bet       (r.pnl = 2·bet − bet = +bet)
      //   lose  → −bet       (r.pnl = 0 − bet)
      //   push  → 0          (r.pnl = bet − bet)
      //   natural BJ → +1.5·bet
      // The bet was virtual throughout the round (no upfront buy-in,
      // no per-round rebuy), so adding r.pnl here is the single source
      // of truth for one round's wallet impact — never a double-charge.
      humanDelta += r.pnl;
      humanHands += 1;
    }
    Wallet.adjust(humanDelta, { game: 'blackjack round' });
    Wallet.handsPlayed = (Wallet.handsPlayed || 0) + 1;
  }

  async function nextRound() {
    const token = App.runToken;
    if (!stillActive(token)) return;
    // Bots mode: balance must cover the min bet, otherwise the player
    // can't fund the round. Hot-seat is sandboxed so no check needed.
    if (App.Settings.mode === 'bots' && Wallet.balance < App.Settings.minBet) {
      toast('Not enough chips for next round.');
      return;
    }
    $('#bjRoundOverlay').classList.add('hidden');
    dealRound(token);
  }

  function onBjAction(action) {
    const s = App.seats[App.currentSeatIdx];
    if (!s) return;
    if (action === 'hit') {
      s.hand.push(App.deck.pop());
      const t = handTotal(s.hand);
      if (t.bust) { s.bust = true; s.finished = true; renderSeats(); }
      else renderSeats();
    } else if (action === 'stand') {
      s.finished = true;
      renderSeats();
    } else if (action === 'double') {
      performDouble(s);
    } else if (action === 'deal') {
      nextRound(); return;
    }
    updateActionUI();
    if (s.finished) advanceToNextOrSettle(App.runToken);
  }

  // Sync the lobby sliders against current App.Settings + tier + wallet.
  // The bots/hot-count sliders have fixed ranges (1–3 / 2–6); the min-bet
  // slider is tier-driven (min = Casino.getBjMin(), max = ceil(balance/5)*5,
  // step = 5 universally so the value always reads as a clean multiple).
  function refreshBjLobbySliders() {
    const tierMin = (window.Casino && Casino.getBjMin) ? Casino.getBjMin() : 10;
    const bal = (window.Wallet && typeof Wallet.balance === 'number') ? Wallet.balance : 1000;
    const ceilBalToStep = Math.ceil(bal / 5) * 5;
    // Bots slider
    const bs = document.getElementById('bjBotsSlider');
    if (bs) {
      App.Settings.bots = clamp(App.Settings.bots, 1, 3);
      bs.value = String(App.Settings.bots);
      const bv = document.getElementById('bjBotsValue');
      if (bv) bv.textContent = String(App.Settings.bots);
    }
    // Hot-seat slider
    const hs = document.getElementById('bjHotCountSlider');
    if (hs) {
      App.Settings.hotCount = clamp(App.Settings.hotCount, 2, 6);
      hs.value = String(App.Settings.hotCount);
      const hv = document.getElementById('bjHotCountValue');
      if (hv) hv.textContent = String(App.Settings.hotCount);
    }
    // Min-bet slider — tier-driven bounds with step=5.
    const ms = document.getElementById('bjMinBetSlider');
    if (ms) {
      ms.min = String(tierMin);
      ms.max = String(Math.max(tierMin, ceilBalToStep));
      ms.step = '5';
      if (App.Settings.minBet < tierMin) App.Settings.minBet = tierMin;
      if (App.Settings.minBet > ceilBalToStep) App.Settings.minBet = ceilBalToStep;
      // Force the slider's stored value to a valid step-aligned multiple
      // so dragging the thumb can't leave the App.Settings state holding
      // a non-snap value (e.g. 233).
      App.Settings.minBet = Math.max(tierMin, Math.round(App.Settings.minBet / 5) * 5);
      ms.value = String(App.Settings.minBet);
      // Read back — the browser may clamp on display, keep state consistent.
      App.Settings.minBet = parseInt(ms.value, 10) || App.Settings.minBet;
      const mv = document.getElementById('bjMinBetValue');
      if (mv) mv.textContent = String(App.Settings.minBet);
    }
    // Hint copy
    const hint = document.getElementById('bjMinBetHint');
    if (hint && window.Casino && typeof window.Casino.getTier === 'function') {
      const tier = window.Casino.getTier();
      hint.textContent = `${tier.name} minimum ${tierMin} · bets deduct per round`;
    }
    // Initial paint of all three sliders' progress fill.
    if (window.Casino && typeof Casino.paintSliderProgress === 'function') {
      ['bjBotsSlider', 'bjHotCountSlider', 'bjMinBetSlider'].forEach(id => {
        const el = document.getElementById(id);
        if (el) Casino.paintSliderProgress(el);
      });
    }
  }

  function setupLobby() {
    $$('#blackjackScreen .bj-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#blackjackScreen .bj-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        App.Settings.mode = btn.dataset.bjmode;
        $('#bjBotsOptions').classList.toggle('hidden', App.Settings.mode !== 'bots');
        $('#bjHotOptions').classList.toggle('hidden', App.Settings.mode !== 'hotseat');
        // Adjust hint copy to clarify hot-seat is a wallet-isolated sandbox.
        const hint = document.querySelector('#blackjackLobby .form-row small');
        if (hint) {
          if (App.Settings.mode === 'hotseat') {
            hint.textContent = 'Sandboxed: chips live at the table only — your bankroll is untouched.';
          } else {
            hint.textContent = 'Each round costs the min bet from your wallet · Blackjacks pay 3:2';
          }
        }
      });
    });
    // Slider input handlers (replace +/- counters).
    const sliderMap = [
      { id: 'bjBotsSlider',     key: 'bots',     valId: 'bjBotsValue' },
      { id: 'bjHotCountSlider', key: 'hotCount', valId: 'bjHotCountValue' },
      { id: 'bjMinBetSlider',   key: 'minBet',   valId: 'bjMinBetValue' },
    ];
    sliderMap.forEach(({ id, key, valId }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = parseInt(el.value, 10) || 0;
        App.Settings[key] = v;
        const disp = document.getElementById(valId);
        if (disp) disp.textContent = String(v);
        window.Casino?.paintSliderProgress?.(el);
      });
    });
    $('#bjStartBtn').addEventListener('click', startGame);
    $('#bjNextRoundBtn').addEventListener('click', nextRound);
    $('#bjLeaveBtn').addEventListener('click', cashOut);
    $('#bjHotReadyBtn').addEventListener('click', () => {
      hideHotSeatOverlay();
      updateActionUI();
    });
    $$('#blackjackScreen .bj-action').forEach(b => b.addEventListener('click', () => onBjAction(b.dataset.bj)));
    // The lobby already has a "← Back to Casino" data-back button for
    // pre-table cancel. The table-level cancel row was removed by user
    // request — keep the existing top data-back button for in-table exit.
    // Initial sync (also covers return to lobby after a tier upgrade).
    refreshBjLobbySliders();
  }

  function open() {
    if (!window.Wallet) return;
    // Show the lobby (AI bot selection area) so the user can pick
    // game mode, bot count, and min bet before sitting down. The
    // existing "Sit Down" button in the lobby then calls startGame().
    Casino.showScreen('blackjackScreen');
    document.querySelectorAll('#blackjackScreen .screen').forEach(s => s.classList.remove('active'));
    $('#blackjackLobby').classList.add('active');
    refreshBjLobbySliders();
    Casino.refreshAllBalances();
  }

  function startGame() {
    if (!window.Wallet) return;
    // Refresh tier-derived min bet in case the user unlocked a higher
    // casino while sitting in the lobby.
    if (window.Casino && Casino.getBjMin) App.Settings.minBet = Casino.getBjMin();
    const bv = $('#bjMinBetValue'); if (bv) bv.textContent = String(App.Settings.minBet);
    // No upfront buy-in deduction: each round's bet is virtual until
    // settle, at which point settleToWallet() applies r.pnl (= payout
    // − bet) to the wallet. This means a Principiante player with 250
    // chips can sit down at any tier's table without being locked out
    // by an arbitrary entry fee.
    // Hot-seat is sandboxed: chips live at the table only, wallet untouched.
    App.runToken += 1;
    buildSeatsFromSettings();
    clearTableUI();
    Casino.showScreen('blackjackScreen');
    document.querySelectorAll('#blackjackScreen .screen').forEach(s => s.classList.remove('active'));
    $('#blackjackTable').classList.add('active');
    Casino.refreshAllBalances();
    dealRound(App.runToken);
  }

  async function cashOut() {
    // Forfeit any in-progress round: if a bet is set on the human seat,
    // deduct it from the wallet since settleToWallet won't run (the
    // round is being abandoned). Between rounds the bet is 0, so this
    // is a no-op. If there's a bet to lose, ask the user to confirm
    // before mutating any state; cancelling leaves the round intact.
    let forfeited = 0;
    if (App.Settings.mode !== 'hotseat' && App.seats && App.seats.length) {
      const idx = (App.Settings.mode === 'bots') ? 0 : App.humanSeatIdxs[0];
      const bet = App.seats[idx] && App.seats[idx].bet;
      forfeited = bet && bet > 0 ? bet : 0;
    }
    if (forfeited > 0) {
      const ok = await window.Casino.confirmForfeit(
        'Leave the table?',
        `You'll forfeit your in-progress bet of ${forfeited.toLocaleString()} chips. This cannot be undone.`
      );
      if (!ok) return; // user cancelled — stay at the table
    }
    // User confirmed (or no forfeit). Cancel pending async and tear down.
    App.runToken += 1;
    if (forfeited > 0 && window.Wallet) {
      Wallet.adjust(-forfeited, { game: 'blackjack-leave' });
    }
    App.seats = [];
    document.querySelectorAll('#blackjackScreen .screen').forEach(s => s.classList.remove('active'));
    $('#blackjackLobby').classList.add('active');
    $('#bjRoundOverlay').classList.add('hidden');
    $('#bjActions').classList.add('hidden');
    $('#bjHotOverlay')?.classList.add('hidden');
    Casino.refreshAllBalances();
    if (forfeited > 0) toast('Left mid-round · lost ' + forfeited + ' chips.');
  }

  window.BlackjackApp = { open, cashOut, startGame, nextRound, refreshBjLobbySliders };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLobby);
  } else {
    setupLobby();
  }
})();
