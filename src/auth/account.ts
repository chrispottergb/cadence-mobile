import { supabase } from './supabase';

/**
 * Account deletion foundation. Deleting an auth user requires elevated
 * credentials, which never live in the app, so the app calls a server
 * endpoint. Phase 1 wires the client side and the contract; the endpoint is
 * added to the Music Service alongside the Postgres-backed job store.
 */
export const ACCOUNT_DELETE_PATH = '/v1/account';

export async function requestAccountDeletion(serviceUrl: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return 'Not signed in.';
  try {
    const res = await fetch(`${serviceUrl}${ACCOUNT_DELETE_PATH}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 404 || res.status === 501) return 'Account deletion is not available yet.';
    if (!res.ok) return 'Could not delete the account. Try again.';
    await supabase.auth.signOut();
    return null;
  } catch {
    return 'Could not reach the server.';
  }
}
