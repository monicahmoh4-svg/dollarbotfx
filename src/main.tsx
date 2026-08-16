import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AnalyticsInitializer } from './utils/analytics';
import { registerPWA } from './utils/pwa-utils';
import { AIBotControlPanel } from './ai/AIBotControlPanel';
import './styles/index.scss';

// Initialize analytics
AnalyticsInitializer();

// Register PWA service worker
registerPWA()
    .then(registration => {
        if (registration) {
            console.log('PWA service worker registered successfully for Chrome');
        } else {
            console.log('PWA service worker disabled for non-Chrome browser');
        }
    })
    .catch(error => {
        console.error('PWA service worker registration failed:', error);
    });

// --- 1. MOUNT MAIN APP ---
// This mounts the core Deriv Bot dashboard, charts, and authentication wrapper.
const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(<AuthWrapper />);
}

// --- 2. MOUNT AI BOT CONTROL PANEL ---
// We render the AI Bot in a completely separate React root. 
// This is critical for safety: it prevents the AI bot's rapid UI updates from 
// interfering with the main app's MobX stores, React Context, Error Boundaries, 
// and routing providers. It ensures the AI bot operates as an isolated overlay.
const aiBotContainer = document.createElement('div');
aiBotContainer.id = 'ai-bot-control-root';
document.body.appendChild(aiBotContainer);
ReactDOM.createRoot(aiBotContainer).render(<AIBotControlPanel />);
