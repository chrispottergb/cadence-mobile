import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { appleSignInAvailable, signInWithApple } from '@/auth/apple';
import { sendEmailCode } from '@/auth/session';
import { Button, Field, Screen, space, Text } from '@/ui';

/** Apple sign-in stays hidden until the Supabase Apple provider is configured. */
const APPLE_ENABLED = process.env.EXPO_PUBLIC_APPLE_SIGNIN === '1';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apple, setApple] = useState(false);

  useEffect(() => {
    if (APPLE_ENABLED) void appleSignInAvailable().then(setApple);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await sendEmailCode(email);
    setBusy(false);
    if (err) setError(err);
    else router.push({ pathname: '/(auth)/verify', params: { email: email.trim().toLowerCase() } });
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center' }}>
        <Text variant="label" muted>
          Cadence
        </Text>
        <Text variant="display" style={{ marginTop: space.sm }}>
          Sign in
        </Text>
        <Text muted style={{ marginTop: space.sm, marginBottom: space.lg }}>
          We will email you a one-time code.
        </Text>
        <Field
          testID="email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? (
          <Text variant="caption" style={{ color: '#E5484D', marginTop: space.sm }}>
            {error}
          </Text>
        ) : null}
        <View style={{ height: space.md }} />
        <Button testID="send-code" title="Send code" onPress={submit} loading={busy} disabled={!email.includes('@')} />
        {apple ? (
          <>
            <View style={{ height: space.sm }} />
            <Button
              title="Continue with Apple"
              variant="secondary"
              onPress={() => {
                void signInWithApple().then((e) => e && setError(e));
              }}
            />
          </>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
