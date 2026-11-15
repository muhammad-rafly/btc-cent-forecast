// btc-cent-forecast-01 entry (Node 22, standard library only): a small, damped
// pull toward the trailing 24-hour mean, on top of persistence.
//
//   guess = x + 0.10 * (mean_1440 - x), adjustment capped at +/-0.5% of x
//
// where x is the market's last price in the case (the close at the checkpoint)
// and mean_1440 is the mean of the last <=1440 one-minute closes. The guess is
// kept on the price grid's 5 decimals and inside the scorer's (0, 10,000,000).
//
// Why this, and why so small: the score is mean absolute error in cents, so
// the guess that scores best is the honest middle estimate of the price 240
// minutes out. Persistence (guess = x) is the house baseline and a prize needs
// a loss strictly below it, so the entry must deviate from persistence — but
// only 5 practice transitions exist, and every directional rule fitted to them
// turned out to be a fluke of those 5 points. What the evidence actually
// supports, on 64 + 16 extra checkpoints cut from the same practice history
// (see analysis/results.md):
//   - Short-window momentum (e.g. last-60-min drift, k=0.5) looked like a
//     -33% win on the 5 transitions but LOSES +13% to +20% on the dense
//     grids. Rejected: it is a capped directional bet, not a signal.
//   - Momentum at any window/k loses on the dense grids. Rejected.
//   - A mild pull to the trailing 24h mean wins -1.8% to -4.1% on the dense
//     grids (pull 0.05-0.15, window 1440) and wins 36-38 of 64 checkpoints.
//     It loses +0.9% to +2.7% on the 5 official transitions (all five sit in
//     one falling leg), so the edge is small and regime-dependent — hence the
//     small pull (0.10, the middle of the family) and the 0.5% cap, which
//     bounds the bet if the final's 24h gap is large after the recent sharp
//     fall.
//
// Revision 2026-11-15 (independent re-check, analysis/rev_check.py): the
// numbers above reproduce exactly with the bot's capped rule (the cap never
// binds on practice — max 24h gap 2.22%), and the edge survives every
// regime split of the real data: late falling leg -3.9%, most recent 16
// checkpoints (the official-5 era) -3.2%, checkpoints below their 24h mean
// (the state the final starts in) -2.9%. The official-5 loss is driven by
// 2 of 5 transitions, not by a regime break. One builder claim is corrected:
// the 30-point synthetic "win in a downtrend" was noise — a 240-point check
// (20 fresh seeds) has the rule LOSING in every trend regime at pull 0.10:
// +2.6% on a pure random walk, +7.5% in a steady -15%/week fall, +5.8% on a
// reversal, +5.0% after a fall-then-flat. So the pick is a genuine bet that
// the final window stays choppy like the practice window rather than
// trending cleanly; pull 0.10 is kept as the middle of the family (0.05
// halves the measured edge, 0.15 raises the trend cost faster than the
// edge), and the flat combo was rejected again — it is ~0% on real data
// while still losing +2.5% to +3.9% in the trend synthetics, i.e. dominated
// by pull 0.05 on both sides. A non-positive price inside the mean window
// now falls back to persistence, like a non-finite one.
// The program reads every <id>.in in the input directory (the grader runs one
// case at a time, with only that case's file there) and writes <id>.out:
// {"forecasts":[{"case":"<the case's id>","price":<number>}]}, exactly one row
// naming the case, price finite, > 0 and < 10,000,000, at most 1 MiB. It runs
// offline, with no network, under the case's time cap: everything it knows is
// in the case's prices.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;
/** How many trailing minutes the mean is taken over (24 hours). */
const MEAN_WINDOW = 1440;
/** Fraction of the gap to the trailing mean the guess closes. */
const PULL = 0.10;
/** The adjustment is never larger than this fraction of the checkpoint price. */
const MAX_ADJ_FRAC = 0.005;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/** The forecast for one market: last close, pulled a little toward its trailing mean. */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) return 1;
  const x = m.prices[m.prices.length - 1] as number;
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return 1;
  const w = Math.min(MEAN_WINDOW, m.prices.length);
  let sum = 0;
  for (let i = m.prices.length - w; i < m.prices.length; i++) {
    const p = m.prices[i] as number;
    // A bad price inside the window (non-finite or non-positive) would corrupt
    // the mean, so fall back to plain persistence instead of guessing from it.
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return price5(x);
    sum += p;
  }
  const mean = sum / w;
  let adj = PULL * (mean - x);
  const cap = MAX_ADJ_FRAC * x;
  if (adj > cap) adj = cap;
  if (adj < -cap) adj = -cap;
  return price5(x + adj);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket) }] })}\n`);
}
