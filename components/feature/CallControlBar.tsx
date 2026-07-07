import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

interface CallControlBarProps {
  isMuted: boolean;
  onToggleMute: () => void;
  isCameraOff?: boolean;
  onToggleCamera?: () => void;
  speakerOn: boolean;
  onToggleSpeaker: () => void;
  onHangup: () => void;
  onSwitchCamera?: () => void;
  showCamera?: boolean;
  showSwitchCamera?: boolean;
}

export function CallControlBar({
  isMuted,
  onToggleMute,
  isCameraOff = false,
  onToggleCamera,
  speakerOn,
  onToggleSpeaker,
  onHangup,
  onSwitchCamera,
  showCamera = true,
  showSwitchCamera = true,
}: CallControlBarProps) {
  const cameraControl = showCamera && onToggleCamera ? (
    <ControlButton
      icon={isCameraOff ? 'videocam-off' : 'videocam'}
      label={isCameraOff ? 'Activar' : 'Cámara'}
      active={isCameraOff}
      onPress={onToggleCamera}
    />
  ) : null;

  const switchCameraControl = showSwitchCamera && onSwitchCamera ? (
    <ControlButton
      icon="flip-camera-ios"
      label="Voltear"
      active={false}
      onPress={onSwitchCamera}
    />
  ) : null;

  return (
    <View style={styles.row}>
      <ControlButton
        icon={isMuted ? 'mic-off' : 'mic'}
        label={isMuted ? 'Activar' : 'Silenciar'}
        active={isMuted}
        onPress={onToggleMute}
      />

      {cameraControl}

      <View style={styles.control}>
        <Pressable style={styles.hangupButton} onPress={onHangup} hitSlop={4}>
          <MaterialIcons name="call-end" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.label}>Terminar</Text>
      </View>

      <ControlButton
        icon={speakerOn ? 'volume-up' : 'volume-down'}
        label="Altavoz"
        active={speakerOn}
        onPress={onToggleSpeaker}
      />

      {switchCameraControl}
    </View>
  );
}

interface ControlButtonProps {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  active: boolean;
  onPress: () => void;
}

function ControlButton({ icon, label, active, onPress }: ControlButtonProps) {
  return (
    <View style={styles.control}>
      <Pressable
        style={[styles.button, active && styles.buttonActive]}
        onPress={onPress}
        hitSlop={8}
      >
        <MaterialIcons name={icon} size={24} color={active ? '#000' : '#fff'} />
      </Pressable>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 4,
  },
  control: {
    alignItems: 'center',
    gap: 6,
    width: 58,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: '#fff',
  },
  hangupButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF2D55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: Colors.textSubtle,
    fontSize: 11,
    textAlign: 'center',
  },
});
