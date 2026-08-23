import { analyzeMarket, AnalysisResult, ContractType, TradeCategory } from './analysis';

// ============================================================================
// TYPES & CONSTANTS (Required by UI and Engine)
// ============================================================================

export type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';

export const TRADE_CATEGORIES: { label: string; value: TradeCategory }[] = [
    { label: 'Rise/Fall', value: 'rise_fall' },
    { label: 'Even/Odd', value: 'even_odd' },
    { label: 'Over/Under', value: 'over_under' },
    { label: 'Matches/Differs', value: 'matches_differs' },
];

export const MARKETS = [
    { label: 'Synthetic Indices', value: 'synthetic_index' },
];

export const SYNTHETIC_INDICES = [
    { symbol: 'R_100', display_name: 'Volatility 100 Index', pip: 0.01 },
    { symbol: 'R_75', display_name: 'Volatility 75 Index', pip: 0.01 },
    { symbol: 'R_50', display_name: 'Volatility 50 Index', pip: 0.01 },
    { symbol: 'R_25', display_name: 'Volatility 25 Index', pip: 0.01 },
    { symbol: 'R_10', display_name: 'Volatility 10 Index', pip: 0.01 },
];

export const SYNTHETIC_SYMBOL_PRESETS = SYNTHETIC_INDICES.map((s) => s.symbol).join(',');

export type AutoTraderMode = 'paper' | 'live';

export interface AutoTraderSettings {
    mode: AutoTraderMode;
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
    maxConsecutiveLosses: number;
    signalConfirmationsRequired: number;
}

const DEFAULT_AUTOTRADER_SETTINGS: AutoTraderSettings = {
    mode: 'paper',
    appId: import.meta.env.VITE_DERIV_APP_ID || '1089',
    apiToken: '',
    stake: 1.0,
    currency: 'USD',
    duration: 5,
    durationUnit: 't',
    minConfidence: 0.75,
    maxVolatility: 100,
    maxConcurrentTrades: 1,
    dailyLossLimit: 50,
    takeProfit: 100,
    martingaleEnabled: false,
    martingaleMultiplier: 2.0,
    maxMartingaleSteps: 3,
    maxStake: 100,
    requireProfitProjection: true,
    minProjectedEdge: 0.02,
    symbolsOverride: '',
    maxSymbols: 10,
    scanIntervalMs: 5000,
    scanBatchDelayMs: 200,
    cooldownMs: 10000,
    enabledMarkets: ['synthetic_index'],
    tradeCategories: ['rise_fall'],
    maxConsecutiveLosses: 3,
    signalConfirmationsRequired: 1,
};

export type AutoTraderLog = { time: string; level: 'info' | 'warn' | 'error' | 'success'; message: string };

export interface AutoTraderStats {
    wins: number;
    losses: number;
    net: number;
    dailyNet: number;
    open: number;
    lossStreak: number;
    sessionStart: number;
    day: string;
    scanCount: number;
    tradesOpened: number;
    lastScanAt: number | null;
    lastScanSummary: string;
    signalsFound: number;
    proposalsRequested: number;
    proposalsRejectedByBroker: number;
    skippedBelowEdge: number;
    skippedContractUnavailable: number;
    paperBalance: number | null;
    paperBalanceSeeded: boolean;
    derivBalance: number | null;
    balanceDifference: number;
    lastSyncTime: number | null;
    isBalanceHealthy: boolean;
}

// ============================================================================
// ENGINE IMPLEMENTATION
// ============================================================================

export class AutoTraderEngine extends EventTarget {
    private client: any = null;
    private apiInstance: any = null;
    private settings: AutoTraderSettings = { ...DEFAULT_AUTOTRADER_SETTINGS };
    private scanTimer: ReturnType<typeof setInterval> | null = null;
    private balanceTimer: ReturnType<typeof setInterval> | null = null;
    
    private running = false;
    private connected = false;
    private authorized = false;
    private halted = false;
    
    private logs: AutoTraderLog[] = [];
    private stats: AutoTraderStats = {
        wins: 0, losses: 0, net: 0, dailyNet: 0, open: 0, lossStreak: 0,
        sessionStart: Date.now(), day: new Date().toDateString(), scanCount: 0,
        tradesOpened: 0, lastScanAt: null, lastScanSummary: 'Not scanned yet.',
        signalsFound: 0, proposalsRequested: 0, proposalsRejectedByBroker: 0,
        skippedBelowEdge: 0, skippedContractUnavailable: 0,
        paperBalance: null, paperBalanceSeeded: false,
        derivBalance: null, balanceDifference: 0, lastSyncTime: null, isBalanceHealthy: true,
    };

    private openTrades = new Map<string, any>();
    private cooldownUntil = new Map<string, number>();

    constructor() {
        super();
        this.loadSettings();
    }

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
                tradeCategories: Array.isArray(saved.tradeCategories) && saved.tradeCategories.length 
                    ? saved.tradeCategories 
                    : DEFAULT_AUTOTRADER_SETTINGS.tradeCategories,
                apiToken: '',
            };
        } catch {
            this.settings = { ...DEFAULT_AUTOTRADER_SETTINGS };
        }
    }

    private saveSettings() {
        try {
            const { apiToken, ...rest } = this.settings;
            localStorage.setItem('ai-bot-settings', JSON.stringify(rest));
        } catch {}
    }

    getState() {
        return {
            settings: { ...this.settings },
            stats: { ...this.stats, open: this.openTrades.size },
            logs: [...this.logs],
            openTrades: Array.from(this.openTrades.values()),
            running: this.running,
            halted: this.halted,
            connected: this.connected,
            authorized: this.authorized,
            symbolCount: SYNTHETIC_INDICES.length,
        };
    }

    private emit() {
        this.dispatchEvent(new CustomEvent('state', { detail: this.getState() }));
    }

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
        this.halted = false;
        
        try {
            this.updateSettings(patch);
            this.stop(false);

            this.client = patch.client;
            this.apiInstance = patch.apiInstance;

            if (this.client?.is_logged_in) {
                this.connected = true;
                this.authorized = true;
                this.log('success', '✓ Session authorized. Ready to scan.');
            } else {
                this.authorized = false;
                this.log('error', '✗ Not logged in. Please log in to your Deriv account.');
                this.running = false;
                this.emit();
                return;
            }

            this.running = true;
            this.saveSettings();

            await this.refreshBalance();

            if (this.settings.mode === 'paper' && !this.stats.paperBalanceSeeded) {
                this.stats.paperBalance = this.stats.derivBalance ?? 1000;
                this.stats.paperBalanceSeeded = true;
            }

            this.scanTimer = setInterval(() => { void this.scan(); }, this.settings.scanIntervalMs);
            this.balanceTimer = setInterval(() => { void this.refreshBalance(); }, 15000);

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
        if (this.apiInstance && typeof this.apiInstance.send === 'function') {
            try {
                const response = await Promise.race([
                    this.apiInstance.send(payload),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout (15s)')), 15000))
                ]);
                if (response && typeof response === 'object' && response.error) {
                    throw new Error(response.error.message || 'Deriv API error');
                }
                return response as T;
            } catch (e: any) {
                throw new Error(e.message || 'Unknown API error');
            }
        }
        throw new Error('No API available');
    }

    private async refreshBalance() {
        if (this.halted) return;
        try {
            const response = await this.sendRequest({ balance: 1 });
            const bal = response?.balance;
            if (!bal || typeof bal.balance !== 'number') return;

            this.stats.derivBalance = bal.balance;
            this.stats.lastSyncTime = Date.now();

            const expectedLocal = this.stats.paperBalance ?? bal.balance;
            this.stats.balanceDifference = Math.abs(expectedLocal - bal.balance);
            this.stats.isBalanceHealthy = this.stats.balanceDifference <= 0.50;

            if (!this.stats.isBalanceHealthy) {
                this.triggerKillSwitch(`Balance mismatch detected: Diff=${this.stats.balanceDifference.toFixed(2)}`);
                return;
            }

            if (this.client && typeof this.client.setBalance === 'function') {
                this.client.setBalance(String(bal.balance));
                if (bal.currency && typeof this.client.setCurrency === 'function') {
                    this.client.setCurrency(bal.currency);
                }
            }
        } catch (e: any) {
            console.warn('[ENGINE] balance refresh failed:', e.message);
        }
    }

    private triggerKillSwitch(reason: string) {
        this.halted = true;
        this.running = false;
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
        if (this.balanceTimer) { clearInterval(this.balanceTimer); this.balanceTimer = null; }
        this.log('error', `🚨 KILL SWITCH TRIGGERED: ${reason}`);
        this.emit();
    }

    stop(emitLog = true) {
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
        if (this.balanceTimer) { clearInterval(this.balanceTimer); this.balanceTimer = null; }
        if (this.running && emitLog) this.log('warn', 'AI bot stopped.');
        this.running = false;
        this.halted = false;
        this.emit();
    }

    private resetDailyIfNeeded() {
        const today = new Date().toDateString();
        if (this.stats.day !== today) {
            this.stats.day = today;
            this.stats.dailyNet = 0;
            this.log('info', 'Daily counters reset.');
        }
    }

    private limitsHit(): boolean {
        this.resetDailyIfNeeded();
        if (this.settings.dailyLossLimit > 0 && this.stats.dailyNet <= -this.settings.dailyLossLimit) {
            this.triggerKillSwitch('Daily loss limit reached.');
            return true;
        }
        if (this.settings.takeProfit > 0 && this.stats.dailyNet >= this.settings.takeProfit) {
            this.triggerKillSwitch('Daily take profit reached.');
            return true;
        }
        if (this.stats.lossStreak >= this.settings.maxConsecutiveLosses) {
            this.triggerKillSwitch(`Max consecutive losses (${this.settings.maxConsecutiveLosses}) reached.`);
            return true;
        }
        return false;
    }

    private async scan() {
        if (!this.running || this.halted || !this.apiInstance) return;

        this.log('info', 'Starting scan...');
        let tradesThisCycle = 0;

        try {
            for (const symbol of SYNTHETIC_INDICES) {
                if (!this.running || this.halted) break;

                let quotes: number[] = [];
                try {
                    // FIX: Increased count to 400 to satisfy analysis.ts requirements 
                    // (MIN_DIGIT_SAMPLE = 300, rise_fall requires >= 120)
                    const response = await this.sendRequest({ 
                        ticks_history: symbol.symbol, 
                        adjust_start_time: 1, 
                        count: 400, 
                        end: 'latest', 
                        style: 'ticks' 
                    });
                    const prices = response?.history?.prices ?? [];
                    quotes = prices.map((p: any) => Number(p));
                } catch (error: any) {
                    continue;
                }

                const results = this.settings.tradeCategories.map(category => {
                    try { return analyzeMarket(category, quotes, 2); } catch { return null; }
                }).filter(r => r !== null) as AnalysisResult[];

                for (const analysis of results) {
                    this.stats.signalsFound += 1;
                    
                    if (!analysis.contractType) {
                        this.log('info', `⏭ ${symbol.display_name}: ${analysis.reason}`);
                        continue;
                    }

                    if (this.openTrades.size >= this.settings.maxConcurrentTrades) {
                        this.log('warn', 'Max concurrent trades reached.');
                        break;
                    }

                    if (this.limitsHit()) break;

                    if (this.settings.mode === 'paper') {
                        await this.executePaperTrade(symbol, analysis);
                        tradesThisCycle += 1;
                    }
                }
            }
        } catch (error: any) {
            this.log('error', `Scan error: ${error.message}`);
        } finally {
            this.stats.scanCount += 1;
            this.stats.lastScanAt = Date.now();
            this.stats.tradesOpened += tradesThisCycle;
            this.stats.lastScanSummary = `${SYNTHETIC_INDICES.length} symbols scanned, ${tradesThisCycle} trades opened.`;
            this.emit();
        }
    }

    private async executePaperTrade(symbol: any, analysis: AnalysisResult) {
        const stake = this.settings.stake;
        const payoutRatio = 0.95;
        
        this.log('info', `📝 PAPER ${analysis.contractType} opened on ${symbol.display_name} | stake=${stake}`);
        
        const durationMs = this.settings.durationUnit === 't' ? this.settings.duration * 1000 : this.settings.duration * (this.settings.durationUnit === 'm' ? 60000 : 1000);
        
        setTimeout(() => {
            const win = Math.random() < 0.48; // Simulated realistic payout edge
            const profit = win ? stake * (payoutRatio - 1) : -stake;
            
            if (win) {
                this.stats.wins += 1;
                this.stats.lossStreak = 0;
            } else {
                this.stats.losses += 1;
                this.stats.lossStreak += 1;
            }
            
            this.stats.net += profit;
            this.stats.dailyNet += profit;
            if (typeof this.stats.paperBalance === 'number') {
                this.stats.paperBalance += profit;
            }
            
            this.log(win ? 'success' : 'warn', `PAPER ${analysis.contractType} ${win ? 'WON' : 'LOST'} | P/L ${profit.toFixed(2)}`);
            this.limitsHit();
            this.emit();
        }, Math.min(durationMs, 2000));
    }
}

export const autoTrader = new AutoTraderEngine();
