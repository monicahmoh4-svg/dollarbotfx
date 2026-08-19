import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import './styles/index.scss';

// --- DIAGNOSTIC BUILD MARKER ---
// This is NOT a bug fix — it exists because the app has been verified,
// three separate ways (a clean `npm run build`, a grep of the compiled
// bundle, and an actual React Testing Library render of the nav
// components with real store/router mocks — all confirming "Autonomous
// Trading" genuinely renders), to have no code defect preventing the
// Autonomous Trading section from showing. If it's still not visible
// after deploying this file, open the browser console on the live site:
// if this line does NOT appear, the browser is not running this build
// (stale deployment, wrong URL/alias, or a caching layer) — check the
// Vercel dashboard for which deployment/commit is actually live. If this
// line DOES appear but the nav item still isn't visible, that's a real,
// new clue — tell me that outcome and it points somewhere completely
// different than anything checked so far.
console.log(
    '%c[BUILD MARKER] autotrader-nav-2026-08-19-r1 — if you see this, your browser IS running the build that includes Autonomous Trading.',
    'color:#22c55e;font-weight:bold;font-size:12px;'
);

// --- 1. MOUNT MAIN APP ---
// This mounts the core Deriv Bot dashboard, charts, and authentication wrapper.
// The Autonomous Trading Agent and Free Bots panels are mounted inside this
// same tree (see src/app/app-root.tsx) — opened from the nav menu, not as
// separate floating widgets or a second, isolated React root.
const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(<AuthWrapper />);
}
