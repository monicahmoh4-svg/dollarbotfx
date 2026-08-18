// COMPATIBILITY SHIM — do not add new logic here. See src/ai/engine.ts for
// why this exists. The real analysis logic now lives in
// src/autotrader/analysis.ts.
//
// Safe to delete once nothing in the repo imports from '../ai/analysis' or
// '@/ai/analysis' anymore — grep the repo for that path before removing it.
export type {
    TradeCategory,
    ContractType,
    AnalysisResult,
    DigitStats,
} from '@/autotrader/analysis';

export {
    analyzeRiseFall,
    pipToDecimals,
    lastDigitOf,
    computeDigitStats,
    analyzeEvenOdd,
    analyzeOverUnder,
    analyzeMatchesDiffers,
    analyzeMarket,
} from '@/autotrader/analysis';
