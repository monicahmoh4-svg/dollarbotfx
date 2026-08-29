import type { RiskLimits } from './engine';

export class RiskManager {
  constructor(private limits: RiskLimits) {}

  validatePreTrade(stake: number, currentConsecutiveLosses: number, currentOpenTrades: number): { allowed: boolean; reason: string } {
    if (currentConsecutiveLosses >= this.limits.maxConsecutiveLosses) {
      return { allowed: false, reason: `MAX_CONSECUTIVE_LOSSES: ${currentConsecutiveLosses} reached. Circuit breaker activated.` };
    }

    if (currentOpenTrades >= this.limits.maxConcurrentTrades) {
      return { allowed: false, reason: `MAX_CONCURRENT_TRADES: ${currentOpenTrades} active.` };
    }

    if (stake > this.limits.maxStakePerTrade) {
      return { allowed: false, reason: `STAKE_EXCEEDED: ${stake} > ${this.limits.maxStakePerTrade}. Martingale is disabled.` };
    }

    return { allowed: true, reason: 'RISK_CHECKS_PASSED' };
  }
}
