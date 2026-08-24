import { evaluateCondition } from './rules';
import { ExecutorConfig, ExecutorState, MarketSymbol } from './types';
import * as ConnectionStream from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

const DEFAULT_CONFIG: ExecutorConfig = {
    symbol: 'R_100',
    contractType: 'CALL',
    stake: 1.0,
    duration: 5,
    durationUnit: 't',
    condition: 'RSI_OVERSOLD',
    maxDailyLoss: 20.0,
    targetProfit: 10.0,
    maxConsecutiveLosses: 3,
};

export class SmartExecutor extends EventTarget {
    private config: ExecutorConfig = { ...DEFAULT_CONFIG };
    private state: ExecutorState = {
        isRunning: false,
        isHalted: false,
        haltReason: null,
        stats: { totalTrades: 0, wins: 0, losses: 0, currentStreak: 0, netProfit: 0, dailyProfit: 0 },
        logs: [],
    };
    
    private apiInstance: any = null;
    private client: any = null;
    private scanInterval: ReturnType<typeof setInterval> | null = null;
    private balanceInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        super();
        this.loadConfig();
    }

    private loadConfig() {
        try {
            const saved = localStorage.getItem('smart-executor-config');
            if (saved) this.config = { ...this.config, ...JSON.parse(saved) };
        } catch {}
    }

    private saveConfig() {
        localStorage.setItem('smart-executor-config', JSON.stringify(this.config));
    }

    public updateConfig(patch: Partial<ExecutorConfig>) {
        this.config = { ...this.config, ...patch };
        this.saveConfig();
        this.emit();
    }

    private log(level: ExecutorState['logs'][number]['level'], message: string) {
        const entry = { time: new Date().toLocaleTimeString(), level, message };
        this.state.logs.unshift(entry);
        if (this.state.logs.length > 100) this.state.logs.pop();
        console.log(`[EXECUTOR ${level.toUpperCase()}] ${message}`);
        this.emit();
    }

    private emit() {
        this.dispatchEvent(new CustomEvent('stateChange', { detail: { ...this.state, config: this.config } }));
    }

    public async start(client: any, apiInstance: any) {
        if (this.state.isRunning) return;
        this.client = client;
        this.apiInstance = apiInstance;

        if (!client?.is_logged_in || !apiInstance) {
            this.state.isHalted = true;
            this.state.haltReason = 'Not logged in or API missing';
            this.log('error', this.state.haltReason);
            this.emit();
            return;
        }

        this.state.isRunning = true;
        this.state.isHalted = false;
        this.state.haltReason = null;
        // Reset session stats
        this.state.stats = { totalTrades: 0, wins: 0, losses: 0, currentStreak: 0, netProfit: 0, dailyProfit: 0 };
        
        this.log('success', `SmartExecutor started on ${this.config.symbol}. Evaluating: ${this.config.condition}`);
        
        await this.syncBalance();
        
        this.scanInterval = setInterval(() => this.runCycle(), 5000);
        this.balanceInterval = setInterval(() => this.syncBalance(), 10000);
        this.emit();
    }

    public stop() {
        this.state.isRunning = false;
        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.balanceInterval) clearInterval(this.balanceInterval);
        this.log('info', 'SmartExecutor stopped by user.');
        this.emit();
    }

    public halt(reason: string) {
        this.state.isRunning = false;
        this.state.isHalted = true;
        this.state.haltReason = reason;
        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.balanceInterval) clearInterval(this.balanceInterval);
        this.log('error', `🚨 HALTED: ${reason}`);
        this.emit();
    }

    private async runCycle() {
        if (!this.state.isRunning || this.state.isHalted) return;

        // 1. Check Risk Limits
        if (this.state.stats.dailyProfit <= -this.config.maxDailyLoss) {
            return this.halt(`Daily loss limit reached (-$${this.config.maxDailyLoss})`);
        }
        if (this.state.stats.netProfit >= this.config.targetProfit) {
            return this.halt(`Target profit reached ($${this.config.targetProfit})`);
        }
        if (this.state.stats.currentStreak >= this.config.maxConsecutiveLosses) {
            return this.halt(`Max consecutive losses reached (${this.config.maxConsecutiveLosses})`);
        }

        // 2. Fetch Market Data
        try {
            const response = await this.apiInstance.send({
                ticks_history: this.config.symbol,
                adjust_start_time: 1,
                count: 100,
                end: 'latest',
                style: 'ticks'
            });
            const ticks = (response?.history?.prices ?? []).map((p: any) => Number(p));
            
            if (ticks.length < 50) return;

            // 3. Evaluate Rules
            const shouldTrade = evaluateCondition(this.config.condition, ticks);
            
            if (shouldTrade) {
                this.log('info', `Condition met (${this.config.condition}). Executing ${this.config.contractType}...`);
                await this.executeTrade();
            }
        } catch (error: any) {
            this.log('error', `Data fetch failed: ${error.message}`);
        }
    }

    private async executeTrade() {
        try {
            const currency = this.client?.currency || 'USD';
            
            // Request Proposal
            const propRes = await this.apiInstance.send({
                proposal: 1,
                amount: this.config.stake,
                basis: 'stake',
                contract_type: this.config.contractType,
                currency: currency,
                duration: this.config.duration,
                duration_unit: this.config.durationUnit,
                symbol: this.config.symbol
            });

            if (!propRes?.proposal?.id) {
                this.log('error', 'Failed to get valid proposal.');
                return;
            }

            // Buy Contract
            const buyRes = await this.apiInstance.send({
                buy: propRes.proposal.id,
                price: propRes.proposal.ask_price
            });

            const contractId = buyRes?.buy?.contract_id;
            if (!contractId) {
                this.log('error', 'Trade execution failed.');
                return;
            }

            this.state.stats.totalTrades += 1;
            this.log('success', `Trade opened: Contract ID ${contractId}`);
            await this.syncBalance(); // Update balance immediately after stake deduction

            // Monitor Settlement
            const monitor = setInterval(async () => {
                try {
                    const pocRes = await this.apiInstance.send({
                        proposal_open_contract: 1,
                        contract_id: String(contractId)
                    });
                    const poc = pocRes?.proposal_open_contract;

                    if (poc && (poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost')) {
                        const profit = Number(poc.profit ?? 0);
                        const isWin = profit > 0;

                        this.state.stats.netProfit += profit;
                        this.state.stats.dailyProfit += profit;

                        if (isWin) {
                            this.state.stats.wins += 1;
                            this.state.stats.currentStreak = 0;
                            this.log('success', `WON: +$${profit.toFixed(2)}`);
                        } else {
                            this.state.stats.losses += 1;
                            this.state.stats.currentStreak += 1;
                            this.log('warn', `LOST: $${profit.toFixed(2)}`);
                        }

                        clearInterval(monitor);
                        await this.syncBalance(); // Reconcile after settlement
                    }
                } catch (e: any) {
                    this.log('error', `Settlement check failed: ${e.message}`);
                }
            }, 2000);

        } catch (error: any) {
            this.log('error', `Execution error: ${error.message}`);
        }
    }

    private async syncBalance() {
        if (!this.apiInstance) return;
        try {
            const response = await this.apiInstance.send({ balance: 1, subscribe: 1 });
            const bal = response?.balance;
            if (!bal || typeof bal.balance !== 'number') return;

            // Update UI Store
            if (this.client && typeof this.client.setBalance === 'function') {
                this.client.setBalance(String(bal.balance));
                if (bal.currency && typeof this.client.setCurrency === 'function') {
                    this.client.setCurrency(bal.currency);
                }
            }

            // Update Connection Stream (Deriv UI Header)
            if (typeof ConnectionStream.updateAccountBalance === 'function') {
                ConnectionStream.updateAccountBalance(bal.loginid || this.client?.loginid, bal.balance, bal.currency);
            }
        } catch {}
    }
}

export const smartExecutor = new SmartExecutor();
