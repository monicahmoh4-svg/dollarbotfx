import type { RiskLimits, BalanceReconciliation } from './types';

export class RiskManager {
    constructor(private limits: RiskLimits) {}

    validatePreTrade(stake: number, currentConsecutiveLosses: number, recon: BalanceReconciliation | null, currentOpenTrades: number): { allowed: boolean; reason: string } {
        if (!recon || !recon.isHealthy) {
            return { allowed: false, reason: 'ACCOUNT_SYNC_UNHEALTHY: Balance reconciliation failed or is pending.' };
        }
        if (recon.balanceDifference > this.limits.maxBalanceTolerance) {
            return { allowed: false, reason: `BALANCE_MISMATCH: Diff=${recon.balanceDifference.toFixed(2)} exceeds tolerance. HALTED.` };
        }
        if (currentConsecutiveLosses >= this.limits.maxConsecutiveLosses) {
            return { allowed: false, reason: `MAX_CONSECUTIVE_LOSSES: ${currentConsecutiveLosses} reached. Cooldown active.` };
        }
        if (currentOpenTrades >= this.limits.maxConcurrentTrades) {
            return { allowed: false, reason: `MAX_CONCURRENT_TRADES: ${currentOpenTrades} active.` };
        }
        if (stake > this.limits.maxStakePerTrade) {
            return { allowed: false, reason: `STAKE_EXCEEDED: ${stake} > ${this.limits.maxStakePerTrade}.` };
        }
        if (stake > recon.localBalance * this.limits.maxPercentRiskPerTrade) {
            return { allowed: false, reason: `RISK_EXCEEDED: Stake is > ${(this.limits.maxPercentRiskPerTrade * 100).toFixed(1)}% of balance.` };
        }
        return { allowed: true, reason: 'RISK_CHECKS_PASSED' };
    }
}
