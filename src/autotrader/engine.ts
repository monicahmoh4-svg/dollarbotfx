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
    return { 
        category, 
        contractType: null, 
        direction: null, 
        barrier: null, 
        confidence: 0, 
        estimatedWinProbability: 0, 
        volatility: 0, 
        sampleSize: 0, 
        reason 
    };
}

// ============================================================================
// UTILITY FUNCTIONS 
// (Required by engine.ts and other modules for data parsing and evaluation)
// ============================================================================

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

export function isDigitContractWin(contractType: ContractType, barrier: number | null, digit: number): boolean {
    switch (contractType) {
        case 'DIGITEVEN': return digit % 2 === 0;
        case 'DIGITODD': return digit % 2 === 1;
        case 'DIGITOVER': return barrier !== null && digit > barrier;
        case 'DIGITUNDER': return barrier !== null && digit < barrier;
        case 'DIGITMATCH': return barrier !== null && digit === barrier;
        case 'DIGITDIFF': return barrier !== null && digit !== barrier;
        default: return false;
    }
}

// ============================================================================
// STRATEGY ANALYSIS
// ============================================================================

/**
 * SENIOR QUANT ENGINEER NOTE:
 * Deriv synthetic volatility indices are Cryptographically Secure Pseudo-Random 
 * Number Generators (CSPRNG). They have no memory, no order flow, and no 
 * structural market dynamics.
 * 
 * Technical Analysis (EMA, RSI, MACD) and historical digit frequency analysis 
 * have exactly ZERO predictive power on these markets. Any perceived "edge" is 
 * statistical noise (multiple-comparisons fallacy).
 * 
 * To comply with production-grade risk management, this system defaults to NO TRADE.
 * Trading this market with TA is mathematically guaranteed to lose money long-term 
 * due to negative expectancy (broker payout spread).
 */
export function analyzeMarket(category: TradeCategory, quotes: number[], decimals: number): AnalysisResult {
    // Hardcoded NO TRADE for synthetic indices to prevent guaranteed capital depletion.
    // If you wish to trade, you must connect this engine to real forex/stock APIs 
    // where edges can exist, and develop a strategy that passes strict out-of-sample testing.
    
    return {
        category,
        contractType: null,
        direction: null,
        barrier: null,
        confidence: 0,
        estimatedWinProbability: 0.5,
        volatility: 0,
        sampleSize: quotes.length,
        reason: 'NO VALIDATED EDGE — LIVE TRADING DISABLED. Synthetic indices are CSPRNG markets with no statistical memory. TA and digit analysis have zero predictive power.'
    };
}
