import React, { useState, useEffect } from 'react';
import { aiBot } from './ai-trading-bot';

export function AIBotControlPanel() {
    const [status, setStatus] = useState(aiBot.getStatus());
    const [config, setConfig] = useState(aiBot.config);

    useEffect(() => {
        const interval = setInterval(() => {
            setStatus(aiBot.getStatus());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const handleStart = async () => {
        try {
            await aiBot.start(config);
            setStatus(aiBot.getStatus());
        } catch (error) {
            alert(`Failed to start: ${error.message}`);
        }
    };

    const handleStop = () => {
        aiBot.stop();
        setStatus(aiBot.getStatus());
    };

    const updateConfig = (key, value) => {
        const newConfig = { ...config, [key]: value };
        setConfig(newConfig);
        aiBot.updateConfig(newConfig);
    };

    const winRate = status.stats.totalTrades > 0
        ? ((status.stats.wins / status.stats.totalTrades) * 100).toFixed(1)
        : 0;

    return (
        <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            width: '400px',
            maxHeight: '80vh',
            overflowY: 'auto',
            background: 'white',
            border: '2px solid #4CAF50',
            borderRadius: '10px',
            padding: '20px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            zIndex: 9999
        }}>
            <h2 style={{ margin: '0 0 20px 0', color: '#4CAF50' }}>
                🤖 AI Trading Bot
            </h2>

            {/* Status */}
            <div style={{ marginBottom: '20px' }}>
                <div style={{
                    padding: '10px',
                    background: status.enabled ? '#e8f5e9' : '#ffebee',
                    borderRadius: '5px',
                    marginBottom: '10px'
                }}>
                    <strong>Status:</strong> {status.enabled ? '🟢 Running' : '🔴 Stopped'}
                    <br />
                    <strong>Mode:</strong> {status.mode === 'live' ? '💰 Live' : '📝 Paper'}
                    <br />
                    <strong>Open Trades:</strong> {status.openTrades}
                </div>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                    fontSize: '14px'
                }}>
                    <div>
                        <strong>Total Trades:</strong> {status.stats.totalTrades}
                    </div>
                    <div>
                        <strong>Win Rate:</strong> {winRate}%
                    </div>
                    <div>
                        <strong>Wins:</strong> {status.stats.wins}
                    </div>
                    <div>
                        <strong>Losses:</strong> {status.stats.losses}
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <strong>Profit:</strong> 
                        <span style={{
                            color: status.stats.profit >= 0 ? 'green' : 'red',
                            fontWeight: 'bold'
                        }}>
                            {' '}{status.stats.profit.toFixed(2)} USD
                        </span>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div style={{ marginBottom: '20px' }}>
                {!status.enabled ? (
                    <button
                        onClick={handleStart}
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                            fontSize: '16px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        ▶️ Start Bot
                    </button>
                ) : (
                    <button
                        onClick={handleStop}
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                            fontSize: '16px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        ⏹️ Stop Bot
                    </button>
                )}
            </div>

            {/* Configuration */}
            <div style={{ marginBottom: '20px' }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Configuration</h3>
                
                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                        Mode:
                    </label>
                    <select
                        value={config.mode}
                        onChange={(e) => updateConfig('mode', e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '5px' }}
                        disabled={status.enabled}
                    >
                        <option value="paper">Paper Trading (Safe)</option>
                        <option value="live">Live Trading (Real Money)</option>
                    </select>
                </div>

                {config.mode === 'live' && (
                    <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                            API Token:
                        </label>
                        <input
                            type="password"
                            value={config.apiToken}
                            onChange={(e) => updateConfig('apiToken', e.target.value)}
                            placeholder="Enter your Deriv API token"
                            style={{ width: '100%', padding: '8px', borderRadius: '5px' }}
                            disabled={status.enabled}
                        />
                    </div>
                )}

                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                        Base Stake (USD):
                    </label>
                    <input
                        type="number"
                        value={config.baseStake}
                        onChange={(e) => updateConfig('baseStake', parseFloat(e.target.value))}
                        min="0.35"
                        step="0.1"
                        style={{ width: '100%', padding: '8px', borderRadius: '5px' }}
                        disabled={status.enabled}
                    />
                </div>

                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                        Daily Loss Limit (USD):
                    </label>
                    <input
                        type="number"
                        value={config.dailyLossLimit}
                        onChange={(e) => updateConfig('dailyLossLimit', parseFloat(e.target.value))}
                        min="10"
                        step="10"
                        style={{ width: '100%', padding: '8px', borderRadius: '5px' }}
                        disabled={status.enabled}
                    />
                </div>

                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                        <input
                            type="checkbox"
                            checked={config.martingaleEnabled}
                            onChange={(e) => updateConfig('martingaleEnabled', e.target.checked)}
                            disabled={status.enabled}
                        />
                        {' '}Enable Martingale
                    </label>
                </div>

                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                        Markets:
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                        {['volatility', 'forex', 'crypto', 'indices'].map(market => (
                            <label key={market} style={{ fontSize: '13px' }}>
                                <input
                                    type="checkbox"
                                    checked={config.markets[market]}
                                    onChange={(e) => updateConfig('markets', {
                                        ...config.markets,
                                        [market]: e.target.checked
                                    })}
                                    disabled={status.enabled}
                                />
                                {' '}{market.charAt(0).toUpperCase() + market.slice(1)}
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            {/* Logs */}
            <div>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Activity Log</h3>
                <div style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    background: '#f5f5f5',
                    padding: '10px',
                    borderRadius: '5px',
                    fontSize: '12px'
                }}>
                    {status.logs.length === 0 ? (
                        <div style={{ color: '#999' }}>No activity yet</div>
                    ) : (
                        status.logs.map((log, index) => (
                            <div
                                key={index}
                                style={{
                                    marginBottom: '5px',
                                    color: log.level === 'error' ? '#f44336' :
                                           log.level === 'success' ? '#4CAF50' : '#333'
                                }}
                            >
                                <span style={{ color: '#999' }}>[{log.time}]</span> {log.message}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
