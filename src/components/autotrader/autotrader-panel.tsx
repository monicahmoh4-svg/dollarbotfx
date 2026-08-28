import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useAutoTraderUI } from '@/hooks/useAutoTraderUI';
import { autoTrader, TRADE_CATEGORIES, SYNTHETIC_INDICES } from '@/autotrader/engine';
import { runBacktest, walkForward, monteCarlo, fetchDerivHistory, type BacktestReport, type WalkForwardReport, type MonteCarloResult, type SendFn } from '@/autotrader/backtest';
import { loadStoredTicks } from '@/autotrader/history-store';

function getSessionCurrency(client: any): string {
  if (!client) return 'USD';
  if (client.currency) return client.currency;
  if (client.loginid && client.accounts && client.accounts[client.loginid]?.currency) {
    return client.accounts[client.loginid].currency;
  }
  return 'USD';
}

const styles = `
.at-overlay { position: fixed; inset: 0; z-index: 2147483300; background: rgba(9, 12, 20, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; animation: atFadeIn 0.2s ease; }
.at-panel { width: 100%; max-width: 950px; max-height: 92vh; overflow: hidden; display: flex; flex-direction: column; background: #0f172a; color: #e2e8f0; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
.at-header { padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, rgba(30, 64, 175, 0.2), rgba(15, 23, 42, 0)); }
.at-title { margin: 0; font-size: 18px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 10px; }
.at-status-dot { width: 10px; height: 10px; border-radius: 50%; background: #64748b; flex-shrink: 0; }
.at-status-dot.trading { background: #22c55e; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.2); animation: atPulse 2s infinite; }
.at-status-dot.halted { background: #ef4444; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2); }
.at-status-dot.ready { background: #3b82f6; }
.at-status-dot.cooldown { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.2); }
.at-close { border: none; border-radius: 8px; padding: 8px 12px; background: rgba(255,255,255,0.1); color: #e2e8f0; font-weight: 600; cursor: pointer; transition: background 0.15s; }
.at-close:hover { background: rgba(255,255,255,0.2); }
.at-banner { margin: 16px 24px 0; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: #93c5fd; border-radius: 8px; padding: 12px 16px; font-size: 13px; line-height: 1.5; display: flex; align-items: center; gap: 8px; }
.at-banner.warn { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5; }
.at-banner.info { background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.3); color: #86efac; }
.at-tabbar { display: flex; gap: 4px; margin: 20px 24px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
.at-tab { border: none; background: none; color: #94a3b8; font-weight: 600; font-size: 13px; padding: 10px 16px; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
.at-tab.active { color: #f8fafc; border-color: #3b82f6; }
.at-tab:hover { color: #e2e8f0; }
.at-body { flex: 1; overflow-y: auto; padding: 20px 24px 24px; }
.at-section-title { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 20px 0 12px; }
.at-section-title:first-child { margin-top: 0; }
.at-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.at-field label { display: block; font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 6px; }
.at-input { width: 100%; height: 38px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: #f8fafc; padding: 0 12px; outline: none; transition: all 0.15s; font-size: 13px; box-sizing: border-box; }
.at-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); }
.at-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 16px; }
.at-stat-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; }
.at-stat-label { color: #94a3b8; font-size: 11px; font-weight: 700; margin-bottom: 6px; text-transform: uppercase; }
.at-stat-value { font-size: 20px; font-weight: 700; color: #f8fafc; }
.at-actions { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(15, 23, 42, 0.5); flex-wrap: wrap; gap: 12px; }
.at-button { border: none; border-radius: 8px; padding: 10px 20px; font-weight: 700; cursor: pointer; font-size: 14px; transition: all 0.15s; }
.at-button:hover { transform: translateY(-1px); }
.at-button-primary { background: #22c55e; color: #fff; }
.at-button-primary:hover { background: #16a34a; }
.at-button-danger { background: #ef4444; color: #fff; }
.at-button-danger:hover { background: #dc2626; }
.at-button-secondary { background: rgba(255,255,255,0.1); color: #e2e8f0; }
.at-button-secondary:hover { background: rgba(255,255,255,0.15); }
.at-logs { max-height: 350px; overflow-y: auto; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; font-size: 12px; font-family: ui-monospace, monospace; }
.at-log-line { margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); word-break: break-word; display: flex; gap: 8px; }
.at-log-line:last-child { border-bottom: none; margin-bottom: 0; }
.at-progress-bar { width: 100%; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; margin-top: 8px; }
.at-progress-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a); transition: width 0.3s ease; }
.at-progress-fill.danger { background: linear-gradient(90deg, #ef4444, #dc2626); }
@keyframes atFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes atPulse { 0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); } 70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); } 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); } }
`;

type Tab = 'dashboard' | 'config' | 'logs' | 'backtest';

function AutoTraderPanel() {
  const { open, hide } = useAutoTraderUI();
  const store = useStore();
  const client = store?.client;

  const [state, setState] = useState(autoTrader.getState());
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [limits, setLimits] = useState(state.limits || {});

  // Backtest harness state (MASTER PROMPT §18-20)
  const [btSymbol, setBtSymbol] = useState('R_50');
  const [btDuration, setBtDuration] = useState(5);
  const [btStake, setBtStake] = useState(2);
  const [btLookback, setBtLookback] = useState(1000);
  const [btSource, setBtSource] = useState<'stored' | 'fetch'>('stored');
  const [btHours, setBtHours] = useState(24);
  const [btReport, setBtReport] = useState<BacktestReport | null>(null);
  const [btPrices, setBtPrices] = useState<number[]>([]);
  const [btWalk, setBtWalk] = useState<WalkForwardReport | null>(null);
  const [btMC, setBtMC] = useState<MonteCarloResult[] | null>(null);
  const [btRunning, setBtRunning] = useState(false);
  const [btMsg, setBtMsg] = useState('');
  const CATS = ['rise_fall', 'even_odd', 'over_under', 'matches_differs'] as const;

  const loadBacktestPrices = async (): Promise<number[]> => {
    if (btSource === 'stored') {
      const prices = await loadStoredTicks(btSymbol);
      return prices;
    }
    const api = autoTrader.getApiInstance();
    if (!api || typeof api.send !== 'function') {
      throw new Error('Bot API not connected. Start the engine (or connect) first.');
    }
    const end = Math.floor(Date.now() / 1000);
    const start = end - btHours * 3600;
    const hist = await fetchDerivHistory((api.send.bind(api)) as SendFn, btSymbol, start, end);
    return hist.map(h => h.price);
  };

  const runBacktestHandler = async () => {
    setBtRunning(true);
    setBtMsg('Loading ticks...');
    try {
      const prices = await loadBacktestPrices();
      setBtPrices(prices);
      if (prices.length < 400) {
        setBtMsg(`Not enough ticks (${prices.length}). Try fetching more history or a different symbol.`);
        return;
      }
      setBtMsg(`Running backtest on ${prices.length} ticks...`);
      const report = runBacktest(prices, btSymbol, { durationTicks: btDuration, stake: btStake, lookback: btLookback });
      setBtReport(report);
      setBtMC(null);
      setBtWalk(null);
      setBtMsg(`Done. Best category: ${report.bestCategory || 'none (all negative EV)'}`);
    } catch (e: any) {
      setBtMsg('Error: ' + (e?.message || e));
    } finally {
      setBtRunning(false);
    }
  };

  const runWalk = async () => {
    if (btPrices.length === 0) {
      setBtMsg('Run a backtest first to load tick data.');
      return;
    }
    setBtRunning(true);
    setBtMsg('Running walk-forward...');
    try {
      const wf = walkForward(btPrices, btSymbol, 5, { durationTicks: btDuration, stake: btStake, lookback: btLookback });
      setBtWalk(wf);
      setBtMsg('Walk-forward complete.');
    } finally {
      setBtRunning(false);
    }
  };

  const runMonteCarlo = () => {
    if (!btReport) return;
    setBtMC(monteCarlo(btReport, 1000));
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const newState = (event as CustomEvent).detail;
      setState(newState);
      if (newState.limits) setLimits(newState.limits);
    };
    autoTrader.addEventListener('state', handler);
    return () => autoTrader.removeEventListener('state', handler);
  }, []);

  if (!open) return null;

  const isLoggedIn = Boolean(client?.is_logged_in && client?.loginid);
  const sessionCurrency = getSessionCurrency(client);
  const sessionLoginId = isLoggedIn ? client?.loginid : '';
  const isVirtualAccount = Boolean(client?.is_virtual);

  const handleStart = async () => {
    if (!isLoggedIn) {
      alert('Please log in to your Deriv account first.');
      return;
    }

    let apiInstance = null;
    if (store) {
      const candidates = [
        store.app?.api_helpers_store?.ws,
        store.app?.api_helpers_store,
        store.client?.root_store?.common?.api,
        store.client?.common?.api,
        store.common?.api,
        store.core?.api,
      ];
      for (const cand of candidates) {
        if (cand && typeof cand.send === 'function') {
          apiInstance = cand;
          break;
        }
      }
    }

    await autoTrader.start({ client, apiInstance });
    setActiveTab('dashboard');
  };

  const handleStop = () => {
    autoTrader.stop();
  };

  const handleSaveLimits = () => {
    if ((autoTrader as any).updateLimits) {
      (autoTrader as any).updateLimits(limits);
      alert('Risk limits updated successfully.');
    } else {
      localStorage.setItem('bot-risk-limits', JSON.stringify(limits));
      alert('Risk limits saved to local storage. Restart the bot to apply.');
    }
  };

  const isHalted = state.state === 'HALTED';
  const isCooldown = state.state === 'COOLDOWN';
  const isTrading = state.state === 'TRADING' || state.state === 'READY';
  const dotClass = isHalted ? 'halted' : isCooldown ? 'cooldown' : isTrading ? 'trading' : 'ready';

  const sessionDuration = state.stats?.sessionDurationMs || 0;
  const sessionMinutes = Math.floor(sessionDuration / 60000);
  const sessionSeconds = Math.floor((sessionDuration % 60000) / 1000);
  const maxSessionMinutes = Math.floor((limits.maxSessionDurationMs || 86400000) / 60000);
  const sessionProgress = Math.min(100, (sessionDuration / (limits.maxSessionDurationMs || 86400000)) * 100);

  const profitProgress = Math.min(100, ((state.stats?.net || 0) / (limits.targetProfit || 50)) * 100);
  const lossProgress = Math.min(100, (Math.abs(state.stats?.dailyNet || 0) / (limits.maxDailyLoss || 20)) * 100);

  return (
    <div className='at-overlay' onClick={hide}>
      <style>{styles}</style>
      <div className='at-panel' onClick={e => e.stopPropagation()}>
        <div className='at-header'>
          <div>
            <h2 className='at-title'>
              <span className={`at-status-dot ${dotClass}`} />
              Autonomous Trading Engine
            </h2>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              Continuously scanning all Deriv markets with multi-factor analysis and strict risk enforcement.
            </div>
          </div>
          <button className='at-close' onClick={hide}>Close</button>
        </div>

        <div className={`at-banner ${isHalted ? 'warn' : isCooldown ? '' : isLoggedIn ? 'info' : ''}`} style={isCooldown ? { background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fcd34d' } : undefined}>
          {isHalted ? (
            <>Trading halted due to risk limits. Review logs.</>
          ) : isCooldown ? (
            <>Cooldown active. Resuming in {Math.ceil(Math.max(0, (state.stats?.cooldownUntil || 0) - Date.now()) / 1000)}s...</>
          ) : isLoggedIn ? (
            <>Logged in as <b style={{ color: '#fff' }}>{sessionLoginId}</b> ({isVirtualAccount ? 'DEMO' : 'REAL'} | {sessionCurrency}) | Markets: <b style={{ color: '#fff' }}>{state.marketsCount || 0}</b> | Scanning every 5s</>
          ) : (
            <>Not logged into a Deriv account. Please log in first to enable trading.</>
          )}
        </div>

        <div className='at-tabbar'>
          {(['dashboard', 'config', 'logs', 'backtest'] as Tab[]).map(id => (
            <button
              key={id}
              className={`at-tab ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {id.charAt(0).toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>

        <div className='at-body'>
          {activeTab === 'dashboard' && (
            <>
              <div className='at-section-title'>System Status</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Engine State</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: isHalted ? '#f87171' : isCooldown ? '#fcd34d' : '#4ade80' }}>
                    {state.state}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Deriv Balance</label>
                  <div style={{ fontSize: '14px', fontWeight: 700 }}>
                    {state.stats?.derivBalance != null ? `${sessionCurrency} ${state.stats.derivBalance.toFixed(2)}` : 'Syncing...'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Balance Drift</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: (state.stats?.balanceDifference || 0) > 0.5 ? '#f87171' : '#4ade80' }}>
                    {state.stats?.balanceDifference != null ? `${sessionCurrency} ${state.stats.balanceDifference.toFixed(2)}` : 'N/A'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Market Regime</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#60a5fa' }}>
                    {state.stats?.regime || 'UNCLEAR'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Realized P/L</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: (state.stats?.realizedPnl || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                    {state.stats?.realizedPnl != null ? `${sessionCurrency} ${(state.stats.realizedPnl || 0).toFixed(2)}` : 'N/A'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Reserved Stake (open)</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#f59e0b' }}>
                    {state.stats?.reservedStake != null ? `${sessionCurrency} ${state.stats.reservedStake.toFixed(2)}` : 'N/A'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Available Balance</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#4ade80' }}>
                    {state.stats?.availableBalance != null ? `${sessionCurrency} ${state.stats.availableBalance.toFixed(2)}` : 'N/A'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Markets Scanned</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#3b82f6' }}>
                    {state.stats?.marketsScanned || 0}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Signals Detected</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#a855f7' }}>
                    {state.stats?.signalsDetected || 0}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Session Duration</label>
                  <div style={{ fontSize: '14px', fontWeight: 700 }}>
                    {sessionMinutes}m {sessionSeconds}s / {maxSessionMinutes}m
                  </div>
                  <div className='at-progress-bar'>
                    <div className='at-progress-fill' style={{ width: `${sessionProgress}%` }} />
                  </div>
                </div>
              </div>

              <div className='at-section-title'>Trade Categories</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                {TRADE_CATEGORIES.map((cat) => {
                  const catTrades = cat.value === 'rise_fall' ? (state.stats?.riseFallTrades || 0)
                    : cat.value === 'even_odd' ? (state.stats?.evenOddTrades || 0)
                    : cat.value === 'over_under' ? (state.stats?.overUnderTrades || 0)
                    : (state.stats?.matchesDiffersTrades || 0);
                  const catStat = (state.stats?.categoryStats as any)?.[cat.value];
                  const expectancy = catStat?.expectancy || 0;
                  const disabled = Boolean(catStat?.disabled);
                  const isActive = catTrades > 0;
                  const colors: Record<string, string> = {
                    rise_fall: '#22c55e', even_odd: '#3b82f6', over_under: '#a855f7', matches_differs: '#f59e0b',
                  };
                  return (
                    <div key={cat.value} style={{
                      background: isActive ? `${colors[cat.value]}10` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${disabled ? '#ef444460' : isActive ? colors[cat.value] + '40' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px',
                    }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: disabled ? '#ef4444' : colors[cat.value], flexShrink: 0, boxShadow: isActive ? `0 0 6px ${disabled ? '#ef4444' : colors[cat.value]}` : 'none' }} />
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: isActive ? '#f8fafc' : '#94a3b8' }}>{cat.label}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {catTrades} trades{disabled ? ' • DISABLED' : ` • EV ${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(2)}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className='at-section-title'>Performance Metrics</div>
              <div className='at-stats'>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Net P/L</div>
                  <div className='at-stat-value' style={{ color: (state.stats?.net || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                    {(state.stats?.net || 0).toFixed(2)}
                  </div>
                  <div className='at-progress-bar'>
                    <div className='at-progress-fill' style={{ width: `${profitProgress}%` }} />
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                    Target: {limits.targetProfit || 50}
                  </div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Daily P/L</div>
                  <div className='at-stat-value' style={{ color: (state.stats?.dailyNet || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                    {(state.stats?.dailyNet || 0).toFixed(2)}
                  </div>
                  <div className='at-progress-bar'>
                    <div className={`at-progress-fill ${(state.stats?.dailyNet || 0) < 0 ? 'danger' : ''}`} style={{ width: `${lossProgress}%` }} />
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                    Stop Loss: -{limits.maxDailyLoss || 20}
                  </div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Wins</div>
                  <div className='at-stat-value' style={{ color: '#4ade80' }}>{state.stats?.wins || 0}</div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Losses</div>
                  <div className='at-stat-value' style={{ color: '#f87171' }}>{state.stats?.losses || 0}</div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Loss Streak</div>
                  <div className='at-stat-value'>{state.stats?.lossStreak || 0} / {limits.maxConsecutiveLosses || 5}</div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Trades Opened</div>
                  <div className='at-stat-value'>{state.stats?.tradesOpened || 0} / {limits.maxTradesPerSession || 200}</div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Scan Cycles</div>
                  <div className='at-stat-value' style={{ color: '#3b82f6' }}>{state.stats?.scanCount || 0}</div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Active Contracts</div>
                  <div className='at-stat-value' style={{ color: '#f59e0b' }}>{state.stats?.activeContracts || 0} / {limits.maxConcurrentTrades || 3}</div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'config' && (
            <>
              <div className='at-section-title'>Trade Sizing</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Max Stake per Trade ({sessionCurrency})</label>
                  <input
                    className='at-input'
                    type='number'
                    step='0.1'
                    value={limits.maxStakePerTrade ?? 2.0}
                    onChange={e => setLimits({ ...limits, maxStakePerTrade: Number(e.target.value) })}
                  />
                </div>
                <div className='at-field'>
                  <label>Max Risk per Trade (%)</label>
                  <input
                    className='at-input'
                    type='number'
                    step='0.1'
                    value={(limits.maxPercentRiskPerTrade ?? 0.01) * 100}
                    onChange={e => setLimits({ ...limits, maxPercentRiskPerTrade: Number(e.target.value) / 100 })}
                  />
                </div>
              </div>

              <div className='at-section-title'>Loss Limits</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Max Daily Loss ({sessionCurrency})</label>
                  <input
                    className='at-input'
                    type='number'
                    value={limits.maxDailyLoss ?? 20}
                    onChange={e => setLimits({ ...limits, maxDailyLoss: Number(e.target.value) })}
                  />
                </div>
                <div className='at-field'>
                  <label>Max Consecutive Losses</label>
                  <input
                    className='at-input'
                    type='number'
                    value={limits.maxConsecutiveLosses ?? 5}
                    onChange={e => setLimits({ ...limits, maxConsecutiveLosses: Number(e.target.value) })}
                  />
                </div>
                <div className='at-field'>
                  <label>Cooldown After Loss (seconds)</label>
                  <input
                    className='at-input'
                    type='number'
                    value={(limits.cooldownAfterLossMs ?? 30000) / 1000}
                    onChange={e => setLimits({ ...limits, cooldownAfterLossMs: Number(e.target.value) * 1000 })}
                  />
                </div>
              </div>

              <div className='at-section-title'>Profit Targets</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Target Profit ({sessionCurrency})</label>
                  <input
                    className='at-input'
                    type='number'
                    value={limits.targetProfit ?? 50}
                    onChange={e => setLimits({ ...limits, targetProfit: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className='at-section-title'>Session Limits</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Max Trades per Session</label>
                  <input
                    className='at-input'
                    type='number'
                    value={limits.maxTradesPerSession ?? 200}
                    onChange={e => setLimits({ ...limits, maxTradesPerSession: Number(e.target.value) })}
                  />
                </div>
                <div className='at-field'>
                  <label>Max Session Duration (hours)</label>
                  <input
                    className='at-input'
                    type='number'
                    step='0.5'
                    value={(limits.maxSessionDurationMs ?? 86400000) / 3600000}
                    onChange={e => setLimits({ ...limits, maxSessionDurationMs: Number(e.target.value) * 3600000 })}
                  />
                </div>
              </div>

              <div className='at-section-title'>Execution Parameters</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Min Confidence Threshold (%)</label>
                  <input
                    className='at-input'
                    type='number'
                    step='1'
                    min='50'
                    max='95'
                    value={(limits.minConfidenceThreshold ?? 0.70) * 100}
                    onChange={e => setLimits({ ...limits, minConfidenceThreshold: Number(e.target.value) / 100 })}
                  />
                </div>
                <div className='at-field'>
                  <label>Max Concurrent Trades</label>
                  <input
                    className='at-input'
                    type='number'
                    value={limits.maxConcurrentTrades ?? 3}
                    onChange={e => setLimits({ ...limits, maxConcurrentTrades: Number(e.target.value) })}
                  />
                </div>
                <div className='at-field'>
                  <label>Max Balance Tolerance ({sessionCurrency})</label>
                  <input
                    className='at-input'
                    type='number'
                    step='0.1'
                    value={limits.maxBalanceTolerance ?? 0.10}
                    onChange={e => setLimits({ ...limits, maxBalanceTolerance: Number(e.target.value) })}
                  />
                </div>
                <div className='at-field'>
                  <label>Contract Duration (ticks)</label>
                  <input
                    className='at-input'
                    type='number'
                    min='1'
                    max='10'
                    value={limits.contractDurationTicks ?? 5}
                    onChange={e => setLimits({ ...limits, contractDurationTicks: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                <button className='at-button at-button-secondary' onClick={handleSaveLimits}>
                  Save Risk Configuration
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>
                Changes take effect immediately. The bot will automatically stop when any limit is reached.
              </div>
            </>
          )}

          {activeTab === 'logs' && (
            <>
              <div className='at-section-title'>System Event Log</div>
              <div className='at-logs'>
                {(state.logs || []).length === 0 ? (
                  <div style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>No logs generated yet.</div>
                ) : (
                  (state.logs || []).map((log: any, index: number) => (
                    <div
                      key={`${log.time}-${index}`}
                      className='at-log-line'
                      style={{
                        color: log.level === 'error' ? '#f87171' : log.level === 'warn' ? '#fbbf24' : log.level === 'success' ? '#4ade80' : '#cbd5e1'
                      }}
                    >
                      <span style={{ opacity: 0.6 }}>[{log.time}]</span>
                      <span style={{ fontWeight: 600, minWidth: '50px' }}>{log.level.toUpperCase()}</span>
                      <span>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {activeTab === 'backtest' && (
            <>
              <div className='at-section-title'>Backtest Configuration (§18-20)</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Symbol</label>
                  <select className='at-input' value={btSymbol} onChange={e => setBtSymbol(e.target.value)}>
                    {SYNTHETIC_INDICES.map(m => (
                      <option key={m.symbol} value={m.symbol}>{m.symbol}</option>
                    ))}
                  </select>
                </div>
                <div className='at-field'>
                  <label>Data Source</label>
                  <select className='at-input' value={btSource} onChange={e => setBtSource(e.target.value as 'stored' | 'fetch')}>
                    <option value='stored'>Stored ticks (from live scanning)</option>
                    <option value='fetch'>Fetch from Deriv (last N hours)</option>
                  </select>
                </div>
                {btSource === 'fetch' && (
                  <div className='at-field'>
                    <label>History Window (hours)</label>
                    <input className='at-input' type='number' value={btHours} onChange={e => setBtHours(Number(e.target.value))} />
                  </div>
                )}
                <div className='at-field'>
                  <label>Duration (ticks)</label>
                  <input className='at-input' type='number' value={btDuration} onChange={e => setBtDuration(Number(e.target.value))} />
                </div>
                <div className='at-field'>
                  <label>Stake ({sessionCurrency})</label>
                  <input className='at-input' type='number' value={btStake} onChange={e => setBtStake(Number(e.target.value))} />
                </div>
                <div className='at-field'>
                  <label>Lookback (ticks)</label>
                  <input className='at-input' type='number' value={btLookback} onChange={e => setBtLookback(Number(e.target.value))} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button className='at-button at-button-primary' disabled={btRunning} onClick={runBacktestHandler}>
                  {btRunning ? 'Running...' : 'Run Backtest'}
                </button>
                <button className='at-button at-button-secondary' disabled={btRunning || btPrices.length === 0} onClick={runWalk}>
                  Walk-Forward
                </button>
                <button className='at-button at-button-secondary' disabled={!btReport} onClick={runMonteCarlo}>
                  Monte Carlo
                </button>
              </div>
              {btMsg && <div className='at-banner info' style={{ marginTop: '12px' }}>{btMsg}</div>}

              {btReport && (
                <>
                  <div className='at-section-title'>Per-Category Results (EV over {btReport.totalTicks} ticks)</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ color: '#94a3b8', textAlign: 'right' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Category</th>
                          <th style={{ padding: '8px' }}>Trades</th>
                          <th style={{ padding: '8px' }}>Win%</th>
                          <th style={{ padding: '8px' }}>Expectancy</th>
                          <th style={{ padding: '8px' }}>Profit Factor</th>
                          <th style={{ padding: '8px' }}>Max DD</th>
                          <th style={{ padding: '8px' }}>Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CATS.map(c => {
                          const cb = btReport.categories[c];
                          return (
                            <tr key={c} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'right' }}>
                              <td style={{ textAlign: 'left', padding: '8px', fontWeight: 700, color: btReport.bestCategory === c ? '#4ade80' : '#e2e8f0' }}>
                                {c}{btReport.bestCategory === c ? ' ★' : ''}
                              </td>
                              <td style={{ padding: '8px' }}>{cb.trades.length}</td>
                              <td style={{ padding: '8px' }}>{(cb.winRate * 100).toFixed(1)}</td>
                              <td style={{ padding: '8px', color: cb.expectancy >= 0 ? '#4ade80' : '#f87171' }}>
                                {cb.expectancy >= 0 ? '+' : ''}{cb.expectancy.toFixed(3)}
                              </td>
                              <td style={{ padding: '8px' }}>{cb.profitFactor === Infinity ? '∞' : cb.profitFactor.toFixed(2)}</td>
                              <td style={{ padding: '8px', color: '#f87171' }}>{cb.maxDrawdown.toFixed(2)}</td>
                              <td style={{ padding: '8px', color: cb.finalEquity >= 0 ? '#4ade80' : '#f87171' }}>{cb.finalEquity.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>
                    Digit categories (even/odd, over/under, matches/differs) are structurally negative-EV on Deriv; the backtest confirms this and the live MIN_SIGNAL_SCORE gate keeps them disabled in trading.
                  </div>
                </>
              )}

              {btWalk && (
                <>
                  <div className='at-section-title'>Walk-Forward Stability ({btWalk.totalFolds} folds)</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ color: '#94a3b8' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Fold</th>
                          {CATS.map(c => <th key={c} style={{ padding: '8px', textAlign: 'right' }}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {btWalk.folds.map((f, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <td style={{ padding: '8px', color: '#94a3b8' }}>Fold {i + 1}</td>
                            {CATS.map(c => (
                              <td key={c} style={{ padding: '8px', textAlign: 'right', color: f.expectancy[c] >= 0 ? '#4ade80' : '#f87171' }}>
                                {f.expectancy[c] >= 0 ? '+' : ''}{f.expectancy[c].toFixed(3)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#cbd5e1' }}>
                    Profitable folds: {CATS.map(c => `${c} ${btWalk.profitableFoldCount[c]}/${btWalk.totalFolds}`).join(' · ')}
                  </div>
                </>
              )}

              {btMC && (
                <>
                  <div className='at-section-title'>Monte Carlo (1000 resamples)</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ color: '#94a3b8' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Category</th>
                          <th style={{ padding: '8px' }}>Mean Equity</th>
                          <th style={{ padding: '8px' }}>P5</th>
                          <th style={{ padding: '8px' }}>P95</th>
                          <th style={{ padding: '8px' }}>P(Profit)</th>
                          <th style={{ padding: '8px' }}>P(Ruin)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {btMC.map(m => (
                          <tr key={m.category} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <td style={{ padding: '8px', fontWeight: 700 }}>{m.category}</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: m.meanFinalEquity >= 0 ? '#4ade80' : '#f87171' }}>{m.meanFinalEquity.toFixed(2)}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{m.p5.toFixed(2)}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{m.p95.toFixed(2)}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{(m.probProfit * 100).toFixed(0)}%</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: '#f87171' }}>{(m.probRuin * 100).toFixed(0)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className='at-actions'>
          <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <span>Markets: <b style={{ color: '#3b82f6' }}>{state.marketsCount || 0}</b></span>
            <span>Scanned: <b style={{ color: '#3b82f6' }}>{state.stats?.marketsScanned || 0}</b></span>
            <span>Signals: <b style={{ color: '#a855f7' }}>{state.stats?.signalsDetected || 0}</b></span>
            <span>Open: <b style={{ color: '#f59e0b' }}>{state.stats?.activeContracts || 0}/{limits.maxConcurrentTrades || 3}</b></span>
            <span>Cycles: <b style={{ color: '#64748b' }}>{state.stats?.scanCount || 0}</b></span>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            {!state.isRunning ? (
              <button className='at-button at-button-primary' onClick={handleStart}>
                Start Engine
              </button>
            ) : (
              <button className='at-button at-button-danger' onClick={handleStop}>
                Stop Engine
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default observer(AutoTraderPanel);
