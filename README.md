# 🎰 Casino Royale — Poker · Blackjack · Roulette

A browser-based casino suite with a shared wallet, five Italian-themed
casino tiers, and a hand-rolled implementation in **vanilla
HTML / CSS / JavaScript**. No frameworks, no build tools, no
external dependencies — just open `index.html` in any modern browser.

![Casino Menu](https://img.shields.io/badge/games-3-ffd76b?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-27ae60?style=flat-square)
![Tech](https://img.shields.io/badge/stack-vanilla_JS-f1c40f?style=flat-square)
![Status](https://img.shields.io/badge/status-token_wallet_only-7ea6e8?style=flat-square)

---

## 🎮 How to Play

1. Download or clone this repository.
2. Open `poker-game/index.html` in any modern browser
   (Chrome, Firefox, Edge, or Safari).
3. Pick a game from the Casino menu — Texas Hold'em, Blackjack, or
   European Roulette.
4. Your **bankroll**, **peak balance**, and **current casino tier**
   persist in the browser's `localStorage` between sessions.

> ⚠️ No install step. No server. No accounts. No real money.

---

## 🃏 Games

| Game | Modes |
|---|---|
| **Texas Hold'em** | vs AI bots (3–6 opponents) · Hot-seat multiplayer (2–6) |
| **Blackjack** | vs dealer with 1–3 bots · Hot-seat pass-and-play |
| **Roulette** | European single-zero · straight-up bets + outside bets (red/black, odd/even) |

---

## 🏛 Casino Tier Progression

Five Italian-themed casinos, each unlocked once your **peak** bankroll
crosses its threshold:

| Tier | Casino | Unlocks at | Min Bets | AI Skill |
|---|---|---|---|---|
| ✦ Principiante | **Caffè del Gioco** | 0 | 5 | 1.00× |
| ✦ Novizio | **Casino della Stella** | 500 | 25 | 1.25× |
| ✦ Avanzato | **Palazzo del Lusso** | 2,500 | 100 | 1.50× |
| ✦ Esperto | **Salone Reale** | 10,000 | 500 | 1.75× |
| ✦ Professionale | **Grand Casino Imperiale** | 50,000 | 2,500 | 2.00× |

Each tier scales AI aggressiveness (tighter folds, smarter raises)
and minimum bets. The underlying deck, shuffle, hand evaluator, and
roulette spin RNG are **never altered** — every round is fair.

---

## ✨ Features

- 🤖 **AI opponents** with tier-scaled aggression and basic-strategy play
- 👥 **Hot-seat multiplayer** — pass-and-play with friends on one device
- 💾 **Persistent progress** via `localStorage`
- 🔊 **Roulette audio** — WebAudio click-clack synced to ball orbit
- 🎨 **Five tier themes** — casino-menu gradient, accents, and overlay glow
  change per tier with a celebratory tier-up modal on promotion
- 📱 **Responsive** — playable on phones (felt shrinks, sliders resize)
- ⏯ **Forfeit-on-leave confirm** — generic modal asks "yes/no" before
  wiping your placed chips

---

## 📂 File Structure

```
poker-game/
├── index.html       # Casino menu + 3 game screens + wallet panel
├── style.css        # Green felt, cards, chips, 5 tier themes
├── casino.js        # Shared wallet, tier progression, navigation
├── poker.js         # Texas Hold'em engine — 944 lines of game logic
├── blackjack.js     # Dealer S17 + tier-scaled basic-strategy bot
└── roulette.js      # Animated SVG wheel + WebAudio ball ticks
```

| File | What it does |
|---|---|
| `casino.js` | Shared wallet (balance, peak, tier persistence), five-casino tier system, screen routing, generic confirm-forfeit modal |
| `poker.js` | Full Hold'em engine: hand evaluator (Royal Flush → High Card), blinds/buy-in, AI personalities, hot-seat pass-and-play |
| `blackjack.js` | Dealer S17 rule, deal/hit/stand/double, basic-strategy bot that scales with tier |
| `roulette.js` | Animated SVG wheel with counter-orbiting ivory ball, WebAudio click-clack, chip stacking, spectators |

---

## 🤖 AI-Assisted Development

This casino suite — including the game logic itself in
`casino.js`, `poker.js`, `blackjack.js`, `roulette.js`,
`index.html`, and `style.css` — was developed in collaboration
with **Buffy**, the AI coding agent behind [Freebuff](https://freebuff.com).

Per the project owner, the build was carried out across several
days using multiple terminals — Windows **Command Prompt**,
**PowerShell**, and **WSL/Ubuntu** — with each session rebuilding
upon the last. The game code was authored by Buffy through iterative
prompt-driven pair-programming, with the human project owner
defining direction, reviewing output, and curating the final result.

The human project owner also:

- Ran the final GitHub deployment (set up `git` identity, created
  the repository, and pushed the initial commits)
- Authored this `README.md` and the `LICENSE` file via collaboration
  with Buffy in the final session
- Will own the big change currently in planning (see follow-up
  commits on `main`)

> ℹ️ **About the git commit log.** Commits on `main` are
> attributed to *"Dong Sebastian"* because that was set as the
> git identity during the final deployment step. **The commit log
> is not a reliable indicator of line-level authorship** — it only
> records who configured `git` when the commit was made. Inspecting
> the source files directly is a more accurate way to evaluate who
> actually wrote the code.

---

## 📚 Credits & Resources

This project depends on **no external libraries, frameworks, or
CDN-hosted assets**. Every byte ships with the repo. It uses only
standard, browser-native APIs:

| API | Used for |
|---|---|
| **HTML5 / CSS3** | Layout, custom slider styling, gradients, theme variables |
| **JavaScript (ES2020+)** | Game engines, hand evaluators, animation loops |
| **WebAudio API** (AudioContext) | Roulette ball click-clack sound effects |
| **`localStorage`** | Persisting bankroll, peak balance, tier, hands played |
| **SVG** | Animated roulette wheel (annular wedges), cards, pointer |

### Game-rule & strategy references

| Game | Reference |
|---|---|
| **Texas Hold'em** | Standard no-limit rules; hand rankings follow the canonical 9-tier poker hierarchy (Royal Flush → High Card) as published by the [WSOP](https://www.wsop.com/poker-hands/). |
| **Blackjack** | "Dealer stands on all 17s" (S17 rule). Bot strategy approximates the basic-strategy table as originally analysed by [Edward O. Thorp](https://en.wikipedia.org/wiki/Edward_O._Thorp) in *Beat the Dealer* (1962). |
| **Roulette** | European **single-zero** wheel layout (37 pockets, 0–36) using the standard clockwise pocket sequence shared across Monaco / Italy / most EU casinos. |

### Inspired-by

- The green-felt-and-gold-ring casino aesthetic of classic
  Monte Carlo and Vegas lobbies (visual style only — no assets copied).
- The "pass the device" pass-and-play pattern seen in couch-co-op
  games like *Jackbox*.

---

## 👤 Authors

Built by **Dong Sebastian**
([github.com/dongsebastian86-lab](https://github.com/dongsebastian86-lab))

With AI coding assistance from
[Freebuff](https://freebuff.com) · powered by the **Buffy** agent.

---

## ⚖️ License

This project is licensed under the **MIT License** —
see the [LICENSE](./LICENSE) file for full text.

All files in this repository — the JavaScript source, HTML, CSS,
this README, and any future additions — are released under the MIT
terms in the [LICENSE](./LICENSE) file. You're free to use, modify,
and distribute the code as long as the copyright notice is preserved.
