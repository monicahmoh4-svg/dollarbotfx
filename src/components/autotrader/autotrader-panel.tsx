import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useAutoTrader } from '@/hooks/useAutoTrader';
import { useAutoTraderUI } from '@/hooks/useAutoTraderUI';
import { useStore } from '@/hooks/useStore';
import type { AutoTraderSettings } from '@/autotrader/engine';
import { MARKETS, SYNTHETIC_SYMBOL_PRESETS, TRADE_CATEGORIES } from '@/autotrader/engine';
import type { TradeCategory } from '@/autotrader/analysis';

function getSessionCurrency(client: any): string {
    if (!client) return 'USD';
    if (client.currency) return client.currency;
    if (client.loginid && client.accounts && client.accounts[client.loginid]?.currency) return client.accounts[client.loginid].currency;
    return 'USD';
}

const styles = `
.at-overlay { position: fixed; inset: 0; z-index: 2147483300; background: rgba(9, 12, 20, 0.6); backdrop-filter: blur(6px); display: flex; align-items: flex-end; justify-content: center; animation: atFadeIn 0.18s ease; }
@media (min-width: 900px) { .at-overlay { align-items: center; padding: 24px; } }
.at-panel { width: 100%; max-width: 1080px; max-height: 94vh; max-height: 94dvh; overflow: hidden; display: flex; flex-direction: column; background: #0b1220; color: #e5e7eb; border-radius: 20px 20px 0 0; box-shadow: 0 40px 100px rgba(0,0,0,.5); animation: atSlideUp 0.25s ease; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
@media (min-width: 900px) { .at-panel { border-radius: 20px; max-height: 90vh; } }
.at-header { padding: 18px 20px 14px; border-bottom: 1px solid rgba(255,255,255,.08); display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; background: linear-gradient(135deg, rgba(37,99,235,.16), rgba(124,58,237,.10)); }
.at-title { margin: 0; font-size: 19px; font-weight: 900; color: #fff; display: flex; align-items: center; gap: 10px; }
.at-title-dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; flex-shrink: 0; }
.at-title-dot.running { background: #4ade80; box-shadow: 0 0 0 4px rgba(74,222,128,.18); animation: atPulse 2s infinite; }
.at-subtitle { margin-top: 4px; color: #9ca3af; font-size: 12px; line-height: 1.5; max-width: 640px; }
.at-close { border: none; border-radius: 10px; padding: 9px 13px; background: rgba(255,255,255,.08); color: #e5e7eb; font-weight: 800; cursor: pointer; transition: background .15s ease; }
.at-close:hover { background: rgba(255,255,255,.15); }
.at-banner { margin: 14px 20px 0; background: rgba(74,222,128,.08); border: 1px solid rgba(74,222,128,.35); color: #bbf7d0; border-radius: 12px; padding: 10px 12px; font-size: 11.5px; line-height: 1.5; }
.at-session { margin: 10px 20px 0; border-radius: 12px; padding: 10px 12px; font-size: 12px; line-height: 1.5; border: 1px solid; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.at-session-ok { background: rgba(74,222,128,.08); border-color: rgba(74,222,128,.35); color: #bbf7d0; }
.at-session-warn { background: rgba(248,113,113,.08); border-color: rgba(248,113,113,.35); color: #fecaca; }
.at-session-badge { font-weight: 900; border-radius: 999px; padding: 4px 10px; font-size: 10.5px; background: rgba(255,255,255,.08); }
.at-tabbar { display: flex; gap: 4px; margin: 14px 20px 0; border-bottom: 1px solid rgba(255,255,255,.08); overflow-x: auto; }
.at-tab { border: none; background: none; color: #9ca3af; font-weight: 800; font-size: 12.5px; padding: 10px 14px; cursor: pointer; white-space: nowrap; border-bottom: 2px solid transparent; transition: color .15s ease, border-color .15s ease; }
.at-tab.active { color: #fff; border-color: #6366f1; }
.at-tab:hover { color: #e5e7eb; }
.at-body { flex: 1; overflow: auto; padding: 16px 20px 20px; }
.at-section-title { font-size: 12px; font-weight: 900; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; margin: 18px 0 10px; }
.at-section-title:first-child { margin-top: 0; }
.at-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 640px) { .at-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
@media (min-width: 980px) { .at-grid { grid-template-columns: repeat(3, minmax(0,1fr)); } }
.at-field label { display: block; font-size: 11.5px; font-weight: 800; color: #9ca3af; margin-bottom: 5px; }
.at-input { width: 100%; min-height: 38px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); color: #f3f4f6; padding: 9px 10px; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
.at-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.18); }
.at-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: #d1d5db; padding: 10px 0; }
.at-chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.at-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; padding: 7px 12px; font-size: 11.5px; font-weight: 800; cursor: pointer; user-select: none; color: #d1d5db; background: rgba(255,255,255,.03); transition: border-color .15s ease, background .15s ease, color .15s ease; }
.at-chip input { display: none; }
.at-chip-active { border-color: #6366f1; background: #6366f1; color: #fff; }
.at-preset-chip { border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 6px 11px; font-size: 11px; font-weight: 700; color: #a5b4fc; background: rgba(99,102,241,.08); cursor: pointer; }
.at-preset-chip:hover { background: rgba(99,102,241,.16); }
.at-hint { font-size: 11px; color: #6b7280; margin-top: 6px; line-height: 1.5; }
.at-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px 20px; border-top: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
.at-button { border: none; border-radius: 12px; padding: 12px 20px; font-weight: 900; cursor: pointer; font-size: 13.5px; transition: transform .15s ease, opacity .15s ease; }
.at-button:hover { transform: translateY(-1px); opacity: .95; }
.at-button-primary { background: linear-gradient(135deg, #16a34a, #22c55e); color: #fff; box-shadow: 0 10px 24px rgba(22,163,74,.28); }
.at-button-danger { background: linear-gradient(135deg, #dc2626, #ef4444); color: #fff; box-shadow: 0 10px 24px rgba(220,38,38,.28); }
.at-status { font-size: 11.5px; color: #9ca3af; line-height: 1.6; }
.at-status b { color: #e5e7eb; }
.at-activity-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #d1d5db; margin-bottom: 10px; flex-wrap: wrap; }
.at-scan-dot { width: 8px; height: 8px; border-radius: 50%; background: #4b5563; flex-shrink: 0; }
.at-scan-dot.active { background: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.22); animation: atPulse 1.2s infinite; }
.at-stats { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-top: 6px; }
@media (min-width: 700px) { .at-stats { grid-template-columns: repeat(3, minmax(0,1fr)); } }
@media (min-width: 980px) { .at-stats { grid-template-columns: repeat(6, minmax(0,1fr)); } }
.at-stat-card { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px 12px; }
.at-stat-label { color: #9ca3af; font-size: 10.5px; font-weight: 800; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .03em; }
.at-stat-value { font-size: 16px; font-weight: 950; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.at-trades { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
.at-trade-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; background: rgba(99,102,241,.08); border: 1px solid rgba(99,102,241,.28); border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #c7d2fe; }
.at-logs { margin-top: 4px; max-height: 420px; overflow: auto; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px; font-size: 12px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.at-log-line { margin-bottom: 4px; word-break: break-word; }
@keyframes atFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes atSlideUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes atPulse { 0% { box-shadow: 0 0 0 0 rgba(99,102,241,.4); } 70% { box-shadow: 0 0 0 8px rgba(99,102,241,0); } 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); } }
`;

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type Section = 'rules' | 'markets' | 'activity' | 'logs';

function AutoTraderPanel() {
  const { open, hide } = useAutoTraderUI();
  const { state, start, stop } = useAutoTrader();
  const store = useStore();
  const client = store?.client;
  
  const isLoggedIn = Boolean(client?.is_logged_in && client?.loginid);
  const sessionCurrency = getSessionCurrency(client);
  const sessionLoginId = isLoggedIn ? client?.loginid : '';
  const isVirtualAccount = Boolean(client?.is_virtual);

  const [form, setForm] = useState<AutoTraderSettings>(state.settings);
  const [section, setSection] = useState<Section>('rules');

  useEffect(() => {
    if (open) {
      setForm(previous => ({
        ...state.settings,
        currency: sessionCurrency || previous.currency || 'USD',
      }));
    }
  }, [open, sessionCurrency]);

  if (!open) return null;

  const set = (patch: Partial<AutoTraderSettings>) => {
    setForm(previous => ({ ...previous, ...patch }));
  };

  const toggleMarket = (value: string) => {
    setForm(previous => {
      const has = previous.enabledMarkets.includes(value);
      const next = has ? previous.enabledMarkets.filter(item => item !== value) : [...previous.enabledMarkets, value];
      return { ...previous, enabledMarkets: next.length ? next : previous.enabledMarkets };
    });
  };

  const toggleCategory = (value: TradeCategory) => {
    setForm(previous => {
      const has = previous.tradeCategories.includes(value);
      const next = has ? previous.tradeCategories.filter(item => item !== value) : [...previous.tradeCategories, value];
      return { ...previous, tradeCategories: next.length ? next : previous.tradeCategories };
    });
  };

  const handleStart = async () => {
    console.log('[PANEL] Starting bot');
    console.log('[PANEL] isLoggedIn:', isLoggedIn);
    console.log('[PANEL] client:', client);
    console.log('[PANEL] client.send type:', typeof client?.send);
    
    if (!isLoggedIn) {
      alert('⚠️ Please log in to your Deriv account first (top-right corner)');
      return;
    }
    
    await start({ 
        ...form, 
        currency: sessionCurrency || form.currency,
        client: client,  // Pass the entire client object
    });
    setSection('activity');
  };

  const handleStop = () => stop();

  return (
    <div className='at-overlay' onClick={hide}>
      <style>{styles}</style>
      <div className='at-panel' onClick={event => event.stopPropagation()}>
        <div className='at-header'>
          <div>
            <h2 className='at-title'>
              <span className={`at-title-dot ${state.running ? 'running' : ''}`} />
              Autonomous Trading Agent
            </h2>
            <div className='at-subtitle'>Fetches live Deriv market data, analyzes it, and executes trades autonomously.</div>
          </div>
          <button className='at-close' onClick={hide}>Close</button>
        </div>
        <div className='at-banner'>
          ✓ <b>No API token needed</b> — uses your logged-in Deriv session automatically.
        </div>
        <div className={`at-session ${isLoggedIn ? 'at-session-ok' : 'at-session-warn'}`}>
          <div>
            {isLoggedIn ? (
              <>Logged in as <b style={{ color: '#fff' }}>{sessionLoginId}</b>{sessionCurrency ? ` (${sessionCurrency})` : ''}.</>
            ) : (
              <>Not logged into a Deriv account. Please log in first.</>
            )}
          </div>
          <span className='at-session-badge'>{isLoggedIn ? (isVirtualAccount ? 'DEMO ACCOUNT' : 'REAL ACCOUNT') : 'NOT LOGGED IN'}</span>
        </div>
        <div className='at-tabbar'>
          {(['rules', 'markets', 'activity', 'logs'] as Section[]).map(id => (
            <button key={id} className={`at-tab ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}>
              {id.charAt(0).toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
        <div className='at-body'>
          {section === 'rules' && (
            <>
              <div className='at-section-title'>Mode &amp; Connection</div>
              <div className='at-grid'>
                <div className='at-field'>
                  <label>Mode</label>
                  <select className='at-input' value={form.mode} onChange={e => set({ mode: e.target.value as AutoTraderSettings['mode'] })}>
                    <option value='paper'>Paper / Simulation</option>
                    <option value='live' disabled={!isLoggedIn}>Live Trading{!isLoggedIn ? ' (log in first)' : ''}</option>
                  </select>
                </div>
                <div className='at-field'>
                  <label>Currency</label>
                  <input className='at-input' value={form.currency} onChange={e => set({ currency: e.target.value })} />
                </div>
              </div>
              <div className='at-section-title'>Stake &amp; Profit/Loss Rules</div>
              <div className='at-grid'>
                <div className='at-field'><label>Base Stake</label><input className='at-input' type='number' step='0.01' value={form.stake} onChange={e => set({ stake: toNumber(e.target.value, form.stake) })} /></div>
                <div className='at-field'><label>Take Profit</label><input className='at-input' type='number' value={form.takeProfit} onChange={e => set({ takeProfit: toNumber(e.target.value, form.takeProfit) })} /></div>
                <div className='at-field'><label>Max Loss</label><input className='at-input' type='number' value={form.dailyLossLimit} onChange={e => set({ dailyLossLimit: toNumber(e.target.value, form.dailyLossLimit) })} /></div>
                <div className='at-field'><label>Max Concurrent Trades</label><input className='at-input' type='number' value={form.maxConcurrentTrades} onChange={e => set({ maxConcurrentTrades: toNumber(e.target.value, form.maxConcurrentTrades) })} /></div>
              </div>
            </>
          )}
          {section === 'markets' && (
            <>
              <div className='at-section-title'>Trade Categories</div>
              <div className='at-chip-group'>
                {TRADE_CATEGORIES.map(category => (
                  <label key={category.value} className={`at-chip ${form.tradeCategories.includes(category.value) ? 'at-chip-active' : ''}`}>
                    <input type='checkbox' checked={form.tradeCategories.includes(category.value)} onChange={() => toggleCategory(category.value)} />
                    {category.label}
                  </label>
                ))}
              </div>
              <div className='at-section-title'>Signal Rules</div>
              <div className='at-grid'>
                <div className='at-field'><label>Minimum Confidence</label><input className='at-input' type='number' step='0.01' min='0.5' max='0.95' value={form.minConfidence} onChange={e => set({ minConfidence: toNumber(e.target.value, form.minConfidence) })} /></div>
                <div className='at-field'><label>Duration</label><input className='at-input' type='number' value={form.duration} onChange={e => set({ duration: toNumber(e.target.value, form.duration) })} /></div>
                <div className='at-field'>
                  <label>Duration Unit</label>
                  <select className='at-input' value={form.durationUnit} onChange={e => set({ durationUnit: e.target.value as AutoTraderSettings['durationUnit'] })}>
                    <option value='t'>Ticks</option>
                    <option value='s'>Seconds</option>
                    <option value='m'>Minutes</option>
                  </select>
                </div>
              </div>
            </>
          )}
          {section === 'activity' && (
            <>
              <div className='at-activity-row'>
                <span className={`at-scan-dot ${state.scanning ? 'active' : ''}`} />
                {state.scanning ? 'Scanning markets right now…' : state.running ? 'Idle between scans.' : 'Agent is stopped.'}
                {' · '} {state.stats.scanCount} scan(s) run
              </div>
              <div className='at-section-title'>Results</div>
              <div className='at-stats'>
                <div className='at-stat-card'><div className='at-stat-label'>Net P/L</div><div className='at-stat-value' style={{ color: state.stats.net >= 0 ? '#4ade80' : '#f87171' }}>{state.stats.net.toFixed(2)}</div></div>
                <div className='at-stat-card'><div className='at-stat-label'>Wins</div><div className='at-stat-value'>{state.stats.wins}</div></div>
                <div className='at-stat-card'><div className='at-stat-label'>Losses</div><div className='at-stat-value'>{state.stats.losses}</div></div>
                <div className='at-stat-card'><div className='at-stat-label'>Signals Found</div><div className='at-stat-value'>{state.stats.signalsFound}</div></div>
                <div className='at-stat-card'><div className='at-stat-label'>Prices Requested</div><div className='at-stat-value'>{state.stats.proposalsRequested}</div></div>
                <div className='at-stat-card'><div className='at-stat-label'>Trades Opened</div><div className='at-stat-value'>{state.stats.tradesOpened}</div></div>
              </div>
            </>
          )}
          {section === 'logs' && (
            <div className='at-logs'>
              {state.logs.length === 0 ? <div>No logs yet.</div> : state.logs.map((log, index) => (
                <div key={`${log.time}-${index}`} className='at-log-line' style={{ color: log.level === 'error' ? '#f87171' : log.level === 'warn' ? '#fbbf24' : log.level === 'success' ? '#4ade80' : '#d1d5db' }}>
                  [{log.time}] {log.message}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className='at-actions'>
          {!state.running ? (
            <button className='at-button at-button-primary' onClick={handleStart}>Enable Autonomous Trading</button>
          ) : (
            <button className='at-button at-button-danger' onClick={handleStop}>Disable Autonomous Trading</button>
          )}
          <div className='at-status'>
            Status: <b>{state.running ? 'Running' : 'Stopped'}</b> · Mode: <b>{state.settings.mode.toUpperCase()}</b> · Authorized: <b>{state.authorized ? 'Yes' : 'No'}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export default observer(AutoTraderPanel);
