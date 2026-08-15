import { useState } from 'react';
import type { CSSProperties } from 'react';
import AIBotModal from './AIBotModal';
import { useAIBot } from '../hooks/useAIBot';

const fabBaseStyle: CSSProperties = {
    position: 'fixed',
    right: 'max(16px, env(safe-area-inset-right))',
    bottom: 'max(16px, env(safe-area-inset-bottom))',
    zIndex: 2147483645,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: 'none',
    borderRadius: 999,
    padding: '12px 16px',
    color: '#ffffff',
    background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
    boxShadow: '0 12px 30px rgba(37, 99, 235, 0.35)',
    fontWeight: 900,
    letterSpacing: 0.2,
    fontSize: 14,
    touchAction: 'manipulation',
    maxWidth: 'calc(100vw - 32px)',
    animation: 'aiSlideUp 0.3s ease',
    transition: 'transform 0.18s ease, box-shadow 0.18s ease',
};

const dotStyle: CSSProperties = {
    width: 9,
    height: 9,
    borderRadius: '50%',
    flexShrink: 0,
};

const chipStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
};

export default function AIBotRoot() {
    const [open, setOpen] = useState(false);
    const { state } = useAIBot();

    const net = Number(state.stats.net || 0);
    const isPositive = net >= 0;

    return (
        <>
            <style>{`
                .ai-fab:hover {
                    transform: translateY(-2px) scale(1.03);
                    box-shadow: 0 18px 40px rgba(37, 99, 235, 0.42);
                }

                .ai-fab:active {
                    transform: scale(0.98);
                }

                .ai-fab-running {
                    animation: aiPulse 2s infinite;
                }

                @media (max-width: 600px) {
                    .ai-fab {
                        padding: 10px 14px;
                        font-size: 12px;
                    }
                }
            `}</style>

            <button
                type="button"
                className={`ai-fab ${state.running ? 'ai-fab-running' : ''}`}
                style={fabBaseStyle}
                onClick={() => setOpen(true)}
                aria-label="Open AI Bot settings"
            >
                <span
                    style={{
                        ...dotStyle,
                        background: state.running ? '#4ade80' : '#d1d5db',
                        boxShadow: state.running
                            ? '0 0 0 4px rgba(74, 222, 128, 0.18)'
                            : 'none',
                    }}
                />

                AI Bot

                <span style={chipStyle}>
                    {state.running ? 'ON' : 'OFF'}
                </span>

                <span
                    style={{
                        ...chipStyle,
                        color: isPositive ? '#dcfce7' : '#fee2e2',
                    }}
                >
                    {net.toFixed(2)}
                </span>
            </button>

            {open && <AIBotModal open={open} onClose={() => setOpen(false)} />}
        </>
    );
}
