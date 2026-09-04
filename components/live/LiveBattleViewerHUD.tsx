import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type LiveBattleViewerHUDProps = {
  top: number;
  localName: string;
  rivalName: string;
  localScore: number;
  rivalScore: number;
  timer: string;
  status: string;
  localRoseProgress: number;
  rivalRoseProgress: number;
  roseTarget: number;
  localBoost: string | null;
  rivalBoost: string | null;
};

export function LiveBattleViewerHUD({
  top,
  localName,
  rivalName,
  localScore,
  rivalScore,
  timer,
  status,
  localRoseProgress,
  rivalRoseProgress,
  roseTarget,
  localBoost,
  rivalBoost,
}: LiveBattleViewerHUDProps) {
  const total = localScore + rivalScore;
  const localWeight = total > 0 ? localScore : 1;
  const rivalWeight = total > 0 ? rivalScore : 1;
  const dotCount = Math.max(1, Math.min(10, roseTarget));
  const completedDots = Math.min(dotCount, Math.floor((localRoseProgress / Math.max(1, roseTarget)) * dotCount));
  const roseDots = Array.from({ length: dotCount }, (_, index) => index < completedDots);

  return (
    <View pointerEvents="none" style={[styles.root, { top }]}>
      <View style={styles.scoreCard} accessible accessibilityLabel={`Marcador ${localScore} a ${rivalScore}. ${status} ${timer}`}>
        <View style={styles.scoreTopRow}>
          <View style={styles.identitySide}>
            <Text style={[styles.name, styles.localName]} numberOfLines={1} maxFontSizeMultiplier={1.2}>@{localName}</Text>
            {localBoost ? <Text style={[styles.boost, styles.localBoost]}>{localBoost}</Text> : null}
          </View>
          <View style={styles.timerPill}>
            <Text style={styles.timer} maxFontSizeMultiplier={1.15}>{timer}</Text>
            <Text style={styles.status} numberOfLines={1} maxFontSizeMultiplier={1.1}>{status}</Text>
          </View>
          <View style={[styles.identitySide, styles.rivalIdentity]}>
            <Text style={[styles.name, styles.rivalName]} numberOfLines={1} maxFontSizeMultiplier={1.2}>@{rivalName}</Text>
            {rivalBoost ? <Text style={[styles.boost, styles.rivalBoost]}>{rivalBoost}</Text> : null}
          </View>
        </View>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, styles.localScore]}>{localScore.toLocaleString()}</Text>
          <View style={styles.vs}><Text style={styles.vsText}>VS</Text></View>
          <Text style={[styles.score, styles.rivalScore]}>{rivalScore.toLocaleString()}</Text>
        </View>
        <View style={styles.advantage} accessibilityElementsHidden>
          <View style={[styles.advantageSide, styles.localAdvantage, { flexGrow: localWeight }]} />
          <View style={[styles.advantageSide, styles.rivalAdvantage, { flexGrow: rivalWeight }]} />
        </View>
      </View>
      <View
        style={styles.rosePill}
        accessible
        accessibilityLabel={`Rosas ${localRoseProgress} de ${roseTarget}. Rival ${rivalRoseProgress} de ${roseTarget}`}
      >
        <Text style={styles.roseText} maxFontSizeMultiplier={1.2}>🌹 Rosas {localRoseProgress} / {roseTarget}</Text>
        <View style={styles.roseDots} accessibilityElementsHidden>
          {roseDots.map((filled, index) => (
            <View key={index} style={[styles.roseDot, filled && styles.roseDotFilled]} />
          ))}
        </View>
        <Text style={styles.rivalRoseText} maxFontSizeMultiplier={1.15}>Rival {rivalRoseProgress}/{roseTarget}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 20, right: 20, alignItems: 'center', zIndex: 6 },
  scoreCard: {
    width: '100%',
    minHeight: 86,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(9,10,19,0.82)',
  },
  scoreTopRow: { minHeight: 24, flexDirection: 'row', alignItems: 'flex-start' },
  identitySide: { flex: 1, minWidth: 0, paddingRight: 8 },
  rivalIdentity: { alignItems: 'flex-end', paddingRight: 0, paddingLeft: 8 },
  name: { color: '#FFF', fontSize: 12, lineHeight: 15, fontWeight: '800' },
  localName: { textAlign: 'left' },
  rivalName: { textAlign: 'right' },
  boost: { marginTop: 1, fontSize: 9, lineHeight: 11, fontWeight: '900' },
  localBoost: { color: '#8ED3FF' },
  rivalBoost: { color: '#FFA0B6', textAlign: 'right' },
  timerPill: { width: 82, alignItems: 'center', justifyContent: 'center' },
  timer: { color: '#FFF', fontSize: 18, lineHeight: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  status: { marginTop: 1, color: 'rgba(255,255,255,0.58)', fontSize: 8, lineHeight: 10, fontWeight: '800', letterSpacing: 0.25 },
  scoreRow: { minHeight: 29, flexDirection: 'row', alignItems: 'center' },
  score: { flex: 1, color: '#FFF', fontSize: 25, lineHeight: 29, fontWeight: '900', fontVariant: ['tabular-nums'] },
  localScore: { color: '#70C2FF', textAlign: 'left' },
  rivalScore: { color: '#FF829E', textAlign: 'right' },
  vs: { width: 36, alignItems: 'center' },
  vsText: { color: 'rgba(255,255,255,0.7)', fontSize: 10, lineHeight: 12, fontWeight: '900' },
  advantage: { height: 7, flexDirection: 'row', overflow: 'hidden', borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)' },
  advantageSide: { flexBasis: 0, minWidth: 4 },
  localAdvantage: { backgroundColor: '#1A9CFF' },
  rivalAdvantage: { backgroundColor: '#FF406E' },
  rosePill: {
    minHeight: 34,
    maxWidth: '92%',
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(9,10,19,0.82)',
  },
  roseText: { color: '#FFF', fontSize: 11, lineHeight: 14, fontWeight: '800' },
  roseDots: { flexDirection: 'row', gap: 3 },
  roseDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  roseDotFilled: { backgroundColor: '#FF5B85' },
  rivalRoseText: { color: 'rgba(255,255,255,0.62)', fontSize: 9, lineHeight: 12, fontWeight: '700' },
});
