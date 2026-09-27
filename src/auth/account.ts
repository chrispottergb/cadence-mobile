import { supabase } from './supabase';

/**
 * Account deletion. The service deletes only the signed-in caller (identity
 * comes from the session, never from a parameter) and the app signs out ONLY
 * after the service confirms success.
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
    if (res.status === 409) return 'You own a gym. Transfer or close the gym before deleting your account.';
    if (res.status === 429) return 'Too many attempts. Try again later.';
    if (!res.ok) return 'Could not delete the account. Nothing was changed. Try again.';
    await supabase.auth.signOut();
    return null;
  } catch {
    return 'Could not reach the server. Nothing was changed.';
  }
}
