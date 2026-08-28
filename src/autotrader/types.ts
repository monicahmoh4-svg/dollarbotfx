export type BotState = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATING' | 'SYNCING' | 'READY' | 'TRADING' | 'RECONNECTING' | 'COOLDOWN' | 'ERROR' | 'HALTED';

export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';
export type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';

// Market regime classification (see MASTER PROMPT §5)
export type MarketRegime =
    | 'STRONG_BULL'
    | 'WEAK_BULL'
    | 'STRONG_BEAR'
    | 'WEAK_BEAR'
    | 'RANGE_BOUND'
    | 'HIGH_VOLATILITY'
    | 'LOW_VOLATILITY'
    | 'UNCLEAR';

export interface AnalysisSignal {
    canTrade: boolean;
    contractType: ContractType | null;
    contractLabel: string;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    confidenceScore: number;
    signalScore: number;
    expectedEdge: number;
    reason: string;
    category: TradeCategory;
    regime: MarketRegime;
    consecutiveStreak: number;
}

export interface BalanceReconciliation {
    localBalance: number;
    derivBalance: number;
    balanceDifference: number;
    lastSyncTime: number;
    lastTransactionId: string | null;
    isHealthy: boolean;
}

export interface CategoryPerformance {
    trades: number;
    wins: number;
    losses: number;
    grossWin: number;
    grossLoss: number;
    expectancy: number; // per-trade expectancy in account currency
    disabled: boolean; // auto-disabled when rolling expectancy turns negative
    lastUpdated: number;
}

export interface RiskLimits {
    maxStakePerTrade: number;
    maxPercentRiskPerTrade: number;
    maxDailyLoss: number;
    maxConsecutiveLosses: number;
    maxConcurrentTrades: number;
    maxBalanceTolerance: number;
    minConfidenceThreshold: number;
    minSignalScore: number; // §11: normalized 0-100 gate
    maxCategoryDrawdown: number; // §33: auto-disable strategy if its realized loss exceeds this
}

export interface AutoTraderStats {
    wins: number;
    losses: number;
    net: number;
    dailyNet: number;
    lossStreak: number;
    sessionStart: number;
    scanCount: number;
    tradesOpened: number;
    derivBalance: number | null;
    balanceDifference: number;
    isBalanceHealthy: boolean;
    marketsScanned: number;
    signalsDetected: number;
    riseFallTrades: number;
    evenOddTrades: number;
    overUnderTrades: number;
    matchesDiffersTrades: number;
    // §2: clear separation of balance states
    realizedPnl: number; // REALIZED_PNL
    reservedStake: number; // RESERVED_STAKE (open exposure)
    availableBalance: number; // AVAILABLE_BALANCE (deriv - reserved)
    regime: MarketRegime;
    categoryStats: Record<TradeCategory, CategoryPerformance>;
}

export interface LedgerEntry {
    id: string;
    timestamp: number;
    type: 'TRADE_OPEN' | 'TRADE_CLOSE' | 'RECONCILIATION' | 'HALT' | 'STATE_CHANGE';
    symbol: string;
    message: string;
    balanceBefore?: number;
    balanceAfter?: number;
    stake?: number;
    profit?: number;
    contractId?: string;
}

export interface MarketInfo {
    symbol: string;
    display_name: string;
    market: string;
    submarket: string;
    is_active: boolean;
}
