import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { autoTraderUIStore } from '@/components/autotrader/autotrader-ui-store';
import { useAutoTrader } from '@/hooks/useAutoTrader';

// ---------------------------------------------------------------------------
// Strategic placement, deliberately:
// - Fixed to the viewport (not inside any scrollable page content, any tab,
//   or any nav drawer) so it is on screen on every page, every tab, at every
//   scroll position, with zero dependency on the user finding a hamburger
//   menu or the header rendering in "desktop" mode.
// - Bottom-right, clear of the bottom-left area other floating chrome (e.g.
//   a mobile back/nav bar) commonly occupies, and clear of the header/menu
//   at the top so it never overlaps the nav items that also open this panel.
// - z-index above the app but intentionally below the panel itself (the
//   panel is 2147483300), so opening the panel always draws over the button
//   with no flicker or stacking fight.
// ---------------------------------------------------------------------------

const fabStyle: CSSProperties = {
    position: 'fixed',
    right: 'max(16px, env(safe-area-inset-right))',
    bottom: 'max(16px, env(safe-area-inset-bottom))',
    zIndex: 2147483000,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: 'none',
    borderRadius: 999,
    padding: '13px 18px',
    color: '#ffffff',
    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #a855f7 100%)',
    boxShadow: '0 14px 34px rgba(79, 70, 229, 0.4)',
    fontWeight: 900,
    letterSpacing: 0.2,
    fontSize: 14,
    touchAction: 'manipulation',
    maxWidth: 'calc(100vw - 32px)',
    cursor: 'pointer',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
};

const dotStyle: CSSProperties = {
    width: 9,
    height: 9,
    borderRadius: '50%',
    flexShrink: 0,
};

const chipStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    padding: '3px 9px',
    fontSize: 11.5,
    fontWeight: 900,
    whiteSpace: 'nowrap',
};

function AutoTraderFab() {
    const { state } = useAutoTrader();

    const net = Number(state.stats.net || 0);
    const isPositive = net >= 0;

    return (
        <>
            <style>{`
                @keyframes autotraderFabPulse {
                    0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5); }
                    70% { box-shadow: 0 0 0 10px rgba(74, 222, 128, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
                }
                @keyframes autotraderFabScan {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.35; }
                }
                @keyframes autotraderFabIn {
                    from { opacity: 0; transform: translateY(16px) scale(0.9); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                .autotrader-fab {
                    animation: autotraderFabIn 0.3s ease;
                    transition: transform 0.18s ease, box-shadow 0.18s ease;
                }
                .autotrader-fab:hover {
                    transform: translateY(-2px) scale(1.03);
                    box-shadow: 0 20px 44px rgba(79, 70, 229, 0.48);
                }
                .autotrader-fab:active {
                    transform: scale(0.98);
                }
                .autotrader-fab-running {
                    animation: autotraderFabIn 0.3s ease, autotraderFabPulse 2.2s infinite;
                }
                .autotrader-fab-scan-dot {
                    animation: autotraderFabScan 1s infinite;
                }
                @media (max-width: 600px) {
                    .autotrader-fab {
                        padding: 11px 15px;
                        font-size: 12.5px;
                    }
                }
            `}</style>

            <button
                type='button'
                className={`autotrader-fab ${state.running ? 'autotrader-fab-running' : ''}`}
                style={fabStyle}
                onClick={() => autoTraderUIStore.show()}
                aria-label='Open Autonomous Trading Agent'
                title='Autonomous Trading Agent'
            >
                <span
                    className={state.scanning ? 'autotrader-fab-scan-dot' : ''}
                    style={{
                        ...dotStyle,
                        background: state.running ? '#4ade80' : '#e5e7eb',
                        boxShadow: state.running ? '0 0 0 4px rgba(74, 222, 128, 0.2)' : 'none',
                    }}
                />

                Auto Trader

                <span style={chipStyle}>{state.scanning ? 'SCANNING' : state.running ? 'ON' : 'OFF'}</span>

                <span style={{ ...chipStyle, color: isPositive ? '#dcfce7' : '#fee2e2' }}>{net.toFixed(2)}</span>
            </button>
        </>
    );
}

export default observer(AutoTraderFab);
