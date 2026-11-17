// StallSnap — a patient dip-buyer for the cbBTC 1-minute race.
//
// Idea: on one-minute bars, most downward stretches are noise, but a close
// that sits far under its own recent average while short-term momentum is
// washed out marks a spot where sellers have largely finished. StallSnap
// waits for exactly that combination, and adds one twist of its own: it
// refuses to buy into a fall that is still accelerating. The stretch and
// the oversold reading open the door; a three-bar stall — the fall losing
// speed — is what actually lets the bot through it. One deep-stretch
// override remains for genuine capitulation, where waiting for a stall
// would mean missing the print entirely.
//
// Position management is deliberately boring: nearly all of the equity goes
// in at once (a ~30 bps round trip makes small size pointless), the profit
// target and the stop are fixed percentages of the position's cost basis,
// and a long time stop frees the capital if the bounce never comes. After
// any exit the bot sits out a cooldown, because the minutes right after a
// snapback are where this style gives its money back.
//
// The bot is a pure function of the bars it has seen: no clock, no files,
// no environment, no randomness. Same bars in, same orders out.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYM = 'CBBTC';
const MIN_NOTIONAL = 1_000_000n; // 1 USDC in quote units: the smallest buy the market takes

// --- gauges -----------------------------------------------------------------------
const ANCHOR_WIN = 45;   // closes in the rolling mean the stretch is measured against
const RSI_WIN = 10;      // Wilder RSI period for the oversold reading
const STALL_WIN = 3;     // bars in the fall-speed gauge

// --- entry --------------------------------------------------------------------------
const DIP = -0.0072;        // stretch at or under -0.72% ...
const RSI_MAX = 32;         // ... with RSI at or under this: the standard door
const DEEP_DIP = -0.0125;   // stretch at or under -1.25%: capitulation, no RSI needed
const STALL_FLOOR = -0.003; // 3-bar return must be above -0.30%: the fall is stalling
const SPEND_FRACTION = 0.95; // share of equity a position commits
const COOLDOWN_BARS = 45;   // bars to sit out after an exit

// --- exit -----------------------------------------------------------------------------
const TAKE_PROFIT = 0.017;  // unrealised return on cost: bank it
const STOP_LOSS = -0.0062;   // unrealised return on cost: cut it
const MAX_HOLD_BARS = 480;   // eight hours is long enough to wait for a bounce

const BUY_SLIP_BPS = 200;
const SELL_SLIP_BPS = 250;

type Order = BuyInput | SellInput;

class StallSnap {
  closes: number[] = [];   // every close seen, oldest first
  seenT = -1;              // bar time of the last close recorded
  rsiGain = 0;             // Wilder-smoothed average gain
  rsiLoss = 0;             // Wilder-smoothed average loss
  rsiSeeded = 0;           // closes folded into the RSI so far
  barsSinceExit = Number.MAX_SAFE_INTEGER; // cooldown clock; starts expired
  heldBars = 0;            // bars the current position has been open

  /** Mean of the ANCHOR_WIN closes before the latest one. */
  anchor(): number {
    const n = this.closes.length;
    if (n <= ANCHOR_WIN) return 0;
    let sum = 0;
    for (let i = n - 1 - ANCHOR_WIN; i < n - 1; i++) sum += this.closes[i];
    return sum / ANCHOR_WIN;
  }

  /** Current Wilder RSI, or null until enough closes have seeded it. */
  rsi(): number | null {
    if (this.rsiSeeded <= RSI_WIN) return null;
    if (this.rsiLoss === 0) return 100;
    return 100 - 100 / (1 + this.rsiGain / this.rsiLoss);
  }

  /** Return over the last k bars, or 0 when there is not enough history. */
  momentum(k: number): number {
    const n = this.closes.length;
    if (n <= k) return 0;
    return this.closes[n - 1] / this.closes[n - 1 - k] - 1;
  }

  /** Fold one new close into the gauges. */
  record(close: number): void {
    const prev = this.closes[this.closes.length - 1];
    this.closes.push(close);
    if (prev === undefined) return;
    const delta = close - prev;
    const up = Math.max(delta, 0);
    const down = Math.max(-delta, 0);
    this.rsiSeeded += 1;
    if (this.rsiSeeded <= RSI_WIN) {
      this.rsiGain += up / RSI_WIN;
      this.rsiLoss += down / RSI_WIN;
    } else {
      this.rsiGain = (this.rsiGain * (RSI_WIN - 1) + up) / RSI_WIN;
      this.rsiLoss = (this.rsiLoss * (RSI_WIN - 1) + down) / RSI_WIN;
    }
    if (this.barsSinceExit < Number.MAX_SAFE_INTEGER) this.barsSinceExit += 1;
  }

  buy(state: BarsState): BuyInput | null {
    let spend = BigInt(Math.floor(Number(state.equity) * SPEND_FRACTION));
    const room = state.weightRoom(SYM);
    if (state.cash < spend) spend = state.cash;
    if (room < spend) spend = room;
    if (spend < MIN_NOTIONAL) return null;
    return { side: 'buy', symbol: SYM, notional_quote_units: spend, max_slippage_bps: BUY_SLIP_BPS };
  }

  sellAll(qty: bigint): SellInput | null {
    if (qty <= 0n) return null;
    return { side: 'sell', symbol: SYM, qty, max_slippage_bps: SELL_SLIP_BPS };
  }

  decide(state: BarsState): Order[] {
    const closeRaw = state.close(SYM);
    if (closeRaw === null) return [];
    const held = state.positions.get(SYM);

    if (held !== undefined && held.qty > 0n) {
      this.heldBars += 1;
      const value = state.value(SYM, held.qty);
      const uret = held.cost > 0n ? Number(value) / Number(held.cost) - 1 : 0;
      if (uret >= TAKE_PROFIT || uret <= STOP_LOSS || this.heldBars >= MAX_HOLD_BARS) {
        const order = this.sellAll(held.qty);
        if (order) {
          this.heldBars = 0;
          this.barsSinceExit = 0;
          return [order];
        }
      }
      return [];
    }
    this.heldBars = 0;

    // Flat: look for the door. All three gauges must agree.
    if (this.barsSinceExit < COOLDOWN_BARS) return [];
    const anchor = this.anchor();
    if (anchor <= 0) return [];
    const close = Number(closeRaw);
    const stretch = close / anchor - 1;
    if (stretch > DIP) return [];                    // not far enough under the mean
    if (this.momentum(STALL_WIN) < STALL_FLOOR) return []; // still falling too fast
    if (stretch > DEEP_DIP) {
      const rsi = this.rsi();
      if (rsi === null || rsi > RSI_MAX) return [];   // stretched, but not washed out
    }
    const order = this.buy(state);
    return order ? [order] : [];
  }
}

const bot = new StallSnap();

await runBars({
  onBatch(state: BarsState, batch: Batch): Order[] {
    // Record first: warm-up bars build the gauges, they just may not trade.
    for (const bar of batch.bars) {
      if (bar.symbol === SYM && bar.t !== bot.seenT) {
        bot.seenT = bar.t;
        bot.record(Number(bar.c));
      }
    }
    if (state.warmingUp) return [];
    return bot.decide(state);
  },
});
