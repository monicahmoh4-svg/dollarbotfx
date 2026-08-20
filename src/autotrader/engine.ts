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

export const SYNTHETIC_INDICES: DerivActiveSymbol[] = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'BOOM300', display_name: 'Boom 300 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'BOOM500', display_name: 'Boom 500 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'BOOM1000', display_name: 'Boom 1000 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'CRASH300', display_name: 'Crash 300 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'CRASH500', display_name: 'Crash 500 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'CRASH1000', display_name: 'Crash 1000 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'JD10', display_name: 'Jump 10 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'JD25', display_name: 'Jump 25 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'JD50', display_name: 'Jump 50 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'JD75', display_name: 'Jump 75 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
    { symbol: 'JD100', display_name: 'Jump 100 Index', market: 'synthetic_index', exchange_is_open: 1, is_trading_suspended: 0 },
];

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
    mode: 'paper', appId: '1089', apiToken: '', stake: 1.0, currency: 'USDC', duration: 5, durationUnit: 't',
    minConfidence: 0.65, maxVolatility: 100, maxConcurrentTrades: 5, dailyLossLimit: 100, takeProfit: 200,
    martingaleEnabled: false, martingaleMultiplier: 2, maxMartingaleSteps: 3, maxStake: 50,
    requireProfitProjection: true, minProjectedEdge: 0.02, symbolsOverride: '', maxSymbols: 0,
    scanIntervalMs: 3000, scanBatchDelayMs: 200, cooldownMs: 10000,
    enabledMarkets: ['synthetic_index'], tradeCategories: ['rise_fall']
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

class AutoTraderEngine extends EventTarget {
    private api: DerivAPI | null = null;
    private settings: AutoTraderSettings = { ...DEFAULT_AUTOTRADER_SETTINGS };
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private scanning = false; private running = false; private connected = false; private authorized = false;
    private logs: AutoTraderLog[] = [];
    private stats: AutoTraderStats = { wins: 0, losses: 0, net: 0, dailyNet: 0, open: 0, lossStreak: 0, sessionStart: Date.now(), day: new Date().toDateString(), scanCount: 0, tradesOpened: 0, lastScanAt: null, lastScanSummary: 'Not scanned yet.', signalsFound: 0, proposalsRequested: 0, proposalsRejectedByBroker: 0, skippedBelowEdge: 0, skippedContractUnavailable: 0 };
    private contractsCache = new Map<string, Map<ContractType, DerivContractSpec>>();
    private activeSymbols: DerivActiveSymbol[] = SYNTHETIC_INDICES;
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
            this.settings = { 
                ...DEFAULT_AUTOTRADER_SETTINGS, 
                ...saved, 
                currency: saved.currency || 'USDC', // Default to USDC for modern Deriv accounts
                enabledMarkets: ['synthetic_index'],
                tradeCategories: Array.isArray(saved.tradeCategories) && saved.tradeCategories.length ? saved.tradeCategories : DEFAULT_AUTOTRADER_SETTINGS.tradeCategories, 
                apiToken: '' 
            };
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

        this.api = new DerivAPI(this.settings.appId || '1089');
        this.api.addEventListener('close', () => { if (this.authorized) { this.authorized = false; this.log('warn', 'Connection dropped. Reconnecting...'); } this.connected = false; this.emit(); });
        this.api.addEventListener('reconnected', () => { this.connected = true; this.log('info', 'Reconnected to Deriv.'); this.emit(); });
        this.api.addEventListener('reauthorized', () => { this.authorized = true; this.log('success', 'Re-authorized.'); this.emit(); });
        this.api.addEventListener('reauthorize-failed', (event: any) => { this.authorized = false; this.settings.mode = 'paper'; this.log('error', `Re-authorization failed: ${event?.detail || 'unknown'}`); this.emit(); });

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

        if (this.settings.apiToken) {
            try {
                await this.api.authorize(this.settings.apiToken);
                this.authorized = true;
                this.log('success', `Authorized (${this.settings.mode === 'live' ? 'Live' : 'Paper'} mode).`);
            } catch (error: any) {
                this.authorized = false;
                this.log('error', `Authorization failed: ${error.message}`);
                if (this.settings.mode === 'live') {
                    this.settings.mode = 'paper';
                    this.log('warn', 'Switched to paper mode.');
                }
            }
        }

        this.running = true;
        this.saveSettings();
        this.scanTimer = setInterval(() => { void this.scan(); }, this.settings.scanIntervalMs);
        this.log('success', `AI bot started - Scanning ${SYNTHETIC_INDICES.length} synthetic indices.`);
        void this.scan();
        this.emit();
    }

    stop(emitLog = true) {
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
        if (this.running && emitLog) this.log('warn', 'AI bot stopped.');
        this.running = false;
        this.emit();
    }

    private resetDailyIfNeeded() {
        const today = new Date().toDateString();
        if (this.stats.day !== today) { this.stats.day = today; this.stats.dailyNet = 0; this.log('info', 'Daily counters reset.'); }
    }

    private limitsHit(): boolean {
        this.resetDailyIfNeeded();
        if (this.settings.dailyLossLimit > 0 && this.stats.dailyNet <= -this.settings.dailyLossLimit) { this.log('warn', 'Daily loss limit reached.'); this.stop(false); return true; }
        if (this.settings.takeProfit > 0 && this.stats.dailyNet >= this.settings.takeProfit) { this.log('success', 'Daily take profit reached.'); this.stop(false); return true; }
        return false;
    }

    private canTrade(symbol: string): boolean {
        if (!this.running || this.limitsHit() || this.openTrades.size >= this.settings.maxConcurrentTrades || this.openTrades.has(symbol)) return false;
        return Date.now() >= (this.cooldownUntil.get(symbol) ?? 0);
    }

    private calculateStake(): number {
        const base = Number(this.settings.stake) || 1.0;
        let stake = base;
        if (this.settings.martingaleEnabled) {
            const steps = Math.min(this.stats.lossStreak, Math.max(0, this.settings.maxMartingaleSteps));
            stake = base * Math.pow(Math.max(1.01, this.settings.martingaleMultiplier), steps);
        }
        return Number((this.settings.maxStake > 0 ? Math.min(stake, this.settings.maxStake) : stake).toFixed(2));
    }

    private async scan() {
        if (!this.running || !this.api || this.scanning) return;
        this.scanning = true;
        this.emit();

        let scannedSymbols = 0, tradesThisCycle = 0;

        try {
            for (const symbol of SYNTHETIC_INDICES) {
                if (!this.running) break;
                let quotes: number[] = [];
                let decimals = 2;
                try {
                    const ticks = await this.api.getTickHistory(symbol.symbol, 300);
                    quotes = ticks.map(tick => tick.quote);
                    decimals = symbol.pip ? pipToDecimals(symbol.pip) : inferDecimalsFromQuotes(quotes);
                    scannedSymbols += 1;
                } catch (error: any) {
                    continue;
                }

                const results = this.settings.tradeCategories.map(category => analyzeMarket(category, quotes, decimals));
                const candidates = results.filter(result => result.contractType && result.confidence >= this.settings.minConfidence);

                if (candidates.length && this.canTrade(symbol.symbol)) {
                    candidates.sort((a, b) => b.confidence - a.confidence);
                    const best = candidates[0];
                    this.log('info', `${symbol.display_name}: ${best.contractType} @ ${(best.confidence * 100).toFixed(1)}% | ${best.reason}`);
                    try {
                        const opened = await this.executeTrade(symbol, quotes, decimals, best);
                        if (opened) tradesThisCycle += 1;
                    } catch (error: any) { this.log('warn', `Trade failed: ${error.message}`); }
                }
                await sleep(this.settings.scanBatchDelayMs);
            }
        } finally {
            this.stats.scanCount += 1; this.stats.lastScanAt = Date.now(); this.stats.tradesOpened += tradesThisCycle;
            this.stats.lastScanSummary = `${scannedSymbols} symbols scanned, ${tradesThisCycle} trades opened.`;
            this.log('info', `Scan #${this.stats.scanCount}: ${this.stats.lastScanSummary}`);
            this.scanning = false; this.emit();
        }
    }

    private async getContractSpecs(symbol: string): Promise<Map<ContractType, DerivContractSpec> | null> {
        if (!this.api) return null;
        const cached = this.contractsCache.get(symbol);
        if (cached) return cached;
        
        // CRITICAL FIX: Try multiple currencies because Deriv Demo accounts are now often USDC or eUSDC
        const currenciesToTry = [
            this.settings.currency, 
            'USDC', 
            'USD', 
            'eUSDC', 
            'EUR', 
            undefined
        ].filter((v, i, a) => v && a.indexOf(v) === i);
        
        for (const currency of currenciesToTry) {
            try {
                console.log(`[DEBUG] Trying contractsFor for ${symbol} with currency: ${currency || 'NONE'}`);
                const specs = await this.api.contractsFor(symbol, currency);
                console.log(`[DEBUG] contractsFor returned ${specs.length} specs for ${symbol}`);
                if (specs.length > 0) {
                    const map = new Map<ContractType, DerivContractSpec>();
                    specs.forEach(spec => { map.set(spec.contractType as ContractType, spec); });
                    this.contractsCache.set(symbol, map);
                    console.log(`[DEBUG] Successfully cached specs for ${symbol}. Types:`, Array.from(map.keys()));
                    return map;
                }
            } catch (e: any) {
                console.warn(`[DEBUG] contractsFor failed for ${symbol} with currency ${currency}:`, e.message);
            }
        }
        console.error(`[DEBUG] FAILED to get specs for ${symbol} after trying all currencies.`);
        return null;
    }

    private async executeTrade(symbol: DerivActiveSymbol, quotes: number[], decimals: number, analysis: AnalysisResult): Promise<boolean> {
        console.log(`[EXECUTE] Started for ${symbol.symbol}. contractType: ${analysis.contractType}`);
        
        if (!this.api) { console.error(`[EXECUTE] this.api is null`); return false; }
        if (!analysis.contractType) { console.error(`[EXECUTE] analysis.contractType is null`); return false; }
        
        this.stats.signalsFound += 1;
        this.emit();
        
        const stake = this.calculateStake();
        const entry = quotes.length > 0 ? quotes[quotes.length - 1] : 0;
        
        if (!entry) {
            console.error(`[EXECUTE] Aborting: Invalid entry price (${entry}).`);
            this.log('error', `Aborting trade for ${symbol.symbol}: Invalid entry price (${entry}).`);
            return false;
        }

        const specsMap = await this.getContractSpecs(symbol.symbol);
        if (!specsMap) {
            this.stats.skippedContractUnavailable += 1;
            this.emit();
            console.error(`[EXECUTE] specsMap is null for ${symbol.symbol}.`);
            this.log('error', `Could not fetch contract specs for ${symbol.symbol}. Check browser console.`);
            return false;
        }
        
        const spec = specsMap.get(analysis.contractType);
        if (!spec) { 
            this.stats.skippedContractUnavailable += 1; 
            this.emit();
            console.error(`[EXECUTE] spec not found for ${analysis.contractType}. Available:`, Array.from(specsMap.keys()));
            this.log('error', `${analysis.contractType} not available for ${symbol.symbol}.`);
            return false; 
        }

        const duration = spec.minDuration?.value ?? 5;
        const durationUnit = (spec.minDuration?.unit ?? 't') as DurationUnit;

        const payload: Record<string, unknown> = { 
            amount: stake, basis: 'stake', contract_type: analysis.contractType, 
            currency: this.settings.currency || 'USDC',
            duration, duration_unit: durationUnit, symbol: symbol.symbol, product_type: 'basic' 
        };
        
        if (analysis.barrier !== null && analysis.barrier !== undefined) {
            payload.barrier = String(analysis.barrier);
        }

        console.log(`[EXECUTE] Payload:`, JSON.stringify(payload));
        this.stats.proposalsRequested += 1;
        this.emit();

        try {
            console.log(`[EXECUTE] Sending requestProposal...`);
            const proposalResponse = await this.api.requestProposal(payload);
            console.log(`[EXECUTE] Response:`, JSON.stringify(proposalResponse));
            
            const proposal = proposalResponse?.proposal;
            if (!proposal?.id || !proposal.ask_price || !proposal.payout) {
                this.stats.proposalsRejectedByBroker += 1;
                this.emit();
                console.error(`[EXECUTE] Proposal rejected: missing id, ask_price, or payout.`);
                this.log('error', `Broker returned no priceable proposal for ${symbol.symbol}.`);
                return false;
            }

            const askPrice = Number(proposal.ask_price);
            const payout = Number(proposal.payout);
            const breakEven = askPrice / payout;
            const projectedEdge = analysis.confidence - breakEven;

            if (this.settings.requireProfitProjection && projectedEdge < this.settings.minProjectedEdge) {
                this.stats.skippedBelowEdge += 1;
                this.emit();
                console.log(`[EXECUTE] Skipped: edge ${projectedEdge} < min ${this.settings.minProjectedEdge}`);
                this.log('warn', `Skipping ${symbol.symbol}: projected edge too low.`);
                return false;
            }

            console.log(`[EXECUTE] Edge check passed. Executing trade...`);
            if (this.settings.mode === 'live' && this.authorized) {
                return await this.executeLiveTrade(symbol.symbol, entry, stake, decimals, analysis, proposal);
            }
            return await this.executePaperTrade(symbol.symbol, entry, stake, decimals, analysis, payout / askPrice, duration, durationUnit);
        } catch (error: any) {
            this.stats.proposalsRejectedByBroker += 1;
            this.emit();
            console.error(`[EXECUTE] REJECTED:`, error);
            this.log('error', `REJECTED: ${error.message}`);
            return false;
        }
    }

    private async executeLiveTrade(symbol: string, entry: number, stake: number, decimals: number, analysis: AnalysisResult, proposal: any): Promise<boolean> {
        if (!this.api || !analysis.contractType) return false;
        try {
            const buyResponse = await this.api.buyProposal(proposal.id, proposal.ask_price);
            const contractId = buyResponse?.buy?.contract_id;
            if (!contractId) return false;

            const trade: LiveTrade = { id: String(contractId), symbol, category: analysis.category, contractType: analysis.contractType, barrier: analysis.barrier, direction: analysis.direction, stake, entry: Number(proposal.spot || entry), decimals, createdAt: Date.now(), mode: 'live', contractId: String(contractId) };
            this.openTrades.set(symbol, trade);

            await this.api.subscribeProposalOpenContract(String(contractId));
            const unsubscribe = this.api.addProposalOpenContractListener(poc => { this.onLiveContractUpdate(symbol, poc); });
            this.liveUnsubscribes.set(trade.id, unsubscribe);

            this.log('success', `LIVE ${analysis.contractType} opened | stake=${stake}`);
            this.emit();
            return true;
        } catch (error: any) {
            this.log('error', `Live trade failed: ${error.message}`);
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
        this.log('success', `PAPER ${analysis.contractType} opened | stake=${stake}`);
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
        this.cooldownUntil.set(symbol, Date.now() + this.settings.cooldownMs);
        this.log(win ? 'success' : 'warn', `${trade.mode.toUpperCase()} ${trade.contractType} ${win ? 'WON' : 'LOST'} | P/L ${profit.toFixed(2)}`);
        this.limitsHit(); this.emit();
    }
}

export const autoTrader = new AutoTraderEngine();
