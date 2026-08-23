import type { RiskLimits, BalanceReconciliation } from './types';
import { ledger } from './ledger';

export class RiskManager {
    constructor(private limits: RiskLimits) {}

    validatePreTrade(stake: number, currentConsecutiveLosses: number, recon: BalanceReconciliation | null): { allowed: boolean; reason: string } {
        if (!recon || !recon.isHealthy) {
            return { allowed: false, reason: 'Account synchronization unhealthy or pending.' };
        }
        if (recon.balanceDifference > this.limits.maxBalanceTolerance) {
            return { allowed: false, reason: `Balance mismatch exceeds tolerance (${recon.balanceDifference.toFixed(2)}). HALTED.` };
        }
        if (currentConsecutiveLosses >= this.limits.maxConsecutiveLosses) {
            return { allowed: false, reason: `Max consecutive losses (${this.limits.maxConsecutiveLosses}) reached. Cooldown active.` };
        }
        if (stake > this.limits.maxStakePerTrade) {
            return { allowed: false, reason: `Stake ${stake} exceeds max ${this.limits.maxStakePerTrade}.` };
        }
        if (stake > recon.localBalance * this.limits.maxPercentRiskPerTrade) {
            return { allowed: false, reason: `Stake exceeds max percent risk of balance.` };
        }
        return { allowed: true, reason: 'Risk checks passed.' };
    }
}
