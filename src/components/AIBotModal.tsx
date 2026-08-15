import { useEffect, useState } from 'react';
import { useAIBot } from '../hooks/useAIBot';
import type { AIBotSettings } from '../ai/engine';

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

export default function AIBotModal({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const { state, start, stop } = useAIBot();
    const [form, setForm] = useState<AIBotSettings>(state.settings);

    useEffect(() => {
        if (open) {
            setForm(state.settings);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) {
        return null;
    }

    const set = (patch: Partial<AIBotSettings>) => {
        setForm(previous => ({
            ...previous,
            ...patch,
        }));
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
                        <h2 className="ai-title">AI Synthetic Indices Bot</h2>
                        <div className="ai-subtitle">
                            Scans synthetic markets, analyzes live ticks, and executes only when
                            your configured confidence and projection rules are met.
                        </div>
                    </div>

                    <button className="ai-button ai-button-neutral" onClick={onClose}>
                        Close
                    </button>
                </div>

                <div className="ai-banner">
                    Risk warning: autonomous trading can lose money. This bot defaults to paper
                    trading. Use live mode only with a Deriv API token that has trade permission.
                    Martingale can rapidly exhaust your balance.
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
                            <option value="live">Live Trading</option>
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
                        <label>Deriv API Token</label>
                        <input
                            className="ai-input"
                            type="password"
                            placeholder="Required only for live mode"
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
                        <label>Max Volatility</label>
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
                            placeholder="Blank = all synthetic indices. Example: R_10,R_25,R_50"
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
                    </div>
                </div>

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
