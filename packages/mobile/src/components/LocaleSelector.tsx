import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { UiLocaleSnapshot } from '../api/endpoints';
import type { SupportedLocale } from '@axiom/core';
import { palette } from '../theme';

const LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  ja: '日本語',
  it: 'Italiano',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
};

interface LocaleSelectorProps {
  snapshot: UiLocaleSnapshot;
  saving: boolean;
  onSave: (locale: SupportedLocale) => void;
}

export default function LocaleSelector({ snapshot, saving, onSave }: LocaleSelectorProps) {
  return (
    <View style={styles.card} accessibilityLabel="Language settings">
      <Text style={styles.title}>Language</Text>
      <Text style={styles.hint}>Choose the interface language. Creator content keeps its own content language.</Text>
      <View style={styles.options}>
        {snapshot.supportedLocales.map((locale) => {
          const selected = snapshot.locale === locale || snapshot.userLocale === locale;
          return (
            <Pressable
              key={locale}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: saving }}
              accessibilityLabel={`Use ${LABELS[locale]}`}
              disabled={saving}
              onPress={() => onSave(locale)}
              style={[styles.option, selected && styles.optionSelected, saving && styles.optionDisabled]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{LABELS[locale]}</Text>
            </Pressable>
          );
        })}
      </View>
      {saving ? <Text style={styles.hint}>Saving language…</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.panel, borderColor: palette.line, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700' },
  hint: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderColor: palette.line, borderRadius: 10, borderWidth: 1, minWidth: '30%', paddingHorizontal: 12, paddingVertical: 10 },
  optionSelected: { backgroundColor: palette.rose, borderColor: palette.rose },
  optionDisabled: { opacity: 0.6 },
  optionText: { color: palette.text, fontSize: 13, fontWeight: '600' },
  optionTextSelected: { color: palette.roseInk },
});
