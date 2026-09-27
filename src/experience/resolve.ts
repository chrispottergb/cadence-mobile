/**
 * Which experiences a signed-in person may enter. The inputs come from the
 * database (the caller's own memberships and guardian links, or the
 * resolve_experiences RPC); nothing here is trusted from user input.
 */
export type Experience = 'instructor' | 'student' | 'parent';

export const EXPERIENCE_ORDER: readonly Experience[] = ['instructor', 'student', 'parent'];

export type GymRole = 'owner' | 'admin' | 'instructor' | 'student';

export interface MembershipRow {
  gym_id: string;
  role: GymRole;
  status: 'invited' | 'active' | 'suspended' | 'left';
}

export interface GuardianLinkRow {
  guardian_profile_id: string;
  student_profile_id: string;
  status: 'pending' | 'active' | 'revoked';
}

export interface ExperienceFlags {
  instructor: boolean;
  student: boolean;
  parent: boolean;
}

export function resolveExperiences(userId: string, memberships: MembershipRow[], links: GuardianLinkRow[]): ExperienceFlags {
  const active = memberships.filter((m) => m.status === 'active');
  return {
    instructor: active.some((m) => m.role === 'owner' || m.role === 'admin' || m.role === 'instructor'),
    student: active.some((m) => m.role === 'student'),
    parent: links.some((l) => l.status === 'active' && l.guardian_profile_id === userId),
  };
}

export function availableExperiences(flags: ExperienceFlags): Experience[] {
  return EXPERIENCE_ORDER.filter((e) => flags[e]);
}

/**
 * Choose the experience to show: the persisted choice if it is still
 * allowed, else the first allowed one, else null (onboarding).
 */
export function pickExperience(flags: ExperienceFlags, persisted: Experience | null): Experience | null {
  const available = availableExperiences(flags);
  if (persisted && available.includes(persisted)) return persisted;
  return available[0] ?? null;
}
