/* =====================================================
   POKER — Texas Hold'em module (loaded as poker.js)
   Players share a casino wallet. Buy-in deducts from wallet;
   at cash-out we add (final chips - buyin) as net P&L.
===================================================== */
(function () {
  'use strict';

  // ---------------- Constants ----------------
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_IS_RED = { '♠': false, '♣': false, '♥': true, '♦': true };
  const RANK_LABELS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const AI_NAMES = ['Bluffmaster','Chip Hunter','River Rat','Stone Cold','Quiet Quinn','Diamond Doc'];
  const COLOR_CHIPS = ['red','blue','green','black'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function toast(msg, ms = 1500) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // "Bluffmaster checks" / "You check" — the human player's name is "You"
  // so 2nd-person present-tense verbs drop the trailing -s. Past-tense
  // verbs like "folded" are invariant and need no inflection.
  function verbSubject(player, verb) {
    if (player && player.name === 'You') return `You ${verb}`;
    return `${player.name} ${verb}s`;
  }

  // ---------------- Deck ----------------
  function createDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++)
      d.push({ rank: r, suit: s, isRed: SUIT_IS_RED[s], label: RANK_LABELS[r - 2] + s });
    return d;
  }
  function shuffle(deck) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  // ---------------- Hand evaluation ----------------
  function evaluate5(cards) {
    const sorted = [...cards].sort((a, b) => b.rank - a.rank);
    const ranks = sorted.map(c => c.rank);
    const isFlush = sorted.every(c => c.suit === sorted[0].suit);
    const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
    let isStraight = false, straightHigh = 0;
    for (let i = 0; i <= uniqueRanks.length - 5; i++) {
      if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) { isStraight = true; straightHigh = uniqueRanks[i]; break; }
    }
    if (!isStraight && uniqueRanks.includes(14) && uniqueRanks.includes(5) &&
        uniqueRanks.includes(4) && uniqueRanks.includes(3) && uniqueRanks.includes(2)) {
      isStraight = true; straightHigh = 5;
    }
    const cnt = {};
    for (const c of sorted) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
    const counts = Object.entries(cnt)
      .map(([r, n]) => ({ rank: +r, count: n }))
      .sort((a, b) => b.count - a.count || b.rank - a.rank);
    if (isFlush && isStraight) {
      if (straightHigh === 14) return { rank: 10, name: 'Royal Flush', kickers: [] };
      return { rank: 9, name: 'Straight Flush', kickers: [straightHigh] };
    }
    if (counts[0].count === 4) return { rank: 8, name: 'Four of a Kind', kickers: [counts[0].rank, counts[1].rank] };
    if (counts[0].count === 3 && counts[1] && counts[1].count === 2) return { rank: 7, name: 'Full House', kickers: [counts[0].rank, counts[1].rank] };
    if (isFlush) return { rank: 6, name: 'Flush', kickers: ranks };
    if (isStraight) return { rank: 5, name: 'Straight', kickers: [straightHigh] };
    if (counts[0].count === 3) {
      const trips = counts[0].rank;
      const kickers = sorted.filter(c => c.rank !== trips).map(c => c.rank);
      return { rank: 4, name: 'Three of a Kind', kickers: [trips, ...kickers] };
    }
    if (counts[0].count === 2 && counts[1] && counts[1].count === 2) {
      const pairs = [counts[0].rank, counts[1].rank].sort((a, b) => b - a);
      const kicker = sorted.find(c => c.rank !== pairs[0] && c.rank !== pairs[1]).rank;
      return { rank: 3, name: 'Two Pair', kickers: [...pairs, kicker] };
    }
    if (counts[0].count === 2) {
      const pair = counts[0].rank;
      const kickers = sorted.filter(c => c.rank !== pair).map(c => c.rank);
      return { rank: 2, name: 'Pair', kickers: [pair, ...kickers] };
    }
    return { rank: 1, name: 'High Card', kickers: ranks };
  }
  function combinations(cards, k) {
    const r = []; const n = cards.length;
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      r.push(idx.map(i => cards[i]));
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    return r;
  }
  function bestHand(cards) {
    if (cards.length < 5) return null;
    if (cards.length === 5) return evaluate5(cards);
    const cbs = combinations(cards, 5);
    let best = evaluate5(cbs[0]);
    for (let i = 1; i < cbs.length; i++) {
      const e = evaluate5(cbs[i]);
      if (compareHands(e, best) > 0) best = e;
    }
    return best;
  }
  function compareHands(h1, h2) {
    if (h1.rank !== h2.rank) return h1.rank - h2.rank;
    const n = Math.max(h1.kickers.length, h2.kickers.length);
    for (let i = 0; i < n; i++) {
      const a = h1.kickers[i] ?? 0;
      const b = h2.kickers[i] ?? 0;
      if (a !== b) return a - b;
    }
    return 0;
  }

  // ---------------- AI ----------------
  function preflopStrength(hole) {
    if (hole.length < 2) return 0;
    const r1 = hole[0].rank, r2 = hole[1].rank;
    const high = Math.max(r1, r2), low = Math.min(r1, r2);
    const suited = hole[0].suit === hole[1].suit;
    const gap = high - low;
    if (r1 === r2) return 0.45 + (high - 2) / 12 * 0.5;
    let s = (high - 2) / 12 * 0.55;
    if (low >= 10) s += 0.06;
    if (suited) s += 0.12;
    if (gap === 1) s += 0.10;
    else if (gap === 2) s += 0.05;
    else if (gap >= 5) s -= 0.08;
    if (high === 14) s += 0.04;
    return clamp(s, 0, 0.95);
  }
  function postflopStrength(cards) {
    const h = bestHand(cards); if (!h) return 0;
    let s = (h.rank - 1) / 9;
    if (h.kickers.length) s += h.kickers[0] / 14 * 0.05;
    return clamp(s, 0, 1);
  }
  function aiPersonality(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h * 31) + name.charCodeAt(i)) | 0;
    return ((h % 1000) / 1000);
  }
  // Tier-driven AI: the AI scalar (1.0 → 2.0) raises aggression AND lowers
  // both the call threshold and the raise threshold — so tier-5 bots are
  // tighter (fold more marginal hands) AND more aggressive (raise more
  // with strong holdings). The deck, hand evaluator, and pot math are
  // never altered — every round is decided by the same shuffled deck.
  function aiDecision(player, game) {
    const personality = aiPersonality(player.name);
    const tierScalar = (window.Casino && Casino.getAIScalar) ? Casino.getAIScalar() : 1.0;
    const skill = clamp(tierScalar - 1, 0, 1);          // 0..1
    const aggression = clamp(0.4 + personality * 0.5 + skill * 0.25, 0.3, 0.98);
    const tightness = clamp(1 - aggression + skill * 0.2, 0.1, 0.95);
    const livePlayers = game.players.filter(p => !p.folded);
    const position = livePlayers.indexOf(player);
    const posFactor = livePlayers.length > 1 ? position / (livePlayers.length - 1) : 0;
    const callAmt = Math.max(0, game.currentBet - player.currentBet);
    const potOdds = callAmt > 0 ? callAmt / (game.pot + callAmt) : 0;
    let score;
    if (game.bettingRound === 'preflop') score = preflopStrength(player.holeCards);
    else score = postflopStrength([...player.holeCards, ...game.communityCards]);
    // Higher skill = better hand-selection (less noise, more position awareness)
    const noiseBand = (0.08 - skill * 0.05);            // 0.08 → 0.03
    score += posFactor * (0.08 + skill * 0.04) * aggression;
    score = score * (0.55 + skill * 0.1) + aggression * (0.45 - skill * 0.1);
    score += rand(-noiseBand, noiseBand);
    score = clamp(score, 0, 1);
    if (callAmt === 0) {
      // Free card — bet made hands and strong draws, check marginal hands.
      // Threshold lower than the called branch so the AI is actually willing
      // to bet with good (not just premium) holdings when nobody has bet.
      // Late position gets a small boost — position is information.
      const posBoost = posFactor * 0.10;           // 0..0.10
      const raiseT = 0.32 + 0.28 * aggression + skill * 0.05 - posBoost;
      if (score > raiseT) {
        return { type: 'raise', multiplier: 0.45 + aggression * 0.65 + rand(0, 0.30) };
      }
      return { type: 'check' };
    }
    const raiseT2 = 0.6 + 0.2 * aggression - skill * 0.08;
    if (score > raiseT2) return { type: 'raise', multiplier: 0.5 + aggression * 0.7 + rand(0, 0.25) };
    // Skillier bots need a stronger hand to call (tight loose-passive play).
    if (score > potOdds + (0.06 + skill * 0.06) - 0.1 * tightness) return { type: 'call' };
    return { type: 'fold' };
  }

  // ---------------- Game state ----------------
  class Player {
    constructor(name, isAI, chips) {
      this.name = name; this.isAI = isAI; this.chips = chips;
      this.holeCards = []; this.folded = false; this.allIn = false;
      this.currentBet = 0; this.totalBet = 0; this.seatIdx = -1;
    }
  }
  class PokerGame {
    constructor({ players, blinds = { small: 5, big: 10 }, mode }) {
      this.players = players.map((p, i) => {
        const pl = new Player(p.name, p.isAI, p.chips);
        pl.seatIdx = i; return pl;
      });
      this.blinds = blinds; this.mode = mode;
      this.deck = []; this.communityCards = []; this.pot = 0;
      this.dealerIdx = -1; this.currentBet = 0;
      this.lastRaiseSize = blinds.big; this.bettingRound = null;
      this.activeIdx = 0; this.winners = []; this.handInProgress = false;
      this.roundActed = new Set(); // indices that have explicitly acted this betting round
    }
    livePlayers() { return this.players.filter(p => !p.folded); }
    nextEligibleSeat(fromIdx) {
      if (!this.players.length) return -1;
      let i = (fromIdx + 1) % this.players.length, guard = 0;
      while (this.players[i].chips <= 0 && guard < this.players.length) { i = (i + 1) % this.players.length; guard++; }
      return i;
    }
    startNewHand() {
      const eligible = this.players.filter(p => p.chips > 0);
      if (eligible.length < 2) return false;
      for (const p of this.players) {
        p.holeCards = []; p.folded = false; p.allIn = false;
        p.currentBet = 0; p.totalBet = 0;
      }
      this.communityCards = []; this.pot = 0; this.currentBet = 0;
      this.lastRaiseSize = this.blinds.big;
      this.bettingRound = 'preflop'; this.winners = []; this.handInProgress = true;
      this.roundActed = new Set();
      do { this.dealerIdx = (this.dealerIdx + 1) % this.players.length; }
      while (this.players[this.dealerIdx].chips <= 0);
      this.deck = shuffle(createDeck());
      const isHeadsUp = this.players.length === 2;
      const sbIdx = isHeadsUp ? this.dealerIdx : this.nextEligibleSeat(this.dealerIdx);
      const bbIdx = this.nextEligibleSeat(sbIdx);
      this.sbIdx = sbIdx;
      this.bbIdx = bbIdx;
      this.placeBet(sbIdx, Math.min(this.blinds.small, this.players[sbIdx].chips));
      this.placeBet(bbIdx, Math.min(this.blinds.big, this.players[bbIdx].chips));
      this.currentBet = Math.min(this.blinds.big, this.players[bbIdx].chips);
      for (let i = 0; i < 2; i++) for (let s = 0; s < this.players.length; s++) {
        if (this.players[s].chips > 0 || this.players[s].totalBet > 0)
          this.players[s].holeCards.push(this.deck.pop());
      }
      this.activeIdx = isHeadsUp ? bbIdx : this.nextEligibleSeat(bbIdx);
      return true;
    }
    placeBet(playerIdx, amount) {
      const p = this.players[playerIdx];
      const actual = Math.min(amount, p.chips);
      p.chips -= actual; p.currentBet += actual; p.totalBet += actual;
      this.pot += actual;
      if (p.chips === 0) p.allIn = true;
      return actual;
    }
    canCheck() { return this.players[this.activeIdx].currentBet === this.currentBet; }
    callAmount() { return Math.max(0, this.currentBet - this.players[this.activeIdx].currentBet); }
    minRaiseTo() { return this.currentBet + this.lastRaiseSize; }
    maxRaiseTo() { const p = this.players[this.activeIdx]; return p.currentBet + p.chips; }
    raiseTo(playerIdx, targetTotal) {
      const p = this.players[playerIdx];
      const max = p.currentBet + p.chips;
      targetTotal = Math.min(targetTotal, max);
      if (targetTotal <= this.currentBet) return { ok: false, reason: 'not a raise' };
      const increase = targetTotal - this.currentBet;
      if (increase < this.lastRaiseSize && targetTotal < max) return { ok: false, reason: 'min raise not met' };
      this.lastRaiseSize = Math.max(increase, this.lastRaiseSize);
      this.currentBet = targetTotal;
      this.placeBet(playerIdx, targetTotal - p.currentBet);
      return { ok: true };
    }
    advanceTurn() {
      if (this.livePlayers().length <= 1) { this.endHand(); return { kind: 'handEnd' }; }
      let guard = 0;
      do { this.activeIdx = (this.activeIdx + 1) % this.players.length; guard++; }
      while (guard <= this.players.length &&
             (this.players[this.activeIdx].folded || this.players[this.activeIdx].allIn || this.players[this.activeIdx].chips <= 0));
      if (this.bettingRoundComplete()) return this.endBettingRound();
      return { kind: 'nextTurn' };
    }
    bettingRoundComplete() {
      const active = this.players.filter(p => !p.folded && !p.allIn && p.chips > 0);
      if (active.length <= 1) return true;
      // Existing check: every live player has matched the current bet.
      if (!active.every(p => p.currentBet === this.currentBet)) return false;
      // NEW: action must have reached every live player at least once.
      // Without this, a post-flop round where currentBet=0 would end after
      // the first check (everyone starts with currentBet=0). The round must
      // cycle around the table so every player gets a chance to act.
      for (const p of active) {
        if (!this.roundActed.has(p.seatIdx)) return false;
      }
      return true;
    }
    endBettingRound() {
      for (const p of this.players) p.currentBet = 0;
      this.currentBet = 0; this.lastRaiseSize = this.blinds.big;
      this.roundActed = new Set(); // reset for the next street
      if (this.bettingRound === 'preflop') {
        this.bettingRound = 'flop'; this.deck.pop();
        for (let i = 0; i < 3; i++) this.communityCards.push(this.deck.pop());
      } else if (this.bettingRound === 'flop') {
        this.bettingRound = 'turn'; this.deck.pop(); this.communityCards.push(this.deck.pop());
      } else if (this.bettingRound === 'turn') {
        this.bettingRound = 'river'; this.deck.pop(); this.communityCards.push(this.deck.pop());
      } else if (this.bettingRound === 'river') {
        this.bettingRound = 'showdown'; this.activeIdx = -1; return { kind: 'showdown' };
      }
      const leftToAct = this.players.filter(p => !p.folded && !p.allIn && p.chips > 0);
      if (leftToAct.length < 2) {
        while (this.communityCards.length < 5) { this.deck.pop(); this.communityCards.push(this.deck.pop()); }
        this.bettingRound = 'showdown'; this.activeIdx = -1; return { kind: 'showdown' };
      }
      const sbIdx = this.nextEligibleSeat(this.dealerIdx);
      this.activeIdx = sbIdx;
      let guard = 0;
      while (guard < this.players.length &&
             (this.players[this.activeIdx].folded || this.players[this.activeIdx].allIn || this.players[this.activeIdx].chips <= 0)) {
        this.activeIdx = (this.activeIdx + 1) % this.players.length; guard++;
      }
      return { kind: 'nextRound', round: this.bettingRound };
    }
    endHand() {
      this.handInProgress = false; this.bettingRound = 'showdown'; this.activeIdx = -1;
      this.computeWinners(); return { kind: 'showdown' };
    }
    computeWinners() {
      const live = this.livePlayers();
      if (live.length === 1) {
        const w = live[0]; w.chips += this.pot;
        this.winners = [{ player: w, amount: this.pot, hand: 'Last standing' }];
        this.pot = 0; return;
      }
      const standings = live.map(p => ({ player: p, hand: bestHand([...p.holeCards, ...this.communityCards]) }));
      const allBets = [...new Set(this.players.map(p => p.totalBet))].sort((a, b) => a - b);
      const pots = [];
      let prev = 0;
      for (const lvl of allBets) {
        const contributors = this.players.filter(p => p.totalBet >= lvl);
        if (!contributors.length) continue;
        const sliceTotal = (lvl - prev) * contributors.length;
        const candidates = live.filter(p => p.totalBet >= lvl);
        prev = lvl;
        if (!candidates.length || !sliceTotal) continue;
        pots.push({ amount: sliceTotal, candidates });
      }
      this.winners = [];
      for (const pot of pots) {
        let best = pot.candidates[0];
        let bestHandResult = standings.find(s => s.player === best).hand;
        for (const c of pot.candidates) {
          const h = standings.find(s => s.player === c).hand;
          if (compareHands(h, bestHandResult) > 0) { best = c; bestHandResult = h; }
        }
        const tied = pot.candidates.filter(c => {
          const h = standings.find(s => s.player === c).hand;
          return compareHands(h, bestHandResult) === 0;
        });
        const share = Math.floor(pot.amount / tied.length);
        const remainder = pot.amount - share * tied.length;
        let remIdx = -1;
        if (remainder > 0) {
          let bestSeat = this.players.length + 1;
          for (const t of tied) {
            const d = (t.seatIdx - this.dealerIdx + this.players.length) % this.players.length;
            if (d > 0 && d < bestSeat) { bestSeat = d; remIdx = t.seatIdx; }
          }
        }
        for (const t of tied) {
          const amount = (t.seatIdx === remIdx) ? share + remainder : share;
          t.chips += amount;
          this.winners.push({ player: t, amount, hand: bestHandResult.name, community: this.communityCards });
        }
      }
      this.pot = 0;
    }
  }

  // ---------------- App state & UI ----------------
  const App = {
    Settings: { mode: 'ai', aiCount: 3, hsCount: 3, chips: 1000, blinds: (window.Casino && Casino.getBlindsBase) ? Casino.getBlindsBase() : 5 },
    game: null,
    currentPlayerSeat: 0,
    runToken: 0, // bumped on game start / cash-out to invalidate stale async chains
  };

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
  function setSeatHoleCards(idx, cards, faceUp = false) {
    const seat = document.querySelector(`.seat[data-idx="${idx}"]`);
    if (!seat) return;
    const hole = seat.querySelector('[data-hole]');
    hole.innerHTML = '';
    for (const c of cards) {
      // Cards appear in place (no drop-from-air animation). The card
      // persists on the table until a new hand is dealt or the player
      // folds out (handled in runShowdown / folded.classList).
      const el = faceUp ? cardEl(c, { size: 'small' }) : cardEl(null, { size: 'small' });
      hole.appendChild(el);
    }
  }

  function renderSeats() {
    const seats = $('#seats');
    if (!seats) return;
    seats.innerHTML = '';
    const N = App.game.players.length;
    for (let i = 0; i < N; i++) {
      const p = App.game.players[i];
      const div = document.createElement('div');
      div.className = 'seat';
      div.dataset.idx = i;
      const angle = (i / N) * 2 * Math.PI + Math.PI / 2;
      const xPct = 50 + 44 * Math.cos(angle);
      const yPct = 50 + 38 * Math.sin(angle);
      div.style.left = xPct + '%';
      div.style.top = yPct + '%';
      div.innerHTML = `
        <div class="seat-frame">
          <div class="dealer-marker">D</div>
          <div class="sb-marker">SB</div>
          <div class="bb-marker">BB</div>
          <div class="seat-name">${escapeHtml(p.name)}${p.isAI ? ' <span class="ai-tag">🤖</span>' : ''}</div>
          <div class="seat-chips"><span class="chip gold"></span><span class="chip-val">${p.chips}</span>
            <span class="seat-bet" data-bet>0</span></div>
          <div class="seat-folded-label">FOLDED</div>
          <div class="seat-hole" data-hole></div>
        </div>`;
      seats.appendChild(div);
    }
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])); }

  function updateSeats() {
    for (let i = 0; i < App.game.players.length; i++) {
      const p = App.game.players[i];
      const seat = document.querySelector(`.seat[data-idx="${i}"]`);
      if (!seat) continue;
      seat.classList.toggle('folded', p.folded);
      seat.classList.toggle('all-in', p.allIn && !p.folded);
      // In heads-up (2 players) the dealer IS the small blind, so the
      // dealer marker would visually overlap the SB marker. Hide the
      // dealer marker when it would share a seat with the SB marker.
      // (In heads-up startNewHand sets sbIdx === dealerIdx by construction,
      // so an explicit sbIdx check here is redundant.)
      const hideDealer = App.game.players.length === 2 && App.game.dealerIdx === i;
      seat.classList.toggle('dealer', App.game.dealerIdx === i && !hideDealer);
      seat.classList.toggle('sb', App.game.sbIdx === i);
      seat.classList.toggle('bb', App.game.bbIdx === i);
      seat.querySelector('.seat-name').innerHTML = escapeHtml(p.name) + (p.isAI ? ' <span class="ai-tag">🤖</span>' : '');
      seat.querySelector('.chip-val').textContent = p.chips;
      const betEl = seat.querySelector('[data-bet]');
      if (p.currentBet > 0) { betEl.textContent = 'bet ' + p.currentBet; betEl.classList.add('visible'); }
      else betEl.classList.remove('visible');
    }
  }

  function refreshPot() {
    $('#potAmount').textContent = App.game.pot.toLocaleString();
    const pile = $('#potChip');
    pile.innerHTML = '';
    // Mirror the amount under the chip stack on the felt so the pot is
    // visible without glancing at the top bar mid-action.
    const label = $('#potLabel');
    if (label) {
      label.textContent = App.game.pot > 0 ? App.game.pot.toLocaleString() : '—';
      label.classList.toggle('hidden', App.game.pot <= 0);
    }
    if (App.game.pot > 0) {
      const n = Math.min(5, Math.ceil(App.game.pot / Math.max(1, App.game.blinds.big * 4)));
      for (let i = 0; i < n; i++) {
        const c = document.createElement('span');
        c.className = 'chip ' + COLOR_CHIPS[i % COLOR_CHIPS.length];
        pile.appendChild(c);
      }
    }
  }
  function refreshCommunity() {
    const container = $('#communityCards');
    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      if (App.game.communityCards[i]) container.appendChild(cardEl(App.game.communityCards[i]));
      else {
        const slot = document.createElement('div');
        slot.className = 'card slot';
        container.appendChild(slot);
      }
    }
  }
  function roundLabel(r) {
    return ({ preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' })[r] || r;
  }

  // Sync the SB / BB / TURN HUD pills with the current game state.
  // Called from beginNewHand, advanceTurn, and endBettingRound so the
  // pills always reflect whose action it is and who is forced to bet.
  function updateStatusBar() {
    if (!App.game) return;
    const sbEl = $('#sbName');
    const bbEl = $('#bbName');
    const turnEl = $('#turnName');
    if (sbEl) sbEl.textContent = (App.game.players[App.game.sbIdx] && App.game.players[App.game.sbIdx].name) || '—';
    if (bbEl) bbEl.textContent = (App.game.players[App.game.bbIdx] && App.game.players[App.game.bbIdx].name) || '—';
    if (turnEl) turnEl.textContent = (App.game.players[App.game.activeIdx] && App.game.players[App.game.activeIdx].name) || '—';
  }

  function showActionPanel(acting) {
    $('#actionPanel').classList.remove('hidden');
    setSeatHoleCards(App.game.activeIdx, acting.holeCards, true);
    $('#actionPlayerName').textContent = acting.name;
    $('#actionPlayerChips').textContent = 'Chips: ' + acting.chips;
    const callAmt = App.game.callAmount();
    const callBtn = $('.call');
    callBtn.disabled = callAmt === 0;
    callBtn.textContent = callAmt > 0 ? 'Call ' + callAmt : 'Call';
    $('.check').disabled = !App.game.canCheck();
    const minR = App.game.minRaiseTo();
    const maxR = App.game.maxRaiseTo();
    const slider = $('#raiseSlider');
    slider.min = minR; slider.max = maxR;
    const suggest = Math.min(maxR, Math.max(minR, App.game.currentBet * 2));
    slider.value = suggest;
    updateRaiseDisplay();
    // Paint progress fill on the in-game raise slider.
    window.Casino?.paintSliderProgress?.(slider);
  }
  function updateRaiseDisplay() {
    const v = parseInt($('#raiseSlider').value, 10) || 0;
    $('#raiseAmount').textContent = v > 0 ? ('Raise to ' + v) : '—';
  }
  function applyRaisePreset(frac) {
    if (!App.game) return;
    let target;
    if (frac === 'allin') target = App.game.maxRaiseTo();
    else {
      const f = parseFloat(frac);
      const potSize = App.game.pot + App.game.callAmount();
      target = App.game.currentBet + Math.round(potSize * f);
      target = clamp(target, App.game.minRaiseTo(), App.game.maxRaiseTo());
    }
    $('#raiseSlider').value = target;
    $$('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.frac === frac));
    updateRaiseDisplay();
  }
  function onActionClick(action) {
    const p = App.game.players[App.game.activeIdx];
    if (!p || p.isAI) return;
    if (action === 'fold' || action === 'check' || action === 'call') executeAction(p, { type: action });
    else if (action === 'raise') executeAction(p, { type: 'raise', target: parseInt($('#raiseSlider').value, 10) });
  }

  async function executeAction(p, decision) {
    const myToken = App.runToken;
    let logMsg = '';
    if (decision.type === 'fold') { p.folded = true;      logMsg = verbSubject(p, 'fold'); }
    else if (decision.type === 'check')      logMsg = verbSubject(p, 'check');
    else if (decision.type === 'call') {
      if (App.game.callAmount() === 0)      logMsg = verbSubject(p, 'check');
      else { const amt = App.game.callAmount(); App.game.placeBet(App.game.activeIdx, amt);      logMsg = verbSubject(p, 'call') + ' ' + amt; }
    } else    if (decision.type === 'raise') {
      const minR = App.game.minRaiseTo(), maxR = App.game.maxRaiseTo();
      let target = typeof decision.target === 'number'
        ? clamp(decision.target, minR, maxR)
        : clamp(Math.round(App.game.currentBet * (1 + decision.multiplier)), minR, maxR);
      const r = App.game.raiseTo(App.game.activeIdx, target);
      if (!r.ok) {
        const need = App.game.callAmount();
        if (need > 0) { App.game.placeBet(App.game.activeIdx, need);      logMsg = verbSubject(p, 'call') + ' ' + need + " (couldn't raise)"; }
        else      logMsg = verbSubject(p, 'check') + " (couldn't raise)";
      } else      logMsg = verbSubject(p, 'raise') + ' to ' + target;
      p.allIn = p.chips === 0;
    }
    // Record this player's explicit action so the betting round knows
    // action has reached every live player.
    if (App.game.roundActed) App.game.roundActed.add(App.game.activeIdx);
    toast(logMsg, 1200);
    updateSeats(); refreshPot();
    // Slowed down so the player can follow the action.
    await sleep(1100);
    if (myToken !== App.runToken) return;
    const r = App.game.advanceTurn();
    if (r.kind === 'showdown') return runShowdown(myToken);
    return onTurnAction(myToken);
  }

  async function runAI(p) {
    // Slowed down a bit so the player can read each AI's decision.
    await sleep(1500 + Math.random() * 800);
    return aiDecision(p, App.game);
  }

  async function onTurnAction(token) {
    if (!App.game || !App.game.handInProgress) return;
    if (token !== undefined && token !== App.runToken) return;
    // Refresh SB / BB / TURN pills every time a new turn begins — covers
    // both intra-round advances AND post-street transitions (endBettingRound).
    updateStatusBar();
    // Hole cards are rendered once at the deal (beginNewHand) and STAY
    // on the table across turns. We deliberately do NOT re-render them
    // here, so the cards don't get wiped and re-added on every action.
    const acting = App.game.players[App.game.activeIdx];
    if (!acting || acting.folded || acting.allIn) {
      const r = App.game.advanceTurn();
      if (r.kind === 'showdown') return runShowdown(App.runToken);
      return onTurnAction(App.runToken);
    }
    $$('.seat').forEach(s => s.classList.remove('active-turn'));
    $('.seat[data-idx="' + App.game.activeIdx + '"]').classList.add('active-turn');
    refreshPot(); refreshCommunity(); updateSeats();
    $('#roundName').textContent = roundLabel(App.game.bettingRound);

    if (!acting.isAI) {
      if (App.game.mode === 'hotseat' && App.game.players.length > 1) {
        $('#hsPlayerName').textContent = acting.name + ' — your turn';
        $('#hsOverlay').classList.remove('hidden');
        $('#actionPanel').classList.add('hidden');
        return;
      }
      showActionPanel(acting); return;
    }
    $('#actionPanel').classList.add('hidden');
    const decision = await runAI(acting);
    if (App.runToken !== token && token !== undefined) return;
    await executeAction(acting, decision);
  }

  async function runShowdown(token) {
    if (token !== App.runToken) return;
    $('#actionPanel').classList.add('hidden');
    $$('.seat').forEach(s => s.classList.remove('active-turn'));
    for (let i = 0; i < App.game.players.length; i++) {
      const p = App.game.players[i];
      if (p.holeCards.length) {
        const seat = document.querySelector(`.seat[data-idx="${i}"]`);
        const hole = seat.querySelector('[data-hole]');
        hole.innerHTML = '';
        for (const c of p.holeCards) {
          const el = cardEl(c, { size: 'small' });
          el.classList.add('flip-anim');
          hole.appendChild(el);
        }
        await sleep(160);
        if (token !== App.runToken) return;
      }
    }
    if (!App.game.winners.length) App.game.computeWinners();
    for (const w of App.game.winners) {
      document.querySelector(`.seat[data-idx="${w.player.seatIdx}"]`).classList.add('winner');
    }
    const rows = App.game.players
      .filter(p => !p.folded || p.totalBet > 0)
      .map(p => {
        const h = bestHand([...p.holeCards, ...App.game.communityCards]);
        const isWinner = App.game.winners.some(w => w.player === p);
        const wonAmt = App.game.winners.filter(w => w.player === p).reduce((s, w) => s + w.amount, 0);
        return `
          <div class="showdown-row ${isWinner ? 'winner' : ''}">
            <div class="name">${escapeHtml(p.name)}${p.folded ? ' (folded)' : ''}</div>
            <div class="cards">${p.holeCards.map(c => cardHtmlInline(c)).join('')}</div>
            <div class="hand-name">${p.folded ? 'folded' : ((h ? h.name : '—') + (wonAmt > 0 ? ' — wins ' + wonAmt : ''))}</div>
          </div>`;
      }).join('');
    $('#showdownHands').innerHTML = rows;
    const winnersText = App.game.winners.map(w => `${escapeHtml(w.player.name)} (${w.hand}, ${w.amount})`).join(', ');
    $('#showdownMessage').innerHTML = `🏆 Winner${App.game.winners.length > 1 ? 's' : ''}: <strong>${winnersText}</strong>`;
    $('#showdownTitle').textContent = 'Showdown';
    $('#showdownOverlay').classList.remove('hidden');
    // Hot-seat hands don't count toward casino progression.
    if (App.game && App.game.mode !== 'hotseat') Wallet.handsPlayed += 1;
  }

  function cardHtmlInline(card) {
    return `<span class="card ${card.isRed ? 'red' : 'black'} tiny">
      <div class="corner"><span class="rank">${RANK_LABELS[card.rank - 2]}</span><span class="suit">${card.suit}</span></div>
      <span class="center-suit">${card.suit}</span></span>`;
  }

  async function beginNewHand() {
    if (!App.game) return;
    const eligible = App.game.players.filter(p => p.chips > 0);
    if (eligible.length < 2) {
      toast('Only one player left — cashing out.');
      setTimeout(cashOut, 1200);
      return;
    }
    if (!App.game.startNewHand()) return;
    $$('.seat').forEach(s => s.classList.remove('winner'));
    $('#potAmount').textContent = '0';
    $('#communityCards').innerHTML = '';
    for (let i = 0; i < 5; i++) $('#communityCards').appendChild(cardEl(null));
    updateSeats();
    for (let i = 0; i < App.game.players.length; i++) {
      // The human's hole cards stay face-up on the table from the deal
      // through the entire hand; AI/bot cards stay face-down until the
      // showdown. In hot-seat mode every seat is human so all face up.
      const isHuman = !App.game.players[i].isAI;
      setSeatHoleCards(i, App.game.players[i].holeCards, isHuman);
    }
    updateStatusBar();
    await sleep(450);
    if (App.runToken === undefined) { /* shouldn't happen */ }
    $('#roundName').textContent = 'Pre-Flop';
    onTurnAction(App.runToken);
  }

  function startGame() {
    // Commit buy-in: in AI mode, debit wallet at "Deal Me In" time so the
    // lobby counter works as expected (user adjusts, then commits).
    if (App.Settings.mode === 'ai') {
      const buyIn = (window.Casino && typeof Casino.currentBuyin === 'function')
        ? Casino.currentBuyin()
        : 0;
      if (Wallet.balance <= 0 || buyIn <= 0) {
        alert('Your bankroll is empty. Play to win, or use Reset to start a new run.');
        return;
      }
      const actual = Math.min(buyIn, Wallet.balance);
      App.Settings.chips = actual;
      window.Wallet.adjust(-actual, { game: 'poker-buyin' });
    } else if (App.Settings.mode === 'hotseat') {
      App.Settings.chips = window.Casino.currentBuyin() || 1000;
    }

    const players = [];
    if (App.Settings.mode === 'ai') {
      players.push({ name: 'You', isAI: false, chips: App.Settings.chips });
      for (let i = 0; i < App.Settings.aiCount; i++)
        players.push({ name: AI_NAMES[i % AI_NAMES.length] + (i >= AI_NAMES.length ? ' ' + (Math.floor(i / AI_NAMES.length) + 1) : ''),
                       isAI: true, chips: App.Settings.chips });
    } else {
      for (let i = 0; i < App.Settings.hsCount; i++)
        players.push({ name: 'Player ' + (i + 1), isAI: false, chips: App.Settings.chips });
    }
    App.game = new PokerGame({
      players,
      blinds: { small: App.Settings.blinds, big: App.Settings.blinds * 2 },
      mode: App.Settings.mode
    });
    App.currentPlayerSeat = 0;
    App.runToken += 1;
    renderSeats();
    document.querySelectorAll('#pokerScreen .screen').forEach(s => s.classList.remove('active'));
    $('#table').classList.add('active');
    $('#showdownOverlay').classList.add('hidden');
    beginNewHand();
  }

  function setupLobby() {
    $$('#pokerScreen .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#pokerScreen .mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        App.Settings.mode = btn.dataset.mode;
        $('#aiOptions').classList.toggle('hidden', App.Settings.mode !== 'ai');
        $('#hotOptions').classList.toggle('hidden', App.Settings.mode !== 'hotseat');
        // Adjust the buyin hint to clarify this table is sandboxed.
        const hint = $('#buyinHint');
        if (hint) {
          if (App.Settings.mode === 'hotseat') {
            hint.textContent = 'Sandboxed: starting chips live at the table only — your bankroll is untouched.';
          } else if (window.Wallet) {
            hint.textContent = 'Available: ' + Wallet.balance.toLocaleString();
          }
        }
      });
    });
    // Counter buttons for AI/Hot-seat opponent count only (buy-in / blinds now use sliders).
    $$('#pokerScreen .counter-btn[data-target="aiCount"], #pokerScreen .counter-btn[data-target="hsCount"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.target, dir = parseInt(btn.dataset.dir, 10);
        const cap = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const map = {
          aiCount: () => App.Settings.aiCount = cap(App.Settings.aiCount + dir, 3, 6),
          hsCount: () => App.Settings.hsCount = cap(App.Settings.hsCount + dir, 2, 6),
        };
        if (!map[t]) return;
        map[t]();
        const disp = {
          aiCount: () => String(App.Settings.aiCount),
          hsCount: () => String(App.Settings.hsCount),
        }[t]();
        const el = { aiCount: '#aiCountValue', hsCount: '#hsCountValue' }[t];
        $(el).textContent = disp;
      });
    });

    // Slider: buy-in (drives Casino._buyin, capped by tier min and bankroll).
    $('#buyinSlider')?.addEventListener('input', () => {
      const v = parseInt($('#buyinSlider').value, 10) || 0;
      if (window.Casino) window.Casino.setBuyin(v);
      const bsv = $('#buyinSliderValue');
      if (bsv) bsv.textContent = v.toLocaleString();
      if (window.Casino && Casino.paintSliderProgress) Casino.paintSliderProgress($('#buyinSlider'));
    });
    // Slider: blinds (small blind; big blind = 2×).
    $('#blindsSlider')?.addEventListener('input', () => {
      const v = parseInt($('#blindsSlider').value, 10) || 0;
      App.Settings.blinds = v;
      const blsv = $('#blindsSliderValue');
      if (blsv) blsv.textContent = `${v} / ${v * 2}`;
      if (window.Casino && Casino.paintSliderProgress) Casino.paintSliderProgress($('#blindsSlider'));
    });
    $('#startGameBtn').addEventListener('click', startGame);
    $('#leaveBtn').addEventListener('click', cashOut);
    $('#nextHandBtn').addEventListener('click', () => {
      $('#showdownOverlay').classList.add('hidden');
      beginNewHand();
    });
    $('#pokerCashOutBtn').addEventListener('click', cashOut);
    $('#hsReadyBtn').addEventListener('click', () => {
      $('#hsOverlay').classList.add('hidden');
      onTurnAction(App.runToken);
    });
    $$('#pokerScreen .action-btn').forEach(b => b.addEventListener('click', () => onActionClick(b.dataset.action)));
    $('#raiseSlider').addEventListener('input', () => {
      updateRaiseDisplay();
      window.Casino?.paintSliderProgress?.($('#raiseSlider'));
    });
    $$('#pokerScreen .preset-btn').forEach(b => b.addEventListener('click', () => applyRaisePreset(b.dataset.frac)));
    updateRaiseDisplay();
    refreshBuyinCap();
  }

  function refreshBuyinCap() {
    if (!window.Wallet || !window.Casino) return;
    const tier = (window.Casino && typeof Casino.getBlindsBase === 'function') ? Casino.getBlindsBase() : 5;
    // Sync the buy-in slider with current state (clamping on tier min / bankroll).
    const bs = $('#buyinSlider');
    const bsv = $('#buyinSliderValue');
    if (bs) {
      bs.min = tier;
      bs.max = Math.max(tier, Wallet.balance);
      if (window.Casino.currentBuyin() > Wallet.balance) window.Casino.setBuyin(Wallet.balance);
      if (window.Casino.currentBuyin() < tier) window.Casino.setBuyin(tier);
      bs.value = String(window.Casino.currentBuyin());
      if (bsv) bsv.textContent = parseInt(bs.value, 10).toLocaleString();
      Casino.paintSliderProgress?.(bs);
    }
    $('#buyinHint').textContent = `Bankroll: ${Wallet.balance.toLocaleString()} · Buy-in deducts on Deal Me In`;
    // Refresh tier-derived default blind (in case tier changed mid-session).
    if (typeof App.Settings.blinds !== 'number' || App.Settings.blinds < tier) {
      App.Settings.blinds = tier;
    }
    if (App.Settings.blinds > 50) App.Settings.blinds = 50;
    const bls = $('#blindsSlider');
    const blsv = $('#blindsSliderValue');
    if (bls) {
      bls.min = tier;
      bls.max = Math.max(tier, 50);
      bls.value = String(App.Settings.blinds);
      if (blsv) blsv.textContent = `${App.Settings.blinds} / ${App.Settings.blinds * 2}`;
      Casino.paintSliderProgress?.(bls);
    }
  }

  // Cash-out: in AI mode the human's table stack is forfeited when
  // leaving mid-game (the buy-in was already debited at Sit Down, and
  // the cancel/leave option is a real-money action once you've left
  // the lobby). In hot-seat mode chips never touched the wallet —
  // nothing to credit, peak & tier stay intact, and the chips just
  // disappear with the table. When there's a forfeit, the user is
  // asked to confirm via Casino.confirmForfeit() before any state is
  // mutated; cancelling returns the user to the table.
  async function cashOut() {
    if (!App.game) return;
    let forfeited = 0;
    if (App.game.mode !== 'hotseat') {
      const human = App.game.players.find(p => !p.isAI);
      forfeited = human ? human.chips : 0;
    }
    if (forfeited > 0) {
      const ok = await window.Casino.confirmForfeit(
        'Leave the table?',
        `You'll forfeit your table stack of ${forfeited.toLocaleString()} chips. This cannot be undone.`
      );
      if (!ok) return; // user cancelled — stay at the table
    }
    // User confirmed (or no forfeit). Now tear down the game.
    App.runToken += 1; // cancel any in-flight async chain
    App.game = null;
    document.querySelectorAll('#pokerScreen .screen').forEach(s => s.classList.remove('active'));
    $('#pokerLobbyScreen').classList.add('active');
    $('#showdownOverlay').classList.add('hidden');
    if (window.Casino) Casino.refreshAllBalances();
    if (forfeited > 0) toast(`Left the table — forfeited ${forfeited.toLocaleString()} chips.`, 2200);
  }

  function open() {
    if (!window.Wallet) return;
    // Refresh tier-derived blinds BEFORE drawing the lobby so the user
    // sees the current casino's minimum even if they tier-up'd earlier.
    if (window.Casino && Casino.getBlindsBase) App.Settings.blinds = Casino.getBlindsBase();
    if (App.Settings.mode === 'hotseat') {
      // Hot-seat is a fun sandbox: chips live at the table only, no
      // wallet deduction, no tier progression. Start chips = buyin counter.
      App.Settings.chips = window.Casino.currentBuyin() || 1000;
      Casino.showScreen('pokerScreen');
      document.querySelectorAll('#pokerScreen .screen').forEach(s => s.classList.remove('active'));
      $('#pokerLobbyScreen').classList.add('active');
      refreshBuyinCap();
      return;
    }
    // AI mode: navigate to lobby WITHOUT deducting yet. The player can
    // adjust their buy-in with the +/- controls before committing. The
    // wallet is debited at "Deal Me In" time (see startGame()).
    Casino.showScreen('pokerScreen');
    document.querySelectorAll('#pokerScreen .screen').forEach(s => s.classList.remove('active'));
    $('#pokerLobbyScreen').classList.add('active');
    refreshBuyinCap();
    if (window.Casino) Casino.refreshAllBalances();
  }

  window.PokerApp = { open, cashOut, leave: cashOut, isActive: () => !!App.game && App.game.handInProgress };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLobby);
  } else {
    setupLobby();
  }
})();
