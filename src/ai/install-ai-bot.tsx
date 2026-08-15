import { createRoot } from 'react-dom/client';
import AIBotRoot from '../components/AIBotRoot';

const globalWindow = window as any;

if (!globalWindow.__aiBotMounted__) {
    globalWindow.__aiBotMounted__ = true;

    const mount = () => {
        let container = document.getElementById('ai-bot-root');

        if (!container) {
            container = document.createElement('div');
            container.id = 'ai-bot-root';
            document.body.appendChild(container);
        }

        createRoot(container).render(<AIBotRoot />);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
}
