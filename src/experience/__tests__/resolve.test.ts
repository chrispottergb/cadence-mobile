import { availableExperiences, pickExperience, resolveExperiences } from '../resolve';

const me = 'me';

describe('resolveExperiences', () => {
  it('grants nothing to a user with no memberships or links', () => {
    expect(resolveExperiences(me, [], [])).toEqual({ instructor: false, student: false, parent: false });
  });

  it('owner, admin and instructor roles all open the instructor experience', () => {
    for (const role of ['owner', 'admin', 'instructor'] as const) {
      expect(resolveExperiences(me, [{ gym_id: 'g', role, status: 'active' }], []).instructor).toBe(true);
    }
  });

  it('a student role opens only the student experience', () => {
    expect(resolveExperiences(me, [{ gym_id: 'g', role: 'student', status: 'active' }], [])).toEqual({
      instructor: false,
      student: true,
      parent: false,
    });
  });

  it('ignores invited, suspended and left memberships', () => {
    for (const status of ['invited', 'suspended', 'left'] as const) {
      expect(resolveExperiences(me, [{ gym_id: 'g', role: 'instructor', status }], []).instructor).toBe(false);
    }
  });

  it('a multi-role person gets every experience they hold', () => {
    const flags = resolveExperiences(
      me,
      [
        { gym_id: 'a', role: 'instructor', status: 'active' },
        { gym_id: 'b', role: 'instructor', status: 'active' },
        { gym_id: 'c', role: 'student', status: 'active' },
      ],
      [{ guardian_profile_id: me, student_profile_id: 'kid', status: 'active' }],
    );
    expect(flags).toEqual({ instructor: true, student: true, parent: true });
    expect(availableExperiences(flags)).toEqual(['instructor', 'student', 'parent']);
  });

  it('parent requires an ACTIVE link where I am the guardian, not the student', () => {
    expect(resolveExperiences(me, [], [{ guardian_profile_id: me, student_profile_id: 'kid', status: 'pending' }]).parent).toBe(false);
    expect(resolveExperiences(me, [], [{ guardian_profile_id: 'mom', student_profile_id: me, status: 'active' }]).parent).toBe(false);
  });
});

describe('pickExperience', () => {
  const all = { instructor: true, student: true, parent: true };

  it('honors a persisted choice that is still allowed', () => {
    expect(pickExperience(all, 'parent')).toBe('parent');
  });

  it('falls back to the first allowed experience when the persisted one is gone', () => {
    expect(pickExperience({ instructor: false, student: true, parent: true }, 'instructor')).toBe('student');
  });

  it('returns null when nothing is allowed, so the app routes to onboarding', () => {
    expect(pickExperience({ instructor: false, student: false, parent: false }, 'student')).toBeNull();
  });
});
