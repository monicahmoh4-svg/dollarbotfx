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
];

// Currencies that Deriv supports for synthetic indices
export const SUPPORTED_SYNTHETIC_CURRENCIES = ['USD', 'USDC', 'eUSDC', 'UST', 'BTC', 'ETH'];

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
    minConfidence: 0.58, maxVolatility: 100, maxConcurrentTrades: 3, dailyLossLimit: 100, takeProfit: 200,
    martingaleEnabled: false, martingaleMultiplier: 2, maxMartingaleSteps: 3, maxStake: 50,
    requireProfitProjection: false, minProjectedEdge: 0.01, symbolsOverride: '', maxSymbols: 0,
    scanIntervalMs: 5000, scanBatchDelayMs: 300, cooldownMs: 15000,
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

function parseDuration(raw: unknown): { value: number; unit: string } | null {
    if (typeof raw !== 'string') return null;
    const match = raw.trim().match(/^(\d+)\s*([a-zA-Z]+)$/);
    if (!match) return null;
    return { value: Number(match[1]), unit: match[2] };
}

// Helper to extract error message from Deriv API response
function extractErrorMessage(response: any): string | null {
    if (!response) return null;
    if (typeof response === 'object') {
        if (response.error?.message) return response.error.message;
        if (response.error) return String(response.error);
    }
    return null;
}

class AutoTraderEngine extends EventTarget {
    private client: any = null;
    private apiInstance: any = null;
    private fallbackApi: DerivAPI | null = null;
    private settings: AutoTraderSettings = { ...DEFAULT_AUTOTRADER_SETTINGS };
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private scanning = false; private running = false; private connected = false; private authorized = false;
    private logs: AutoTraderLog[] = [];
    private stats: AutoTraderStats = { wins: 0, losses: 0, net: 0, dailyNet: 0, open: 0, lossStreak: 0, sessionStart: Date.now(), day: new Date().toDateString(), scanCount: 0, tradesOpened: 0, lastScanAt: null, lastScanSummary: 'Not scanned yet.', signalsFound: 0, proposalsRequested: 0, proposalsRejectedByBroker: 0, skippedBelowEdge: 0, skippedContractUnavailable: 0 };
    private contractsCache = new Map<string, Map<ContractType, DerivContractSpec>>();
    private activeSymbols: DerivActiveSymbol[] = SYNTHETIC_INDICES;
    private openTrades = new Map<string, OpenTrade>();
    private cooldownUntil = new Map<string, number>();
    private liveUnsubscribes = new Map<string, () => void>();
    private paperMonitors = new Map<string, ReturnType<typeof setInterval>>();
    private accountCurrency: string = 'USD';
    private currencyMismatchDetected = false;

    constructor() { super(); this.loadSettings(); }

    private loadSettings() {
        try {
            const raw = localStorage.getItem('ai-bot-settings');
            if (!raw) return;
            const saved = JSON.parse(raw);
            this.settings = { 
                ...DEFAULT_AUTOTRADER_SETTINGS, 
                ...saved, 
                currency: saved.currency || 'USD',
                enabledMarkets: ['synthetic_index'],
                tradeCategories: Array.isArray(saved.tradeCategories) && saved.tradeCategories.length ? saved.tradeCategories : DEFAULT_AUTOTRADER_SETTINGS.tradeCategories, 
                apiToken: ''
            };
        } catch { this.settings = { ...DEFAULT_AUTOTRADER_SETTINGS }; }
    }

    private saveSettings() { try { const { apiToken, ...rest } = this.settings; localStorage.setItem('ai-bot-settings', JSON.stringify(rest)); } catch {} }
    
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
            symbolCount: this.activeSymbols.length 
        }; 
    }
    
    private emit() { this.dispatchEvent(new CustomEvent('state', { detail: this.getState() })); }
    
    private log(level: AutoTraderLog['level'], message: string) { 
        console.log(`[BOT ${level.toUpperCase()}] ${message}`);
        this.logs.unshift({ time: new Date().toLocaleTimeString(), level, message }); 
        this.logs = this.logs.slice(0, 150); 
        this.emit(); 
    }
    
    updateSettings(patch: Partial<AutoTraderSettings>) { 
        this.settings = { ...this.settings, ...patch }; 
        this.saveSettings(); 
        this.emit(); 
    }

    async start(patch: Partial<AutoTraderSettings> & { client?: any; apiInstance?: any } = {}) {
        console.log('[ENGINE] === START CALLED ===');
        
        try {
            this.updateSettings(patch);
            this.stop(false);
            this.contractsCache.clear();
            this.currencyMismatchDetected = false;

            this.client = patch.client;
            this.apiInstance = patch.apiInstance;

            if (this.client?.is_logged_in) {
                this.connected = true;
                this.authorized = true;
                
                // CRITICAL: Detect account currency and check compatibility
                this.accountCurrency = this.client?.currency || 
                                      this.client?.accounts?.[this.client?.loginid]?.currency || 
                                      'USD';
                
                console.log('[ENGINE] Detected account currency:', this.accountCurrency);
                
                const isSupported = SUPPORTED_SYNTHETIC_CURRENCIES.includes(this.accountCurrency);
                
                if (!isSupported) {
                    this.log('error', `⚠️ CRITICAL: Your Deriv account currency is ${this.accountCurrency}`);
                    this.log('error', `⚠️ Synthetic Indices are ONLY supported in: ${SUPPORTED_SYNTHETIC_CURRENCIES.join(', ')}`);
                    this.log('error', `⚠️ Your account (${this.accountCurrency}) cannot trade synthetic indices.`);
                    this.log('error', `💡 SOLUTION: Create a new Deriv account with USD or USDC currency at app.deriv.com`);
                    this.log('error', `💡 Steps: Log in → Click account icon → "Add or manage account" → Add new account → Choose USD`);
                    this.currencyMismatchDetected = true;
                    // Still allow scanning (for signal detection), but warn about trading
                }
                
                if (this.apiInstance && typeof this.apiInstance.send === 'function') {
                    try {
                        this.log('info', 'Testing App Builder API...');
                        await Promise.race([
                            this.apiInstance.send({ ping: 1 }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), 10000))
                        ]);
                        this.log('success', '✓ App Builder API is working');
                    } catch (e: any) {
                        this.log('warn', `App Builder API test failed: ${e.message}. Setting up fallback...`);
                        await this.setupFallbackApi();
                    }
                } else {
                    this.log('warn', 'No App Builder API found. Setting up fallback...');
                    await this.setupFallbackApi();
                }
                
                this.log('success', '✓ Bot is AUTHORIZED and ready to trade');
            } else {
                this.authorized = false;
                this.log('error', '✗ Not logged in');
                this.running = false;
                this.emit();
                return;
            }

            this.running = true;
            this.saveSettings();
            this.scanTimer = setInterval(() => { void this.scan(); }, this.settings.scanIntervalMs);
            this.log('success', `✓ AI bot started - Scanning ${SYNTHETIC_INDICES.length} synthetic indices`);
            
            setTimeout(() => void this.scan(), 100);
            this.emit();
        } catch (error: any) {
            console.error('[ENGINE] Start failed:', error);
            this.log('error', `Failed to start bot: ${error.message}`);
            this.running = false;
            this.emit();
        }
    }

    private async setupFallbackApi() {
        try {
            this.log('info', 'Setting up fallback API...');
            this.fallbackApi = new DerivAPI(this.settings.appId || '1089');
            await this.fallbackApi.connect();
            this.log('success', '✓ Fallback API connected');
        } catch (e: any) {
            this.log('error', `Fallback API failed: ${e.message}`);
        }
    }

    private async sendRequest<T = any>(payload: Record<string, unknown>): Promise<T> {
        console.log('[ENGINE] sendRequest payload:', JSON.stringify(payload));
        
        if (this.apiInstance && typeof this.apiInstance.send === 'function') {
            try {
                console.log('[ENGINE] Trying apiInstance.send()...');
                const response = await Promise.race([
                    this.apiInstance.send(payload),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('apiInstance timeout (15s)')), 15000))
                ]);
                
                // CRITICAL: Check if response contains an error object
                const errorMsg = extractErrorMessage(response);
                if (errorMsg) {
                    console.error('[ENGINE] apiInstance returned error:', errorMsg);
                    throw new Error(errorMsg);
                }
                
                console.log('[ENGINE] apiInstance response received');
                return response as T;
            } catch (e: any) {
                console.error('[ENGINE] apiInstance.send() FAILED:', e.message || String(e));
            }
        }

        if (this.apiInstance?.api && typeof this.apiInstance.api.send === 'function') {
            try {
                console.log('[ENGINE] Trying apiInstance.api.send()...');
                const response = await Promise.race([
                    this.apiInstance.api.send(payload),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('apiInstance.api timeout (15s)')), 15000))
                ]);
                
                const errorMsg = extractErrorMessage(response);
                if (errorMsg) {
                    console.error('[ENGINE] apiInstance.api returned error:', errorMsg);
                    throw new Error(errorMsg);
                }
                
                console.log('[ENGINE] apiInstance.api response received');
                return response as T;
            } catch (e: any) {
                console.error('[ENGINE] apiInstance.api.send() FAILED:', e.message || String(e));
            }
        }

        if (!this.fallbackApi) {
            console.log('[ENGINE] Fallback API is null. Setting it up now...');
            await this.setupFallbackApi();
        }

        if (this.fallbackApi) {
            try {
                console.log('[ENGINE] Trying fallback API...');
                const response = await this.fallbackApi.send(payload);
                console.log('[ENGINE] Fallback API response received');
                return response as T;
            } catch (e: any) {
                console.error('[ENGINE] Fallback API FAILED:', e.message || String(e));
            }
        }

        throw new Error(`All API methods failed for payload: ${JSON.stringify(payload)}`);
    }

    stop(emitLog = true) {
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
        this.paperMonitors.forEach(monitor => clearInterval(monitor));
        this.paperMonitors.clear();
        if (this.fallbackApi) { this.fallbackApi.close(); this.fallbackApi = null; }
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
        if (!this.running) return false;
        if (!this.authorized) return false;
        if (this.currencyMismatchDetected) return false; // Block trading if currency mismatch
        if (this.limitsHit()) return false;
        if (this.openTrades.size >= this.settings.maxConcurrentTrades) return false;
        if (this.openTrades.has(symbol)) return false;
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
        if (!this.running || this.scanning) return;
        
        console.log('[ENGINE] Starting scan...');
        this.scanning = true;
        this.emit();

        let scannedSymbols = 0, tradesThisCycle = 0, signalsThisCycle = 0;

        try {
            for (const symbol of SYNTHETIC_INDICES) {
                if (!this.running) break;
                let quotes: number[] = [];
                let decimals = 2;
                
                try {
                    const response = await this.sendRequest({ 
                        ticks_history: symbol.symbol, 
                        adjust_start_time: 1, 
                        count: 300, 
                        end: 'latest', 
                        style: 'ticks' 
                    });
                    
                    const prices = response?.history?.prices ?? [];
                    quotes = prices.map((p: any) => Number(p));
                    decimals = symbol.pip ? Math.round(-Math.log10(symbol.pip)) : inferDecimalsFromQuotes(quotes);
                    scannedSymbols += 1;
                } catch (error: any) {
                    this.log('warn', `Failed to fetch ticks for ${symbol.symbol}: ${error.message}`);
                    continue;
                }

                const results = this.settings.tradeCategories.map(category => {
                    try { return analyzeMarket(category, quotes, decimals); } catch { return null; }
                }).filter(r => r !== null) as AnalysisResult[];

                const candidates = results.filter(result => result.contractType && result.confidence >= this.settings.minConfidence);

                if (candidates.length > 0) {
                    signalsThisCycle += candidates.length;
                    this.stats.signalsFound += candidates.length;
                    candidates.sort((a, b) => b.confidence - a.confidence);
                    const best = candidates[0];
                    this.log('info', `📊 ${symbol.display_name}: ${best.contractType} @ ${(best.confidence * 100).toFixed(1)}%`);
                    
                    if (this.canTrade(symbol.symbol)) {
                        this.log('info', `🎯 Attempting trade on ${symbol.display_name}...`);
                        try {
                            const opened = await this.executeTrade(symbol, quotes, decimals, best);
                            if (opened) {
                                tradesThisCycle += 1;
                                this.log('success', `✓ Trade executed on ${symbol.display_name}`);
                            }
                        } catch (error: any) {
                            this.log('error', `Trade failed: ${error.message}`);
                        }
                    } else if (this.currencyMismatchDetected) {
                        // Only log this once per scan to avoid spam
                        if (this.stats.scanCount === 0) {
                            this.log('warn', `⚠️ Cannot trade ${symbol.display_name}: Account currency ${this.accountCurrency} not supported for synthetic indices`);
                        }
                    }
                }
                await sleep(this.settings.scanBatchDelayMs);
            }
        } catch (error: any) {
            this.log('error', `Scan error: ${error.message}`);
        } finally {
            this.stats.scanCount += 1; 
            this.stats.lastScanAt = Date.now(); 
            this.stats.tradesOpened += tradesThisCycle;
            this.stats.lastScanSummary = `${scannedSymbols} symbols scanned, ${signalsThisCycle} signals found, ${tradesThisCycle} trades opened.`;
            this.log('info', `✓ Scan #${this.stats.scanCount} complete`);
            this.scanning = false; 
            this.emit();
        }
    }

    private async getContractSpecs(symbol: string): Promise<Map<ContractType, DerivContractSpec> | null> {
        const cached = this.contractsCache.get(symbol);
        if (cached) return cached;
        
        // CRITICAL: If currency mismatch detected, don't even try - we know it will fail
        if (this.currencyMismatchDetected) {
            this.log('error', `Cannot fetch specs for ${symbol}: Account currency ${this.accountCurrency} not supported for synthetic indices`);
            return null;
        }
        
        // Try supported currencies in order of likelihood
        const currenciesToTry: (string | undefined)[] = [
            this.accountCurrency,  // Try account currency first
            undefined,              // Try without currency (defaults to account)
            'USD', 'USDC', 'eUSDC', 'UST'
        ].filter((v, i, a) => v !== undefined ? a.indexOf(v) === i : true);

        for (const curr of currenciesToTry) {
            try {
                const payload: Record<string, unknown> = { 
                    contracts_for: symbol, 
                    product_type: 'basic' 
                };
                if (curr) payload.currency = curr;
                
                const response = await this.sendRequest(payload);
                const available = response?.contracts_for?.available ?? [];
                
                if (available.length > 0) {
                    const map = new Map<ContractType, DerivContractSpec>();
                    available.forEach((item: any) => {
                        map.set(item.contract_type, {
                            contractType: item.contract_type,
                            minDuration: parseDuration(item.min_contract_duration),
                            maxDuration: parseDuration(item.max_contract_duration),
                        });
                    });
                    this.contractsCache.set(symbol, map);
                    return map;
                }
            } catch (e: any) {
                // Continue to next currency
            }
        }
        
        this.log('warn', `Could not fetch specs for ${symbol}`);
        return null;
    }

    private async executeTrade(symbol: DerivActiveSymbol, quotes: number[], decimals: number, analysis: AnalysisResult): Promise<boolean> {
        if (!this.authorized || !analysis.contractType) return false;
        
        // CRITICAL: Block trading if currency mismatch
        if (this.currencyMismatchDetected) {
            this.log('error', `Trade blocked: Account currency ${this.accountCurrency} not supported for synthetic indices`);
            return false;
        }
        
        const stake = this.calculateStake();
        const entry = quotes.length > 0 ? quotes[quotes.length - 1] : 0;
        if (!entry) return false;

        const specsMap = await this.getContractSpecs(symbol.symbol);
        if (!specsMap) {
            this.stats.skippedContractUnavailable += 1;
            this.emit();
            return false;
        }
        
        const spec = specsMap.get(analysis.contractType);
        if (!spec) { 
            this.stats.skippedContractUnavailable += 1; 
            this.emit();
            return false; 
        }

        const duration = spec.minDuration?.value ?? 5;
        const durationUnit = (spec.minDuration?.unit ?? 't') as DurationUnit;

        const payload: Record<string, unknown> = { 
            amount: stake, basis: 'stake', contract_type: analysis.contractType, 
            currency: this.accountCurrency || 'USD',
            duration, duration_unit: durationUnit, symbol: symbol.symbol, product_type: 'basic' 
        };
        if (analysis.barrier !== null) payload.barrier = String(analysis.barrier);

        this.stats.proposalsRequested += 1;
        this.emit();

        try {
            const response = await this.sendRequest({ proposal: 1, ...payload });
            const proposal = response?.proposal;
            
            if (!proposal?.id || !proposal.ask_price || !proposal.payout) {
                this.stats.proposalsRejectedByBroker += 1;
                this.emit();
                return false;
            }

            const askPrice = Number(proposal.ask_price);
            const payout = Number(proposal.payout);
            const breakEven = askPrice / payout;
            const projectedEdge = analysis.confidence - breakEven;

            this.log('info', `💰 Ask=${askPrice.toFixed(2)}, Payout=${payout.toFixed(2)}, Edge=${(projectedEdge*100).toFixed(2)}%`);

            if (this.settings.requireProfitProjection && projectedEdge < this.settings.minProjectedEdge) {
                this.stats.skippedBelowEdge += 1;
                this.emit();
                return false;
            }

            if (this.settings.mode === 'live') {
                const buyResponse = await this.sendRequest({ buy: proposal.id, price: askPrice });
                const contractId = buyResponse?.buy?.contract_id;
                if (!contractId) return false;

                const trade: LiveTrade = { 
                    id: String(contractId), symbol: symbol.symbol, category: analysis.category, 
                    contractType: analysis.contractType, barrier: analysis.barrier, direction: analysis.direction, 
                    stake, entry: Number(proposal.spot || entry), decimals, createdAt: Date.now(), 
                    mode: 'live', contractId: String(contractId) 
                };
                this.openTrades.set(symbol.symbol, trade);

                const monitor = setInterval(async () => {
                    try {
                        const pocResponse = await this.sendRequest({ proposal_open_contract: 1, contract_id: String(contractId) });
                        const poc = pocResponse?.proposal_open_contract;
                        if (poc && (poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost')) {
                            const profit = Number(poc.profit ?? 0);
                            this.settleTrade(symbol.symbol, profit > 0, profit, `live-${poc.status || 'closed'}`);
                            clearInterval(monitor);
                        }
                    } catch (e) {
                        console.error('[ENGINE] POC poll error:', e);
                    }
                }, 2000);
                this.liveUnsubscribes.set(trade.id, () => clearInterval(monitor));

                this.log('success', `🚀 LIVE ${analysis.contractType} opened | stake=${stake}`);
                this.emit();
                return true;
            } else {
                const id = `paper_${Date.now()}_${symbol.symbol}`;
                const trade: PaperTrade = { 
                    id, symbol: symbol.symbol, category: analysis.category, 
                    contractType: analysis.contractType, barrier: analysis.barrier, direction: analysis.direction, 
                    stake, entry, decimals, createdAt: Date.now(), mode: 'paper', 
                    duration, durationUnit, payoutRatio: payout / askPrice 
                };
                if (trade.durationUnit === 't') trade.remainingTicks = Math.max(1, Number(trade.duration) || 1);
                else trade.expiresAt = Date.now() + (trade.durationUnit === 'm' ? Number(trade.duration) * 60000 : Number(trade.duration) * 1000);
                
                this.openTrades.set(symbol.symbol, trade);
                this.log('success', `📝 PAPER ${analysis.contractType} opened | stake=${stake}`);
                
                const pollInterval = trade.durationUnit === 't' ? 500 : 1000;
                
                const monitor = setInterval(async () => {
                    const current = this.openTrades.get(trade.symbol);
                    if (!current || current.id !== trade.id) {
                        clearInterval(monitor);
                        return;
                    }
                    
                    try {
                        const tickResponse = await this.sendRequest({
                            ticks_history: trade.symbol,
                            adjust_start_time: 1,
                            count: 1,
                            end: 'latest',
                            style: 'ticks'
                        });
                        
                        const latestPrice = tickResponse?.history?.prices?.[0];
                        if (!latestPrice) return;
                        
                        const tick: DerivTick = {
                            symbol: trade.symbol,
                            quote: Number(latestPrice),
                            epoch: Date.now() / 1000
                        };
                        
                        if (trade.durationUnit === 't') {
                            if (typeof trade.remainingTicks !== 'number') trade.remainingTicks = 1;
                            trade.remainingTicks -= 1;
                            if (trade.remainingTicks > 0) return;
                        } else { 
                            if (Date.now() < (trade.expiresAt ?? 0)) return; 
                        }
                        
                        const win = trade.category === 'rise_fall' 
                            ? (trade.direction === 'CALL' ? tick.quote > trade.entry : tick.quote < trade.entry) 
                            : isDigitContractWin(trade.contractType, trade.barrier, lastDigitOf(tick.quote, trade.decimals));
                        const profit = win ? trade.stake * (trade.payoutRatio - 1) : -trade.stake;
                        this.settleTrade(trade.symbol, win, profit, 'paper-expiry');
                        clearInterval(monitor);
                    } catch (e) {
                        console.error('[ENGINE] Tick poll error:', e);
                    }
                }, pollInterval);
                
                this.paperMonitors.set(trade.id, monitor);
                this.emit();
                return true;
            }
        } catch (error: any) {
            this.stats.proposalsRejectedByBroker += 1;
            this.emit();
            this.log('error', `✗ REJECTED: ${error.message}`);
            return false;
        }
    }

    private settleTrade(symbol: string, win: boolean, profit: number, reason: string) {
        const trade = this.openTrades.get(symbol);
        if (!trade) return;
        this.openTrades.delete(symbol);
        
        const unsubscribe = trade.mode === 'live' ? this.liveUnsubscribes.get(trade.id) : null;
        if (unsubscribe) { unsubscribe(); this.liveUnsubscribes.delete(trade.id); }
        
        const monitor = this.paperMonitors.get(trade.id);
        if (monitor) { clearInterval(monitor); this.paperMonitors.delete(trade.id); }
        
        if (win) { this.stats.wins += 1; this.stats.lossStreak = 0; } else { this.stats.losses += 1; this.stats.lossStreak += 1; }
        this.stats.net += profit; this.stats.dailyNet += profit;
        this.cooldownUntil.set(symbol, Date.now() + this.settings.cooldownMs);
        this.log(win ? 'success' : 'warn', `${trade.mode.toUpperCase()} ${trade.contractType} ${win ? 'WON' : 'LOST'} | P/L ${profit.toFixed(2)}`);
        this.limitsHit(); this.emit();
    }
}

export const autoTrader = new AutoTraderEngine();
