import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * Sign in with Apple, wired to Supabase's native ID-token flow. Apple returns
 * an identity token; Supabase verifies it against Apple's keys and issues its
 * own session. The Supabase project must have the Apple provider enabled with
 * the app's bundle identifier before this succeeds (dashboard step).
 */
export const appleSignInAvailable = async (): Promise<boolean> =>
  Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync());

export async function signInWithApple(): Promise<string | null> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return 'Apple did not return an identity token.';
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    return error ? error.message : null;
  } catch (e) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    return e instanceof Error ? e.message : 'Apple sign-in failed.';
  }
}
