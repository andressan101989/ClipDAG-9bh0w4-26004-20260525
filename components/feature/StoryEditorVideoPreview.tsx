import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

// Web video editing stays intentionally outside Stories V2 I.
export function StoryEditorVideoPreview({ uri: _uri }: { uri: string }) {
  return (
    <View style={styles.preview}>
      <MaterialIcons name="videocam" size={64} color="#fff" />
      <Text style={styles.label}>Video listo para publicar</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  label: { color: '#fff', opacity: 0.75 },
});
