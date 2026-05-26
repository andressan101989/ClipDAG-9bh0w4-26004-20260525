/**
 * app/debug.tsx — Internal Developer Debug Panel
 *
 * Accessible by shaking the device (expo-sensors accelerometer) in
 * development builds. Shows real-time infrastructure diagnostics.
 *
 * Data sources:
 *   - Diagnostics.getReport()       → FPS, uploads, realtime latency
 *   - LeakDetector.getReport()      → open resources, stale count
 *   - PowerManager.currentTier      → current power/thermal tier
 *   - RenderIsolationManager        → active render surfaces
 *   - StreamingBufferManager        → buffer states + stall rates
 *   - UploadRecoveryManager         → pending/failed uploads
 *   - BackpressureQueue             → queue depths
 *   - ConnectionManager             → connection state + queue
 *   - AdaptiveQualityController     → current quality profile
 *
 * Navigation:
 *   In development: app automatically includes a "Debug" entry.
 *   On physical device: shake to open (handled via Accelerometer).
 *   Direct route: push('/debug') from any screen.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Diagnostics }              from '@/modules/core/Diagnostics';
import { LeakDetector }             from '@/modules/core/LeakDetector';
import { PowerManager }             from '@/modules/core/PowerManager';
import { RenderIsolationManager }   from '@/modules/core/RenderIsolationManager';
import { AdaptiveQualityController } from '@/modules/core/AdaptiveQualityController';
import { ConnectionManager }        from '@/modules/realtime/ConnectionManager';
import { StreamingBufferManager }   from '@/modules/media/StreamingBufferManager';
import { UploadRecoveryManager }    from '@/modules/media/UploadRecoveryManager';

// Conditional import — only render in __DEV__
const IS_DEV = __DEV__;

// ── Types ─────────────────────────────────────────────────────────────────────

type Section = 'system' | 'render' | 'realtime' | 'media' | 'memory';

const SECTION_LABELS: Record<Section, string> = {
  system:   'System',
  render:   'Render',
  realtime: 'Realtime',
  media:    'Media',
  memory:   'Memory',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, warn && styles.rowValueWarn]}>{value}</Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

function SystemSection() {
  const report  = Diagnostics.getReport();
  const leak    = LeakDetector.getReport();
  const profile = AdaptiveQualityController.currentProfile;

  const tierColor: Record<string, string> = {
    performance: '#00FF88', balanced: '#FFD700', saver: '#FF8C00', emergency: '#FF2D2D',
  };

  return (
    <>
      <Card title="Power / Quality">
        <MetricRow label="Power tier"    value={PowerManager.currentTier.toUpperCase()} />
        <MetricRow label="Quality level" value={profile.level.toUpperCase()} />
        <MetricRow label="Max FPS"       value={`${profile.maxFPS}`} />
        <MetricRow label="AR enabled"    value={profile.arEnabled ? 'YES' : 'NO'} warn={!profile.arEnabled} />
        <MetricRow label="Thermal"       value={report.thermalState.toUpperCase()} warn={report.thermalState !== 'nominal'} />
        <MetricRow label="GPU pressure"  value={report.gpuPressure.toUpperCase()} warn={report.gpuPressure !== 'none'} />
      </Card>
      <Card title="Leak Detector">
        <MetricRow label="Tracked resources" value={`${leak.totalTracked}`} />
        <MetricRow label="Stale (>30s)"      value={`${leak.staleCount}`} warn={leak.staleCount > 0} />
        <MetricRow label="Force released"    value={`${leak.forceReleasedCount}`} warn={leak.forceReleasedCount > 0} />
        <MetricRow label="By type"           value={Object.entries(leak.byType).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'} />
      </Card>
    </>
  );
}

function RenderSection() {
  const report   = Diagnostics.getReport();
  const surfaces = RenderIsolationManager.getActiveSurfaces();
  const budget   = RenderIsolationManager.getTotalBudgetUsedMs();

  return (
    <>
      <Card title="Frame Stats">
        {report.frameStats.length === 0 && <MetricRow label="No surfaces" value="—" />}
        {report.frameStats.map(s => (
          <MetricRow
            key={s.surface}
            label={s.surface}
            value={`${s.currentFPS}fps drop:${s.dropRate}`}
            warn={parseFloat(s.dropRate) > 20}
          />
        ))}
      </Card>
      <Card title="Render Surfaces">
        <MetricRow label="Total budget" value={`${budget.toFixed(1)}ms / 16.7ms`} warn={budget > 14} />
        {surfaces.map(s => (
          <MetricRow
            key={s.id}
            label={s.id}
            value={`${s.fps}fps ${s.suspended ? '⏸ SUSPENDED' : s.visible ? '▶ ACTIVE' : '👁 OFFSCREEN'}`}
            warn={s.suspended}
          />
        ))}
        {surfaces.length === 0 && <MetricRow label="No surfaces registered" value="—" />}
      </Card>
      <Card title="Recent Screens">
        {report.recentScreens.slice(-5).map((s, i) => (
          <MetricRow
            key={i}
            label={s.screen}
            value={`${s.durationMs ? (s.durationMs / 1000).toFixed(1) + 's' : 'active'} render:${s.renderTimeMs.toFixed(0)}ms`}
            warn={s.renderTimeMs > 500}
          />
        ))}
        {report.recentScreens.length === 0 && <MetricRow label="No screen data" value="—" />}
      </Card>
    </>
  );
}

function RealtimeSection() {
  const report = Diagnostics.getReport();
  const conn   = ConnectionManager.state;
  const queue  = ConnectionManager.queueLength;
  const sessions = UploadRecoveryManager.allJobs;

  return (
    <>
      <Card title="Connection">
        <MetricRow label="State"          value={conn.toUpperCase()} warn={conn !== 'connected'} />
        <MetricRow label="Queue depth"    value={`${queue}`}         warn={queue > 10} />
        <MetricRow label="Reconnects"     value={`${ConnectionManager.reconnectAttempts}`} warn={ConnectionManager.reconnectAttempts > 0} />
        <MetricRow label="Network type"   value={ConnectionManager.networkType.toUpperCase()} />
      </Card>
      <Card title="Realtime Diagnostics">
        <MetricRow label="Keys tracked"  value={`${report.realtimeStats.registeredKeys}`} />
        <MetricRow label="Avg latency"   value={report.realtimeStats.avgLatencyMs} warn={report.realtimeStats.avgLatencyMs !== 'N/A' && parseFloat(report.realtimeStats.avgLatencyMs) > 500} />
        <MetricRow label="Miss rate"     value={report.realtimeStats.missRate} warn={report.realtimeStats.missRate !== 'N/A' && parseFloat(report.realtimeStats.missRate) > 5} />
      </Card>
    </>
  );
}

function MediaSection() {
  const report  = Diagnostics.getReport();
  const buffers = StreamingBufferManager.getStats();
  const pending = UploadRecoveryManager.pendingCount;

  return (
    <>
      <Card title="Uploads">
        <MetricRow label="Total recorded"  value={`${report.uploadStats.count}`} />
        <MetricRow label="Success rate"    value={report.uploadStats.successRate} warn={report.uploadStats.successRate !== 'N/A' && parseFloat(report.uploadStats.successRate) < 90} />
        <MetricRow label="Avg speed"       value={`${report.uploadStats.avgSpeedKBps} KB/s`} />
        <MetricRow label="Pending recovery" value={`${pending}`} warn={pending > 0} />
      </Card>
      <Card title="Stream Buffers">
        <MetricRow label="Active buffers"  value={`${StreamingBufferManager.activeBufferCount}`} />
        <MetricRow label="Avg stall rate"  value={`${StreamingBufferManager.getTotalStallRate().toFixed(2)}`} warn={StreamingBufferManager.getTotalStallRate() > 1} />
        {buffers.map(b => (
          <MetricRow
            key={b.videoId}
            label={`${b.type}:${b.videoId.slice(-6)}`}
            value={`${b.state} buf:${b.bufferedMs.toFixed(0)}ms stalls:${b.stallCount}`}
            warn={b.state === 'stalled'}
          />
        ))}
        {buffers.length === 0 && <MetricRow label="No active streams" value="—" />}
      </Card>
    </>
  );
}

function MemorySection() {
  const report  = Diagnostics.getReport();
  const heldRes = report.heldResources;

  const recent5 = report.memoryHistory.slice(-5);

  return (
    <>
      <Card title="Heap Snapshots">
        {recent5.map((s, i) => (
          <MetricRow
            key={i}
            label={new Date(s.timestamp).toLocaleTimeString()}
            value={`${s.heapUsedMB.toFixed(1)} MB`}
            warn={s.heapUsedMB > 200}
          />
        ))}
        {recent5.length === 0 && <MetricRow label="No snapshots yet" value="—" />}
      </Card>
      <Card title="Held Resources">
        {heldRes.length === 0
          ? <MetricRow label="No resources held" value="✓" />
          : heldRes.map((r, i) => (
              <MetricRow
                key={i}
                label={r.type}
                value={`holder:${r.holder} pri:${r.priority}`}
              />
            ))
        }
      </Card>
    </>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DebugScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const [activeSection, setActiveSection] = useState<Section>('system');
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);

  // Auto-refresh every 2 seconds
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 2_000);
    return () => clearInterval(timer);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTick(t => t + 1);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  if (!IS_DEV) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.empty}>Debug panel only available in development builds.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Debug Panel</Text>
        <View style={styles.liveDot} />
      </View>

      {/* Section tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
        {(Object.keys(SECTION_LABELS) as Section[]).map(s => (
          <Pressable
            key={s}
            onPress={() => setActiveSection(s)}
            style={[styles.tab, activeSection === s && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeSection === s && styles.tabTextActive]}>
              {SECTION_LABELS[s]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7C5CFF" />}
        showsVerticalScrollIndicator={false}
      >
        {activeSection === 'system'   && <SystemSection   key={tick} />}
        {activeSection === 'render'   && <RenderSection   key={tick} />}
        {activeSection === 'realtime' && <RealtimeSection key={tick} />}
        {activeSection === 'media'    && <MediaSection    key={tick} />}
        {activeSection === 'memory'   && <MemorySection   key={tick} />}
      </ScrollView>
    </View>
  );
}

const C = {
  bg:       '#0A0A0F',
  surface:  '#12121A',
  border:   '#1E1E2E',
  text:     '#E8E8F0',
  subtle:   'rgba(255,255,255,0.4)',
  accent:   '#7C5CFF',
  warn:     '#FF8C00',
  good:     '#00FF88',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { marginRight: 12 },
  backText: { color: C.accent, fontSize: 14, fontWeight: '600' },
  title: {
    flex: 1,
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  liveDot: {
    width: 8, height: 8,
    borderRadius: 4,
    backgroundColor: C.good,
  },
  tabs: {
    maxHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tabsContent: {
    paddingHorizontal: 12,
    gap: 4,
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: C.accent + '33',
  },
  tabText: {
    color: C.subtle,
    fontSize: 13,
    fontWeight: '500',
  },
  tabTextActive: {
    color: C.accent,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: {
    color: C.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowLabel: {
    color: C.subtle,
    fontSize: 12,
    flex: 1,
  },
  rowValue: {
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flex: 1,
  },
  rowValueWarn: {
    color: C.warn,
  },
  empty: {
    color: C.subtle,
    textAlign: 'center',
    marginTop: 40,
  },
});
