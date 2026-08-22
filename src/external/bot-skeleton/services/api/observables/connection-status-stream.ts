// connection-status-stream.ts (This will manage our observable stream)
import { BehaviorSubject } from 'rxjs';
import { TAuthData } from '@/types/api-types';

export enum CONNECTION_STATUS {
    OPENED = 'opened',
    CLOSED = 'closed',
    UNKNOWN = 'unknown',
}

// Initial connection status will be 'unknown'
export const connectionStatus$ = new BehaviorSubject<string>('unknown');
export const isAuthorizing$ = new BehaviorSubject<boolean>(true); // Start with true to show loader immediately
export const isAuthorized$ = new BehaviorSubject<boolean>(false);
export const account_list$ = new BehaviorSubject<TAuthData['account_list']>([]);
export const authData$ = new BehaviorSubject<TAuthData | null>(null);

// Create functions to easily update status
export const setConnectionStatus = (status: CONNECTION_STATUS) => {
    connectionStatus$.next(status);
};

// Set the authorized status
export const setIsAuthorized = (isAuthorized: boolean) => {
    isAuthorized$.next(isAuthorized);
};

// Set the authorizing status
export const setIsAuthorizing = (isAuthorizing: boolean) => {
    isAuthorizing$.next(isAuthorizing);
};

// Set the account list
export const setAccountList = (accountList: TAuthData['account_list']) => {
    account_list$.next(accountList);
};

// ROOT-CAUSE FIX for "balance doesn't update after trades":
// The header/account-switcher UI reads balance from `account_list$` (via
// useApiBase().accountList), which was previously only ever populated ONCE at
// login (api-base.ts authorizeAndSubscribe -> setAccountList). Live `balance`
// push messages were separately routed to the mobx client-store's `balance`
// field, which nothing in the account-switcher UI actually reads — so trades
// executed correctly but the displayed balance never moved.
// This helper keeps `account_list$` (and `authData$`) in sync with every live
// balance update, regardless of which connection/subscription produced it.
export const updateAccountBalance = (loginid: string | undefined | null, balance: number, currency?: string) => {
    if (!loginid || typeof balance !== 'number' || Number.isNaN(balance)) return;

    const currentList = account_list$.getValue() || [];
    let matched = false;
    const updatedList = currentList.map(account => {
        if (account.loginid === loginid) {
            matched = true;
            return { ...account, balance, currency: currency ?? account.currency };
        }
        return account;
    });
    if (matched) {
        account_list$.next(updatedList);
    }

    const currentAuth = authData$.getValue();
    if (currentAuth && currentAuth.loginid === loginid) {
        authData$.next({ ...currentAuth, balance, currency: currency ?? currentAuth.currency });
    }
};

// Set the auth data
export const setAuthData = (authData: TAuthData | null) => {
    if (authData?.loginid) {
        localStorage.setItem('active_loginid', authData.loginid);
    }
    authData$.next(authData);
};
