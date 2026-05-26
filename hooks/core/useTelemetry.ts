/**
 * hooks/core/useTelemetry.ts — React hook for telemetry access
 *
 * Subscribe to TelemetryPipeline summaries in React components.
 * Used by the debug panel and any screen that needs live diagnostics.
 *
 * Usage:
 *   const { summary, rawBuffers, record } = useTelemetry();
 *   <Text>{summary.fps.avg.toFixed(1)} FPS</Text>
 *   record.fps('FeedScreen', measuredFPS);
 */

import { useState, useEffect, useCallback } from 'react';
import { TelemetryPipeline }  from '@/modules/core/TelemetryPipeline';
import { CrashIntelligence }  from '@/modules/core/CrashIntelligence';
import type { TelemetrySummary } from '@/modules/core/TelemetryPipeline';

export function useTelemetry(refreshIntervalMs = 2_000) {
  const [summary, setSummary]     = useState<TelemetrySummary | null>(null);
  const [rawBuffers, setRawBuffers] = useState<ReturnType<typeof TelemetryPipeline.getRawBuffers> | null>(null);

  useEffect(() => {
    // Initial load
    setSummary(TelemetryPipeline.getSummary());
    setRawBuffers(TelemetryPipeline.getRawBuffers());

    const timer = setInterval(() => {
      setSummary(TelemetryPipeline.getSummary());
      setRawBuffers(TelemetryPipeline.getRawBuffers());
    }, refreshIntervalMs);

    return () => clearInterval(timer);
  }, [refreshIntervalMs]);

  const record = {
    fps:          useCallback((surface: string, fps: number) =>
      TelemetryPipeline.recordFPS(surface, fps), []),
    navTiming:    useCallback((route: string, mountMs: number, loadMs: number) =>
      TelemetryPipeline.recordNavTiming(route, mountMs, loadMs), []),
    rtcQuality:   useCallback((peerId: string, stats: any) =>
      TelemetryPipeline.recordRTCQuality(peerId, stats), []),
    streamSample: useCallback((sessionId: string, data: any) =>
      TelemetryPipeline.recordStreamSample(sessionId, data), []),
  };

  const breadcrumb = useCallback((
    category: Parameters<typeof CrashIntelligence.addBreadcrumb>[0],
    message:  string,
    data?:    Record<string, any>,
  ) => {
    CrashIntelligence.addBreadcrumb(category, message, data);
  }, []);

  const exportBundle = useCallback(
    () => CrashIntelligence.exportDiagnosticsBundle(),
    [],
  );

  return { summary, rawBuffers, record, breadcrumb, exportBundle };
}
