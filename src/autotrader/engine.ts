import { analyzeMarket, inferDecimalsFromQuotes, extractIndicators } from './analysis';
import { RiskManager } from './risk-manager';
import { ledger } from './ledger';
import type { BalanceReconciliation } from './types';

export type BotState = 'DISCONNECTED' | 'CONNECTING' | 'SYNCING' | 'READY' | 'TRADING' | 'COOLDOWN' | 'ERROR' | 'HALTED';
export type TradeCategory = 'rise_fall' | 'even_odd' | 'over_under' | 'matches_differs';
export type ContractType = 'CALL' | 'PUT';

export interface RiskLimits {
    maxStakePerTrade: number;
    maxPercentRiskPerTrade: number;
    maxDailyLoss: number;
    maxConsecutiveLosses: number;
    cooldownAfterLossMs: number;
    targetProfit: number;
    maxTradesPerSession: number;
    maxSessionDurationMs: number;
    maxConcurrentTrades: number;
    maxBalanceTolerance: number;
    minConfidenceThreshold: number;
    minExpectedEdge: number;
    contractDurationTicks: number;
}

export interface AutoTraderSettings {
    client?: any;
    apiInstance?: { send: (request: Record<string, unknown>) => Promise<any> };
    mode?: 'paper' | 'live';
}

export interface AnalysisSignal {
    canTrade: boolean;
    contractType: ContractType | null;
    direction: 'CALL' | 'PUT' | null;
    barrier: null;
    confidenceScore: number;
    expectedEdge: number;
    reason: string;
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
    sessionDurationMs: number;
    lastTradeTime: number | null;
    lastLossTime: number | null;
    cooldownUntil: number;
}

export const SYNTHETIC_INDICES = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index' },
];
export const REAL_MARKETS= SYNTHETIC_INDICES;
export const SYNTHETIC_SYMBOL_PRESETS = SYNTHETIC_INDICES.map((market) => market.symbol).join(',');
export const TRADE_CATEGORIES = [{ label: 'Rise/Fall', value: 'rise_fall' as TradeCategory }];

const DEFAULT_LIMITS: RiskLimits = {
    maxStakePerTrade: 1,
    maxPercentRiskPerTrade: 0.005,
    maxDailyLoss: 5,
    maxConsecutiveLosses: 3,
    cooldownAfterLossMs: 60_000,
    targetProfit: 10,
    maxTradesPerSession: 30,
    maxSessionDurationMs: 4 * 60 * 60 * 1000,
    maxConcurrentTrades: 1,
    maxBalanceTolerance: 0.05,
    minConfidenceThreshold: 0.72,
    minExpectedEdge: 0.02,
    contractDurationTicks: 5,
};

// How long the engine pauses (cooldown) after hitting the consecutive-loss
// limit before it auto-resumes scanning. Long enough to let the market
// regime shift, short enough that the bot is not effectively dead.
const CONSECUTIVE_LOSS_PAUSE_MS = 5 * 60 * 1000;

function currencyOf(client: any): string {
    return client?.currency || client?.accounts?.[client?.loginid]?.currency || 'USD';
}

function isSettled(contract: any): boolean {
    return Boolean(contract && (
        contract.is_sold ||
        ['sold', 'won', 'lost'].includes(String(contract.status).toLowerCase())
    ));
}

export class AutoTraderEngine extends EventTarget {
    private client: any = null;
    private apiInstance: AutoTraderSettings['apiInstance'] = null;
    private limits = { ...DEFAULT_LIMITS };
    private riskManager = new RiskManager(this.limits);
    private state: BotState = 'DISCONNECTED';
    private isRunning = false;
    // This engine is intentionally live-only. It must never report simulated
    // wins or losses as if they came from the Deriv account.
    private mode: 'paper' | 'live' = 'live';
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
    private sessionTimer: ReturnType<typeof setInterval> | null = null;
    private scanInFlight = false;
    private openTrades = new Map<string, { stake: number; timer: ReturnType<typeof setInterval> }>();
    private startingBalance: number | null = null;
    private realizedNet = 0;
    private cooldownUntil = 0;
    private lastLossTime: number | null = null;
    private mismatchReadings = 0;
    private logs: { time: string; level: string; message: string }[] = [];
    private stats: AutoTraderStats = {
        wins: 0, losses: 0, net: 0, dailyNet: 0, lossStreak: 0,
        sessionStart: Date.now(), scanCount: 0, tradesOpened: 0,
        derivBalance: null, balanceDifference: 0, isBalanceHealthy: false,
        sessionDurationMs: 0, lastTradeTime: null, lastLossTime: null,
        cooldownUntil: 0,
    };

    constructor() {
        super();
        try {
            const limits = JSON.parse(localStorage.getItem('bot-risk-limits') || '{}');
            // Protect against stale localStorage values silently restoring a
            // much larger stake than the current safe default.
            this.limits = {
                ...this.limits,
                ...limits,
                maxStakePerTrade: Math.min(100, Number(limits.maxStakePerTrade ?? this.limits.maxStakePerTrade)),
                maxPercentRiskPerTrade: Math.min(0.05, Number(limits.maxPercentRiskPerTrade ?? this.limits.maxPercentRiskPerTrade)),
            };
            this.riskManager = new RiskManager(this.limits);
            const mode = localStorage.getItem('bot-trading-mode');
            if (mode === 'live') this.mode = mode;
        } catch { /* localStorage is unavailable in some test environments */ }
    }

    getState() {
        return {
            state: this.state,
            isRunning: this.isRunning,
            // Compatibility fields used by the floating activity indicator.
            running: this.isRunning,
            scanning: this.scanInFlight,
            mode: this.mode,
            limits: { ...this.limits },
            stats: { ...this.stats, sessionDurationMs: Date.now() - this.stats.sessionStart },
            logs: [...this.logs],
            activity: [...this.logs],
        };
    }

    private emit() { this.dispatchEvent(new CustomEvent('state', { detail: this.getState() })); }

    private log(level: 'info' | 'warn' | 'error' | 'success', message: string) {
        console[level === 'success' ? 'log' : level](`[AUTO TRADER] ${message}`);
        this.logs.unshift({ time: new Date().toLocaleTimeString(), level, message });
        this.logs = this.logs.slice(0, 200);
        this.emit();
    }

    setMode(mode: 'paper' | 'live') {
        this.mode = mode;
        localStorage.setItem('bot-trading-mode', mode);
        this.log('info', `Trading mode: ${mode.toUpperCase()}`);
    }

    updateLimits(patch: Partial<RiskLimits>) {
        const next = {
            ...this.limits,
            ...patch,
            maxStakePerTrade: Math.min(100, Number(patch.maxStakePerTrade ?? this.limits.maxStakePerTrade)),
            maxPercentRiskPerTrade: Math.min(0.05, Number(patch.maxPercentRiskPerTrade ?? this.limits.maxPercentRiskPerTrade)),
        };
        if (next.maxStakePerTrade <= 0 || next.maxPercentRiskPerTrade <= 0 ||
            next.minConfidenceThreshold < 0.5 || next.minConfidenceThreshold > 0.95 ||
            next.maxDailyLoss <= 0 || next.maxConsecutiveLosses < 1 ||
            next.contractDurationTicks < 1) {
            throw new Error('Invalid risk configuration');
        }
        this.limits = next;
        this.riskManager = new RiskManager(next);
        localStorage.setItem('bot-risk-limits', JSON.stringify(next));
        this.emit();
    }

    async start(settings: AutoTraderSettings = {}) {
        if (this.isRunning) return;
        this.client = settings.client;
        this.apiInstance = settings.apiInstance || null;
        if (settings.mode === 'live') this.setMode(settings.mode);
        if (!this.client?.is_logged_in || !this.apiInstance?.send) {
            this.state = 'ERROR';
            this.log('error', 'Cannot start: log in and provide the active Deriv API instance.');
            return;
        }

        this.isRunning = true;
        this.state = 'SYNCING';
        this.stats = {
            wins: 0, losses: 0, net: 0, dailyNet: 0, lossStreak: 0,
            sessionStart: Date.now(), scanCount: 0, tradesOpened: 0,
            derivBalance: null, balanceDifference: 0, isBalanceHealthy: false,
            sessionDurationMs: 0, lastTradeTime: null, lastLossTime: null,
            cooldownUntil: 0,
        };
        this.realizedNet = 0;
        this.startingBalance = null;
        this.cooldownUntil = 0;
        this.lastLossTime = null;
        this.mismatchReadings = 0;
        try {
            await this.synchronizeBalance();
            if (!this.stats.isBalanceHealthy) throw new Error('Initial account balance could not be reconciled');
            this.state = 'READY';
            this.log('success', `Scanning ${SYNTHETIC_INDICES.length} Deriv synthetic volatility markets.`);
            this.scanTimer = setInterval(() => void this.scan(), 10_000);
            this.reconciliationTimer = setInterval(() => void this.synchronizeBalance(), 5_000);
            this.sessionTimer = setInterval(() => {
                this.stats.sessionDurationMs = Date.now() - this.stats.sessionStart;
                this.checkLimits();
                this.emit();
            }, 1_000);
            void this.scan();
        } catch (error: any) {
            this.halt(`Startup failed: ${error?.message || error}`);
        }
    }

    private async activeMarkets() {
        try {
            const response = await this.apiInstance!.send({ active_symbols: 'brief' });
            const symbols = response?.active_symbols || [];
            const available = new Set(symbols
                .filter((item: any) => !item.is_trading_suspended)
                .map((item: any) => item.symbol));
            // Synthetic indices do not expose the same exchange_is_open field
            // as forex symbols. Only use the active-symbol response when it
            // actually contains synthetic symbols; otherwise keep the known
            // Deriv symbols and let ticks_history report availability.
            const markets = SYNTHETIC_INDICES.filter((market) => available.has(market.symbol));
            return markets.length ? markets : SYNTHETIC_INDICES;
        } catch {
            return SYNTHETIC_INDICES;
        }
    }

    private async scan() {
        if (!this.isRunning || this.scanInFlight || this.state === 'HALTED') return;
        // Respect cooldown after a loss or after hitting the consecutive-loss
        // limit. The bot pauses and then auto-resumes once cooldown expires.
        if (this.cooldownUntil > Date.now()) {
            if (this.state !== 'COOLDOWN') { this.state = 'COOLDOWN'; this.emit(); }
            return;
        }
        if (this.state === 'COOLDOWN') { this.state = 'READY'; this.emit(); }
        if (this.openTrades.size >= this.limits.maxConcurrentTrades) {
            this.log('info', `Scan waiting: ${this.openTrades.size} contract is still open.`);
            return;
        }
        this.scanInFlight = true;
        this.state = 'TRADING';
        this.emit();
        try {
            const markets = await this.activeMarkets();
            for (const market of markets) {
                if (!this.isRunning || this.openTrades.size >= this.limits.maxConcurrentTrades) break;
                try {
                    const response = await this.apiInstance!.send({
                        // 1,000 ticks gives the analysis enough completed
                        // 20-tick higher-timeframe candles for a genuine eMA
                        // comparison. 500 only produced 25 candles and was
                        // rejected before analysis could begin.
                        ticks_history: market.symbol, adjust_start_time: 1, count: 1000, end: 'latest', style: 'ticks',
                    });
                    const quotes = (response?.history?.prices || []).map(Number).filter(Number.isFinite);
                    const result = analyzeMarket('rise_fall', quotes, inferDecimalsFromQuotes(quotes));
                    this.log('info', `Scanned ${market.display_name}: ${quotes.length} ticks; ${result.reason}.`);
                    const signal: AnalysisSignal = {
                        canTrade: Boolean(result.contractType && result.confidence >= this.limits.minConfidenceThreshold),
                        contractType: result.contractType as ContractType | null,
                        direction: result.direction,
                        barrier: null,
                        confidenceScore: result.confidence,
                        expectedEdge: 0,
                        reason: result.reason,
                    };
                    if (!signal.canTrade) continue;
                    // AI refinement: ask the LLM to calibrate the confidence score
                    try {
                        const indicators = extractIndicators(quotes, signal.direction!, signal.confidenceScore);
                        if (indicators) {
                            indicators.symbol = market.symbol;
                            const aiResponse = await fetch('/api/analyze', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(indicators),
                            });
                            if (aiResponse.ok) {
                                const aiResult = await aiResponse.json();
                                if (aiResult.confidence && aiResult.confidence >= this.limits.minConfidenceThreshold) {
                                    signal.confidenceScore = aiResult.confidence;
                                    signal.reason = signal.reason + ' | AI: ' + (aiResult.reasoning || aiResult.refinement || 'calibrated');
                                } else if (aiResult.shouldTrade === false) {
                                    this.log('info', `${market.display_name}: AI vetoed trade (${aiResult.reasoning || 'low confidence'})`);
                                    continue;
                                } else {
                                    signal.reason = signal.reason + ' | AI: ' + (aiResult.refinement || 'fallback');
                                }
                            }
                        }
                    } catch (aiError: any) {
                        this.log('warn', `AI refinement unavailable for ${market.display_name}, using technical score.`);
                    }
                    const executed = await this.considerTrade(market, signal);
                    if (executed) break;
                } catch (error: any) {
                    this.log('warn', `${market.display_name} unavailable: ${error?.message || error}`);
                }
            }
        } catch (error: any) {
            this.log('error', `Scan failed: ${error?.message || error}`);
        } finally {
            this.stats.scanCount += 1;
            this.scanInFlight = false;
            if (this.isRunning && this.openTrades.size === 0 && this.state !== 'COOLDOWN') this.state = 'READY';
            this.emit();
        }
    }

    private async considerTrade(market: { symbol: string; display_name: string }, signal: AnalysisSignal) {
        if (!signal.contractType || !this.apiInstance || !this.stats.isBalanceHealthy) return false;
        const balance = this.stats.derivBalance || 0;
        const stake = Math.min(this.limits.maxStakePerTrade, balance * this.limits.maxPercentRiskPerTrade);
        if (!Number.isFinite(stake) || stake <= 0) return false;

        // Centralised pre-trade risk validation (wires RiskManager into the
        // live path so it is no longer dead code).
        const recon: BalanceReconciliation = {
            localBalance: balance,
            derivBalance: balance,
            balanceDifference: this.stats.balanceDifference,
            lastSyncTime: Date.now(),
            lastTransactionId: null,
            isHealthy: this.stats.isBalanceHealthy,
        };
        const riskCheck = this.riskManager.validatePreTrade(
            stake, this.stats.lossStreak, recon, this.openTrades.size,
        );
        if (!riskCheck.allowed) {
            this.log('info', `Trade blocked on ${market.display_name}: ${riskCheck.reason}`);
            return false;
        }

        const proposalResponse = await this.apiInstance.send({
            proposal: 1, amount: Number(stake.toFixed(2)), basis: 'stake',
            contract_type: signal.contractType, currency: currencyOf(this.client),
            duration: this.limits.contractDurationTicks, duration_unit: 't',
            underlying_symbol: market.symbol,
        });
        const proposal = proposalResponse?.proposal;
        const ask = Number(proposal?.ask_price);
        const payout = Number(proposal?.payout);
        const modelProbability = signal.confidenceScore;
        const expectedEdge = (modelProbability * payout - ask) / Math.max(ask, Number.EPSILON);
        if (!proposal?.id || !Number.isFinite(ask) || !Number.isFinite(payout) ||
            expectedEdge < this.limits.minExpectedEdge) {
            this.log('info', `Skipped ${market.display_name}: proposal edge ${(expectedEdge * 100).toFixed(2)}% is below threshold.`);
            return false;
        }
        signal.expectedEdge = expectedEdge;
        this.log('info', `Qualified ${market.display_name}: ${signal.contractType}, confidence ${(modelProbability * 100).toFixed(1)}%, edge ${
(expectedEdge * 100).toFixed(1)}%.`);
        const contractId = await this.buyWithRetry(proposal.id, ask, market.display_name, signal.contractType);
        if (!contractId) return false;
        this.stats.tradesOpened += 1;
        this.stats.lastTradeTime = Date.now();
        ledger.append({
            type: 'TRADE_OPEN',
            symbol: market.symbol,
            message: `Opened ${market.display_name} ${signal.contractType} contract ${contractId}`,
            balanceBefore: balance,
            stake,
            contractId,
        });
        this.log('success', `Opened ${market.display_name} ${signal.contractType}, contract ${contractId}.`);
        this.watchContract(contractId, market.display_name, stake);
        return true;
    }

    private async buyWithRetry(proposalId: string, price: number, market: string, contractType: ContractType): Promise<string> {
        // Proposals are only valid for a short window; a buy can fail if the
        // price moved. Retry once with a fresh proposal via a re-request.
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const buy = await this.apiInstance!.send({ buy: proposalId, price });
                const contractId = String(buy?.buy?.contract_id || '');
                if (contractId) return contractId;
            } catch (error: any) {
                this.log('warn', `Buy attempt ${attempt + 1} failed for ${market}: ${error?.message || error}`);
            }
            if (attempt === 0) {
                // Refresh the proposal and try once more.
                try {
                    const refreshed = await this.apiInstance!.send({
                        proposal: 1, amount: Number(price.toFixed(2)), basis: 'stake',
                        contract_type: contractType, currency: currencyOf(this.client),
                        duration: this.limits.contractDurationTicks, duration_unit: 't',
                        underlying_symbol: market,
                    });
                    const newProposal = refreshed?.proposal;
                    if (newProposal?.id && Number.isFinite(Number(newProposal.ask_price))) {
                        proposalId = newProposal.id;
                        price = Number(newProposal.ask_price);
                        continue;
                    }
                } catch { /* fall through to final return */ }
            }
        }
        return '';
    }

    private watchContract(contractId: string, market: string, stake: number) {
        const timer = setInterval(async () => {
            try {
                const response = await this.apiInstance!.send({ proposal_open_contract: 1, contract_id: contractId });
                const contract = response?.proposal_open_contract;
                if (!isSettled(contract)) return;
                clearInterval(timer);
                this.openTrades.delete(contractId);
                const profit = Number(contract.profit);
                if (!Number.isFinite(profit)) return;
                this.realizedNet += profit;
                this.stats.net = this.realizedNet;
                this.stats.dailyNet = this.realizedNet;
                if (profit > 0) {
                    this.stats.wins += 1;
                    this.stats.lossStreak = 0;
                    ledger.append({
                        type: 'TRADE_CLOSE',
                        symbol: market,
                        message: `Won ${market}: +${profit.toFixed(2)}`,
                        profit,
                        contractId,
                    });
                    this.log('success', `Won ${market}: +${profit.toFixed(2)}.`);
                } else {
                    this.stats.losses += 1;
                    this.stats.lossStreak += 1;
                    this.lastLossTime = Date.now();
                    // Cooldown applies after a LOSS only (not after a win).
                    this.cooldownUntil = Date.now() + this.limits.cooldownAfterLossMs;
                    this.stats.cooldownUntil = this.cooldownUntil;
                    this.state = 'COOLDOWN';
                    ledger.append({
                        type: 'TRADE_CLOSE',
                        symbol: market,
                        message: `Lost ${market}: ${profit.toFixed(2)}`,
                        profit,
                        contractId,
                    });
                    this.log('warn', `Lost ${market}: ${profit.toFixed(2)}. Cooldown ${this.limits.cooldownAfterLossMs / 1000}s.`);
                }
                await this.synchronizeBalance();
                this.checkLimits();
            } catch (error: any) {
                this.log('error', `Contract ${contractId} monitor failed: ${error?.message || error}`);
            }
        }, 2_000);
        this.openTrades.set(contractId, { stake, timer });
    }

    private async synchronizeBalance() {
        if (!this.apiInstance) return;
        const response = await this.apiInstance.send({ balance: 1 });
        const balance = Number(response?.balance?.balance);
        if (!Number.isFinite(balance)) throw new Error('Invalid balance response');
        if (this.startingBalance === null) this.startingBalance = balance;
        // Reconciling against the account balance is only meaningful when no
        // contracts are still open: while a contract is in flight the Deriv
        // balance already excludes the stake, so subtracting reserved stakes
        // again would double-count and produce a spurious mismatch/halt.
        const reserved = [...this.openTrades.values()].reduce((sum, trade) => sum + trade.stake, 0);
        const expected = this.startingBalance + this.realizedNet - reserved;
        this.stats.derivBalance = balance;
        this.stats.balanceDifference = Math.abs(expected - balance);
        // Tolerate transient mismatches (e.g. a contract that just settled but
        // whose poller hasn't run yet) — only halt after 3 consecutive reads.
        const tolerance = this.limits.maxBalanceTolerance + reserved;
        if (this.stats.balanceDifference <= tolerance) {
            this.stats.isBalanceHealthy = true;
            this.mismatchReadings = 0;
        } else {
            this.mismatchReadings += 1;
            this.stats.isBalanceHealthy = this.mismatchReadings < 3;
            if (!this.stats.isBalanceHealthy) {
                this.halt(`Balance reconciliation mismatch: ${this.stats.balanceDifference.toFixed(2)}`);
            }
        }
        this.emit();
    }

    private checkLimits() {
        const duration = Date.now() - this.stats.sessionStart;
        if (this.stats.dailyNet <= -this.limits.maxDailyLoss) {
            this.halt('Daily loss limit reached.');
        } else if (this.stats.net >= this.limits.targetProfit) {
            this.halt('Target profit reached.');
        } else if (this.stats.tradesOpened >= this.limits.maxTradesPerSession) {
            this.halt('Session trade limit reached.');
        } else if (duration >= this.limits.maxSessionDurationMs) {
            this.halt('Session duration limit reached.');
        } else if (this.stats.lossStreak >= this.limits.maxConsecutiveLosses) {
            // Pause and auto-resume after a long cooldown instead of
            // permanently halting the bot on a losing streak.
            this.cooldownUntil = Date.now() + CONSECUTIVE_LOSS_PAUSE_MS;
            this.stats.cooldownUntil = this.cooldownUntil;
            this.stats.lossStreak = 0;
            this.state = 'COOLDOWN';
            ledger.append({
                type: 'HALT',
                symbol: 'ALL',
                message: `Consecutive loss limit reached; cooling down ${CONSECUTIVE_LOSS_PAUSE_MS / 1000}s before resuming`,
            });
            this.log('warn', `Consecutive loss limit reached. Cooling down ${CONSECUTIVE_LOSS_PAUSE_MS / 1000}s, then resuming.`);
            this.emit();
        }
    }

    private halt(reason: string) {
        this.isRunning = false;
        this.state = 'HALTED';
        if (this.scanTimer) clearInterval(this.scanTimer);
        if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
        if (this.sessionTimer) clearInterval(this.sessionTimer);
        ledger.append({ type: 'HALT', symbol: 'ALL', message: `TRADING HALTED: ${reason}` });
        this.log('error', `TRADING HALTED: ${reason}`);
    }

    stop() {
        this.isRunning = false;
        if (this.scanTimer) clearInterval(this.scanTimer);
        if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
        if (this.sessionTimer) clearInterval(this.sessionTimer);
        this.state = 'DISCONNECTED';
        this.log('info', 'Stopped. Existing contracts remain monitored until settlement.');
    }
}

export const autoTrader = new AutoTraderEngine();
