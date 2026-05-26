/**
 * hooks/core/useAdaptiveQuality.ts — React hook for AdaptiveQualityController
 *
 * Subscribes to quality level changes and returns the current profile.
 * Components use this to conditionally render AR effects, Skia layers,
 * high-res assets, animations, etc.
 *
 * Usage:
 *   const { profile, isFullQuality, isLowQuality } = useAdaptiveQuality();
 *   if (!profile.arEnabled) return <FallbackCamera />;
 *   if (profile.maxFPS < 30) setRenderMode('simple');
 */

import { useState, useEffect } from 'react';
import {
  AdaptiveQualityController,
  type QualityProfile,
  type QualityLevel,
} from '@/modules/core/AdaptiveQualityController';

export interface AdaptiveQualityState {
  level:          QualityLevel;
  profile:        QualityProfile;
  isFullQuality:  boolean;
  isLowQuality:   boolean;
  isEmergency:    boolean;
}

export function useAdaptiveQuality(): AdaptiveQualityState {
  const [profile, setProfile] = useState<QualityProfile>(
    AdaptiveQualityController.currentProfile,
  );

  useEffect(() => {
    const unsub = AdaptiveQualityController.onQualityChange(setProfile);
    return unsub;
  }, []);

  return {
    level:         profile.level,
    profile,
    isFullQuality: profile.level === 'full',
    isLowQuality:  profile.level === 'minimal' || profile.level === 'emergency',
    isEmergency:   profile.level === 'emergency',
  };
}
