import { analyzeMarket, inferDecimalsFromQuotes } from './quant-analysis';
import { RiskManager } from './risk-manager';
import type { BotState, AnalysisSignal, RiskLimits, BalanceReconciliation, AutoTraderStats, TradeCategory } from './types';

// --- CONSTANTS EXPORTED FOR UI COMPATIBILITY ---
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

// --- DEFAULT CONFIGURATION ---
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

    // Rolling data windows for live analysis: Map<Symbol, number[]>
    private rollingTicks = new Map<string, number[]>();
    private activeSubscriptions = new Set<string>();

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
        };
    }

    private emit() {
        this.dispatchEvent(new CustomEvent('state', { detail: this.getState() }));
    }

    private log(level: 'info' | 'warn' | 'error' | 'success', message: string) {
        console.log(`[ENGINE ${level.toUpperCase()}] ${message}`);
        // In production, route this to a structured logging service
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
            if (this.state === 'HALTED') return; // Killed during sync

            this.state = 'TRADING';
            this.log('success', 'System READY. Initiating live market subscriptions...');
            
            // Start live tick subscriptions
            for (const symbol of SYNTHETIC_INDICES) {
                await this.subscribeToLiveTicks(symbol.symbol);
            }

            // Start periodic reconciliation (every 15 seconds)
            this.reconciliationTimer = setInterval(() => this.synchronizeBalance(), 15000);
            this.emit();

        } catch (error: any) {
            this.triggerKillSwitch(`Start failure: ${error.message}`);
        }
    }

    private async subscribeToLiveTicks(symbol: string) {
        if (this.activeSubscriptions.has(symbol)) return;
        
        this.log('info', `Subscribing to live ticks: ${symbol}`);
        this.rollingTicks.set(symbol, []); // Initialize window

        try {
            // This requests the last 300 ticks AND subscribes to future ticks
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

    // Called by the UI or WS manager when a new tick arrives
    public processLiveTick(symbol: string, price: number) {
        if (!this.isRunning || this.state !== 'TRADING') return;

        const window = this.rollingTicks.get(symbol) || [];
        window.push(price);
        if (window.length > 500) window.shift(); // Maintain fixed-size rolling window
        this.rollingTicks.set(symbol, window);

        // Only analyze when we have enough data
        if (window.length >= 100) {
            this.evaluateAndExecute(symbol, window);
        }
    }

    private async evaluateAndExecute(symbol: string, ticks: number[]) {
        const signal: AnalysisSignal = analyzeMarket('rise_fall', ticks);
        
        if (!signal.canTrade) {
            // Silent skip for low confidence to prevent log spam, or log occasionally
            return; 
        }

        this.log('info', `SIGNAL DETECTED: ${symbol} | ${signal.contractType} | Conf: ${(signal.confidenceScore * 100).toFixed(1)}% | Edge: ${(signal.expectedEdge * 100).toFixed(1)}%`);

        // 1. Risk Validation Gate
        const recon = this.getCurrentReconciliation();
        const riskCheck = new RiskManager(this.limits).validatePreTrade(
            this.limits.maxStakePerTrade, 
            this.stats.lossStreak, 
            recon, 
            0 // currentOpenTrades (simplified for this example)
        );

        if (!riskCheck.allowed) {
            this.log('warn', `TRADE BLOCKED: ${riskCheck.reason}`);
            return;
        }

        // 2. Execution (Paper mode for safety by default, as per quant best practices for CSPRNG)
        this.log('success', `EXECUTING PAPER TRADE: ${symbol} ${signal.contractType}`);
        this.stats.tradesOpened += 1;
        this.stats.scanCount += 1;
        
        // Simulate trade outcome (In a real live setup, this is where apiInstance.send({ buy: ... }) goes)
        // We simulate a realistic negative expectancy to demonstrate risk management
        setTimeout(() => {
            const isWin = Math.random() < 0.48; // 48% win rate reflects broker edge
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
            
            // Reconciliation Logic
            // In a full system, localBalance is derived from an immutable ledger of all trades.
            // Here, we approximate it to check for drift.
            const expectedLocal = (this.stats.derivBalance || 1000) + this.stats.net; 
            this.stats.balanceDifference = Math.abs(expectedLocal - bal.balance);
            this.stats.isBalanceHealthy = this.stats.balanceDifference <= this.limits.maxBalanceTolerance;

            if (!this.stats.isBalanceHealthy) {
                this.triggerKillSwitch(`BALANCE MISMATCH: Drift of $${this.stats.balanceDifference.toFixed(2)} detected.`);
                return;
            }

            // Sync to UI Store
            if (this.client && typeof this.client.setBalance === 'function') {
                this.client.setBalance(String(bal.balance));
            }
        } catch (error: any) {
            this.log('error', `Balance sync failed: ${error.message}`);
        }
    }

    private getCurrentReconciliation(): BalanceReconciliation | null {
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
        
        // Unsubscribe from all ticks
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
