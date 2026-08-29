import type { RiskLimits } from './engine';

export class RiskManager {
  constructor(private limits: RiskLimits) {}

  validatePreTrade(stake: number, currentConsecutiveLosses: number, currentOpenTrades: number): { allowed: boolean; reason: string } {
    if (currentConsecutiveLosses >= this.limits.maxConsecutiveLosses) {
      return { allowed: false, reason: `CIRCUIT_BREAKER: ${currentConsecutiveLosses} consecutive losses. Max allowed: ${this.limits.maxConsecutiveLosses}.` };
    }

    if (currentOpenTrades >= this.limits.maxConcurrentTrades) {
      return { allowed: false, reason: `MAX_CONCURRENT: ${currentOpenTrades} trades active. Max: ${this.limits.maxConcurrentTrades}.` };
    }

    if (stake > this.limits.maxStakePerTrade) {
      return { allowed: false, reason: `STAKE_CAP: $${stake.toFixed(2)} > $${this.limits.maxStakePerTrade}. Martingale is permanently disabled.` };
    }

    return { allowed: true, reason: 'ALL_RISK_GATES_PASSED' };
  }
}
