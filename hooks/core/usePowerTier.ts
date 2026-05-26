/**
 * hooks/core/usePowerTier.ts — React hook for PowerManager tier
 *
 * Returns the current power tier and subscribes to changes.
 *
 * Usage:
 *   const { tier, config, isLowPower } = usePowerTier();
 *   if (!config.arEnabled) return <FallbackCamera />;
 */

import { useState, useEffect } from 'react';
import { PowerManager, type PowerTier } from '@/modules/core/PowerManager';

export function usePowerTier(): {
  tier:        PowerTier;
  config:      ReturnType<typeof PowerManager.currentConfig>;
  isLowPower:  boolean;
} {
  const [tier, setTier] = useState<PowerTier>(PowerManager.currentTier);

  useEffect(() => {
    PowerManager.initialize();
    const unsub = PowerManager.onTierChange(setTier);
    return unsub;
  }, []);

  return {
    tier,
    config:     PowerManager.currentConfig,
    isLowPower: tier === 'saver' || tier === 'emergency',
  };
}
