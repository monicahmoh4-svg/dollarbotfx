export type MarketSymbol = 'R_10' | 'R_25' | 'R_50' | 'R_75' | 'R_100' | 'frxEURUSD' | 'frxGBPUSD';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';
export type TradeCondition = 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT' | 'SMA_CROSS_UP' | 'SMA_CROSS_DOWN' | 'MANUAL';

export interface ExecutorConfig {
    symbol: MarketSymbol;
    contractType: ContractType;
    stake: number;
    duration: number;
    durationUnit: 't' | 's' | 'm';
    condition: TradeCondition;
    // Strict Risk Management
    maxDailyLoss: number;
    targetProfit: number;
    maxConsecutiveLosses: number;
}

export interface ExecutorState {
    isRunning: boolean;
    isHalted: boolean;
    haltReason: string | null;
    stats: {
        totalTrades: number;
        wins: number;
        losses: number;
        currentStreak: number;
        netProfit: number;
        dailyProfit: number;
    };
    logs: { time: string; level: 'info' | 'warn' | 'error' | 'success'; message: string }[];
}
