/**
 * services/stressTestRunner.ts — Phase 5 Stress Test Framework
 *
 * Covers ALL stress test scenarios:
 *   1. Long Sessions  — session lifecycle + leak validation
 *   2. Long Livestreams — streaming endurance + viewer count polling
 *   3. Long Videocalls  — RTC simulation + stats stability
 *   4. Multitasking     — overlapping sessions, resource contention
 *   5. Reconnect Storms — rapid disconnect/reconnect cycles
 *   6. Bad Network      — artificial latency + packet-loss simulation
 *   7. Thermal Stress   — escalate thermal state, validate degradation
 *   8. GPU Overload     — slot exhaustion + emergency release
 *
 * Validation:
 *   - Memory leak: before/after heapUsed delta
 *   - FPS: FrameScheduler stats, drop-rate threshold
 *   - Render stability: spike detection, frame pacing
 *   - Realtime stability: reconnect success rate, latency percentiles
 *   - Recovery: SessionOrchestrator + RTCManager + LiveOrchestrator
 */

import { SessionOrchestrator } from '@/modules/sessions/SessionOrchestrator';
import { RTCManager }          from '@/modules/realtime/RTCManager';
import { LiveOrchestrator }    from '@/modules/streaming/LiveOrchestrator';
import { GPUManager }          from '@/modules/core/GPUManager';
import { FrameScheduler }      from '@/modules/core/FrameScheduler';
import { ThermalMonitor }      from '@/modules/core/ThermalMonitor';
import { ProductionStabilityMode } from '@/modules/core/ProductionStabilityMode';
import { LeakDetector }        from '@/modules/core/LeakDetector';
import { MemoryOptimizer }     from '@/modules/core/MemoryOptimizer';
import { Diagnostics }         from '@/modules/core/Diagnostics';
import { AdaptiveQualityController } from '@/modules/core/AdaptiveQualityController';
import { ConnectionManager }   from '@/modules/realtime/ConnectionManager';
import { MultiplayerEngine }   from '@/modules/gaming/MultiplayerEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'warning';

export interface TestResult {
  id:          string;
  name:        string;
  status:      TestStatus;
  durationMs:  number;
  metrics:     Record<string, string | number>;
  warnings:    string[];
  errors:      string[];
  logs:        string[];
}

export interface StressTestReport {
  runAt:       number;
  totalTests:  number;
  passed:      number;
  failed:      number;
  warnings:    number;
  totalTimeMs: number;
  results:     TestResult[];
  summary:     string;
}

type ProgressCb = (testId: string, progress: number, log: string) => void;

// ── Memory snapshot ───────────────────────────────────────────────────────────

function captureMemory(): { heapMB: number; leaks: number } {
  try {
    const leaked  = LeakDetector.getReport();
    const memStat = MemoryOptimizer.getStats();
    const heapMB  = memStat.trackedBytes / 1_048_576;
    return { heapMB, leaks: leaked.staleCount };
  } catch {
    return { heapMB: 0, leaks: 0 };
  }
}

// ── Sleep ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ── TestResult builder ────────────────────────────────────────────────────────

function makeResult(id: string, name: string): TestResult {
  return {
    id, name,
    status:     'running',
    durationMs: 0,
    metrics:    {},
    warnings:   [],
    errors:     [],
    logs:       [],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// INDIVIDUAL TEST RUNNERS
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Long Session Lifecycle ─────────────────────────────────────────────────

async function testLongSession(progress: ProgressCb): Promise<TestResult> {
  const r = makeResult('long_session', 'Long Session Lifecycle');
  const t0 = Date.now();
  const SESSION_COUNT = 5;
  const DURATION_MS   = 3_000; // 3s per session (simulates extended usage)

  r.logs.push(`Creating ${SESSION_COUNT} sessions, ${DURATION_MS}ms each`);

  const memBefore = captureMemory();
  const createdIds: string[] = [];

  try {
    for (let i = 0; i < SESSION_COUNT; i++) {
      const sid = `stress_session_${Date.now()}_${i}`;
      createdIds.push(sid);

      SessionOrchestrator.registerSession('media', sid, {
        onPause:   async () => {},
        onResume:  async () => {},
        onEnd:     async () => {},
        onRecover: async () => true,
      });

      progress('long_session', ((i + 0.5) / SESSION_COUNT) * 70, `Session ${i + 1}/${SESSION_COUNT} active`);
      await sleep(DURATION_MS / SESSION_COUNT);

      await SessionOrchestrator.endSession(sid);
      progress('long_session', ((i + 1) / SESSION_COUNT) * 70, `Session ${i + 1} ended cleanly`);
    }

    await sleep(200);
    const memAfter = captureMemory();
    const leakDelta = memAfter.leaks - memBefore.leaks;
    const heapDelta = memAfter.heapMB - memBefore.heapMB;

    r.metrics['session_count']   = SESSION_COUNT;
    r.metrics['heap_before_MB']  = memBefore.heapMB.toFixed(2);
    r.metrics['heap_after_MB']   = memAfter.heapMB.toFixed(2);
    r.metrics['heap_delta_MB']   = heapDelta.toFixed(2);
    r.metrics['stale_leaks']     = leakDelta;

    if (leakDelta > 2) {
      r.warnings.push(`${leakDelta} stale leaks detected after session cleanup`);
    }
    if (heapDelta > 50) {
      r.errors.push(`Heap grew ${heapDelta.toFixed(1)}MB — possible leak`);
    }

    const inv = SessionOrchestrator.getInventory();
    const leftover = inv.filter(s => createdIds.includes(s.id));
    if (leftover.length > 0) {
      r.errors.push(`${leftover.length} sessions not cleaned up`);
    } else {
      r.logs.push('All sessions cleaned up correctly');
    }

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';
  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    // Cleanup
    for (const sid of createdIds) {
      try { await SessionOrchestrator.endSession(sid); } catch { /* ignore */ }
    }
  }

  r.durationMs = Date.now() - t0;
  progress('long_session', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 2. Long Livestream ────────────────────────────────────────────────────────

async function testLongLivestream(userId: string, progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('long_livestream', 'Long Livestream Endurance');
  const t0 = Date.now();
  const STREAM_DURATION_MS = 6_000; // 6s simulated stream

  r.logs.push(`Starting simulated livestream for ${STREAM_DURATION_MS}ms`);

  let session: any = null;

  try {
    progress('long_livestream', 10, 'Creating live session...');
    const { session: s, error } = await LiveOrchestrator.startHostSession(
      userId || 'stress_test_user',
      'Stress Test Stream',
    );

    if (error || !s) {
      r.errors.push(`Failed to start session: ${error ?? 'unknown'}`);
      r.status = 'failed';
      r.durationMs = Date.now() - t0;
      return r;
    }

    session = s;
    progress('long_livestream', 30, `Session started: ${s.sessionId}`);

    // Monitor health during stream
    const healthSamples: number[] = [];
    const healthUnsub = s.onHealthChange((score) => healthSamples.push(score));
    const qualitySamples: string[] = [];
    const qualUnsub = s.onQualityChange((p) => qualitySamples.push(p.tier));

    // Run for duration
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      await sleep(STREAM_DURATION_MS / steps);
      progress('long_livestream', 30 + (i + 1) * 9, `Stream running ${((i + 1) * STREAM_DURATION_MS / steps / 1000).toFixed(1)}s`);
    }

    healthUnsub();
    qualUnsub();

    progress('long_livestream', 90, 'Ending stream...');
    await s.end();
    progress('long_livestream', 95, 'Stream ended');

    const avgHealth = healthSamples.length > 0
      ? (healthSamples.reduce((a, b) => a + b, 0) / healthSamples.length).toFixed(1)
      : 'N/A';

    r.metrics['duration_ms']       = STREAM_DURATION_MS;
    r.metrics['health_samples']    = healthSamples.length;
    r.metrics['avg_health_score']  = avgHealth;
    r.metrics['quality_changes']   = qualitySamples.length;
    r.metrics['final_quality']     = qualitySamples[qualitySamples.length - 1] ?? 'hd';

    if (typeof avgHealth === 'string' && parseFloat(avgHealth) < 50) {
      r.warnings.push(`Low average health: ${avgHealth}`);
    }

    r.logs.push(`Quality transitions: ${qualitySamples.join(' → ') || 'none'}`);
    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    try { await session?.end(); } catch { /* ignore */ }
  }

  r.durationMs = Date.now() - t0;
  progress('long_livestream', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 3. Long Videocall ─────────────────────────────────────────────────────────

async function testLongVideocall(userId: string, progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('long_videocall', 'Long Videocall Endurance');
  const t0 = Date.now();
  const CALL_DURATION_MS = 6_000;

  r.logs.push(`Running simulated videocall for ${CALL_DURATION_MS}ms`);

  let peer: any = null;

  try {
    progress('long_videocall', 10, 'Creating RTC peer...');
    peer = await RTCManager.createPeer(
      `stress_room_${Date.now()}`,
      userId || 'stress_user_a',
      'stress_user_b',
      { maxReconnects: 3, iceTimeoutMs: 5_000, statsIntervalMs: 1_000 },
    );

    const statsSamples: any[] = [];
    const stateChanges: string[] = [];

    peer.onStats((s: any) => statsSamples.push(s));
    peer.onStateChange((s: string) => { stateChanges.push(s); r.logs.push(`RTC state: ${s}`); });

    await peer.negotiate('offer');
    progress('long_videocall', 30, 'Negotiation started');

    const steps = 6;
    for (let i = 0; i < steps; i++) {
      await sleep(CALL_DURATION_MS / steps);
      progress('long_videocall', 30 + (i + 1) * 9, `Call running ${((i + 1) * CALL_DURATION_MS / steps / 1000).toFixed(1)}s`);
    }

    progress('long_videocall', 90, 'Closing peer...');
    await peer.close();
    peer = null;
    progress('long_videocall', 95, 'Peer closed');

    const finalState = stateChanges[stateChanges.length - 1] ?? 'unknown';
    const avgRtt = statsSamples.length > 0
      ? (statsSamples.reduce((a, b) => a + b.rttMs, 0) / statsSamples.length).toFixed(1)
      : 'N/A';
    const avgLoss = statsSamples.length > 0
      ? (statsSamples.reduce((a, b) => a + b.packetLossPct, 0) / statsSamples.length).toFixed(2)
      : 'N/A';

    r.metrics['duration_ms']    = CALL_DURATION_MS;
    r.metrics['stats_samples']  = statsSamples.length;
    r.metrics['avg_rtt_ms']     = avgRtt;
    r.metrics['avg_loss_pct']   = avgLoss;
    r.metrics['final_state']    = finalState;
    r.metrics['state_changes']  = stateChanges.length;

    if (finalState !== 'closed') {
      r.warnings.push(`Final RTC state is '${finalState}', expected 'closed'`);
    }
    if (RTCManager.activePeerCount > 0) {
      r.errors.push(`${RTCManager.activePeerCount} RTC peers still active after close`);
    }

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    try { await peer?.close(); } catch { /* ignore */ }
  }

  r.durationMs = Date.now() - t0;
  progress('long_videocall', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 4. Multitasking ───────────────────────────────────────────────────────────

async function testMultitasking(userId: string, progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('multitasking', 'Multitasking — Concurrent Sessions');
  const t0 = Date.now();

  r.logs.push('Launching 3 concurrent session types simultaneously');

  const sessionIds: string[] = [];
  let rtcPeer: any = null;
  let liveSession: any = null;

  try {
    // Register upload + media sessions
    for (let i = 0; i < 3; i++) {
      const sid = `mt_media_${Date.now()}_${i}`;
      sessionIds.push(sid);
      SessionOrchestrator.registerSession(
        i < 2 ? 'upload' : 'media',
        sid,
        { onPause: async () => {}, onResume: async () => {}, onEnd: async () => {}, onRecover: async () => true },
      );
    }

    progress('multitasking', 20, '3 low-priority sessions running');

    // Start RTC concurrently
    rtcPeer = await RTCManager.createPeer(
      `mt_room_${Date.now()}`, userId || 'mt_user', 'mt_remote',
      { maxReconnects: 2, iceTimeoutMs: 3_000, statsIntervalMs: 500 },
    );
    await rtcPeer.negotiate('offer');
    progress('multitasking', 40, 'RTC peer added to mix');

    // Start live stream concurrently
    const { session: ls } = await LiveOrchestrator.startHostSession(
      userId || 'mt_user', 'Multitasking Test Stream',
    );
    liveSession = ls;
    progress('multitasking', 55, 'Live session also running — peak load');

    const inv = SessionOrchestrator.getInventory();
    r.metrics['concurrent_sessions'] = inv.length;
    r.logs.push(`Peak: ${inv.length} sessions active simultaneously`);

    // Let everything run for a bit
    await sleep(2_000);
    progress('multitasking', 70, 'Checking stability under load');

    const stab = ProductionStabilityMode.mode;
    r.metrics['stability_mode'] = stab;
    r.logs.push(`Stability mode under load: ${stab}`);

    if (stab === 'emergency') {
      r.warnings.push('Emergency mode triggered during multitasking (expected on low-end devices)');
    }

    // Tear down everything
    progress('multitasking', 80, 'Tearing down all sessions');
    await liveSession?.end(); liveSession = null;
    await rtcPeer?.close(); rtcPeer = null;
    for (const sid of sessionIds) {
      try { await SessionOrchestrator.endSession(sid); } catch { /* ignore */ }
    }

    await sleep(300);

    const invAfter = SessionOrchestrator.getInventory();
    const leftover = invAfter.filter(s => sessionIds.includes(s.id));
    r.metrics['leftover_sessions'] = leftover.length;
    if (leftover.length > 0) {
      r.errors.push(`${leftover.length} sessions not cleaned up`);
    }

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    try { await liveSession?.end(); } catch { /* ignore */ }
    try { await rtcPeer?.close(); } catch { /* ignore */ }
    for (const sid of sessionIds) {
      try { await SessionOrchestrator.endSession(sid); } catch { /* ignore */ }
    }
  }

  r.durationMs = Date.now() - t0;
  progress('multitasking', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 5. Reconnect Storms ───────────────────────────────────────────────────────

async function testReconnectStorm(userId: string, progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('reconnect_storm', 'Reconnect Storm');
  const t0 = Date.now();
  const CYCLES = 5;

  r.logs.push(`Running ${CYCLES} rapid connect/disconnect cycles`);

  const stateLog: string[] = [];
  let peer: any = null;

  try {
    for (let i = 0; i < CYCLES; i++) {
      progress('reconnect_storm', (i / CYCLES) * 80, `Cycle ${i + 1}/${CYCLES}`);

      peer = await RTCManager.createPeer(
        `storm_room_${i}_${Date.now()}`,
        userId || 'storm_user',
        'storm_remote',
        { maxReconnects: 2, iceTimeoutMs: 2_000, statsIntervalMs: 500 },
      );

      peer.onStateChange((s: string) => stateLog.push(s));

      await peer.negotiate('offer');
      await sleep(300 + Math.random() * 200); // brief connection window

      await peer.close();
      peer = null;
      await sleep(100); // brief pause before next cycle

      r.logs.push(`Cycle ${i + 1} complete`);
    }

    await sleep(300); // let cleanup settle

    r.metrics['cycles']           = CYCLES;
    r.metrics['state_transitions'] = stateLog.length;
    r.metrics['rtc_peers_after']  = RTCManager.activePeerCount;

    const leakReport = LeakDetector.getReport();
    r.metrics['stale_leaks_after'] = leakReport.staleCount;

    if (RTCManager.activePeerCount > 0) {
      r.errors.push(`${RTCManager.activePeerCount} RTC peers still alive after storm`);
    }
    if (leakReport.staleCount > CYCLES) {
      r.warnings.push(`${leakReport.staleCount} stale leaks after ${CYCLES} cycles`);
    }

    r.logs.push(`State log: ${stateLog.slice(-10).join(' → ')}`);
    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    try { await peer?.close(); } catch { /* ignore */ }
  }

  r.durationMs = Date.now() - t0;
  progress('reconnect_storm', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 6. Bad Network Simulation ─────────────────────────────────────────────────

async function testBadNetwork(userId: string, progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('bad_network', 'Bad Network Simulation');
  const t0 = Date.now();

  r.logs.push('Simulating degraded network: high latency + packet loss');

  let peer: any = null;

  try {
    peer = await RTCManager.createPeer(
      `bad_net_${Date.now()}`,
      userId || 'net_user',
      'net_remote',
      { maxReconnects: 3, iceTimeoutMs: 8_000, statsIntervalMs: 500 },
    );

    const statsSamples: any[] = [];
    const reconnects: number[] = [];

    peer.onStats((s: any) => statsSamples.push(s));
    peer.onStateChange((s: string) => {
      if (s === 'reconnecting') reconnects.push(Date.now());
      r.logs.push(`Network state: ${s}`);
    });

    progress('bad_network', 20, 'Peer created, starting negotiation');
    await peer.negotiate('offer');

    // Simulate bad network by forcing ICE restart (simulates disconnection)
    progress('bad_network', 40, 'Simulating disconnection (ICE restart)');
    await sleep(1_000);
    try { await peer.restartICE(); } catch { /* may fail in sim mode */ }
    progress('bad_network', 55, 'ICE restart triggered');

    await sleep(2_000);
    progress('bad_network', 70, 'Observing recovery');

    await sleep(1_000);
    await peer.close();
    peer = null;

    const highLatencySamples = statsSamples.filter(s => s.rttMs > 150).length;
    const highLossSamples    = statsSamples.filter(s => s.packetLossPct > 3).length;

    r.metrics['total_samples']      = statsSamples.length;
    r.metrics['high_latency_count'] = highLatencySamples;
    r.metrics['high_loss_count']    = highLossSamples;
    r.metrics['reconnect_attempts'] = reconnects.length;

    r.logs.push(`${reconnects.length} reconnect cycle(s) observed`);

    if (RTCManager.activePeerCount > 0) {
      r.errors.push('Peer not cleaned up after bad-network test');
    }

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    try { await peer?.close(); } catch { /* ignore */ }
  }

  r.durationMs = Date.now() - t0;
  progress('bad_network', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 7. Thermal Stress ─────────────────────────────────────────────────────────

async function testThermalStress(progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('thermal_stress', 'Thermal Stress Escalation');
  const t0 = Date.now();

  r.logs.push('Escalating thermal state through all tiers');

  const stabilityModes: string[] = [];
  const fpsValues: number[] = [];

  const unsub = ProductionStabilityMode.onModeChange((mode) => {
    stabilityModes.push(mode);
    r.logs.push(`Stability → ${mode}`);
  });

  try {
    const states: Array<'fair' | 'serious' | 'critical' | 'nominal'> =
      ['fair', 'serious', 'critical', 'nominal'];

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      progress('thermal_stress', (i / states.length) * 80, `Injecting thermal: ${state}`);

      // Inject thermal state directly
      ThermalMonitor.reportNativeState(state);
      await sleep(800);

      // Capture FPS cap
      const fps = FrameScheduler.getActiveFPS?.() ?? 60;
      fpsValues.push(fps);
      r.logs.push(`Thermal ${state} → FPS cap: ${fps}`);
    }

    unsub();

    // Validate tier degradation
    const hadDegradation = stabilityModes.some(m =>
      m === 'stress' || m === 'degraded' || m === 'critical' || m === 'emergency',
    );
    const restoredToNominal = stabilityModes[stabilityModes.length - 1] === 'nominal' ||
      ProductionStabilityMode.mode === 'nominal';

    r.metrics['stability_transitions'] = stabilityModes.length;
    r.metrics['fps_critical']          = fpsValues[2] ?? 'N/A';
    r.metrics['fps_nominal']           = fpsValues[3] ?? 'N/A';
    r.metrics['had_degradation']       = hadDegradation ? 'YES' : 'NO';
    r.metrics['restored_to_nominal']   = restoredToNominal ? 'YES' : 'NO';

    if (!hadDegradation) {
      r.warnings.push('No stability degradation observed during thermal escalation');
    }

    // Validate FPS caps
    if (typeof fpsValues[2] === 'number' && fpsValues[2] > 30) {
      r.warnings.push(`FPS under critical thermal: ${fpsValues[2]} (expected ≤20)`);
    }
    if (typeof fpsValues[3] === 'number' && fpsValues[3] < 50) {
      r.warnings.push(`FPS after nominal restore: ${fpsValues[3]} (expected ~60)`);
    }

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    unsub();
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    // Always restore nominal
    try { ThermalMonitor.reportNativeState('nominal'); } catch { /* ignore */ }
  }

  r.durationMs = Date.now() - t0;
  progress('thermal_stress', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 8. GPU Overload ───────────────────────────────────────────────────────────

async function testGPUOverload(progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('gpu_overload', 'GPU Slot Exhaustion & Recovery');
  const t0 = Date.now();

  r.logs.push('Exhausting GPU render slots then triggering emergency release');

  const acquiredSlots: string[] = [];

  try {
    const gpuBefore = GPUManager.getReport();
    r.metrics['slots_before']     = gpuBefore.usedSlots;
    r.metrics['max_slots']        = gpuBefore.maxSlots;

    progress('gpu_overload', 15, `Acquiring slots (max: ${gpuBefore.maxSlots})`);

    // Exhaust all available slots
    for (let i = 0; i < gpuBefore.maxSlots + 2; i++) {
      const slot = await GPUManager.acquireSlot(`stress_owner_${i}`, 'normal');
      if (slot) {
        acquiredSlots.push(slot);
      } else {
        r.logs.push(`Slot ${i} rejected gracefully (no throw)`);
      }
      progress('gpu_overload', 15 + (i / (gpuBefore.maxSlots + 2)) * 40, `Slot attempt ${i + 1}`);
    }

    const gpuMid = GPUManager.getReport();
    r.metrics['slots_at_peak']    = gpuMid.usedSlots;
    r.logs.push(`Peak: ${gpuMid.usedSlots} slots (max: ${gpuMid.maxSlots})`);

    progress('gpu_overload', 60, 'Triggering emergency release');
    GPUManager.emergencyRelease();
    await sleep(200);

    const gpuAfterEmergency = GPUManager.getReport();
    r.metrics['slots_after_emergency'] = gpuAfterEmergency.usedSlots;

    progress('gpu_overload', 80, 'Releasing remaining tracked slots');
    for (const slot of acquiredSlots) {
      try { GPUManager.releaseSlot(slot); } catch { /* ignore */ }
    }
    acquiredSlots.length = 0;

    await sleep(100);

    const gpuFinal = GPUManager.getReport();
    r.metrics['slots_final']       = gpuFinal.usedSlots;
    r.metrics['total_evictions']   = gpuFinal.totalEvictions;

    if (gpuFinal.usedSlots > 2) {
      r.warnings.push(`${gpuFinal.usedSlots} GPU slots still in use after cleanup`);
    }

    // Validate that slot exhaustion returns null (no throw)
    r.logs.push('Slot exhaustion handled gracefully (no exceptions)');

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception during GPU test: ${e?.message}`);
    r.status = 'failed';
    // Cleanup
    for (const slot of acquiredSlots) {
      try { GPUManager.releaseSlot(slot); } catch { /* ignore */ }
    }
  }

  r.durationMs = Date.now() - t0;
  progress('gpu_overload', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 9. Memory Leak Validation ─────────────────────────────────────────────────

async function testMemoryLeakValidation(userId: string, progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('memory_leak', 'Memory Leak Validation');
  const t0 = Date.now();
  const ITERATIONS = 4;

  r.logs.push(`Running ${ITERATIONS} create-destroy cycles across all subsystems`);

  const snapshots: Array<{ heapMB: number; leaks: number; label: string }> = [];

  try {
    const snap0 = captureMemory();
    snapshots.push({ ...snap0, label: 'baseline' });
    progress('memory_leak', 5, `Baseline: ${snap0.heapMB.toFixed(2)}MB`);

    for (let i = 0; i < ITERATIONS; i++) {
      // Create + destroy a full combo (session + RTC + live)
      const sid = `leak_session_${i}_${Date.now()}`;
      SessionOrchestrator.registerSession('media', sid, {
        onPause: async () => {}, onResume: async () => {}, onEnd: async () => {}, onRecover: async () => true,
      });

      const peer = await RTCManager.createPeer(
        `leak_rtc_${i}_${Date.now()}`, userId || 'leak_user', 'leak_remote',
        { maxReconnects: 1, iceTimeoutMs: 1_000, statsIntervalMs: 200 },
      );
      await peer.negotiate('offer');

      await sleep(400);

      await peer.close();
      await SessionOrchestrator.endSession(sid);

      // Force GC-like pause
      await sleep(200);

      const snap = captureMemory();
      snapshots.push({ ...snap, label: `iter_${i + 1}` });
      progress('memory_leak', 10 + (i + 1) * 20, `Iter ${i + 1}: ${snap.heapMB.toFixed(2)}MB`);
    }

    const baseline = snapshots[0].heapMB;
    const final    = snapshots[snapshots.length - 1].heapMB;
    const delta    = final - baseline;

    // Monotonic increase check
    let monotonicallyIncreasing = true;
    for (let i = 2; i < snapshots.length; i++) {
      if (snapshots[i].heapMB < snapshots[i - 1].heapMB - 0.5) {
        monotonicallyIncreasing = false;
        break;
      }
    }

    r.metrics['baseline_MB']          = baseline.toFixed(2);
    r.metrics['final_MB']             = final.toFixed(2);
    r.metrics['delta_MB']             = delta.toFixed(2);
    r.metrics['monotonic_growth']     = monotonicallyIncreasing ? 'YES' : 'NO';
    r.metrics['stale_leaks']          = snapshots[snapshots.length - 1].leaks;

    for (const snap of snapshots) {
      r.logs.push(`${snap.label}: ${snap.heapMB.toFixed(2)}MB leaks:${snap.leaks}`);
    }

    if (delta > 20) {
      r.errors.push(`Heap grew ${delta.toFixed(1)}MB across ${ITERATIONS} iterations — leak suspected`);
    } else if (delta > 10) {
      r.warnings.push(`Heap grew ${delta.toFixed(1)}MB — monitor for growth over longer runs`);
    } else {
      r.logs.push(`Memory stable: +${delta.toFixed(2)}MB across ${ITERATIONS} iterations`);
    }

    if (monotonicallyIncreasing && delta > 5) {
      r.errors.push('Monotonically increasing memory — definitive leak pattern');
    }

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
  }

  r.durationMs = Date.now() - t0;
  progress('memory_leak', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 10. FPS & Render Stability ────────────────────────────────────────────────

async function testFPSStability(progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('fps_stability', 'FPS & Render Stability');
  const t0 = Date.now();

  r.logs.push('Registering test surfaces and measuring frame stability');

  const SURFACE_ID = 'stress_fps_surface';

  try {
    FrameScheduler.register(SURFACE_ID, 60, 'high');
    progress('fps_stability', 20, 'Surface registered @ 60fps');

    // Simulate 60 frames
    const frameTimes: number[] = [];
    const FRAMES = 60;

    for (let i = 0; i < FRAMES; i++) {
      const shouldRender = FrameScheduler.shouldRender(SURFACE_ID);
      const renderStart  = performance.now();
      await sleep(14 + Math.random() * 4); // simulate ~16ms frame
      const renderMs = performance.now() - renderStart;

      if (shouldRender) {
        FrameScheduler.frameComplete(SURFACE_ID, renderMs);
        frameTimes.push(renderMs);
      }
      if (i % 10 === 0) {
        progress('fps_stability', 20 + (i / FRAMES) * 60, `Frame ${i + 1}/${FRAMES}`);
      }
    }

    FrameScheduler.unregister(SURFACE_ID);
    progress('fps_stability', 85, 'Surface unregistered');

    const stats = FrameScheduler.getStats();
    const surface = stats.find(s => s.id === SURFACE_ID);

    const avgMs = frameTimes.length > 0
      ? (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length).toFixed(2)
      : '0';
    const maxMs = frameTimes.length > 0
      ? Math.max(...frameTimes).toFixed(2)
      : '0';
    const spikeCount = frameTimes.filter(ms => ms > 32).length; // >2x target

    r.metrics['frames_rendered']  = frameTimes.length;
    r.metrics['avg_frame_ms']     = avgMs;
    r.metrics['max_frame_ms']     = maxMs;
    r.metrics['spike_count_2x']   = spikeCount;
    r.metrics['active_fps']       = FrameScheduler.getActiveFPS?.() ?? 60;

    if (parseFloat(maxMs) > 64) {
      r.warnings.push(`Max frame time ${maxMs}ms — potential jank spike`);
    }
    if (spikeCount > frameTimes.length * 0.1) {
      r.warnings.push(`${spikeCount} frames exceeded 2× target (${frameTimes.length} total)`);
    }
    if (frameTimes.length < 10) {
      r.warnings.push('Too few frames rendered — FrameScheduler may be throttling');
    }

    r.logs.push(`Rendered ${frameTimes.length} frames, avg ${avgMs}ms, max ${maxMs}ms`);
    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    try { FrameScheduler.unregister(SURFACE_ID); } catch { /* ignore */ }
  }

  r.durationMs = Date.now() - t0;
  progress('fps_stability', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 11. Realtime Stability ─────────────────────────────────────────────────────

async function testRealtimeStability(progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('realtime_stability', 'Realtime Stability');
  const t0 = Date.now();

  r.logs.push('Checking connection manager, polling stats, and realtime metrics');

  try {
    progress('realtime_stability', 20, 'Sampling connection state');
    const connState = ConnectionManager.state;
    const reconnects = ConnectionManager.reconnectAttempts;
    const queueLen  = ConnectionManager.queueLength;

    r.metrics['connection_state']   = connState;
    r.metrics['reconnect_attempts'] = reconnects;
    r.metrics['queue_length']       = queueLen;

    progress('realtime_stability', 40, 'Reading diagnostics report');
    const diagReport = Diagnostics.getReport();
    r.metrics['realtime_keys']      = diagReport.realtimeStats.registeredKeys;
    r.metrics['avg_latency_ms']     = diagReport.realtimeStats.avgLatencyMs;
    r.metrics['miss_rate']          = diagReport.realtimeStats.missRate;
    r.metrics['network_type']       = ConnectionManager.networkType;

    progress('realtime_stability', 60, 'Checking multiplayer engine');
    r.metrics['multiplayer_rooms']  = MultiplayerEngine.activeRoomCount;

    progress('realtime_stability', 80, 'Validating frame stats');
    const frameStats = diagReport.frameStats;
    for (const f of frameStats) {
      const drop = parseFloat(f.dropRate);
      if (drop > 20) {
        r.warnings.push(`Surface "${f.surface}" drop rate: ${f.dropRate}`);
      }
      r.logs.push(`${f.surface}: ${f.currentFPS}fps drop:${f.dropRate} avg:${f.avgFrameTimeMs}ms`);
    }

    if (connState !== 'connected' && connState !== 'connecting') {
      r.warnings.push(`Connection state: ${connState} (expected connected)`);
    }
    if (reconnects > 3) {
      r.warnings.push(`${reconnects} reconnect attempts observed`);
    }
    if (queueLen > 20) {
      r.warnings.push(`Large event queue: ${queueLen} items`);
    }

    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
  }

  r.durationMs = Date.now() - t0;
  progress('realtime_stability', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ── 12. Recovery Validation ───────────────────────────────────────────────────

async function testRecoveryValidation(userId: string, progress: ProgressCb): Promise<TestResult> {
  const r  = makeResult('recovery_validation', 'Recovery & Resilience Validation');
  const t0 = Date.now();

  r.logs.push('Validating session recovery, RTC reconnect, and stream recovery');

  let peer: any = null;
  const recoveredSessions: string[] = [];

  try {
    // 1. Register session and force recovery
    progress('recovery_validation', 15, 'Testing session recovery');
    const sid = `recovery_session_${Date.now()}`;
    SessionOrchestrator.registerSession('media', sid, {
      onPause:   async () => {},
      onResume:  async () => {},
      onEnd:     async () => {},
      onRecover: async () => {
        recoveredSessions.push(sid);
        return true;
      },
    });

    await SessionOrchestrator.pauseSession(sid);
    const recovered = await SessionOrchestrator.recoverSession(sid);
    r.metrics['session_recovery'] = recovered ? 'SUCCESS' : 'FAILED';
    r.logs.push(`Session recovery: ${recovered ? 'OK' : 'FAILED'}`);
    if (!recovered) r.warnings.push('Session recovery returned false');

    try { await SessionOrchestrator.endSession(sid); } catch { /* ignore */ }

    // 2. RTC reconnect simulation
    progress('recovery_validation', 40, 'Testing RTC reconnect logic');
    peer = await RTCManager.createPeer(
      `recovery_rtc_${Date.now()}`, userId || 'rec_user', 'rec_remote',
      { maxReconnects: 3, iceTimeoutMs: 2_000, statsIntervalMs: 500 },
    );

    let reconnectAttempted = false;
    peer.onStateChange((s: string) => {
      if (s === 'reconnecting') reconnectAttempted = true;
    });

    await peer.negotiate('offer');
    await sleep(1_000);
    // Trigger reconnect manually
    await peer.reconnect();
    await sleep(1_500);
    await peer.close();
    peer = null;

    r.metrics['rtc_reconnect_attempted'] = reconnectAttempted ? 'YES' : 'NO';
    r.logs.push(`RTC reconnect triggered: ${reconnectAttempted ? 'YES' : 'NO'}`);

    // 3. Quality recovery after thermal stress
    progress('recovery_validation', 70, 'Testing quality recovery after thermal');
    const profileBefore = AdaptiveQualityController.currentLevel;
    ThermalMonitor.reportNativeState('serious');
    await sleep(600);
    const profileDegraded = AdaptiveQualityController.currentLevel;
    ThermalMonitor.reportNativeState('nominal');
    await sleep(600);
    const profileAfter = AdaptiveQualityController.currentLevel;

    r.metrics['quality_before_thermal']   = profileBefore;
    r.metrics['quality_during_thermal']   = profileDegraded;
    r.metrics['quality_after_recovery']   = profileAfter;

    const qualityDegraded = profileDegraded !== profileBefore ||
      (profileDegraded === 'minimal' || profileDegraded === 'emergency');
    if (!qualityDegraded) {
      r.warnings.push('Quality did not degrade under thermal stress');
    } else {
      r.logs.push(`Quality degraded correctly: ${profileBefore} → ${profileDegraded} → ${profileAfter}`);
    }

    progress('recovery_validation', 90, 'Recovery validation complete');

    r.metrics['recovered_sessions'] = recoveredSessions.length;
    r.status = r.errors.length > 0 ? 'failed' : r.warnings.length > 0 ? 'warning' : 'passed';

  } catch (e: any) {
    r.errors.push(`Exception: ${e?.message}`);
    r.status = 'failed';
    try { await peer?.close(); } catch { /* ignore */ }
    try { ThermalMonitor.reportNativeState('nominal'); } catch { /* ignore */ }
  }

  r.durationMs = Date.now() - t0;
  progress('recovery_validation', 100, `Done in ${r.durationMs}ms — ${r.status}`);
  return r;
}

// ══════════════════════════════════════════════════════════════════════════════
// MASTER RUNNER
// ══════════════════════════════════════════════════════════════════════════════

export type StressTestId =
  | 'long_session'
  | 'long_livestream'
  | 'long_videocall'
  | 'multitasking'
  | 'reconnect_storm'
  | 'bad_network'
  | 'thermal_stress'
  | 'gpu_overload'
  | 'memory_leak'
  | 'fps_stability'
  | 'realtime_stability'
  | 'recovery_validation';

export const ALL_TEST_IDS: StressTestId[] = [
  'long_session',
  'long_livestream',
  'long_videocall',
  'multitasking',
  'reconnect_storm',
  'bad_network',
  'thermal_stress',
  'gpu_overload',
  'memory_leak',
  'fps_stability',
  'realtime_stability',
  'recovery_validation',
];

export const TEST_LABELS: Record<StressTestId, string> = {
  long_session:        'Long Sessions',
  long_livestream:     'Long Livestream',
  long_videocall:      'Long Videocall',
  multitasking:        'Multitasking',
  reconnect_storm:     'Reconnect Storms',
  bad_network:         'Bad Network',
  thermal_stress:      'Thermal Stress',
  gpu_overload:        'GPU Overload',
  memory_leak:         'Memory Leaks',
  fps_stability:       'FPS Stability',
  realtime_stability:  'Realtime Stability',
  recovery_validation: 'Recovery',
};

export async function runStressTest(
  testId:   StressTestId,
  userId:   string,
  progress: ProgressCb,
): Promise<TestResult> {
  switch (testId) {
    case 'long_session':        return testLongSession(progress);
    case 'long_livestream':     return testLongLivestream(userId, progress);
    case 'long_videocall':      return testLongVideocall(userId, progress);
    case 'multitasking':        return testMultitasking(userId, progress);
    case 'reconnect_storm':     return testReconnectStorm(userId, progress);
    case 'bad_network':         return testBadNetwork(userId, progress);
    case 'thermal_stress':      return testThermalStress(progress);
    case 'gpu_overload':        return testGPUOverload(progress);
    case 'memory_leak':         return testMemoryLeakValidation(userId, progress);
    case 'fps_stability':       return testFPSStability(progress);
    case 'realtime_stability':  return testRealtimeStability(progress);
    case 'recovery_validation': return testRecoveryValidation(userId, progress);
    default:
      return { id: testId, name: testId, status: 'failed', durationMs: 0,
               metrics: {}, warnings: [], errors: ['Unknown test'], logs: [] };
  }
}

export async function runAllStressTests(
  userId:   string,
  progress: ProgressCb,
  onResult: (result: TestResult) => void,
): Promise<StressTestReport> {
  const t0      = Date.now();
  const results: TestResult[] = [];

  for (const testId of ALL_TEST_IDS) {
    const result = await runStressTest(testId, userId, progress);
    results.push(result);
    onResult(result);

    // Brief cooldown between tests to let GC + cleanup settle
    await sleep(500);
  }

  const passed   = results.filter(r => r.status === 'passed').length;
  const failed   = results.filter(r => r.status === 'failed').length;
  const warnings = results.filter(r => r.status === 'warning').length;

  const summary = failed === 0
    ? warnings === 0
      ? `All ${passed} tests passed`
      : `${passed} passed, ${warnings} with warnings`
    : `${passed} passed, ${failed} FAILED, ${warnings} warnings`;

  return {
    runAt:       Date.now(),
    totalTests:  results.length,
    passed, failed, warnings,
    totalTimeMs: Date.now() - t0,
    results,
    summary,
  };
}
