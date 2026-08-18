import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import './styles/index.scss';

// --- 1. MOUNT MAIN APP ---
// This mounts the core Deriv Bot dashboard, charts, and authentication wrapper.
// The Autonomous Trading Agent and Free Bots panels are mounted inside this
// same tree (see src/app/app-root.tsx) — opened from the nav menu, not as
// separate floating widgets or a second, isolated React root.
const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(<AuthWrapper />);
}
