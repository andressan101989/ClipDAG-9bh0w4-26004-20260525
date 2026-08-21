import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Colors, Radius, Spacing } from "@/constants/theme";

export interface SelectOption {
  value: string;
  label: string;
}

export function SearchableSelectField({
  label,
  value,
  options,
  onChange,
  searchLabel = "Buscar",
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  searchLabel?: string;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const selected = options.find((item) => item.value === value);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    return query
      ? options.filter((item) =>
          item.label.toLocaleLowerCase("es").includes(query),
        )
      : options;
  }, [options, search]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? "Seleccionar"}`}
        accessibilityState={{ expanded: open }}
        style={styles.field}
        onPress={() => setOpen(true)}
      >
        <View style={styles.selectedContent}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} numberOfLines={2}>
            {selected?.label ?? "Seleccionar"}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>{label}</Text>
            <Pressable onPress={() => setOpen(false)}>
              <Text style={styles.close}>Cerrar</Text>
            </Pressable>
          </View>
          <TextInput
            autoFocus={false}
            value={search}
            onChangeText={setSearch}
            placeholder={searchLabel}
            placeholderTextColor={Colors.textSecondary}
            style={styles.search}
          />
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={filtered}
            keyExtractor={(item) => item.value || "all"}
            renderItem={({ item }) => (
              <Pressable
                style={styles.option}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: item.value === value }}
                onPress={() => {
                  onChange(item.value);
                  setSearch("");
                  setOpen(false);
                }}
              >
                <Text style={styles.optionText}>{item.label}</Text>
                {item.value === value ? (
                  <Text style={styles.check}>✓</Text>
                ) : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  field: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  value: { color: Colors.textPrimary, fontSize: 16, fontWeight: "600" },
  selectedContent: { flex: 1, paddingRight: Spacing.sm },
  chevron: { color: Colors.textSecondary, fontSize: 30 },
  modal: { flex: 1, backgroundColor: Colors.bg, padding: Spacing.md },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: "800" },
  close: { color: Colors.primaryLight, fontWeight: "700" },
  search: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  option: {
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionText: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 4,
  },
  check: { color: Colors.primaryLight, fontSize: 18, fontWeight: "800" },
});
