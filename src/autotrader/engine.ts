import { analyzeMarket, inferDecimalsFromQuotes } from './analysis';

// ============================================================================
// TYPES & CONSTANTS
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

export const TRADE_CATEGORIES: { label: string; value: TradeCategory }[] = [
    { label: 'Rise/Fall', value: 'rise_fall' },
    { label: 'Even/Odd', value: 'even_odd' },
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
// RISK MANAGER
// ============================================================================

class RiskManager {
    constructor(private limits: RiskLimits) {}

    validatePreTrade(stake: number, currentConsecutiveLosses: number, recon: BalanceReconciliation | null, currentOpenTrades: number): { allowed: boolean; reason: string } {
        if (!recon || !recon.isHealthy) return { allowed: false, reason: 'ACCOUNT_SYNC_UNHEALTHY' };
        if (recon.balanceDifference > this.limits.maxBalanceTolerance) return { allowed: false, reason: `BALANCE_MISMATCH: Diff=${recon.balanceDifference.toFixed(2)}` };
        if (currentConsecutiveLosses >= this.limits.maxConsecutiveLosses) return { allowed: false, reason: `MAX_CONSECUTIVE_LOSSES: ${currentConsecutiveLosses}` };
        if (currentOpenTrades >= this.limits.maxConcurrentTrades) return { allowed: false, reason: `MAX_CONCURRENT_TRADES: ${currentOpenTrades}` };
        if (stake > this.limits.maxStakePerTrade) return { allowed: false, reason: `STAKE_EXCEEDED: ${stake}` };
        return { allowed: true, reason: 'RISK_CHECKS_PASSED' };
    }
}

// ============================================================================
// ENGINE IMPLEMENTATION
// ============================================================================

const DEFAULT_LIMITS: RiskLimits = {
    maxStakePerTrade: 1.0,
    maxPercentRiskPerTrade: 0.02,
    maxDailyLoss: 50,
    maxConsecutiveLosses: 3,
    maxConcurrentTrades: 1,
    maxBalanceTolerance: 0.50,
    minConfidenceThreshold: 0.60, // Calibrated to allow valid signals to pass
};

export class AutoTraderEngine extends EventTarget {
    private client: any = null;
    private apiInstance: any = null;
    private limits: RiskLimits = { ...DEFAULT_LIMITS };
    
    private state: BotState = 'DISCONNECTED';
    private isRunning = false;
    private mode: 'paper' | 'live' = 'paper';
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
    
    private stats: AutoTraderStats = {
        wins: 0, losses: 0, net: 0, dailyNet: 0, lossStreak: 0,
        sessionStart: Date.now(), scanCount: 0, tradesOpened: 0,
        derivBalance: null, balanceDifference: 0, isBalanceHealthy: true,
    };

    private logs: { time: string; level: string; message: string }[] = [];

    constructor() {
        super();
        this.loadConfig();
    }

    private loadConfig() {
        try {
            const raw = localStorage.getItem('bot-risk-limits');
            if (raw) this.limits = { ...this.limits, ...JSON.parse(raw) };
            const savedMode = localStorage.getItem('bot-trading-mode');
            if (savedMode === 'live' || savedMode === 'paper') this.mode = savedMode;
        } catch {}
    }

    getState() {
        return { limits: { ...this.limits }, stats: { ...this.stats }, state: this.state, isRunning: this.isRunning, mode: this.mode, logs: [...this.logs] };
    }

    private emit() { this.dispatchEvent(new CustomEvent('state', { detail: this.getState() })); }

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

    setMode(mode: 'paper' | 'live') {
        this.mode = mode;
        localStorage.setItem('bot-trading-mode', mode);
        this.log('info', `Trading mode set to: ${mode.toUpperCase()}`);
    }

    async start(patch: { client?: any; apiInstance?: any; mode?: 'paper' | 'live' } = {}) {
        if (this.isRunning) return;
        this.client = patch.client;
        this.apiInstance = patch.apiInstance;
        if (patch.mode) this.setMode(patch.mode);

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
            this.log('success', 'System READY. Initiating autonomous market scanning...');
            
            this.scanTimer = setInterval(() => { void this.scan(); }, 5000);
            this.reconciliationTimer = setInterval(() => this.synchronizeBalance(), 15000);
            setTimeout(() => void this.scan(), 500);
            this.emit();
        } catch (error: any) {
            this.triggerKillSwitch(`Start failure: ${error.message}`);
        }
    }

    private async scan() {
        if (!this.isRunning || this.state === 'HALTED' || !this.apiInstance) return;

        let tradesThisCycle = 0;
        const categoriesToScan: TradeCategory[] = ['rise_fall', 'even_odd'];

        try {
            for (const symbol of SYNTHETIC_INDICES) {
                if (!this.isRunning || this.state === 'HALTED') break;

                let quotes: number[] = [];
                try {
                    const response = await this.apiInstance.send({ 
                        ticks_history: symbol.symbol, adjust_start_time: 1, count: 300, end: 'latest', style: 'ticks' 
                    });
                    quotes = (response?.history?.prices ?? []).map((p: any) => Number(p));
                } catch { continue; }

                if (quotes.length < 50) continue;
                const decimals = inferDecimalsFromQuotes(quotes);

                for (const category of categoriesToScan) {
                    const rawSignal = analyzeMarket(category, quotes, decimals);
                    
                    const signal: AnalysisSignal = {
                        canTrade: rawSignal.contractType !== null && rawSignal.confidence >= this.limits.minConfidenceThreshold,
                        contractType: rawSignal.contractType,
                        direction: rawSignal.direction,
                        barrier: rawSignal.barrier,
                        confidenceScore: rawSignal.confidence,
                        expectedEdge: rawSignal.confidence - 0.50,
                        reason: rawSignal.reason
                    };

                    if (signal.canTrade) {
                        this.log('info', `SIGNAL: ${symbol.display_name} | ${category.toUpperCase()} | ${signal.contractType} | Conf: ${(signal.confidenceScore * 100).toFixed(1)}%`);

                        const recon = this.getCurrentReconciliation();
                        const riskCheck = new RiskManager(this.limits).validatePreTrade(this.limits.maxStakePerTrade, this.stats.lossStreak, recon, 0);

                        if (!riskCheck.allowed) {
                            this.log('warn', `TRADE BLOCKED: ${riskCheck.reason}`);
                            continue;
                        }

                        await this.executeTrade(symbol, signal, category);
                        tradesThisCycle += 1;
                        await new Promise(resolve => setTimeout(resolve, 1500)); // Cooldown
                        break; // One trade per symbol per scan
                    }
                }
            }
        } catch (error: any) {
            this.log('error', `Scan error: ${error.message}`);
        } finally {
            this.stats.scanCount += 1;
            this.emit();
        }
    }

    private async executeTrade(symbol: any, signal: AnalysisSignal, category: TradeCategory) {
        const stake = this.limits.maxStakePerTrade;
        this.log('success', `EXECUTING ${this.mode.toUpperCase()} TRADE: ${symbol.display_name} | ${signal.contractType} | Stake: ${stake}`);
        this.stats.tradesOpened += 1;
        
        if (this.mode === 'paper') {
            setTimeout(() => {
                const isWin = Math.random() < 0.52; // Simulated slight edge for testing
                const profit = isWin ? stake * 0.95 : -stake;
                this.stats.net += profit;
                this.stats.dailyNet += profit;
                
                if (isWin) { this.stats.wins += 1; this.stats.lossStreak = 0; this.log('success', `PAPER TRADE WON: +${profit.toFixed(2)}`); } 
                else { this.stats.losses += 1; this.stats.lossStreak += 1; this.log('warn', `PAPER TRADE LOST: ${profit.toFixed(2)}`); }
                
                this.checkGlobalLimits();
                this.emit();
            }, 1500);
        } else {
            try {
                const currency = this.client?.currency || 'USD';
                const payload: any = {
                    proposal: 1, amount: stake, basis: 'stake', contract_type: signal.contractType,
                    currency: currency, duration: 5, duration_unit: 't', underlying_symbol: symbol.symbol
                };
                if (signal.barrier !== null) payload.barrier = String(signal.barrier);

                const propRes = await this.apiInstance.send(payload);
                if (!propRes?.proposal?.id) { this.log('error', 'Failed to get proposal.'); return; }

                const buyRes = await this.apiInstance.send({ buy: propRes.proposal.id, price: propRes.proposal.ask_price });
                const contractId = buyRes?.buy?.contract_id;
                if (!contractId) { this.log('error', 'Live buy failed.'); return; }

                this.log('success', `LIVE TRADE OPENED: Contract ID ${contractId}`);
                
                const monitor = setInterval(async () => {
                    try {
                        const pocRes = await this.apiInstance.send({ proposal_open_contract: 1, contract_id: String(contractId) });
                        const poc = pocRes?.proposal_open_contract;
                        if (poc && (poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost')) {
                            const profit = Number(poc.profit ?? 0);
                            const isWin = profit > 0;
                            this.stats.net += profit; this.stats.dailyNet += profit;
                            if (isWin) { this.stats.wins += 1; this.stats.lossStreak = 0; this.log('success', `LIVE TRADE WON: +${profit.toFixed(2)}`); } 
                            else { this.stats.losses += 1; this.stats.lossStreak += 1; this.log('warn', `LIVE TRADE LOST: ${profit.toFixed(2)}`); }
                            clearInterval(monitor);
                            this.checkGlobalLimits();
                            await this.synchronizeBalance();
                            this.emit();
                        }
                    } catch (e: any) { this.log('error', `POC poll error: ${e.message}`); }
                }, 2000);
            } catch (error: any) {
                this.log('error', `Live execution failed: ${error.message}`);
            }
        }
    }

    private async synchronizeBalance() {
        if (!this.isRunning || this.state === 'HALTED') return;
        try {
            const response = await this.apiInstance.send({ balance: 1 });
            const bal = response?.balance;
            if (!bal || typeof bal.balance !== 'number') return;

            this.stats.derivBalance = bal.balance;
            const expectedLocal = (this.stats.derivBalance || 1000) + this.stats.net; 
            this.stats.balanceDifference = Math.abs(expectedLocal - bal.balance);
            this.stats.isBalanceHealthy = this.stats.balanceDifference <= this.limits.maxBalanceTolerance;

            if (!this.stats.isBalanceHealthy) {
                this.triggerKillSwitch(`BALANCE MISMATCH: Drift of $${this.stats.balanceDifference.toFixed(2)} detected.`);
                return;
            }
            if (this.client && typeof this.client.setBalance === 'function') this.client.setBalance(String(bal.balance));
        } catch {}
    }

    private getCurrentReconciliation(): BalanceReconciliation {
        return { localBalance: (this.stats.derivBalance || 1000) + this.stats.net, derivBalance: this.stats.derivBalance || 0, balanceDifference: this.stats.balanceDifference, lastSyncTime: Date.now(), lastTransactionId: null, isHealthy: this.stats.isBalanceHealthy };
    }

    private checkGlobalLimits() {
        if (this.stats.dailyNet <= -this.limits.maxDailyLoss) this.triggerKillSwitch(`DAILY LOSS LIMIT REACHED: -$${Math.abs(this.stats.dailyNet).toFixed(2)}`);
        else if (this.stats.lossStreak >= this.limits.maxConsecutiveLosses) this.triggerKillSwitch(`CONSECUTIVE LOSS LIMIT REACHED: ${this.stats.lossStreak}`);
    }

    private triggerKillSwitch(reason: string) {
        this.state = 'HALTED'; this.isRunning = false;
        if (this.scanTimer) clearInterval(this.scanTimer);
        if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
        this.log('error', `🚨 KILL SWITCH ACTIVATED: ${reason}`);
        this.emit();
    }

    stop() {
        this.isRunning = false;
        if (this.scanTimer) clearInterval(this.scanTimer);
        if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
        this.state = 'DISCONNECTED';
        this.log('info', 'System stopped by user.');
        this.emit();
    }
}

export const autoTrader = new AutoTraderEngine();
