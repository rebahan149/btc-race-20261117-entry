# btc-race-20261117-entry

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/rebahan149/btc-race-20261117-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/rebahan149/btc-race-20261117-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

**StallSnap** — a patient dip-buying bot for cbBTC on one-minute bars, built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty.

## Strategy

StallSnap buys cbBTC only when three gauges agree:

1. **Stretch** — the close sits at least 0.72% under its 45-bar rolling mean (or 1.25% under it, a capitulation override that needs nothing else).
2. **Washout** — Wilder RSI(10) is at or under 32, so sellers look spent.
3. **Stall** — the last 3 bars are no longer in freefall (3-bar return above −0.30%): the bot never catches a knife that is still accelerating.

It commits 95% of equity in one position, banks at +1.7% on cost, cuts at −0.62%, frees the capital after 480 bars if no bounce comes, and sits out a 45-bar cooldown after every exit. The bot is a pure function of the bars seen so far — deterministic, no clock, no randomness, no network.

Local dev-window grade (kit harness, `grade-local --driver process`): net PnL +31.43 USDC (+3.14%) on 1,000 USDC, 4 trades, 4 wins, max drawdown 0.63%.

## Layout

- `main.ts` — the bot (the only strategy code)
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK, vendored unchanged
- `LICENSE` — MIT
