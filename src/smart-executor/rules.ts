import { TradeCondition } from './types';

// Calculate Simple Moving Average
function calculateSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

// Calculate Relative Strength Index
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

/**
 * Evaluates market data against predefined logical conditions.
 * NOTE: This evaluates historical patterns for automation triggers. 
 * It does NOT predict future random outcomes on CSPRNG markets.
 */
export function evaluateCondition(condition: TradeCondition, ticks: number[]): boolean {
    if (ticks.length < 50) return false;

    switch (condition) {
        case 'RSI_OVERSOLD':
            // Trigger if RSI drops below 30 (potential mean reversion setup)
            return calculateRSI(ticks, 14) < 30;
            
        case 'RSI_OVERBOUGHT':
            // Trigger if RSI rises above 70
            return calculateRSI(ticks, 14) > 70;
            
        case 'SMA_CROSS_UP':
            // Trigger if fast SMA (10) crosses above slow SMA (20)
            const sma10_up = calculateSMA(ticks, 10);
            const sma20_up = calculateSMA(ticks, 20);
            const prevSma10_up = calculateSMA(ticks.slice(0, -1), 10);
            const prevSma20_up = calculateSMA(ticks.slice(0, -1), 20);
            return prevSma10_up <= prevSma20_up && sma10_up > sma20_up;
            
        case 'SMA_CROSS_DOWN':
            // Trigger if fast SMA (10) crosses below slow SMA (20)
            const sma10_down = calculateSMA(ticks, 10);
            const sma20_down = calculateSMA(ticks, 20);
            const prevSma10_down = calculateSMA(ticks.slice(0, -1), 10);
            const prevSma20_down = calculateSMA(ticks.slice(0, -1), 20);
            return prevSma10_down >= prevSma20_down && sma10_down < sma20_down;
            
        case 'MANUAL':
            // Always return true for manual testing
            return true;
            
        default:
            return false;
    }
}
