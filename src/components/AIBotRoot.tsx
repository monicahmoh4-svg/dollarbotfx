import { useState } from 'react';
import AIBotModal from './AIBotModal';
import { useAIBot } from '../hooks/useAIBot';

const buttonStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 24,
    right: 24,
    zIndex: 2147483645,
    background: '#111827',
    color: '#ffffff',
    border: '1px solid #374151',
    borderRadius: 999,
    padding: '12px 18px',
    cursor: 'pointer',
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
    fontWeight: 900,
    fontSize: 13,
};

export default function AIBotRoot() {
    const [open, setOpen] = useState(false);
    const { state } = useAIBot();

    return (
        <>
            <button
                type="button"
                style={buttonStyle}
                onClick={() => setOpen(true)}
            >
                AI Bot
                {' | '}
                {state.running ? 'ON' : 'OFF'}
                {' | '}
                {state.stats.net.toFixed(2)}
            </button>

            {open && <AIBotModal open={open} onClose={() => setOpen(false)} />}
        </>
    );
}
