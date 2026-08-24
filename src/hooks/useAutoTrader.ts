import { useEffect, useState } from 'react';
import { autoTrader, AutoTraderSettings } from '@/autotrader/engine';

export function useAutoTrader() {
    const [state, setState] = useState(() => autoTrader.getState());

    useEffect(() => {
        const handler = (event: Event) => setState((event as CustomEvent).detail);
        autoTrader.addEventListener('state', handler);
        return () => autoTrader.removeEventListener('state', handler);
    }, []);

    return {
        state,
        start: (settings: AutoTraderSettings = {}) => autoTrader.start(settings),
        stop: () => autoTrader.stop(),
        setMode: (mode: 'paper' | 'live') => autoTrader.setMode(mode),
        updateLimits: (patch: Partial<AutoTraderSettings> & Record<string, unknown>) =>
            autoTrader.updateLimits(patch as any),
    };
}
