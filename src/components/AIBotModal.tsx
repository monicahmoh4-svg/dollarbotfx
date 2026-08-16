import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useAIBot } from '../hooks/useAIBot';
import { useStore } from '../hooks/useStore';
import type { AIBotSettings } from '../ai/engine';
import { MARKETS, TRADE_CATEGORIES } from '../ai/engine';
import type { TradeCategory } from '../ai/analysis';

const styles = `
    .ai-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding: 0;
        animation: aiFadeIn 0.18s ease;
    }

    @media (min-width: 768px) {
        .ai-overlay {
            align-items: center;
            padding: 24px;
        }
    }

    .ai-modal {
        width: 100%;
        max-width: 960px;
        max-height: 92vh;
        max-height: 92dvh;
        overflow: auto;
        background: #ffffff;
        color: #111827;
        border-radius: 20px 20px 0 0;
        padding: 18px;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
        animation: aiSlideUp 0.25s ease;
        font-family: inherit;
    }

    @media (min-width: 768px) {
        .ai-modal {
            border-radius: 20px;
            padding: 22px;
        }
    }

    .ai-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
    }

    .ai-title {
        margin: 0;
        font-size: 20px;
        font-weight: 900;
    }

    .ai-subtitle {
        margin-top: 4px;
        color: #6b7280;
        font-size: 12px;
        line-height: 1.4;
    }

    .ai-banner {
        background: #fff7ed;
        border: 1px solid #fdba74;
        color: #9a3412;
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
        margin-bottom: 16px;
    }

    .ai-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
    }

    @media (min-width: 700px) {
        .ai-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }

    @media (min-width: 1024px) {
        .ai-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }

    .ai-field label {
        display: block;
        font-size: 12px;
        font-weight: 800;
        color: #374151;
        margin-bottom: 5px;
    }

    .ai-input {
        width: 100%;
        min-height: 38px;
        border-radius: 10px;
        border: 1px solid #d1d5db;
        background: #fff;
        color: #111827;
        padding: 9px 10px;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .ai-input:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }

    .ai-checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 700;
        color: #374151;
        padding: 10px 0;
    }

    .ai-checkbox-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .ai-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        padding: 7px 12px;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        user-select: none;
        transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
        color: #374151;
        background: #fff;
    }

    .ai-chip input {
        display: none;
    }

    .ai-chip-active {
        border-color: #2563eb;
        background: #2563eb;
        color: #ffffff;
    }

    .ai-hint {
        font-size: 11px;
        color: #6b7280;
        margin-top: 6px;
        line-height: 1.5;
    }

    .ai-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin-top: 18px;
    }

    .ai-button {
        border: none;
        border-radius: 12px;
        padding: 11px 16px;
        font-weight: 900;
        cursor: pointer;
        transition: transform 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
    }

    .ai-button:hover {
        transform: translateY(-1px);
        opacity: 0.94;
    }

    .ai-button:active {
        transform: scale(0.99);
    }

    .ai-button-primary {
        background: linear-gradient(135deg, #16a34a, #22c55e);
        color: white;
        box-shadow: 0 10px 24px rgba(22, 163, 74, 0.22);
    }

    .ai-button-danger {
        background: linear-gradient(135deg, #dc2626, #ef4444);
        color: white;
        box-shadow: 0 10px 24px rgba(220, 38, 38, 0.22);
    }

    .ai-button-neutral {
        background: #e5e7eb;
        color: #111827;
    }

    .ai-status {
        font-size: 12px;
        color: #4b5563;
        line-height: 1.5;
    }

    .ai-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 16px;
    }

    @media (min-width: 900px) {
        .ai-stats {
            grid-template-columns: repeat(5, minmax(0, 1fr));
        }
    }

    .ai-stat-card {
        background: linear-gradient(180deg, #ffffff, #f9fafb);
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 10px 12px;
        min-width: 0;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
    }

    .ai-stat-label {
        color: #6b7280;
        font-size: 11px;
        font-weight: 800;
        margin-bottom: 4px;
    }

    .ai-stat-value {
        font-size: 16px;
        font-weight: 950;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-logs {
        margin-top: 16px;
        max-height: 190px;
        overflow: auto;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 10px;
        font-size: 12px;
        line-height: 1.5;
    }

    .ai-log-line {
        margin-bottom: 4px;
        word-break: break-word;
    }

    .ai-section-title {
        margin: 18px 0 10px;
        font-size: 13px;
        font-weight: 950;
        color: #111827;
    }

    .ai-session-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
        margin-bottom: 12px;
        border: 1px solid;
    }

    .ai-session-card-ok {
        background: #f0fdf4;
        border-color: #86efac;
        color: #14532d;
    }

    .ai-session-card-warn {
        background: #fef2f2;
        border-color: #fca5a5;
        color: #7f1d1d;
    }

    .ai-session-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 900;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 11px;
        background: rgba(255, 255, 255, 0.6);
    }

    .ai-activity-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #374151;
        margin-bottom: 8px;
    }

    .ai-scan-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        background: #d1d5db;
    }

    .ai-scan-dot-active {
        background: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
        animation: aiPulse 1.4s infinite;
    }

    .ai-trades-list {
        margin-top: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ai-trade-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 700;
        color: #1e3a8a;
    }

    @media (max-width: 767px) {
        .ai-title {
            font-size: 18px;
        }

        .ai-modal {
            padding: 14px;
        }

        .ai-stat-value {
            font-size: 14px;
        }
    }
`;

function toNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function AIBotModal({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const { state, start, stop } = useAIBot();
    const store = useStore();
    const client = store?.client;

    // The app already has its own authenticated Deriv session once the
    // user is logged in (client store / api_base). Rather than making the
    // person copy-paste a separate API token into this modal, we read that
    // session directly so Live mode "just works" as long as they're logged
    // in — matching how the rest of the app already trades.
    const isLoggedIn = Boolean(client?.is_logged_in && client?.loginid);
    const sessionToken = isLoggedIn && client?.getToken ? client.getToken() : '';
    const sessionCurrency = (isLoggedIn && client?.currency) || '';
    const sessionLoginId = isLoggedIn ? client?.loginid : '';
    const isVirtualAccount = Boolean(client?.is_virtual);

    const [form, setForm] = useState<AIBotSettings>(state.settings);

    useEffect(() => {
        if (open) {
            setForm(previous => ({
                ...state.settings,
                apiToken: state.settings.apiToken || sessionToken || previous.apiToken || '',
                currency: state.settings.currency || sessionCurrency || previous.currency || 'USD',
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sessionToken, sessionCurrency]);

    if (!open) {
        return null;
    }

    const set = (patch: Partial<AIBotSettings>) => {
        setForm(previous => ({
            ...previous,
            ...patch,
        }));
    };

    const toggleMarket = (value: string) => {
        setForm(previous => {
            const has = previous.enabledMarkets.includes(value);
            const next = has
                ? previous.enabledMarkets.filter(item => item !== value)
                : [...previous.enabledMarkets, value];

            return { ...previous, enabledMarkets: next.length ? next : previous.enabledMarkets };
        });
    };

    const toggleCategory = (value: TradeCategory) => {
        setForm(previous => {
            const has = previous.tradeCategories.includes(value);
            const next = has
                ? previous.tradeCategories.filter(item => item !== value)
                : [...previous.tradeCategories, value];

            return { ...previous, tradeCategories: next.length ? next : previous.tradeCategories };
        });
    };

    const handleStart = async () => {
        await start(form);
    };

    const handleStop = () => {
        stop();
    };

    return (
        <div className="ai-overlay" onClick={onClose}>
            <style>{styles}</style>

            <div className="ai-modal" onClick={event => event.stopPropagation()}>
                <div className="ai-header">
                    <div>
                        <h2 className="ai-title">AI Trading Bot</h2>
                        <div className="ai-subtitle">
                            Scans your selected Deriv markets, analyzes live ticks, and only trades
                            when your configured confidence and payout-edge rules are met.
                        </div>
                    </div>

                    <button className="ai-button ai-button-neutral" onClick={onClose}>
                        Close
                    </button>
                </div>

                <div className="ai-banner">
                    Risk warning: no algorithm can guarantee profits, and autonomous trading can
                    lose money quickly, especially with Martingale staking. This bot defaults to
                    paper (simulated) trading — only switch to Live with money you can afford to
                    lose. Digit contracts (even/odd, over/under, matches/differs) are close to a
                    fixed-odds coin flip by design — Deriv's synthetic indices use an audited RNG,
                    so this bot only enters those when the recent sample is a statistically
                    significant outlier versus the theoretical distribution, which will be rare —
                    that is expected behaviour, not a fault. Accumulator contracts are not yet
                    supported by this bot (different payout/exit mechanics from the timed
                    contracts below).
                </div>

                <div
                    className={`ai-session-card ${isLoggedIn ? 'ai-session-card-ok' : 'ai-session-card-warn'}`}
                >
                    <div>
                        {isLoggedIn ? (
                            <>
                                Logged in as <strong>{sessionLoginId}</strong>
                                {sessionCurrency ? ` (${sessionCurrency})` : ''}. This session will
                                be used automatically for Live trading — no separate token needed.
                            </>
                        ) : (
                            <>
                                You are not logged into a Deriv account in this app right now.
                                Paper mode works without logging in, but Live trading needs you to
                                log in first (or paste an API token below).
                            </>
                        )}
                    </div>

                    <span className="ai-session-badge">
                        {isLoggedIn ? (isVirtualAccount ? 'DEMO ACCOUNT' : 'REAL ACCOUNT') : 'NOT LOGGED IN'}
                    </span>
                </div>

                <div className="ai-section-title">Markets</div>

                <div className="ai-checkbox-group">
                    {MARKETS.map(market => (
                        <label
                            key={market.value}
                            className={`ai-chip ${form.enabledMarkets.includes(market.value) ? 'ai-chip-active' : ''}`}
                        >
                            <input
                                type="checkbox"
                                checked={form.enabledMarkets.includes(market.value)}
                                onChange={() => toggleMarket(market.value)}
                            />
                            {market.label}
                        </label>
                    ))}
                </div>

                <div className="ai-hint">
                    Forex, stock indices and commodities only trade while their exchange is open;
                    synthetic indices and cryptocurrencies trade continuously.
                </div>

                <div className="ai-section-title">Trade Categories</div>

                <div className="ai-checkbox-group">
                    {TRADE_CATEGORIES.map(category => (
                        <label
                            key={category.value}
                            className={`ai-chip ${
                                form.tradeCategories.includes(category.value) ? 'ai-chip-active' : ''
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={form.tradeCategories.includes(category.value)}
                                onChange={() => toggleCategory(category.value)}
                            />
                            {category.label}
                        </label>
                    ))}
                </div>

                <div className="ai-hint">
                    When more than one category qualifies on a symbol in the same scan, the bot
                    takes the one with the highest estimated confidence.
                </div>

                <div className="ai-section-title">Connection &amp; Execution</div>

                <div className="ai-grid">
                    <div className="ai-field">
                        <label>Mode</label>
                        <select
                            className="ai-input"
                            value={form.mode}
                            onChange={e =>
                                set({ mode: e.target.value as AIBotSettings['mode'] })
                            }
                        >
                            <option value="paper">Paper / Simulation</option>
                            <option value="live" disabled={!isLoggedIn && !form.apiToken}>
                                Live Trading{!isLoggedIn && !form.apiToken ? ' (log in or add a token first)' : ''}
                            </option>
                        </select>
                    </div>

                    <div className="ai-field">
                        <label>Deriv App ID</label>
                        <input
                            className="ai-input"
                            value={form.appId}
                            onChange={e => set({ appId: e.target.value })}
                        />
                    </div>

                    <div className="ai-field">
                        <label>Deriv API Token {isLoggedIn ? '(auto-filled from your login)' : ''}</label>
                        <input
                            className="ai-input"
                            type="password"
                            placeholder={
                                isLoggedIn
                                    ? 'Using your logged-in session — override only if needed'
                                    : 'Required for Live mode if you are not logged in'
                            }
                            value={form.apiToken}
                            onChange={e => set({ apiToken: e.target.value })}
                        />
                    </div>

                    <div className="ai-field">
                        <label>Base Stake</label>
                        <input
                            className="ai-input"
                            type="number"
                            step="0.01"
                            value={form.stake}
                            onChange={e =>
                                set({ stake: toNumber(e.target.value, form.stake) })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Currency</label>
                        <input
                            className="ai-input"
                            value={form.currency}
                            onChange={e => set({ currency: e.target.value })}
                        />
                    </div>

                    <div className="ai-field">
                        <label>Duration</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.duration}
                            onChange={e =>
                                set({ duration: toNumber(e.target.value, form.duration) })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Duration Unit</label>
                        <select
                            className="ai-input"
                            value={form.durationUnit}
                            onChange={e =>
                                set({
                                    durationUnit: e.target.value as AIBotSettings['durationUnit'],
                                })
                            }
                        >
                            <option value="t">Ticks</option>
                            <option value="s">Seconds</option>
                            <option value="m">Minutes</option>
                        </select>
                    </div>

                    <div className="ai-hint" style={{ gridColumn: '1 / -1', marginTop: -4 }}>
                        Digit categories (even/odd, over/under, matches/differs) always trade in
                        ticks (1-10), regardless of this setting — it only applies to Rise/Fall.
                    </div>

                    <div className="ai-field">
                        <label>Max Concurrent Trades</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.maxConcurrentTrades}
                            onChange={e =>
                                set({
                                    maxConcurrentTrades: toNumber(
                                        e.target.value,
                                        form.maxConcurrentTrades
                                    ),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Cooldown ms</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.cooldownMs}
                            onChange={e =>
                                set({ cooldownMs: toNumber(e.target.value, form.cooldownMs) })
                            }
                        />
                    </div>
                </div>

                <div className="ai-section-title">AI Entry Rules</div>

                <div className="ai-grid">
                    <div className="ai-field">
                        <label>Minimum Confidence</label>
                        <input
                            className="ai-input"
                            type="number"
                            step="0.01"
                            min="0.5"
                            max="0.95"
                            value={form.minConfidence}
                            onChange={e =>
                                set({
                                    minConfidence: toNumber(e.target.value, form.minConfidence),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Max Volatility (Rise/Fall only)</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.maxVolatility}
                            onChange={e =>
                                set({
                                    maxVolatility: toNumber(e.target.value, form.maxVolatility),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Minimum Projected Edge</label>
                        <input
                            className="ai-input"
                            type="number"
                            step="0.01"
                            value={form.minProjectedEdge}
                            onChange={e =>
                                set({
                                    minProjectedEdge: toNumber(
                                        e.target.value,
                                        form.minProjectedEdge
                                    ),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Scan Interval ms</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.scanIntervalMs}
                            onChange={e =>
                                set({
                                    scanIntervalMs: toNumber(e.target.value, form.scanIntervalMs),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Scan Batch Delay ms</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.scanBatchDelayMs}
                            onChange={e =>
                                set({
                                    scanBatchDelayMs: toNumber(
                                        e.target.value,
                                        form.scanBatchDelayMs
                                    ),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Max Symbols</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.maxSymbols}
                            onChange={e =>
                                set({ maxSymbols: toNumber(e.target.value, form.maxSymbols) })
                            }
                        />
                    </div>

                    <div className="ai-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Market Symbols Override</label>
                        <input
                            className="ai-input"
                            placeholder="Blank = all symbols from the selected markets. Example: R_10,R_25,frxEURUSD"
                            value={form.symbolsOverride}
                            onChange={e => set({ symbolsOverride: e.target.value })}
                        />
                    </div>
                </div>

                <div className="ai-section-title">Risk Management</div>

                <div className="ai-grid">
                    <div className="ai-field">
                        <label>Daily Loss Limit</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.dailyLossLimit}
                            onChange={e =>
                                set({
                                    dailyLossLimit: toNumber(e.target.value, form.dailyLossLimit),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Daily Take Profit</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.takeProfit}
                            onChange={e =>
                                set({ takeProfit: toNumber(e.target.value, form.takeProfit) })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Max Stake</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.maxStake}
                            onChange={e =>
                                set({ maxStake: toNumber(e.target.value, form.maxStake) })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Martingale Multiplier</label>
                        <input
                            className="ai-input"
                            type="number"
                            step="0.1"
                            value={form.martingaleMultiplier}
                            onChange={e =>
                                set({
                                    martingaleMultiplier: toNumber(
                                        e.target.value,
                                        form.martingaleMultiplier
                                    ),
                                })
                            }
                        />
                    </div>

                    <div className="ai-field">
                        <label>Max Martingale Steps</label>
                        <input
                            className="ai-input"
                            type="number"
                            value={form.maxMartingaleSteps}
                            onChange={e =>
                                set({
                                    maxMartingaleSteps: toNumber(
                                        e.target.value,
                                        form.maxMartingaleSteps
                                    ),
                                })
                            }
                        />
                    </div>

                    <label className="ai-checkbox-row">
                        <input
                            type="checkbox"
                            checked={form.martingaleEnabled}
                            onChange={e => set({ martingaleEnabled: e.target.checked })}
                        />
                        Enable Martingale
                    </label>

                    <label className="ai-checkbox-row">
                        <input
                            type="checkbox"
                            checked={form.requireProfitProjection}
                            onChange={e => set({ requireProfitProjection: e.target.checked })}
                        />
                        Require Positive Projection
                    </label>
                </div>

                <div className="ai-actions">
                    {!state.running ? (
                        <button
                            className="ai-button ai-button-primary"
                            onClick={handleStart}
                        >
                            Start AI Bot
                        </button>
                    ) : (
                        <button className="ai-button ai-button-danger" onClick={handleStop}>
                            Stop AI Bot
                        </button>
                    )}

                    <div className="ai-status">
                        Status: {state.running ? 'Running' : 'Stopped'}
                        <br />
                        Mode: {state.settings.mode.toUpperCase()}
                        <br />
                        Connected: {state.connected ? 'Yes' : 'No'}
                        <br />
                        Authorized: {state.authorized ? 'Yes' : 'No'}
                        {state.settings.mode === 'paper' && (
                            <span style={{ color: '#9ca3af' }}> (only needed for Live mode)</span>
                        )}
                    </div>
                </div>

                <div className="ai-activity-row">
                    <span className={`ai-scan-dot ${state.scanning ? 'ai-scan-dot-active' : ''}`} />
                    {state.scanning
                        ? 'Scanning markets right now…'
                        : state.running
                          ? 'Idle between scans — next scan will start automatically.'
                          : 'Bot is stopped.'}
                    {' · '}
                    {state.symbolCount} symbol(s) tracked · {state.stats.scanCount} scan(s) run
                    {state.stats.lastScanAt
                        ? ` · last scan ${new Date(state.stats.lastScanAt).toLocaleTimeString()}`
                        : ''}
                </div>

                {state.running && (
                    <div className="ai-hint" style={{ marginBottom: 10 }}>
                        {state.stats.lastScanSummary}
                    </div>
                )}

                {state.openTrades.length > 0 && (
                    <div className="ai-trades-list">
                        {state.openTrades.map(trade => (
                            <div key={trade.id} className="ai-trade-row">
                                <span>
                                    {trade.symbol} · {trade.contractType}
                                    {trade.barrier !== null ? `(${trade.barrier})` : ''}
                                    {trade.direction ? ` ${trade.direction}` : ''}
                                </span>
                                <span>
                                    stake {trade.stake} · {trade.mode.toUpperCase()}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="ai-stats">
                    <div className="ai-stat-card">
                        <div className="ai-stat-label">Net P/L</div>
                        <div
                            className="ai-stat-value"
                            style={{
                                color: state.stats.net >= 0 ? '#16a34a' : '#dc2626',
                            }}
                        >
                            {state.stats.net.toFixed(2)}
                        </div>
                    </div>

                    <div className="ai-stat-card">
                        <div className="ai-stat-label">Daily P/L</div>
                        <div
                            className="ai-stat-value"
                            style={{
                                color: state.stats.dailyNet >= 0 ? '#16a34a' : '#dc2626',
                            }}
                        >
                            {state.stats.dailyNet.toFixed(2)}
                        </div>
                    </div>

                    <div className="ai-stat-card">
                        <div className="ai-stat-label">Wins</div>
                        <div className="ai-stat-value">{state.stats.wins}</div>
                    </div>

                    <div className="ai-stat-card">
                        <div className="ai-stat-label">Losses</div>
                        <div className="ai-stat-value">{state.stats.losses}</div>
                    </div>

                    <div className="ai-stat-card">
                        <div className="ai-stat-label">Open Trades</div>
                        <div className="ai-stat-value">{state.stats.open}</div>
                    </div>

                    <div className="ai-stat-card">
                        <div className="ai-stat-label">Win Rate</div>
                        <div className="ai-stat-value">
                            {state.stats.wins + state.stats.losses > 0
                                ? `${((state.stats.wins / (state.stats.wins + state.stats.losses)) * 100).toFixed(0)}%`
                                : '—'}
                        </div>
                    </div>

                    <div className="ai-stat-card">
                        <div className="ai-stat-label">Scans Run</div>
                        <div className="ai-stat-value">{state.stats.scanCount}</div>
                    </div>
                </div>

                <div className="ai-logs">
                    {state.logs.length === 0 ? (
                        <div>No logs yet.</div>
                    ) : (
                        state.logs.map((log, index) => (
                            <div
                                key={`${log.time}-${index}`}
                                className="ai-log-line"
                                style={{
                                    color:
                                        log.level === 'error'
                                            ? '#dc2626'
                                            : log.level === 'warn'
                                              ? '#b45309'
                                              : log.level === 'success'
                                                ? '#15803d'
                                                : '#111827',
                                }}
                            >
                                [{log.time}] {log.message}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export default observer(AIBotModal);
