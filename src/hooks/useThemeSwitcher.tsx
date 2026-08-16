// @ts-nocheck
import { useCallback, useEffect } from 'react';
import { useStore } from './useStore';

const useThemeSwitcher = () => {
    const store = useStore();

    const { ui } = store ?? {
        ui: {
            setDarkMode: () => {},
            is_dark_mode_on: false,
        },
    };

    const { setDarkMode, is_dark_mode_on } = ui;

    // Applies a specific theme. Updates localStorage, the body class, and the ui
    // store so everything that reads is_dark_mode_on (incl. the chart) follows.
    const setTheme = useCallback(
        (theme) => {
            try {
                const body = document.querySelector('body');
                if (!body) return;

                const isDark = theme === 'dark';
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
                body.classList.remove('theme--light', 'theme--dark');
                body.classList.add(isDark ? 'theme--dark' : 'theme--light');

                if (typeof setDarkMode === 'function') {
                    setDarkMode(isDark);
                }
            } catch (e) {
                // Never allow theme logic to crash the app.
            }
        },
        [setDarkMode]
    );

    // Default to Light theme when no preference has been saved yet.
    useEffect(() => {
        try {
            const savedTheme = localStorage.getItem('theme');
            if (!savedTheme) {
                setTheme('light');
            }
        } catch (e) {
            // ignore
        }
    }, [setTheme]);

    const toggleTheme = useCallback(() => {
        try {
            const isCurrentlyDark = document
                .querySelector('body')
                ?.classList.contains('theme--dark');
            setTheme(isCurrentlyDark ? 'light' : 'dark');
        } catch (e) {
            // ignore
        }
    }, [setTheme]);

    return {
        toggleTheme,
        setTheme,
        is_dark_mode_on,
        setDarkMode,
    };
};

export default useThemeSwitcher;
