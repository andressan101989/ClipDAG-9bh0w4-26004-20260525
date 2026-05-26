/**
 * modules/gaming/RewardsEngine.ts — BDAG game rewards calculator
 *
 * Handles reward computation for all game outcomes:
 *   - Win/loss/draw payouts
 *   - Wager settlement (escrow → winner)
 *   - Streak bonuses
 *   - Time bonuses (finish faster = more reward)
 *   - Score-based multipliers
 *   - Anti-farming (diminishing returns on repeated plays)
 *   - Daily caps to prevent economic exploitation
 *
 * All reward COMPUTATIONS happen here (client-side preview).
 * All reward SETTLEMENTS go through the server (Edge Function).
 * Client never self-awards — this is preview + UX only.
 *
 * Usage:
 *   const preview = RewardsEngine.preview({ wager: 100, won: true, score: 850, streakCount: 3 });
 *   // preview.gross → 200, preview.fee → 20, preview.net → 180
 *   await RewardsEngine.settle(gameId, preview);  // calls Edge Function
 */

export interface RewardInput {
  wager:        number;    // BDAG wagered
  won:          boolean;
  isDraw:       boolean;
  score:        number;    // 0–1000
  maxScore:     number;    // theoretical max for this game type
  durationMs:   number;    // how long the game took
  targetMs:     number;    // target/expected duration
  streakCount:  number;    // consecutive wins
  playsToday:   number;    // for anti-farming
  gameType:     string;
}

export interface RewardPreview {
  wager:        number;
  baseReward:   number;
  scoreBonus:   number;
  timeBonus:    number;
  streakBonus:  number;
  gross:        number;
  platformFee:  number;
  net:          number;
  isCapReached: boolean;
  breakdown:    string[];
}

const PLATFORM_FEE_PCT  = 0.05;   // 5%
const MAX_DAILY_REWARD  = 5000;   // BDAG per day anti-farming cap
const STREAK_MULTIPLIERS = [1, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.50];

class RewardsEngineImpl {
  private _dailyEarned = 0;
  private _lastResetDate = new Date().toDateString();

  preview(input: RewardInput): RewardPreview {
    this._checkDailyReset();
    const breakdown: string[] = [];

    if (!input.won && !input.isDraw) {
      return {
        wager: input.wager, baseReward: 0, scoreBonus: 0,
        timeBonus: 0, streakBonus: 0, gross: 0,
        platformFee: 0, net: 0, isCapReached: false,
        breakdown: ['Loss — no reward'],
      };
    }

    // Base reward = wager × win multiplier
    const baseMultiplier = input.isDraw ? 0.9 : 2.0;
    const baseReward     = input.wager * baseMultiplier;
    breakdown.push(`Base: ${input.wager} × ${baseMultiplier} = ${baseReward}`);

    // Score bonus (0–20% extra based on score percentage)
    const scorePct   = input.maxScore > 0 ? input.score / input.maxScore : 0;
    const scoreBonus = baseReward * (scorePct * 0.20);
    breakdown.push(`Score bonus: ${(scorePct * 100).toFixed(0)}% → +${scoreBonus.toFixed(2)}`);

    // Time bonus (finish faster than target → bonus)
    const timeRatio = input.targetMs > 0 ? input.durationMs / input.targetMs : 1;
    const timePct   = Math.max(0, 1 - timeRatio);
    const timeBonus = baseReward * (timePct * 0.10);
    if (timeBonus > 0) breakdown.push(`Time bonus: ${(timePct * 100).toFixed(0)}% faster → +${timeBonus.toFixed(2)}`);

    // Streak bonus
    const streakIdx      = Math.min(input.streakCount, STREAK_MULTIPLIERS.length - 1);
    const streakMult     = STREAK_MULTIPLIERS[streakIdx];
    const streakBonus    = baseReward * (streakMult - 1);
    if (streakBonus > 0) breakdown.push(`Streak ×${streakMult} (${input.streakCount} wins) → +${streakBonus.toFixed(2)}`);

    // Anti-farming: diminishing returns after 5 plays/day
    let gross = baseReward + scoreBonus + timeBonus + streakBonus;
    if (input.playsToday > 5) {
      const dimFactor = Math.max(0.5, 1 - (input.playsToday - 5) * 0.05);
      gross *= dimFactor;
      breakdown.push(`Anti-farming ×${dimFactor.toFixed(2)} (${input.playsToday} plays today)`);
    }

    // Daily cap
    const remaining     = Math.max(0, MAX_DAILY_REWARD - this._dailyEarned);
    const isCapReached  = gross > remaining;
    if (isCapReached) {
      gross = remaining;
      breakdown.push(`Daily cap reached (max ${MAX_DAILY_REWARD} BDAG/day)`);
    }

    const platformFee = gross * PLATFORM_FEE_PCT;
    const net         = gross - platformFee;

    return {
      wager: input.wager,
      baseReward,
      scoreBonus,
      timeBonus,
      streakBonus,
      gross,
      platformFee,
      net,
      isCapReached,
      breakdown,
    };
  }

  /** Call after server confirms settlement to update daily tracking. */
  recordSettlement(amount: number): void {
    this._checkDailyReset();
    this._dailyEarned += amount;
  }

  get dailyEarned(): number {
    this._checkDailyReset();
    return this._dailyEarned;
  }

  get dailyRemaining(): number {
    this._checkDailyReset();
    return Math.max(0, MAX_DAILY_REWARD - this._dailyEarned);
  }

  private _checkDailyReset(): void {
    const today = new Date().toDateString();
    if (today !== this._lastResetDate) {
      this._dailyEarned   = 0;
      this._lastResetDate = today;
    }
  }
}

export const RewardsEngine = new RewardsEngineImpl();
