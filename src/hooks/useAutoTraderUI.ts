import { useEffect, useState } from 'react';
import { autoTraderUIStore } from '@/components/autotrader/autotrader-ui-store';

export function useAutoTraderUI() {
    const [open, setOpen] = useState(() => autoTraderUIStore.isOpen());

    useEffect(() => {
        const handleChange = () => setOpen(autoTraderUIStore.isOpen());
        autoTraderUIStore.addEventListener('change', handleChange);

        return () => {
            autoTraderUIStore.removeEventListener('change', handleChange);
        };
    }, []);

    return {
        open,
        show: () => autoTraderUIStore.show(),
        hide: () => autoTraderUIStore.hide(),
        toggle: () => autoTraderUIStore.toggle(),
    };
}

export default useAutoTraderUI;
