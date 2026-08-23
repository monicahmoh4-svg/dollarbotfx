import { analyzeMarket, inferDecimalsFromQuotes, lastDigitOf } from './analysis';

// ============================================================================
// TYPES (Self-contained to prevent "Module not found" build errors)
// ============================================================================

export type BotState = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATING' | 'SYNCING' | 'READY' | 'TRADING' | 'RECONNECTING' | 'ERROR' | 'HALTED';
export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';
export type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';

export interface AnalysisSignal {
    canTrade: boolean;
    contractType: ContractType | null;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    confidenceScore: number;
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

// ============================================================================
// CONSTANTS EXPORTED FOR UI COMPATIBILITY
// ============================================================================

export const TRADE_CATEGORIES: { label: string; value: TradeCategory }[] = [
    { label: 'Rise/Fall', value: 'rise_fall' },
    { label: 'Even/Odd', value: 'even_odd' },
    { label: 'Over/Under', value: 'over_under' },
    { label: 'Matches/Differs', value: 'matches_differs' },
];

export const MARKETS = [{ label: 'Synthetic Indices', value: 'synthetic_index' }];

export const SYNTHETIC_INDICES = [
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
];

export const SYNTHETIC_SYMBOL_PRESETS = SYNTHETIC_INDICES.map((s) => s.symbol).join(',');

// ============================================================================
// RISK MANAGER (Self-contained)
// ============================================================================

class RiskManager {
    constructor(private limits: RiskLimits) {}

    validatePreTrade(stake: number, currentConsecutiveLosses: number, recon: BalanceReconciliation | null, currentOpenTrades: number): { allowed: boolean; reason: string } {
        if (!recon || !recon.isHealthy) {
            return { allowed: false, reason: 'ACCOUNT_SYNC_UNHEALTHY: Balance reconciliation failed or is pending.' };
        }
        if (recon.balanceDifference > this.limits.maxBalanceTolerance) {
            return { allowed: false, reason: `BALANCE_MISMATCH: Diff=${recon.balanceDifference.toFixed(2)} exceeds tolerance. HALTED.` };
        }
        if (currentConsecutiveLosses >= this.limits.maxConsecutiveLosses) {
            return { allowed: false, reason: `MAX_CONSECUTIVE_LOSSES: ${currentConsecutiveLosses} reached. Cooldown active.` };
        }
        if (currentOpenTrades >= this.limits.maxConcurrentTrades) {
            return { allowed: false, reason: `MAX_CONCURRENT_TRADES: ${currentOpenTrades} active.` };
        }
        if (stake > this.limits.maxStakePerTrade) {
            return { allowed: false, reason: `STAKE_EXCEEDED: ${stake} > ${this.limits.maxStakePerTrade}.` };
        }
        if (stake > recon.localBalance * this.limits.maxPercentRiskPerTrade) {
            return { allowed: false, reason: `RISK_EXCEEDED: Stake is > ${(this.limits.maxPercentRiskPerTrade * 100).toFixed(1)}% of balance.` };
        }
        return { allowed: true, reason: 'RISK_CHECKS_PASSED' };
    }
}

// ============================================================================
// ENGINE IMPLEMENTATION
// ============================================================================

const DEFAULT_LIMITS: RiskLimits = {
    maxStakePerTrade: 10,
    maxPercentRiskPerTrade: 0.02, // 2% max risk per trade
    maxDailyLoss: 50,
    maxConsecutiveLosses: 3,
    maxConcurrentTrades: 1,
    maxBalanceTolerance: 0.50, // $0.50 max drift before halt
    minConfidenceThreshold: 0.65,
};

export class AutoTraderEngine extends EventTarget {
    private client: any = null;
    private apiInstance: any = null;
    private limits: RiskLimits = { ...DEFAULT_LIMITS };
    
    private state: BotState = 'DISCONNECTED';
    private isRunning = false;
    private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
    
    private stats: AutoTraderStats = {
        wins: 0, losses: 0, net: 0, dailyNet: 0, lossStreak: 0,
        sessionStart: Date.now(), scanCount: 0, tradesOpened: 0,
        derivBalance: null, balanceDifference: 0, isBalanceHealthy: true,
    };

    private rollingTicks = new Map<string, number[]>();
    private activeSubscriptions = new Set<string>();
    private logs: { time: string; level: string; message: string }[] = [];

    constructor() {
        super();
        this.loadConfig();
    }

    private loadConfig() {
        try {
            const raw = localStorage.getItem('bot-risk-limits');
            if (raw) this.limits = { ...this.limits, ...JSON.parse(raw) };
        } catch {}
    }

    getState() {
        return {
            limits: { ...this.limits },
            stats: { ...this.stats },
            state: this.state,
            isRunning: this.isRunning,
            logs: [...this.logs]
        };
    }

    private emit() {
        this.dispatchEvent(new CustomEvent('state', { detail: this.getState() }));
    }

    private log(level: 'info' | 'warn' | 'error' | 'success', message: string) {
        console.log(`[ENGINE ${level.toUpperCase()}] ${message}`);
        this.logs.unshift({ time: new Date().toLocaleTimeString(), level, message });
        if (this.logs.length > 150) this.logs.pop();
        this.emit();
    }

    updateLimits(patch: Partial<RiskLimits>) {
        this.limits = { ...this.limits, ...patch };
        localStorage.setItem('bot-risk-limits', JSON.stringify(this.limits));
        this.emit();
        this.log('info', 'Risk limits updated dynamically.');
    }

    async start(patch: { client?: any; apiInstance?: any } = {}) {
        if (this.isRunning) return;
        this.client = patch.client;
        this.apiInstance = patch.apiInstance;

        if (!this.client?.is_logged_in || !this.apiInstance) {
            this.state = 'ERROR';
            this.log('error', 'Cannot start: Not logged in or API instance missing.');
            this.emit();
            return;
        }

        this.state = 'CONNECTING';
        this.isRunning = true;
        this.emit();

        try {
            await this.synchronizeBalance();
            if (this.state === 'HALTED') return;

            this.state = 'TRADING';
            this.log('success', 'System READY. Initiating live market subscriptions...');
            
            for (const symbol of SYNTHETIC_INDICES) {
                await this.subscribeToLiveTicks(symbol.symbol);
            }

            this.reconciliationTimer = setInterval(() => this.synchronizeBalance(), 15000);
            this.emit();

        } catch (error: any) {
            this.triggerKillSwitch(`Start failure: ${error.message}`);
        }
    }

    private async subscribeToLiveTicks(symbol: string) {
        if (this.activeSubscriptions.has(symbol)) return;
        
        this.log('info', `Subscribing to live ticks: ${symbol}`);
        this.rollingTicks.set(symbol, []);

        try {
            await this.apiInstance.send({
                ticks_history: symbol,
                adjust_start_time: 1,
                count: 300,
                end: 'latest',
                style: 'ticks',
                subscribe: 1
            });
            this.activeSubscriptions.add(symbol);
        } catch (e: any) {
            this.log('error', `Failed to subscribe to ${symbol}: ${e.message}`);
        }
    }

    public processLiveTick(symbol: string, price: number) {
        if (!this.isRunning || this.state !== 'TRADING') return;

        const window = this.rollingTicks.get(symbol) || [];
        window.push(price);
        if (window.length > 500) window.shift();
        this.rollingTicks.set(symbol, window);

        if (window.length >= 100) {
            this.evaluateAndExecute(symbol, window);
        }
    }

    private async evaluateAndExecute(symbol: string, ticks: number[]) {
        const rawSignal = analyzeMarket('rise_fall', ticks);
        
        const signal: AnalysisSignal = {
            canTrade: rawSignal.contractType !== null && rawSignal.confidence >= this.limits.minConfidenceThreshold,
            contractType: rawSignal.contractType,
            direction: rawSignal.direction,
            barrier: rawSignal.barrier,
            confidenceScore: rawSignal.confidence,
            expectedEdge: rawSignal.confidence - 0.53,
            reason: rawSignal.reason
        };

        if (!signal.canTrade) {
            return; 
        }

        this.log('info', `SIGNAL DETECTED: ${symbol} | ${signal.contractType} | Conf: ${(signal.confidenceScore * 100).toFixed(1)}% | Edge: ${(signal.expectedEdge * 100).toFixed(1)}%`);

        const recon = this.getCurrentReconciliation();
        const riskCheck = new RiskManager(this.limits).validatePreTrade(
            this.limits.maxStakePerTrade, 
            this.stats.lossStreak, 
            recon, 
            0
        );

        if (!riskCheck.allowed) {
            this.log('warn', `TRADE BLOCKED: ${riskCheck.reason}`);
            return;
        }

        this.log('success', `EXECUTING PAPER TRADE: ${symbol} ${signal.contractType}`);
        this.stats.tradesOpened += 1;
        this.stats.scanCount += 1;
        
        setTimeout(() => {
            const isWin = Math.random() < 0.48;
            const profit = isWin ? this.limits.maxStakePerTrade * 0.95 : -this.limits.maxStakePerTrade;
            
            this.stats.net += profit;
            this.stats.dailyNet += profit;
            if (isWin) {
                this.stats.wins += 1;
                this.stats.lossStreak = 0;
                this.log('success', `TRADE WON: +${profit.toFixed(2)}`);
            } else {
                this.stats.losses += 1;
                this.stats.lossStreak += 1;
                this.log('warn', `TRADE LOST: ${profit.toFixed(2)}`);
            }
            
            this.checkGlobalLimits();
            this.emit();
        }, 1500);
    }

    private async synchronizeBalance() {
        if (!this.isRunning || this.state === 'HALTED') return;
        try {
            const response = await this.apiInstance.send({ balance: 1 });
            const bal = response?.balance;
            if (!bal || typeof bal.balance !== 'number') throw new Error('Invalid balance payload');

            this.stats.derivBalance = bal.balance;
            
            const expectedLocal = (this.stats.derivBalance || 1000) + this.stats.net; 
            this.stats.balanceDifference = Math.abs(expectedLocal - bal.balance);
            this.stats.isBalanceHealthy = this.stats.balanceDifference <= this.limits.maxBalanceTolerance;

            if (!this.stats.isBalanceHealthy) {
                this.triggerKillSwitch(`BALANCE MISMATCH: Drift of $${this.stats.balanceDifference.toFixed(2)} detected.`);
                return;
            }

            if (this.client && typeof this.client.setBalance === 'function') {
                this.client.setBalance(String(bal.balance));
            }
        } catch (error: any) {
            this.log('error', `Balance sync failed: ${error.message}`);
        }
    }

    private getCurrentReconciliation(): BalanceReconciliation {
        return {
            localBalance: (this.stats.derivBalance || 1000) + this.stats.net,
            derivBalance: this.stats.derivBalance || 0,
            balanceDifference: this.stats.balanceDifference,
            lastSyncTime: Date.now(),
            lastTransactionId: null,
            isHealthy: this.stats.isBalanceHealthy
        };
    }

    private checkGlobalLimits() {
        if (this.stats.dailyNet <= -this.limits.maxDailyLoss) {
            this.triggerKillSwitch(`DAILY LOSS LIMIT REACHED: -$${Math.abs(this.stats.dailyNet).toFixed(2)}`);
        } else if (this.stats.lossStreak >= this.limits.maxConsecutiveLosses) {
            this.triggerKillSwitch(`CONSECUTIVE LOSS LIMIT REACHED: ${this.stats.lossStreak}`);
        }
    }

    private triggerKillSwitch(reason: string) {
        this.state = 'HALTED';
        this.isRunning = false;
        if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
        
        this.activeSubscriptions.clear();
        this.rollingTicks.clear();

        this.log('error', `🚨 KILL SWITCH ACTIVATED: ${reason}`);
        this.emit();
    }

    stop() {
        this.isRunning = false;
        if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
        this.state = 'DISCONNECTED';
        this.log('info', 'System stopped by user.');
        this.emit();
    }
}

export const autoTrader = new AutoTraderEngine();
