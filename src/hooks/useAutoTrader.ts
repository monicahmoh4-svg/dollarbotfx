import { useEffect, useState } from 'react';
import { autoTrader, AutoTraderSettings } from '@/autotrader/engine';

export function useAutoTrader() {
    const [state, setState] = useState(autoTrader.getState());

    useEffect(() => {
        const handler = (event: Event) => {
            const customEvent = event as CustomEvent;
            setState(customEvent.detail);
        };
        autoTrader.addEventListener('state', handler);
        return () => autoTrader.removeEventListener('state', handler);
    }, []);

    const start = async (patch: Partial<AutoTraderSettings> & { client?: any } = {}) => {
        await autoTrader.start(patch);
    };

    const stop = () => {
        autoTrader.stop();
    };

    return { state, start, stop };
}
