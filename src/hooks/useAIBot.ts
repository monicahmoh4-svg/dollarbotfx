import { useEffect, useState } from 'react';
import { aiEngine, AIBotSettings } from '../ai/engine';

export type AIBotUIState = ReturnType<typeof aiEngine.getState>;

export function useAIBot() {
    const [state, setState] = useState<AIBotUIState>(() => aiEngine.getState());

    useEffect(() => {
        const listener = () => {
            setState(aiEngine.getState());
        };

        aiEngine.addEventListener('state', listener as EventListener);

        return () => {
            aiEngine.removeEventListener('state', listener as EventListener);
        };
    }, []);

    return {
        state,
        start: (settings?: Partial<AIBotSettings>) => aiEngine.start(settings),
        stop: () => aiEngine.stop(),
        updateSettings: (settings: Partial<AIBotSettings>) =>
            aiEngine.updateSettings(settings),
    };
}
