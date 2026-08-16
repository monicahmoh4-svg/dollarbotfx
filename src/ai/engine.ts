import { DerivAPI, DerivActiveSymbol, DerivTick } from './deriv-api';
import {
    analyzeMarket,
    AnalysisResult,
    ContractType,
    TradeCategory,
    pipToDecimals,
    lastDigitOf,
} from './analysis';

export type AIBotMode = 'paper' | 'live';
export type DurationUnit = 't' | 's' | 'm';

export const TRADE_CATEGORIES: { value: TradeCategory; label: string }[] = [
    { value: 'rise_fall', label: 'Rise / Fall' },
    { value: 'even_odd', label: 'Digits: Even / Odd' },
    { value: 'over_under', label: 'Digits: Over / Under' },
    { value: 'matches_differs', label: 'Digits: Matches / Differs' },
];

export const MARKETS: { value: string; label: string }[] = [
    { value: 'synthetic_index', label: 'Synthetic Indices' },
    { value: 'forex', label: 'Forex' },
    { value: 'indices', label: 'Stock Indices' },
    { value: 'commodities', label: 'Commodities' },
    { value: 'cryptocurrency', label: 'Cryptocurrencies' },
];

export type AIBotSettings = {
    mode: AIBotMode;
    appId: string;
    apiToken: string;
    stake: number;
    currency: string;
    duration: number;
    durationUnit: DurationUnit;
    minConfidence: number;
    maxVolatility: number;
    maxConcurrentTrades: number;
    dailyLossLimit: number;
    takeProfit: number;
    martingaleEnabled: boolean;
    martingaleMultiplier: number;
    maxMartingaleSteps: number;
    maxStake: number;
    requireProfitProjection: boolean;
    minProjectedEdge: number;
    symbolsOverride: string;
    maxSymbols: number;
    scanIntervalMs: number;
    scanBatchDelayMs: number;
    cooldownMs: number;
    enabledMarkets: string[];
    tradeCategories: TradeCategory[];
};

export type AIBotStats = {
    wins: number;
    losses: number;
    net: number;
    dailyNet: number;
    open: number;
    lossStreak: number;
    sessionStart: number;
    day: string;
};

export type AIBotLog = {
    time: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
};

type BaseTrade = {
    id: string;
    symbol: string;
    category: TradeCategory;
    contractType: ContractType;
    barrier: number | null;
    direction: 'CALL' | 'PUT' | null;
    stake: number;
    entry: number;
    decimals: number;
    createdAt: number;
    mode: AIBotMode;
};

type PaperTrade = BaseTrade & {
    mode: 'paper';
    duration: number;
    durationUnit: DurationUnit;
    payoutRatio: number;
    remainingTicks?: number;
    expiresAt?: number;
};

type LiveTrade = BaseTrade & {
    mode: 'live';
    contractId: string;
};

type OpenTrade = PaperTrade | LiveTrade;

export const DEFAULT_AI_SETTINGS: AIBotSettings = {
    mode: 'paper',
    appId: '1089',
    apiToken: '',
    stake: 0.35,
    currency: 'USD',
    duration: 5,
    durationUnit: 't',
    minConfidence: 0.62,
    maxVolatility: 45,
    maxConcurrentTrades: 1,
    dailyLossLimit: 10,
    takeProfit: 20,
    martingaleEnabled: false,
    martingaleMultiplier: 2,
    maxMartingaleSteps: 3,
    maxStake: 100,
    requireProfitProjection: true,
    minProjectedEdge: 0.02,
    symbolsOverride: '',
    maxSymbols: 0,
    scanIntervalMs: 7000,
    scanBatchDelayMs: 350,
    cooldownMs: 20000,
    enabledMarkets: ['synthetic_index'],
    tradeCategories: ['rise_fall'],
};

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isDigitContractWin(contractType: ContractType, barrier: number | null, digit: number): boolean {
    switch (contractType) {
        case 'DIGITEVEN':
            return digit % 2 === 0;
        case 'DIGITODD':
            return digit % 2 === 1;
        case 'DIGITOVER':
            return barrier !== null && digit > barrier;
        case 'DIGITUNDER':
            return barrier !== null && digit < barrier;
        case 'DIGITMATCH':
            return barrier !== null && digit === barrier;
        case 'DIGITDIFF':
            return barrier !== null && digit !== barrier;
        default:
            return false;
    }
}

function buildProposalPayload(
    symbol: string,
    currency: string,
    stake: number,
    analysis: AnalysisResult,
    settings: AIBotSettings
): { payload: Record<string, unknown>; duration: number; durationUnit: DurationUnit } {
    const isDigit = analysis.category !== 'rise_fall';

    // Digit-family contracts on Deriv are only offered for short tick
    // durations (1-10 ticks). Rise/fall respects whatever duration unit the
    // user configured.
    const duration = isDigit ? Math.min(10, Math.max(1, Math.round(settings.duration))) : settings.duration;
    const durationUnit: DurationUnit = isDigit ? 't' : settings.durationUnit;

    const payload: Record<string, unknown> = {
        amount: stake,
        basis: 'stake',
        contract_type: analysis.contractType,
        currency,
        duration,
        duration_unit: durationUnit,
        symbol,
        product_type: 'basic',
    };

    if (analysis.barrier !== null && analysis.barrier !== undefined) {
        payload.barrier = String(analysis.barrier);
    }

    return { payload, duration, durationUnit };
}

class AIBotEngine extends EventTarget {
    private api: DerivAPI | null = null;
    private settings: AIBotSettings = { ...DEFAULT_AI_SETTINGS };

    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private scanning = false;
    private running = false;
    private connected = false;
    private authorized = false;

    private logs: AIBotLog[] = [];
    private stats: AIBotStats = {
        wins: 0,
        losses: 0,
        net: 0,
        dailyNet: 0,
        open: 0,
        lossStreak: 0,
        sessionStart: Date.now(),
        day: new Date().toDateString(),
    };

    private activeSymbols: DerivActiveSymbol[] = [];
    private openTrades = new Map<string, OpenTrade>();
    private cooldownUntil = new Map<string, number>();

    private paperUnsubscribes = new Map<string, () => void>();
    private liveUnsubscribes = new Map<string, () => void>();

    constructor() {
        super();
        this.loadSettings();
    }

    private loadSettings() {
        try {
            const raw = localStorage.getItem('ai-bot-settings');

            if (!raw) {
                return;
            }

            const saved = JSON.parse(raw);

            this.settings = {
                ...DEFAULT_AI_SETTINGS,
                ...saved,
                enabledMarkets:
                    Array.isArray(saved.enabledMarkets) && saved.enabledMarkets.length
                        ? saved.enabledMarkets
                        : DEFAULT_AI_SETTINGS.enabledMarkets,
                tradeCategories:
                    Array.isArray(saved.tradeCategories) && saved.tradeCategories.length
                        ? saved.tradeCategories
                        : DEFAULT_AI_SETTINGS.tradeCategories,
                apiToken: '',
            };
        } catch {
            this.settings = { ...DEFAULT_AI_SETTINGS };
        }
    }

    private saveSettings() {
        try {
            const { apiToken, ...rest } = this.settings;
            localStorage.setItem('ai-bot-settings', JSON.stringify(rest));
        } catch {
            // ignore storage errors
        }
    }

    getState() {
        return {
            settings: { ...this.settings },
            stats: { ...this.stats, open: this.openTrades.size },
            logs: [...this.logs],
            openTrades: Array.from(this.openTrades.values()),
            running: this.running,
            scanning: this.scanning,
            connected: this.connected,
            authorized: this.authorized,
            symbolCount: this.activeSymbols.length,
        };
    }

    private emit() {
        this.dispatchEvent(new CustomEvent('state', { detail: this.getState() }));
    }

    private log(level: AIBotLog['level'], message: string) {
        this.logs.unshift({
            time: new Date().toLocaleTimeString(),
            level,
            message,
        });

        this.logs = this.logs.slice(0, 150);
        this.emit();
    }

    updateSettings(patch: Partial<AIBotSettings>) {
        this.settings = {
            ...this.settings,
            ...patch,
        };

        this.saveSettings();
        this.emit();
    }

    async start(patch: Partial<AIBotSettings> = {}) {
        this.updateSettings(patch);
        this.stop(false);

        if (!this.settings.tradeCategories.length) {
            this.settings.tradeCategories = ['rise_fall'];
        }

        if (!this.settings.enabledMarkets.length) {
            this.settings.enabledMarkets = ['synthetic_index'];
        }

        this.api = new DerivAPI(this.settings.appId || '1089');

        try {
            await this.api.connect();
            this.connected = true;
            this.log('success', 'Connected to Deriv market data.');
        } catch (error: any) {
            this.connected = false;
            this.log('error', `Connection failed: ${error.message}`);
            this.emit();
            return;
        }

        if (this.settings.mode === 'live') {
            if (!this.settings.apiToken) {
                this.settings.mode = 'paper';
                this.log('warn', 'Live mode requires an API token. Switched to paper mode.');
            } else {
                try {
                    await this.api.authorize(this.settings.apiToken);
                    this.authorized = true;
                    this.log('success', 'Live trading authorized. Real money is at risk from this point on.');
                } catch (error: any) {
                    this.settings.mode = 'paper';
                    this.authorized = false;
                    this.log('error', `Authorization failed: ${error.message}. Switched to paper mode.`);
                }
            }
        } else {
            this.authorized = false;
        }

        try {
            const symbols = await this.api.activeSymbols();

            this.activeSymbols = symbols.filter(
                symbol =>
                    this.settings.enabledMarkets.includes(symbol.market) &&
                    !symbol.is_trading_suspended &&
                    (symbol.exchange_is_open === undefined || symbol.exchange_is_open === 1)
            );

            this.log(
                'info',
                `Loaded ${this.activeSymbols.length} tradable markets from: ${this.settings.enabledMarkets.join(', ')}.`
            );

            if (!this.activeSymbols.length) {
                this.log(
                    'warn',
                    'No tradable symbols matched the selected markets right now (some may be closed, e.g. forex on weekends).'
                );
            }
        } catch (error: any) {
            this.log('error', `Could not load active symbols: ${error.message}`);
        }

        this.running = true;
        this.saveSettings();

        this.scanTimer = setInterval(() => {
            void this.scan();
        }, this.settings.scanIntervalMs);

        this.log(
            'success',
            `AI bot started in ${this.settings.mode.toUpperCase()} mode | categories: ${this.settings.tradeCategories.join(
                ', '
            )}.`
        );
        void this.scan();
        this.emit();
    }

    stop(emitLog = true) {
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }

        if (this.running && emitLog) {
            this.log('warn', 'AI bot stopped. Open trades will continue to settle.');
        }

        this.running = false;
        this.emit();
    }

    private resetDailyIfNeeded() {
        const today = new Date().toDateString();

        if (this.stats.day !== today) {
            this.stats.day = today;
            this.stats.dailyNet = 0;
            this.log('info', 'Daily risk counters reset.');
        }
    }

    private limitsHit(): boolean {
        this.resetDailyIfNeeded();

        if (this.settings.dailyLossLimit > 0 && this.stats.dailyNet <= -this.settings.dailyLossLimit) {
            this.log('warn', 'Daily loss limit reached. Bot stopped.');
            this.stop(false);
            return true;
        }

        if (this.settings.takeProfit > 0 && this.stats.dailyNet >= this.settings.takeProfit) {
            this.log('success', 'Daily take profit reached. Bot stopped.');
            this.stop(false);
            return true;
        }

        return false;
    }

    private getSymbols(): DerivActiveSymbol[] {
        let list = [...this.activeSymbols];

        const override = this.settings.symbolsOverride
            .split(',')
            .map(item => item.trim().toUpperCase())
            .filter(Boolean);

        if (override.length) {
            list = list.filter(item => override.includes(item.symbol));
        }

        if (this.settings.maxSymbols > 0) {
            list = list.slice(0, this.settings.maxSymbols);
        }

        return list;
    }

    private canTrade(symbol: string): boolean {
        if (!this.running) {
            return false;
        }

        if (this.limitsHit()) {
            return false;
        }

        if (this.openTrades.size >= this.settings.maxConcurrentTrades) {
            return false;
        }

        if (this.openTrades.has(symbol)) {
            return false;
        }

        const cooldown = this.cooldownUntil.get(symbol) ?? 0;

        if (Date.now() < cooldown) {
            return false;
        }

        return true;
    }

    private calculateStake(): number {
        const base = Number(this.settings.stake) || 0.35;
        let stake = base;

        if (this.settings.martingaleEnabled) {
            const steps = Math.min(this.stats.lossStreak, Math.max(0, this.settings.maxMartingaleSteps));
            const multiplier = Math.max(1.01, this.settings.martingaleMultiplier);
            stake = base * Math.pow(multiplier, steps);
        }

        if (this.settings.maxStake > 0) {
            stake = Math.min(stake, this.settings.maxStake);
        }

        return Number(stake.toFixed(2));
    }

    private async scan() {
        if (!this.running || !this.api || this.scanning) {
            return;
        }

        this.scanning = true;
        this.emit();

        try {
            const symbols = this.getSymbols();

            for (const symbol of symbols) {
                if (!this.running) {
                    break;
                }

                if (!this.canTrade(symbol.symbol)) {
                    continue;
                }

                try {
                    const ticks = await this.api.getTickHistory(symbol.symbol, 300);
                    const quotes = ticks.map(tick => tick.quote);
                    const decimals = pipToDecimals(symbol.pip);

                    const candidates = this.settings.tradeCategories
                        .map(category => analyzeMarket(category, quotes, decimals))
                        .filter(result => result.contractType && result.confidence >= this.settings.minConfidence)
                        .filter(
                            result =>
                                result.category !== 'rise_fall' ||
                                this.settings.maxVolatility <= 0 ||
                                result.volatility <= this.settings.maxVolatility
                        );

                    if (!candidates.length) {
                        continue;
                    }

                    candidates.sort((a, b) => b.confidence - a.confidence);
                    const best = candidates[0];

                    this.log(
                        'info',
                        `${symbol.display_name || symbol.symbol}: ${best.contractType}${
                            best.barrier !== null ? `(${best.barrier})` : ''
                        } | conf ${(best.confidence * 100).toFixed(1)}% | ${best.reason}`
                    );

                    await this.executeTrade(symbol, quotes, decimals, best);
                } catch (error: any) {
                    this.log('warn', `Scan failed for ${symbol.symbol}: ${error.message}`);
                }

                await sleep(this.settings.scanBatchDelayMs);
            }
        } finally {
            this.scanning = false;
            this.emit();
        }
    }

    private async executeTrade(
        symbol: DerivActiveSymbol,
        quotes: number[],
        decimals: number,
        analysis: AnalysisResult
    ) {
        if (!this.api || !analysis.contractType) {
            return;
        }

        const stake = this.calculateStake();
        const entry = quotes[quotes.length - 1] ?? 0;

        if (!entry) {
            return;
        }

        const { payload, duration, durationUnit } = buildProposalPayload(
            symbol.symbol,
            this.settings.currency,
            stake,
            analysis,
            this.settings
        );

        try {
            const proposalResponse = await this.api.requestProposal(payload);
            const proposal = proposalResponse?.proposal;

            if (!proposal?.id || !proposal.ask_price || !proposal.payout) {
                this.log('warn', `Proposal unavailable for ${symbol.symbol} ${analysis.contractType}.`);
                return;
            }

            const askPrice = Number(proposal.ask_price);
            const payout = Number(proposal.payout);
            const payoutRatio = payout / askPrice;
            const breakEven = askPrice / payout;
            const projectedEdge = analysis.confidence - breakEven;

            if (this.settings.requireProfitProjection && projectedEdge < this.settings.minProjectedEdge) {
                this.log(
                    'warn',
                    `Skipping ${symbol.symbol} ${analysis.contractType}: projected edge ${(
                        projectedEdge * 100
                    ).toFixed(2)}% is below the minimum required.`
                );
                return;
            }

            if (this.settings.mode === 'live' && this.authorized) {
                await this.executeLiveTrade(symbol.symbol, entry, stake, decimals, analysis, proposal);
            } else {
                await this.executePaperTrade(symbol.symbol, entry, stake, decimals, analysis, payoutRatio, duration, durationUnit);
            }
        } catch (error: any) {
            this.log('warn', `Proposal request failed for ${symbol.symbol}: ${error.message}`);
        }
    }

    private async executeLiveTrade(
        symbol: string,
        entry: number,
        stake: number,
        decimals: number,
        analysis: AnalysisResult,
        proposal: any
    ) {
        if (!this.api || !analysis.contractType) {
            return;
        }

        try {
            const buyResponse = await this.api.buyProposal(proposal.id, proposal.ask_price);
            const contractId = buyResponse?.buy?.contract_id;

            if (!contractId) {
                this.log('warn', `Live buy failed for ${symbol}.`);
                return;
            }

            const trade: LiveTrade = {
                id: String(contractId),
                symbol,
                category: analysis.category,
                contractType: analysis.contractType,
                barrier: analysis.barrier,
                direction: analysis.direction,
                stake,
                entry: Number(proposal.spot || entry),
                decimals,
                createdAt: Date.now(),
                mode: 'live',
                contractId: String(contractId),
            };

            this.openTrades.set(symbol, trade);

            const unsubscribe = this.api.addProposalOpenContractListener(poc => {
                this.onLiveContractUpdate(symbol, poc);
            });

            this.liveUnsubscribes.set(trade.id, unsubscribe);

            this.log(
                'success',
                `LIVE ${analysis.contractType}${
                    analysis.barrier !== null ? `(${analysis.barrier})` : ''
                } opened on ${symbol} stake=${stake} contract=${contractId}`
            );

            this.emit();
        } catch (error: any) {
            this.log('error', `Live trade failed on ${symbol}: ${error.message}`);
        }
    }

    private async executePaperTrade(
        symbol: string,
        entry: number,
        stake: number,
        decimals: number,
        analysis: AnalysisResult,
        payoutRatio: number,
        duration: number,
        durationUnit: DurationUnit
    ) {
        if (!this.api || !analysis.contractType) {
            return;
        }

        const id = `paper_${Date.now()}_${symbol}`;

        const trade: PaperTrade = {
            id,
            symbol,
            category: analysis.category,
            contractType: analysis.contractType,
            barrier: analysis.barrier,
            direction: analysis.direction,
            stake,
            entry,
            decimals,
            createdAt: Date.now(),
            mode: 'paper',
            duration,
            durationUnit,
            payoutRatio,
        };

        if (trade.durationUnit === 't') {
            trade.remainingTicks = Math.max(1, Number(trade.duration) || 1);
        } else {
            const ms = trade.durationUnit === 'm' ? Number(trade.duration) * 60000 : Number(trade.duration) * 1000;
            trade.expiresAt = Date.now() + ms;
        }

        this.openTrades.set(symbol, trade);

        this.log(
            'info',
            `PAPER ${analysis.contractType}${
                analysis.barrier !== null ? `(${analysis.barrier})` : ''
            } opened on ${symbol} stake=${stake} entry=${entry}`
        );

        await this.monitorPaperTrade(trade);
        this.emit();
    }

    private async monitorPaperTrade(trade: PaperTrade) {
        if (!this.api) {
            return;
        }

        try {
            await this.api.subscribeTicks(trade.symbol);
        } catch {
            // If subscription fails, the safety timeout below will settle the trade.
        }

        const unsubscribe = this.api.addTickListener((tick: DerivTick) => {
            if (tick.symbol !== trade.symbol) {
                return;
            }

            const current = this.openTrades.get(trade.symbol);

            if (!current || current.id !== trade.id) {
                unsubscribe();
                return;
            }

            if (trade.durationUnit === 't') {
                if (typeof trade.remainingTicks !== 'number') {
                    trade.remainingTicks = 1;
                }

                trade.remainingTicks -= 1;

                if (trade.remainingTicks > 0) {
                    return;
                }
            } else {
                if (Date.now() < (trade.expiresAt ?? 0)) {
                    return;
                }
            }

            const exit = tick.quote;
            let win: boolean;

            if (trade.category === 'rise_fall') {
                win = trade.direction === 'CALL' ? exit > trade.entry : exit < trade.entry;
            } else {
                const digit = lastDigitOf(exit, trade.decimals);
                win = isDigitContractWin(trade.contractType, trade.barrier, digit);
            }

            const profit = win ? trade.stake * (trade.payoutRatio - 1) : -trade.stake;

            this.settleTrade(trade.symbol, win, profit, 'paper-expiry');
            unsubscribe();
            this.paperUnsubscribes.delete(trade.id);
        });

        this.paperUnsubscribes.set(trade.id, unsubscribe);

        const safetyTimeout =
            trade.durationUnit === 't' ? 120000 : Math.max(5000, (trade.expiresAt ?? Date.now()) - Date.now() + 30000);

        setTimeout(() => {
            const current = this.openTrades.get(trade.symbol);

            if (current && current.id === trade.id) {
                this.settleTrade(trade.symbol, false, -trade.stake, 'paper-timeout');
                unsubscribe();
                this.paperUnsubscribes.delete(trade.id);
            }
        }, safetyTimeout);
    }

    private onLiveContractUpdate(symbol: string, poc: any) {
        const trade = this.openTrades.get(symbol);

        if (!trade || trade.mode !== 'live') {
            return;
        }

        if (poc.contract_id !== trade.contractId) {
            return;
        }

        if (poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost') {
            const profit = Number(poc.profit ?? 0);
            const win = profit > 0;

            this.settleTrade(symbol, win, profit, `live-${poc.status || 'closed'}`);
        }
    }

    private settleTrade(symbol: string, win: boolean, profit: number, reason: string) {
        const trade = this.openTrades.get(symbol);

        if (!trade) {
            return;
        }

        this.openTrades.delete(symbol);

        if (trade.mode === 'live') {
            const unsubscribe = this.liveUnsubscribes.get(trade.id);

            if (unsubscribe) {
                unsubscribe();
                this.liveUnsubscribes.delete(trade.id);
            }
        } else {
            const unsubscribe = this.paperUnsubscribes.get(trade.id);

            if (unsubscribe) {
                unsubscribe();
                this.paperUnsubscribes.delete(trade.id);
            }
        }

        if (win) {
            this.stats.wins += 1;
            this.stats.lossStreak = 0;
        } else {
            this.stats.losses += 1;
            this.stats.lossStreak += 1;
        }

        this.stats.net += profit;
        this.stats.dailyNet += profit;

        if (
            this.settings.martingaleEnabled &&
            !win &&
            this.stats.lossStreak > this.settings.maxMartingaleSteps
        ) {
            this.log('warn', 'Martingale max steps reached. Resetting stake sequence.');
            this.stats.lossStreak = 0;
        }

        this.cooldownUntil.set(symbol, Date.now() + this.settings.cooldownMs);

        this.log(
            win ? 'success' : 'warn',
            `${trade.mode.toUpperCase()} ${trade.contractType}${
                trade.barrier !== null ? `(${trade.barrier})` : ''
            } ${win ? 'won' : 'lost'} on ${symbol} | P/L ${profit.toFixed(2)} | ${reason}`
        );

        this.limitsHit();
        this.emit();
    }
}

export const aiEngine = new AIBotEngine();
