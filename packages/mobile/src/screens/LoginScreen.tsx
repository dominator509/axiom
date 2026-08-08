import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { signIn, type SessionUser } from '../api/auth';
import { palette, surfaceShadow } from '../theme';

interface LoginScreenProps {
  onAuthed: (user: SessionUser) => void;
}

export default function LoginScreen({ onAuthed }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email.trim(), password);
      onAuthed(result.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View pointerEvents="none" style={styles.orbOne} />
      <View pointerEvents="none" style={styles.orbTwo} />
      <View style={styles.intro}>
        <View style={styles.brandMark}>
          <Text style={styles.brandLetter}>A</Text>
        </View>
        <Text style={styles.logo}>AXIOM</Text>
        <Text style={styles.kicker}>YOUR PRIVATE CREATOR OS</Text>
        <Text style={styles.promise}>Run your world.{`\n`}Beautifully.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.welcome}>Welcome back</Text>
        <Text style={styles.subtitle}>Enter your studio to continue.</Text>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@studio.com"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Email"
        />

        <Text style={styles.label}>PASSWORD</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={palette.faint}
          secureTextEntry
          textContentType="password"
          accessibilityLabel="Password"
          onSubmitEditing={() => {
            if (canSubmit) void handleSubmit();
          }}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            !canSubmit && styles.buttonDisabled,
            pressed && canSubmit && styles.buttonPressed,
          ]}
          onPress={() => void handleSubmit()}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          {busy ? (
            <ActivityIndicator color={palette.roseInk} />
          ) : (
            <Text style={styles.buttonText}>Enter studio</Text>
          )}
        </Pressable>
        <View style={styles.securityLine}>
          <View style={styles.liveDot} />
          <Text style={styles.securityText}>ENCRYPTED · TENANT ISOLATED</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
    overflow: 'hidden',
  },
  orbOne: {
    position: 'absolute',
    width: 330,
    height: 330,
    borderRadius: 180,
    top: -170,
    right: -130,
    backgroundColor: '#2A1825',
    opacity: 0.7,
  },
  orbTwo: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 140,
    bottom: -160,
    left: -110,
    backgroundColor: '#211A31',
    opacity: 0.65,
  },
  intro: { alignItems: 'center', marginBottom: 28 },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.rose,
    marginBottom: 13,
    ...surfaceShadow,
  },
  brandLetter: { color: palette.roseInk, fontSize: 25, fontWeight: '800' },
  logo: { color: palette.text, fontSize: 22, fontWeight: '800', letterSpacing: 4 },
  kicker: {
    color: palette.roseBright,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.7,
    marginTop: 6,
  },
  promise: {
    color: palette.text,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '300',
    textAlign: 'center',
    marginTop: 17,
  },
  card: {
    width: '100%',
    maxWidth: 410,
    backgroundColor: palette.panel,
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: palette.line,
    ...surfaceShadow,
  },
  welcome: { color: palette.text, fontSize: 24, fontWeight: '700' },
  subtitle: { color: palette.muted, fontSize: 13, marginTop: 4, marginBottom: 18 },
  label: {
    color: palette.textSoft,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 7,
    marginTop: 13,
  },
  input: {
    backgroundColor: palette.canvas,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.text,
    fontSize: 14,
  },
  error: { color: palette.danger, fontSize: 12, marginTop: 12 },
  button: {
    marginTop: 22,
    minHeight: 48,
    backgroundColor: palette.rose,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  buttonText: { color: palette.roseInk, fontSize: 14, fontWeight: '800' },
  securityLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 18,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.success },
  securityText: { color: palette.faint, fontSize: 8, fontWeight: '700', letterSpacing: 1 },
});
