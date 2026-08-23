export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

export type AnalysisResult = { 
    category: TradeCategory; 
    contractType: ContractType | null; 
    direction: 'CALL' | 'PUT' | null; 
    barrier: number | null; 
    confidence: number; 
    estimatedWinProbability: number;
    volatility: number; 
    sampleSize: number; 
    reason: string; 
};

function emptyResult(category: TradeCategory, reason: string): AnalysisResult {
    return { 
        category, 
        contractType: null, 
        direction: null, 
        barrier: null, 
        confidence: 0, 
        estimatedWinProbability: 0.5, 
        volatility: 0, 
        sampleSize: 0, 
        reason 
    };
}

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

function ema(values: number[], period: number): number[] {
    if (values.length < period) return values.slice();
    const k = 2 / (period + 1);
    const result: number[] = [];
    let emaValue = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(emaValue);
    for (let i = period; i < values.length; i++) {
        emaValue = values[i] * k + emaValue * (1 - k);
        result.push(emaValue);
    }
    return result;
}

function sma(values: number[], period: number): number[] {
    const result: number[] = [];
    for (let i = period - 1; i < values.length; i++) {
        const slice = values.slice(i - period + 1, i + 1);
        result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
    return result;
}

function rsi(values: number[], period = 14): number[] {
    const result: number[] = [];
    for (let i = period; i < values.length; i++) {
        let gains = 0, losses = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const change = values[j] - values[j - 1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }
        if (losses === 0) result.push(100);
        else result.push(100 - 100 / (1 + gains / losses));
    }
    return result;
}

function macd(values: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
    const ema12 = ema(values, 12);
    const ema26 = ema(values, 26);
    const macdLine: number[] = [];
    for (let i = 0; i < ema12.length; i++) {
        macdLine.push(ema12[i] - ema26[i]);
    }
    const signalLine = ema(macdLine, 9);
    const histogram: number[] = [];
    for (let i = 0; i < signalLine.length; i++) {
        histogram.push(macdLine[i] - signalLine[i]);
    }
    return { macd: macdLine, signal: signalLine, histogram };
}

function bollingerBands(values: number[], period = 20, stdDev = 2): { upper: number[]; middle: number[]; lower: number[] } {
    const middle = sma(values, period);
    const upper: number[] = [];
    const lower: number[] = [];
    for (let i = period - 1; i < values.length; i++) {
        const slice = values.slice(i - period + 1, i + 1);
        const mean = middle[i - period + 1];
        const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
        const std = Math.sqrt(variance);
        upper.push(mean + stdDev * std);
        lower.push(mean - stdDev * std);
    }
    return { upper, middle, lower };
}

function standardDeviation(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

// ============================================================================
// STRATEGY ANALYSIS (RESTORED FOR ACTIVE TRADING)
// ============================================================================

export function analyzeRiseFall(quotes: number[]): AnalysisResult {
    if (quotes.length < 120) return emptyResult('rise_fall', 'insufficient-data');

    const emaFast = ema(quotes, 5);
    const emaSlow = ema(quotes, 20);
    const rsiValues = rsi(quotes, 14);
    const macdData = macd(quotes);
    const bb = bollingerBands(quotes, 20, 2);
    
    const last = quotes[quotes.length - 1];
    const lastEmaFast = emaFast[emaFast.length - 1];
    const lastEmaSlow = emaSlow[emaSlow.length - 1];
    const lastRsi = rsiValues[rsiValues.length - 1];
    const lastMacd = macdData.macd[macdData.macd.length - 1];
    const lastSignal = macdData.signal[macdData.signal.length - 1];
    const lastHistogram = macdData.histogram[macdData.histogram.length - 1];
    const lastBBUpper = bb.upper[bb.upper.length - 1];
    const lastBBLower = bb.lower[bb.lower.length - 1];
    const lastBBMiddle = bb.middle[bb.middle.length - 1];

    const returns: number[] = [];
    for (let i = 1; i < quotes.length; i++) {
        const prev = quotes[i - 1];
        if (prev !== 0) returns.push((quotes[i] - prev) / prev);
    }
    const stdReturn = standardDeviation(returns.slice(-25));
    const volatility = stdReturn * 10000;

    let bullishScore = 0;
    let bearishScore = 0;
    const reasons: string[] = [];

    if (lastEmaFast > lastEmaSlow) { bullishScore += 2.0; reasons.push('EMA↑'); } 
    else { bearishScore += 2.0; reasons.push('EMA↓'); }

    if (lastRsi > 55 && lastRsi < 75) { bullishScore += 1.5; reasons.push(`RSI:${lastRsi.toFixed(0)}↑`); } 
    else if (lastRsi < 45 && lastRsi > 25) { bearishScore += 1.5; reasons.push(`RSI:${lastRsi.toFixed(0)}↓`); } 
    else if (lastRsi > 80) { bearishScore += 1.0; reasons.push('RSI:OB'); } 
    else if (lastRsi < 20) { bullishScore += 1.0; reasons.push('RSI:OS'); }

    if (lastMacd > lastSignal && lastHistogram > 0) { bullishScore += 2.5; reasons.push('MACD↑'); } 
    else if (lastMacd < lastSignal && lastHistogram < 0) { bearishScore += 2.5; reasons.push('MACD↓'); }

    if (last > lastBBMiddle && last < lastBBUpper) { bullishScore += 1.5; reasons.push('BB:Upper'); } 
    else if (last < lastBBMiddle && last > lastBBLower) { bearishScore += 1.5; reasons.push('BB:Lower'); } 
    else if (last > lastBBUpper) { bearishScore += 1.0; reasons.push('BB:Over'); } 
    else if (last < lastBBLower) { bullishScore += 1.0; reasons.push('BB:Under'); }

    const trendStrength = Math.abs(lastEmaFast - lastEmaSlow) / lastEmaSlow * 1000;
    if (trendStrength > 5) {
        if (lastEmaFast > lastEmaSlow) { bullishScore += 1.0; reasons.push('Strong↑'); } 
        else { bearishScore += 1.0; reasons.push('Strong↓'); }
    }

    const totalScore = bullishScore + bearishScore;
    const consensus = Math.abs(bullishScore - bearishScore);
    const confidenceBase = totalScore > 0 ? consensus / totalScore : 0;

    let confidence = 0;
    let direction: 'CALL' | 'PUT' | null = null;
    const MIN_CONSENSUS_SCORE = 4.5;
    const MIN_CONSENSUS_RATIO = 0.6;

    if (bullishScore > bearishScore && consensus >= MIN_CONSENSUS_SCORE && confidenceBase >= MIN_CONSENSUS_RATIO) {
        direction = 'CALL';
        confidence = Math.min(0.85, 0.52 + confidenceBase * 0.3);
    } else if (bearishScore > bullishScore && consensus >= MIN_CONSENSUS_SCORE && confidenceBase >= MIN_CONSENSUS_RATIO) {
        direction = 'PUT';
        confidence = Math.min(0.85, 0.52 + confidenceBase * 0.3);
    }

    return {
        category: 'rise_fall',
        contractType: direction,
        direction,
        barrier: null,
        confidence: direction ? confidence : 0,
        estimatedWinProbability: direction ? confidence : 0.5,
        volatility,
        sampleSize: quotes.length,
        reason: reasons.join(' ') + ` | Score:${consensus.toFixed(1)}`
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

const MIN_DIGIT_SAMPLE = 300;
const Z_SCORE_GATE = 3.0;
const MULTI_TEST_Z_GATE = 3.7;
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
    return { category: 'even_odd', contractType: favorEven ? 'DIGITEVEN' : 'DIGITODD', direction: null, barrier: null, confidence, estimatedWinProbability: confidence, volatility: 0, sampleSize: stats.total, reason: `evenProb:${(stats.evenProb * 100).toFixed(1)}% z:${z.toFixed(2)}` };
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
    if (!best || best.z < MULTI_TEST_Z_GATE) return emptyResult('over_under', `no-significant-deviation z:${(best?.z ?? 0).toFixed(2)}`);
    const deviation = Math.abs(best.observed - best.expected);
    const confidence = best.expected + Math.min(MAX_DIGIT_CONFIDENCE_BUFFER, deviation);
    const cappedConfidence = Math.min(0.95, confidence);
    return { category: 'over_under', contractType: best.type, direction: null, barrier: best.barrier, confidence: cappedConfidence, estimatedWinProbability: cappedConfidence, volatility: 0, sampleSize: stats.total, reason: `${best.type} barrier:${best.barrier} z:${best.z.toFixed(2)}` };
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
    if (matchZ >= MULTI_TEST_Z_GATE) {
        const confidence = 0.1 + Math.min(MAX_DIGIT_CONFIDENCE_BUFFER, bestFreq - 0.1);
        return { category: 'matches_differs', contractType: 'DIGITMATCH', direction: null, barrier: bestDigit, confidence, estimatedWinProbability: confidence, volatility: 0, sampleSize: stats.total, reason: `DIGITMATCH digit:${bestDigit} z:${matchZ.toFixed(2)}` };
    }
    if (differZ >= MULTI_TEST_Z_GATE) {
        const confidence = 0.9 + Math.min(MAX_DIGIT_CONFIDENCE_BUFFER, (1 - worstFreq) - 0.9);
        const cappedConfidence = Math.min(0.97, confidence);
        return { category: 'matches_differs', contractType: 'DIGITDIFF', direction: null, barrier: worstDigit, confidence: cappedConfidence, estimatedWinProbability: cappedConfidence, volatility: 0, sampleSize: stats.total, reason: `DIGITDIFF digit:${worstDigit} z:${differZ.toFixed(2)}` };
    }
    return emptyResult('matches_differs', `no-significant-deviation`);
}

export function analyzeMarket(category: TradeCategory, quotes: number[], decimals: number): AnalysisResult {
    if (category === 'rise_fall') return analyzeRiseFall(quotes);
    const stats = computeDigitStats(quotes, decimals);
    if (category === 'even_odd') return analyzeEvenOdd(stats);
    if (category === 'over_under') return analyzeOverUnder(stats);
    return analyzeMatchesDiffers(stats);
}
