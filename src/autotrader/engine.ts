// COMPATIBILITY SHIM — do not add new logic here.
//
// The real engine now lives in src/autotrader/engine.ts (see the
// Autonomous Trading panel). This file exists only because other files in
// this repo still import from '../ai/engine' under the old names, and at
// least one of those references (src/main.tsx importing AIBotControlPanel,
// which was never visible in the repo copy this was built against) was
// only discovered when deleting src/ai/ broke the production build.
//
// Re-exporting the SAME singleton under the old names — rather than a
// second, disconnected instance — means anything still using these old
// names shares the exact same live engine state (settings, running status,
// trade history) as the new Autonomous Trading panel, instead of silently
// drifting out of sync with it.
//
// Safe to delete once nothing in the repo imports from '../ai/engine' or
// '@/ai/engine' anymore — grep the repo for that path before removing it.
export {
    autoTrader as aiEngine,
    DEFAULT_AUTOTRADER_SETTINGS as DEFAULT_AI_SETTINGS,
    TRADE_CATEGORIES,
    MARKETS,
    SYNTHETIC_SYMBOL_PRESETS,
} from '@/autotrader/engine';

export type {
    AutoTraderMode as AIBotMode,
    DurationUnit,
    AutoTraderSettings as AIBotSettings,
    AutoTraderStats as AIBotStats,
    AutoTraderLog as AIBotLog,
} from '@/autotrader/engine';
