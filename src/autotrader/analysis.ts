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

/**
 * Conservative trend-following analysis. The returned confidence is a model
 * score, not a promise of winning; the engine must still compare it with the
 * actual proposal payout before buying.
 */
export function analyzeRiseFall(input: number[]): AnalysisResult {
    const quotes = finiteQuotes(input);
    if (quotes.length < 240) return empty(`INSUFFICIENT_TICKS: ${quotes.length}`, quotes.length);

    const higher = candles(quotes, 20);
    const lower = candles(quotes, 5);
    if (higher.length < 30 || lower.length < 40) {
        return empty(`INSUFFICIENT_CANDLES: HTF=${higher.length}, LTF=${lower.length}`, quotes.length);
    }

    const htfClose = higher.map((candle) => candle.close);
    const ltfClose = lower.map((candle) => candle.close);
    const htfFast = ema(htfClose, 20);
    const htfSlow = ema(htfClose, 50);
    const ltfFast = ema(ltfClose, 12);
    const ltfSlow = ema(ltfClose, 26);
    const last = ltfClose[ltfClose.length - 1];
    const previous = ltfClose[ltfClose.length - 2];
    const range = atr(higher);
    if (!range || !Number.isFinite(range)) return empty('ZERO_VOLATILITY', quotes.length);

    const fast = htfFast[htfFast.length - 1];
    const slow = htfSlow[htfSlow.length - 1];
    const trend = (fast - slow) / Math.max(Math.abs(slow), Number.EPSILON);
    const htfSlope = slope(htfClose, 5);
    const ltfSpread = ltfFast[ltfFast.length - 1] - ltfSlow[ltfSlow.length - 1];
    const previousSpread = ltfFast[ltfFast.length - 2] - ltfSlow[ltfSlow.length - 2];
    const momentum = (last - ltfClose[Math.max(0, ltfClose.length - 8)]) /
        Math.max(range, Number.EPSILON);
    const currentRsi = rsi(ltfClose);
    const distanceFromFast = Math.abs(last - ltfFast[ltfFast.length - 1]) /
        Math.max(range, Number.EPSILON);

    const bullish = trend > 0 && htfSlope > 0;
    const bearish = trend < 0 && htfSlope < 0;
    if (!bullish && !bearish) return empty('NO_ALIGNED_TREND', quotes.length);
    if (distanceFromFast > 2.5) return empty('EXTENDED_FROM_MEAN', quotes.length);

    const direction: 'CALL' | 'PUT' = bullish ? 'CALL' : 'PUT';
    const momentumOk = bullish ? momentum > 0 && last > previous : momentum < 0 && last < previous;
    const spreadOk = bullish ? ltfSpread > previousSpread : ltfSpread < previousSpread;
    const rsiOk = bullish ? currentRsi >= 50 && currentRsi <= 68 : currentRsi >= 32 && currentRsi <= 50;
    const trendStrength = Math.min(1, Math.abs(trend) / 0.002);
    const slopeStrength = Math.min(1, Math.abs(htfSlope) / 0.002);
    const confirmations = [momentumOk, spreadOk, rsiOk].filter(Boolean).length;
    const confidence = Math.min(0.90, 0.50 + trendStrength * 0.14 + slopeStrength * 0.12 + confirmations * 0.07);
    const reasons = [
        bullish ? 'HTF_UPTREND' : 'HTF_DOWNTREND',
        momentumOk && 'MOMENTUM',
        spreadOk && 'EMA_ACCELERATION',
        rsiOk && 'RSI_REGIME',
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
        reason: confirmations >= 2 ? reasons : `WEAK_CONFIRMATION: ${reasons}`,
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
