import { analyzeBestSignal, inferDecimalsFromQuotes, type TradeCategory, type ContractType, type StatisticalSignal } from './analysis';
import { RiskManager } from './risk-manager';
import { ledger } from './ledger';
import { recordMarketTicks } from './history-store';

export type BotState = 'DISCONNECTED' | 'SYNCING' | 'READY' | 'TRADING' | 'COOLDOWN' | 'ERROR' | 'HALTED';
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
  minExpectedEdge: number;
  contractDurationTicks: number;
}

export interface AutoTraderSettings {
  client?: any;
  apiInstance?: { send: (request: Record<string, unknown>) => Promise<any> };
  mode?: 'paper' | 'live';
}

export interface MarketInfo {
  symbol: string; display_name: string; market: string; submarket: string; is_active: boolean;
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

export const TRADE_CATEGORIES: { label: string; value: TradeCategory }[] = [
  { label: 'Rise/Fall', value: 'rise_fall' },
  { label: 'Even/Odd', value: 'even_odd' },
  { label: 'Over/Under', value: 'over_under' },
  { label: 'Matches/Differs', value: 'matches_differs' },
];

const DIGIT_CONTRACTS = new Set(['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF']);

const DEFAULT_LIMITS: RiskLimits = {
  maxStakePerTrade: 2,
  maxPercentRiskPerTrade: 0.01, // FIXED FRACTIONAL: Never Martingale
  maxDailyLoss: 20,
  maxConsecutiveLosses: 5,
  cooldownAfterLossMs: 30_000,
  targetProfit: 50,
  maxTradesPerSession: 200,
  maxSessionDurationMs: 24 * 60 * 60 * 1000,
  maxConcurrentTrades: 3,
  maxBalanceTolerance: 0.10,
  minExpectedEdge: 0.015, // Requires 1.5% statistical edge over live break-even probability
  contractDurationTicks: 5,
};

function currencyOf(client: any): string {
  return client?.currency || client?.accounts?.[client?.loginid]?.currency || 'USD';
}

function isSettled(contract: any): boolean {
  return Boolean(contract && (contract.is_sold || ['sold', 'won', 'lost'].includes(String(contract.status).toLowerCase())));
}

function buildProposal(contractType: ContractType, stake: number, symbol: string, durationTicks: number, currency: string, barrier?: number | null) {
  const proposal: Record<string, unknown> = {
    proposal: 1, amount: Number(stake.toFixed(2)), basis: 'stake', contract_type: contractType,
    currency, duration: durationTicks, duration_unit: 't', underlying_symbol: symbol,
  };
  if (DIGIT_CONTRACTS.has(contractType) && barrier != null) proposal.barrier = String(barrier);
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
  private scanInFlight = false;
  private openTrades = new Map<string, { stake: number; timer: ReturnType<typeof setInterval>; category: TradeCategory }>();
  private recentlyTraded = new Map<string, number>();
  private startingBalance: number | null = null;
  private realizedNet = 0;
  private cooldownUntil = 0;
  private logs: { time: string; level: string; message: string }[] = [];
  private cachedMarkets: MarketInfo[] = [];
  private marketCacheTime = 0;
  private stats = {
    wins: 0, losses: 0, net: 0, dailyNet: 0, lossStreak: 0, sessionStart: Date.now(),
    scanCount: 0, tradesOpened: 0, derivBalance: null, balanceDifference: 0, isBalanceHealthy: false,
    marketsScanned: 0, signalsDetected: 0,
  };

  constructor() {
    super();
    try {
      const limits = JSON.parse(localStorage.getItem('bot-risk-limits') || '{}');
      this.limits = { ...this.limits, ...limits };
      this.riskManager = new RiskManager(this.limits);
      if (localStorage.getItem('bot-trading-mode') === 'live') this.mode = 'live';
    } catch { /* localStorage unavailable */ }
  }

  getState() {
    return {
      state: this.state, isRunning: this.isRunning, running: this.isRunning, scanning: this.scanInFlight,
      mode: this.mode, limits: { ...this.limits },
      stats: { ...this.stats, sessionDurationMs: Date.now() - this.stats.sessionStart, activeContracts: this.openTrades.size },
      logs: [...this.logs], activity: [...this.logs], marketsCount: this.cachedMarkets.length,
    };
  }

  private emit() { this.dispatchEvent(new CustomEvent('state', { detail: this.getState() })); }

  private log(level: 'info' | 'warn' | 'error' | 'success', message: string) {
    console[level === 'success' ? 'log' : level];
    this.logs.unshift({ time: new Date().toLocaleTimeString(), level, message });
    this.logs = this.logs.slice(0, 500);
    this.emit();
  }

  private static stringifyError(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const obj = err as Record<string, unknown>;
      if (obj.error) return `API ${obj.error.code || 'ERR'}: ${obj.error.message || JSON.stringify(obj.error)}`;
      if (obj.message) return String(obj.message);
      try { return JSON.stringify(obj); } catch { return String(err); }
    }
    return String(err);
  }

  setMode(mode: 'paper' | 'live') {
    this.mode = mode;
    localStorage.setItem('bot-trading-mode', mode);
    this.log('info', `Trading mode: ${mode.toUpperCase()}`);
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
    this.stats = { wins: 0, losses: 0, net: 0, dailyNet: 0, lossStreak: 0, sessionStart: Date.now(), scanCount: 0, tradesOpened: 0, derivBalance: null, balanceDifference: 0, isBalanceHealthy: false, marketsScanned: 0, signalsDetected: 0 };
    this.realizedNet = 0;
    this.startingBalance = null;
    this.cooldownUntil = 0;

    try {
      await this.synchronizeBalance();
      if (!this.stats.isBalanceHealthy) throw new Error('Initial account balance could not be reconciled');
      this.state = 'READY';
      await this.refreshMarketCache();
      this.log('success', `🚀 Engine started. Scanning ${this.cachedMarkets.length} volatility markets with statistical edge validation.`);
      this.scanTimer = setInterval(() => void this.scan(), 5_000);
      this.reconciliationTimer = setInterval(() => void this.synchronizeBalance(), 5_000);
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
        if (item.is_trading_suspended || !item.symbol) continue;
        markets.push({ symbol: item.symbol, display_name: item.display_name || item.symbol, market: item.market || '', submarket: item.submarket || '', is_active: true });
      }
      this.cachedMarkets = markets.length > 0 ? markets : SYNTHETIC_INDICES.map((m) => ({ ...m, market: 'synthetic_index', submarket: 'volatility_indices', is_active: true }));
      this.marketCacheTime = Date.now();
    } catch {
      if (this.cachedMarkets.length === 0) {
        this.cachedMarkets = SYNTHETIC_INDICES.map((m) => ({ ...m, market: 'synthetic_index', submarket: 'volatility_indices', is_active: true }));
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
    this.state = 'READY';
    this.emit();

    const now = Date.now();
    this.recentlyTraded.forEach((expiry, symbol) => { if (now >= expiry) this.recentlyTraded.delete(symbol); });

    try {
      if (now - this.marketCacheTime > 60_000 || this.cachedMarkets.length === 0) await this.refreshMarketCache();

      for (const market of this.cachedMarkets) {
        if (!this.isRunning || this.openTrades.size >= this.limits.maxConcurrentTrades) break;
        if (Date.now() < (this.recentlyTraded.get(market.symbol) || 0)) continue;

        try {
          const response = await this.apiInstance!.send({ ticks_history: market.symbol, adjust_start_time: 1, count: 1000, end: 'latest', style: 'ticks' });
          if (!response || response.error) continue;
          
          const prices = response?.history?.prices;
          if (!Array.isArray(prices)) continue;

          const quotes = prices.map(Number).filter(Number.isFinite);
          if (quotes.length < 500) continue;

          recordMarketTicks(market.symbol, response?.history?.times as number[] | undefined, quotes);
          const decimals = inferDecimalsFromQuotes(quotes);
          const signal = analyzeBestSignal(quotes, decimals);
          
          this.stats.marketsScanned += 1;

          if (signal.signalStrength === 'NO_EDGE' || !signal.contractType) continue;

          this.stats.signalsDetected += 1;
          this.log('info', `[TRIGGER] ${market.display_name} | ${signal.category} ${signal.contractLabel} | Cons. Prob: ${(signal.conservativeProbability * 100).toFixed(1)}% | Baseline: ${(signal.theoreticalBaseline * 100).toFixed(1)}% | Reason: ${signal.reason}`);

          const executed = await this.executeTrade(market, signal);
          if (executed) {
            this.recentlyTraded.set(market.symbol, Date.now() + 120_000); // 2 min cooldown per market
            break; // One trade per scan cycle to prevent over-exposure
          }

        } catch (marketErr: any) {
          this.log('warn', `Market ${market.symbol} scan error: ${AutoTraderEngine.stringifyError(marketErr)}`);
        }
      }
    } catch (error: any) {
      this.log('error', `Scan failed: ${AutoTraderEngine.stringifyError(error)}`);
    } finally {
      this.stats.scanCount += 1;
      this.scanInFlight = false;
      if (this.isRunning && this.openTrades.size === 0 && this.state !== 'COOLDOWN') this.state = 'READY';
      if (this.stats.scanCount % 10 === 0) {
        this.log('info', `Cycle #${this.stats.scanCount}: ${this.stats.marketsScanned} scanned, ${this.stats.signalsDetected} triggers, ${this.openTrades.size} open`);
      }
      this.emit();
    }
  }

  private async executeTrade(market: MarketInfo, signal: StatisticalSignal) {
    if (!signal.contractType || !this.apiInstance || !this.stats.isBalanceHealthy) return false;

    const balance = this.stats.derivBalance || 0;
    const stake = Math.min(this.limits.maxStakePerTrade, balance * this.limits.maxPercentRiskPerTrade);
    if (!Number.isFinite(stake) || stake <= 0) return false;

    const riskCheck = this.riskManager.validatePreTrade(stake, this.stats.lossStreak, this.openTrades.size);
    if (!riskCheck.allowed) {
      this.log('info', `[NO-GO] ${market.display_name}: ${riskCheck.reason}`);
      return false;
    }

    const proposalRequest = buildProposal(signal.contractType, stake, market.symbol, this.limits.contractDurationTicks, currencyOf(this.client), signal.barrier);

    let proposalResponse;
    try {
      proposalResponse = await this.apiInstance.send(proposalRequest);
    } catch (err: any) {
      this.log('warn', `[NO-GO] ${market.display_name}: Proposal request failed - ${AutoTraderEngine.stringifyError(err)}`);
      return false;
    }

    const proposal = proposalResponse?.proposal;
    const ask = Number(proposal?.ask_price);
    const payout = Number(proposal?.payout);

    if (!proposal?.id || !Number.isFinite(ask) || !Number.isFinite(payout) || ask <= 0 || payout <= 0) {
      this.log('info', `[NO-GO] ${market.display_name}: Invalid proposal data`);
      return false;
    }

    // CRITICAL LOSS PREVENTION: Calculate live break-even probability from Deriv's actual payout
    const breakEvenProbability = ask / payout;
    const statisticalEdge = signal.conservativeProbability - breakEvenProbability;

    if (statisticalEdge < this.limits.minExpectedEdge) {
      this.log('info', `[NO-GO] ${market.display_name}: Edge ${(statisticalEdge * 100).toFixed(2)}% < Min ${(this.limits.minExpectedEdge * 100).toFixed(2)}% | Break-even: ${(breakEvenProbability * 100).toFixed(1)}%. Capital preserved.`);
      return false;
    }

    this.log('success', `[EXECUTE] ${market.display_name} | ${signal.contractType} ${signal.contractLabel} | Edge: ${(statisticalEdge * 100).toFixed(2)}% | Stake: $${stake.toFixed(2)}`);

    const contractId = await this.buyWithRetry(proposal.id, ask, market.symbol);
    if (!contractId) return false;

    this.stats.tradesOpened += 1;
    ledger.append({
      type: 'TRADE_OPEN', symbol: market.symbol,
      message: `Opened ${market.display_name} ${signal.contractType} [${signal.contractLabel}] contract ${contractId}`,
      balanceBefore: balance, stake, contractId,
    });

    this.watchContract(contractId, market.display_name, stake, signal.category);
    return true;
  }

  private async buyWithRetry(proposalId: string, price: number, symbol: string): Promise<string> {
    try {
      const buy = await this.apiInstance!.send({ buy: proposalId, price });
      const contractId = String(buy?.buy?.contract_id || '');
      if (contractId) return contractId;
    } catch (error: any) {
      this.log('warn', `Buy failed for ${symbol}: ${AutoTraderEngine.stringifyError(error)}`);
    }
    return '';
  }

  private watchContract(contractId: string, market: string, stake: number, category: TradeCategory) {
    const timer = setInterval(async () => {
      try {
        if (!this.apiInstance || !this.isRunning) { clearInterval(timer); return; }
        const response = await this.apiInstance.send({ proposal_open_contract: 1, contract_id: contractId });
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
          this.log('success', `✅ WON ${market}: +$${profit.toFixed(2)}.`);
        } else {
          this.stats.losses += 1;
          this.stats.lossStreak += 1;
          this.cooldownUntil = Date.now() + this.limits.cooldownAfterLossMs;
          this.state = 'COOLDOWN';
          this.log('warn', `❌ LOST ${market}: $${profit.toFixed(2)}. Cooldown ${this.limits.cooldownAfterLossMs / 1000}s.`);
        }
        
        await this.synchronizeBalance();
        this.checkLimits();
      } catch (error: any) {
        this.log('error', `Contract ${contractId} monitor failed: ${AutoTraderEngine.stringifyError(error)}`);
        clearInterval(timer);
        this.openTrades.delete(contractId);
      }
    }, 2_000);
    this.openTrades.set(contractId, { stake, timer, category });
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

      if (this.stats.balanceDifference <= this.limits.maxBalanceTolerance) {
        this.stats.isBalanceHealthy = true;
      } else {
        this.stats.isBalanceHealthy = false;
        this.halt(`Balance reconciliation mismatch: ${this.stats.balanceDifference.toFixed(2)}`);
      }
      this.emit();
    } catch (error: any) {
      this.log('warn', `Balance sync failed: ${AutoTraderEngine.stringifyError(error)}`);
    }
  }

  private checkLimits() {
    if (this.stats.dailyNet <= -this.limits.maxDailyLoss) this.halt('Daily loss limit reached.');
    else if (this.stats.net >= this.limits.targetProfit) this.halt('Target profit reached.');
    else if (this.stats.lossStreak >= this.limits.maxConsecutiveLosses) {
      this.cooldownUntil = Date.now() + 3 * 60 * 1000;
      this.stats.lossStreak = 0;
      this.state = 'COOLDOWN';
      this.log('warn', `Consecutive loss limit reached. Cooling down 180s to prevent emotional trading.`);
      this.emit();
    }
  }

  private halt(reason: string) {
    this.isRunning = false;
    this.state = 'HALTED';
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.openTrades.forEach(({ timer }) => clearInterval(timer));
    this.openTrades.clear();
    this.recentlyTraded.clear();
    ledger.append({ type: 'HALT', symbol: 'ALL', message: `TRADING HALTED: ${reason}` });
    this.log('error', `TRADING HALTED: ${reason}`);
  }

  stop() {
    this.isRunning = false;
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.openTrades.forEach(({ timer }) => clearInterval(timer));
    this.openTrades.clear();
    this.recentlyTraded.clear();
    this.state = 'DISCONNECTED';
    this.log('info', 'Stopped.');
  }
}

export const autoTrader = new AutoTraderEngine();
