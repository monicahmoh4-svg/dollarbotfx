export type BotState = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATING' | 'SYNCING' | 'READY' | 'TRADING' | 'RECONNECTING' | 'ERROR' | 'HALTED';

export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';
export type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';

export interface AnalysisSignal {
    canTrade: boolean;
    contractType: ContractType | null;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    confidenceScore: number; // 0.0 to 1.0
    expectedEdge: number;
    reason: string;
}

export interface BalanceReconciliation {
    localBalance: number;
    derivBalance: number;
    balanceDifference: number;
    lastSyncTime: number;
    lastTransactionId: string | null;
    isHealthy: boolean;
}

export interface RiskLimits {
    maxStakePerTrade: number;
    maxPercentRiskPerTrade: number;
    maxDailyLoss: number;
    maxConsecutiveLosses: number;
    maxConcurrentTrades: number;
    maxBalanceTolerance: number;
    minConfidenceThreshold: number;
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
}
