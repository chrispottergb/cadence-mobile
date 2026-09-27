import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { verifyEmailCode } from '@/auth/session';
import { Button, Field, Screen, space, Text } from '@/ui';

export default function Verify() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email) return;
    setBusy(true);
    setError(null);
    const err = await verifyEmailCode(email, code);
    setBusy(false);
    if (err) setError(err);
    // On success the root layout sees the session and routes onward.
  };

  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Text variant="display">Enter your code</Text>
      <Text muted style={{ marginTop: space.sm, marginBottom: space.lg }}>
        Sent to {email}
      </Text>
      <Field
        testID="code"
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={8}
        onSubmitEditing={submit}
      />
      {error ? (
        <Text variant="caption" style={{ color: '#E5484D', marginTop: space.sm }}>
          {error}
        </Text>
      ) : null}
      <View style={{ height: space.md }} />
      <Button testID="verify" title="Continue" onPress={submit} loading={busy} disabled={code.replace(/\D/g, '').length < 6} />
      <View style={{ height: space.sm }} />
      <Button title="Use a different email" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
