import { DerivAPI, DerivActiveSymbol, DerivContractSpec, DerivTick } from './deriv-api';
import {
    analyzeMarket,
    AnalysisResult,
    ContractType,
    TradeCategory,
    pipToDecimals,
    inferDecimalsFromQuotes,
    lastDigitOf,
} from './analysis';

export type AutoTraderMode = 'paper' | 'live';
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

export const SYNTHETIC_SYMBOL_PRESETS: { value: string; label: string }[] = [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
];

// CRITICAL FIX: Fallback list ensures the bot always has markets to scan, even if Deriv throttles the active_symbols API
export const FALLBACK_SYNTHETIC_SYMBOLS: DerivActiveSymbol[] = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
    'BOOM1000', 'BOOM500', 'CRASH1000', 'CRASH500',
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
].map(symbol => ({ symbol, display_name: symbol, market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 }));

export type AutoTraderSettings = {
    mode: AutoTraderMode; appId: string; apiToken: string; stake: number; currency: string; duration: number; durationUnit: DurationUnit;
    minConfidence: number; maxVolatility: number; maxConcurrentTrades: number; dailyLossLimit: number; takeProfit: number;
    martingaleEnabled: boolean; martingaleMultiplier: number; maxMartingaleSteps: number; maxStake: number; requireProfitProjection: boolean;
    minProjectedEdge: number; symbolsOverride: string; maxSymbols: number; scanIntervalMs: number; scanBatchDelayMs: number; cooldownMs: number;
    enabledMarkets: string[]; tradeCategories: TradeCategory[];
};

export type AutoTraderStats = {
    wins: number; losses: number; net: number; dailyNet: number; open: number; lossStreak: number; sessionStart: number; day: string;
    scanCount: number; tradesOpened: number; lastScanAt: number | null; lastScanSummary: string; signalsFound: number; proposalsRequested: number;
    proposalsRejectedByBroker: number; skippedBelowEdge: number; skippedContractUnavailable: number;
};

export type AutoTraderLog = { time: string; level: 'info' | 'warn' | 'error' | 'success'; message: string; };

type BaseTrade = { id: string; symbol: string; category: TradeCategory; contractType: ContractType; barrier: number | null; direction: 'CALL' | 'PUT' | null; stake: number; entry: number; decimals: number; createdAt: number; mode: AutoTraderMode; };
type PaperTrade = BaseTrade & { mode: 'paper'; duration: number; durationUnit: DurationUnit; payoutRatio: number; remainingTicks?: number; expiresAt?: number; };
type LiveTrade = BaseTrade & { mode: 'live'; contractId: string; };
type OpenTrade = PaperTrade | LiveTrade;

export const DEFAULT_AUTOTRADER_SETTINGS: AutoTraderSettings = {
    mode: 'paper', appId: '1089', apiToken: '', stake: 1.0, currency: 'USD', duration: 5, durationUnit: 't',
    minConfidence: 0.58, // FIXED: Lowered from 0.62 to allow valid signals to trigger
    maxVolatility: 45, maxConcurrentTrades: 3, dailyLossLimit: 50, takeProfit: 100,
    martingaleEnabled: false, martingaleMultiplier: 2, maxMartingaleSteps: 3, maxStake: 50,
    requireProfitProjection: true, minProjectedEdge: 0.015, symbolsOverride: '', maxSymbols: 0,
    scanIntervalMs: 5000, scanBatchDelayMs: 250, cooldownMs: 15000,
    enabledMarkets: ['synthetic_index'], tradeCategories: ['rise_fall', 'even_odd', 'over_under', 'matches_differs']
};

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isDigitContractWin(contractType: ContractType, barrier: number | null, digit: number): boolean {
    switch (contractType) {
        case 'DIGITEVEN': return digit % 2 === 0;
        case 'DIGITODD': return digit % 2 === 1;
        case 'DIGITOVER': return barrier !== null && digit > barrier;
        case 'DIGITUNDER': return barrier !== null && digit < barrier;
        case 'DIGITMATCH': return barrier !== null && digit === barrier;
        case 'DIGITDIFF': return barrier !== null && digit !== barrier;
        default: return false;
    }
}

function resolveDuration(desiredValue: number, desiredUnit: DurationUnit, spec: DerivContractSpec | undefined): { value: number; unit: DurationUnit } {
    if (!spec || !spec.minDuration) return { value: desiredValue, unit: desiredUnit };
    const min = spec.minDuration;
    const max = spec.maxDuration && spec.maxDuration.unit === min.unit ? spec.maxDuration : min;
    if (min.unit === desiredUnit) {
        const value = Math.min(Math.max(desiredValue, min.value), Math.max(max.value, min.value));
        return { value, unit: desiredUnit };
    }
    return { value: min.value, unit: (min.unit as DurationUnit) ?? desiredUnit };
}

function buildProposalPayload(symbol: string, currency: string, stake: number, analysis: AnalysisResult, settings: AutoTraderSettings, spec: DerivContractSpec | undefined): { payload: Record<string, unknown>; duration: number; durationUnit: DurationUnit } {
    const isDigit = analysis.category !== 'rise_fall';
    const desiredValue = isDigit ? Math.min(10, Math.max(1, Math.round(settings.duration))) : settings.duration;
    const desiredUnit: DurationUnit = isDigit ? 't' : settings.durationUnit;
    const resolved = resolveDuration(desiredValue, desiredUnit, spec);
    const payload: Record<string, unknown> = { amount: stake, basis: 'stake', contract_type: analysis.contractType, currency, duration: resolved.value, duration_unit: resolved.unit, symbol, product_type: 'basic' };
    if (analysis.barrier !== null && analysis.barrier !== undefined) payload.barrier = String(analysis.barrier);
    return { payload, duration: resolved.value, durationUnit: resolved.unit };
}

class AutoTraderEngine extends EventTarget {
    private api: DerivAPI | null = null;
    private settings: AutoTraderSettings = { ...DEFAULT_AUTOTRADER_SETTINGS };
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private scanning = false;
    private running = false;
    private connected = false;
    private authorized = false;
    private logs: AutoTraderLog[] = [];
    private stats: AutoTraderStats = { wins: 0, losses: 0, net: 0, dailyNet: 0, open: 0, lossStreak: 0, sessionStart: Date.now(), day: new Date().toDateString(), scanCount: 0, tradesOpened: 0, lastScanAt: null, lastScanSummary: 'Not scanned yet.', signalsFound: 0, proposalsRequested: 0, proposalsRejectedByBroker: 0, skippedBelowEdge: 0, skippedContractUnavailable: 0 };
    private contractsCache = new Map<string, Map<ContractType, DerivContractSpec>>();
    private activeSymbols: DerivActiveSymbol[] = [];
    private openTrades = new Map<string, OpenTrade>();
    private cooldownUntil = new Map<string, number>();
    private paperUnsubscribes = new Map<string, () => void>();
    private liveUnsubscribes = new Map<string, () => void>();

    constructor() { super(); this.loadSettings(); }

    private loadSettings() {
        try {
            const raw = localStorage.getItem('ai-bot-settings');
            if (!raw) return;
            const saved = JSON.parse(raw);
            this.settings = { ...DEFAULT_AUTOTRADER_SETTINGS, ...saved, enabledMarkets: Array.isArray(saved.enabledMarkets) && saved.enabledMarkets.length ? saved.enabledMarkets : DEFAULT_AUTOTRADER_SETTINGS.enabledMarkets, tradeCategories: Array.isArray(saved.tradeCategories) && saved.tradeCategories.length ? saved.tradeCategories : DEFAULT_AUTOTRADER_SETTINGS.tradeCategories, apiToken: '' };
        } catch { this.settings = { ...DEFAULT_AUTOTRADER_SETTINGS }; }
    }

    private saveSettings() { try { const { apiToken, ...rest } = this.settings; localStorage.setItem('ai-bot-settings', JSON.stringify(rest)); } catch {} }

    getState() { return { settings: { ...this.settings }, stats: { ...this.stats, open: this.openTrades.size }, logs: [...this.logs], openTrades: Array.from(this.openTrades.values()), running: this.running, scanning: this.scanning, connected: this.connected, authorized: this.authorized, symbolCount: this.activeSymbols.length }; }
    private emit() { this.dispatchEvent(new CustomEvent('state', { detail: this.getState() })); }
    private log(level: AutoTraderLog['level'], message: string) { this.logs.unshift({ time: new Date().toLocaleTimeString(), level, message }); this.logs = this.logs.slice(0, 150); this.emit(); }

    updateSettings(patch: Partial<AutoTraderSettings>) { this.settings = { ...this.settings, ...patch }; this.saveSettings(); this.emit(); }

    async start(patch: Partial<AutoTraderSettings> = {}) {
        this.updateSettings(patch);
        this.stop(false);
        this.contractsCache.clear();
        if (this.api) this.api.close();
        if (!this.settings.tradeCategories.length) this.settings.tradeCategories = ['rise_fall'];
        if (!this.settings.enabledMarkets.length) this.settings.enabledMarkets = ['synthetic_index'];

        this.api = new DerivAPI(this.settings.appId || '1089');
        this.api.addEventListener('close', () => { if (this.authorized) { this.authorized = false; this.log('warn', 'Connection dropped. Reconnecting — Live trading paused.'); this.emit(); } this.connected = false; this.emit(); });
        this.api.addEventListener('reconnected', () => { this.connected = true; this.log('info', 'Reconnected to Deriv.'); this.emit(); });
        this.api.addEventListener('reauthorized', () => { this.authorized = true; this.log('success', 'Re-authorized. Live trading resumed.'); this.emit(); });
        this.api.addEventListener('reauthorize-failed', (event: any) => { this.authorized = false; this.settings.mode = 'paper'; this.log('error', `Re-authorization failed: ${event?.detail || 'unknown'}. Switched to paper.`); this.emit(); });
        this.api.addEventListener('active-symbols-attempt', (event: any) => { const { label, count, error } = event?.detail ?? {}; if (error) this.log('warn', `active_symbols [${label}] failed: ${error}`); else this.log('info', `active_symbols [${label}]: ${count} symbol(s).`); });

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
            if (!this.settings.apiToken) { this.settings.mode = 'paper'; this.log('warn', 'Live mode requires an API token. Switched to paper.'); }
            else {
                try { await this.api.authorize(this.settings.apiToken); this.authorized = true; this.log('success', 'Live trading authorized.'); }
                catch (error: any) { this.settings.mode = 'paper'; this.authorized = false; this.log('error', `Authorization failed: ${error.message}. Switched to paper.`); }
            }
        } else { this.authorized = false; }

        try {
            const symbols = await this.api.activeSymbols();
            const marketBreakdown = new Map<string, number>();
            symbols.forEach(symbol => { marketBreakdown.set(symbol.market, (marketBreakdown.get(symbol.market) ?? 0) + 1); });
            const breakdownText = Array.from(marketBreakdown.entries()).map(([market, count]) => `${market}:${count}`).join(', ') || '(none)';
            this.log('info', `Deriv returned ${symbols.length} total symbol(s) across markets: ${breakdownText}.`);

            this.activeSymbols = symbols.filter(symbol => this.settings.enabledMarkets.includes(symbol.market) && !symbol.is_trading_suspended && (symbol.exchange_is_open === undefined || symbol.exchange_is_open === 1));
            this.log('info', `Loaded ${this.activeSymbols.length} tradable markets.`);

            // CRITICAL FIX: Fallback to hardcoded synthetics if API returns empty (throttling)
            if (!this.activeSymbols.length) {
                this.log('warn', 'API returned 0 active symbols (likely App ID throttling). Injecting comprehensive synthetic fallback to ensure continuous scanning...');
                this.activeSymbols = FALLBACK_SYNTHETIC_SYMBOLS;
            }
        } catch (error: any) {
            this.log('error', `Could not load active symbols: ${error.message}. Falling back to synthetic list.`);
            this.activeSymbols = FALLBACK_SYNTHETIC_SYMBOLS;
        }

        this.running = true;
        this.saveSettings();
        this.scanTimer = setInterval(() => { void this.scan(); }, this.settings.scanIntervalMs);
        this.log('success', `AI bot started in ${this.settings.mode.toUpperCase()} mode.`);
        void this.scan();
        this.emit();
    }

    stop(emitLog = true) {
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
        if (this.running && emitLog) this.log('warn', 'AI bot stopped. Open trades will continue to settle.');
        this.running = false;
        this.emit();
    }

    private resetDailyIfNeeded() {
        const today = new Date().toDateString();
        if (this.stats.day !== today) { this.stats.day = today; this.stats.dailyNet = 0; this.log('info', 'Daily risk counters reset.'); }
    }

    private limitsHit(): boolean {
        this.resetDailyIfNeeded();
        if (this.settings.dailyLossLimit > 0 && this.stats.dailyNet <= -this.settings.dailyLossLimit) { this.log('warn', 'Daily loss limit reached. Bot stopped.'); this.stop(false); return true; }
        if (this.settings.takeProfit > 0 && this.stats.dailyNet >= this.settings.takeProfit) { this.log('success', 'Daily take profit reached. Bot stopped.'); this.stop(false); return true; }
        return false;
    }

    private getSymbols(): DerivActiveSymbol[] {
        const override = this.settings.symbolsOverride.split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
        let list = [...this.activeSymbols];
        if (override.length) {
            const known = list.filter(item => override.includes(item.symbol));
            const knownCodes = new Set(known.map(item => item.symbol));
            const unresolved = override.filter(code => !knownCodes.has(code));
            const synthesized: DerivActiveSymbol[] = unresolved.map(code => ({ symbol: code, display_name: code, market: this.settings.enabledMarkets[0] ?? 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 }));
            if (synthesized.length) this.log('warn', `${synthesized.length} Symbol Override entr${synthesized.length === 1 ? 'y' : 'ies'} (${unresolved.join(', ')}) weren't in active_symbols — trying directly.`);
            list = [...known, ...synthesized];
        }
        if (this.settings.maxSymbols > 0) list = list.slice(0, this.settings.maxSymbols);
        return list;
    }

    private canTrade(symbol: string): boolean {
        if (!this.running || this.limitsHit() || this.openTrades.size >= this.settings.maxConcurrentTrades || this.openTrades.has(symbol)) return false;
        return Date.now() >= (this.cooldownUntil.get(symbol) ?? 0);
    }

    private calculateStake(): number {
        const base = Number(this.settings.stake) || 0.35;
        let stake = base;
        if (this.settings.martingaleEnabled) {
            const steps = Math.min(this.stats.lossStreak, Math.max(0, this.settings.maxMartingaleSteps));
            stake = base * Math.pow(Math.max(1.01, this.settings.martingaleMultiplier), steps);
        }
        return Number((this.settings.maxStake > 0 ? Math.min(stake, this.settings.maxStake) : stake).toFixed(2));
    }

    private async reloadActiveSymbols() {
        if (!this.api) return;
        try {
            const symbols = await this.api.activeSymbols();
            this.activeSymbols = symbols.filter(symbol => this.settings.enabledMarkets.includes(symbol.market) && !symbol.is_trading_suspended && (symbol.exchange_is_open === undefined || symbol.exchange_is_open === 1));
            if (this.activeSymbols.length) this.log('success', `Retry succeeded — loaded ${this.activeSymbols.length} tradable market(s).`);
            else this.log('error', 'Retry also returned 0 symbols. Check network or register your own App ID.');
            this.emit();
        } catch (error: any) { this.log('error', `Retry failed: ${error.message}`); }
    }

    private async scan() {
        if (!this.running || !this.api || this.scanning) return;
        this.scanning = true;
        this.emit();
        const symbols = this.getSymbols();
        if (!symbols.length) {
            this.stats.scanCount += 1; this.stats.lastScanAt = Date.now();
            this.stats.lastScanSummary = 'No tradable symbols matched your Markets selection / Symbol Override / trading hours.';
            this.log('warn', `Scan #${this.stats.scanCount}: 0 symbols available.`);
            this.scanning = false; this.emit(); return;
        }

        let scannedSymbols = 0, tradesThisCycle = 0;
        let topSeen: { symbol: string; contractType: ContractType; barrier: number | null; confidence: number } | null = null;

        try {
            for (const symbol of symbols) {
                if (!this.running) break;
                let quotes: number[] = [];
                let decimals = 2;
                try {
                    const ticks = await this.api.getTickHistory(symbol.symbol, 300);
                    quotes = ticks.map(tick => tick.quote);
                    decimals = symbol.pip ? pipToDecimals(symbol.pip) : inferDecimalsFromQuotes(quotes);
                    scannedSymbols += 1;
                } catch (error: any) {
                    this.log('warn', `Could not fetch ticks for ${symbol.symbol}: ${error.message}`);
                    await sleep(this.settings.scanBatchDelayMs);
                    continue;
                }

                const results = this.settings.tradeCategories.map(category => analyzeMarket(category, quotes, decimals));
                results.forEach(result => {
                    if (result.contractType && (!topSeen || result.confidence > topSeen.confidence)) {
                        topSeen = { symbol: symbol.display_name || symbol.symbol, contractType: result.contractType, barrier: result.barrier, confidence: result.confidence };
                    }
                });

                const candidates = results.filter(result => result.contractType && result.confidence >= this.settings.minConfidence).filter(result => result.category !== 'rise_fall' || this.settings.maxVolatility <= 0 || result.volatility <= this.settings.maxVolatility);

                if (candidates.length && this.canTrade(symbol.symbol)) {
                    candidates.sort((a, b) => b.confidence - a.confidence);
                    const best = candidates[0];
                    this.log('info', `${symbol.display_name || symbol.symbol}: signal ${best.contractType}${best.barrier !== null ? `(${best.barrier})` : ''} | conf ${(best.confidence * 100).toFixed(1)}% | ${best.reason}`);
                    try {
                        const opened = await this.executeTrade(symbol, quotes, decimals, best);
                        if (opened) tradesThisCycle += 1;
                    } catch (error: any) { this.log('warn', `Trade execution failed for ${symbol.symbol}: ${error.message}`); }
                }
                await sleep(this.settings.scanBatchDelayMs);
            }
        } finally {
            this.stats.scanCount += 1; this.stats.lastScanAt = Date.now(); this.stats.tradesOpened += tradesThisCycle;
            const seen = topSeen as { symbol: string; contractType: ContractType; barrier: number | null; confidence: number } | null;
            const summary = seen ? `strongest signal ${seen.symbol} ${seen.contractType}${seen.barrier !== null ? `(${seen.barrier})` : ''} @ ${(seen.confidence * 100).toFixed(1)}%` : 'no directional signal found';
            this.stats.lastScanSummary = `${scannedSymbols} symbol(s) checked, ${tradesThisCycle} trade(s) opened — ${summary}.`;
            this.log('info', `Scan #${this.stats.scanCount} complete: ${this.stats.lastScanSummary}`);
            this.scanning = false; this.emit();
        }
    }

    private async getContractSpecs(symbol: string): Promise<Map<ContractType, DerivContractSpec> | null> {
        if (!this.api) return null;
        const cached = this.contractsCache.get(symbol);
        if (cached) return cached;
        try {
            const specs = await this.api.contractsFor(symbol, this.settings.currency || 'USD');
            const map = new Map<ContractType, DerivContractSpec>();
            specs.forEach(spec => { map.set(spec.contractType as ContractType, spec); });
            this.contractsCache.set(symbol, map);
            return map;
        } catch (error: any) {
            this.log('warn', `Could not load contract list for ${symbol}: ${error.message}.`);
            return null;
        }
    }

    private async executeTrade(symbol: DerivActiveSymbol, quotes: number[], decimals: number, analysis: AnalysisResult): Promise<boolean> {
        if (!this.api || !analysis.contractType) return false;
        this.stats.signalsFound += 1;
        const stake = this.calculateStake();
        const entry = quotes[quotes.length - 1] ?? 0;
        if (!entry) return false;

        const specs = await this.getContractSpecs(symbol.symbol);
        const spec = specs?.get(analysis.contractType);
        if (specs && !spec) { this.stats.skippedContractUnavailable += 1; this.log('warn', `${symbol.symbol}: ${analysis.contractType} is not offered. Skipping.`); return false; }

        const { payload, duration, durationUnit } = buildProposalPayload(symbol.symbol, this.settings.currency, stake, analysis, this.settings, spec);
        this.stats.proposalsRequested += 1;

        try {
            const proposalResponse = await this.api.requestProposal(payload);
            const proposal = proposalResponse?.proposal;
            if (!proposal?.id || !proposal.ask_price || !proposal.payout) {
                this.stats.proposalsRejectedByBroker += 1;
                this.log('warn', `${symbol.symbol} ${analysis.contractType}: broker returned no priceable proposal. Skipping.`);
                return false;
            }

            const askPrice = Number(proposal.ask_price);
            const payout = Number(proposal.payout);
            const breakEven = askPrice / payout;
            const projectedEdge = analysis.confidence - breakEven;

            if (this.settings.requireProfitProjection && projectedEdge < this.settings.minProjectedEdge) {
                this.stats.skippedBelowEdge += 1;
                this.log('warn', `Skipping ${symbol.symbol}: projected edge ${(projectedEdge * 100).toFixed(2)}% is below minimum (${(this.settings.minProjectedEdge * 100).toFixed(2)}%).`);
                return false;
            }

            if (this.settings.mode === 'live' && this.authorized) {
                return await this.executeLiveTrade(symbol.symbol, entry, stake, decimals, analysis, proposal);
            }
            return await this.executePaperTrade(symbol.symbol, entry, stake, decimals, analysis, payout / askPrice, duration, durationUnit);
        } catch (error: any) {
            this.stats.proposalsRejectedByBroker += 1;
            this.log('warn', `Proposal request failed for ${symbol.symbol}: ${error.message}`);
            return false;
        }
    }

    private async executeLiveTrade(symbol: string, entry: number, stake: number, decimals: number, analysis: AnalysisResult, proposal: any): Promise<boolean> {
        if (!this.api || !analysis.contractType) return false;
        try {
            const buyResponse = await this.api.buyProposal(proposal.id, proposal.ask_price);
            const contractId = buyResponse?.buy?.contract_id;
            if (!contractId) { this.stats.proposalsRejectedByBroker += 1; this.log('warn', `Live buy failed for ${symbol}: no contract id.`); return false; }

            const trade: LiveTrade = { id: String(contractId), symbol, category: analysis.category, contractType: analysis.contractType, barrier: analysis.barrier, direction: analysis.direction, stake, entry: Number(proposal.spot || entry), decimals, createdAt: Date.now(), mode: 'live', contractId: String(contractId) };
            this.openTrades.set(symbol, trade);

            // CRITICAL FIX: Subscribe to the contract so we get updates and it settles!
            await this.api.subscribeProposalOpenContract(String(contractId));
            const unsubscribe = this.api.addProposalOpenContractListener(poc => { this.onLiveContractUpdate(symbol, poc); });
            this.liveUnsubscribes.set(trade.id, unsubscribe);

            this.log('success', `LIVE ${analysis.contractType}${analysis.barrier !== null ? `(${analysis.barrier})` : ''} opened on ${symbol} stake=${stake} contract=${contractId}`);
            this.emit();
            return true;
        } catch (error: any) {
            this.stats.proposalsRejectedByBroker += 1;
            this.log('error', `Live trade failed on ${symbol}: ${error.message}`);
            return false;
        }
    }

    private async executePaperTrade(symbol: string, entry: number, stake: number, decimals: number, analysis: AnalysisResult, payoutRatio: number, duration: number, durationUnit: DurationUnit): Promise<boolean> {
        if (!this.api || !analysis.contractType) return false;
        const id = `paper_${Date.now()}_${symbol}`;
        const trade: PaperTrade = { id, symbol, category: analysis.category, contractType: analysis.contractType, barrier: analysis.barrier, direction: analysis.direction, stake, entry, decimals, createdAt: Date.now(), mode: 'paper', duration, durationUnit, payoutRatio };
        if (trade.durationUnit === 't') trade.remainingTicks = Math.max(1, Number(trade.duration) || 1);
        else trade.expiresAt = Date.now() + (trade.durationUnit === 'm' ? Number(trade.duration) * 60000 : Number(trade.duration) * 1000);
        
        this.openTrades.set(symbol, trade);
        this.log('info', `PAPER ${analysis.contractType}${analysis.barrier !== null ? `(${analysis.barrier})` : ''} opened on ${symbol} stake=${stake} entry=${entry}`);
        await this.monitorPaperTrade(trade);
        this.emit();
        return true;
    }

    private async monitorPaperTrade(trade: PaperTrade) {
        if (!this.api) return;
        try { await this.api.subscribeTicks(trade.symbol); } catch {}
        const unsubscribe = this.api.addTickListener((tick: DerivTick) => {
            if (tick.symbol !== trade.symbol) return;
            const current = this.openTrades.get(trade.symbol);
            if (!current || current.id !== trade.id) { unsubscribe(); return; }
            if (trade.durationUnit === 't') {
                if (typeof trade.remainingTicks !== 'number') trade.remainingTicks = 1;
                trade.remainingTicks -= 1;
                if (trade.remainingTicks > 0) return;
            } else { if (Date.now() < (trade.expiresAt ?? 0)) return; }
            const exit = tick.quote;
            const win = trade.category === 'rise_fall' ? (trade.direction === 'CALL' ? exit > trade.entry : exit < trade.entry) : isDigitContractWin(trade.contractType, trade.barrier, lastDigitOf(exit, trade.decimals));
            const profit = win ? trade.stake * (trade.payoutRatio - 1) : -trade.stake;
            this.settleTrade(trade.symbol, win, profit, 'paper-expiry');
            unsubscribe(); this.paperUnsubscribes.delete(trade.id);
        });
        this.paperUnsubscribes.set(trade.id, unsubscribe);
        const safetyTimeout = trade.durationUnit === 't' ? 120000 : Math.max(5000, (trade.expiresAt ?? Date.now()) - Date.now() + 30000);
        setTimeout(() => { const current = this.openTrades.get(trade.symbol); if (current && current.id === trade.id) { this.settleTrade(trade.symbol, false, -trade.stake, 'paper-timeout'); unsubscribe(); this.paperUnsubscribes.delete(trade.id); } }, safetyTimeout);
    }

    private onLiveContractUpdate(symbol: string, poc: any) {
        const trade = this.openTrades.get(symbol);
        if (!trade || trade.mode !== 'live' || poc.contract_id !== trade.contractId) return;
        if (poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost') {
            const profit = Number(poc.profit ?? 0);
            this.settleTrade(symbol, profit > 0, profit, `live-${poc.status || 'closed'}`);
        }
    }

    private settleTrade(symbol: string, win: boolean, profit: number, reason: string) {
        const trade = this.openTrades.get(symbol);
        if (!trade) return;
        this.openTrades.delete(symbol);
        const unsubscribe = trade.mode === 'live' ? this.liveUnsubscribes.get(trade.id) : this.paperUnsubscribes.get(trade.id);
        if (unsubscribe) { unsubscribe(); (trade.mode === 'live' ? this.liveUnsubscribes : this.paperUnsubscribes).delete(trade.id); }
        if (win) { this.stats.wins += 1; this.stats.lossStreak = 0; } else { this.stats.losses += 1; this.stats.lossStreak += 1; }
        this.stats.net += profit; this.stats.dailyNet += profit;
        if (this.settings.martingaleEnabled && !win && this.stats.lossStreak > this.settings.maxMartingaleSteps) { this.log('warn', 'Martingale max steps reached. Resetting.'); this.stats.lossStreak = 0; }
        this.cooldownUntil.set(symbol, Date.now() + this.settings.cooldownMs);
        this.log(win ? 'success' : 'warn', `${trade.mode.toUpperCase()} ${trade.contractType}${trade.barrier !== null ? `(${trade.barrier})` : ''} ${win ? 'won' : 'lost'} on ${symbol} | P/L ${profit.toFixed(2)} | ${reason}`);
        this.limitsHit(); this.emit();
    }
}

export const autoTrader = new AutoTraderEngine();
