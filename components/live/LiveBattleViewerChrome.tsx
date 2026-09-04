import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

type BattleViewerHeaderProps = {
  hostName: string;
  avatarUrl: string | null;
  viewerCount: number;
  onClose: () => void;
};

export function BattleViewerHeader({ hostName, avatarUrl, viewerCount, onClose }: BattleViewerHeaderProps) {
  return (
    <View style={styles.header} accessible accessibilityLabel={`LIVE de ${hostName}, ${viewerCount} espectadores`}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{hostName.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.hostName} numberOfLines={1} maxFontSizeMultiplier={1.2}>{hostName}</Text>
      <View style={styles.viewerPill} accessibilityLabel={`${viewerCount} espectadores`}>
        <MaterialIcons name="visibility" size={13} color="#FFF" />
        <Text style={styles.viewerText}>{viewerCount.toLocaleString()}</Text>
      </View>
      <View style={styles.livePill} accessibilityLabel="LIVE">
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>LIVE</Text>
      </View>
      <Pressable
        style={styles.closeTarget}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Salir del LIVE"
        accessibilityHint="Regresa a la pantalla anterior"
      >
        <MaterialIcons name="close" size={21} color="#FFF" />
      </Pressable>
    </View>
  );
}

type ViewerActionRailProps = {
  onReact: () => void;
  onShare: () => void;
  onMore: () => void;
};

function RailAction({ icon, label, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.railButton, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialIcons name={icon} size={23} color="#FFF" />
      <Text style={styles.railLabel} maxFontSizeMultiplier={1.15}>{label}</Text>
    </Pressable>
  );
}

export function ViewerActionRail({ onReact, onShare, onMore }: ViewerActionRailProps) {
  return (
    <View style={styles.rail}>
      <RailAction icon="favorite" label="Reaccionar" onPress={onReact} />
      <RailAction icon="ios-share" label="Compartir" onPress={onShare} />
      <RailAction icon="more-horiz" label="Más opciones" onPress={onMore} />
    </View>
  );
}

type ViewerBottomBarProps = {
  value: string;
  sending: boolean;
  editable: boolean;
  giftsDisabled: boolean;
  inputRef: React.RefObject<TextInput | null>;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onOpenGifts: () => void;
};

export function ViewerBottomBar({
  value,
  sending,
  editable,
  giftsDisabled,
  inputRef,
  onChangeText,
  onSubmit,
  onOpenGifts,
}: ViewerBottomBarProps) {
  const sendDisabled = !value.trim() || sending || !editable;
  return (
    <View style={styles.bottomBar}>
      <View style={styles.composer}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder="Escribe un comentario"
          placeholderTextColor="rgba(255,255,255,0.56)"
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          maxLength={200}
          blurOnSubmit={false}
          editable={editable}
          accessibilityLabel="Escribe un comentario"
        />
        <Pressable
          style={[styles.sendButton, sendDisabled && styles.disabled]}
          onPress={onSubmit}
          disabled={sendDisabled}
          accessibilityRole="button"
          accessibilityLabel="Enviar comentario"
        >
          {sending ? <ActivityIndicator size="small" color="#FFF" /> : <MaterialIcons name="send" size={18} color="#FFF" />}
        </Pressable>
      </View>
      <Pressable
        style={({ pressed }) => [styles.giftButton, pressed && !giftsDisabled && styles.pressed, giftsDisabled && styles.disabled]}
        onPress={onOpenGifts}
        disabled={giftsDisabled}
        accessibilityRole="button"
        accessibilityLabel="Regalos"
        accessibilityHint="Abre el selector de regalos"
        accessibilityState={{ disabled: giftsDisabled }}
      >
        <MaterialIcons name="card-giftcard" size={20} color="#FFF" />
        <Text style={styles.giftText} maxFontSizeMultiplier={1.2}>Regalos</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 7,
    paddingRight: 4,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(6,8,14,0.64)',
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#7D3BED' },
  avatarInitial: { color: '#FFF', fontSize: 14, lineHeight: 17, fontWeight: '900' },
  hostName: { flex: 1, minWidth: 42, color: '#FFF', fontSize: 13, lineHeight: 16, fontWeight: '800' },
  viewerPill: { height: 30, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.1)' },
  viewerText: { color: '#FFF', fontSize: 11, lineHeight: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  livePill: { height: 30, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, borderRadius: 15, backgroundColor: '#EC1433' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' },
  liveText: { color: '#FFF', fontSize: 10, lineHeight: 13, fontWeight: '900' },
  closeTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  rail: { position: 'absolute', right: 12, bottom: 110, gap: 8, zIndex: 10 },
  railButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(9,10,18,0.74)' },
  railLabel: { position: 'absolute', width: 66, top: 49, right: -9, color: '#FFF', fontSize: 8, lineHeight: 10, fontWeight: '700', textAlign: 'center' },
  bottomBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8 },
  composer: { flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', borderRadius: 23, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(9,10,18,0.82)' },
  input: { flex: 1, height: 46, paddingLeft: 16, paddingRight: 4, color: '#FFF', fontSize: 13 },
  sendButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  giftButton: { minWidth: 116, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 15, borderRadius: 24, backgroundColor: '#7D3BED' },
  giftText: { color: '#FFF', fontSize: 14, lineHeight: 18, fontWeight: '900' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  disabled: { opacity: 0.45 },
});
