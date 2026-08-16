import React from 'react';
import PropTypes from 'prop-types';
import ErrorComponent from './error-component';

const RELOAD_KEY = 'dbfx_boundary_reload_done';

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

        // SELF-HEAL: most load crashes are stale cached chunks after a redeploy.
        // Clear caches + service workers and reload exactly once.
        try {
            if (!sessionStorage.getItem(RELOAD_KEY)) {
                sessionStorage.setItem(RELOAD_KEY, '1');

                if ('caches' in window) {
                    caches
                        .keys()
                        .then(keys => keys.forEach(k => caches.delete(k)))
                        .catch(() => {});
                }

                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker
                        .getRegistrations()
                        .then(regs => regs.forEach(r => r.unregister()))
                        .catch(() => {});
                }

                setTimeout(() => window.location.reload(), 100);
            }
        } catch (e) {
            /* ignore */
        }
    }

    resetError = () => {
        try {
            sessionStorage.removeItem(RELOAD_KEY);
        } catch (e) {
            /* ignore */
        }
        this.setState({ hasError: false, error: null, info: null });
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        // If we are still on the fallback after 5s, allow future self-heal reloads again.
        try {
            setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 5000);
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
                message={`The application hit a problem while loading.${detail} Use Refresh to reload, or Try Again to retry without reloading.`}
                redirect_label="Try Again"
                redirectOnClick={this.resetError}
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
