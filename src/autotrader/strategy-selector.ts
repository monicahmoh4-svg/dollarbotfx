import { runBacktest, type CategoryBacktest } from './backtest';
import type { TradeCategory } from './analysis';
import type { MarketScore, TradePlanEntry } from './types';

const CATS: TradeCategory[] = ['rise_fall', 'even_odd', 'over_under', 'matches_differs'];

// ---------------------------------------------------------------------------
// Adaptive AI controller (MASTER PROMPT §31 / continuous self-optimization)
// ---------------------------------------------------------------------------
// Continuously backtests every market it has recent ticks for, measures the
// REAL recent expectancy of each (market, category) pair, and builds a ranked
// "trade plan" of only those pairs whose expectancy is >= minExpectancy.
// The engine then shifts trading to the top of the plan and stops trading
// pairs/ markets that are not approved — i.e. it moves capital to wherever the
// data shows an edge, and preserves capital when nothing is positive-EV.
// ---------------------------------------------------------------------------
export class StrategySelector {
    private scores = new Map<string, MarketScore>();
    private plan: TradePlanEntry[] = [];
    private activeSymbol: string | null = null;
    private activeCategory: TradeCategory | null = null;
    private lastEval = new Map<string, number>();
    private minExpectancy: number;
    private lookback: number;
    private stake: number;
    private evalIntervalMs: number;
    private minSample: number;

    constructor(opts?: {
        minExpectancy?: number; lookback?: number; stake?: number;
        evalIntervalMs?: number; minSample?: number;
    }) {
        this.minExpectancy = opts?.minExpectancy ?? 0.0;
        this.lookback = opts?.lookback ?? 1000;
        this.stake = opts?.stake ?? 2;
        this.evalIntervalMs = opts?.evalIntervalMs ?? 90_000;
        this.minSample = opts?.minSample ?? 15;
    }

    setParams(p: Partial<{
        minExpectancy: number; lookback: number; stake: number;
        evalIntervalMs: number; minSample: number;
    }>) {
        if (p.minExpectancy !== undefined) this.minExpectancy = p.minExpectancy;
        if (p.lookback !== undefined) this.lookback = p.lookback;
        if (p.stake !== undefined) this.stake = p.stake;
        if (p.evalIntervalMs !== undefined) this.evalIntervalMs = p.evalIntervalMs;
        if (p.minSample !== undefined) this.minSample = p.minSample;
    }

    // Run a backtest for one market only if its cached evaluation is stale.
    // Returns true if an evaluation was actually performed.
    maybeEvaluate(symbol: string, prices: number[], regime: string, now = Date.now()): boolean {
        const last = this.lastEval.get(symbol) || 0;
        if (now - last < this.evalIntervalMs) return false;
        if (!prices || prices.length < 600) return false;
        const lookback = Math.min(this.lookback, Math.floor(prices.length * 0.6));
        if (lookback < 300) return false;
        this.lastEval.set(symbol, now);

        const report = runBacktest(prices, symbol, { durationTicks: 5, stake: this.stake, lookback, step: 5 });
        let best: TradeCategory | null = null;
        let bestExp = -Infinity;
        let bestWin = 0;
        let bestSample = 0;
        CATS.forEach((c) => {
            const cb: CategoryBacktest = report.categories[c];
            if (cb.trades.length >= this.minSample && cb.expectancy > bestExp) {
                bestExp = cb.expectancy;
                best = c;
                bestWin = cb.winRate;
                bestSample = cb.trades.length;
            }
        });

        const score: MarketScore = {
            symbol,
            lastUpdated: now,
            regime,
            bestCategory: best,
            bestExpectancy: bestExp === -Infinity ? 0 : bestExp,
            bestWinRate: bestWin,
            sampleTrades: bestSample,
            perCategory: report.categories,
        };
        this.scores.set(symbol, score);
        return true;
    }

    getScores(): MarketScore[] { return [...this.scores.values()]; }
    getPlan(): TradePlanEntry[] { return this.plan; }
    getActiveSymbol(): string | null { return this.activeSymbol; }
    getActiveCategory(): TradeCategory | null { return this.activeCategory; }
    isApproved(symbol: string, category: TradeCategory): boolean {
        return this.plan.some((e) => e.symbol === symbol && e.category === category);
    }
    isReady(): boolean { return this.plan.length > 0; }

    // Re-rank all evaluated markets into the trade plan and pick the active market.
    rebuildPlan(): { shifted: boolean; prevSymbol: string | null; prevCategory: TradeCategory | null } {
        const prevSymbol = this.activeSymbol;
        const prevCategory = this.activeCategory;

        const entries: TradePlanEntry[] = [];
        this.scores.forEach((score) => {
            if (score.bestCategory && score.bestExpectancy >= this.minExpectancy && score.sampleTrades >= this.minSample) {
                entries.push({
                    symbol: score.symbol,
                    category: score.bestCategory,
                    expectancy: score.bestExpectancy,
                    winRate: score.bestWinRate,
                    rank: 0,
                });
            }
        });
        entries.sort((a, b) => b.expectancy - a.expectancy);
        entries.forEach((e, i) => { e.rank = i + 1; });
        this.plan = entries;

        const top = entries[0];
        this.activeSymbol = top?.symbol ?? null;
        this.activeCategory = top?.category ?? null;
        const shifted = this.activeSymbol !== prevSymbol || this.activeCategory !== prevCategory;
        return { shifted, prevSymbol, prevCategory };
    }

    explain(): string {
        if (this.plan.length === 0) {
            return 'AI: no positive-EV (market,category) found yet — scanning & backtesting all markets, preserving capital.';
        }
        const top = this.plan[0];
        const s = this.scores.get(top.symbol);
        return `AI: concentrating on ${top.symbol} via ${top.category} ` +
            `(expectancy ${top.expectancy.toFixed(3)}, win ${(top.winRate * 100).toFixed(0)}%, regime ${s?.regime || '?'}) — ` +
            `${this.plan.length} approved of ${this.scores.size} markets evaluated.`;
    }
}
