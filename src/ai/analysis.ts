export type AnalysisResult = {
    direction: 'CALL' | 'PUT' | null;
    confidence: number;
    score: number;
    volatility: number;
    trend: number;
    reason: string;
};

function ema(values: number[], period: number): number {
    if (values.length < period) {
        return values.length ? values[values.length - 1] : 0;
    }

    const k = 2 / (period + 1);
    let emaValue = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < values.length; i++) {
        emaValue = values[i] * k + emaValue * (1 - k);
    }

    return emaValue;
}

function standardDeviation(values: number[]): number {
    if (!values.length) {
        return 0;
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - mean, 2));
    const variance = squareDiffs.reduce((a, b) => a + b, 0) / values.length;

    return Math.sqrt(variance);
}

function rsi(values: number[], period = 14): number {
    if (values.length <= period) {
        return 50;
    }

    let gains = 0;
    let losses = 0;

    for (let i = values.length - period; i < values.length; i++) {
        const change = values[i] - values[i - 1];

        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    if (losses === 0) {
        return 100;
    }

    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
}

export function analyzeQuotes(quotes: number[]): AnalysisResult {
    if (quotes.length < 35) {
        return {
            direction: null,
            confidence: 0,
            score: 0,
            volatility: 0,
            trend: 0,
            reason: 'insufficient-data',
        };
    }

    const fastPeriod = 5;
    const slowPeriod = 20;

    const fast = ema(quotes, fastPeriod);
    const slow = ema(quotes, slowPeriod);
    const last = quotes[quotes.length - 1];

    const returns: number[] = [];

    for (let i = 1; i < quotes.length; i++) {
        const previous = quotes[i - 1];

        if (previous !== 0) {
            returns.push((quotes[i] - previous) / previous);
        }
    }

    const recentReturns = returns.slice(-25);
    const volatility = standardDeviation(recentReturns) * 10000;
    const momentum = slow !== 0 ? ((last - slow) / slow) * 10000 : 0;
    const rsiValue = rsi(quotes, 14);

    let score = 0;

    if (fast > slow) {
        score += Math.min(2, Math.abs((fast - slow) / slow) * 50000);
    } else {
        score -= Math.min(2, Math.abs((fast - slow) / slow) * 50000);
    }

    if (momentum > 0) {
        score += Math.min(1.5, Math.abs(momentum) / 5);
    } else {
        score -= Math.min(1.5, Math.abs(momentum) / 5);
    }

    if (rsiValue > 55 && rsiValue < 75) {
        score += 0.75;
    }

    if (rsiValue < 45 && rsiValue > 25) {
        score -= 0.75;
    }

    if (rsiValue > 80) {
        score -= 0.8;
    }

    if (rsiValue < 20) {
        score += 0.8;
    }

    let direction: AnalysisResult['direction'] = null;

    if (score > 0.85) {
        direction = 'CALL';
    } else if (score < -0.85) {
        direction = 'PUT';
    }

    const confidence = Math.max(
        0,
        Math.min(0.95, 0.5 + Math.abs(score) * 0.09)
    );

    return {
        direction,
        confidence,
        score,
        volatility,
        trend: fast - slow,
        reason: `ema:${fast > slow ? 'up' : 'down'} rsi:${rsiValue.toFixed(
            1
        )} momentum:${momentum.toFixed(2)} vol:${volatility.toFixed(2)}`,
    };
}
