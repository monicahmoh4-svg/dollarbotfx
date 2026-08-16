import React from 'react';
import PropTypes from 'prop-types';
import ErrorComponent from './error-component';

const HEAL_KEY = 'dbfx_heal_attempt';

const clearClientCaches = () => {
    try {
        if ('caches' in window) {
            caches
                .keys()
                .then(keys => keys.forEach(k => caches.delete(k)))
                .catch(() => {});
        }
    } catch (e) {
        /* ignore */
    }

    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .getRegistrations()
                .then(regs => regs.forEach(r => r.unregister()))
                .catch(() => {});
        }
    } catch (e) {
        /* ignore */
    }
};

/* True hard refresh: new URL => browser and edge cannot serve cached copies. */
const hardRefresh = () => {
    clearClientCaches();
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('cb', String(Date.now()));
        window.location.replace(url.toString());
    } catch (e) {
        window.location.reload();
    }
};

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, info: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        this.setState({ error, info });

        try {
            console.error('[ErrorBoundary] Caught error:', error, info);
        } catch (e) {
            /* ignore */
        }

        // SELF-HEAL ONCE: stale chunk / lazy-import mismatches are fixed by a
        // cache-busted hard redirect (not a plain reload).
        try {
            const attempted = sessionStorage.getItem(HEAL_KEY);

            if (!attempted) {
                sessionStorage.setItem(HEAL_KEY, '1');
                setTimeout(hardRefresh, 100);
            }
        } catch (e) {
            /* ignore */
        }
    }

    resetError = () => {
        try {
            sessionStorage.removeItem(HEAL_KEY);
        } catch (e) {
            /* ignore */
        }
        this.setState({ hasError: false, error: null, info: null });
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        // Allow future self-heals again after a while.
        try {
            setTimeout(() => sessionStorage.removeItem(HEAL_KEY), 5000);
        } catch (e) {
            /* ignore */
        }

        if (window.TrackJS) {
            window.TrackJS.console.log(this.props.root_store);
        }

        const detail =
            this.state.error && this.state.error.message
                ? ` Details: ${this.state.error.message}`
                : '';

        return (
            <ErrorComponent
                should_show_refresh={true}
                header="App Error"
                message={`The application hit a problem while loading.${detail} Press Hard Refresh to fetch a clean copy of the app.`}
                redirect_label="Hard Refresh"
                redirectOnClick={() => {
                    this.resetError();
                    hardRefresh();
                }}
            />
        );
    }
}

ErrorBoundary.propTypes = {
    root_store: PropTypes.object,
    children: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.arrayOf(PropTypes.node),
        PropTypes.node,
    ]),
};

export default ErrorBoundary;
