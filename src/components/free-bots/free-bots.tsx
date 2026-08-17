// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { useFreeBotsUI } from '@/hooks/useFreeBotsUI';

/* ============================================================= */
/* FREE BOTS — makes the app's built-in trading strategies        */
/* visible under a dedicated section and loads them safely.       */
/*                                                                 */
/* This used to render its own floating "🎁 Free Bots" pill button */
/* bottom-left. It's now opened from the nav menu (desktop         */
/* MenuItems / mobile menu drawer) via freeBotsUIStore, so this    */
/* component only renders the modal itself — mount it once, e.g.   */
/* in app-root.tsx, the same way AIBotRoot is mounted.             */
/* ============================================================= */

const FREE_BOTS = [
    {
        id: 'martingale',
        title: '1 Tick Martingale',
        tag: 'Loss recovery',
        risk: 'High risk',
        description:
            'Trades 1-tick Rise/Fall contracts on volatility indices. After every losing trade the stake is multiplied to recover the drawdown, and it resets to the base stake after a win.',
        how: 'Market: Volatility indices · Duration: 1 tick · Money management: Martingale multiplier',
    },
    {
        id: 'dalembert',
        title: "1 Tick D'Alembert",
        tag: 'Progressive staking',
        risk: 'Medium risk',
        description:
            "Trades 1-tick contracts and adjusts the stake by one unit up after a loss and one unit down after a win, based on the D'Alembert progression.",
        how: 'Market: Volatility indices · Duration: 1 tick · Money management: Unit progression',
    },
    {
        id: 'oscar',
        title: "1 Tick Oscar's Grind",
        tag: 'Steady profit',
        risk: 'Low–medium risk',
        description:
            "A conservative grind strategy that raises the stake only after wins and aims to close each cycle with a small net profit of one unit.",
        how: 'Market: Volatility indices · Duration: 1 tick · Money management: Oscar\'s Grind',
    },
    {
        id: 'reverse-dalembert',
        title: "Reverse D'Alembert",
        tag: 'Win streak',
        risk: 'Medium risk',
        description:
            "The inverse of D'Alembert: the stake increases after wins and decreases after losses, aiming to capitalise on winning streaks while limiting exposure during losing runs.",
        how: 'Market: Volatility indices · Duration: 1 tick · Money management: Reverse progression',
    },
];

const styles = `
    .fb-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483001;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(5px);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        animation: fbFadeIn .18s ease;
    }
    @media (min-width: 768px) {
        .fb-overlay { align-items: center; padding: 24px; }
    }

    .fb-panel {
        width: 100%;
        max-width: 860px;
        max-height: 92vh;
        overflow: auto;
        background: #fff;
        color: #111827;
        border-radius: 20px 20px 0 0;
        padding: 18px;
        box-shadow: 0 30px 80px rgba(0,0,0,.35);
        animation: fbSlideUp .25s ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }
    @media (min-width: 768px) { .fb-panel { border-radius: 20px; padding: 22px; } }

    .fb-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
    .fb-title { margin: 0; font-size: 20px; font-weight: 900; }
    .fb-subtitle { margin-top: 4px; color: #6b7280; font-size: 12.5px; line-height: 1.5; }

    .fb-close {
        border: none; border-radius: 12px; padding: 10px 14px;
        background: #e5e7eb; color: #111827; font-weight: 800; cursor: pointer;
        transition: transform .15s ease;
    }
    .fb-close:hover { transform: translateY(-1px); }

    .fb-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 14px; }
    @media (min-width: 720px) { .fb-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

    .fb-card {
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        background: linear-gradient(180deg, #ffffff, #f8fffb);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 6px 18px rgba(15,23,42,.05);
        transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        animation: fbFadeIn .3s ease both;
    }
    .fb-card:hover { transform: translateY(-2px); box-shadow: 0 14px 36px rgba(15,23,42,.10); border-color: #a7f3d0; }

    .fb-card-title { font-size: 15px; font-weight: 900; }
    .fb-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .fb-chip {
        font-size: 10.5px; font-weight: 800; border-radius: 999px; padding: 3px 8px;
        background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
    }
    .fb-chip.risk-high { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .fb-chip.risk-med { background: #fffbeb; color: #b45309; border-color: #fde68a; }

    .fb-desc { font-size: 12.5px; color: #374151; line-height: 1.5; }
    .fb-how { font-size: 11px; color: #6b7280; line-height: 1.4; }

    .fb-use {
        margin-top: auto;
        border: none; border-radius: 12px; padding: 10px 14px;
        background: linear-gradient(135deg, #059669, #10b981);
        color: #fff; font-weight: 900; cursor: pointer;
        box-shadow: 0 10px 24px rgba(5,150,105,.22);
        transition: transform .15s ease, opacity .15s ease;
    }
    .fb-use:hover { transform: translateY(-1px); opacity: .94; }
    .fb-use:disabled { opacity: .6; cursor: wait; transform: none; }

    .fb-toast {
        position: fixed;
        left: 50%;
        bottom: max(24px, env(safe-area-inset-bottom));
        transform: translateX(-50%);
        z-index: 2147483002;
        background: #111827;
        color: #fff;
        border-radius: 12px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 700;
        box-shadow: 0 16px 40px rgba(0,0,0,.35);
        animation: fbSlideUp .25s ease;
        max-width: calc(100vw - 32px);
        text-align: center;
    }

    @keyframes fbFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fbSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
`;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* Find the deepest element whose text contains `text` (scores clickable tags higher). */
function findElementByText(text, root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll(
        'button, [role="button"], a, li, h1, h2, h3, h4, h5, h6, p, span, div'
    );
    let best = null;
    let bestScore = -1;

    nodes.forEach(el => {
        const own = (el.textContent || '').trim();
        if (!own || !own.includes(text)) return;

        // Prefer the deepest node (children must not also contain the text).
        const isDeepest = Array.from(el.children).every(
            c => !((c.textContent || '').trim().includes(text))
        );
        if (!isDeepest) return;

        let score = 1;
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || el.getAttribute('role') === 'button') score = 4;
        else if (tag === 'a') score = 3;
        const cls = String(el.className || '');
        if (/card|btn|button|quick|strategy|item/i.test(cls)) score += 2;

        if (score > bestScore) {
            bestScore = score;
            best = el;
        }
    });

    return best;
}

function clickEl(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
}

export default function FreeBots() {
    const { open, hide } = useFreeBotsUI();
    const [busy, setBusy] = useState(null);
    const [toast, setToast] = useState('');
    const toastTimer = useRef(null);

    useEffect(() => () => clearTimeout(toastTimer.current), []);

    const showToast = (msg, ms = 4200) => {
        setToast(msg);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(''), ms);
    };

    /* Drives the app's OWN native Quick Strategy loader, so the strategy
       is loaded exactly as if the user clicked it manually. */
    const useBot = async bot => {
        setBusy(bot.id);
        hide();
        await sleep(250);

        try {
            // 1) Make sure we are on the dashboard where the picker lives.
            let qs = findElementByText('Quick strategy');
            if (!qs) {
                clickEl(findElementByText('Dashboard'));
                await sleep(900);
                qs = findElementByText('Quick strategy');
            }

            if (!qs) {
                showToast('Could not find the strategy picker on this page. Open the Dashboard and try again.');
                setBusy(null);
                return;
            }

            // 2) Open the app's native Quick Strategy dialog.
            clickEl(qs);
            await sleep(900);

            // 3) Inside the dialog, click the strategy that matches this bot.
            let loaded = false;
            for (let attempt = 0; attempt < 10 && !loaded; attempt++) {
                const item = findElementByText(bot.title);
                if (item) {
                    clickEl(item);
                    await sleep(700);

                    // Some builds require a confirm button inside the dialog.
                    const confirmBtn =
                        findElementByText('Load') ||
                        findElementByText('Start') ||
                        findElementByText('Use') ||
                        findElementByText('Apply') ||
                        findElementByText('Create');
                    if (confirmBtn) clickEl(confirmBtn);

                    loaded = true;
                } else {
                    await sleep(500);
                }
            }

            if (loaded) {
                showToast(`"${bot.title}" loaded into the Bot Builder. Press Run to start it.`);
            } else {
                showToast(`The picker is open — tap "${bot.title}" to load it.`);
            }
        } catch (e) {
            showToast('Unable to load automatically. Open Dashboard → Quick strategy and select the bot.');
        }

        setBusy(null);
    };

    const riskClass = risk =>
        /high/i.test(risk) ? 'risk-high' : /medium/i.test(risk) ? 'risk-med' : '';

    return (
        <>
            <style>{styles}</style>

            {open && (
                <div className="fb-overlay" onClick={hide}>
                    <div className="fb-panel" onClick={e => e.stopPropagation()}>
                        <div className="fb-header">
                            <div>
                                <h2 className="fb-title">Free Bots — built-in strategies</h2>
                                <div className="fb-subtitle">
                                    These trading strategies already ship with this app. Tap
                                    "Use bot" and the strategy is loaded into the Bot Builder
                                    using the app's own loader, ready to run.
                                </div>
                            </div>
                            <button className="fb-close" onClick={hide}>
                                Close
                            </button>
                        </div>

                        <div className="fb-grid">
                            {FREE_BOTS.map(bot => (
                                <div className="fb-card" key={bot.id}>
                                    <div className="fb-card-title">{bot.title}</div>

                                    <div className="fb-chips">
                                        <span className="fb-chip">{bot.tag}</span>
                                        <span className={`fb-chip ${riskClass(bot.risk)}`}>
                                            {bot.risk}
                                        </span>
                                    </div>

                                    <div className="fb-desc">{bot.description}</div>
                                    <div className="fb-how">{bot.how}</div>

                                    <button
                                        className="fb-use"
                                        disabled={busy === bot.id}
                                        onClick={() => useBot(bot)}
                                    >
                                        {busy === bot.id ? 'Loading…' : 'Use bot'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {toast && <div className="fb-toast">{toast}</div>}
        </>
    );
}
