export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';
export type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

export interface AnalysisResult {
    category: TradeCategory;
    contractType: ContractType | null;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    confidence: number;
    estimatedWinProbability: number;
    volatility: number;
    sampleSize: number;
    reason: string;
    signalStrength: SignalStrength;
    htfAgreement: boolean;
    ltfAgreement: boolean;
    trendAlignment: boolean;
}

type Candle = { open: number; high: number; low: number; close: number };

const empty = (reason: string, sampleSize = 0): AnalysisResult => ({
    category: 'rise_fall',
    contractType: null,
    direction: null,
    barrier: null,
    confidence: 0,
    estimatedWinProbability: 0.5,
    volatility: 0,
    sampleSize,
    reason,
    signalStrength: 'NONE',
    htfAgreement: false,
    ltfAgreement: false,
    trendAlignment: false,
});

const emptyCat = (category: TradeCategory, reason: string, sampleSize = 0): AnalysisResult => ({
    ...empty(reason, sampleSize),
    category,
});

const finiteQuotes = (quotes: number[]) =>
    quotes.filter((quote) => Number.isFinite(quote) && quote > 0);

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
    return (values[values.length - 1] - start) / Math.max(Math.abs(start), Number.EPSILON);
}

function macd(values: number[], fast = 12, slow = 26, signal = 9): {
    line: number; signal: number; hist: number; prev_hist: number;
    prev2_hist: number; bullish_cross: boolean; bearish_cross: boolean;
} | null {
    if (values.length < slow + signal) return null;
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = ef.map((_, i) => ef[i] - es[i]);
    const sig = ema(line, signal);
    const len = line.length;
    const hist = line[len - 1] - sig[len - 1];
    const prev_hist = len > 1 ? line[len - 2] - sig[len - 2] : 0;
    const prev2_hist = len > 2 ? line[len - 3] - sig[len - 3] : 0;
    return {
        line: line[len - 1],
        signal: sig[len - 1],
        hist,
        prev_hist,
        prev2_hist,
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
    const dx = Math.abs(plusDI - minusDI) / diSum * 100;
    return dx;
}

// ─── DIGIT EXTRACTION ───
function lastDigitOf(quote: number, decimals: number): number {
    return Math.abs(Math.round(quote * 10 ** decimals) % 10);
}

function extractLastDigits(quotes: number[], decimals: number): number[] {
    return quotes.map((q) => lastDigitOf(q, decimals));
}

// ─── DIGIT STATISTICAL HELPERS ───
function chiSquaredUniform(observed: number[], expected: number): number {
    let chi = 0;
    for (let i = 0; i < observed.length; i++) {
        const diff = observed[i] - expected;
        chi += (diff * diff) / expected;
    }
    return chi;
}

function digitDistribution(digits: number[]): number[] {
    const dist = new Array(10).fill(0);
    for (const d of digits) dist[d]++;
    return dist;
}

function movingDigitBias(digits: number[], window: number): { bias: number; confidence: number } {
    if (digits.length < window) return { bias: 0, confidence: 0 };
    const recent = digits.slice(-window);
    const dist = digitDistribution(recent);
    // Test against uniform distribution (each digit ~10%)
    const chi2 = chiSquaredUniform(dist, window / 10);
    // Degrees of freedom = 9, critical value at p=0.05 is 16.919
    const significant = chi2 > 16.919;
    return { bias: chi2, confidence: significant ? Math.min(0.95, 0.5 + chi2 / 60) : 0.5 };
}

// ═══════════════════════════════════════════════════════
// CATEGORY 1: RISE/FALL (existing, kept as-is)
// ═══════════════════════════════════════════════════════
export function analyzeRiseFall(input: number[]): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 500) return empty(`INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

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
    const htf_bullish = htf_trend_strength > 0.0001;
    const htf_bearish = htf_trend_strength < -0.0001;
    const htf_slope_val = slope(htf_close, 5);

    const htf_macd = macd(htf_close);
    if (!htf_macd) return empty('INSUFFICIENT_HTF_MACD', quotes.length);
    const htf_macd_bull = htf_macd.hist > 0;
    const htf_macd_bear = htf_macd.hist < 0;
    const htf_macd_accel = Math.abs(htf_macd.hist) > Math.abs(htf_macd.prev_hist);

    const ltf_macd = macd(ltf_close);
    if (!ltf_macd) return empty('INSUFFICIENT_LTF_MACD', quotes.length);
    const ltf_macd_bull = ltf_macd.hist > 0;
    const ltf_macd_bear = ltf_macd.hist < 0;

    const htf_rsi_arr = rsi(htf_close, 14);
    const htf_rsi = htf_rsi_arr[htf_rsi_arr.length - 1];
    const htf_rsi_prev = htf_rsi_arr.length > 1 ? htf_rsi_arr[htf_rsi_arr.length - 2] : 50;

    const roc_period = 12;
    const momentum_now = (last - ltf_close[Math.max(0, ltf_close.length - roc_period)]) /
        Math.max(Math.abs(ltf_close[Math.max(0, ltf_close.length - roc_period)]), Number.EPSILON);
    const momentum_prev = (previous - ltf_close[Math.max(0, ltf_close.length - roc_period - 1)]) /
        Math.max(Math.abs(ltf_close[Math.max(0, ltf_close.length - roc_period - 1)]), Number.EPSILON);
    const momentum_accel = Math.abs(momentum_now) > Math.abs(momentum_prev);

    const adx_val = adx(htf, 14);
    const ltf_candle_up_count = ltf.slice(-3).filter((c) => c.close > c.open).length;
    const ltf_candle_down_count = 3 - ltf_candle_up_count;

    const bb = bollinger(htf_close, 20, 2.0);
    if (bb && bb.width < 0.00015) return empty('DEAD_MARKET', quotes.length);
    const stoch_val = stochastic(htf, 14);

    if (bb) {
        if (last > bb.upper + range * 0.5 && htf_rsi > 75) return empty('EXTREME_OVERBOUGHT', quotes.length);
        if (last < bb.lower - range * 0.5 && htf_rsi < 25) return empty('EXTREME_OVERSOLD', quotes.length);
    }

    let direction: 'CALL' | 'PUT';
    if (htf_macd_bull && ltf_macd_bull) {
        direction = 'CALL';
    } else if (htf_macd_bear && ltf_macd_bear) {
        direction = 'PUT';
    } else {
        return empty('NO_DUAL_TIMEFRAME_SIGNAL', quotes.length);
    }

    const htfAgreement = (direction === 'CALL' && htf_macd_bull) || (direction === 'PUT' && htf_macd_bear);
    const ltfAgreement = (direction === 'CALL' && ltf_macd_bull && momentum_now > 0) ||
        (direction === 'PUT' && ltf_macd_bear && momentum_now < 0);
    if (!htfAgreement) return empty('HTF_DISAGREEMENT', quotes.length);

    let score = 0;
    let maxScore = 0;
    const penalties: string[] = [];

    const f1w = 15; maxScore += f1w;
    if ((direction === 'CALL' && htf_trend_strength > 0.001) || (direction === 'PUT' && htf_trend_strength < -0.001)) score += f1w;
    else if ((direction === 'CALL' && htf_trend_strength > 0.0005) || (direction === 'PUT' && htf_trend_strength < -0.0005)) score += f1w * 0.7;
    else if ((direction === 'CALL' && htf_trend_strength > 0) || (direction === 'PUT' && htf_trend_strength < 0)) score += f1w * 0.3;

    const f2w = 15; maxScore += f2w;
    if (htf_macd_accel && Math.abs(htf_macd.hist) > Math.abs(htf_macd.prev_hist) * 1.5) score += f2w;
    else if (htf_macd_accel) score += f2w * 0.6;

    const f3w = 12; maxScore += f3w;
    if (ltfAgreement) score += f3w;
    else if ((direction === 'CALL' && ltf_macd_bull) || (direction === 'PUT' && ltf_macd_bear)) score += f3w * 0.4;

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
    if ((direction === 'CALL' && momentum_now > 0.001 && momentum_accel) || (direction === 'PUT' && momentum_now < -0.001 && momentum_accel)) score += f5w;
    else if ((direction === 'CALL' && momentum_now > 0.0003) || (direction === 'PUT' && momentum_now < -0.0003)) score += f5w * 0.5;

    const f6w = 8; maxScore += f6w;
    if (adx_val >= 25) score += f6w;
    else if (adx_val >= 18) score += f6w * 0.7;
    else if (adx_val >= 12) score += f6w * 0.3;
    else penalties.push('WEAK_TREND');

    const f7w = 10; maxScore += f7w;
    if (direction === 'CALL' && ltf_candle_up_count >= 2) score += f7w;
    else if (direction === 'PUT' && ltf_candle_down_count >= 2) score += f7w;
    else if (direction === 'CALL' && ltf_candle_up_count >= 1) score += f7w * 0.3;
    else if (direction === 'PUT' && ltf_candle_down_count >= 1) score += f7w * 0.3;

    const f8w = 8; maxScore += f8w;
    if (bb) {
        const bbPos = (last - bb.lower) / (bb.upper - bb.lower || 1);
        if (bbPos >= 0.3 && bbPos <= 0.7) score += f8w;
        else if (bbPos >= 0.2 && bbPos <= 0.8) score += f8w * 0.5;
        else penalties.push('BB_EXTREME');
    } else { score += f8w * 0.5; }

    const f9w = 8; maxScore += f9w;
    if ((direction === 'CALL' && htf_slope_val > 0.0002) || (direction === 'PUT' && htf_slope_val < -0.0002)) score += f9w;
    else if ((direction === 'CALL' && htf_slope_val > 0) || (direction === 'PUT' && htf_slope_val < 0)) score += f9w * 0.4;

    if (direction === 'CALL' && htf_rsi_prev > htf_rsi + 3) penalties.push('RSI_DIVERGENCE');
    if (direction === 'PUT' && htf_rsi_prev < htf_rsi - 3) penalties.push('RSI_DIVERGENCE');
    if (Math.abs(htf_macd.hist - htf_macd.prev_hist) < 0.00001 * last) penalties.push('MACD_FLAT');

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.6;
    else if (penalties.length >= 2) penaltyMultiplier = 0.75;
    else if (penalties.length >= 1) penaltyMultiplier = 0.9;

    const factorsPassed = [htfAgreement, ltfAgreement, htf_macd_accel, momentum_accel, adx_val >= 15,
        (direction === 'CALL' && ltf_candle_up_count >= 1) || (direction === 'PUT' && ltf_candle_down_count >= 1),
    ].filter(Boolean).length;
    if (factorsPassed < 3) return empty(`INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.92, Math.max(0, rawConfidence * penaltyMultiplier));
    let signalStrength: SignalStrength;
    if (confidence >= 0.78 && factorsPassed >= 5 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.65 && factorsPassed >= 3) signalStrength = 'MODERATE';
    else if (confidence >= 0.50) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    const trendAlignment = htfAgreement && ltfAgreement;
    const reasons = [
        `ADX=${adx_val.toFixed(1)}`, `HTF_RSI=${htf_rsi.toFixed(1)}`,
        `MOM=${(momentum_now * 10000).toFixed(1)}bps`, htf_macd_accel ? 'MACD_ACCEL' : '',
        trendAlignment ? 'DUAL_TF' : 'PARTIAL_TF',
        penalties.length > 0 ? `PENALTY[${penalties.join(',')}]` : '', `FACTORS=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return { category: 'rise_fall', contractType: direction, direction, barrier: null, confidence,
        estimatedWinProbability: confidence, volatility: range, sampleSize: quotes.length,
        reason: reasons, signalStrength, htfAgreement, ltfAgreement, trendAlignment };
}

// ═══════════════════════════════════════════════════════
// CATEGORY 2: EVEN/ODD
// Analyzes last-digit distribution for statistical bias
// ═══════════════════════════════════════════════════════
export function analyzeEvenOdd(input: number[], decimals: number): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 200) return emptyCat('even_odd', `INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const digits = extractLastDigits(quotes, decimals);
    const recentWindow = 50;
    const longWindow = 150;
    const recent = digits.slice(-recentWindow);
    const longTerm = digits.slice(-longWindow);

    const evenCount = recent.filter((d) => d % 2 === 0).length;
    const oddCount = recentWindow - evenCount;
    const evenRatio = evenCount / recentWindow;
    const oddRatio = oddCount / recentWindow;

    const longEven = longTerm.filter((d) => d % 2 === 0).length / longWindow;
    const longOdd = 1 - longEven;

    // Chi-squared test for digit uniformity
    const chi2 = movingDigitBias(digits, recentWindow);

    // Streak detection
    let streak = 0;
    let streakDir = digits[digits.length - 1] % 2 === 0 ? 'even' : 'odd';
    for (let i = digits.length - 1; i >= Math.max(0, digits.length - 20); i--) {
        const isEven = digits[i] % 2 === 0;
        if ((streakDir === 'even' && isEven) || (streakDir === 'odd' && !isEven)) streak++;
        else break;
    }

    // Momentum: is the bias accelerating?
    const firstHalf = recent.slice(0, Math.floor(recentWindow / 2));
    const secondHalf = recent.slice(Math.floor(recentWindow / 2));
    const firstEvenRatio = firstHalf.filter((d) => d % 2 === 0).length / firstHalf.length;
    const secondEvenRatio = secondHalf.filter((d) => d % 2 === 0).length / secondHalf.length;
    const momentumShift = secondEvenRatio - firstEvenRatio;

    const penalties: string[] = [];
    let score = 0;
    let maxScore = 0;

    // Factor 1: Recent bias strength (weight 25)
    const f1w = 25; maxScore += f1w;
    const bias = Math.abs(evenRatio - 0.5);
    if (bias >= 0.16) score += f1w;         // >58% one direction
    else if (bias >= 0.10) score += f1w * 0.7;  // >55%
    else if (bias >= 0.06) score += f1w * 0.4;  // >53%
    else penalties.push('WEAK_BIAS');

    // Factor 2: Statistical significance (weight 20)
    const f2w = 20; maxScore += f2w;
    if (chi2.bias > 20) score += f2w;
    else if (chi2.bias > 15) score += f2w * 0.6;
    else if (chi2.bias > 10) score += f2w * 0.3;
    else penalties.push('NO_SIGNIFICANCE');

    // Factor 3: Momentum alignment (weight 15)
    const f3w = 15; maxScore += f3w;
    const targetEven = evenRatio > 0.5;
    if (targetEven && momentumShift > 0.05) score += f3w;
    else if (!targetEven && momentumShift < -0.05) score += f3w;
    else if (Math.abs(momentumShift) < 0.02) score += f3w * 0.4; // Stable bias

    // Factor 4: Long-term trend alignment (weight 15)
    const f4w = 15; maxScore += f4w;
    if (targetEven && longEven > 0.52) score += f4w;
    else if (!targetEven && longOdd > 0.52) score += f4w;
    else if (targetEven && longEven > 0.50) score += f4w * 0.5;
    else if (!targetEven && longOdd > 0.50) score += f4w * 0.5;

    // Factor 5: Streak confirmation (weight 10)
    const f5w = 10; maxScore += f5w;
    const streakIsEven = streakDir === 'even';
    if ((targetEven && streakIsEven && streak >= 3) || (!targetEven && !streakIsEven && streak >= 3)) {
        score += f5w;
    } else if (streak >= 5) {
        score += f5w * 0.5; // Long streak may reverse
        penalties.push('STREAK_REVERSAL_RISK');
    }

    // Factor 6: Digit distribution health (weight 15)
    const f6w = 15; maxScore += f6w;
    const dist = digitDistribution(digits.slice(-100));
    const maxDigit = Math.max(...dist);
    const minDigit = Math.min(...dist);
    const spread = maxDigit - minDigit;
    if (spread <= 6) score += f6w; // Healthy distribution
    else if (spread <= 8) score += f6w * 0.5;
    else penalties.push('SKEWED_DIST');

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.6;
    else if (penalties.length >= 2) penaltyMultiplier = 0.75;
    else if (penalties.length >= 1) penaltyMultiplier = 0.9;

    const factorsPassed = [bias >= 0.06, chi2.bias > 12, Math.abs(momentumShift) < 0.08,
        longEven > 0.50 !== longOdd > 0.50, streak >= 2, spread <= 7].filter(Boolean).length;
    if (factorsPassed < 3) return emptyCat('even_odd', `INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.90, Math.max(0, rawConfidence * penaltyMultiplier));

    let signalStrength: SignalStrength;
    if (confidence >= 0.75 && factorsPassed >= 5 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.62 && factorsPassed >= 3) signalStrength = 'MODERATE';
    else if (confidence >= 0.48) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    const contractType: ContractType = evenRatio > 0.5 ? 'DIGITEVEN' : 'DIGITODD';
    const reasons = [
        `EVEN=${(evenRatio * 100).toFixed(0)}%`, `ODD=${(oddRatio * 100).toFixed(0)}%`,
        `CHI2=${chi2.bias.toFixed(1)}`, `STREAK=${streak}${streakDir[0].toUpperCase()}`,
        `MOM=${(momentumShift * 100).toFixed(1)}%`, `LONG_EVEN=${(longEven * 100).toFixed(0)}%`,
        penalties.length > 0 ? `PEN[${penalties.join(',')}]` : '', `F=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return { category: 'even_odd', contractType, direction: null, barrier: null, confidence,
        estimatedWinProbability: confidence, volatility: bias, sampleSize: quotes.length,
        reason: reasons, signalStrength, htfAgreement: true, ltfAgreement: true, trendAlignment: true };
}

// ═══════════════════════════════════════════════════════
// CATEGORY 3: OVER/UNDER
// Analyzes last-digit distribution vs barrier 5
// ═══════════════════════════════════════════════════════
export function analyzeOverUnder(input: number[], decimals: number): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 200) return emptyCat('over_under', `INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const digits = extractLastDigits(quotes, decimals);
    const recentWindow = 50;
    const recent = digits.slice(-recentWindow);

    const overCount = recent.filter((d) => d > 5).length; // 6,7,8,9
    const underCount = recent.filter((d) => d <= 4).length; // 0,1,2,3,4
    const fiveCount = recent.filter((d) => d === 5).length;
    const usableCount = recentWindow - fiveCount; // Exclude 5s

    if (usableCount < 20) return emptyCat('over_under', 'TOO_MANY_FIVES', quotes.length);

    const overRatio = overCount / usableCount;
    const underRatio = underCount / usableCount;

    // Long-term baseline
    const longDigits = digits.slice(-150);
    const longOver = longDigits.filter((d) => d > 5).length / longDigits.length;
    const longUnder = longDigits.filter((d) => d <= 4).length / longDigits.length;

    // Moving window bias
    const chi2 = movingDigitBias(digits, recentWindow);

    // Streak
    let streak = 0;
    let streakDir: 'over' | 'under' = digits[digits.length - 1] > 5 ? 'over' : 'under';
    for (let i = digits.length - 1; i >= Math.max(0, digits.length - 20); i--) {
        const isOver = digits[i] > 5;
        const isUnder = digits[i] <= 4;
        if (digits[i] === 5) continue; // Skip 5s in streak
        if ((streakDir === 'over' && isOver) || (streakDir === 'under' && isUnder)) streak++;
        else break;
    }

    // Momentum
    const firstHalf = recent.slice(0, Math.floor(recentWindow / 2));
    const secondHalf = recent.slice(Math.floor(recentWindow / 2));
    const firstOverRatio = firstHalf.filter((d) => d > 5).length / Math.max(firstHalf.filter((d) => d !== 5).length, 1);
    const secondOverRatio = secondHalf.filter((d) => d > 5).length / Math.max(secondHalf.filter((d) => d !== 5).length, 1);
    const momentumShift = secondOverRatio - firstOverRatio;

    const penalties: string[] = [];
    let score = 0;
    let maxScore = 0;

    const bias = Math.max(overRatio, underRatio) - 0.5;
    const f1w = 25; maxScore += f1w;
    if (bias >= 0.14) score += f1w;
    else if (bias >= 0.08) score += f1w * 0.7;
    else if (bias >= 0.04) score += f1w * 0.4;
    else penalties.push('WEAK_BIAS');

    const f2w = 20; maxScore += f2w;
    if (chi2.bias > 18) score += f2w;
    else if (chi2.bias > 13) score += f2w * 0.6;
    else if (chi2.bias > 9) score += f2w * 0.3;
    else penalties.push('NO_SIGNIFICANCE');

    const f3w = 15; maxScore += f3w;
    const targetOver = overRatio > underRatio;
    if (targetOver && momentumShift > 0.04) score += f3w;
    else if (!targetOver && momentumShift < -0.04) score += f3w;
    else if (Math.abs(momentumShift) < 0.03) score += f3w * 0.4;

    const f4w = 15; maxScore += f4w;
    if (targetOver && longOver > 0.42) score += f4w;
    else if (!targetOver && longUnder > 0.42) score += f4w;
    else score += f4w * 0.3;

    const f5w = 10; maxScore += f5w;
    const streakIsOver = streakDir === 'over';
    if ((targetOver && streakIsOver && streak >= 3) || (!targetOver && !streakIsOver && streak >= 3)) score += f5w;
    else if (streak >= 6) { score += f5w * 0.4; penalties.push('STREAK_REVERSAL_RISK'); }

    const f6w = 15; maxScore += f6w;
    const fiveRate = fiveCount / recentWindow;
    if (fiveRate < 0.15) score += f6w;
    else if (fiveRate < 0.20) score += f6w * 0.6;
    else penalties.push('HIGH_FIVE_RATE');

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.6;
    else if (penalties.length >= 2) penaltyMultiplier = 0.75;
    else if (penalties.length >= 1) penaltyMultiplier = 0.9;

    const factorsPassed = [bias >= 0.04, chi2.bias > 10, Math.abs(momentumShift) < 0.08,
        longOver > 0.38, streak >= 2, fiveRate < 0.20].filter(Boolean).length;
    if (factorsPassed < 3) return emptyCat('over_under', `INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.88, Math.max(0, rawConfidence * penaltyMultiplier));
    let signalStrength: SignalStrength;
    if (confidence >= 0.73 && factorsPassed >= 5 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.60 && factorsPassed >= 3) signalStrength = 'MODERATE';
    else if (confidence >= 0.46) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    const contractType: ContractType = overRatio > underRatio ? 'DIGITOVER' : 'DIGITUNDER';
    const reasons = [
        `OVER=${(overRatio * 100).toFixed(0)}%`, `UNDER=${(underRatio * 100).toFixed(0)}%`,
        `FIVE=${fiveCount}`, `CHI2=${chi2.bias.toFixed(1)}`, `STREAK=${streak}${streakDir[0].toUpperCase()}`,
        `MOM=${(momentumShift * 100).toFixed(1)}%`,
        penalties.length > 0 ? `PEN[${penalties.join(',')}]` : '', `F=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return { category: 'over_under', contractType, direction: null, barrier: 5, confidence,
        estimatedWinProbability: confidence, volatility: bias, sampleSize: quotes.length,
        reason: reasons, signalStrength, htfAgreement: true, ltfAgreement: true, trendAlignment: true };
}

// ═══════════════════════════════════════════════════════
// CATEGORY 4: MATCHES/DIFFERS
// Analyzes last-digit repetition patterns
// ═══════════════════════════════════════════════════════
export function analyzeMatchesDiffers(input: number[], decimals: number): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 200) return emptyCat('matches_differs', `INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const digits = extractLastDigits(quotes, decimals);
    const recentWindow = 50;
    const recent = digits.slice(-recentWindow);

    // Analyze digit repetition patterns
    const dist = digitDistribution(recent);
    const total = recent.length;

    // Find the most and least common digits
    const maxFreq = Math.max(...dist);
    const minFreq = Math.min(...dist);
    const maxDigitIdx = dist.indexOf(maxFreq);
    const minDigitIdx = dist.indexOf(minFreq);

    const maxRatio = maxFreq / total;
    const minRatio = minFreq / total;

    // Pattern detection: look for repeating sequences
    const lastDigit = digits[digits.length - 1];
    const secondLast = digits[digits.length - 2];
    const lastThree = digits.slice(-3);
    const hasRepeatingPattern = lastThree[0] === lastThree[2] && lastThree[0] !== lastThree[1];

    // Chi-squared test
    const chi2 = movingDigitBias(digits, recentWindow);

    // Streak of same digit
    let sameDigitStreak = 0;
    for (let i = digits.length - 1; i >= Math.max(0, digits.length - 20); i--) {
        if (digits[i] === lastDigit) sameDigitStreak++;
        else break;
    }

    // Gap analysis: how long since this digit last appeared before the streak?
    let gapSinceLastSeen = 0;
    if (sameDigitStreak <= 1) {
        for (let i = digits.length - 2; i >= Math.max(0, digits.length - 50); i--) {
            gapSinceLastSeen++;
            if (digits[i] === lastDigit) break;
        }
    }

    // Digit clustering: are certain digits appearing in groups?
    const clusterScore = dist.reduce((acc, count) => {
        const expected = total / 10;
        return acc + Math.abs(count - expected) / expected;
    }, 0) / 10;

    // Long-term baseline
    const longDist = digitDistribution(digits.slice(-150));
    const longMaxRatio = Math.max(...longDist) / 150;
    const longMinRatio = Math.min(...longDist) / 150;

    const penalties: string[] = [];
    let score = 0;
    let maxScore = 0;

    // Factor 1: Distribution skew (weight 25)
    const f1w = 25; maxScore += f1w;
    const skew = maxRatio - 0.1; // How far from uniform 10%
    if (skew >= 0.10) score += f1w;
    else if (skew >= 0.06) score += f1w * 0.7;
    else if (skew >= 0.03) score += f1w * 0.4;
    else penalties.push('UNIFORM_DIST');

    // Factor 2: Statistical significance (weight 20)
    const f2w = 20; maxScore += f2w;
    if (chi2.bias > 18) score += f2w;
    else if (chi2.bias > 13) score += f2w * 0.6;
    else if (chi2.bias > 9) score += f2w * 0.3;
    else penalties.push('NO_SIGNIFICANCE');

    // Factor 3: Pattern detection (weight 15)
    const f3w = 15; maxScore += f3w;
    if (hasRepeatingPattern) score += f3w;
    else if (sameDigitStreak >= 2) score += f3w * 0.5;
    else if (gapSinceLastSeen >= 8) score += f3w * 0.3; // Long gap = likely to appear

    // Factor 4: Long-term trend alignment (weight 15)
    const f4w = 15; maxScore += f4w;
    if (maxRatio > longMaxRatio * 0.9) score += f4w;
    else if (maxRatio > longMaxRatio * 0.7) score += f4w * 0.5;
    else penalties.push('LONG_TERM_MISMATCH');

    // Factor 5: Cluster quality (weight 10)
    const f5w = 10; maxScore += f5w;
    if (clusterScore > 0.3 && clusterScore < 0.8) score += f5w;
    else if (clusterScore <= 0.3) score += f5w * 0.3; // Too uniform
    else penalties.push('EXTREME_CLUSTER');

    // Factor 6: Recency bias (weight 15)
    const f6w = 15; maxScore += f6w;
    const veryRecent = digits.slice(-10);
    const veryRecentMax = Math.max(...digitDistribution(veryRecent));
    if (veryRecentMax >= 4) score += f6w; // Same digit appeared 4+ times in last 10
    else if (veryRecentMax >= 3) score += f6w * 0.5;

    const rawConfidence = score / (maxScore || 1);
    let penaltyMultiplier = 1.0;
    if (penalties.length >= 3) penaltyMultiplier = 0.6;
    else if (penalties.length >= 2) penaltyMultiplier = 0.75;
    else if (penalties.length >= 1) penaltyMultiplier = 0.9;

    const factorsPassed = [skew >= 0.03, chi2.bias > 10, hasRepeatingPattern || sameDigitStreak >= 2,
        maxRatio > longMaxRatio * 0.7, clusterScore > 0.2, veryRecentMax >= 3].filter(Boolean).length;
    if (factorsPassed < 3) return emptyCat('matches_differs', `INSUFFICIENT_FACTORS: ${factorsPassed}/6`, quotes.length);

    const confidence = Math.min(0.88, Math.max(0, rawConfidence * penaltyMultiplier));
    let signalStrength: SignalStrength;
    if (confidence >= 0.73 && factorsPassed >= 5 && penalties.length === 0) signalStrength = 'STRONG';
    else if (confidence >= 0.60 && factorsPassed >= 3) signalStrength = 'MODERATE';
    else if (confidence >= 0.46) signalStrength = 'WEAK';
    else signalStrength = 'NONE';

    // Decision: MATCH if the most common digit is appearing frequently, DIFFER otherwise
    const useMatch = maxRatio >= 0.16 && sameDigitStreak >= 2;
    const contractType: ContractType = useMatch ? 'DIGITMATCH' : 'DIGITDIFF';

    const reasons = [
        `TOP=${maxDigitIdx}(${(maxRatio * 100).toFixed(0)}%)`, `LOW=${minDigitIdx}(${(minRatio * 100).toFixed(0)}%)`,
        `CHI2=${chi2.bias.toFixed(1)}`, `STREAK=${sameDigitStreak}x${lastDigit}`,
        hasRepeatingPattern ? 'PATTERN' : '', `CLUSTER=${clusterScore.toFixed(2)}`,
        penalties.length > 0 ? `PEN[${penalties.join(',')}]` : '', `F=${factorsPassed}/6`,
    ].filter(Boolean).join(' | ');

    return { category: 'matches_differs', contractType, direction: null, barrier: useMatch ? maxDigitIdx : null, confidence,
        estimatedWinProbability: confidence, volatility: skew, sampleSize: quotes.length,
        reason: reasons, signalStrength, htfAgreement: true, ltfAgreement: true, trendAlignment: true };
}

// ═══════════════════════════════════════════════════════
// UNIVERSAL MARKET ANALYZER
// Runs all 4 categories and returns the best signal
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

/**
 * Run ALL categories on the same tick data and return the best signal.
 * Used by the engine to find the highest-confidence opportunity.
 */
export function analyzeBestSignal(quotes: number[], decimals: number): AnalysisResult {
    const results = [
        analyzeRiseFall(quotes),
        analyzeEvenOdd(quotes, decimals),
        analyzeOverUnder(quotes, decimals),
        analyzeMatchesDiffers(quotes, decimals),
    ];

    // Sort by confidence descending, return the best
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
}

export function extractIndicators(
  quotes: number[],
  direction: 'CALL' | 'PUT' | null,
  technicalScore: number,
  category: string = 'rise_fall',
  decimals: number = 2,
): AIIndicatorSet | null {
  const clean = quotes.filter((q) => Number.isFinite(q) && q > 0);
  if (clean.length < 200) return null;

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

  // Digit-specific stats
  const digits = extractLastDigits(clean, decimals);
  const recentDigits = digits.slice(-50);
  const evenCount = recentDigits.filter((d) => d % 2 === 0).length;
  const digitBias = Math.abs(evenCount / recentDigits.length - 0.5);
  const lastDigitVal = digits[digits.length - 1];
  let digitStreak = 0;
  for (let i = digits.length - 1; i >= Math.max(0, digits.length - 20); i--) {
    if (digits[i] === lastDigitVal) digitStreak++;
    else break;
  }

  return {
    symbol: '',
    rsi: rsi(ltfClose)[rsi(ltfClose).length - 1],
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
    digitStreak,
  };
}
