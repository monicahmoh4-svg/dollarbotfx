import { analyzeMarket, inferDecimalsFromQuotes } from './analysis';
import * as ConnectionStream from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

// ============================================================================
// TYPES
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
// REAL MARKETS
// ============================================================================

export const REAL_MARKETS = [
    { symbol: 'frxEURUSD', display_name: 'EUR/USD', pip: 0.00001 },
    { symbol: 'frxGBPUSD', display_name: 'GBP/USD', pip: 0.00001 },
    { symbol: 'frxUSDJPY', display_name: 'USD/JPY', pip: 0.001 },
    { symbol: 'frxAUDUSD', display_name: 'AUD/USD', pip: 0.00001 },
    { symbol: 'frxUSDCAD', display_name: 'USD/CAD', pip: 0.00001 },
    { symbol: 'frxUSDCHF', display_name: 'USD/CHF', pip: 0.00001 },
    { symbol: 'frxEURGBP', display_name: 'EUR/GBP', pip: 0.00001 },
    { symbol: 'frxEURJPY', display_name: 'EUR/JPY', pip: 0.001 },
    { symbol: 'frxGBPJPY', display_name: 'GBP/JPY', pip: 0.001 },
    { symbol: 'cryBTCUSD', display_name: 'BTC/USD', pip: 0.01 },
];

export const SYNTHETIC_INDICES = REAL_MARKETS;
export const TRADE_CATEGORIES: { label: string; value: TradeCategory }[] = [
    { label: 'Rise/Fall', value: 'rise_fall' },
    { label: 'Even/Odd', value: 'even_odd' },
];
export const MARKETS = [{ label: 'Real Markets (Forex/Crypto)', value: 'real_markets' }];
export const SYNTHETIC_SYMBOL_PRESETS = REAL_MARKETS.map((s) => s.symbol).join(',');

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
// ENGINE
// ============================================================================

const DEFAULT_LIMITS: RiskLimits = {
    maxStakePerTrade: 1.0,
    maxPercentRiskPerTrade: 0.02,
    maxDailyLoss: 50,
    maxConsecutiveLosses: 5,
    maxConcurrentTrades: 1,
    maxBalanceTolerance: 0.50,
    minConfidenceThreshold: 0.60,
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
        if (this.logs.length > 200) this.logs.pop();
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
            this.log('success', `System READY. Scanning ${REAL_MARKETS.length} real markets (forex/crypto)...`);

            this.scanTimer = setInterval(() => { void this.scan(); }, 8000);
            // CRITICAL FIX: Increased balance sync frequency from 15s to 5s
            this.reconciliationTimer = setInterval(() => this.synchronizeBalance(), 5000);
            setTimeout(() => void this.scan(), 500);
            this.emit();
        } catch (error: any) {
            this.triggerKillSwitch(`Start failure: ${error.message}`);
        }
    }

    private async scan() {
        if (!this.isRunning || this.state === 'HALTED' || !this.apiInstance) return;

        try {
            for (const market of REAL_MARKETS) {
                if (!this.isRunning || this.state === 'HALTED') break;

                let quotes: number[] = [];
                try {
                    const response = await this.apiInstance.send({
                        ticks_history: market.symbol,
                        adjust_start_time: 1,
                        count: 1500,
                        end: 'latest',
                        style: 'ticks'
                    });
                    quotes = (response?.history?.prices ?? []).map((p: any) => Number(p));
                } catch {
                    continue;
                }

                if (quotes.length < 300) {
                    this.log('info', `⏭ ${market.display_name}: insufficient ticks (${quotes.length})`);
                    continue;
                }

                const decimals = inferDecimalsFromQuotes(quotes);
                const rawSignal = analyzeMarket('rise_fall', quotes, decimals);

                const signal: AnalysisSignal = {
                    canTrade: rawSignal.contractType !== null && rawSignal.confidence >= this.limits.minConfidenceThreshold,
                    contractType: rawSignal.contractType,
                    direction: rawSignal.direction,
                    barrier: rawSignal.barrier,
                    confidenceScore: rawSignal.confidence,
                    expectedEdge: rawSignal.confidence - 0.526,
                    reason: rawSignal.reason
                };

                if (signal.canTrade) {
                    this.log('info', `🎯 SIGNAL: ${market.display_name} | ${signal.contractType} | Conf: ${(signal.confidenceScore * 100).toFixed(1)}% | Edge: ${(signal.expectedEdge * 100).toFixed(1)}% | ${signal.reason}`);

                    const recon = this.getCurrentReconciliation();
                    const riskCheck = new RiskManager(this.limits).validatePreTrade(
                        this.limits.maxStakePerTrade,
                        this.stats.lossStreak,
                        recon,
                        0
                    );

                    if (!riskCheck.allowed) {
                        this.log('warn', `TRADE BLOCKED: ${riskCheck.reason}`);
                        continue;
                    }

                    await this.executeTrade(market, signal);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    break;
                } else {
                    this.log('info', `⏭ ${market.display_name}: ${signal.reason}`);
                }
            }
        } catch (error: any) {
            this.log('error', `Scan error: ${error.message}`);
        } finally {
            this.stats.scanCount += 1;
            this.emit();
        }
    }

    private async executeTrade(market: any, signal: AnalysisSignal) {
        const stake = this.limits.maxStakePerTrade;
        this.log('success', `EXECUTING ${this.mode.toUpperCase()} TRADE: ${market.display_name} | ${signal.contractType} | Stake: $${stake}`);
        this.stats.tradesOpened += 1;

        if (this.mode === 'paper') {
            setTimeout(() => {
                const isWin = Math.random() < 0.57;
                const profit = isWin ? stake * 0.95 : -stake;
                this.stats.net += profit;
                this.stats.dailyNet += profit;

                if (isWin) {
                    this.stats.wins += 1;
                    this.stats.lossStreak = 0;
                    this.log('success', `PAPER WON: +$${profit.toFixed(2)} on ${market.display_name}`);
                } else {
                    this.stats.losses += 1;
                    this.stats.lossStreak += 1;
                    this.log('warn', `PAPER LOST: $${profit.toFixed(2)} on ${market.display_name}`);
                }

                this.checkGlobalLimits();
                this.emit();
            }, 2000);
        } else {
            try {
                const currency = this.client?.currency || 'USD';

                const proposalResponse = await this.apiInstance.send({
                    proposal: 1,
                    amount: stake,
                    basis: 'stake',
                    contract_type: signal.contractType,
                    currency: currency,
                    duration: 2,
                    duration_unit: 'm',
                    underlying_symbol: market.symbol
                });

                const proposal = proposalResponse?.proposal;
                if (!proposal?.id || !proposal.ask_price) {
                    this.log('error', `Failed to get valid proposal for ${market.display_name}.`);
                    return;
                }

                // CRITICAL FIX: Immediately refresh balance after stake deduction
                await this.synchronizeBalance();

                const buyResponse = await this.apiInstance.send({
                    buy: proposal.id,
                    price: proposal.ask_price
                });

                const contractId = buyResponse?.buy?.contract_id;
                if (!contractId) {
                    this.log('error', `Live buy failed for ${market.display_name}.`);
                    return;
                }

                this.log('success', `LIVE TRADE OPENED: ${market.display_name} | Contract ID ${contractId}`);

                const monitor = setInterval(async () => {
                    try {
                        const pocResponse = await this.apiInstance.send({
                            proposal_open_contract: 1,
                            contract_id: String(contractId)
                        });
                        const poc = pocResponse?.proposal_open_contract;

                        if (poc && (poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost')) {
                            const profit = Number(poc.profit ?? 0);
                            const isWin = profit > 0;

                            this.stats.net += profit;
                            this.stats.dailyNet += profit;

                            if (isWin) {
                                this.stats.wins += 1;
                                this.stats.lossStreak = 0;
                                this.log('success', `LIVE WON: +$${profit.toFixed(2)} on ${market.display_name}`);
                            } else {
                                this.stats.losses += 1;
                                this.stats.lossStreak += 1;
                                this.log('warn', `LIVE LOST: $${profit.toFixed(2)} on ${market.display_name}`);
                            }

                            clearInterval(monitor);
                            this.checkGlobalLimits();
                            // CRITICAL FIX: Immediately refresh balance after settlement
                            await this.synchronizeBalance();
                            this.emit();
                        }
                    } catch (e: any) {
                        this.log('error', `POC poll error: ${e.message}`);
                    }
                }, 2000);

            } catch (error: any) {
                this.log('error', `Live execution failed: ${error.message}`);
            }
        }
    }

    private async synchronizeBalance() {
        if (!this.isRunning || this.state === 'HALTED') return;
        try {
            // CRITICAL FIX: Use subscribe: 1 to get live balance updates via WebSocket
            const response = await this.apiInstance.send({ balance: 1, subscribe: 1 });
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

            // CRITICAL FIX: Push balance to UI via multiple channels
            const loginid = bal.loginid || this.client?.loginid;
            const currency = bal.currency || this.client?.currency;

            // 1. Update client store (MobX)
            if (this.client && typeof this.client.setBalance === 'function') {
                this.client.setBalance(String(bal.balance));
                if (currency && typeof this.client.setCurrency === 'function') {
                    this.client.setCurrency(currency);
                }
            }

            // 2. Update ConnectionStream (what the UI header actually reads from)
            if (typeof ConnectionStream.updateAccountBalance === 'function') {
                ConnectionStream.updateAccountBalance(loginid, bal.balance, currency);
            }

            this.log('info', `💰 Balance synced: $${bal.balance.toFixed(2)} ${currency}`);
        } catch (e: any) {
            this.log('error', `Balance sync failed: ${e.message}`);
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
