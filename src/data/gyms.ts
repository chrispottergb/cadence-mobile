import { supabase } from '@/auth/supabase';
import type { GymRole } from '@/experience/resolve';

/**
 * Typed data access for the gym foundation. Every call runs under the user's
 * own session, so row-level security decides what is visible or writable.
 */
export interface Gym {
  id: string;
  name: string;
  slug: string;
  owner_profile_id: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export async function createGym(name: string, ownerProfileId: string): Promise<{ gym: Gym | null; error: string | null }> {
  const base = slugify(name) || 'gym';
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase
    .from('gyms')
    .insert({ name: name.trim(), slug, owner_profile_id: ownerProfileId })
    .select('id, name, slug, owner_profile_id')
    .single();
  return { gym: (data as Gym | null) ?? null, error: error?.message ?? null };
}

export async function listMyGyms(): Promise<{ gyms: Gym[]; error: string | null }> {
  const { data, error } = await supabase.from('gyms').select('id, name, slug, owner_profile_id').order('name');
  return { gyms: (data as Gym[] | null) ?? [], error: error?.message ?? null };
}

export async function inviteMember(gymId: string, email: string, role: Exclude<GymRole, 'owner'>, invitedBy: string): Promise<string | null> {
  const { error } = await supabase.from('gym_memberships').insert({
    gym_id: gymId,
    invited_email: email.trim().toLowerCase(),
    role,
    status: 'invited',
    invited_by: invitedBy,
  });
  return error?.message ?? null;
}

export async function listMyInvites(): Promise<{ invites: { id: string; gym_id: string; role: GymRole }[]; error: string | null }> {
  const { data, error } = await supabase.from('gym_memberships').select('id, gym_id, role').eq('status', 'invited');
  return { invites: (data as { id: string; gym_id: string; role: GymRole }[] | null) ?? [], error: error?.message ?? null };
}

export async function acceptInvite(membershipId: string): Promise<string | null> {
  const { error } = await supabase.rpc('accept_gym_invite', { p_membership_id: membershipId });
  return error?.message ?? null;
}

export async function proposeGuardianLink(guardianProfileId: string, studentProfileId: string): Promise<string | null> {
  const { error } = await supabase.from('guardian_links').insert({
    guardian_profile_id: guardianProfileId,
    student_profile_id: studentProfileId,
    status: 'pending',
    created_by: guardianProfileId,
  });
  return error?.message ?? null;
}

export async function respondToGuardianLink(linkId: string, status: 'active' | 'revoked'): Promise<string | null> {
  const { error } = await supabase.from('guardian_links').update({ status }).eq('id', linkId);
  return error?.message ?? null;
}
