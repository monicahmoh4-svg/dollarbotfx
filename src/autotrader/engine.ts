import { DerivAPI, DerivActiveSymbol, DerivContractSpec, DerivTick } from './deriv-api';
// Defensive namespace import: if this file is ever deployed out of sync with
// connection-status-stream.ts (e.g. only engine.ts gets redeployed), a missing
// named export becomes a silent no-op at runtime instead of a hard build
// failure like "export 'updateAccountBalance' was not found".
import * as ConnectionStream from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
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

export type AutoTraderSettings = {
    mode: AutoTraderMode; appId: string; apiToken: string; stake: number; currency: string; duration: number; durationUnit: DurationUnit;
    minConfidence: number; maxVolatility: number; maxConcurrentTrades: number; dailyLossLimit: number; takeProfit: number;
    martingaleEnabled: boolean; martingaleMultiplier: number; maxMartingaleSteps: number; maxStake: number; requireProfitProjection: boolean;
    minProjectedEdge: number; symbolsOverride: string; maxSymbols: number; scanIntervalMs: number; scanBatchDelayMs: number; cooldownMs: number;
    enabledMarkets: string[]; tradeCategories: TradeCategory[]; maxConsecutiveLosses: number;
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
    // Raised from 0.58 to match the stricter analysis.ts consensus thresholds.
    minConfidence: 0.65, maxVolatility: 100, maxConcurrentTrades: 3, dailyLossLimit: 100, takeProfit: 200,
    martingaleEnabled: false, martingaleMultiplier: 2, maxMartingaleSteps: 3, maxStake: 50,
    // requireProfitProjection is now ALWAYS enforced in code (see executeTrade) —
    // kept here only so existing UI toggles/settings storage don't break; setting
    // it to false no longer disables the underlying check.
    requireProfitProjection: true, minProjectedEdge: 0.03, symbolsOverride: '', maxSymbols: 0,
    scanIntervalMs: 5000, scanBatchDelayMs: 300, cooldownMs: 15000,
    enabledMarkets: ['synthetic_index'], tradeCategories: ['rise_fall'],
    maxConsecutiveLosses: 5,
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

class AutoTraderEngine extends EventTarget {
    private client: any = null;
    private api: DerivAPI | null = null;
    private apiInstance: any = null;
    private settings: AutoTraderSettings = { ...DEFAULT_AUTOTRADER_SETTINGS };
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private balanceTimer: ReturnType<typeof setInterval> | null = null;
    private scanning = false; private running = false; private connected = false; private authorized = false;
    private logs: AutoTraderLog[] = [];
    private stats: AutoTraderStats = { wins: 0, losses: 0, net: 0, dailyNet: 0, open: 0, lossStreak: 0, sessionStart: Date.now(), day: new Date().toDateString(), scanCount: 0, tradesOpened: 0, lastScanAt: null, lastScanSummary: 'Not scanned yet.', signalsFound: 0, proposalsRequested: 0, proposalsRejectedByBroker: 0, skippedBelowEdge: 0, skippedContractUnavailable: 0 };
    private contractsCache = new Map<string, Map<ContractType, DerivContractSpec>>();
    // Tracks consecutive-scan signal confirmation per symbol — see scan().
    private pendingSignals = new Map<string, { key: string; count: number }>();
    private activeSymbols: DerivActiveSymbol[] = SYNTHETIC_INDICES;
    private openTrades = new Map<string, OpenTrade>();
    private cooldownUntil = new Map<string, number>();
    private liveUnsubscribes = new Map<string, () => void>();
    private paperMonitors = new Map<string, ReturnType<typeof setInterval>>();

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
            this.pendingSignals.clear();

            this.client = patch.client;
            this.apiInstance = patch.apiInstance;

            if (this.client?.is_logged_in) {
                this.connected = true;
                this.authorized = true; // App Builder WS is already authorized via cookie
                
                // Try to extract token for our own DerivAPI instance as a fallback
                let token = '';
                if (typeof this.client.getToken === 'function') {
                    try { token = this.client.getToken(); } catch (e) {}
                }
                if ((!token || token === '') && this.client.loginid && this.client.accounts) {
                    try { token = this.client.accounts[this.client.loginid]?.token; } catch (e) {}
                }
                if ((!token || token === '') && this.client.loginid) {
                    try {
                        const stored = localStorage.getItem('client.accounts');
                        if (stored) {
                            const accounts = JSON.parse(stored);
                            token = accounts[this.client.loginid]?.token;
                        }
                    } catch (e) {}
                }

                if (token && token.length > 10) {
                    this.log('info', 'Initializing authorized API with account token...');
                    this.api = new DerivAPI(this.settings.appId || '1089');
                    await this.api.connect();
                    await this.api.authorize(token);
                    this.log('success', '✓ API authorized with account token. Ready to trade.');
                } else {
                    if (this.apiInstance && typeof this.apiInstance.send === 'function') {
                        this.log('success', '✓ Using App Builder API (Cookie Auth). Ready to trade.');
                    } else {
                        this.log('error', '✗ CRITICAL: No token found AND no valid App Builder API instance.');
                        this.running = false;
                        this.emit();
                        return;
                    }
                }
            } else {
                this.authorized = false;
                this.log('error', '✗ Not logged in. Please log in to your Deriv account.');
                this.running = false;
                this.emit();
                return;
            }

            this.running = true;
            this.saveSettings();
            if (this.settings.mode === 'live') {
                void this.refreshBalance(); // sync the true balance the moment the bot goes live
            }
            this.scanTimer = setInterval(() => { void this.scan(); }, this.settings.scanIntervalMs);
            if (this.settings.mode === 'live') {
                // Safety-net poll: re-syncs the displayed balance every 10s
                // regardless of trade/settlement events, so it can never drift
                // from the real account balance for long even if a push update
                // or event-triggered refresh is ever missed.
                this.balanceTimer = setInterval(() => { void this.refreshBalance(); }, 10000);
            }
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

    private async sendRequest<T = any>(payload: Record<string, unknown>): Promise<T> {
        // Method 1: Our own authorized DerivAPI (Token Auth)
        if (this.api) {
            return this.api.send<T>(payload);
        }
        
        // Method 2: App Builder's API instance (Cookie Auth)
        if (this.apiInstance && typeof this.apiInstance.send === 'function') {
            try {
                console.log('[ENGINE] Sending via App Builder API:', JSON.stringify(payload));
                const response = await Promise.race([
                    this.apiInstance.send(payload),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('App Builder API timeout (15s)')), 15000))
                ]);
                
                console.log('[ENGINE] App Builder API Response snippet:', JSON.stringify(response).substring(0, 300));
                
                // Bulletproof Deriv error extraction
                if (response && typeof response === 'object') {
                    if (response.error) {
                        const err = response.error;
                        const errMsg = err.message || err.code || JSON.stringify(err);
                        console.error('[ENGINE] Deriv API Error Details:', JSON.stringify(err));
                        throw new Error(errMsg);
                    }
                }
                
                return response as T;
            } catch (e: any) {
                let errMsg = 'Unknown error';
                if (typeof e === 'string') errMsg = e;
                else if (e && typeof e === 'object') {
                    errMsg = e.message || e.error?.message || e.code || JSON.stringify(e);
                }
                console.error('[ENGINE] App Builder API send failed:', errMsg, e);
                throw new Error(errMsg);
            }
        }
        
        throw new Error('No API available');
    }

    // ROOT-CAUSE FIX for "balance is fixed and doesn't reflect trades":
    // Live trades may execute over this engine's OWN separate authorized
    // WebSocket connection (this.api) or over the shared App Builder connection
    // (this.apiInstance). The header/account UI's live balance stream only
    // listens on the app's shared connection — so a trade settled purely over
    // this engine's own connection can change the real account balance on
    // Deriv's servers without the UI ever hearing about it. To guarantee the
    // displayed balance is always correct, we explicitly re-fetch the
    // authoritative balance after every live buy and every live settlement and
    // push it into both the mobx client-store and the account_list$ stream that
    // the header actually renders from.
    private async refreshBalance() {
        try {
            const response = await this.sendRequest({ balance: 1 });
            const balance = response?.balance;
            if (!balance || typeof balance.balance !== 'number') return;

            if (this.client && typeof this.client.setBalance === 'function') {
                this.client.setBalance(String(balance.balance));
                if (balance.currency && typeof this.client.setCurrency === 'function') {
                    this.client.setCurrency(balance.currency);
                }
            }

            const loginid = balance.loginid || this.client?.loginid;
            ConnectionStream.updateAccountBalance?.(loginid, balance.balance, balance.currency);
        } catch (e: any) {
            console.warn('[ENGINE] balance refresh failed:', e.message);
        }
    }

    stop(emitLog = true) {
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
        if (this.balanceTimer) { clearInterval(this.balanceTimer); this.balanceTimer = null; }
        this.paperMonitors.forEach(monitor => clearInterval(monitor));
        this.paperMonitors.clear();
        if (this.api) { this.api.close(); this.api = null; }
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
        if (this.limitsHit()) return false;
        // Consecutive-loss circuit breaker: after N losses in a row, stop trading
        // and require the operator to review before resuming. Losing streaks
        // frequently indicate the current market regime doesn't match the
        // strategy's assumptions — continuing to trade through it compounds risk.
        const maxLosses = Math.max(1, this.settings.maxConsecutiveLosses || DEFAULT_AUTOTRADER_SETTINGS.maxConsecutiveLosses);
        if (this.stats.lossStreak >= maxLosses) {
            this.log('warn', `⛔ ${this.stats.lossStreak} consecutive losses — pausing bot for review.`);
            this.stop(false);
            return false;
        }
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
        if (!this.running || (!this.api && !this.apiInstance) || this.scanning) return;
        
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

                    // SIGNAL PERSISTENCE GATE: a signal must be produced by the SAME
                    // contract/barrier on two consecutive scans (~scanIntervalMs apart)
                    // before we act on it. A single scan can catch a momentary
                    // statistical blip; requiring it to still hold true on independent,
                    // freshly-fetched data materially cuts false positives.
                    const sigKey = `${best.contractType}|${best.barrier ?? ''}`;
                    const pending = this.pendingSignals.get(symbol.symbol);
                    if (pending && pending.key === sigKey) {
                        pending.count += 1;
                    } else {
                        this.pendingSignals.set(symbol.symbol, { key: sigKey, count: 1 });
                    }
                    const confirmed = (this.pendingSignals.get(symbol.symbol)?.count ?? 0) >= 2;

                    if (!confirmed) {
                        this.log('info', `⏳ ${symbol.display_name}: signal not yet confirmed (1/2 scans)`);
                    } else if (this.canTrade(symbol.symbol)) {
                        this.log('info', `🎯 Attempting trade on ${symbol.display_name}...`);
                        try {
                            const opened = await this.executeTrade(symbol, quotes, decimals, best);
                            if (opened) {
                                tradesThisCycle += 1;
                                this.log('success', `✓ Trade executed on ${symbol.display_name}`);
                                this.pendingSignals.delete(symbol.symbol);
                            }
                        } catch (error: any) {
                            this.log('error', `Trade failed: ${error.message}`);
                        }
                    }
                } else {
                    // No qualifying signal this scan — any prior partial confirmation
                    // is stale and must not carry over.
                    this.pendingSignals.delete(symbol.symbol);
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

        // ROOT-CAUSE FIX: the live `contracts_for` schema this app talks to is
        // additionalProperties:false and only accepts `contracts_for` (+ optional
        // `passthrough`/`req_id`). `product_type` and `currency` are NOT accepted
        // and the server rejects the whole request with
        // "Input validation failed: Properties not allowed: ...".
        // This matches exactly how the app's own working bot-skeleton calls it:
        // `api_base.api.send({ contracts_for: symbol })` (see
        // src/external/bot-skeleton/services/api/contracts-for.js).
        try {
            const response = await this.sendRequest({ contracts_for: symbol });
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
            console.warn(`[ENGINE] contracts_for failed for ${symbol}:`, e.message);
        }

        this.log('warn', `Could not fetch specs for ${symbol}`);
        return null;
    }

    private async executeTrade(symbol: DerivActiveSymbol, quotes: number[], decimals: number, analysis: AnalysisResult): Promise<boolean> {
        if (!this.authorized || !analysis.contractType) return false;
        
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

        // ROOT-CAUSE FIX: the live `proposal` schema this app talks to has
        // renamed `symbol` -> `underlying_symbol` and no longer accepts
        // `product_type` (both were silently causing "Properties not allowed"
        // rejections). `currency` IS required. This mirrors the app's own
        // working proposal builder in
        // src/external/bot-skeleton/services/tradeEngine/utils/helpers.js
        // (tradeOptionToProposal), which sends `underlying_symbol` + `currency`
        // and never sends `product_type`.
        const currency = this.client?.currency || this.settings.currency || 'USD';
        const payload: Record<string, unknown> = {
            amount: stake, basis: 'stake', contract_type: analysis.contractType,
            currency, duration, duration_unit: durationUnit, underlying_symbol: symbol.symbol,
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
                this.log('error', `No priceable proposal for ${symbol.symbol}`);
                return false;
            }

            const askPrice = Number(proposal.ask_price);
            const payout = Number(proposal.payout);
            const breakEven = askPrice / payout;
            const projectedEdge = analysis.confidence - breakEven;

            this.log('info', `💰 Ask=${askPrice.toFixed(2)}, Payout=${payout.toFixed(2)}, Edge=${(projectedEdge*100).toFixed(2)}%`);

            // Edge check is now MANDATORY (not gated behind requireProfitProjection).
            // A trade only proceeds if the priced-in payout gives a calculable edge
            // over break-even, floored at minProjectedEdge (never negative/zero).
            const minEdge = Math.max(this.settings.minProjectedEdge, 0.005);
            if (projectedEdge < minEdge) {
                this.stats.skippedBelowEdge += 1;
                this.emit();
                this.log('info', `⏭ Skipped ${symbol.symbol}: edge ${(projectedEdge * 100).toFixed(2)}% < required ${(minEdge * 100).toFixed(2)}%`);
                return false;
            }

            if (this.settings.mode === 'live') {
                const buyResponse = await this.sendRequest({ buy: proposal.id, price: askPrice });
                const contractId = buyResponse?.buy?.contract_id;
                if (!contractId) {
                    this.log('error', `Live buy failed: no contract id`);
                    return false;
                }
                void this.refreshBalance(); // stake was just deducted — reflect it immediately

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
                            void this.refreshBalance(); // payout/loss just settled — reflect it immediately
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
