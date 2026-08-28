export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITMATCH' | 'DIGITDIFF';
export type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
export type MarketRegime =
    | 'STRONG_BULL' | 'WEAK_BULL' | 'STRONG_BEAR' | 'WEAK_BEAR'
    | 'RANGE_BOUND' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'UNCLEAR';

export interface AnalysisResult {
    category: TradeCategory;
    contractType: ContractType | null;
    contractLabel: string;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    confidence: number;
    signalScore: number; // §11: normalized 0-100
    estimatedWinProbability: number;
    volatility: number;
    sampleSize: number;
    reason: string;
    signalStrength: SignalStrength;
    htfAgreement: boolean;
    ltfAgreement: boolean;
    trendAlignment: boolean;
    consecutiveAbove: number;
    digitAboveThreshold: number;
    regime: MarketRegime;
}

type Candle = { open: number; high: number; low: number; close: number };

const empty = (reason: string, sampleSize = 0): AnalysisResult => ({
    category: 'rise_fall',
    contractType: null,
    contractLabel: '',
    direction: null,
    barrier: null,
    confidence: 0,
    signalScore: 0,
    estimatedWinProbability: 0.5,
    volatility: 0,
    sampleSize,
    reason,
    signalStrength: 'NONE',
    htfAgreement: false,
    ltfAgreement: false,
    trendAlignment: false,
    consecutiveAbove: 0,
    digitAboveThreshold: 0,
    regime: 'UNCLEAR',
});

const emptyCat = (category: TradeCategory, reason: string, sampleSize = 0): AnalysisResult => ({
    ...empty(reason, sampleSize),
    category,
});

// ═══════════════════════════════════════════════════════
// MARKET REGIME CLASSIFIER (MASTER PROMPT §5)
// ═══════════════════════════════════════════════════════
export function classifyRegime(quotes: number[], decimals: number): MarketRegime {
    const q = finiteQuotes(quotes);
    if (q.length < 50) return 'UNCLEAR';
    const n = q.length;

    // EMAs and slope scale with the window so behaviour is consistent for any lookback.
    const emaFast = ema(q, Math.max(3, Math.floor(n / 8)));
    const emaSlow = ema(q, Math.max(5, Math.floor(n / 3)));
    const f = emaFast[emaFast.length - 1];
    const s = emaSlow[emaSlow.length - 1];
    const slopeFast = slope(q, Math.max(5, Math.floor(n / 8)));

    // Volatility measured as stdev of per-tick returns (scale-independent).
    const rets: number[] = [];
    for (let i = 1; i < q.length; i += 1) {
        rets.push((q[i] - q[i - 1]) / Math.max(q[i - 1], 1e-9));
    }
    const vol = std(rets);

    const bb = bollinger(q, Math.max(10, Math.floor(n / 5)), 2.0);
    const bbWidth = bb ? bb.width : 0;

    // Candles for ADX: target ~30 candles regardless of window length.
    const cw = Math.max(1, Math.floor(n / 30));
    const c = candles(q, cw);
    const adxVal = c.length >= 4 ? adx(c, Math.min(14, c.length - 1)) : 0;

    const bullStructure = f > s && slopeFast > 0;
    const bearStructure = f < s && slopeFast < 0;

    // Calibrated to per-tick return stdev (~1.3e-4 on R_50).
    if (vol > 0.00025) return 'HIGH_VOLATILITY';
    if (vol < 0.00005) return 'LOW_VOLATILITY';
    if (adxVal < 15 && Math.abs(f - s) / (s || 1) < 0.002) return 'RANGE_BOUND';

    if (bullStructure && adxVal >= 20) return 'STRONG_BULL';
    if (bullStructure) return 'WEAK_BULL';
    if (bearStructure && adxVal >= 20) return 'STRONG_BEAR';
    if (bearStructure) return 'WEAK_BEAR';
    return 'UNCLEAR';
}

function std(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

const finiteQuotes = (quotes: number[]) =>
    quotes.filter((quote) => Number.isFinite(quote) && quote > 0);

// ─── TECHNICAL INDICATORS ───
function ema(values: number[], period: number): number[] {
    if (!values.length) return [];
    const alpha = 2 / (period + 1);
    const result = [values[0]];
    for (let i = 1; i < values.length; i += 1) {
        result.push(values[i] * alpha + result[i - 1] * (1 - alpha));
    }
    return result;
}

function rsi(values: number[], period = 14): number[] {
    if (values.length <= period + 1) return values.map(() => 50);
    const result: number[] = [];
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i += 1) {
        const change = values[i] - values[i - 1];
        if (change >= 0) gain += change;
        else loss -= change;
    }
    gain /= period;
    loss /= period;
    result.push(...new Array(period).fill(50));
    result.push(loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
    for (let i = period + 1; i < values.length; i += 1) {
        const change = values[i] - values[i - 1];
        gain = (gain * (period - 1) + Math.max(change, 0)) / period;
        loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
        result.push(loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
    }
    return result;
}

function candles(quotes: number[], width: number): Candle[] {
    const result: Candle[] = [];
    for (let i = 0; i + width <= quotes.length; i += width) {
        const slice = quotes.slice(i, i + width);
        result.push({
            open: slice[0],
            high: Math.max(...slice),
            low: Math.min(...slice),
            close: slice[slice.length - 1],
        });
    }
    return result;
}

function atr(data: Candle[], period = 14): number {
    if (data.length < period + 1) return 0;
    const ranges = data.slice(1).map((candle, index) => {
        const previous = data[index].close;
        return Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - previous),
            Math.abs(candle.low - previous),
        );
    });
    return ranges.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function slope(values: number[], lookback: number): number {
    if (values.length <= lookback) return 0;
    const start = values[values.length - 1 - lookback];
    const end = values[values.length - 1];
    const meanAbs = values.slice(-lookback).reduce((s, v) => s + Math.abs(v), 0) / lookback;
    return meanAbs === 0 ? 0 : (end - start) / Math.max(meanAbs, 1e-8);
}

function macd(values: number[], fast = 12, slow = 26, signal = 9): {
    line: number; signal: number; hist: number; prev_hist: number;
    bullish_cross: boolean; bearish_cross: boolean;
} | null {
    if (values.length < slow + signal) return null;
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = ef.map((_, i) => ef[i] - es[i]);
    const sig = ema(line, signal);
    const len = line.length;
    const hist = line[len - 1] - sig[len - 1];
    const prev_hist = len > 1 ? line[len - 2] - sig[len - 2] : 0;
    return {
        line: line[len - 1],
        signal: sig[len - 1],
        hist,
        prev_hist,
        bullish_cross: prev_hist <= 0 && hist > 0,
        bearish_cross: prev_hist >= 0 && hist < 0,
    };
}

function bollinger(values: number[], period = 20, m = 2.0): { mid: number; upper: number; lower: number; width: number } | null {
    if (values.length < period) return null;
    const window = values.slice(-period);
    const mean = window.reduce((s, v) => s + v, 0) / period;
    const sd = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    return { mid: mean, upper: mean + m * sd, lower: mean - m * sd, width: (2 * m * sd) / (mean || 1) };
}

function stochastic(data: Candle[], period = 14): number {
    if (data.length < period) return 50;
    const recent = data.slice(-period);
    const highest = Math.max(...recent.map((c) => c.high));
    const lowest = Math.min(...recent.map((c) => c.low));
    const current = data[data.length - 1].close;
    if (highest === lowest) return 50;
    return ((current - lowest) / (highest - lowest)) * 100;
}

function adx(data: Candle[], period = 14): number {
    if (data.length < period * 2) return 0;
    const trList: number[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];
    for (let i = 1; i < data.length; i++) {
        const highDiff = data[i].high - data[i - 1].high;
        const lowDiff = data[i - 1].low - data[i].low;
        trList.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i - 1].close), Math.abs(data[i].low - data[i - 1].close)));
        plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
        minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
    }
    let atrSum = trList.slice(0, period).reduce((a, b) => a + b, 0);
    let plusDMSum = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let minusDMSum = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
    for (let i = period; i < trList.length; i++) {
        atrSum = atrSum - atrSum / period + trList[i];
        plusDMSum = plusDMSum - plusDMSum / period + plusDM[i];
        minusDMSum = minusDMSum - minusDMSum / period + minusDM[i];
    }
    const atr14 = atrSum / period;
    if (atr14 === 0) return 0;
    const plusDI = (plusDMSum / period / atr14) * 100;
    const minusDI = (minusDMSum / period / atr14) * 100;
    const diSum = plusDI + minusDI;
    if (diSum === 0) return 0;
    return Math.abs(plusDI - minusDI) / diSum * 100;
}

// ─── DIGIT EXTRACTION ───
function lastDigitOf(quote: number, decimals: number): number {
    return Math.abs(Math.round(quote * 10 ** decimals) % 10);
}

function extractLastDigits(quotes: number[], decimals: number): number[] {
    return quotes.map((q) => lastDigitOf(q, decimals));
}

function digitDistribution(digits: number[]): number[] {
    const dist = new Array(10).fill(0);
    for (const d of digits) dist[d]++;
    return dist;
}

// ═══════════════════════════════════════════════════════
// CATEGORY 1: RISE/FALL
// ═══════════════════════════════════════════════════════
export function analyzeRiseFall(input: number[]): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 500) return empty(`INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const regime = classifyRegime(quotes, 2);
    // §31 No-forced-trade: only trade directional in CONFIRMED strong trends.
    // (R_50 is mean-reverting; weak/choppy regimes are anti-predictive for momentum.)
    if (regime !== 'STRONG_BULL' && regime !== 'STRONG_BEAR') return empty(`REGIME_UNFAVORABLE:${regime}`, quotes.length);

    const htf = candles(quotes, 20);
    const ltf = candles(quotes, 5);
    const htf_close = htf.map((c) => c.close);
    const ltf_close = ltf.map((c) => c.close);

    if (htf_close.length < 40 || ltf_close.length < 80) {
        return empty(`INSUFFICIENT_CANDLES: HTF=${htf_close.length}, LTF=${ltf_close.length}`, quotes.length);
    }

    const last = ltf_close[ltf_close.length - 1];
    const previous = ltf_close[ltf_close.length - 2];
    const range = atr(htf);
    if (!range || !Number.isFinite(range)) return empty('ZERO_VOLATILITY', quotes.length);

    const htf_fast = ema(htf_close, 20);
    const htf_slow = ema(htf_close, 50);
    const htf_diff = htf_fast[htf_fast.length - 1] - htf_slow[htf_slow.length - 1];
    const htf_trend_strength = htf_diff / Math.max(Math.abs(htf_slow[htf_slow.length - 1]), Number.EPSILON);

    const htf_macd = macd(htf_close);
    if (!htf_macd) return empty('INSUFFICIENT_HTF_MACD', quotes.length);

    const ltf_macd = macd(ltf_close);
    if (!ltf_macd) return empty('INSUFFICIENT_LTF_MACD', quotes.length);

    const htf_rsi_arr = rsi(htf_close, 14);
    const htf_rsi = htf_rsi_arr[htf_rsi_arr.length - 1];

    const roc_period = 12;
    const momentum_now = (last - ltf_close[Math.max(0, ltf_close.length - roc_period)]) /
        Math.max(Math.abs(ltf_close[Math.max(0, ltf_close.length - roc_period)]), Number.EPSILON);

    const adx_val = adx(htf, 14);
    const ltf_candle_up_count = ltf.slice(-3).filter((c) => c.close > c.open).length;

    const bb = bollinger(htf_close, 20, 2.0);
    if (bb && bb.width < 0.00015) return empty('DEAD_MARKET', quotes.length);

    if (bb) {
        if (last > bb.upper + range * 0.5 && htf_rsi > 75) return empty('EXTREME_OVERBOUGHT', quotes.length);
        if (last < bb.lower - range * 0.5 && htf_rsi < 25) return empty('EXTREME_OVERSOLD', quotes.length);
    }

    let direction: 'CALL' | 'PUT';
    if (htf_macd.bullish_cross || (htf_macd.hist > 0 && ltf_macd.hist > 0)) {
        direction = 'CALL';
    } else if (htf_macd.bearish_cross || (htf_macd.hist < 0 && ltf_macd.hist < 0)) {
        direction = 'PUT';
    } else {
        return empty('NO_DUAL_TIMEFRAME_SIGNAL', quotes.length);
    }

    const htfAgreement = (direction === 'CALL' && htf_macd.hist > 0) || (direction === 'PUT' && htf_macd.hist < 0);
    const ltfAgreement = (direction === 'CALL' && ltf_macd.hist > 0 && momentum_now > 0) ||
        (direction === 'PUT' && ltf_macd.hist < 0 && momentum_now < 0);
    if (!htfAgreement) return empty('HTF_DISAGREEMENT', quotes.length);

    let score = 0;
    let maxScore = 0;
    const penalties: string[] = [];

    const f1w = 15; maxScore += f1w;
    if ((direction === 'CALL' && htf_trend_strength > 0.001) || (direction === 'PUT' && htf_trend_strength < -0.001)) score += f1w;
    else if ((direction === 'CALL' && htf_trend_strength > 0.0005) || (direction === 'PUT' && htf_trend_strength < -0.0005)) score += f1w * 0.7;

    const f2w = 15; maxScore += f2w;
    if (Math.abs(htf_macd.hist) > Math.abs(htf_macd.prev_hist) * 1.3) score += f2w;
    else if (Math.abs(htf_macd.hist) > Math.abs(htf_macd.prev_hist)) score += f2w * 0.6;

    const f3w = 12; maxScore += f3w;
    if (ltfAgreement) score += f3w;
    else if ((direction === 'CALL' && ltf_macd.hist > 0) || (direction === 'PUT' && ltf_macd.hist < 0)) score += f3w * 0.4;

    const f4w = 12; maxScore += f4w;
    if (direction === 'CALL') {
        if (htf_rsi >= 45 && htf_rsi <= 65) score += f4w;
        else if (htf_rsi >= 35 && htf_rsi <= 75) score += f4w * 0.5;
        else penalties.push('RSI_EXTREME');
    } else {
        if (htf_rsi >= 35 && htf_rsi <= 55) score += f4w;
        else if (htf_rsi >= 25 && htf_rsi <= 65) score += f4w * 0.5;
        else penalties.push('RSI_EXTREME');
    }

    const f5w = 12; maxScore += f5w;
    if ((direction === 'CALL' && momentum_now > 0.001) || (direction === 'PUT' && momentum_now < -0.001)) score += f5w;
    else if ((direction === 'CALL' && momentum_now > 0.0003) || (direction === 'PUT' && momentum_now < -0.0003)) score += f5w * 0.5;

    const f6w = 8; maxScore += f6w;
    if (adx_val >= 25) score += f6w;
    else if (adx_val >= 18) score += f6w * 0.7;
    else if (adx_val >= 12) score += f6w * 0.3;
    else penalties.push('WEAK_TREND');

    const f7w = 10; maxScore += f7w;
    if (direction === 'CALL' && ltf_candle_up_count >= 2) score += f7w;
    else if (direction === 'PUT' && ltf_candle_up_count <= 1) score += f7w;

    const f8w = 8; maxScore += f8w;
    if (bb) {
        const bbPos = (last - bb.lower) / (bb.upper - bb.lower || 1);
        if (bbPos >= 0.3 && bbPos <= 0.7) score += f8w;
        else if (bbPos >= 0.2 && bbPos <= 0.8) score += f8w * 0.5;
    } else { score += f8w * 0.5; }

    const f9w = 8; maxScore += f9w;
    const htf_slope_val = slope(htf_close, 5);
    if ((direction === 'CALL' && htf_slope_val > 0.0002) || (direction === 'PUT' && htf_slope_val < -0.0002)) score += f9w;
    else if ((direction === 'CALL' && htf_slope_val > 0) || (direction === 'PUT' && htf_slope_val < 0)) score += f9w * 0.4;

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.6;
    else if (penalties.length >= 2) penaltyMultiplier = 0.75;
    else if (penalties.length >= 1) penaltyMultiplier = 0.9;

    // Regime adjustment (§5/§31): reduce conviction in unfavourable regimes
    let regimeMultiplier = 1.0;
    if (regime === 'HIGH_VOLATILITY') regimeMultiplier = 0.7;
    else if (regime === 'RANGE_BOUND') regimeMultiplier = 0.85;
    else if (regime === 'WEAK_BULL' || regime === 'WEAK_BEAR') regimeMultiplier = 0.9;

    const factorsPassed = [htfAgreement, ltfAgreement, Math.abs(htf_macd.hist) > Math.abs(htf_macd.prev_hist),
        Math.abs(momentum_now) > 0.0003, adx_val >= 15,
        (direction === 'CALL' && ltf_candle_up_count >= 1) || (direction === 'PUT' && ltf_candle_up_count <= 2),
    ].filter(Boolean).length;
    if (factorsPassed < 3) return empty(`INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.92, Math.max(0, rawConfidence * penaltyMultiplier * regimeMultiplier));
    const signalScore = Math.round(Math.min(100, Math.max(0, rawConfidence * penaltyMultiplier * regimeMultiplier * 100)));
    let signalStrength: SignalStrength;
    if (confidence >= 0.78 && factorsPassed >= 5 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.65 && factorsPassed >= 3) signalStrength = 'MODERATE';
    else if (confidence >= 0.50) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    const trendAlignment = htfAgreement && ltfAgreement;
    const reasons = [
        `REGIME=${regime}`, `ADX=${adx_val.toFixed(1)}`, `HTF_RSI=${htf_rsi.toFixed(1)}`,
        `MOM=${(momentum_now * 10000).toFixed(1)}bps`, `SCORE=${signalScore}`,
        trendAlignment ? 'DUAL_TF' : 'PARTIAL_TF',
        penalties.length > 0 ? `PENALTY[${penalties.join(',')}]` : '', `FACTORS=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return { category: 'rise_fall', contractType: direction, contractLabel: direction === 'CALL' ? 'RISE' : 'FALL',
        direction, barrier: null, confidence, signalScore, estimatedWinProbability: confidence, volatility: range,
        sampleSize: quotes.length, reason: reasons, signalStrength, htfAgreement, ltfAgreement, trendAlignment,
        consecutiveAbove: 0, digitAboveThreshold: 0, regime };
}

// ═══════════════════════════════════════════════════════
// CATEGORY 2: EVEN/ODD - REVERSAL STRATEGY
// Core logic: When 2+ consecutive odd digits appear → trade EVEN
// When 2+ consecutive even digits appear → trade ODD
// Rationale: After a streak of one parity, reversal probability increases
// Base probability: 50/50, but streaks create exploitable patterns
// ═══════════════════════════════════════════════════════
export function analyzeEvenOdd(input: number[], decimals: number): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 100) return emptyCat('even_odd', `INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const digits = extractLastDigits(quotes, decimals);
    const recentWindow = 50;
    const recent = digits.slice(-recentWindow);
    const last10 = digits.slice(-10);
    const last5 = digits.slice(-5);

    // ─── CORE: Count consecutive same-parity digits from end ───
    const lastParity = digits[digits.length - 1] % 2 === 0 ? 'even' : 'odd';
    let consecutiveStreak = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        const isEven = digits[i] % 2 === 0;
        if ((lastParity === 'even' && isEven) || (lastParity === 'odd' && !isEven)) consecutiveStreak++;
        else break;
    }

    // ─── REVERSAL LOGIC: predict OPPOSITE of current streak ───
    const predictEven = lastParity === 'odd'; // If odd streak → predict even
    const predictOdd = lastParity === 'even'; // If even streak → predict odd

    // How many of last 10 are same parity as current streak
    const sameParityCount10 = last10.filter((d) => {
        const isEven = d % 2 === 0;
        return (lastParity === 'even' && isEven) || (lastParity === 'odd' && !isEven);
    }).length;
    const sameParityRatio10 = sameParityCount10 / last10.length;

    // Long-term parity distribution
    const longDigits = digits.slice(-150);
    const longEvenRatio = longDigits.filter((d) => d % 2 === 0).length / longDigits.length;

    // Overall 50-tick parity ratio
    const evenCount50 = recent.filter((d) => d % 2 === 0).length;
    const evenRatio50 = evenCount50 / recentWindow;

    // Alternation rate: how often digits switch parity in last 20
    const last20 = digits.slice(-20);
    let alternations = 0;
    for (let i = 1; i < last20.length; i++) {
        if ((last20[i] % 2 === 0) !== (last20[i - 1] % 2 === 0)) alternations++;
    }
    const alternationRate = alternations / (last20.length - 1);

    // Streak tendency: average streak length in recent window
    let streaks: number[] = [];
    let currentStreakLen = 1;
    for (let i = 1; i < recent.length; i++) {
        if ((recent[i] % 2 === 0) === (recent[i - 1] % 2 === 0)) {
            currentStreakLen++;
        } else {
            streaks.push(currentStreakLen);
            currentStreakLen = 1;
        }
    }
    streaks.push(currentStreakLen);
    const avgStreak = streaks.reduce((a, b) => a + b, 0) / streaks.length;
    const maxStreak = Math.max(...streaks);

    // ─── SCORING ───
    const penalties: string[] = [];
    let score = 0;
    let maxScore = 0;

    // Factor 1: Consecutive streak strength (most important for reversal)
    const f1w = 30; maxScore += f1w;
    if (consecutiveStreak >= 4) score += f1w;           // Very strong reversal signal
    else if (consecutiveStreak >= 3) score += f1w * 0.9;  // Strong
    else if (consecutiveStreak >= 2) score += f1w * 0.7;  // Moderate - minimum trigger
    else if (consecutiveStreak >= 1) score += f1w * 0.2;  // Weak - single digit
    else penalties.push('NO_STREAK');

    // Factor 2: Same-parity concentration in last 10 (confirms streak dominance)
    const f2w = 20; maxScore += f2w;
    if (sameParityRatio10 >= 0.80) score += f2w;        // 8/10+ same parity
    else if (sameParityRatio10 >= 0.70) score += f2w * 0.7;
    else if (sameParityRatio10 >= 0.60) score += f2w * 0.4;
    else penalties.push('LOW_CONCENTRATION');

    // Factor 3: Alternation rate (higher = more reversals happen = reversal more likely)
    const f3w = 15; maxScore += f3w;
    if (alternationRate >= 0.55) score += f3w;          // Very alternation-heavy market
    else if (alternationRate >= 0.45) score += f3w * 0.7;
    else if (alternationRate >= 0.35) score += f3w * 0.4;
    else penalties.push('LOW_ALTERNATION');

    // Factor 4: Streak exceeds average (confirms this is an unusual streak)
    const f4w = 15; maxScore += f4w;
    if (consecutiveStreak > avgStreak * 1.5) score += f4w;
    else if (consecutiveStreak > avgStreak) score += f4w * 0.6;
    else score += f4w * 0.2;

    // Factor 5: Not at extreme streak length (avoid reversals after very long streaks)
    const f5w = 10; maxScore += f5w;
    if (consecutiveStreak >= 8) {
        penalties.push('EXTREME_STREAK');
        score += f5w * 0.1;  // Very long streak - reversal may have already happened
    } else if (consecutiveStreak >= 2 && consecutiveStreak <= 5) {
        score += f5w;  // Sweet spot
    } else {
        score += f5w * 0.3;
    }

    // Factor 6: Long-term parity doesn't contradict
    const f6w = 10; maxScore += f6w;
    if (predictEven && longEvenRatio < 0.55) score += f6w;  // Long-term even bias supports prediction
    else if (predictOdd && longEvenRatio > 0.45) score += f6w;
    else score += f6w * 0.4;

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.55;
    else if (penalties.length >= 2) penaltyMultiplier = 0.70;
    else if (penalties.length >= 1) penaltyMultiplier = 0.85;

    // Require at least 3 consecutive same-parity digits to trade
    if (consecutiveStreak < 3) return emptyCat('even_odd', `STREAK_TOO_SHORT: ${consecutiveStreak}`, quotes.length);

    const factorsPassed = [consecutiveStreak >= 3, sameParityRatio10 >= 0.60,
        alternationRate >= 0.35, consecutiveStreak > avgStreak,
        consecutiveStreak <= 7, longEvenRatio !== 0.5].filter(Boolean).length;

    if (factorsPassed < 3) return emptyCat('even_odd', `INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.88, Math.max(0, rawConfidence * penaltyMultiplier));
    let signalStrength: SignalStrength;
    if (confidence >= 0.75 && factorsPassed >= 5 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.62 && factorsPassed >= 3) signalStrength = 'MODERATE';
    else if (confidence >= 0.48) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    const contractType: ContractType = predictEven ? 'DIGITEVEN' : 'DIGITODD';
    const contractLabel = predictEven ? 'EVEN' : 'ODD';

    // Win probability: For a random digit generator, even/odd is always 50/50.
    // Only add a tiny edge for very long streaks (3+) based on empirical patterns
    const winProb = consecutiveStreak >= 3 ? 0.52 : 0.50;

    // Even/Odd is a 50/50 process; with Deriv's <100% payout this is structurally
    // negative-EV. We cap the reported score low so the signal-score gate + EV gate
    // prevent trading it (§31 No-forced-trade, §40 do not cheat).
    const signalScore = Math.round(Math.min(55, confidence * 100));
    const regime = classifyRegime(quotes, decimals);

    const reasons = [
        `STREAK=${consecutiveStreak}${lastParity === 'even' ? 'E' : 'O'}`,
        `PREDICT=${contractLabel}`,
        `SAME10=${sameParityCount10}/10`, `ALT=${(alternationRate * 100).toFixed(0)}%`,
        `AVG_STREAK=${avgStreak.toFixed(1)}`,
        penalties.length > 0 ? `PEN[${penalties.join(',')}]` : '', `F=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return { category: 'even_odd', contractType, contractLabel,
        direction: null, barrier: null, confidence, signalScore, estimatedWinProbability: winProb,
        volatility: sameParityRatio10, sampleSize: quotes.length, reason: reasons, signalStrength,
        htfAgreement: true, ltfAgreement: true, trendAlignment: true,
        consecutiveAbove: consecutiveStreak, digitAboveThreshold: sameParityRatio10, regime };
}

// ═══════════════════════════════════════════════════════
// CATEGORY 3: OVER/UNDER - OVER 2 STRATEGY
// Core logic: When last digit ticks above 2 twice consecutively,
// the bot detects the pattern and executes an OVER 2 trade.
// Win condition: last digit > 2 (digits 3-9 = 70% base probability)
// ═══════════════════════════════════════════════════════
export function analyzeOverUnder(input: number[], decimals: number): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 100) return emptyCat('over_under', `INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const digits = extractLastDigits(quotes, decimals);
    const BARRIER = 2;
    const recentWindow = 50;
    const recent = digits.slice(-recentWindow);
    const last10 = digits.slice(-10);
    const last5 = digits.slice(-5);

    // ─── CORE: Count consecutive digits above 2 from the end ───
    let consecutiveAbove = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        if (digits[i] > BARRIER) consecutiveAbove++;
        else break;
    }

    // How many of the last 10 are above 2
    const aboveCount10 = last10.filter((d) => d > BARRIER).length;
    const aboveRatio10 = aboveCount10 / last10.length;

    // How many of the last 50 are above 2
    const aboveCount50 = recent.filter((d) => d > BARRIER).length;
    const aboveRatio50 = aboveCount50 / recentWindow;

    // Long-term baseline (last 150)
    const longDigits = digits.slice(-150);
    const longAboveRatio = longDigits.filter((d) => d > BARRIER).length / longDigits.length;

    // Expected: 7/10 = 0.70 for uniform distribution
    const expectedRatio = 0.70;
    const bias50 = aboveRatio50 - expectedRatio;
    const bias10 = aboveRatio10 - expectedRatio;

    // Momentum: is the above-2 rate accelerating in recent ticks?
    const firstHalf = recent.slice(0, 25);
    const secondHalf = recent.slice(25);
    const firstAboveRate = firstHalf.filter((d) => d > BARRIER).length / 25;
    const secondAboveRate = secondHalf.filter((d) => d > BARRIER).length / 25;
    const momentumAccel = secondAboveRate > firstAboveRate;

    // Digit frequency analysis - what digits appear most?
    const dist = digitDistribution(recent);
    const highDigitCount = dist[3] + dist[4] + dist[5] + dist[6] + dist[7] + dist[8] + dist[9];
    const veryLowCount = dist[0] + dist[1] + dist[2];

    // Streak of digits <= 2 (opportunity zones)
    let lowStreak = 0;
    for (let i = digits.length - 1; i >= Math.max(0, digits.length - 20); i--) {
        if (digits[i] <= BARRIER) lowStreak++;
        else break;
    }

    // ─── SCORING ───
    const penalties: string[] = [];
    let score = 0;
    let maxScore = 0;

    // Factor 1: Consecutive above threshold (most important for over2)
    const f1w = 25; maxScore += f1w;
    if (consecutiveAbove >= 3) score += f1w;
    else if (consecutiveAbove >= 2) score += f1w * 0.85;
    else if (consecutiveAbove >= 1) score += f1w * 0.4;
    else penalties.push('NO_CONSECUTIVE');

    // Factor 2: Recent 10-tick rate above 2
    const f2w = 20; maxScore += f2w;
    if (aboveRatio10 >= 0.80) score += f2w;
    else if (aboveRatio10 >= 0.70) score += f2w * 0.7;
    else if (aboveRatio10 >= 0.60) score += f2w * 0.4;
    else penalties.push('LOW_RECENT_RATE');

    // Factor 3: 50-tick rate above 2 (structural bias)
    const f3w = 15; maxScore += f3w;
    if (aboveRatio50 >= 0.76) score += f3w;
    else if (aboveRatio50 >= 0.72) score += f3w * 0.7;
    else if (aboveRatio50 >= 0.68) score += f3w * 0.4;
    else penalties.push('LOW_STRUCTURAL_RATE');

    // Factor 4: Long-term baseline alignment
    const f4w = 10; maxScore += f4w;
    if (longAboveRatio >= 0.72) score += f4w;
    else if (longAboveRatio >= 0.68) score += f4w * 0.5;
    else penalties.push('LONG_TERM_MISMATCH');

    // Factor 5: Momentum acceleration
    const f5w = 10; maxScore += f5w;
    if (momentumAccel) score += f5w;
    else if (secondAboveRate >= 0.70) score += f5w * 0.5;
    else penalties.push('DECELERATING');

    // Factor 6: Reversal risk check (don't trade after long low streaks)
    const f6w = 10; maxScore += f6w;
    if (lowStreak >= 4) {
        // Long streak of low digits - may reverse to high, good for over
        score += f6w * 0.8;
    } else if (lowStreak <= 1) {
        // Recent digits already high - pattern may be ending
        score += f6w * 0.3;
        penalties.push('PATTERN_MAY_END');
    } else {
        score += f6w * 0.5;
    }

    // Factor 7: High digit concentration
    const f7w = 10; maxScore += f7w;
    const highRatio = highDigitCount / recentWindow;
    if (highRatio >= 0.50) score += f7w;
    else if (highRatio >= 0.40) score += f7w * 0.6;

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.55;
    else if (penalties.length >= 2) penaltyMultiplier = 0.70;
    else if (penalties.length >= 1) penaltyMultiplier = 0.85;

    const factorsPassed = [consecutiveAbove >= 2, aboveRatio10 >= 0.60, aboveRatio50 >= 0.68,
        longAboveRatio >= 0.68, momentumAccel || secondAboveRate >= 0.70, lowStreak < 5, highRatio >= 0.40].filter(Boolean).length;

    if (factorsPassed < 4) return emptyCat('over_under', `INSUFFICIENT_FACTORS: ${factorsPassed}/7`, quotes.length);

    const confidence = Math.min(0.88, Math.max(0, rawConfidence * penaltyMultiplier));

    let signalStrength: SignalStrength;
    if (confidence >= 0.75 && factorsPassed >= 6 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.62 && factorsPassed >= 4) signalStrength = 'MODERATE';
    else if (confidence >= 0.48) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    // Win probability for OVER 2: P(digit > 2) = 7/10 = 0.70 base
    // Conservative: weight toward base rate, slight adjustment from observed
    const adjustedWinProb = Math.min(0.78, Math.max(0.62, 0.70 + (aboveRatio50 - 0.70) * 0.3));

    const reasons = [
        `OVER2_BIAS=${(aboveRatio50 * 100).toFixed(0)}%`, `CONSEC=${consecutiveAbove}`,
        `LAST10=${aboveCount10}/10`, `LONG=${(longAboveRatio * 100).toFixed(0)}%`,
        momentumAccel ? 'ACCEL' : 'FLAT',
        penalties.length > 0 ? `PEN[${penalties.join(',')}]` : '', `F=${factorsPassed}/7`,
    ].filter(Boolean).join(' | ');

    // DIGITDIFF "NOT 2" wins ~90% of the time but Deriv pays only a small fraction of
    // stake, so it is structurally negative-EV. Cap score so it cannot pass the gate.
    const signalScore = Math.round(Math.min(55, confidence * 100));
    const regime = classifyRegime(quotes, decimals);

    return { category: 'over_under', contractType: 'DIGITDIFF', contractLabel: 'NOT 2',
        direction: null, barrier: BARRIER, confidence, signalScore, estimatedWinProbability: 0.90,
        volatility: Math.abs(bias50), sampleSize: quotes.length, reason: reasons, signalStrength,
        htfAgreement: true, ltfAgreement: true, trendAlignment: true,
        consecutiveAbove, digitAboveThreshold: aboveRatio50, regime };
}

// ═══════════════════════════════════════════════════════
// CATEGORY 4: MATCHES/DIFFERS
// ═══════════════════════════════════════════════════════
export function analyzeMatchesDiffers(input: number[], decimals: number): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 200) return emptyCat('matches_differs', `INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const digits = extractLastDigits(quotes, decimals);
    const recentWindow = 50;
    const recent = digits.slice(-recentWindow);

    const dist = digitDistribution(recent);
    const total = recent.length;
    const maxFreq = Math.max(...dist);
    const maxDigitIdx = dist.indexOf(maxFreq);
    const maxRatio = maxFreq / total;
    const lastDigit = digits[digits.length - 1];

    let sameDigitStreak = 0;
    for (let i = digits.length - 1; i >= Math.max(0, digits.length - 20); i--) {
        if (digits[i] === lastDigit) sameDigitStreak++;
        else break;
    }

    const hasRepeatingPattern = recent.length >= 3 &&
        recent[recent.length - 1] === recent[recent.length - 3] &&
        recent[recent.length - 1] !== recent[recent.length - 2];

    const veryRecent = digits.slice(-10);
    const veryRecentMax = Math.max(...digitDistribution(veryRecent));

    const penalties: string[] = [];
    let score = 0;
    let maxScore = 0;

    const skew = maxRatio - 0.1;
    const f1w = 25; maxScore += f1w;
    if (skew >= 0.10) score += f1w;
    else if (skew >= 0.06) score += f1w * 0.7;
    else if (skew >= 0.03) score += f1w * 0.4;
    else penalties.push('UNIFORM_DIST');

    const f2w = 20; maxScore += f2w;
    const chi2 = skew > 0.08 ? 20 : skew > 0.05 ? 14 : skew > 0.03 ? 10 : 5;
    if (chi2 > 18) score += f2w;
    else if (chi2 > 12) score += f2w * 0.6;

    const f3w = 15; maxScore += f3w;
    if (hasRepeatingPattern) score += f3w;
    else if (sameDigitStreak >= 2) score += f3w * 0.5;

    const f4w = 15; maxScore += f4w;
    if (maxRatio > 0.14) score += f4w;
    else if (maxRatio > 0.12) score += f4w * 0.5;

    const f5w = 10; maxScore += f5w;
    if (clusterScore(dist, total) > 0.25) score += f5w;
    else score += f5w * 0.3;

    const f6w = 15; maxScore += f6w;
    if (veryRecentMax >= 4) score += f6w;
    else if (veryRecentMax >= 3) score += f6w * 0.5;

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.6;
    else if (penalties.length >= 2) penaltyMultiplier = 0.75;

    const factorsPassed = [skew >= 0.03, chi2 > 10, hasRepeatingPattern || sameDigitStreak >= 2,
        maxRatio > 0.12, veryRecentMax >= 3, sameDigitStreak >= 1].filter(Boolean).length;
    if (factorsPassed < 3) return emptyCat('matches_differs', `INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.88, Math.max(0, rawConfidence * penaltyMultiplier));
    let signalStrength: SignalStrength;
    if (confidence >= 0.73 && factorsPassed >= 5 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.60 && factorsPassed >= 3) signalStrength = 'MODERATE';
    else if (confidence >= 0.46) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    const useMatch = maxRatio >= 0.16 && sameDigitStreak >= 2;
    const contractType: ContractType = useMatch ? 'DIGITMATCH' : 'DIGITDIFF';

    // Digit MATCH/DIFFER payouts are far below fair odds → structurally negative-EV.
    // Cap score so the gate + EV filter prevent trading it.
    const signalScore = Math.round(Math.min(55, confidence * 100));
    const regime = classifyRegime(quotes, decimals);

    const reasons = [
        `TOP=${maxDigitIdx}(${(maxRatio * 100).toFixed(0)}%)`, `STREAK=${sameDigitStreak}x${lastDigit}`,
        hasRepeatingPattern ? 'PATTERN' : '',
        penalties.length > 0 ? `PEN[${penalties.join(',')}]` : '', `F=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return { category: 'matches_differs', contractType, contractLabel: useMatch ? 'MATCH' : 'DIFFER',
        direction: null, barrier: maxDigitIdx, confidence, signalScore,
        estimatedWinProbability: useMatch ? 0.10 : 0.90, volatility: skew, sampleSize: quotes.length,
        reason: reasons, signalStrength, htfAgreement: true, ltfAgreement: true, trendAlignment: true,
        consecutiveAbove: 0, digitAboveThreshold: 0, regime };
}

function clusterScore(dist: number[], total: number): number {
    const expected = total / 10;
    return dist.reduce((acc, count) => acc + Math.abs(count - expected) / expected, 0) / 10;
}

// ═══════════════════════════════════════════════════════
// UNIVERSAL ANALYZERS
// ═══════════════════════════════════════════════════════
export function analyzeMarket(category: TradeCategory, quotes: number[], decimals = 2): AnalysisResult {
    switch (category) {
        case 'rise_fall': return analyzeRiseFall(quotes);
        case 'even_odd': return analyzeEvenOdd(quotes, decimals);
        case 'over_under': return analyzeOverUnder(quotes, decimals);
        case 'matches_differs': return analyzeMatchesDiffers(quotes, decimals);
        default: return empty('UNKNOWN_CATEGORY');
    }
}

export function analyzeBestSignal(quotes: number[], decimals: number): AnalysisResult {
    const results = [
        analyzeRiseFall(quotes),
        analyzeEvenOdd(quotes, decimals),
        analyzeOverUnder(quotes, decimals),
        analyzeMatchesDiffers(quotes, decimals),
    ];
    const valid = results.filter((r) => r.signalStrength !== 'NONE' && r.confidence > 0);
    if (valid.length === 0) return empty('NO_SIGNALS_IN_ANY_CATEGORY', quotes.length);
    return valid.sort((a, b) => b.confidence - a.confidence)[0];
}

export function inferDecimalsFromQuotes(quotes: number[]): number {
    return Math.min(8, Math.max(2, ...quotes.slice(-100).map((quote) => {
        const text = String(quote);
        return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
    })));
}

export function lastDigitOfExport(quote: number, decimals: number): number {
    return lastDigitOf(quote, decimals);
}

export interface AIIndicatorSet {
    symbol: string;
    rsi: number;
    macdLine: number;
    macdSignal: number;
    macdHist: number;
    macdAccel: boolean;
    htfTrend: number;
    htfSlope: number;
    momentum: number;
    candleUp: boolean;
    bbWidth: number;
    lastPrice: number;
    technicalScore: number;
    direction: 'CALL' | 'PUT';
    adx: number;
    stochK: number;
    htfRsi: number;
    signalStrength: string;
    htfAgreement: boolean;
    ltfAgreement: boolean;
    trendAlignment: boolean;
    category: string;
    digitBias?: number;
    digitStreak?: number;
    digitAboveThreshold?: number;
    consecutiveAbove?: number;
}

export function extractIndicators(
    quotes: number[],
    direction: 'CALL' | 'PUT' | null,
    technicalScore: number,
    category: string = 'rise_fall',
    decimals: number = 2,
): AIIndicatorSet | null {
    const clean = quotes.filter((q) => Number.isFinite(q) && q > 0);
    if (clean.length < 100) return null;

    const htf = candles(clean, 20);
    const ltf = candles(clean, 5);
    const htfClose = htf.map((c) => c.close);
    const ltfClose = ltf.map((c) => c.close);

    if (htfClose.length < 40 || ltfClose.length < 80) return null;

    const last = ltfClose[ltfClose.length - 1];
    const previous = ltfClose[ltfClose.length - 2];

    const htfFast = ema(htfClose, 20);
    const htfSlow = ema(htfClose, 50);
    const htfTrend = (htfFast[htfFast.length - 1] - htfSlow[htfSlow.length - 1]) /
        Math.max(Math.abs(htfSlow[htfSlow.length - 1]), Number.EPSILON);
    const htfSlopeVal = slope(htfClose, 5);

    const ltfM = macd(ltfClose);
    if (!ltfM) return null;

    const htfM = macd(htfClose);
    const htfRsiArr = rsi(htfClose, 14);
    const htfRsi = htfRsiArr[htfRsiArr.length - 1];

    const bb = bollinger(htfClose);
    const bbWidth = bb ? bb.width : 0;

    const roc_period = 12;
    const momentumVal = (last - ltfClose[Math.max(0, ltfClose.length - roc_period)]) /
        Math.max(Math.abs(ltfClose[Math.max(0, ltfClose.length - roc_period)]), Number.EPSILON);

    const adxVal = adx(htf, 14);
    const stochVal = stochastic(htf, 14);

    const htfAgreement = direction ? (
        (direction === 'CALL' && (htfM?.hist ?? 0) > 0) ||
        (direction === 'PUT' && (htfM?.hist ?? 0) < 0)
    ) : true;
    const ltfAgreement = direction ? (
        (direction === 'CALL' && ltfM.hist > 0 && momentumVal > 0) ||
        (direction === 'PUT' && ltfM.hist < 0 && momentumVal < 0)
    ) : true;

    // Digit stats
    const digits = extractLastDigits(clean, decimals);
    const BARRIER = 2;
    const recent50 = digits.slice(-50);
    const aboveCount = recent50.filter((d) => d > BARRIER).length;
    const digitBias = Math.abs(aboveCount / recent50.length - 0.70);

    let consecutiveAbove = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        if (digits[i] > BARRIER) consecutiveAbove++;
        else break;
    }

    return {
        symbol: '',
        rsi: (() => { const r = rsi(ltfClose); return r[r.length - 1]; })(),
        macdLine: ltfM.line,
        macdSignal: ltfM.signal,
        macdHist: ltfM.hist,
        macdAccel: direction === 'CALL' ? ltfM.hist > ltfM.prev_hist : direction === 'PUT' ? ltfM.hist < ltfM.prev_hist : Math.abs(ltfM.hist) > Math.abs(ltfM.prev_hist),
        htfTrend,
        htfSlope: htfSlopeVal,
        momentum: momentumVal,
        candleUp: last > previous,
        bbWidth,
        lastPrice: last,
        technicalScore,
        direction: direction || 'CALL',
        adx: adxVal,
        stochK: stochVal,
        htfRsi,
        signalStrength: technicalScore >= 0.78 ? 'STRONG' : technicalScore >= 0.65 ? 'MODERATE' : 'WEAK',
        htfAgreement,
        ltfAgreement,
        trendAlignment: htfAgreement && ltfAgreement,
        category,
        digitBias,
        consecutiveAbove,
        digitAboveThreshold: aboveCount / recent50.length,
    };
}
