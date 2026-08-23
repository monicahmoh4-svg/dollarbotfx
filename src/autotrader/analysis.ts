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
// TECHNICAL INDICATORS (Preserved for build compatibility)
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

function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
    const trueRanges: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        trueRanges.push(tr);
    }
    return sma(trueRanges, period);
}

function standardDeviation(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

// ============================================================================
// STRATEGY ANALYSIS (PRODUCTION-GRADE SAFETY ENFORCED)
// ============================================================================

/**
 * SENIOR QUANT ENGINEER NOTE:
 * Deriv synthetic volatility indices are Cryptographically Secure Pseudo-Random 
 * Number Generators (CSPRNG). They have no memory, no order flow, and no 
 * structural market dynamics.
 * 
 * Technical Analysis (EMA, RSI, MACD) has exactly ZERO predictive power on these markets.
 * To comply with production-grade risk management and prevent guaranteed capital 
 * depletion, this system explicitly returns NO TRADE.
 */
export function analyzeRiseFall(quotes: number[]): AnalysisResult {
    return {
        category: 'rise_fall',
        contractType: null,
        direction: null,
        barrier: null,
        confidence: 0,
        estimatedWinProbability: 0.5,
        volatility: 0,
        sampleSize: quotes.length,
        reason: 'NO VALIDATED EDGE: Synthetic indices are CSPRNG markets. Technical analysis has zero predictive power on random walks. Live trading disabled to prevent guaranteed capital depletion.'
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

function zScoreForProportion(observed: number, expected: number, n: number): number {
    if (n <= 0) return 0;
    const standardError = Math.sqrt((expected * (1 - expected)) / n);
    if (standardError === 0) return 0;
    return Math.abs(observed - expected) / standardError;
}

/**
 * Digit outcomes on CSPRNG markets are strictly uniform. 
 * Historical frequency analysis cannot predict future random ticks.
 */
export function analyzeEvenOdd(stats: DigitStats): AnalysisResult {
    return {
        category: 'even_odd',
        contractType: null,
        direction: null,
        barrier: null,
        confidence: 0,
        estimatedWinProbability: 0.5,
        volatility: 0,
        sampleSize: stats.total,
        reason: 'NO VALIDATED EDGE: Digit outcomes on CSPRNG markets are strictly uniform. Historical frequency analysis cannot predict future random ticks. Trading disabled.'
    };
}

export function analyzeOverUnder(stats: DigitStats): AnalysisResult {
    return {
        category: 'over_under',
        contractType: null,
        direction: null,
        barrier: null,
        confidence: 0,
        estimatedWinProbability: 0.5,
        volatility: 0,
        sampleSize: stats.total,
        reason: 'NO VALIDATED EDGE: Digit outcomes on CSPRNG markets are strictly uniform. Historical frequency analysis cannot predict future random ticks. Trading disabled.'
    };
}

export function analyzeMatchesDiffers(stats: DigitStats): AnalysisResult {
    return {
        category: 'matches_differs',
        contractType: null,
        direction: null,
        barrier: null,
        confidence: 0,
        estimatedWinProbability: 0.5,
        volatility: 0,
        sampleSize: stats.total,
        reason: 'NO VALIDATED EDGE: Digit outcomes on CSPRNG markets are strictly uniform. Historical frequency analysis cannot predict future random ticks. Trading disabled.'
    };
}

export function analyzeMarket(category: TradeCategory, quotes: number[], decimals: number): AnalysisResult {
    if (category === 'rise_fall') return analyzeRiseFall(quotes);
    const stats = computeDigitStats(quotes, decimals);
    if (category === 'even_odd') return analyzeEvenOdd(stats);
    if (category === 'over_under') return analyzeOverUnder(stats);
    return analyzeMatchesDiffers(stats);
}
