/**
 * app/stress-test.tsx — Phase 5 Stress Testing & Validation Screen
 *
 * Full test suite UI:
 *   • Run individual tests or the full suite
 *   • Live progress per test (progress bar + log stream)
 *   • Pass/Fail/Warning badges with metric display
 *   • Real-time system metrics panel (FPS, memory, thermal, GPU)
 *   • Export-ready summary with actionable findings
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Platform, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter }         from 'expo-router';
import { LinearGradient }    from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  runStressTest, runAllStressTests,
  ALL_TEST_IDS, TEST_LABELS,
  type TestResult, type StressTestId, type StressTestReport,
} from '@/services/stressTestRunner';

import { useAuth }             from '@/hooks/useAuth';
import { ProductionStabilityMode } from '@/modules/core/ProductionStabilityMode';
import { GPUManager }          from '@/modules/core/GPUManager';
import { FrameScheduler }      from '@/modules/core/FrameScheduler';
import { ThermalMonitor }      from '@/modules/core/ThermalMonitor';
import { LeakDetector }        from '@/modules/core/LeakDetector';
import { RTCManager }          from '@/modules/realtime/RTCManager';
import { LiveOrchestrator }    from '@/modules/streaming/LiveOrchestrator';
import { SessionOrchestrator } from '@/modules/sessions/SessionOrchestrator';

const { width: SCREEN_W } = Dimensions.get('window');
const IS_DEV = __DEV__;

// ── Colors ────────────────────────────────────────────────────────────────────

const C = {
  bg:       '#07070F',
  surface:  '#0E0E1A',
  elevated: '#14142A',
  border:   '#1A1A2E',
  text:     '#E8E8F0',
  subtle:   'rgba(255,255,255,0.4)',
  accent:   '#7C5CFF',
  pass:     '#00E5A0',
  fail:     '#FF3D5E',
  warn:     '#FFB800',
  idle:     'rgba(255,255,255,0.2)',
};

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  idle:    C.idle,
  running: C.accent,
  passed:  C.pass,
  failed:  C.fail,
  warning: C.warn,
};

const STATUS_ICON: Record<string, string> = {
  idle:    'circle-outline',
  running: 'loading',
  passed:  'check-circle',
  failed:  'close-circle',
  warning: 'alert-circle',
};

// ── SystemPanel — live metrics ────────────────────────────────────────────────

function SystemPanel() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 2_000);
    return () => clearInterval(t);
  }, []);

  const stability = ProductionStabilityMode.mode;
  const gpu       = GPUManager.getReport();
  const fps       = FrameScheduler.getActiveFPS?.() ?? 60;
  const thermal   = ThermalMonitor.currentState;
  const leaks     = LeakDetector.getReport();
  const rtcPeers  = RTCManager.activePeerCount;
  const liveSessions = LiveOrchestrator.activeCount;

  const stabColor =
    stability === 'nominal'   ? C.pass  :
    stability === 'stress'    ? C.warn  :
    stability === 'degraded'  ? '#FF8C00' :
    C.fail;

  return (
    <View style={sp.container}>
      <Text style={sp.title}>SYSTEM STATUS</Text>
      <View style={sp.grid}>
        <Metric label="Stability" value={stability.toUpperCase()} color={stabColor} />
        <Metric label="Thermal"   value={thermal.toUpperCase()}   color={thermal === 'nominal' ? C.pass : C.warn} />
        <Metric label="FPS cap"   value={`${fps}`}                color={fps >= 50 ? C.pass : fps >= 24 ? C.warn : C.fail} />
        <Metric label="GPU slots" value={`${gpu.usedSlots}/${gpu.maxSlots}`} color={gpu.usedSlots < gpu.maxSlots ? C.pass : C.warn} />
        <Metric label="RTC peers" value={`${rtcPeers}`}           color={rtcPeers === 0 ? C.pass : C.warn} />
        <Metric label="Live sess" value={`${liveSessions}`}        color={C.subtle} />
        <Metric label="Stale leaks" value={`${leaks.staleCount}`} color={leaks.staleCount === 0 ? C.pass : C.fail} />
        <Metric label="Sessions"  value={`${SessionOrchestrator.getInventory().length}`} color={C.subtle} />
      </View>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={sp.metric}>
      <Text style={[sp.metricValue, { color }]}>{value}</Text>
      <Text style={sp.metricLabel}>{label}</Text>
    </View>
  );
}

const sp = StyleSheet.create({
  container: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, padding: 12,
  },
  title: { color: C.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },
  grid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: {
    width: (SCREEN_W - 32 - 12 * 3) / 4,
    backgroundColor: C.elevated, borderRadius: 8, padding: 8, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  metricValue: { fontSize: 13, fontWeight: '700' },
  metricLabel: { color: C.subtle, fontSize: 9, marginTop: 2, textTransform: 'uppercase' },
});

// ── TestCard ──────────────────────────────────────────────────────────────────

interface TestProgress {
  progress: number;
  log:      string;
}

function TestCard({
  testId,
  result,
  progressData,
  running,
  onRun,
}: {
  testId:       StressTestId;
  result?:      TestResult;
  progressData: TestProgress;
  running:      boolean;
  onRun:        (id: StressTestId) => void;
}) {
  const status = result?.status ?? (running ? 'running' : 'idle');
  const color  = STATUS_COLOR[status] ?? C.idle;

  return (
    <View style={tc.card}>
      {/* Header row */}
      <View style={tc.header}>
        <MaterialCommunityIcons
          name={status === 'running' ? 'loading' : STATUS_ICON[status] as any}
          size={18}
          color={color}
        />
        <Text style={tc.name}>{TEST_LABELS[testId]}</Text>
        {result ? (
          <Text style={[tc.badge, { color, borderColor: color + '55', backgroundColor: color + '15' }]}>
            {status.toUpperCase()}
          </Text>
        ) : running ? (
          <ActivityIndicator size="small" color={C.accent} />
        ) : (
          <Pressable onPress={() => onRun(testId)} style={tc.runBtn} hitSlop={6}>
            <Text style={tc.runBtnText}>Run</Text>
          </Pressable>
        )}
      </View>

      {/* Progress bar while running */}
      {running ? (
        <View style={tc.progressWrap}>
          <View style={[tc.progressBar, { width: `${progressData.progress}%` as any }]} />
        </View>
      ) : null}

      {/* Live log while running */}
      {running && progressData.log ? (
        <Text style={tc.logText} numberOfLines={1}>{progressData.log}</Text>
      ) : null}

      {/* Results */}
      {result ? (
        <>
          <View style={tc.metricsRow}>
            {Object.entries(result.metrics).slice(0, 4).map(([k, v]) => (
              <View key={k} style={tc.metricChip}>
                <Text style={tc.metricKey}>{k.replace(/_/g, ' ')}</Text>
                <Text style={tc.metricVal}>{String(v)}</Text>
              </View>
            ))}
          </View>
          {result.errors.length > 0 && (
            <View style={[tc.msgBanner, { backgroundColor: C.fail + '15', borderColor: C.fail + '44' }]}>
              {result.errors.map((e, i) => (
                <Text key={i} style={[tc.msgText, { color: C.fail }]}>✗ {e}</Text>
              ))}
            </View>
          )}
          {result.warnings.length > 0 && result.errors.length === 0 && (
            <View style={[tc.msgBanner, { backgroundColor: C.warn + '15', borderColor: C.warn + '44' }]}>
              {result.warnings.map((w, i) => (
                <Text key={i} style={[tc.msgText, { color: C.warn }]}>⚠ {w}</Text>
              ))}
            </View>
          )}
          <Text style={tc.duration}>{result.durationMs}ms</Text>
        </>
      ) : null}
    </View>
  );
}

const tc = StyleSheet.create({
  card: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 12, marginBottom: 8, gap: 8,
  },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name:        { flex: 1, color: C.text, fontSize: 14, fontWeight: '600' },
  badge:       { fontSize: 10, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  runBtn:      { backgroundColor: C.accent + '22', borderRadius: 8, borderWidth: 1, borderColor: C.accent + '55', paddingHorizontal: 10, paddingVertical: 4 },
  runBtnText:  { color: C.accent, fontSize: 12, fontWeight: '700' },
  progressWrap: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: C.accent, borderRadius: 2 },
  logText:     { color: C.subtle, fontSize: 11, fontStyle: 'italic' },
  metricsRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricChip:  {
    backgroundColor: C.elevated, borderRadius: 6, borderWidth: 1,
    borderColor: C.border, paddingHorizontal: 8, paddingVertical: 4,
  },
  metricKey:   { color: C.subtle, fontSize: 9, textTransform: 'uppercase' },
  metricVal:   { color: C.text,   fontSize: 11, fontWeight: '600' },
  msgBanner:   { borderRadius: 8, borderWidth: 1, padding: 8, gap: 3 },
  msgText:     { fontSize: 11 },
  duration:    { color: C.subtle, fontSize: 10, textAlign: 'right' },
});

// ── Summary Banner ────────────────────────────────────────────────────────────

function SummaryBanner({ report }: { report: StressTestReport }) {
  const allPass = report.failed === 0 && report.warnings === 0;
  const hasFail = report.failed > 0;
  const color   = hasFail ? C.fail : allPass ? C.pass : C.warn;

  return (
    <View style={[sb.wrap, { borderColor: color + '44' }]}>
      <LinearGradient
        colors={[color + '20', color + '08']}
        style={sb.grad}
      >
        <View style={sb.row}>
          <MaterialCommunityIcons
            name={hasFail ? 'close-circle' : allPass ? 'check-all' : 'alert'}
            size={22}
            color={color}
          />
          <View style={{ flex: 1 }}>
            <Text style={[sb.summary, { color }]}>{report.summary}</Text>
            <Text style={sb.time}>Total: {(report.totalTimeMs / 1000).toFixed(1)}s · {new Date(report.runAt).toLocaleTimeString()}</Text>
          </View>
        </View>
        <View style={sb.statsRow}>
          {[
            { label: 'Passed',   val: report.passed,   color: C.pass },
            { label: 'Failed',   val: report.failed,   color: C.fail },
            { label: 'Warnings', val: report.warnings, color: C.warn },
          ].map(s => (
            <View key={s.label} style={sb.stat}>
              <Text style={[sb.statVal, { color: s.color }]}>{s.val}</Text>
              <Text style={sb.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
    </View>
  );
}

const sb = StyleSheet.create({
  wrap:     { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  grad:     { padding: 14, gap: 12 },
  row:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  summary:  { fontSize: 15, fontWeight: '700' },
  time:     { color: C.subtle, fontSize: 11, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 12 },
  stat:     { alignItems: 'center' },
  statVal:  { fontSize: 20, fontWeight: '800' },
  statLabel:{ color: C.subtle, fontSize: 10, textTransform: 'uppercase' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function StressTestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [results,   setResults]   = useState<Record<string, TestResult>>({});
  const [running,   setRunning]   = useState<StressTestId | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [progress,  setProgress]  = useState<Record<string, { progress: number; log: string }>>({});
  const [report,    setReport]    = useState<StressTestReport | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const progressCb = useCallback((testId: string, pct: number, log: string) => {
    setProgress(prev => ({ ...prev, [testId]: { progress: pct, log } }));
  }, []);

  const runSingle = useCallback(async (testId: StressTestId) => {
    if (running || suiteRunning) return;
    setRunning(testId);
    setResults(prev => {
      const copy = { ...prev };
      delete copy[testId];
      return copy;
    });
    setProgress(prev => ({ ...prev, [testId]: { progress: 0, log: 'Starting...' } }));

    const result = await runStressTest(testId, user?.id ?? 'dev_user', progressCb);
    setResults(prev => ({ ...prev, [testId]: result }));
    setRunning(null);
  }, [running, suiteRunning, user, progressCb]);

  const runAll = useCallback(async () => {
    if (running || suiteRunning) return;
    setSuiteRunning(true);
    setResults({});
    setReport(null);
    setProgress({});

    const fullReport = await runAllStressTests(
      user?.id ?? 'dev_user',
      progressCb,
      (result) => {
        setResults(prev => ({ ...prev, [result.id]: result }));
        // Auto-scroll to bottom as tests complete
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      },
    );

    setReport(fullReport);
    setSuiteRunning(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [running, suiteRunning, user, progressCb]);

  if (!IS_DEV) {
    return (
      <View style={[s.container, { paddingTop: insets.top + 16 }]}>
        <Text style={{ color: C.subtle, textAlign: 'center' }}>
          Stress tests only available in development builds.
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} hitSlop={8}>
          <Text style={s.backText}>← Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Stress Tests</Text>
          <Text style={s.subtitle}>Phase 5 — Validation Suite</Text>
        </View>
        {suiteRunning ? (
          <ActivityIndicator color={C.accent} />
        ) : (
          <Pressable onPress={runAll} style={s.runAllBtn} disabled={!!running}>
            <LinearGradient
              colors={['#7C5CFF', '#FF2D78']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.runAllGrad}
            >
              <MaterialCommunityIcons name="play-speed" size={14} color="#fff" />
              <Text style={s.runAllText}>Run All</Text>
            </LinearGradient>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Live system metrics */}
        <SystemPanel />

        {/* Summary */}
        {report ? <SummaryBanner report={report} /> : null}

        {/* Suite progress bar */}
        {suiteRunning ? (
          <View style={s.suiteProgress}>
            <View style={s.suiteProgressBar}>
              <View style={[
                s.suiteProgressFill,
                { width: `${(Object.keys(results).length / ALL_TEST_IDS.length) * 100}%` as any },
              ]} />
            </View>
            <Text style={s.suiteProgressText}>
              {Object.keys(results).length} / {ALL_TEST_IDS.length} tests complete
            </Text>
          </View>
        ) : null}

        {/* Individual test cards */}
        <View style={s.cardsContainer}>
          <Text style={s.sectionLabel}>INDIVIDUAL TESTS</Text>
          {ALL_TEST_IDS.map(id => (
            <TestCard
              key={id}
              testId={id}
              result={results[id]}
              progressData={progress[id] ?? { progress: 0, log: '' }}
              running={running === id || (suiteRunning && !results[id] && Object.keys(results).length === ALL_TEST_IDS.indexOf(id))}
              onRun={runSingle}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bg },
  header:       {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  back:         { paddingRight: 4 },
  backText:     { color: C.accent, fontSize: 14, fontWeight: '600' },
  title:        { color: C.text, fontSize: 16, fontWeight: '800' },
  subtitle:     { color: C.subtle, fontSize: 11 },
  runAllBtn:    { borderRadius: 10, overflow: 'hidden' },
  runAllGrad:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7 },
  runAllText:   { color: '#fff', fontSize: 12, fontWeight: '700' },
  scroll:       { paddingTop: 12 },
  suiteProgress: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, padding: 12, gap: 6,
  },
  suiteProgressBar:  { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  suiteProgressFill: { height: '100%', backgroundColor: C.accent, borderRadius: 3 },
  suiteProgressText: { color: C.subtle, fontSize: 11, textAlign: 'center' },
  cardsContainer:    { paddingHorizontal: 16 },
  sectionLabel:      {
    color: C.subtle, fontSize: 10, fontWeight: '700', letterSpacing: 1.2,
    marginBottom: 8, marginTop: 4,
  },
});
