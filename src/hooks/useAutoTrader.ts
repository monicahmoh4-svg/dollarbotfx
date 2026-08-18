import { useEffect, useState } from 'react';
import { autoTrader, AutoTraderSettings } from '@/autotrader/engine';

export type AutoTraderUIState = ReturnType<typeof autoTrader.getState>;

export function useAutoTrader() {
    const [state, setState] = useState<AutoTraderUIState>(() => autoTrader.getState());

    useEffect(() => {
        const listener = () => {
            setState(autoTrader.getState());
        };

        autoTrader.addEventListener('state', listener as EventListener);

        return () => {
            autoTrader.removeEventListener('state', listener as EventListener);
        };
    }, []);

    return {
        state,
        start: (settings?: Partial<AutoTraderSettings>) => autoTrader.start(settings),
        stop: () => autoTrader.stop(),
        updateSettings: (settings: Partial<AutoTraderSettings>) => autoTrader.updateSettings(settings),
    };
}

export default useAutoTrader;
