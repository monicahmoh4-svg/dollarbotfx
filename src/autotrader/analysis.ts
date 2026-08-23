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

function emptyResult(category: TradeCategory, reason: string): AnalysisResult {
    return { category, contractType: null, direction: null, barrier: null, confidence: 0, estimatedWinProbability: 0.5, volatility: 0, sampleSize: 0, reason };
}

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

// --- STRATEGY ENGINES ---

export function analyzeRiseFall(quotes: number[]): AnalysisResult {
    if (quotes.length < 50) return emptyResult('rise_fall', 'INSUFFICIENT_DATA');

    const last = quotes[quotes.length - 1];
    const sma10 = calculateSMA(quotes, 10);
    const sma20 = calculateSMA(quotes, 20);
    const rsi = calculateRSI(quotes, 14);
    
    let direction: 'CALL' | 'PUT' | null = null;
    let confidence = 0.50; // Baseline
    const reasons: string[] = [];

    // 1. Trend + Momentum Alignment (High Probability)
    if (last > sma10 && sma10 > sma20 && rsi > 50 && rsi < 75) {
        direction = 'CALL';
        confidence += 0.20;
        reasons.push('Bullish Trend + Momentum');
    } else if (last < sma10 && sma10 < sma20 && rsi < 50 && rsi > 25) {
        direction = 'PUT';
        confidence += 0.20;
        reasons.push('Bearish Trend + Momentum');
    }

    // 2. Mean Reversion at Extremes
    if (rsi < 25) {
        direction = 'CALL';
        confidence += 0.15;
        reasons.push('Oversold Reversion');
    } else if (rsi > 75) {
        direction = 'PUT';
        confidence += 0.15;
        reasons.push('Overbought Reversion');
    }

    confidence = Math.min(0.95, confidence);
    const canTrade = direction !== null && confidence >= 0.60; // Achievable threshold

    return {
        category: 'rise_fall',
        contractType: direction ? (direction === 'CALL' ? 'CALL' : 'PUT') as ContractType : null,
        direction,
        barrier: null,
        confidence,
        estimatedWinProbability: confidence,
        volatility: 0,
        sampleSize: quotes.length,
        reason: canTrade ? reasons.join(' + ') : `No confluence (Conf: ${(confidence * 100).toFixed(1)}%)`
    };
}

export function analyzeEvenOdd(quotes: number[], decimals: number): AnalysisResult {
    if (quotes.length < 100) return emptyResult('even_odd', 'INSUFFICIENT_DATA');
    
    const sample = quotes.slice(-100);
    let evenCount = 0;
    sample.forEach(q => {
        if (lastDigitOf(q, decimals) % 2 === 0) evenCount++;
    });
    
    const evenProb = evenCount / sample.length;
    let contractType: ContractType | null = null;
    let confidence = 0.50;

    // Mean Reversion: If even is heavily skewed, bet on odd (and vice versa)
    if (evenProb > 0.56) {
        contractType = 'DIGITODD';
        confidence = 0.50 + (evenProb - 0.50);
    } else if (evenProb < 0.44) {
        contractType = 'DIGITEVEN';
        confidence = 0.50 + (0.50 - evenProb);
    }

    confidence = Math.min(0.95, Math.max(0.50, confidence));
    const canTrade = contractType !== null && confidence >= 0.60;

    return {
        category: 'even_odd',
        contractType,
        direction: null,
        barrier: null,
        confidence,
        estimatedWinProbability: confidence,
        volatility: 0,
        sampleSize: sample.length,
        reason: canTrade ? `Digit Mean Reversion (${(evenProb * 100).toFixed(1)}% Even)` : 'No digit edge'
    };
}

export function analyzeOverUnder(quotes: number[], decimals: number): AnalysisResult {
    // Simplified for reliability: Focus on Rise/Fall and Even/Odd for primary signals
    // to prevent over-trading on lower-probability digit barriers.
    return emptyResult('over_under', 'STRATEGY_DISABLED_FOR_STABILITY');
}

export function analyzeMatchesDiffers(quotes: number[], decimals: number): AnalysisResult {
    return emptyResult('matches_differs', 'STRATEGY_DISABLED_FOR_STABILITY');
}

export function analyzeMarket(category: TradeCategory, quotes: number[], decimals: number): AnalysisResult {
    if (category === 'rise_fall') return analyzeRiseFall(quotes);
    if (category === 'even_odd') return analyzeEvenOdd(quotes, decimals);
    if (category === 'over_under') return analyzeOverUnder(quotes, decimals);
    return analyzeMatchesDiffers(quotes, decimals);
}
