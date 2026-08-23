import type { LedgerEntry, BalanceReconciliation } from './types';

export class ImmutableLedger {
    private entries: LedgerEntry[] = [];
    private reconciliation: BalanceReconciliation | null = null;

    append(entry: Omit<LedgerEntry, 'id' | 'timestamp'>) {
        const newEntry: LedgerEntry = {
            ...entry,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
        };
        this.entries.unshift(newEntry);
        if (this.entries.length > 1000) this.entries.pop(); // Keep last 1000 in memory
        this.persist(newEntry);
        return newEntry.id;
    }

    updateReconciliation(rec: BalanceReconciliation) {
        this.reconciliation = rec;
        this.append({
            type: 'RECONCILIATION',
            symbol: 'ALL',
            message: `Synced: Deriv=${rec.derivBalance}, Local=${rec.localBalance}, Diff=${rec.balanceDifference.toFixed(2)}`,
            balanceBefore: rec.localBalance,
            balanceAfter: rec.derivBalance,
        });
    }

    getReconciliation() { return this.reconciliation; }
    getEntries() { return [...this.entries]; }

    private persist(entry: LedgerEntry) {
        // Hook for IndexedDB or backend API persistence
        try {
            const stored = JSON.parse(localStorage.getItem('bot_ledger') || '[]');
            stored.unshift(entry);
            localStorage.setItem('bot_ledger', JSON.stringify(stored.slice(0, 500)));
        } catch (e) {
            console.error('[LEDGER] Persistence failed:', e);
        }
    }
}

export const ledger = new ImmutableLedger();
