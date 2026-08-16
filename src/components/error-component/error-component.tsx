// @ts-nocheck
import React from 'react';
import { localize } from '@deriv-com/translations';
import PageErrorContainer from '../page-error-container';

const safeLocalize = (text: string) => {
    try {
        return localize(text);
    } catch (e) {
        return text;
    }
};

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
    redirect_to,
    should_redirect = true,
    should_show_refresh,
}: Partial<TErrorComponent>) => {
    // NEVER render a blank modal: always fall back to readable text.
    let safe_header = header;
    let safe_message = message;

    try {
        if (!safe_header) {
            safe_header = should_show_refresh
                ? safeLocalize('App Error')
                : safeLocalize('Connection Error');
        }

        if (!safe_message) {
            safe_message = should_show_refresh
                ? safeLocalize(
                      'The application crashed while loading. Please refresh to try again. If this persists, clear your browser cache.'
                  )
                : safeLocalize(
                      'Unable to connect to Deriv servers. Please check your App ID and API Token, then refresh.'
                  );
        }
    } catch (e) {
        safe_header = safe_header || 'Error';
        safe_message = safe_message || 'An unexpected error occurred.';
    }

    const default_redirect =
        typeof window !== 'undefined' && window.location && window.location.origin
            ? window.location.origin
            : '/';

    return (
        <PageErrorContainer
            error_header={safe_header}
            error_messages={[safe_message, '']}
            redirect_urls={[redirect_to || default_redirect]}
            redirect_labels={
                (!redirect_label && []) || [redirect_label || safeLocalize('Refresh')]
            }
            buttonOnClick={
                redirectOnClick ||
                (() => {
                    if ('caches' in window) {
                        caches
                            .keys()
                            .then(keys => keys.forEach(k => caches.delete(k)))
                            .catch(() => {});
                    }
                    window.location.reload();
                })
            }
            should_clear_error_on_click={should_clear_error_on_click}
            setError={setError}
            should_redirect={should_redirect}
        />
    );
};

export default ErrorComponent;
