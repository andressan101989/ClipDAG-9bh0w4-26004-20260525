/**
 * app/debug.tsx — Internal Developer Debug Panel v2
 *
 * Real-time metrics across ALL infrastructure systems:
 *   - ProductionStabilityMode tier + score
 *   - RTCManager active peers
 *   - SessionOrchestrator inventory
 *   - PresenceManager cache
 *   - Diagnostics ring-buffer (FPS, memory, GPU, thermal)
 *   - LeakDetector (open + stale resources)
 *   - ConnectionManager state
 *   - StreamingBufferManager (active buffers + stall rate)
 *   - UploadRecoveryManager (pending jobs)
 *   - SecurityManager (recent violations)
 *   - PowerManager tier
 *   - RenderIsolationManager surfaces
 *   - AdaptiveQualityController profile
 *   - MultiplayerEngine active rooms
 *   - LiveOrchestrator active sessions
 *
 * Auto-refreshes every 2 seconds.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter }         from 'expo-router';

import { Diagnostics }               from '@/modules/core/Diagnostics';
import { LeakDetector }              from '@/modules/core/LeakDetector';
import { PowerManager }              from '@/modules/core/PowerManager';
import { RenderIsolationManager }    from '@/modules/core/RenderIsolationManager';
import { AdaptiveQualityController } from '@/modules/core/AdaptiveQualityController';
import { ProductionStabilityMode }   from '@/modules/core/ProductionStabilityMode';
import { SecurityManager }           from '@/modules/core/SecurityManager';
import { ConnectionManager }         from '@/modules/realtime/ConnectionManager';
import { StreamingBufferManager }    from '@/modules/media/StreamingBufferManager';
import { UploadRecoveryManager }     from '@/modules/media/UploadRecoveryManager';
import { SessionOrchestrator }       from '@/modules/sessions/SessionOrchestrator';
import { RTCManager }                from '@/modules/realtime/RTCManager';
import { PresenceManager }           from '@/modules/realtime/PresenceManager';
import { MultiplayerEngine }         from '@/modules/gaming/MultiplayerEngine';
import { LiveOrchestrator }          from '@/modules/streaming/LiveOrchestrator';
import { TelemetryPipeline }         from '@/modules/core/TelemetryPipeline';

const IS_DEV = __DEV__;
type Section = 'stability' | 'system' | 'sessions' | 'realtime' | 'media' | 'security';

const SECTION_LABELS: Record<Section, string> = {
  stability: '🔥 Stability',
  system:    '⚙️ System',
  sessions:  '📋 Sessions',
  realtime:  '📡 Realtime',
  media:     '🎬 Media',
  security:  '🛡 Security',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value, warn, good }: {
  label: string; value: string; warn?: boolean; good?: boolean;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[
        s.rowValue,
        warn ? s.warn : good ? s.good : null,
      ]}>
        {value}
      </Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ── Stability Section ─────────────────────────────────────────────────────────

function StabilitySection() {
  const mode    = ProductionStabilityMode.currentMode;
  const score   = ProductionStabilityMode.currentScore;
  const tier    = PowerManager.currentTier;
  const report  = Diagnostics.getReport();

  const modeColor: Record<string, string> = {
    nominal:   '#00FF88',
    stress:    '#FFD700',
    degraded:  '#FF8C00',
    critical:  '#FF4444',
    emergency: '#FF2D2D',
  };

  return (
    <>
      <Card title="Production Stability Mode">
        <Row label="Mode"           value={mode.toUpperCase()}
             warn={mode === 'critical' || mode === 'emergency'}
             good={mode === 'nominal'} />
        <Row label="Score"          value={`${score.toFixed(1)} / 100`}
             warn={score > 60} good={score < 30} />
        <Row label="Can Effects"    value={ProductionStabilityMode.canRenderEffects    ? 'YES' : 'NO'} warn={!ProductionStabilityMode.canRenderEffects} />
        <Row label="Can Prefetch"   value={ProductionStabilityMode.canPrefetch         ? 'YES' : 'NO'} warn={!ProductionStabilityMode.canPrefetch} />
        <Row label="Can Overlays"   value={ProductionStabilityMode.canRenderOverlays   ? 'YES' : 'NO'} warn={!ProductionStabilityMode.canRenderOverlays} />
      </Card>
      <Card title="Thermal / Power">
        <Row label="Thermal"    value={report.thermalState.toUpperCase()}  warn={report.thermalState !== 'nominal'} />
        <Row label="Power tier" value={tier.toUpperCase()}                 warn={tier !== 'performance'} />
        <Row label="GPU"        value={report.gpuPressure.toUpperCase()}   warn={report.gpuPressure !== 'none'} />
      </Card>
    </>
  );
}

// ── System Section ────────────────────────────────────────────────────────────

function SystemSection() {
  const report   = Diagnostics.getReport();
  const leak     = LeakDetector.getReport();
  const profile  = AdaptiveQualityController.currentProfile;
  const surfaces = RenderIsolationManager.getActiveSurfaces();
  const budget   = RenderIsolationManager.getTotalBudgetUsedMs();

  return (
    <>
      <Card title="Quality Profile">
        <Row label="Level"   value={profile.level.toUpperCase()} />
        <Row label="Max FPS" value={`${profile.maxFPS}`} />
        <Row label="AR"      value={profile.arEnabled ? 'ENABLED' : 'DISABLED'} warn={!profile.arEnabled} />
      </Card>
      <Card title="Leak Detector">
        <Row label="Tracked"        value={`${leak.totalTracked}`} />
        <Row label="Stale (>30s)"   value={`${leak.staleCount}`}          warn={leak.staleCount > 0} />
        <Row label="Force-released" value={`${leak.forceReleasedCount}`}  warn={leak.forceReleasedCount > 0} />
        <Row label="By type"
             value={Object.entries(leak.byType).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'} />
      </Card>
      <Card title="Render Surfaces">
        <Row label="Budget used" value={`${budget.toFixed(1)} / 16.7ms`} warn={budget > 14} />
        {surfaces.map(surf => (
          <Row
            key={surf.id}
            label={surf.id}
            value={`${surf.fps}fps ${surf.suspended ? '⏸' : '▶'}`}
            warn={surf.suspended}
          />
        ))}
        {surfaces.length === 0 && <Row label="No surfaces" value="—" />}
      </Card>
      <Card title="Memory Snapshots">
        {report.memoryHistory.slice(-4).map((s, i) => (
          <Row
            key={i}
            label={new Date(s.timestamp).toLocaleTimeString()}
            value={`${s.heapUsedMB.toFixed(1)} MB`}
            warn={s.heapUsedMB > 200}
          />
        ))}
        {report.memoryHistory.length === 0 && <Row label="No snapshots" value="—" />}
      </Card>
    </>
  );
}

// ── Sessions Section ──────────────────────────────────────────────────────────

function SessionsSection() {
  const inventory  = SessionOrchestrator.getInventory();
  const rtcPeers   = RTCManager.activePeerCount;
  const mpRooms    = MultiplayerEngine.activeRoomCount;
  const liveCount  = LiveOrchestrator.activeCount;

  return (
    <>
      <Card title="Session Counts">
        <Row label="SessionOrchestrator" value={`${inventory.length} active`}
             warn={inventory.length > 5} />
        <Row label="RTC Peers"           value={`${rtcPeers}`}   warn={rtcPeers > 3} />
        <Row label="Multiplayer Rooms"   value={`${mpRooms}`} />
        <Row label="Live Sessions"       value={`${liveCount}`} />
      </Card>
      <Card title="Session Inventory">
        {inventory.length === 0
          ? <Row label="No sessions" value="—" />
          : inventory.map(sess => (
            <Row
              key={sess.id}
              label={`${sess.type}`}
              value={`${sess.status} ${sess.uptimeSec}s`}
              warn={sess.status === 'recovering'}
              good={sess.status === 'active'}
            />
          ))
        }
      </Card>
    </>
  );
}

// ── Realtime Section ──────────────────────────────────────────────────────────

function RealtimeSection() {
  const report = Diagnostics.getReport();
  const conn   = ConnectionManager.state;
  const queue  = ConnectionManager.queueLength;
  const frames = report.frameStats;

  return (
    <>
      <Card title="Connection">
        <Row label="State"       value={conn.toUpperCase()}                   warn={conn !== 'connected'} good={conn === 'connected'} />
        <Row label="Queue"       value={`${queue}`}                           warn={queue > 10} />
        <Row label="Reconnects"  value={`${ConnectionManager.reconnectAttempts}`} warn={ConnectionManager.reconnectAttempts > 0} />
        <Row label="Network"     value={ConnectionManager.networkType.toUpperCase()} />
      </Card>
      <Card title="Realtime Stats">
        <Row label="Keys tracked" value={`${report.realtimeStats.registeredKeys}`} />
        <Row label="Avg latency"  value={report.realtimeStats.avgLatencyMs}
             warn={report.realtimeStats.avgLatencyMs !== 'N/A' &&
                   parseFloat(report.realtimeStats.avgLatencyMs) > 500} />
        <Row label="Miss rate"    value={report.realtimeStats.missRate}
             warn={report.realtimeStats.missRate !== 'N/A' &&
                   parseFloat(report.realtimeStats.missRate) > 5} />
      </Card>
      <Card title="Frame Stats">
        {frames.length === 0
          ? <Row label="No surfaces" value="—" />
          : frames.map(f => (
            <Row
              key={f.surface}
              label={f.surface}
              value={`${f.currentFPS} fps  drop:${f.dropRate}`}
              warn={parseFloat(f.dropRate) > 20}
            />
          ))
        }
      </Card>
    </>
  );
}

// ── Media Section ─────────────────────────────────────────────────────────────

function MediaSection() {
  const report  = Diagnostics.getReport();
  const buffers = StreamingBufferManager.getStats();
  const pending = UploadRecoveryManager.pendingCount;

  return (
    <>
      <Card title="Uploads">
        <Row label="Total"         value={`${report.uploadStats.count}`} />
        <Row label="Success rate"  value={report.uploadStats.successRate}
             warn={report.uploadStats.successRate !== 'N/A' &&
                   parseFloat(report.uploadStats.successRate) < 90}
             good={report.uploadStats.successRate !== 'N/A' &&
                   parseFloat(report.uploadStats.successRate) >= 98} />
        <Row label="Avg speed"     value={`${report.uploadStats.avgSpeedKBps} KB/s`} />
        <Row label="Pending recovery" value={`${pending}`} warn={pending > 0} />
      </Card>
      <Card title="Stream Buffers">
        <Row label="Active"     value={`${StreamingBufferManager.activeBufferCount}`} />
        <Row label="Stall rate" value={`${StreamingBufferManager.getTotalStallRate().toFixed(2)}/s`}
             warn={StreamingBufferManager.getTotalStallRate() > 1} />
        {buffers.map(b => (
          <Row
            key={b.videoId}
            label={b.videoId.slice(-8)}
            value={`${b.state}  buf:${b.bufferedMs.toFixed(0)}ms  stalls:${b.stallCount}`}
            warn={b.state === 'stalled'}
          />
        ))}
        {buffers.length === 0 && <Row label="No active streams" value="—" />}
      </Card>
    </>
  );
}

// ── Security Section ──────────────────────────────────────────────────────────

function SecuritySection() {
  const violations = SecurityManager.getRecentViolations(20);

  return (
    <>
      <Card title="Recent Violations">
        {violations.length === 0
          ? <Row label="Clean — no violations" value="✓" good />
          : violations.slice(-10).reverse().map((v, i) => (
            <Row
              key={i}
              label={`${v.action} — ${v.userId.slice(-8)}`}
              value={`${v.threatLevel}  ${new Date(v.timestamp).toLocaleTimeString()}`}
              warn={v.threatLevel === 'warn' || v.threatLevel === 'critical'}
            />
          ))
        }
      </Card>
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DebugScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const [section, setSection] = useState<Section>('stability');
  const [refresh, setRefresh] = useState(false);
  const [tick,    setTick]    = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 2_000);
    return () => clearInterval(t);
  }, []);

  const onRefresh = useCallback(() => {
    setRefresh(true);
    setTick(n => n + 1);
    setTimeout(() => setRefresh(false), 400);
  }, []);

  if (!IS_DEV) {
    return (
      <View style={[s.container, { paddingTop: insets.top + 16 }]}>
        <Text style={s.empty}>Debug panel only available in development builds.</Text>
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
        <Text style={s.title}>Debug Panel</Text>
        <View style={s.liveDot} />
      </View>

      {/* Section tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabs}
        contentContainerStyle={s.tabsInner}
      >
        {(Object.keys(SECTION_LABELS) as Section[]).map(k => (
          <Pressable
            key={k}
            onPress={() => setSection(k)}
            style={[s.tab, section === k && s.tabActive]}
          >
            <Text style={[s.tabText, section === k && s.tabTextActive]}>
              {SECTION_LABELS[k]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Content */}
      <ScrollView
        style={s.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor="#7C5CFF" />
        }
        showsVerticalScrollIndicator={false}
      >
        {section === 'stability' && <StabilitySection key={tick} />}
        {section === 'system'    && <SystemSection    key={tick} />}
        {section === 'sessions'  && <SessionsSection  key={tick} />}
        {section === 'realtime'  && <RealtimeSection  key={tick} />}
        {section === 'media'     && <MediaSection     key={tick} />}
        {section === 'security'  && <SecuritySection  key={tick} />}
      </ScrollView>
    </View>
  );
}

const C = {
  bg:      '#0A0A0F',
  surface: '#12121A',
  border:  '#1E1E2E',
  text:    '#E8E8F0',
  subtle:  'rgba(255,255,255,0.4)',
  accent:  '#7C5CFF',
  warn:    '#FF8C00',
  good:    '#00FF88',
};

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  back:        { marginRight: 12 },
  backText:    { color: C.accent, fontSize: 14, fontWeight: '600' },
  title:       { flex: 1, color: C.text, fontSize: 16, fontWeight: '700' },
  liveDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: C.good },
  tabs:        { maxHeight: 44, borderBottomWidth: 1, borderBottomColor: C.border },
  tabsInner:   { paddingHorizontal: 12, gap: 4, alignItems: 'center' },
  tab:         { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  tabActive:   { backgroundColor: C.accent + '33' },
  tabText:     { color: C.subtle, fontSize: 12, fontWeight: '500' },
  tabTextActive: { color: C.accent, fontWeight: '700' },
  content:     { flex: 1, paddingHorizontal: 12, paddingTop: 12 },
  card:        { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 10 },
  cardTitle:   { color: C.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  rowLabel:    { color: C.subtle, fontSize: 12, flex: 1 },
  rowValue:    { color: C.text, fontSize: 12, fontWeight: '600', textAlign: 'right', flex: 1 },
  warn:        { color: C.warn },
  good:        { color: C.good },
  empty:       { color: C.subtle, textAlign: 'center', marginTop: 40 },
});
