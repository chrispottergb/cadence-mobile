import { slugify } from '../gyms';

jest.mock('@/auth/supabase', () => ({ supabase: {} }));

describe('slugify', () => {
  it('produces url-safe lowercase slugs', () => {
    expect(slugify('Iron Tiger Kickboxing')).toBe('iron-tiger-kickboxing');
    expect(slugify('  Dojo #1!! ')).toBe('dojo-1');
    expect(slugify('Ünïcode Gym')).toBe('unicode-gym');
  });
});
