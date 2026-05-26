/**
 * hooks/core/useStabilityMode.ts — React hook for ProductionStabilityMode
 *
 * Subscribe to global stability mode changes and get current stress report.
 * Use this hook to conditionally disable heavy features under stress.
 *
 * Usage:
 *   const { mode, report, isStressed } = useStabilityMode();
 *   if (mode === 'critical') return <LightRenderer />;
 *   return <FullRenderer />;
 */

import { useState, useEffect } from 'react';
import { ProductionStabilityMode } from '@/modules/core/ProductionStabilityMode';
import type { StabilityMode, StabilityReport } from '@/modules/core/ProductionStabilityMode';

export function useStabilityMode() {
  const [mode,   setMode]   = useState<StabilityMode>(ProductionStabilityMode.mode);
  const [report, setReport] = useState<StabilityReport>(ProductionStabilityMode.getReport());

  useEffect(() => {
    const unsub = ProductionStabilityMode.onModeChange((m, r) => {
      setMode(m);
      setReport(r);
    });
    return unsub;
  }, []);

  return {
    mode,
    report,
    isStressed:  mode !== 'nominal',
    isCritical:  mode === 'critical' || mode === 'emergency',
    isEmergency: mode === 'emergency',
    // Convenience booleans for conditional feature rendering
    canRenderEffects: mode === 'nominal' || mode === 'stress',
    canPrefetch:      mode === 'nominal',
    canRenderOverlays: mode !== 'critical' && mode !== 'emergency',
    maxFPS: mode === 'emergency' ? 15
          : mode === 'critical'  ? 24
          : mode === 'degraded'  ? 30
          : mode === 'stress'    ? 50
          : 60,
  };
}
