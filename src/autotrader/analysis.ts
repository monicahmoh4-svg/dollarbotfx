export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

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

function rsi(values: number[], period = 14): number {
    if (values.length <= period) return 50;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i += 1) {
        const change = values[i] - values[i - 1];
        if (change >= 0) gain += change;
        else loss -= change;
    }
    gain /= period;
    loss /= period;
    for (let i = period + 1; i < values.length; i += 1) {
        const change = values[i] - values[i - 1];
        gain = (gain * (period - 1) + Math.max(change, 0)) / period;
        loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
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

function macd(values: number[], fast = 12, slow = 26, signal = 9): { line: number; signal: number; hist: number; prev_hist: number } | null {
    if (values.length < slow + signal) return null;
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = ef.map((_, i) => ef[i] - es[i]);
    const sig = ema(line, signal);
    const prev_hist = line.length > 1 ? line[line.length - 2] - sig[sig.length - 2] : 0;
    return { line: line[line.length - 1], signal: sig[sig.length - 1], hist: line[line.length - 1] - sig[sig.length - 1], prev_hist };
}

function bollinger(values: number[], period = 20, m = 2.0): { mid: number; upper: number; lower: number; width: number } | null {
    if (values.length < period) return null;
    const window = values.slice(-period);
    const mean = window.reduce((s, v) => s + v, 0) / period;
    const sd = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    return { mid: mean, upper: mean + m * sd, lower: mean - m * sd, width: (2 * m * sd) / (mean || 1) };
}

/**
 * Calibrated multi-confirmation analysis for short-duration synthetic indices.
 * Uses MACD crossover + RESI+Regime * HTF trend alignment + volatility filtering.
 * The returned confidence is a model score (weighted confirmations), not a promise
 * of winning; the engine must still compare it with the actual proposal payout.
 */
export function analyzeRiseFall(input: number[]): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 400) return empty(`INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const htf = candles(quotes, 20);
    const ltf = candles(quotes, 5);
    const htf_close = htf.map((c) => c.close);
    const ltf_close = ltf.map((c) => c.close);

    if (htf_close.length < 30 || ltf_close.length < 60) {
        return empty(`INSUFFICIENT_CANDLES: HTF=${htf_close.length}, LTF=${ltf_close.length}`, quotes.length);
    }

    const last = ltf_close[ltf_close.length - 1];
    const previous = ltf_close[ltf_close.length - 2];
    const range = atr(htf);
    if (!range || !Number.isFinite(range)) return empty('ZERO_VOLATILITY', quotes.length);

    // 1. HTF trend direction (EMA 20/50) -- determines BIAS only
    const htf_fast = ema(htf_close, 20);
    const htf_slow = ema(htf_close, 50);
    const htf_trend = (htf_fast[htf_fast.length - 1] - htf_slow[htf_slow.length - 1]) / Math.max(Math.abs(htf_slow[htf_slow.length - 1]), Number.EPSILON);
    const htf_slope = slope(htf_close, 5);

    // 2. HTF LACD -- This DREVES the signal
    const m = macd(ltf_close);
    if (!m) return empty('INSUFFICIENT_MACD', quotes.length);

    // 3. RESE on HTF
    const currentRsi = rsi(ltf_close);

    // 4. Volatility regime filter (Bollinger)
    const bb = bollinger(htf_close);
    if (bb && bb.width < 0.0002) return empty('DEAD_MARKET', quotes.length);

    // 5. Mean reversion guards
    if (bb && last > bb.upper && currentRsi > 70) {
        return empty('OVERBOUGHT', quotes.length);
    }
    if (bb && last < bb.lower && currentRsi < 30) {
        return empty('OVERSOLD', quotes.length);
    }

    // 6. Momentum (ROC 8)
    const momentum = (last - ltf_close[Math.max(0, ltf_close.length - 8)]) / Math.max(Math.abs(ltf_close[Math.max(0, ltf_close.length - 8)]), Number.EPSILON);

    // 7. LTF candle direction
    const candle_up = last > previous;

    // === DIRECTION DETERMINATION ===
    // Primary: MACD crossover + acceleration
    const macd_bull = m.line > m.signal;
    const macd_bear = m.line < m.signal;
    const macd_accel_bull = m.hist > m.prev_hist;
    const macd_accel_bear = m.hist < m.prev_hist;

    let direction: 'CALL' | 'PUT';
    let trend_score: number;

    if (macd_bull && macd_accel_bull) {
        direction = 'CALL';
        trend_score = htf_trend > 0 ? 1.0 : 0.5;
    } else if (macd_bear && macd_accel_bear) {
        direction = 'PUT';
        trend_score = htf_trend < 0 ? 1.0 : 0.5;
    } else {
        return empty('NO_CLEAR_SIGNAL', quotes.length);
    }

    // === CONFIRMATION SCORING ===
    let score = 0.0;
    let weights = 0.0;

    // RESE confirmation (weight 0.20)
    if (direction === 'CALL') {
        if (50 <= currentRsi && currentRsi <= 68) score += 1.0 * 0.20;
        else if (42 <= currentRsi && currentRsi < 50) score += 0.5 * 0.20;
        else score += 0.0 * 0.20;
    } else {
        if (32 <= currentRsi && currentRsi <= 50) score += 1.0 * 0.20;
        else if (50 < currentRsi && currentRsi <= 58) score += 0.5 * 0.20;
        else score += 0.0 * 0.20;
    }
    weights += 0.20;

    // HTF trend alignment (weight 0.25)
    score += trend_score * 0.25;
    weights += 0.25;

    // Momentum (weight 0.20)
    if (direction === 'CALL' && momentum > 0.0005) {
        score += 1.0 * 0.20;
    } else if (direction === 'CALL' && momentum > 0) {
        score += 0.5 * 0.20;
    } else if (direction === 'PUT' && momentum < -0.0005) {
        score += 1.0 * 0.20;
    } else if (direction === 'PUT' && momentum < 0) {
        score += 0.5 * 0.20;
    }
    weights += 0.20;

    // Candle direction (weight 0.15)
    if ((direction === 'CALL' && candle_up) || (direction === 'PUT' && !candle_up)) {
        score += 1.0 * 0.15;
    }
    weights += 0.15;

    // HTF slope (weight 0.20)
    if (direction === 'CALL' && htf_slope > 0.0001) {
        score += 1.0 * 0.20;
    } else if (direction === 'CALL' && htf_slope > 0) {
        score += 0.5 * 0.20;
    } else if (direction === 'PUT' && htf_slope < -0.0001) {
        score += 1.0 * 0.20;
    } else if (direction === 'PUT' && htf_slope < 0) {
        score += 0.5 * 0.20;
    }
    weights += 0.20;

    const confidence = Math.min(0.95, Math.max(0, score / (weights || 1)));
    const reasons = [
        direction === 'CALL' ? 'MACD_BULL_ACCEL_MKT' : 'MACD_BEAR_ACCEL_MKT',
        Math.abs(trend_score - 1.0) < 0.01 ? 'HTF_ALIGNED' : 'WEAK_HTF',
        direction === 'CALL' && currentRsi >= 50 ? 'RESE_OK' : (direction === 'PUT' && currentRsi <= 50 ? 'RESE_OK' : ''),
    ].filter(Boolean).join('+');

    return {
        category: 'rise_fall',
        contractType: direction,
        direction,
        barrier: null,
        confidence,
        estimatedWinProbability: confidence,
        volatility: range,
        sampleSize: quotes.length,
        reason: reasons || 'SIGNAL_WORKING_CONFIRMATION',
    };
}

export function analyzeMarket(category: TradeCategory, quotes: number[], _decimals = 2): AnalysisResult {
    if (category !== 'rise_fall') return { ...empty('ONLY_RISE_FALL_SUPPORTED'), category };
    return analyzeRiseFall(quotes);
}

export function inferDecimalsFromQuotes(quotes: number[]): number {
    return Math.min(8, Math.max(2, ...quotes.slice(-100).map((quote) => {
        const text = String(quote);
        return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
    })));
}

export function lastDigitOf(quote: number, decimals: number): number {
    return Math.abs(Math.round(quote * 10 ** decimals) % 10);
}
