import React from 'react';
import { localize } from '@deriv-com/translations';
import PageErrorContainer from '../page-error-container';
import { standalone_routes } from '../shared/utils/routes';

type TErrorComponent = {
    header: string;
    message: string;
    redirect_label: string;
    redirectOnClick: () => void;
    should_clear_error_on_click: boolean;
    setError: (has_error: boolean, error: unknown) => void;
    redirect_to: string;
    should_redirect: boolean;
    should_show_refresh: boolean;
};

const ErrorComponent = ({
    header,
    message,
    redirect_label,
    redirectOnClick = null,
    should_clear_error_on_click,
    setError,
    redirect_to = standalone_routes.trade,
    should_redirect = true,
    should_show_refresh,
}: Partial<TErrorComponent>) => {
    
    // ROOT FIX FOR BLANK "Sorry for the interruption" MODAL:
    // When the app crashes or receives a raw WebSocket error, header and message 
    // are often undefined. We force fallback values so the modal is never blank.
    const safe_header = header || (should_show_refresh ? localize('App Error') : localize('Connection Error'));
    
    const safe_message = message || (should_show_refresh 
        ? localize('The application crashed while loading. Please refresh to try again. If this persists, clear your browser cache.') 
        : localize('Unable to connect to Deriv servers. If you are using a custom domain like Vercel, you MUST register a custom App ID in your Deriv account settings and whitelist this domain.'));

    return (
        <PageErrorContainer
            error_header={safe_header}
            error_messages={[safe_message, '']}
            redirect_urls={[redirect_to]}
            redirect_labels={(!redirect_label && []) || [redirect_label || localize('Refresh')]}
            buttonOnClick={redirectOnClick || (() => {
                // Clear cache and reload to fix stale service worker or chunk errors
                if ('caches' in window) {
                    caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
                }
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => reg.unregister()));
                }
                window.location.reload();
            })}
            should_clear_error_on_click={should_clear_error_on_click}
            setError={setError}
            should_redirect={should_redirect}
        />
    );
};

export default ErrorComponent;
