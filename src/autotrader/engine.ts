import { analyzeBestSignal, inferDecimalsFromQuotes, extractIndicators, type TradeCategory, type ContractType } from './analysis';
import { RiskManager } from './risk-manager';
import { ledger } from './ledger';
import type { BalanceReconciliation } from './types';

export type BotState = 'DISCONNECTED' | 'CONNECTING' | 'SYNCING' | 'READY' | 'TRADING' | 'COOLDOWN' | 'ERROR' | 'HALTED';
export { type TradeCategory, type ContractType };

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
    contractLabel: string;
    direction: 'CALL' | 'PUT' | null;
    barrier: number | null;
    confidenceScore: number;
    expectedEdge: number;
    reason: string;
    category: TradeCategory;
    consecutiveStreak: number;
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
    marketsScanned: number;
    signalsDetected: number;
    riseFallTrades: number;
    evenOddTrades: number;
    overUnderTrades: number;
    matchesDiffersTrades: number;
}

export interface MarketInfo {
    symbol: string;
    display_name: string;
    market: string;
    submarket: string;
    is_active: boolean;
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
export const REAL_MARKETS = SYNTHETIC_INDICES;
export const SYNTHETIC_SYMBOL_PRESETS = SYNTHETIC_INDICES.map((market) => market.symbol).join(',');
export const TRADE_CATEGORIES: { label: string; value: TradeCategory }[] = [
    { label: 'Rise/Fall', value: 'rise_fall' },
    { label: 'Even/Odd', value: 'even_odd' },
    { label: 'Over/Under', value: 'over_under' },
    { label: 'Matches/Differs', value: 'matches_differs' },
];

const DIGIT_CONTRACTS = new Set(['DIGITEVEN', 'DIGITODD', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF']);
const DIRECTIONAL_CONTRACTS = new Set(['CALL', 'PUT']);

const DEFAULT_LIMITS: RiskLimits = {
    maxStakePerTrade: 2,
    maxPercentRiskPerTrade: 0.01,
    maxDailyLoss: 20,
    maxConsecutiveLosses: 5,
    cooldownAfterLossMs: 30_000,
    targetProfit: 50,
    maxTradesPerSession: 200,
    maxSessionDurationMs: 24 * 60 * 60 * 1000,
    maxConcurrentTrades: 3,
    maxBalanceTolerance: 0.10,
    minConfidenceThreshold: 0.65,
    minExpectedEdge: 0.015,
    contractDurationTicks: 5,
};

const CONSECUTIVE_LOSS_PAUSE_MS = 3 * 60 * 1000;

function currencyOf(client: any): string {
    return client?.currency || client?.accounts?.[client?.loginid]?.currency || 'USD';
}

function isSettled(contract: any): boolean {
    return Boolean(contract && (
        contract.is_sold ||
        ['sold', 'won', 'lost'].includes(String(contract.status).toLowerCase())
    ));
}

function buildProposal(
    contractType: ContractType,
    stake: number,
    symbol: string,
    durationTicks: number,
    currency: string,
    barrier?: number | null,
) {
    const proposal: Record<string, unknown> = {
        proposal: 1,
        amount: Number(stake.toFixed(2)),
        basis: 'stake',
        contract_type: contractType,
        currency,
        duration: durationTicks,
        duration_unit: 't',
        underlying_symbol: symbol,
    };
    if (DIGIT_CONTRACTS.has(contractType) && barrier != null) {
        proposal.barrier = String(barrier);
    }
    return proposal;
}

export class AutoTraderEngine extends EventTarget {
    private client: any = null;
    private apiInstance: AutoTraderSettings['apiInstance'] = null;
    private limits = { ...DEFAULT_LIMITS };
    private riskManager = new RiskManager(this.limits);
    private state: BotState = 'DISCONNECTED';
    private isRunning = false;
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
    private cachedMarkets: MarketInfo[] = [];
    private marketCacheTime = 0;
    private stats: AutoTraderStats = {
        wins: 0, losses: 0, net: 0, dailyNet: 0, lossStreak: 0,
        sessionStart: Date.now(), scanCount: 0, tradesOpened: 0,
        derivBalance: null, balanceDifference: 0, isBalanceHealthy: false,
        sessionDurationMs: 0, lastTradeTime: null, lastLossTime: null,
        cooldownUntil: 0, marketsScanned: 0, signalsDetected: 0,
        riseFallTrades: 0, evenOddTrades: 0, overUnderTrades: 0, matchesDiffersTrades: 0,
    };

    constructor() {
        super();
        try {
            const limits = JSON.parse(localStorage.getItem('bot-risk-limits') || '{}');
            this.limits = {
                ...this.limits,
                ...limits,
                maxStakePerTrade: Math.min(100, Number(limits.maxStakePerTrade ?? this.limits.maxStakePerTrade)),
                maxPercentRiskPerTrade: Math.min(0.05, Number(limits.maxPercentRiskPerTrade ?? this.limits.maxPercentRiskPerTrade)),
            };
            this.riskManager = new RiskManager(this.limits);
            const mode = localStorage.getItem('bot-trading-mode');
            if (mode === 'live') this.mode = mode;
        } catch { /* localStorage unavailable in some test environments */ }
    }

    getState() {
        return {
            state: this.state,
            isRunning: this.isRunning,
            running: this.isRunning,
            scanning: this.scanInFlight,
            mode: this.mode,
            limits: { ...this.limits },
            stats: {
                ...this.stats,
                sessionDurationMs: Date.now() - this.stats.sessionStart,
                activeContracts: this.openTrades.size,
            },
            logs: [...this.logs],
            activity: [...this.logs],
            marketsCount: this.cachedMarkets.length,
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
            cooldownUntil: 0, marketsScanned: 0, signalsDetected: 0,
            riseFallTrades: 0, evenOddTrades: 0, overUnderTrades: 0, matchesDiffersTrades: 0,
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

            await this.refreshMarketCache();
            const marketCount = this.cachedMarkets.length;
            this.log('success', `Engine started. Scanning ${marketCount} markets across 4 categories.`);

            this.scanTimer = setInterval(() => void this.scan(), 5_000);
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

    private async refreshMarketCache() {
        try {
            const response = await this.apiInstance!.send({ active_symbols: 'brief' });
            const symbols = response?.active_symbols || [];
            const markets: MarketInfo[] = [];

            for (const item of symbols) {
                if (item.is_trading_suspended) continue;
                if (!item.symbol) continue;
                markets.push({
                    symbol: item.symbol,
                    display_name: item.display_name || item.symbol,
                    market: item.market || '',
                    submarket: item.submarket || '',
                    is_active: true,
                });
            }

            if (markets.length > 0) {
                this.cachedMarkets = markets;
                this.marketCacheTime = Date.now();
            } else {
                this.cachedMarkets = SYNTHETIC_INDICES.map((m) => ({
                    ...m, market: 'synthetic_index', submarket: 'volatility_indices', is_active: true,
                }));
            }
        } catch {
            if (this.cachedMarkets.length === 0) {
                this.cachedMarkets = SYNTHETIC_INDICES.map((m) => ({
                    ...m, market: 'synthetic_index', submarket: 'volatility_indices', is_active: true,
                }));
            }
        }
    }

    private async scan() {
        if (!this.isRunning || this.scanInFlight || this.state === 'HALTED') return;

        if (this.cooldownUntil > Date.now()) {
            if (this.state !== 'COOLDOWN') { this.state = 'COOLDOWN'; this.emit(); }
            return;
        }
        if (this.state === 'COOLDOWN') { this.state = 'READY'; this.emit(); }

        if (this.openTrades.size >= this.limits.maxConcurrentTrades) return;

        this.scanInFlight = true;
        this.state = 'TRADING';
        this.emit();

        try {
            const now = Date.now();
            if (now - this.marketCacheTime > 60_000 || this.cachedMarkets.length === 0) {
                await this.refreshMarketCache();
            }

            const markets = this.cachedMarkets;
            const candidates: { signal: AnalysisSignal; market: MarketInfo; projectedProfit: number }[] = [];

            for (const market of markets) {
                if (!this.isRunning) break;

                try {
                    const response = await this.apiInstance!.send({
                        ticks_history: market.symbol, adjust_start_time: 1, count: 1000, end: 'latest', style: 'ticks',
                    });

                    // Handle Deriv API error responses properly
                    if (!response || response.error) {
                        continue;
                    }

                    const prices = response?.history?.prices;
                    if (!Array.isArray(prices)) continue;

                    const quotes = prices.map(Number).filter(Number.isFinite);
                    if (quotes.length < 100) continue;

                    const decimals = inferDecimalsFromQuotes(quotes);
                    const result = analyzeBestSignal(quotes, decimals);
                    this.stats.marketsScanned += 1;

                    if (result.signalStrength === 'NONE' || !result.contractType) continue;
                    if (result.signalStrength === 'WEAK') continue;
                    if (result.confidence < this.limits.minConfidenceThreshold) continue;

                    if (result.category === 'rise_fall') {
                        if (!result.htfAgreement || !result.ltfAgreement) continue;
                    }

                    if (result.category === 'over_under') {
                        if (result.consecutiveAbove < 2) continue;
                    }

                    this.stats.signalsDetected += 1;

                    const signal: AnalysisSignal = {
                        canTrade: true,
                        contractType: result.contractType,
                        contractLabel: result.contractLabel,
                        direction: result.direction,
                        barrier: result.barrier,
                        confidenceScore: result.confidence,
                        expectedEdge: 0,
                        reason: result.reason,
                        category: result.category,
                        consecutiveStreak: result.consecutiveAbove,
                    };

                    const winProb = result.estimatedWinProbability * result.confidence;
                    const projectedProfit = winProb * 0.85 - (1 - winProb) * 1.0;

                    candidates.push({ signal, market, projectedProfit });
                } catch (marketErr: any) {
                    // Individual market failed - log and continue to next
                    const errMsg = typeof marketErr === 'string' ? marketErr : marketErr?.message || String(marketErr);
                    this.log('warn', `Market ${market.symbol} scan error: ${errMsg}`);
                }
            }

            // Sort by projected profit then confidence
            candidates.sort((a, b) => b.projectedProfit - a.projectedProfit || b.signal.confidenceScore - a.signal.confidenceScore);

            // Execute ALL qualifying candidates (non-stop trading)
            for (const candidate of candidates) {
                if (!this.isRunning) break;
                if (this.openTrades.size >= this.limits.maxConcurrentTrades) break;

                const { signal, market, projectedProfit } = candidate;

                if (projectedProfit <= 0) continue;

                // Execute directly - skip AI call to avoid 500 errors and delays
                // The technical analysis is already thorough; AI was just adding latency
                const executed = await this.considerTrade(market, signal);
                if (executed) {
                    this.emit();
                }
            }
        } catch (error: any) {
            const errMsg = typeof error === 'string' ? error : error?.message || String(error);
            this.log('error', `Scan failed: ${errMsg}`);
        } finally {
            this.stats.scanCount += 1;
            this.scanInFlight = false;
            if (this.isRunning && this.openTrades.size === 0 && this.state !== 'COOLDOWN') this.state = 'READY';
            if (this.stats.scanCount % 5 === 0) {
                this.log('info', `Cycle #${this.stats.scanCount}: ${this.stats.marketsScanned} scanned, ${this.stats.signalsDetected} signals, ${this.openTrades.size} open`);
            }
            this.emit();
        }
    }

    private async considerTrade(market: MarketInfo, signal: AnalysisSignal) {
        if (!signal.contractType || !this.apiInstance || !this.stats.isBalanceHealthy) return false;
        const balance = this.stats.derivBalance || 0;
        const stake = Math.min(this.limits.maxStakePerTrade, balance * this.limits.maxPercentRiskPerTrade);
        if (!Number.isFinite(stake) || stake <= 0) return false;

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

        const proposalRequest = buildProposal(
            signal.contractType, stake, market.symbol,
            this.limits.contractDurationTicks, currencyOf(this.client), signal.barrier,
        );
        const proposalResponse = await this.apiInstance.send(proposalRequest);
        const proposal = proposalResponse?.proposal;
        const ask = Number(proposal?.ask_price);
        const payout = Number(proposal?.payout);
        const modelProbability = signal.confidenceScore * 0.85;
        const expectedEdge = (modelProbability * payout - ask) / Math.max(ask, Number.EPSILON);
        if (!proposal?.id || !Number.isFinite(ask) || !Number.isFinite(payout) ||
            expectedEdge < this.limits.minExpectedEdge) {
            this.log('info', `Skipped ${market.display_name} ${signal.contractType}: edge ${(expectedEdge * 100).toFixed(2)}% below threshold.`);
            return false;
        }

        signal.expectedEdge = expectedEdge;
        this.log('info', `Qualified ${market.display_name}: ${signal.category} ${signal.contractType} [${signal.contractLabel}], conf ${(modelProbability * 100).toFixed(1)}%, edge ${(expectedEdge * 100).toFixed(1)}%.`);
        const contractId = await this.buyWithRetry(proposal.id, ask, market.symbol, signal.contractType, signal.barrier);
        if (!contractId) return false;

        this.stats.tradesOpened += 1;
        this.stats.lastTradeTime = Date.now();
        this.incrementCategoryCount(signal.category);
        ledger.append({
            type: 'TRADE_OPEN',
            symbol: market.symbol,
            message: `Opened ${market.display_name} ${signal.contractType} [${signal.contractLabel}] contract ${contractId}`,
            balanceBefore: balance,
            stake,
            contractId,
        });
        this.log('success', `Opened ${market.display_name} (${market.symbol}) ${signal.contractType} [${signal.contractLabel}], contract ${contractId}.`);
        this.watchContract(contractId, market.display_name, stake);
        return true;
    }

    private incrementCategoryCount(category: TradeCategory) {
        switch (category) {
            case 'rise_fall': this.stats.riseFallTrades++; break;
            case 'even_odd': this.stats.evenOddTrades++; break;
            case 'over_under': this.stats.overUnderTrades++; break;
            case 'matches_differs': this.stats.matchesDiffersTrades++; break;
        }
    }

    private async buyWithRetry(proposalId: string, price: number, symbol: string, contractType: ContractType, barrier?: number | null): Promise<string> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const buy = await this.apiInstance!.send({ buy: proposalId, price });
                const contractId = String(buy?.buy?.contract_id || '');
                if (contractId) return contractId;
            } catch (error: any) {
                this.log('warn', `Buy attempt ${attempt + 1} failed for ${symbol}: ${error?.message || error}`);
            }
            if (attempt === 0) {
                try {
                    const refreshed = await this.apiInstance!.send(buildProposal(
                        contractType, price, symbol, this.limits.contractDurationTicks,
                        currencyOf(this.client), barrier,
                    ));
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
        try {
            const response = await this.apiInstance.send({ balance: 1 });
            const balance = Number(response?.balance?.balance);
            if (!Number.isFinite(balance)) throw new Error('Invalid balance response');
            if (this.startingBalance === null) this.startingBalance = balance;

            const reserved = [...this.openTrades.values()].reduce((sum, trade) => sum + trade.stake, 0);
            const expected = this.startingBalance + this.realizedNet - reserved;
            this.stats.derivBalance = balance;
            this.stats.balanceDifference = Math.abs(expected - balance);

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
        } catch (error: any) {
            this.log('warn', `Balance sync failed: ${error?.message || error}`);
        }
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
