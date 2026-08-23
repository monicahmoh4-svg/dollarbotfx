import { DerivWSManager } from './deriv-ws-manager';
import { RiskManager } from './risk-manager';
import { ledger } from './ledger';
import { analyzeMarket } from './analysis';
import type { BotState, RiskLimits, BalanceReconciliation } from './types';

const DEFAULT_LIMITS: RiskLimits = {
    maxStakePerTrade: 100,
    maxPercentRiskPerTrade: 0.01,
    maxDailyLoss: 50,
    maxConsecutiveLosses: 3,
    maxConcurrentTrades: 1,
    maxBalanceTolerance: 0.50,
};

export class AutoTraderEngine extends EventTarget {
    private ws: DerivWSManager;
    private riskManager: RiskManager;
    private state: BotState = 'DISCONNECTED';
    private isRunning = false;
    private scanInterval: ReturnType<typeof setInterval> | null = null;
    private reconInterval: ReturnType<typeof setInterval> | null = null;
    private consecutiveLosses = 0;
    private dailyNet = 0;
    private openTrades = new Map<string, any>();
    
    // Configuration
    private appId: string;
    private token: string;
    private paperMode: boolean;

    constructor(appId: string, token: string, paperMode: boolean) {
        super();
        this.appId = appId;
        this.token = token;
        this.paperMode = paperMode;
        this.ws = new DerivWSManager(appId);
        this.riskManager = new RiskManager(DEFAULT_LIMITS);
        
        this.ws.addEventListener('stateChange', (e: any) => {
            this.state = e.detail;
            this.emit();
            if (this.state === 'HALTED' || this.state === 'ERROR') {
                this.emergencyStop('WebSocket state critical');
            }
        });
    }

    private emit() {
        this.dispatchEvent(new CustomEvent('state', { detail: { 
            state: this.state, 
            isRunning: this.isRunning,
            reconciliation: ledger.getReconciliation(),
            logs: ledger.getEntries().slice(0, 50)
        }}));
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        try {
            await this.ws.connect(this.token);
            await this.synchronizeBalance();
            
            this.state = 'TRADING';
            this.emit();
            
            // Start periodic reconciliation
            this.reconInterval = setInterval(() => this.synchronizeBalance(), 30000);
            
            // Start scanning
            this.scanInterval = setInterval(() => this.scan(), 5000);
            
            ledger.append({ type: 'SIGNAL', symbol: 'SYSTEM', message: 'Bot started. State: TRADING' });
        } catch (error: any) {
            this.emergencyStop(`Failed to start: ${error.message}`);
        }
    }

    private async synchronizeBalance() {
        try {
            const response = await this.ws.send({ balance: 1, subscribe: 0 });
            const bal = response?.balance;
            if (!bal || typeof bal.balance !== 'number') throw new Error('Invalid balance response');

            const recon: BalanceReconciliation = {
                localBalance: this.calculateLocalBalance(),
                derivBalance: bal.balance,
                balanceDifference: Math.abs(this.calculateLocalBalance() - bal.balance),
                lastSyncTime: Date.now(),
                lastTransactionId: bal.transaction_id || null,
                isHealthy: Math.abs(this.calculateLocalBalance() - bal.balance) <= DEFAULT_LIMITS.maxBalanceTolerance
            };

            ledger.updateReconciliation(recon);

            if (!recon.isHealthy) {
                this.emergencyStop(`Balance mismatch detected: Diff=${recon.balanceDifference.toFixed(2)}`);
            }
        } catch (error: any) {
            ledger.append({ type: 'ERROR', symbol: 'SYSTEM', message: `Reconciliation failed: ${error.message}` });
        }
    }

    private calculateLocalBalance(): number {
        // In production, this is derived from the immutable ledger's starting balance + all settled P&L
        return 1000; // Placeholder for ledger-based calculation
    }

    private async scan() {
        if (this.state !== 'TRADING' || !this.isRunning) return;

        const symbols = ['R_100', 'R_50', 'R_25']; // Example synthetic indices
        
        for (const symbol of symbols) {
            if (this.state !== 'TRADING') break;

            const analysis = analyzeMarket(symbol, 'rise_fall');
            
            ledger.append({
                type: 'SIGNAL',
                symbol,
                message: analysis.reason
            });

            if (!analysis.canTrade) {
                continue; // NO TRADE
            }

            // Pre-trade validation gate
            const riskCheck = this.riskManager.validatePreTrade(1.0, this.consecutiveLosses, ledger.getReconciliation());
            if (!riskCheck.allowed) {
                ledger.append({ type: 'ERROR', symbol, message: `Risk blocked: ${riskCheck.reason}` });
                continue;
            }

            await this.executeTrade(symbol, analysis);
        }
    }

    private async executeTrade(symbol: string, analysis: any) {
        const uniqueTradeId = crypto.randomUUID();
        
        try {
            ledger.append({
                type: 'ORDER_REQUEST',
                symbol,
                contractType: analysis.contractType || 'CALL',
                stake: 1.0,
                message: `Attempting trade. ID: ${uniqueTradeId}`
            });

            if (this.paperMode) {
                // Simulate paper trade
                await new Promise(r => setTimeout(r, 1000));
                this.settleTrade(uniqueTradeId, symbol, false, -1.0, 'paper');
                return;
            }

            // Live execution would go here, using uniqueTradeId to prevent duplicates
            // const response = await this.ws.send({ buy: 1, ... });
            
        } catch (error: any) {
            ledger.append({
                type: 'ERROR',
                symbol,
                derivRequestId: uniqueTradeId,
                message: `Execution failed: ${error.message}`
            });
        }
    }

    private settleTrade(tradeId: string, symbol: string, isWin: boolean, profit: number, mode: string) {
        if (!isWin) this.consecutiveLosses++;
        else this.consecutiveLosses = 0;
        
        this.dailyNet += profit;
        
        if (this.dailyNet <= -DEFAULT_LIMITS.maxDailyLoss) {
            this.emergencyStop(`Daily loss limit reached: ${this.dailyNet}`);
            return;
        }
        if (this.consecutiveLosses >= DEFAULT_LIMITS.maxConsecutiveLosses) {
            this.emergencyStop(`Consecutive loss limit reached: ${this.consecutiveLosses}`);
            return;
        }

        ledger.append({
            type: 'SETTLEMENT',
            symbol,
            result: isWin ? 'WIN' : 'LOSS',
            profit,
            message: `${mode.toUpperCase()} trade settled. P/L: ${profit}`
        });
        
        this.emit();
    }

    private emergencyStop(reason: string) {
        this.isRunning = false;
        this.state = 'HALTED';
        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.reconInterval) clearInterval(this.reconInterval);
        this.ws.halt();
        
        ledger.append({ type: 'ERROR', symbol: 'SYSTEM', message: `KILL SWITCH TRIGGERED: ${reason}` });
        this.emit();
    }

    stop() {
        this.isRunning = false;
        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.reconInterval) clearInterval(this.reconInterval);
        this.ws.halt();
        ledger.append({ type: 'SIGNAL', symbol: 'SYSTEM', message: 'Bot stopped by user.' });
        this.emit();
    }
}

// Export singleton configured from env
export const autoTrader = new AutoTraderEngine(
    import.meta.env.VITE_DERIV_APP_ID || '1089',
    'USER_TOKEN_INJECTED_AT_RUNTIME',
    import.meta.env.VITE_PAPER_TRADING === 'true'
);
