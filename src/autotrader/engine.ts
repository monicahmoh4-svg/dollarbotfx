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

    async start(patch: Partial<AutoTraderSettings> = {}) {
        console.log('[ENGINE] start() called with patch:', { 
            hasToken: !!patch.apiToken, 
            tokenLength: patch.apiToken?.length,
            currency: patch.currency 
        });
        
        try {
            this.updateSettings(patch);
            this.stop(false);
            this.contractsCache.clear();
            if (this.api) this.api.close();

            this.api = new DerivAPI(this.settings.appId || '1089');
            
            this.api.addEventListener('close', () => { 
                if (this.authorized) { 
                    this.authorized = false; 
                    this.log('warn', 'Connection dropped. Reconnecting...'); 
                } 
                this.connected = false; 
                this.emit(); 
            });
            
            this.api.addEventListener('reconnected', () => { 
                this.connected = true; 
                this.log('info', 'Reconnected to Deriv.'); 
                this.emit(); 
            });
            
            this.api.addEventListener('reauthorized', () => { 
                this.authorized = true; 
                this.log('success', 'Re-authorized.'); 
                this.emit(); 
            });
            
            this.api.addEventListener('reauthorize-failed', (event: any) => { 
                this.authorized = false; 
                this.log('error', `Re-authorization failed: ${event?.detail || 'unknown'}`); 
                this.emit(); 
            });

            this.log('info', 'Connecting to Deriv WebSocket...');
            await this.api.connect();
            this.connected = true;
            this.log('success', 'Connected to Deriv market data.');

            const tokenToUse = patch.apiToken || this.settings.apiToken;
            
            console.log('[ENGINE] Token to use:', tokenToUse ? '***' + tokenToUse.slice(-10) : 'EMPTY');
            
            if (tokenToUse && tokenToUse.trim() !== '') {
                this.log('info', 'Attempting authorization with provided token...');
                try {
                    await this.api.authorize(tokenToUse);
                    this.authorized = true;
                    this.settings.apiToken = tokenToUse;
                    this.log('success', `✓ Authorized successfully (${this.settings.mode === 'live' ? 'LIVE' : 'PAPER'} mode)`);
                    this.log('success', 'Bot can now fetch contract specs and execute trades.');
                } catch (error: any) {
                    this.authorized = false;
                    this.log('error', `✗ Authorization failed: ${error.message}`);
                    this.log('warn', 'Scanning will continue, but trading requires valid authorization.');
                }
            } else {
                this.authorized = false;
                this.log('warn', '⚠ No API token provided.');
                this.log('warn', 'To enable trading: Log in to your Deriv account or provide an API token.');
                this.log('info', 'Scanning will continue without authorization (signal detection only).');
            }

            this.running = true;
            this.saveSettings();
            this.scanTimer = setInterval(() => { 
                void this.scan(); 
            }, this.settings.scanIntervalMs);
            
            this.log('success', `✓ AI bot started - Scanning ${SYNTHETIC_INDICES.length} synthetic indices every ${this.settings.scanIntervalMs}ms`);
            this.log('info', `Trading mode: ${this.settings.mode.toUpperCase()} | Min confidence: ${(this.settings.minConfidence * 100).toFixed(0)}%`);
            
            void this.scan();
            this.emit();
            
        } catch (error: any) {
            console.error('[ENGINE] Start failed:', error);
            this.log('error', `Failed to start bot: ${error.message}`);
            this.running = false;
            this.emit();
        }
    }

    stop(emitLog = true) {
        if (this.scanTimer) { 
            clearInterval(this.scanTimer); 
            this.scanTimer = null; 
        }
        if (this.running && emitLog) this.log('warn', 'AI bot stopped.');
        this.running = false;
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
            this.log('warn', 'Daily loss limit reached.'); 
            this.stop(false); 
            return true; 
        }
        if (this.settings.takeProfit > 0 && this.stats.dailyNet >= this.settings.takeProfit) { 
            this.log('success', 'Daily take profit reached.'); 
            this.stop(false); 
            return true; 
        }
        return false;
    }

    private canTrade(symbol: string): boolean {
        if (!this.running) return false;
        if (!this.authorized) return false;
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
        if (!this.running || !this.api || this.scanning) return;
        
        this.scanning = true;
        this.emit();

        let scannedSymbols = 0, tradesThisCycle = 0, signalsThisCycle = 0;

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

                const results = this.settings.tradeCategories.map(category => {
                    try {
                        return analyzeMarket(category, quotes, decimals);
                    } catch (e) {
                        return null;
                    }
                }).filter(r => r !== null) as AnalysisResult[];

                const candidates = results.filter(result => {
                    if (!result.contractType) return false;
                    if (result.confidence < this.settings.minConfidence) return false;
                    return true;
                });

                if (candidates.length > 0) {
                    signalsThisCycle += candidates.length;
                    this.stats.signalsFound += candidates.length;
                    
                    candidates.sort((a, b) => b.confidence - a.confidence);
                    const best = candidates[0];
                    
                    this.log('info', `📊 ${symbol.display_name}: ${best.contractType} @ ${(best.confidence * 100).toFixed(1)}% confidence | ${best.reason}`);
                    
                    if (this.canTrade(symbol.symbol)) {
                        this.log('info', `🎯 Attempting trade on ${symbol.display_name}...`);
                        try {
                            const opened = await this.executeTrade(symbol, quotes, decimals, best);
                            if (opened) {
                                tradesThisCycle += 1;
                                this.log('success', `✓ Trade executed successfully on ${symbol.display_name}`);
                            }
                        } catch (error: any) {
                            this.log('error', `Trade failed on ${symbol.symbol}: ${error.message}`);
                        }
                    } else if (!this.authorized) {
                        this.log('warn', `⚠ Signal detected on ${symbol.display_name} but cannot trade (not authorized)`);
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
            this.log('info', `✓ Scan #${this.stats.scanCount} complete: ${this.stats.lastScanSummary}`);
            
            this.scanning = false; 
            this.emit();
        }
    }

    private async getContractSpecs(symbol: string): Promise<Map<ContractType, DerivContractSpec> | null> {
        if (!this.api) return null;
        
        const cached = this.contractsCache.get(symbol);
        if (cached) return cached;
        
        try {
            const specs = await this.api.contractsFor(symbol, this.settings.currency);
            
            if (specs.length > 0) {
                const map = new Map<ContractType, DerivContractSpec>();
                specs.forEach(spec => { 
                    map.set(spec.contractType as ContractType, spec); 
                });
                this.contractsCache.set(symbol, map);
                return map;
            }
        } catch (e: any) {
            this.log('warn', `Could not fetch contract specs for ${symbol}: ${e.message}`);
        }
        
        return null;
    }

    private async executeTrade(symbol: DerivActiveSymbol, quotes: number[], decimals: number, analysis: AnalysisResult): Promise<boolean> {
        if (!this.api || !this.authorized || !analysis.contractType) return false;
        
        const stake = this.calculateStake();
        const entry = quotes.length > 0 ? quotes[quotes.length - 1] : 0;
        
        if (!entry || entry === 0) {
            this.log('error', `Invalid entry price for ${symbol.symbol}: ${entry}`);
            return false;
        }

        const specsMap = await this.getContractSpecs(symbol.symbol);
        
        if (!specsMap) {
            this.stats.skippedContractUnavailable += 1;
            this.emit();
            this.log('error', `Could not fetch contract specs for ${symbol.symbol}`);
            return false;
        }
        
        const spec = specsMap.get(analysis.contractType);
        if (!spec) { 
            this.stats.skippedContractUnavailable += 1; 
            this.emit();
            this.log('error', `${analysis.contractType} not available for ${symbol.symbol}`);
            return false; 
        }

        const duration = spec.minDuration?.value ?? 5;
        const durationUnit = (spec.minDuration?.unit ?? 't') as DurationUnit;

        const payload: Record<string, unknown> = { 
            amount: stake, 
            basis: 'stake', 
            contract_type: analysis.contractType, 
            currency: this.settings.currency || 'USD',
            duration, 
            duration_unit: durationUnit, 
            symbol: symbol.symbol, 
            product_type: 'basic' 
        };
        
        if (analysis.barrier !== null && analysis.barrier !== undefined) {
            payload.barrier = String(analysis.barrier);
        }

        this.stats.proposalsRequested += 1;
        this.emit();

        try {
            const proposalResponse = await this.api.requestProposal(payload);
            const proposal = proposalResponse?.proposal;
            
            if (!proposal?.id || !proposal.ask_price || !proposal.payout) {
                this.stats.proposalsRejectedByBroker += 1;
                this.emit();
                this.log('error', `Broker returned no priceable proposal for ${symbol.symbol}`);
                return false;
            }

            const askPrice = Number(proposal.ask_price);
            const payout = Number(proposal.payout);
            const breakEven = askPrice / payout;
            const projectedEdge = analysis.confidence - breakEven;

            this.log('info', `💰 ${symbol.display_name}: Ask=${askPrice.toFixed(2)}, Payout=${payout.toFixed(2)}, Edge=${(projectedEdge*100).toFixed(2)}%`);

            if (this.settings.requireProfitProjection && projectedEdge < this.settings.minProjectedEdge) {
                this.stats.skippedBelowEdge += 1;
                this.emit();
                this.log('warn', `Skipping ${symbol.symbol}: projected edge too low`);
                return false;
            }

            if (this.settings.mode === 'live') {
                return await this.executeLiveTrade(symbol.symbol, entry, stake, decimals, analysis, proposal);
            }
            return await this.executePaperTrade(symbol.symbol, entry, stake, decimals, analysis, payout / askPrice, duration, durationUnit);
            
        } catch (error: any) {
            this.stats.proposalsRejectedByBroker += 1;
            this.emit();
            this.log('error', `✗ REJECTED: ${error.message}`);
            return false;
        }
    }

    private async executeLiveTrade(symbol: string, entry: number, stake: number, decimals: number, analysis: AnalysisResult, proposal: any): Promise<boolean> {
        if (!this.api || !analysis.contractType) return false;
        
        try {
            const buyResponse = await this.api.buyProposal(proposal.id, proposal.ask_price);
            const contractId = buyResponse?.buy?.contract_id;
            
            if (!contractId) {
                this.log('error', `Live buy failed for ${symbol}: no contract id returned`);
                return false;
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
                contractId: String(contractId) 
            };
            
            this.openTrades.set(symbol, trade);

            await this.api.subscribeProposalOpenContract(String(contractId));
            const unsubscribe = this.api.addProposalOpenContractListener(poc => { 
                this.onLiveContractUpdate(symbol, poc); 
            });
            this.liveUnsubscribes.set(trade.id, unsubscribe);

            this.log('success', `🚀 LIVE ${analysis.contractType} opened on ${symbol} | stake=${stake}`);
            this.emit();
            return true;
            
        } catch (error: any) {
            this.log('error', `Live trade failed on ${symbol}: ${error.message}`);
            return false;
        }
    }

    private async executePaperTrade(symbol: string, entry: number, stake: number, decimals: number, analysis: AnalysisResult, payoutRatio: number, duration: number, durationUnit: DurationUnit): Promise<boolean> {
        if (!this.api || !analysis.contractType) return false;
        
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
            payoutRatio 
        };
        
        if (trade.durationUnit === 't') {
            trade.remainingTicks = Math.max(1, Number(trade.duration) || 1);
        } else {
            trade.expiresAt = Date.now() + (trade.durationUnit === 'm' ? Number(trade.duration) * 60000 : Number(trade.duration) * 1000);
        }
        
        this.openTrades.set(symbol, trade);
        this.log('success', `📝 PAPER ${analysis.contractType} opened on ${symbol} | stake=${stake}`);
        
        await this.monitorPaperTrade(trade);
        this.emit();
        return true;
    }

    private async monitorPaperTrade(trade: PaperTrade) {
        if (!this.api) return;
        
        try { 
            await this.api.subscribeTicks(trade.symbol); 
        } catch {}
        
        const unsubscribe = this.api.addTickListener((tick: DerivTick) => {
            if (tick.symbol !== trade.symbol) return;
            
            const current = this.openTrades.get(trade.symbol);
            if (!current || current.id !== trade.id) { 
                unsubscribe(); 
                return; 
            }
            
            if (trade.durationUnit === 't') {
                if (typeof trade.remainingTicks !== 'number') trade.remainingTicks = 1;
                trade.remainingTicks -= 1;
                if (trade.remainingTicks > 0) return;
            } else { 
                if (Date.now() < (trade.expiresAt ?? 0)) return; 
            }
            
            const exit = tick.quote;
            const win = trade.category === 'rise_fall' 
                ? (trade.direction === 'CALL' ? exit > trade.entry : exit < trade.entry) 
                : isDigitContractWin(trade.contractType, trade.barrier, lastDigitOf(exit, trade.decimals));
            
            const profit = win ? trade.stake * (trade.payoutRatio - 1) : -trade.stake;
            this.settleTrade(trade.symbol, win, profit, 'paper-expiry');
            unsubscribe(); 
            this.paperUnsubscribes.delete(trade.id);
        });
        
        this.paperUnsubscribes.set(trade.id, unsubscribe);
        
        const safetyTimeout = trade.durationUnit === 't' 
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
        
        const unsubscribe = trade.mode === 'live' 
            ? this.liveUnsubscribes.get(trade.id) 
            : this.paperUnsubscribes.get(trade.id);
            
        if (unsubscribe) { 
            unsubscribe(); 
            (trade.mode === 'live' ? this.liveUnsubscribes : this.paperUnsubscribes).delete(trade.id); 
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
        
        this.cooldownUntil.set(symbol, Date.now() + this.settings.cooldownMs);
        
        this.log(win ? 'success' : 'warn', `${trade.mode.toUpperCase()} ${trade.contractType} ${win ? 'WON' : 'LOST'} on ${symbol} | P/L ${profit.toFixed(2)}`);
        
        this.limitsHit(); 
        this.emit();
    }
}

export const autoTrader = new AutoTraderEngine();
