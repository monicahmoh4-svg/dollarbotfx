import {
    analyzeRiseFall,
    analyzeEvenOdd,
    analyzeOverUnder,
    analyzeMatchesDiffers,
    inferDecimalsFromQuotes,
    lastDigitOfExport,
    type TradeCategory,
    type ContractType,
    type AnalysisResult,
} from './analysis';

// ---------------------------------------------------------------------------
// Backtesting harness (MASTER PROMPT §18-20)
// Reuses the EXACT live analysis pipeline so backtest results reflect the
// real strategy. Outcomes are simulated deterministically from historical
// tick series using Deriv's contract settlement rules.
// ---------------------------------------------------------------------------

export interface BacktestConfig {
    durationTicks?: number; // contract duration in ticks (live default 5)
    stake?: number; // fixed stake per trade
    lookback?: number; // rolling window fed to the analyzer
    step?: number; // advance between simulated entries
    minConfidence?: number; // confidence gate (mirrors live 0.70)
    useLiveGate?: boolean; // if true, also require signalScore >= 62 (filters digit cats)
    decimals?: number; // override inferred decimals
}

export interface TradeRecord {
    entryIdx: number;
    exitIdx: number;
    contractType: ContractType;
    barrier: number | null;
    win: boolean;
    profit: number;
    confidence: number;
    signalScore: number;
    regime: string;
}

export interface CategoryBacktest {
    category: TradeCategory;
    trades: TradeRecord[];
    wins: number;
    losses: number;
    grossWin: number;
    grossLoss: number;
    winRate: number;
    expectancy: number; // avg P&L per trade
    avgWin: number;
    avgLoss: number;
    profitFactor: number; // grossWin / grossLoss
    maxDrawdown: number;
    finalEquity: number;
    equityCurve: number[];
}

export interface BacktestReport {
    symbol: string;
    durationTicks: number;
    stake: number;
    totalTicks: number;
    generatedAt: number;
    categories: Record<TradeCategory, CategoryBacktest>;
    bestCategory: TradeCategory | null;
}

const PAYOUT_RATIO: Record<TradeCategory, number> = {
    rise_fall: 0.90,
    even_odd: 0.95,
    over_under: 0.95,
    matches_differs: 0.95,
};

const ANALYZERS: Record<TradeCategory, (w: number[], d: number) => AnalysisResult> = {
    rise_fall: (w) => analyzeRiseFall(w),
    even_odd: (w, d) => analyzeEvenOdd(w, d),
    over_under: (w, d) => analyzeOverUnder(w, d),
    matches_differs: (w, d) => analyzeMatchesDiffers(w, d),
};

function isEven(n: number): boolean {
    return ((n % 10) + 10) % 10 % 2 === 0;
}

// Deriv settlement rule applied to a historical tick series.
function simulateOutcome(
    prices: number[],
    entryIdx: number,
    durationTicks: number,
    contractType: ContractType,
    barrier: number | null,
    stake: number,
    payoutRatio: number,
    decimals: number,
): { win: boolean; profit: number; exitIdx: number } | null {
    const exitIdx = entryIdx + durationTicks;
    if (exitIdx >= prices.length) return null;
    const entry = prices[entryIdx];
    const exit = prices[exitIdx];
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;

    const ld = lastDigitOfExport(exit, decimals);
    let win = false;
    switch (contractType) {
        case 'CALL': win = exit > entry; break;
        case 'PUT': win = exit < entry; break;
        case 'DIGITEVEN': win = isEven(ld); break;
        case 'DIGITODD': win = !isEven(ld); break;
        case 'DIGITMATCH': win = ld === (barrier ?? 0); break;
        case 'DIGITDIFF': win = ld !== (barrier ?? 0); break;
        case 'DIGITOVER': win = ld > (barrier ?? 0); break;
        case 'DIGITUNDER': win = ld < (barrier ?? 0); break;
        default: return null;
    }
    const profit = win ? stake * payoutRatio : -stake;
    return { win, profit, exitIdx };
}

function isTradeable(result: AnalysisResult, category: TradeCategory, minConfidence: number, useLiveGate: boolean): boolean {
    if (!result.contractType) return false;
    if (result.signalStrength === 'NONE' || result.signalStrength === 'WEAK') return false;
    if (result.confidence < minConfidence) return false;
    if (useLiveGate && result.signalScore < 62) return false;
    if (category === 'rise_fall' && (!result.htfAgreement || !result.ltfAgreement)) return false;
    if (category === 'over_under' && result.consecutiveAbove < 2) return false;
    return true;
}

export function runBacktest(prices: number[], symbol: string, config: BacktestConfig = {}): BacktestReport {
    const durationTicks = config.durationTicks ?? 5;
    const stake = config.stake ?? 2;
    const lookback = config.lookback ?? 300;
    const step = Math.max(1, config.step ?? 1);
    const minConfidence = config.minConfidence ?? 0.70;
    const useLiveGate = config.useLiveGate ?? false;
    const decimals = config.decimals ?? inferDecimalsFromQuotes(prices);

    const cats: TradeCategory[] = ['rise_fall', 'even_odd', 'over_under', 'matches_differs'];
    const results: Record<TradeCategory, CategoryBacktest> = {} as Record<TradeCategory, CategoryBacktest>;
    for (const c of cats) {
        results[c] = {
            category: c, trades: [], wins: 0, losses: 0, grossWin: 0, grossLoss: 0,
            winRate: 0, expectancy: 0, avgWin: 0, avgLoss: 0, profitFactor: 0,
            maxDrawdown: 0, finalEquity: 0, equityCurve: [],
        };
    }

    for (let i = lookback; i + durationTicks < prices.length; i += step) {
        const window = prices.slice(i - lookback, i);
        for (const category of cats) {
            const result = ANALYZERS[category](window, decimals);
            if (!isTradeable(result, category, minConfidence, useLiveGate)) continue;
            const outcome = simulateOutcome(
                prices, i, durationTicks, result.contractType as ContractType,
                result.barrier ?? null, stake, PAYOUT_RATIO[category], decimals,
            );
            if (!outcome) continue;
            const cb = results[category];
            cb.trades.push({
                entryIdx: i, exitIdx: outcome.exitIdx,
                contractType: result.contractType as ContractType,
                barrier: result.barrier ?? null,
                win: outcome.win, profit: outcome.profit,
                confidence: result.confidence, signalScore: result.signalScore,
                regime: result.regime,
            });
        }
    }

    let bestCategory: TradeCategory | null = null;
    let bestExpectancy = -Infinity;
    for (const c of cats) {
        const cb = results[c];
        const n = cb.trades.length;
        let equity = 0;
        let peak = 0;
        let maxDd = 0;
        for (const t of cb.trades) {
            if (t.win) { cb.wins += 1; cb.grossWin += t.profit; }
            else { cb.losses += 1; cb.grossLoss += Math.abs(t.profit); }
            equity += t.profit;
            cb.equityCurve.push(equity);
            if (equity > peak) peak = equity;
            const dd = peak - equity;
            if (dd > maxDd) maxDd = dd;
        }
        cb.finalEquity = equity;
        cb.maxDrawdown = maxDd;
        cb.winRate = n > 0 ? cb.wins / n : 0;
        cb.expectancy = n > 0 ? equity / n : 0;
        cb.avgWin = cb.wins > 0 ? cb.grossWin / cb.wins : 0;
        cb.avgLoss = cb.losses > 0 ? cb.grossLoss / cb.losses : 0;
        cb.profitFactor = cb.grossLoss > 0 ? cb.grossWin / cb.grossLoss : (cb.grossWin > 0 ? Infinity : 0);
        if (n >= 20 && cb.expectancy > bestExpectancy) {
            bestExpectancy = cb.expectancy;
            bestCategory = c;
        }
    }

    return {
        symbol, durationTicks, stake, totalTicks: prices.length,
        generatedAt: Date.now(), categories: results, bestCategory,
    };
}

// ---------------------------------------------------------------------------
// Walk-forward validation (§19): split history into contiguous folds and
// backtest each, reporting per-category stability across regimes.
// ---------------------------------------------------------------------------
export interface WalkForwardFold {
    startIndex: number;
    endIndex: number;
    expectancy: Record<TradeCategory, number>;
    profitable: Record<TradeCategory, boolean>;
}

export interface WalkForwardReport {
    folds: WalkForwardFold[];
    profitableFoldCount: Record<TradeCategory, number>;
    totalFolds: number;
}

export function walkForward(prices: number[], symbol: string, folds = 5, config: BacktestConfig = {}): WalkForwardReport {
    const foldSize = Math.floor(prices.length / folds);
    const report: WalkForwardReport = {
        folds: [],
        profitableFoldCount: { rise_fall: 0, even_odd: 0, over_under: 0, matches_differs: 0 },
        totalFolds: folds,
    };
    for (let f = 0; f < folds; f += 1) {
        const start = f * foldSize;
        const end = f === folds - 1 ? prices.length : (f + 1) * foldSize;
        const slice = prices.slice(start, end);
        const bt = runBacktest(slice, `${symbol} [fold ${f + 1}]`, config);
        const expectancy = {} as Record<TradeCategory, number>;
        const profitable = {} as Record<TradeCategory, boolean>;
        (['rise_fall', 'even_odd', 'over_under', 'matches_differs'] as TradeCategory[]).forEach((c) => {
            const e = bt.categories[c].expectancy;
            expectancy[c] = e;
            profitable[c] = bt.categories[c].trades.length >= 20 && e > 0;
            if (profitable[c]) report.profitableFoldCount[c] += 1;
        });
        report.folds.push({ startIndex: start, endIndex: end, expectancy, profitable });
    }
    return report;
}

// ---------------------------------------------------------------------------
// Monte Carlo (§20): resample per-category trade P&L with replacement to
// estimate the distribution of final equity and probability of drawdown.
// ---------------------------------------------------------------------------
export interface MonteCarloResult {
    category: TradeCategory;
    iterations: number;
    meanFinalEquity: number;
    p5: number;
    p95: number;
    probProfit: number; // fraction of runs ending positive
    probRuin: number; // fraction of runs hitting -ruinThreshold
    worstDrawdown: number;
}

function resample(trades: number[], n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) out.push(trades[Math.floor(Math.random() * trades.length)]);
    return out;
}

export function monteCarlo(report: BacktestReport, iterations = 1000, ruinThreshold = 20): MonteCarloResult[] {
    const cats = ['rise_fall', 'even_odd', 'over_under', 'matches_differs'] as TradeCategory[];
    return cats.map((category) => {
        const trades = report.categories[category].trades.map((t) => t.profit);
        const n = trades.length;
        if (n === 0) {
            return { category, iterations, meanFinalEquity: 0, p5: 0, p95: 0, probProfit: 0, probRuin: 0, worstDrawdown: 0 };
        }
        const finals: number[] = [];
        let ruinCount = 0;
        let worstDdAll = 0;
        for (let it = 0; it < iterations; it += 1) {
            const seq = resample(trades, n);
            let equity = 0;
            let peak = 0;
            for (const p of seq) {
                equity += p;
                if (equity > peak) peak = equity;
                const dd = peak - equity;
                if (dd > worstDdAll) worstDdAll = dd;
            }
            finals.push(equity);
            if (equity <= -ruinThreshold) ruinCount += 1;
        }
        finals.sort((a, b) => a - b);
        const mean = finals.reduce((s, v) => s + v, 0) / finals.length;
        const p5 = finals[Math.floor(finals.length * 0.05)];
        const p95 = finals[Math.floor(finals.length * 0.95)];
        const probProfit = finals.filter((v) => v > 0).length / finals.length;
        return {
            category, iterations,
            meanFinalEquity: mean,
            p5, p95,
            probProfit,
            probRuin: ruinCount / iterations,
            worstDrawdown: worstDdAll,
        };
    });
}

// ---------------------------------------------------------------------------
// Historical tick fetching from Deriv (paginated ticks_history).
// `sendFn` mirrors the engine's apiInstance.send.
// ---------------------------------------------------------------------------
export type SendFn = (req: Record<string, unknown>) => Promise<{ history?: { prices?: unknown[]; times?: unknown[] } } & Record<string, unknown>>;

export interface HistoricalTick { time: number; price: number; }

export async function fetchDerivHistory(
    sendFn: SendFn,
    symbol: string,
    startEpoch: number,
    endEpoch: number,
    maxTicks = 20000,
): Promise<HistoricalTick[]> {
    const ticks: HistoricalTick[] = [];
    let cursor = startEpoch;
    while (ticks.length < maxTicks && cursor < endEpoch) {
        const res = await sendFn({
            ticks_history: symbol,
            start: cursor,
            end: endEpoch,
            count: 5000,
            style: 'ticks',
            adjust_start_time: 1,
        });
        const prices = res?.history?.prices;
        const times = res?.history?.times;
        if (!Array.isArray(prices) || prices.length === 0) break;
        for (let i = 0; i < prices.length; i += 1) {
            const price = Number(prices[i]);
            const time = Array.isArray(times) ? Number(times[i]) : cursor + i;
            if (Number.isFinite(price)) ticks.push({ time, price });
        }
        if (!Array.isArray(times) || times.length < 5000) break;
        cursor = Number(times[times.length - 1]) + 1;
    }
    return ticks;
}
