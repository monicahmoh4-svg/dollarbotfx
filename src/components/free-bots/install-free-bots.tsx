// @ts-nocheck
import React from 'react';
import { createRoot } from 'react-dom/client';
import FreeBots from './free-bots';

const globalWindow = window as any;

if (!globalWindow.__freeBotsMounted__) {
    globalWindow.__freeBotsMounted__ = true;

    const mount = () => {
        let container = document.getElementById('free-bots-root');

        if (!container) {
            container = document.createElement('div');
            container.id = 'free-bots-root';
            document.body.appendChild(container);
        }

        const root = createRoot(container);
        root.render(<FreeBots />);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
}
