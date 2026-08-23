import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useAutoTraderUI } from '@/hooks/useAutoTraderUI';
import { autoTrader, TRADE_CATEGORIES, SYNTHETIC_INDICES } from '@/autotrader/engine';

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
.at-panel { width: 100%; max-width: 900px; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; background: #0f172a; color: #e2e8f0; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
.at-header { padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, rgba(30, 64, 175, 0.2), rgba(15, 23, 42, 0)); }
.at-title { margin: 0; font-size: 18px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 10px; }
.at-status-dot { width: 10px; height: 10px; border-radius: 50%; background: #64748b; flex-shrink: 0; }
.at-status-dot.trading { background: #22c55e; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.2); animation: atPulse 2s infinite; }
.at-status-dot.halted { background: #ef4444; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2); }
.at-status-dot.ready { background: #3b82f6; }
.at-close { border: none; border-radius: 8px; padding: 8px 12px; background: rgba(255,255,255,0.1); color: #e2e8f0; font-weight: 600; cursor: pointer; transition: background 0.15s; }
.at-close:hover { background: rgba(255,255,255,0.2); }
.at-banner { margin: 16px 24px 0; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: #93c5fd; border-radius: 8px; padding: 12px 16px; font-size: 13px; line-height: 1.5; display: flex; align-items: center; gap: 8px; }
.at-banner.warn { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5; }
.at-tabbar { display: flex; gap: 4px; margin: 20px 24px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
.at-tab { border: none; background: none; color: #94a3b8; font-weight: 600; font-size: 13px; padding: 10px 16px; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
.at-tab.active { color: #f8fafc; border-color: #3b82f6; }
.at-tab:hover { color: #e2e8f0; }
.at-body { flex: 1; overflow-y: auto; padding: 20px 24px 24px; }
.at-section-title { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 20px 0 12px; }
.at-section-title:first-child { margin-top: 0; }
.at-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
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
.at-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; }
.at-badge-ok { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.at-badge-warn { background: rgba(239, 68, 68, 0.15); color: #f87171; }
@keyframes atFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes atPulse { 0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); } 70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); } 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); } }
`;

type Tab = 'dashboard' | 'config' | 'logs';

function AutoTraderPanel() {
  const { open, hide } = useAutoTraderUI();
  const store = useStore();
  const client = store?.client;
  
  const [state, setState] = useState(autoTrader.getState());
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [limits, setLimits] = useState(state.limits || {});

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
      alert('⚠️ Please log in to your Deriv account first.');
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
    // Safely update limits if the method exists, otherwise fallback to localStorage
    if ((autoTrader as any).updateLimits) {
      (autoTrader as any).updateLimits(limits);
    } else {
      localStorage.setItem('bot-risk-limits', JSON.stringify(limits));
      alert('Risk limits saved to local storage. Restart the bot to apply.');
    }
  };

  const isHalted = state.state === 'HALTED';
  const isTrading = state.state === 'TRADING' || state.state === 'READY';
  const dotClass = isHalted ? 'halted' : isTrading ? 'trading' : 'ready';

  return (
    <div className='at-overlay' onClick={hide}>
      <style>{styles}</style>
      <div className='at-panel' onClick={e => e.stopPropagation()}>
        <div className='at-header'>
          <div>
            <h2 className='at-title'>
              <span className={`at-status-dot ${dotClass}`} />
              Quantitative Trading Engine
            </h2>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              Live market streaming, multi-factor analysis, and strict risk enforcement.
            </div>
          </div>
          <button className='at-close' onClick={hide}>Close</button>
        </div>

        <div className={`at-banner ${isHalted ? 'warn' : ''}`}>
          {isHalted ? (
            <>🚨 <b>KILL SWITCH ACTIVE:</b> Trading halted due to risk limits or balance mismatch. Review logs.</>
          ) : isLoggedIn ? (
            <>✓ Logged in as <b style={{ color: '#fff' }}>{sessionLoginId}</b> ({isVirtualAccount ? 'DEMO' : 'REAL'} | {sessionCurrency})</>
          ) : (
            <>⚠️ Not logged into a Deriv account. Please log in first to enable trading.</>
          )}
        </div>

        <div className='at-tabbar'>
          {(['dashboard', 'config', 'logs'] as Tab[]).map(id => (
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
              <div className='at-section-title'>System Status & Reconciliation</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Engine State</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: isHalted ? '#f87171' : '#4ade80' }}>
                    {state.state}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Deriv Authoritative Balance</label>
                  <div style={{ fontSize: '14px', fontWeight: 700 }}>
                    {state.stats?.derivBalance != null ? `${sessionCurrency} ${state.stats.derivBalance.toFixed(2)}` : 'Syncing...'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Balance Drift</label>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: (state.stats?.balanceDifference || 0) > 0.5 ? '#f87171' : '#4ade80' }}>
                    {state.stats?.balanceDifference != null ? `$${state.stats.balanceDifference.toFixed(2)}` : 'N/A'}
                  </div>
                </div>
                <div className='at-field'>
                  <label>Reconciliation Health</label>
                  <span className={`at-badge ${state.stats?.isBalanceHealthy ? 'at-badge-ok' : 'at-badge-warn'}`}>
                    {state.stats?.isBalanceHealthy ? 'HEALTHY' : 'UNHEALTHY'}
                  </span>
                </div>
              </div>

              <div className='at-section-title'>Performance Metrics</div>
              <div className='at-stats'>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Net P/L</div>
                  <div className='at-stat-value' style={{ color: (state.stats?.net || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                    {(state.stats?.net || 0).toFixed(2)}
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
                  <div className='at-stat-value'>{state.stats?.lossStreak || 0}</div>
                </div9>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Trades Opened</div>
                  <div className='at-stat-value'>{state.stats?.tradesOpened || 0}</div>
                </div>
                <div className='at-stat-card'>
                  <div className='at-stat-label'>Market Scans</div>
                  <div className='at-stat-value'>{state.stats?.scanCount || 0}</div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'config' && (
            <>
              <div className='at-section-title'>Risk Management Limits</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Max Stake per Trade ({sessionCurrency})</label>
                  <input 
                    className='at-input' 
                    type='number' 
                    step='0.1' 
                    value={limits.maxStakePerTrade ?? 10} 
                    onChange={e => setLimits({ ...limits, maxStakePerTrade: Number(e.target.value) })} 
                  />
                </div>
                <div className='at-field'>
                  <label>Max Daily Loss ({sessionCurrency})</label>
                  <input 
                    className='at-input' 
                    type='number' 
                    value={limits.maxDailyLoss ?? 50} 
                    onChange={e => setLimits({ ...limits, maxDailyLoss: Number(e.target.value) })} 
                  />
                </div>
                <div className='at-field'>
                  <label>Max Consecutive Losses</label>
                  <input 
                    className='at-input' 
                    type='number' 
                    value={limits.maxConsecutiveLosses ?? 3} 
                    onChange={e => setLimits({ ...limits, maxConsecutiveLosses: Number(e.target.value) })} 
                  />
                </div>
                <div className='at-field'>
                  <label>Min Confidence Threshold (%)</label>
                  <input 
                    className='at-input' 
                    type='number' 
                    step='1' 
                    min='50' 
                    max='95' 
                    value={(limits.minConfidenceThreshold ?? 0.65) * 100} 
                    onChange={e => setLimits({ ...limits, minConfidenceThreshold: Number(e.target.value) / 100 })} 
                  />
                </div>
              </div>
              <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                <button className='at-button at-button-secondary' onClick={handleSaveLimits}>
                  Save Risk Configuration
                </button>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px', width: '100%' }}>
                  * Changes to risk limits require a bot restart to take full effect if not applied dynamically.
               . </div>
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
        </div>

        <div className='at-actions'>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            Markets: <b>{SYNTHETIC_INDICES.length} Synthetic Indices</b> • Categories: <b>{TRADE_CATEGORIES.length} Active</b>
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
