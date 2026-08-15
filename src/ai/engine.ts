import { DerivAPI, DerivActiveSymbol, DerivTick } from './deriv-api';
import { analyzeQuotes, AnalysisResult } from './analysis';

export type AIBotMode = 'paper' | 'live';
export type DurationUnit = 't' | 's' | 'm';

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
    direction: 'CALL' | 'PUT';
    stake: number;
    entry: number;
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
};

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

        this.logs = this.logs.slice(0, 120);
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
                    this.log('success', 'Live trading authorized. Use extreme caution.');
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
                    symbol.market === 'synthetic_index' &&
                    !symbol.is_trading_suspended
            );

            this.log(
                'info',
                `Loaded ${this.activeSymbols.length} synthetic index markets.`
            );
        } catch (error: any) {
            this.log('error', `Could not load active symbols: ${error.message}`);
        }

        this.running = true;
        this.saveSettings();

        this.scanTimer = setInterval(() => {
            void this.scan();
        }, this.settings.scanIntervalMs);

        this.log('success', `AI bot started in ${this.settings.mode.toUpperCase()} mode.`);
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

        if (
            this.settings.dailyLossLimit > 0 &&
            this.stats.dailyNet <= -this.settings.dailyLossLimit
        ) {
            this.log('warn', 'Daily loss limit reached. Bot stopped.');
            this.stop(false);
            return true;
        }

        if (
            this.settings.takeProfit > 0 &&
            this.stats.dailyNet >= this.settings.takeProfit
        ) {
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

    private isFavorable(analysis: AnalysisResult): boolean {
        if (!analysis.direction) {
            return false;
        }

        if (analysis.confidence < this.settings.minConfidence) {
            return false;
        }

        if (
            this.settings.maxVolatility > 0 &&
            analysis.volatility > this.settings.maxVolatility
        ) {
            return false;
        }

        const assumedPayoutRatio = 1.95;
        const projectedEdge = analysis.confidence * assumedPayoutRatio - 1;

        if (
            this.settings.requireProfitProjection &&
            projectedEdge < this.settings.minProjectedEdge
        ) {
            return false;
        }

        return true;
    }

    private calculateStake(): number {
        const base = Number(this.settings.stake) || 0.35;
        let stake = base;

        if (this.settings.martingaleEnabled) {
            const steps = Math.min(
                this.stats.lossStreak,
                Math.max(0, this.settings.maxMartingaleSteps)
            );

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
                    const ticks = await this.api.getTickHistory(symbol.symbol, 90);
                    const quotes = ticks.map(tick => tick.quote);
                    const analysis = analyzeQuotes(quotes);

                    if (this.isFavorable(analysis)) {
                        this.log(
                            'info',
                            `${symbol.display_name || symbol.symbol}: ${analysis.direction} | conf ${(
                                analysis.confidence * 100
                            ).toFixed(1)}% | ${analysis.reason}`
                        );

                        await this.executeTrade(symbol.symbol, quotes, analysis);
                    }
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
        symbol: string,
        quotes: number[],
        analysis: AnalysisResult
    ) {
        if (!this.api || !analysis.direction) {
            return;
        }

        const stake = this.calculateStake();
        const entry = quotes[quotes.length - 1] ?? 0;

        if (!entry) {
            return;
        }

        if (this.settings.mode === 'live' && this.authorized) {
            await this.executeLiveTrade(symbol, entry, stake, analysis);
        } else {
            await this.executePaperTrade(symbol, entry, stake, analysis);
        }
    }

    private async executeLiveTrade(
        symbol: string,
        entry: number,
        stake: number,
        analysis: AnalysisResult
    ) {
        if (!this.api || !analysis.direction) {
            return;
        }

        try {
            const proposalResponse = await this.api.send({
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: analysis.direction,
                currency: this.settings.currency,
                duration: this.settings.duration,
                duration_unit: this.settings.durationUnit,
                symbol,
                product_type: 'basic',
            });

            const proposal = proposalResponse?.proposal;

            if (!proposal?.id || !proposal.ask_price || !proposal.payout) {
                this.log('warn', `Live proposal failed for ${symbol}.`);
                return;
            }

            const breakEven = Number(proposal.ask_price) / Number(proposal.payout);

            if (
                this.settings.requireProfitProjection &&
                analysis.confidence <= breakEven + this.settings.minProjectedEdge
            ) {
                this.log(
                    'warn',
                    `Skipping live trade on ${symbol}: edge too small after payout.`
                );
                return;
            }

            const buyResponse = await this.api.send({
                buy: proposal.id,
                price: proposal.ask_price,
            });

            const contractId = buyResponse?.buy?.contract_id;

            if (!contractId) {
                this.log('warn', `Live buy failed for ${symbol}.`);
                return;
            }

            const trade: LiveTrade = {
                id: String(contractId),
                symbol,
                direction: analysis.direction,
                stake,
                entry: Number(proposal.spot || entry),
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
                `LIVE ${analysis.direction} opened on ${symbol} stake=${stake} contract=${contractId}`
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
        analysis: AnalysisResult
    ) {
        if (!this.api || !analysis.direction) {
            return;
        }

        const id = `paper_${Date.now()}_${symbol}`;

        const trade: PaperTrade = {
            id,
            symbol,
            direction: analysis.direction,
            stake,
            entry,
            createdAt: Date.now(),
            mode: 'paper',
            duration: this.settings.duration,
            durationUnit: this.settings.durationUnit,
            payoutRatio: 1.95,
        };

        if (trade.durationUnit === 't') {
            trade.remainingTicks = Math.max(1, Number(trade.duration) || 1);
        } else {
            const ms =
                trade.durationUnit === 'm'
                    ? Number(trade.duration) * 60000
                    : Number(trade.duration) * 1000;

            trade.expiresAt = Date.now() + ms;
        }

        this.openTrades.set(symbol, trade);

        this.log(
            'info',
            `PAPER ${analysis.direction} opened on ${symbol} stake=${stake} entry=${entry}`
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
            // If subscription fails, timeout will settle trade safely.
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
            let win = false;

            if (trade.direction === 'CALL') {
                win = exit > trade.entry;
            } else {
                win = exit < trade.entry;
            }

            const profit = win
                ? trade.stake * (trade.payoutRatio - 1)
                : -trade.stake;

            this.settleTrade(trade.symbol, win, profit, 'paper-expiry');
            unsubscribe();
            this.paperUnsubscribes.delete(trade.id);
        });

        this.paperUnsubscribes.set(trade.id, unsubscribe);

        const safetyTimeout =
            trade.durationUnit === 't'
                ? 120000
                : Math.max(5000, (trade.expiresAt ?? Date.now()) - Date.now() + 30000);

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

    private settleTrade(
        symbol: string,
        win: boolean,
        profit: number,
        reason: string
    ) {
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
            `${trade.mode.toUpperCase()} ${trade.direction} ${win ? 'won' : 'lost'} on ${symbol} | P/L ${profit.toFixed(
                2
            )} | ${reason}`
        );

        this.limitsHit();
        this.emit();
    }
}

export const aiEngine = new AIBotEngine();
