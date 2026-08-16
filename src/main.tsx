import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AIBotControlPanel } from './ai/AIBotControlPanel';
import './styles/index.scss';

// --- 1. MOUNT MAIN APP ---
// This mounts the core Deriv Bot dashboard, charts, and authentication wrapper.
const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(<AuthWrapper />);
}

// --- 2. MOUNT AI BOT CONTROL PANEL ---
// We render the AI Bot in a completely separate React root. 
// This isolates it from the main app's MobX stores, Context, and Error Boundaries,
// ensuring that rapid UI updates from the trading scanner cannot crash the main dashboard.
const aiBotContainer = document.createElement('div');
aiBotContainer.id = 'ai-bot-control-root';
document.body.appendChild(aiBotContainer);
ReactDOM.createRoot(aiBotContainer).render(<AIBotControlPanel />);
