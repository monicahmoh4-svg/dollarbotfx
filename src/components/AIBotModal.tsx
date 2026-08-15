import { useEffect, useState } from 'react';
import { useAIBot } from '../hooks/useAIBot';
import { AIBotSettings } from '../ai/engine';

const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.55)',
    zIndex: 2147483646,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
};

const modalStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 860,
    maxHeight: '90vh',
    overflow: 'auto',
    background: '#ffffff',
    color: '#111827',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
    fontFamily: 'Arial, sans-serif',
};

const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
};

const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 4,
    display: 'block',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
};

const buttonStyle: React.CSSProperties = {
    padding: '10px 16px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 800,
};

const logsStyle: React.CSSProperties = {
    marginTop: 16,
    maxHeight: 180,
    overflow: 'auto',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
};

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

    const set = <K extends keyof AIBotSettings>(key: K, value: AIBotSettings[K]) => {
        setForm(previous => ({
            ...previous,
            [key]: value,
        }));
    };

    const handleStart = async () => {
        await start(form);
    };

    const handleStop = () => {
        stop();
    };

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div style={modalStyle} onClick={event => event.stopPropagation()}>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 16,
                    }}
                >
                    <h2 style={{ margin: 0 }}>AI Synthetic Indices Bot</h2>
                    <button
                        onClick={onClose}
                        style={{
                            ...buttonStyle,
                            background: '#e5e7eb',
                            color: '#111827',
                        }}
                    >
                        Close
                    </button>
                </div>

                <div
                    style={{
                        background: '#fff7ed',
                        border: '1px solid #fdba74',
                        color: '#9a3412',
                        borderRadius: 10,
                        padding: 10,
                        marginBottom: 16,
                        fontSize: 12,
                        lineHeight: 1.5,
                    }}
                >
                    Risk warning: autonomous trading can lose money. This bot defaults to
                    paper trading. Use live mode only with a Deriv API token that has
                    trade permission. Martingale can rapidly exhaust your balance.
                </div>

                <div style={gridStyle}>
                    <div>
                        <label style={labelStyle}>Mode</label>
                        <select
                            style={inputStyle}
                            value={form.mode}
                            onChange={e => set('mode', e.target.value as AIBotSettings['mode'])}
                        >
                            <option value="paper">Paper / Simulation</option>
                            <option value="live">Live Trading</option>
                        </select>
                    </div>

                    <div>
                        <label style={labelStyle}>Deriv App ID</label>
                        <input
                            style={inputStyle}
                            value={form.appId}
                            onChange={e => set('appId', e.target.value)}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Deriv API Token</label>
                        <input
                            style={inputStyle}
                            type="password"
                            placeholder="Required only for live mode"
                            value={form.apiToken}
                            onChange={e => set('apiToken', e.target.value)}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Base Stake</label>
                        <input
                            style={inputStyle}
                            type="number"
                            step="0.01"
                            value={form.stake}
                            onChange={e => set('stake', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Currency</label>
                        <input
                            style={inputStyle}
                            value={form.currency}
                            onChange={e => set('currency', e.target.value)}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Duration</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.duration}
                            onChange={e => set('duration', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Duration Unit</label>
                        <select
                            style={inputStyle}
                            value={form.durationUnit}
                            onChange={e =>
                                set('durationUnit', e.target.value as AIBotSettings['durationUnit'])
                            }
                        >
                            <option value="t">Ticks</option>
                            <option value="s">Seconds</option>
                            <option value="m">Minutes</option>
                        </select>
                    </div>

                    <div>
                        <label style={labelStyle}>Minimum Confidence</label>
                        <input
                            style={inputStyle}
                            type="number"
                            step="0.01"
                            min="0.5"
                            max="0.95"
                            value={form.minConfidence}
                            onChange={e => set('minConfidence', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Max Volatility</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.maxVolatility}
                            onChange={e => set('maxVolatility', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Max Concurrent Trades</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.maxConcurrentTrades}
                            onChange={e => set('maxConcurrentTrades', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Daily Loss Limit</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.dailyLossLimit}
                            onChange={e => set('dailyLossLimit', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Daily Take Profit</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.takeProfit}
                            onChange={e => set('takeProfit', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Max Stake</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.maxStake}
                            onChange={e => set('maxStake', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Cooldown ms</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.cooldownMs}
                            onChange={e => set('cooldownMs', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Scan Interval ms</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.scanIntervalMs}
                            onChange={e => set('scanIntervalMs', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Market Symbols Override</label>
                        <input
                            style={inputStyle}
                            placeholder="Blank = all synthetic indices"
                            value={form.symbolsOverride}
                            onChange={e => set('symbolsOverride', e.target.value)}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Max Symbols</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.maxSymbols}
                            onChange={e => set('maxSymbols', Number(e.target.value))}
                        />
                    </div>
                </div>

                <div
                    style={{
                        marginTop: 16,
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: 12,
                    }}
                >
                    <label style={{ fontSize: 13 }}>
                        <input
                            type="checkbox"
                            checked={form.martingaleEnabled}
                            onChange={e => set('martingaleEnabled', e.target.checked)}
                        />{' '}
                        Enable Martingale
                    </label>

                    <div>
                        <label style={labelStyle}>Martingale Multiplier</label>
                        <input
                            style={inputStyle}
                            type="number"
                            step="0.1"
                            value={form.martingaleMultiplier}
                            onChange={e => set('martingaleMultiplier', Number(e.target.value))}
                        />
                    </div>

                    <div>
                        <label style={labelStyle}>Max Martingale Steps</label>
                        <input
                            style={inputStyle}
                            type="number"
                            value={form.maxMartingaleSteps}
                            onChange={e => set('maxMartingaleSteps', Number(e.target.value))}
                        />
                    </div>

                    <label style={{ fontSize: 13 }}>
                        <input
                            type="checkbox"
                            checked={form.requireProfitProjection}
                            onChange={e => set('requireProfitProjection', e.target.checked)}
                        />{' '}
                        Require Positive Projection
                    </label>

                    <div>
                        <label style={labelStyle}>Minimum Projected Edge</label>
                        <input
                            style={inputStyle}
                            type="number"
                            step="0.01"
                            value={form.minProjectedEdge}
                            onChange={e => set('minProjectedEdge', Number(e.target.value))}
                        />
                    </div>
                </div>

                <div
                    style={{
                        display: 'flex',
                        gap: 10,
                        marginTop: 18,
                        flexWrap: 'wrap',
                    }}
                >
                    {!state.running ? (
                        <button
                            onClick={handleStart}
                            style={{
                                ...buttonStyle,
                                background: '#16a34a',
                                color: '#ffffff',
                            }}
                        >
                            Start AI Bot
                        </button>
                    ) : (
                        <button
                            onClick={handleStop}
                            style={{
                                ...buttonStyle,
                                background: '#dc2626',
                                color: '#ffffff',
                            }}
                        >
                            Stop AI Bot
                        </button>
                    )}

                    <div style={{ fontSize: 13, alignSelf: 'center' }}>
                        Status: {state.running ? 'Running' : 'Stopped'} | Mode:{' '}
                        {state.settings.mode.toUpperCase()} | Connected:{' '}
                        {state.connected ? 'Yes' : 'No'} | Authorized:{' '}
                        {state.authorized ? 'Yes' : 'No'}
                    </div>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: 10,
                        marginTop: 16,
                    }}
                >
                    <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10 }}>
                        Net P/L
                        <div style={{ fontWeight: 900 }}>
                            {state.stats.net.toFixed(2)}
                        </div>
                    </div>

                    <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10 }}>
                        Daily P/L
                        <div style={{ fontWeight: 900 }}>
                            {state.stats.dailyNet.toFixed(2)}
                        </div>
                    </div>

                    <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10 }}>
                        Wins
                        <div style={{ fontWeight: 900 }}>{state.stats.wins}</div>
                    </div>

                    <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10 }}>
                        Losses
                        <div style={{ fontWeight: 900 }}>{state.stats.losses}</div>
                    </div>

                    <div style={{ background: '#f9fafb', borderRadius: 10, padding: 10 }}>
                        Open Trades
                        <div style={{ fontWeight: 900 }}>{state.stats.open}</div>
                    </div>
                </div>

                <div style={logsStyle}>
                    {state.logs.length === 0 ? (
                        <div>No logs yet.</div>
                    ) : (
                        state.logs.map((log, index) => (
                            <div
                                key={`${log.time}-${index}`}
                                style={{
                                    color:
                                        log.level === 'error'
                                            ? '#dc2626'
                                            : log.level === 'warn'
                                              ? '#b45309'
                                              : log.level === 'success'
                                                ? '#15803d'
                                                : '#111827',
                                    marginBottom: 4,
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
