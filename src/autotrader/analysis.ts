export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

export type AnalysisResult = { 
    category: TradeCategory; 
    contractType: ContractType | null; 
    direction: 'CALL' | 'PUT' | null; 
    barrier: number | null; 
    confidence: number; 
    volatility: number; 
    sampleSize: number; 
    reason: string; 
};

function emptyResult(category: TradeCategory, reason: string): AnalysisResult {
    return { category, contractType: null, direction: null, barrier: null, confidence: 0, volatility: 0, sampleSize: 0, reason };
}

function ema(values: number[], period: number): number {
    if (values.length < period) return values.length ? values[values.length - 1] : 0;
    const k = 2 / (period + 1);
    let emaValue = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) emaValue = values[i] * k + emaValue * (1 - k);
    return emaValue;
}

function standardDeviation(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function rsi(values: number[], period = 14): number {
    if (values.length <= period) return 50;
    let gains = 0, losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        if (change > 0) gains += change; else losses += Math.abs(change);
    }
    if (losses === 0) return 100;
    return 100 - 100 / (1 + gains / losses);
}

export function analyzeRiseFall(quotes: number[]): AnalysisResult {
    if (quotes.length < 35) return emptyResult('rise_fall', 'insufficient-data');
    const fast = ema(quotes, 5), slow = ema(quotes, 20), last = quotes[quotes.length - 1];
    const returns: number[] = [];
    for (let i = 1; i < quotes.length; i++) { const prev = quotes[i - 1]; if (prev !== 0) returns.push((quotes[i] - prev) / prev); }
    const stdReturn = standardDeviation(returns.slice(-25));
    const volatility = stdReturn * 10000;
    const momentum = slow !== 0 ? ((last - slow) / slow) * 10000 : 0;
    const rsiValue = rsi(quotes, 14);

    let score = 0;
    const gapRatio = slow !== 0 ? (fast - slow) / slow : 0;
    const normalizedGap = stdReturn > 0 ? gapRatio / stdReturn : 0;
    
    // Recalibrated scoring to ensure valid trends pass the confidence gate
    score += Math.max(-3, Math.min(3, normalizedGap * 2.0));
    if (momentum > 0) score += Math.min(2.0, Math.abs(momentum) / 4); else score -= Math.min(2.0, Math.abs(momentum) / 4);
    if (rsiValue > 55 && rsiValue < 75) score += 1.2;
    if (rsiValue < 45 && rsiValue > 25) score -= 1.2;
    if (rsiValue > 80) score -= 1.0; if (rsiValue < 20) score += 1.0;

    let direction: AnalysisResult['direction'] = null;
    if (score > 1.2) direction = 'CALL'; else if (score < -1.2) direction = 'PUT';
    
    // Recalibrated confidence mapping
    const confidence = direction ? Math.max(0.58, Math.min(0.85, 0.58 + (Math.abs(score) - 1.2) * 0.1)) : 0;

    return { 
        category: 'rise_fall', 
        contractType: direction, 
        direction, 
        barrier: null, 
        confidence, 
        volatility, 
        sampleSize: quotes.length, 
        reason: `ema:${fast > slow ? 'up' : 'down'} gapZ:${normalizedGap.toFixed(2)} rsi:${rsiValue.toFixed(1)}` 
    };
}

export function pipToDecimals(pip?: number | null): number {
    if (!pip || pip <= 0) return 2;
    const decimals = Math.round(-Math.log10(pip));
    return Number.isFinite(decimals) && decimals >= 0 && decimals <= 6 ? decimals : 2;
}

export function inferDecimalsFromQuotes(quotes: number[]): number {
    let maxDecimals = 0;
    for (const quote of quotes) {
        const text = quote.toString();
        const dotIndex = text.indexOf('.');
        if (dotIndex >= 0) maxDecimals = Math.max(maxDecimals, text.length - dotIndex - 1);
    }
    return maxDecimals > 0 ? Math.min(maxDecimals, 6) : 2;
}

export function lastDigitOf(quote: number, decimals: number): number {
    const scaled = Math.round(quote * Math.pow(10, decimals));
    return Math.abs(scaled % 10);
}

export type DigitStats = { counts: number[]; total: number; frequencies: number[]; evenProb: number; oddProb: number; };

export function computeDigitStats(quotes: number[], decimals: number, lookback = 300): DigitStats {
    const sample = quotes.slice(-lookback);
    const counts = new Array(10).fill(0);
    sample.forEach(quote => {
        const digit = lastDigitOf(quote, decimals);
        if (digit >= 0 && digit <= 9) counts[digit] += 1;
    });
    const total = sample.length;
    const frequencies = counts.map(count => (total ? count / total : 0));
    const evenProb = [0, 2, 4, 6, 8].reduce((sum, digit) => sum + frequencies[digit], 0);
    return { counts, total, frequencies, evenProb, oddProb: total ? 1 - evenProb : 0 };
}

const MIN_DIGIT_SAMPLE = 150;
const Z_SCORE_GATE = 2.5;
const MAX_DIGIT_CONFIDENCE_BUFFER = 0.06;

function zScoreForProportion(observed: number, expected: number, n: number): number {
    if (n <= 0) return 0;
    const standardError = Math.sqrt((expected * (1 - expected)) / n);
    if (standardError === 0) return 0;
    return Math.abs(observed - expected) / standardError;
}

export function analyzeEvenOdd(stats: DigitStats): AnalysisResult {
    if (stats.total < MIN_DIGIT_SAMPLE) return emptyResult('even_odd', `insufficient-digit-sample:${stats.total}`);
    const z = zScoreForProportion(stats.evenProb, 0.5, stats.total);
    if (z < Z_SCORE_GATE) return emptyResult('even_odd', `no-significant-deviation z:${z.toFixed(2)}`);
    const favorEven = stats.evenProb > 0.5;
    const deviation = Math.abs(stats.evenProb - 0.5);
    const confidence = 0.5 + Math.min(MAX_DIGIT_CONFIDENCE_BUFFER, deviation);
    return { category: 'even_odd', contractType: favorEven ? 'DIGITEVEN' : 'DIGITODD', direction: null, barrier: null, confidence, volatility: 0, sampleSize: stats.total, reason: `evenProb:${(stats.evenProb * 100).toFixed(1)}% z:${z.toFixed(2)} n:${stats.total}` };
}

export function analyzeOverUnder(stats: DigitStats): AnalysisResult {
    if (stats.total < MIN_DIGIT_SAMPLE) return emptyResult('over_under', `insufficient-digit-sample:${stats.total}`);
    let best: { barrier: number; type: 'DIGITOVER' | 'DIGITUNDER'; z: number; observed: number; expected: number } | null = null;
    for (let barrier = 2; barrier <= 7; barrier++) {
        const overCount = stats.counts.slice(barrier + 1).reduce((a, b) => a + b, 0);
        const underCount = stats.counts.slice(0, barrier).reduce((a, b) => a + b, 0);
        const overObserved = overCount / stats.total;
        const underObserved = underCount / stats.total;
        const overExpected = (9 - barrier) / 10;
        const underExpected = barrier / 10;
        const overZ = zScoreForProportion(overObserved, overExpected, stats.total);
        const underZ = zScoreForProportion(underObserved, underExpected, stats.total);
        if (!best || overZ > best.z) best = { barrier, type: 'DIGITOVER', z: overZ, observed: overObserved, expected: overExpected };
        if (!best || underZ > best.z) best = { barrier, type: 'DIGITUNDER', z: underZ, observed: underObserved, expected: underExpected };
    }
    if (!best || best.z < Z_SCORE_GATE) return emptyResult('over_under', `no-significant-deviation z:${(best?.z ?? 0).toFixed(2)}`);
    const deviation = Math.abs(best.observed - best.expected);
    const confidence = best.expected + Math.min(MAX_DIGIT_CONFIDENCE_BUFFER, deviation);
    return { category: 'over_under', contractType: best.type, direction: null, barrier: best.barrier, confidence: Math.min(0.95, confidence), volatility: 0, sampleSize: stats.total, reason: `${best.type} barrier:${best.barrier} observed:${(best.observed * 100).toFixed(1)}% expected:${(best.expected * 100).toFixed(1)}% z:${best.z.toFixed(2)}` };
}

export function analyzeMatchesDiffers(stats: DigitStats): AnalysisResult {
    if (stats.total < MIN_DIGIT_SAMPLE) return emptyResult('matches_differs', `insufficient-digit-sample:${stats.total}`);
    let bestDigit = 0, bestFreq = stats.frequencies[0], worstDigit = 0, worstFreq = stats.frequencies[0];
    stats.frequencies.forEach((freq, digit) => {
        if (freq > bestFreq) { bestFreq = freq; bestDigit = digit; }
        if (freq < worstFreq) { worstFreq = freq; worstDigit = digit; }
    });
    const matchZ = zScoreForProportion(bestFreq, 0.1, stats.total);
    const differZ = zScoreForProportion(1 - worstFreq, 0.9, stats.total);
    if (matchZ >= Z_SCORE_GATE) {
        const confidence = 0.1 + Math.min(MAX_DIGIT_CONFIDENCE_BUFFER, bestFreq - 0.1);
        return { category: 'matches_differs', contractType: 'DIGITMATCH', direction: null, barrier: bestDigit, confidence, volatility: 0, sampleSize: stats.total, reason: `DIGITMATCH digit:${bestDigit} freq:${(bestFreq * 100).toFixed(1)}% z:${matchZ.toFixed(2)}` };
    }
    if (differZ >= Z_SCORE_GATE) {
        const confidence = 0.9 + Math.min(MAX_DIGIT_CONFIDENCE_BUFFER, (1 - worstFreq) - 0.9);
        return { category: 'matches_differs', contractType: 'DIGITDIFF', direction: null, barrier: worstDigit, confidence: Math.min(0.97, confidence), volatility: 0, sampleSize: stats.total, reason: `DIGITDIFF digit:${worstDigit} freq:${(worstFreq * 100).toFixed(1)}% z:${differZ.toFixed(2)}` };
    }
    return emptyResult('matches_differs', `no-significant-deviation matchZ:${matchZ.toFixed(2)} differZ:${differZ.toFixed(2)}`);
}

export function analyzeMarket(category: TradeCategory, quotes: number[], decimals: number): AnalysisResult {
    if (category === 'rise_fall') return analyzeRiseFall(quotes);
    const stats = computeDigitStats(quotes, decimals);
    if (category === 'even_odd') return analyzeEvenOdd(stats);
    if (category === 'over_under') return analyzeOverUnder(stats);
    return analyzeMatchesDiffers(stats);
}
