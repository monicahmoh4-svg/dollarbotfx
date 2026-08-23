export type BotState = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATING' | 'SYNCING' | 'READY' | 'TRADING' | 'RECONNECTING' | 'ERROR' | 'HALTED';

export type TradeState = 'SIGNAL_CREATED' | 'RISK_APPROVED' | 'ORDER_REQUESTED' | 'ORDER_ACCEPTED' | 'CONTRACT_OPEN' | 'CONTRACT_SETTLED' | 'PROFIT' | 'LOSS' | 'CANCELLED' | 'REJECTED' | 'UNKNOWN';

export interface BalanceReconciliation {
    localBalance: number;
    derivBalance: number;
    balanceDifference: number;
    lastSyncTime: number;
    lastTransactionId: string | null;
    isHealthy: boolean;
}

export interface LedgerEntry {
    id: string;
    timestamp: number;
    type: 'SIGNAL' | 'ORDER_REQUEST' | 'ORDER_RESPONSE' | 'SETTLEMENT' | 'RECONCILIATION' | 'ERROR';
    symbol: string;
    contractType?: string;
    stake?: number;
    derivRequestId?: string;
    derivContractId?: string;
    result?: 'WIN' | 'LOSS' | 'REJECTED';
    profit?: number;
    balanceBefore?: number;
    balanceAfter?: number;
    message: string;
}

export interface RiskLimits {
    maxStakePerTrade: number;
    maxPercentRiskPerTrade: number;
    maxDailyLoss: number;
    maxConsecutiveLosses: number;
    maxConcurrentTrades: number;
    maxBalanceTolerance: number;
}

export interface AnalysisResult {
    canTrade: boolean;
    reason: string;
    contractType: string | null;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    estimatedWinProbability: number;
    expectedEdge: number;
}
