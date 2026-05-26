/**
 * app/creator-studio.tsx — Creator Studio v16
 *
 * ARCHITECTURE v16: Full infrastructure integration.
 *
 * Connected systems:
 *   - CreatorSessionManager (resource lifecycle coordination)
 *   - CreatorRecoveryManager (autosave + draft recovery)
 *   - SessionOrchestrator (conflict with calls/streams)
 *   - ResourceManager (camera + GPU exclusive lease)
 *   - GPUManager (render slot)
 *   - ProductionStabilityMode (effects degradation under stress)
 *   - CrashIntelligence (breadcrumbs)
 *   - useNavigationTelemetry
 *
 * Recovery flow:
 *   - On mount: check for unsaved draft → offer restore
 *   - Autosave every 10s via CreatorRecoveryManager
 *   - On unmount: save current state + cleanup all resources
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated';

import { getDeepARStatus, isDeepARAvailable } from '@/services/deeparService';
import { isFFmpegAvailable, RenderQueue, type RenderJob } from '@/services/ffmpegService';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

import {
  EffectsTab,
  VideosTab,
  AvatarsTab,
  MusicTab,
} from '@/components/feature/studio';

// Infrastructure
import { CreatorSessionManager }   from '@/modules/creator/sessions/CreatorSessionManager';
import { CreatorRecoveryManager }  from '@/modules/creator/sessions/CreatorRecoveryManager';
import { SessionOrchestrator }     from '@/modules/sessions/SessionOrchestrator';
import { ResourceManager }         from '@/modules/core/ResourceManager';
import { GPUManager }              from '@/modules/core/GPUManager';
import { ProductionStabilityMode } from '@/modules/core/ProductionStabilityMode';
import { CrashIntelligence }       from '@/modules/core/CrashIntelligence';
import { useNavigationTelemetry }  from '@/hooks/navigation/useNavigationTelemetry';
import { useStabilityMode }        from '@/hooks/core/useStabilityMode';

// ── Tab definitions ────────────────────────────────────────────────────────
type StudioTab = 'ar' | 'videos' | 'avatars' | 'music';

const TABS: { key: StudioTab; icon: string; label: string; color: string }[] = [
  { key: 'ar',      icon: 'magic-staff',          label: 'Efectos',  color: '#FF2D78' },
  { key: 'videos',  icon: 'video-outline',         label: 'Videos',   color: '#7C5CFF' },
  { key: 'avatars', icon: 'robot-excited-outline', label: 'Avatares', color: '#00E5A0' },
  { key: 'music',   icon: 'music-note-outline',    label: 'Música',   color: '#FF9D00' },
];

const SESSION_ID = 'creator_studio_main';

// ── Main screen ────────────────────────────────────────────────────────────
export default function CreatorStudioScreen() {
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { markReady } = useNavigationTelemetry('CreatorStudioScreen');
  const { canRenderEffects } = useStabilityMode();

  const [tab, setTab]           = useState<StudioTab>('ar');
  const [sessionReady, setSessionReady] = useState(false);
  const [renderJobs, setRenderJobs]     = useState<RenderJob[]>([]);
  const tabAnim = useSharedValue(1);
  const tabSty  = useAnimatedStyle(() => ({ opacity: tabAnim.value }));
  const gpuSlot = useRef<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Session init on mount ──────────────────────────────────────────────

  useEffect(() => {
    CrashIntelligence.addBreadcrumb('navigation', 'CreatorStudio mounted');

    // Subscribe to render queue for export progress display
    const unsubQueue = RenderQueue.subscribe(jobs => setRenderJobs(jobs));

    let mounted = true;

    const initSession = async () => {
      try {
        // 1. Acquire GPU render slot
        gpuSlot.current = await GPUManager.acquireSlot('CreatorStudio', 'high');

        // 2. Acquire camera
        ResourceManager.request('camera', 'CreatorStudio');

        // 3. Register with SessionOrchestrator
        SessionOrchestrator.registerSession('creator_capture', SESSION_ID, {
          onPause:   async () => {
            CrashIntelligence.addBreadcrumb('state', 'CreatorStudio paused');
            // Save state before pause
            await CreatorRecoveryManager.saveCheckpoint(SESSION_ID, 'paused', {
              tab,
              timestamp: Date.now(),
            });
          },
          onResume:  async () => {
            CrashIntelligence.addBreadcrumb('state', 'CreatorStudio resumed');
          },
          onEnd:     async () => {
            await cleanup();
          },
          onRecover: async () => {
            CrashIntelligence.addBreadcrumb('state', 'CreatorStudio recovering');
            return true;
          },
        });

        // 4. Start creator session
        await CreatorSessionManager.startSession(SESSION_ID);

        // 5. Check for draft recovery
        const draft = await CreatorRecoveryManager.getLatestDraft(SESSION_ID);
        if (draft && mounted) {
          Alert.alert(
            'Borrador encontrado',
            'Tienes un borrador guardado. ¿Deseas restaurarlo?',
            [
              {
                text: 'Restaurar',
                onPress: () => {
                  if (draft.metadata?.tab) setTab(draft.metadata.tab as StudioTab);
                  CrashIntelligence.addBreadcrumb('state', 'Draft restored');
                },
              },
              {
                text: 'Descartar',
                style: 'destructive',
                onPress: () => CreatorRecoveryManager.clearDraft(SESSION_ID),
              },
            ],
          );
        }

        // 6. Start autosave every 10s
        autosaveTimer.current = setInterval(async () => {
          await CreatorRecoveryManager.saveCheckpoint(SESSION_ID, 'editing', {
            tab,
            timestamp: Date.now(),
          });
        }, 10_000);

        if (mounted) {
          setSessionReady(true);
          markReady();
          CrashIntelligence.addBreadcrumb('state', 'CreatorStudio session ready');
        }

      } catch (e: any) {
        CrashIntelligence.addBreadcrumb('error', `CreatorStudio init error: ${e?.message}`);
        console.error('[CreatorStudio] init error:', e?.message);
        if (mounted) {
          setSessionReady(true); // Still show UI even if session init partially fails
          markReady();
        }
      }
    };

    initSession();

    return () => {
      mounted = false;
      unsubQueue();
      cleanup();
    };
  }, []);

  const cleanup = useCallback(async () => {
    // Stop autosave
    if (autosaveTimer.current) {
      clearInterval(autosaveTimer.current);
      autosaveTimer.current = null;
    }

    // Save final state
    try {
      await CreatorRecoveryManager.saveCheckpoint(SESSION_ID, 'editing', {
        tab,
        timestamp: Date.now(),
      });
    } catch { /* non-critical */ }

    // End creator session
    try {
      await CreatorSessionManager.endSession(SESSION_ID);
    } catch { /* non-critical */ }

    // Release resources
    try {
      await SessionOrchestrator.endSession(SESSION_ID);
    } catch { /* non-critical */ }

    ResourceManager.release('camera', 'CreatorStudio');

    if (gpuSlot.current) {
      GPUManager.releaseSlot(gpuSlot.current);
      gpuSlot.current = null;
    }

    CrashIntelligence.addBreadcrumb('lifecycle', 'CreatorStudio cleanup complete');
  }, [tab]);

  // ── Tab switch ─────────────────────────────────────────────────────────

  const switchTab = useCallback((t: StudioTab) => {
    tabAnim.value = withTiming(0, { duration: 100 }, () => {
      tabAnim.value = withTiming(1, { duration: 180 });
    });
    setTab(t);
    CrashIntelligence.addBreadcrumb('user_action', `Studio tab: ${t}`);
  }, []);

  // ── Back with unsaved work warning ─────────────────────────────────────

  const handleBack = useCallback(() => {
    Alert.alert(
      'Salir del Studio',
      'Tu progreso se guardará automáticamente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          onPress: () => router.back(),
        },
      ],
    );
  }, [router]);

  const deepARStatus    = getDeepARStatus();
  const deepARActive    = isDeepARAvailable();
  const activeRenderJob = renderJobs.find(j => j.status === 'running');

  return (
    <View style={[root.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={root.header}>
        <Pressable style={root.backBtn} onPress={handleBack} hitSlop={10}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={root.titleRow}>
          <Text style={root.title}>Creator Studio</Text>
          {deepARActive ? (
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={root.deepARBadge}>
              <Text style={root.deepARBadgeText}>DeepAR</Text>
            </LinearGradient>
          ) : null}
          <View style={[root.badge, { backgroundColor: '#00E5A022', borderColor: '#00E5A044' }]}>
            <Text style={[root.badgeText, { color: '#00E5A0' }]}>Skia</Text>
          </View>
          {isFFmpegAvailable() ? (
            <View style={root.badge}><Text style={root.badgeText}>FFmpeg</Text></View>
          ) : null}
          {/* Session ready indicator */}
          <View style={[root.badge, sessionReady
            ? { backgroundColor: '#00D4AA22', borderColor: '#00D4AA44' }
            : { backgroundColor: Colors.warningDim, borderColor: Colors.warning + '44' }
          ]}>
            <Text style={[root.badgeText, { color: sessionReady ? '#00D4AA' : Colors.warning }]}>
              {sessionReady ? 'Activo' : 'Iniciando'}
            </Text>
          </View>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* ── Status banner ───────────────────────────────────────────────── */}
      {!deepARStatus.ready ? (
        <View style={root.statusBar}>
          <MaterialCommunityIcons name="information-outline" size={12} color={Colors.warning} />
          <Text style={root.statusBarText}>Skia activo. DeepAR disponible en EAS Build.</Text>
          <Pressable onPress={() => router.push('/deepar-test' as any)}>
            <Text style={[root.statusBarText, { color: '#2D9EFF', textDecorationLine: 'underline' }]}>Test</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[root.statusBar, { backgroundColor: '#00E5A022', borderBottomColor: '#00E5A033' }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={12} color="#00E5A0" />
          <Text style={[root.statusBarText, { color: '#00E5A0' }]}>
            {`DeepAR listo. ${!deepARStatus.hasFetchBlob ? 'Instala rn-fetch-blob para filtros remotos.' : 'Filtros remotos activos.'}`}
          </Text>
          <Pressable onPress={() => router.push('/deepar-test' as any)}>
            <Text style={[root.statusBarText, { color: '#2D9EFF', textDecorationLine: 'underline' }]}>Sandbox</Text>
          </Pressable>
        </View>
      )}

      {/* Active render job progress banner */}
      {activeRenderJob ? (
        <View style={[root.statusBar, { backgroundColor: '#7C5CFF15', borderBottomColor: '#7C5CFF33' }]}>
          <MaterialCommunityIcons name="video-outline" size={12} color="#7C5CFF" />
          <Text style={[root.statusBarText, { color: '#7C5CFF' }]}>
            Exportando: {activeRenderJob.currentStep} ({activeRenderJob.progressPct}%)
          </Text>
          <Pressable onPress={() => RenderQueue.cancel(activeRenderJob.id)}>
            <Text style={[root.statusBarText, { color: Colors.secondary, textDecorationLine: 'underline' }]}>Cancelar</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Stability degradation warning */}
      {!canRenderEffects ? (
        <View style={[root.statusBar, { backgroundColor: '#FF8C0015', borderBottomColor: '#FF8C0033' }]}>
          <MaterialCommunityIcons name="thermometer-alert" size={12} color="#FF8C00" />
          <Text style={[root.statusBarText, { color: '#FF8C00' }]}>
            Efectos reducidos por temperatura. Pausa para enfriar.
          </Text>
        </View>
      ) : null}

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <Animated.View style={[{ flex: 1 }, tabSty]}>
        {tab === 'ar'      ? <EffectsTab />  : null}
        {tab === 'videos'  ? <VideosTab />   : null}
        {tab === 'avatars' ? <AvatarsTab />  : null}
        {tab === 'music'   ? <MusicTab />    : null}
      </Animated.View>

      {/* ── Bottom tab bar ──────────────────────────────────────────────── */}
      <View style={[root.tabBar, { paddingBottom: insets.bottom + 4 }]}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} style={root.tabItem} onPress={() => switchTab(t.key)}>
              {active ? (
                <LinearGradient colors={[t.color + '33', t.color + '11']} style={root.tabActiveGrad} />
              ) : null}
              <MaterialCommunityIcons
                name={t.icon as any}
                size={22}
                color={active ? t.color : Colors.textSubtle}
              />
              <Text style={[root.tabLabel, active && { color: t.color, fontWeight: FontWeight.bold }]}>
                {t.label}
              </Text>
              {active ? <View style={[root.tabDot, { backgroundColor: t.color }]} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const root = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.bg },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:         { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  titleRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1, justifyContent: 'center' },
  title:           { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  deepARBadge:     { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  deepARBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },
  badge:           { backgroundColor: '#7C5CFF22', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#7C5CFF44' },
  badgeText:       { color: '#7C5CFF', fontSize: 9, fontWeight: FontWeight.bold },
  statusBar:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.warningDim, borderBottomWidth: 1, borderBottomColor: Colors.warning + '33' },
  statusBarText:   { color: Colors.warning, fontSize: 10, flex: 1 },
  tabBar:          { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  tabItem:         { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3, position: 'relative', overflow: 'hidden' },
  tabActiveGrad:   { ...StyleSheet.absoluteFillObject },
  tabLabel:        { color: Colors.textSubtle, fontSize: 9, fontWeight: FontWeight.medium },
  tabDot:          { position: 'absolute', top: 0, left: '20%', right: '20%', height: 2, borderRadius: 1 },
});
