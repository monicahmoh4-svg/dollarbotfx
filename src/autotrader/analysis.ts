import type { AnalysisSignal, TradeCategory, ContractType } from './types';

// --- MATHEMATICAL UTILITIES ---

function calculateSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(data: number[], period = 14): number {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        const change = data[i] - data[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function calculateZScore(data: number[]): number {
    if (data.length < 10) return 0;
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    return (data[data.length - 1] - mean) / stdDev;
}

// Simplified Hurst Exponent to detect regime (Trending > 0.5, Mean-Reverting < 0.5, Random ≈ 0.5)
function calculateHurstExponent(data: number[]): number {
    if (data.length < 50) return 0.5;
    const lags = [2, 4, 8, 16, 32];
    const tau: number[] = [];
    for (const lag of lags) {
        let sum = 0;
        let count = 0;
        for (let i = lag; i < data.length; i++) {
            sum += Math.pow(Math.abs(data[i] - data[i - lag]), 2);
            count++;
        }
        tau.push(Math.sqrt(sum / count));
    }
    // Linear regression on log-log scale to find slope (Hurst exponent)
    const logLags = lags.map(Math.log);
    const logTau = tau.map(Math.log);
    const meanX = logLags.reduce((a, b) => a + b, 0) / logLags.length;
    const meanY = logTau.reduce((a, b) => a + b, 0) / logTau.length;
    let num = 0, den = 0;
    for (let i = 0; i < logLags.length; i++) {
        num += (logLags[i] - meanX) * (logTau[i] - meanY);
        den += Math.pow(logLags[i] - meanX, 2);
    }
    const hurst = den === 0 ? 0.5 : num / den;
    return Math.max(0.1, Math.min(0.9, hurst)); // Clamp between 0.1 and 0.9
}

// --- CORE ANALYSIS ENGINE ---

export function analyzeMarket(category: TradeCategory, ticks: number[]): AnalysisSignal {
    if (ticks.length < 100) {
        return { canTrade: false, contractType: null, direction: null, barrier: null, confidenceScore: 0, expectedEdge: 0, reason: 'INSUFFICIENT_DATA' };
    }

    const currentPrice = ticks[ticks.length - 1];
    const smaFast = calculateSMA(ticks, 10);
    const smaSlow = calculateSMA(ticks, 30);
    const rsi = calculateRSI(ticks, 14);
    const zScore = calculateZScore(ticks.slice(-50));
    const hurst = calculateHurstExponent(ticks);

    // PROFESSIONAL QUANT NOTE: 
    // A Hurst Exponent near 0.5 indicates a Geometric Brownian Motion (Random Walk).
    // Synthetic indices are CSPRNG. They will almost always score ~0.5.
    // A professional system penalizes confidence heavily when the market is random.
    const randomnessPenalty = Math.abs(hurst - 0.5) * 2; // 0 if perfectly random, up to 1 if strongly trending/mean-reverting

    let confidence = 0.5; // Baseline
    let direction: 'CALL' | 'PUT' | null = null;
    const reasons: string[] = [];

    if (category === 'rise_fall') {
        // Multi-factor confirmation required
        const trendBullish = currentPrice > smaFast && smaFast > smaSlow;
        const trendBearish = currentPrice < smaFast && smaFast < smaSlow;
        const momentumBullish = rsi > 50 && rsi < 70;
        const momentumBearish = rsi < 50 && rsi > 30;
        const meanRevBullish = zScore < -1.5;
        const meanRevBearish = zScore > 1.5;

        if (trendBullish && momentumBullish) {
            direction = 'CALL';
            confidence += 0.15;
            reasons.push('Trend+Momentum Bullish');
        } else if (trendBearish && momentumBearish) {
            direction = 'PUT';
            confidence += 0.15;
            reasons.push('Trend+Momentum Bearish');
        }

        if (meanRevBullish && !trendBullish) {
            direction = 'CALL';
            confidence += 0.10;
            reasons.push('Mean Reversion Bullish');
        } else if (meanRevBearish && !trendBearish) {
            direction = 'PUT';
            confidence += 0.10;
            reasons.push('Mean Reversion Bearish');
        }
    }

    // Apply randomness penalty. If the market is a true random walk, confidence drops.
    confidence = confidence * randomnessPenalty;

    // Deriv payout implies a break-even probability of ~52-55%. 
    // Expected edge is only positive if our confidence significantly exceeds this.
    const breakEvenProb = 0.53; 
    const expectedEdge = confidence - breakEvenProb;

    // STRICT GATE: Only trade if edge is genuinely positive and confidence is high
    const minConfidence = 0.65; // Must exceed 65% confidence to overcome broker spread
    const canTrade = direction !== null && confidence >= minConfidence && expectedEdge > 0.02;

    return {
        canTrade,
        contractType: (direction === 'CALL' ? 'CALL' : 'PUT') as ContractType,
        direction,
        barrier: null,
        confidenceScore: Math.min(0.95, confidence),
        expectedEdge,
        reason: canTrade ? reasons.join(', ') : `NO_EDGE: Hurst=${hurst.toFixed(2)}, Conf=${(confidence*100).toFixed(1)}%, Edge=${(expectedEdge*100).toFixed(1)}%`
    };
}

// --- DIGIT ANALYSIS (Statistical Z-Test) ---
// Note: On CSPRNG, long-term frequency always converges to 10% per digit. 
// This function remains for structural completeness but will rarely trigger due to strict Z-gates.
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
