import { useEffect, useState } from 'react';
import { freeBotsUIStore } from '@/components/free-bots/free-bots-ui-store';

export function useFreeBotsUI() {
    const [open, setOpen] = useState(() => freeBotsUIStore.isOpen());

    useEffect(() => {
        const handleChange = () => setOpen(freeBotsUIStore.isOpen());
        freeBotsUIStore.addEventListener('change', handleChange);

        return () => {
            freeBotsUIStore.removeEventListener('change', handleChange);
        };
    }, []);

    return {
        open,
        show: () => freeBotsUIStore.show(),
        hide: () => freeBotsUIStore.hide(),
        toggle: () => freeBotsUIStore.toggle(),
    };
}

export default useFreeBotsUI;
