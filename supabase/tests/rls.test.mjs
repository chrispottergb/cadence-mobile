/**
 * Row-level security tests. Run against a LOCAL Supabase stack only:
 *   npx supabase start
 *   npm run test:rls
 *
 * The local stack's service key is a published development default, not a
 * secret. Nothing here ever targets a hosted project.
 *
 * Every scenario exercises a malicious or unauthorized access pattern with a
 * real user session (publishable key + user JWT), so the database, not the
 * client, is what is under test.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { test } from 'node:test';

import { createClient } from '@supabase/supabase-js';

function localEnv() {
  // A dedicated DEVELOPMENT project may be targeted instead of the local
  // stack by exporting RLS_TEST_URL / RLS_TEST_PUBLISHABLE_KEY /
  // RLS_TEST_SECRET_KEY. Never point this at a production project: it
  // creates throwaway users and rows.
  if (process.env.RLS_TEST_URL) {
    return {
      url: process.env.RLS_TEST_URL,
      anon: process.env.RLS_TEST_PUBLISHABLE_KEY,
      service: process.env.RLS_TEST_SECRET_KEY,
    };
  }
  const out = execSync('npx supabase status -o env', { encoding: 'utf8' });
  const get = (k) => {
    const m = out.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm'));
    if (!m) throw new Error(`supabase status did not report ${k}`);
    return m[1];
  };
  return {
    url: get('API_URL'),
    anon: (() => {
      try {
        return get('ANON_KEY');
      } catch {
        return get('PUBLISHABLE_KEY');
      }
    })(),
    service: (() => {
      try {
        return get('SERVICE_ROLE_KEY');
      } catch {
        return get('SECRET_KEY');
      }
    })(),
  };
}

const env = localEnv();
const admin = createClient(env.url, env.service, { auth: { persistSession: false, autoRefreshToken: false } });

let n = 0;
/** Create a confirmed user and return a client signed in as them. */
async function user(label) {
  const email = `${label}-${Date.now()}-${n++}@rls.test`;
  const password = 'Test-password-1234';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: label } });
  if (error) throw error;
  const client = createClient(env.url, env.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}


/**
 * A forbidden write is refused one of two ways: RLS filters the row out
 * (no error, zero rows) or a with-check / privilege rejects it (error).
 * Both mean nothing changed; callers re-read to prove it.
 */
function assertRefused(res, what) {
  const refused = !!res.error || (Array.isArray(res.data) && res.data.length === 0);
  assert.ok(refused, `${what} must be refused, got ${JSON.stringify(res.data)}`);
}

async function createGym(owner, name) {
  const { data, error } = await owner.client
    .from('gyms')
    .insert({ name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`, owner_profile_id: owner.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function addMember(actor, gymId, member, role) {
  return actor.client.from('gym_memberships').insert({ gym_id: gymId, profile_id: member.id, role, status: 'active' });
}

test('profile is created on signup with no date of birth column', async () => {
  const a = await user('alice');
  const { data } = await a.client.from('profiles').select('*').eq('id', a.id).single();
  assert.equal(data.display_name, 'alice');
  assert.equal('date_of_birth' in data, false);
});

test('owner can create a gym; the owner membership row appears; a stranger cannot read it', async () => {
  const owner = await user('owner');
  const stranger = await user('stranger');
  const gym = await createGym(owner, 'Iron Tiger');

  const { data: mine } = await owner.client.from('gym_memberships').select('role,status').eq('gym_id', gym.id);
  assert.deepEqual(mine, [{ role: 'owner', status: 'active' }]);

  const { data: theirs } = await stranger.client.from('gyms').select('*').eq('id', gym.id);
  assert.deepEqual(theirs, []);
  const { data: theirMembers } = await stranger.client.from('gym_memberships').select('*').eq('gym_id', gym.id);
  assert.deepEqual(theirMembers, []);
});

test('Gym A staff cannot read Gym B members, locations or gym row (cross-gym isolation)', async () => {
  const ownerA = await user('ownerA');
  const ownerB = await user('ownerB');
  const gymA = await createGym(ownerA, 'Gym A');
  const gymB = await createGym(ownerB, 'Gym B');
  await ownerB.client.from('gym_locations').insert({ gym_id: gymB.id, name: 'B Main' });

  const { data: gyms } = await ownerA.client.from('gyms').select('id');
  assert.deepEqual(gyms.map((g) => g.id), [gymA.id]);
  const { data: members } = await ownerA.client.from('gym_memberships').select('*').eq('gym_id', gymB.id);
  assert.deepEqual(members, []);
  const { data: locs } = await ownerA.client.from('gym_locations').select('*').eq('gym_id', gymB.id);
  assert.deepEqual(locs, []);
  assertRefused(await ownerA.client.from('gyms').update({ name: 'pwned' }).eq('id', gymB.id).select(), 'cross-gym rename');
  const { data: bNow } = await ownerB.client.from('gyms').select('name').eq('id', gymB.id).single();
  assert.equal(bNow.name, 'Gym B');
});

test('an instructor can belong to two gyms and a person can hold instructor and student roles', async () => {
  const ownerA = await user('ownerA');
  const ownerB = await user('ownerB');
  const ownerC = await user('ownerC');
  const coach = await user('coach');
  const gymA = await createGym(ownerA, 'A');
  const gymB = await createGym(ownerB, 'B');
  const gymC = await createGym(ownerC, 'C');
  assert.equal((await addMember(ownerA, gymA.id, coach, 'instructor')).error, null);
  assert.equal((await addMember(ownerB, gymB.id, coach, 'instructor')).error, null);
  assert.equal((await addMember(ownerC, gymC.id, coach, 'student')).error, null);

  const { data: flags } = await coach.client.rpc('resolve_experiences');
  assert.deepEqual(flags, { instructor: true, student: true, parent: false });
  const { data: gyms } = await coach.client.from('gyms').select('id');
  assert.equal(gyms.length, 3);
});

test('a client cannot elevate its own role or insert an owner row', async () => {
  const owner = await user('owner');
  const student = await user('student');
  const gym = await createGym(owner, 'Dojo');
  await addMember(owner, gym.id, student, 'student');

  assertRefused(await student.client.from('gym_memberships').update({ role: 'owner' }).eq('gym_id', gym.id).eq('profile_id', student.id).select(), 'self-promotion');
  for (const role of ['admin', 'instructor']) {
    assertRefused(await student.client.from('gym_memberships').update({ role }).eq('gym_id', gym.id).eq('profile_id', student.id).select(), `self-promotion to ${role}`);
  }
  const { data: myRow } = await owner.client.from('gym_memberships').select('role').eq('gym_id', gym.id).eq('profile_id', student.id).single();
  assert.equal(myRow.role, 'student');
  const { error: selfInsert } = await student.client.from('gym_memberships').insert({ gym_id: gym.id, profile_id: student.id, role: 'instructor', status: 'active' });
  assert.ok(selfInsert, 'self-insert of an instructor row must be refused');
  const { error: ownerInsert } = await owner.client.from('gym_memberships').insert({ gym_id: gym.id, profile_id: student.id, role: 'owner', status: 'active' });
  assert.ok(ownerInsert, 'nobody inserts owner rows through the client');

  const { data: flags } = await student.client.rpc('resolve_experiences');
  assert.deepEqual(flags, { instructor: false, student: true, parent: false });
});

test('an admin can add instructors and students but not admins', async () => {
  const owner = await user('owner');
  const admin1 = await user('admin');
  const x = await user('x');
  const gym = await createGym(owner, 'Dojo');
  await addMember(owner, gym.id, admin1, 'admin');
  assert.equal((await addMember(admin1, gym.id, x, 'instructor')).error, null);
  const y = await user('y');
  assert.ok((await addMember(admin1, gym.id, y, 'admin')).error, 'admin cannot mint admins');
});

test('an instructor who leaves loses gym access; the gym and its data remain with the owner', async () => {
  const owner = await user('owner');
  const coach = await user('coach');
  const gym = await createGym(owner, 'Dojo');
  await addMember(owner, gym.id, coach, 'instructor');
  await owner.client.from('gym_locations').insert({ gym_id: gym.id, name: 'Main mat' });

  assert.equal((await coach.client.from('gym_locations').select('*').eq('gym_id', gym.id)).data.length, 1);
  const { error: leaveErr } = await coach.client.from('gym_memberships').update({ status: 'left' }).eq('gym_id', gym.id).eq('profile_id', coach.id);
  assert.equal(leaveErr, null);
  assert.deepEqual((await coach.client.from('gym_locations').select('*').eq('gym_id', gym.id)).data, []);
  assert.deepEqual((await coach.client.from('gyms').select('*').eq('id', gym.id)).data, []);
  assert.equal((await owner.client.from('gym_locations').select('*').eq('gym_id', gym.id)).data.length, 1);
  const { data: flags } = await coach.client.rpc('resolve_experiences');
  assert.equal(flags.instructor, false);
});

test('invite by email is accepted only by the addressed identity', async () => {
  const owner = await user('owner');
  const invitee = await user('invitee');
  const impostor = await user('impostor');
  const gym = await createGym(owner, 'Dojo');
  const { data: inv, error } = await owner.client
    .from('gym_memberships')
    .insert({ gym_id: gym.id, invited_email: invitee.email, role: 'instructor', status: 'invited', invited_by: owner.id })
    .select()
    .single();
  assert.equal(error, null);
  const { error: badAccept } = await impostor.client.rpc('accept_gym_invite', { p_membership_id: inv.id });
  assert.ok(badAccept, 'impostor cannot accept');
  const { error: goodAccept } = await invitee.client.rpc('accept_gym_invite', { p_membership_id: inv.id });
  assert.equal(goodAccept, null);
  const { data: flags } = await invitee.client.rpc('resolve_experiences');
  assert.equal(flags.instructor, true);
});

test('guardian links: proposed by guardian, activated by student, invisible to others, one guardian to many students', async () => {
  const mom = await user('mom');
  const kid1 = await user('kid1');
  const kid2 = await user('kid2');
  const other = await user('other');

  for (const kid of [kid1, kid2]) {
    const { error } = await mom.client.from('guardian_links').insert({ guardian_profile_id: mom.id, student_profile_id: kid.id, status: 'pending', created_by: mom.id });
    assert.equal(error, null);
  }
  // Guardian cannot self-activate.
  assertRefused(await mom.client.from('guardian_links').update({ status: 'active' }).eq('guardian_profile_id', mom.id).select(), 'guardian self-activation');
  const { data: stillPending } = await mom.client.from('guardian_links').select('status').eq('guardian_profile_id', mom.id);
  assert.ok(stillPending.every((l) => l.status === 'pending'));
  // A third party cannot see or forge the link.
  assert.deepEqual((await other.client.from('guardian_links').select('*').eq('student_profile_id', kid1.id)).data, []);
  const { error: forge } = await other.client.from('guardian_links').insert({ guardian_profile_id: mom.id, student_profile_id: kid1.id, status: 'active' });
  assert.ok(forge);
  // Parent experience appears only after the student activates.
  assert.equal((await mom.client.rpc('resolve_experiences')).data.parent, false);
  for (const kid of [kid1, kid2]) {
    const { error } = await kid.client.from('guardian_links').update({ status: 'active' }).eq('student_profile_id', kid.id);
    assert.equal(error, null);
  }
  assert.equal((await mom.client.rpc('resolve_experiences')).data.parent, true);
  // Guardian sees both students' profiles; other sees neither.
  assert.equal((await mom.client.from('profiles').select('id').in('id', [kid1.id, kid2.id])).data.length, 2);
  assert.deepEqual((await other.client.from('profiles').select('id').in('id', [kid1.id, kid2.id])).data, []);
});

test('clients cannot fabricate entitlements, quotas, subscriptions or sponsorships; service role can; both quota subjects coexist', async () => {
  const owner = await user('owner');
  const student = await user('student');
  const gym = await createGym(owner, 'Dojo');
  await addMember(owner, gym.id, student, 'student');

  for (const [table, row] of [
    ['entitlement_grants', { subject_type: 'profile', subject_id: student.id, entitlement_key: 'student_generator', source_type: 'manual' }],
    ['generation_quotas', { subject_type: 'profile', subject_id: student.id, period_start: '2026-09-01', period_end: '2026-10-01', allowance: 999 }],
    ['subscriptions', { subject_type: 'profile', subject_id: student.id, product_key: 'student_monthly' }],
    ['gym_sponsorships', { gym_id: gym.id, student_profile_id: student.id }],
  ]) {
    const { error } = await student.client.from(table).insert(row);
    assert.ok(error, `${table}: client insert must be refused`);
  }

  // Service role provisions: a gym quota, a student quota, a sponsorship-sourced grant and an individual subscription-sourced grant.
  const { error: e1 } = await admin.from('generation_quotas').insert([
    { subject_type: 'gym', subject_id: gym.id, period_start: '2026-09-01', period_end: '2026-10-01', allowance: 200 },
    { subject_type: 'profile', subject_id: student.id, period_start: '2026-09-01', period_end: '2026-10-01', allowance: 20 },
  ]);
  assert.equal(e1, null);
  const { data: sub } = await admin.from('subscriptions').insert({ subject_type: 'profile', subject_id: student.id, product_key: 'student_monthly' }).select().single();
  const { data: spons } = await admin.from('gym_sponsorships').insert({ gym_id: gym.id, student_profile_id: student.id }).select().single();
  const { error: e2 } = await admin.from('entitlement_grants').insert([
    { subject_type: 'profile', subject_id: student.id, entitlement_key: 'student_generator', source_type: 'subscription', source_id: sub.id },
    { subject_type: 'profile', subject_id: student.id, entitlement_key: 'student_generator', source_type: 'gym_sponsorship', source_id: spons.id },
    { subject_type: 'gym', subject_id: gym.id, entitlement_key: 'class_soundtrack_builder', source_type: 'manual' },
  ]);
  assert.equal(e2, null);

  // Student reads only their own subject rows; owner reads the gym's.
  const { data: studentGrants } = await student.client.from('entitlement_grants').select('subject_type,source_type');
  assert.equal(studentGrants.filter((g) => g.subject_type === 'profile').length, 2);
  const { data: studentQuota } = await student.client.from('generation_quotas').select('subject_type,allowance');
  assert.deepEqual(studentQuota, [{ subject_type: 'profile', allowance: 20 }]);
  const { data: ownerQuota } = await owner.client.from('generation_quotas').select('subject_type,allowance');
  assert.deepEqual(ownerQuota, [{ subject_type: 'gym', allowance: 200 }]);
  // Student cannot bump their own allowance.
  assertRefused(await student.client.from('generation_quotas').update({ allowance: 9999 }).eq('subject_id', student.id).select(), 'quota bump');
  const { data: q } = await admin.from('generation_quotas').select('allowance').eq('subject_id', student.id).single();
  assert.equal(q.allowance, 20);
});

test('Gym A instructor cannot modify Gym B: no member inserts, no location writes, no gym edits', async () => {
  const ownerA = await user('ownerA');
  const ownerB = await user('ownerB');
  const coachA = await user('coachA');
  const victim = await user('victim');
  const gymA = await createGym(ownerA, 'A');
  const gymB = await createGym(ownerB, 'B');
  await addMember(ownerA, gymA.id, coachA, 'instructor');

  assert.ok((await addMember(coachA, gymB.id, victim, 'student')).error, 'cannot add members to another gym');
  assert.ok((await coachA.client.from('gym_locations').insert({ gym_id: gymB.id, name: 'x' })).error, 'cannot add locations to another gym');
  assertRefused(await coachA.client.from('gyms').update({ name: 'x' }).eq('id', gymB.id).select(), 'cross-gym rename');
  assertRefused(await coachA.client.from('gym_memberships').delete().eq('gym_id', gymB.id).select(), 'cross-gym member delete');
  assert.equal((await ownerB.client.from('gym_memberships').select('id').eq('gym_id', gymB.id)).data.length, 1);
  // Even in their own gym an instructor is not a manager.
  assert.ok((await addMember(coachA, gymA.id, victim, 'student')).error, 'instructors do not manage membership');
});

test('Student A cannot read Student B, even in the same gym', async () => {
  const owner = await user('owner');
  const a = await user('studentA');
  const b = await user('studentB');
  const gym = await createGym(owner, 'Dojo');
  await addMember(owner, gym.id, a, 'student');
  await addMember(owner, gym.id, b, 'student');
  assert.deepEqual((await a.client.from('profiles').select('id').eq('id', b.id)).data, []);
  const { data: rows } = await a.client.from('gym_memberships').select('profile_id').eq('gym_id', gym.id);
  assert.deepEqual(rows.map((r) => r.profile_id), [a.id]);
  // Staff can see both.
  assert.equal((await owner.client.from('profiles').select('id').in('id', [a.id, b.id])).data.length, 2);
});

test('Guardian A cannot read unrelated Student B', async () => {
  const guardianA = await user('guardianA');
  const kidA = await user('kidA');
  const kidB = await user('kidB');
  await guardianA.client.from('guardian_links').insert({ guardian_profile_id: guardianA.id, student_profile_id: kidA.id, status: 'pending' });
  await kidA.client.from('guardian_links').update({ status: 'active' }).eq('student_profile_id', kidA.id);
  assert.equal((await guardianA.client.from('profiles').select('id').eq('id', kidA.id)).data.length, 1);
  assert.deepEqual((await guardianA.client.from('profiles').select('id').eq('id', kidB.id)).data, []);
});

test('a membership removed by the owner no longer grants access', async () => {
  const owner = await user('owner');
  const coach = await user('coach');
  const gym = await createGym(owner, 'Dojo');
  await addMember(owner, gym.id, coach, 'instructor');
  assert.equal((await coach.client.from('gyms').select('id').eq('id', gym.id)).data.length, 1);
  const { error } = await owner.client.from('gym_memberships').delete().eq('gym_id', gym.id).eq('profile_id', coach.id);
  assert.equal(error, null);
  assert.deepEqual((await coach.client.from('gyms').select('id').eq('id', gym.id)).data, []);
  assert.equal((await coach.client.rpc('resolve_experiences')).data.instructor, false);
});

test('column guards: ownership, link targets and membership gym are immutable from the client', async () => {
  const owner = await user('owner');
  const adminU = await user('admin');
  const kid = await user('kid');
  const mom = await user('mom');
  const stranger = await user('stranger');
  const gymA = await createGym(owner, 'A');
  const gymX = await createGym(stranger, 'X');
  await addMember(owner, gymA.id, adminU, 'admin');

  // Admin may rename, but cannot transfer ownership.
  assert.equal((await adminU.client.from('gyms').update({ name: 'Renamed' }).eq('id', gymA.id)).error, null);
  assert.ok((await adminU.client.from('gyms').update({ owner_profile_id: adminU.id }).eq('id', gymA.id)).error, 'owner_profile_id is immutable');
  const { data: g } = await owner.client.from('gyms').select('owner_profile_id,name').eq('id', gymA.id).single();
  assert.deepEqual(g, { owner_profile_id: owner.id, name: 'Renamed' });

  // Student may activate a link but not repoint it at someone else.
  await mom.client.from('guardian_links').insert({ guardian_profile_id: mom.id, student_profile_id: kid.id, status: 'pending' });
  assert.ok((await kid.client.from('guardian_links').update({ guardian_profile_id: stranger.id }).eq('student_profile_id', kid.id)).error);

  // A member leaving cannot move their row to another gym.
  const coach = await user('coach');
  await addMember(owner, gymA.id, coach, 'instructor');
  assert.ok((await coach.client.from('gym_memberships').update({ gym_id: gymX.id, status: 'left' }).eq('profile_id', coach.id)).error);
});

test('an anonymous (no session) client reads nothing', async () => {
  const owner = await user('owner');
  await createGym(owner, 'Dojo');
  const anon = createClient(env.url, env.anon, { auth: { persistSession: false } });
  for (const t of ['gyms', 'profiles', 'gym_memberships', 'guardian_links', 'entitlement_grants', 'generation_quotas']) {
    const { data, error } = await anon.from(t).select('*');
    assert.ok(error || (Array.isArray(data) && data.length === 0), `${t} must be unreadable anonymously`);
  }
  assert.ok((await anon.rpc('resolve_experiences')).error);
});
