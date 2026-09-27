-- Cadence Phase 1 foundation.
--
-- Identity, gyms, contextual roles, guardian links, and the entitlement /
-- quota foundation. No billing, no generation tables yet.
--
-- Design rules enforced here:
--   * A role is a row in gym_memberships, never a claim on the auth identity.
--   * A gym is its own entity; ownership is a role plus gyms.owner_profile_id.
--   * Guardians are linked to students through guardian_links, not gym roles.
--   * subscriptions / entitlement_grants / gym_sponsorships / generation_quotas
--     are read-only to clients. Only the service role writes them.
--   * Quotas and grants have a subject (profile OR gym), so gym class music
--     and student personal music draw from separate allowances.
--
-- Reversible: see 20260927000100_phase1_foundation_down.sql

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.gym_role as enum ('owner', 'admin', 'instructor', 'student');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'left');
create type public.link_status as enum ('pending', 'active', 'revoked');
create type public.subject_type as enum ('profile', 'gym');
create type public.grant_source as enum ('subscription', 'gym_sponsorship', 'trial', 'manual');

-- ---------------------------------------------------------------------------
-- profiles: one per auth user. Minimal PII: display name only.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- gyms and locations
-- ---------------------------------------------------------------------------
create table public.gyms (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 120),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  owner_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger gyms_touch before update on public.gyms
  for each row execute function public.touch_updated_at();

create table public.gym_locations (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  timezone   text not null default 'UTC',
  created_at timestamptz not null default now()
);
create index gym_locations_gym_idx on public.gym_locations (gym_id);

-- ---------------------------------------------------------------------------
-- gym_memberships: contextual roles. One person, many gyms, many roles.
-- An invite is a row with status 'invited'; profile_id is set when known,
-- otherwise invited_email holds the target until acceptance.
-- ---------------------------------------------------------------------------
create table public.gym_memberships (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms (id) on delete cascade,
  profile_id    uuid references public.profiles (id) on delete cascade,
  invited_email text,
  role          public.gym_role not null,
  status        public.membership_status not null default 'active',
  invited_by    uuid references public.profiles (id) on delete set null,
  joined_at     timestamptz,
  left_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (profile_id is not null or invited_email is not null)
);
create unique index gym_memberships_unique_role
  on public.gym_memberships (gym_id, profile_id, role) where profile_id is not null;
create index gym_memberships_profile_idx on public.gym_memberships (profile_id);
create index gym_memberships_gym_idx on public.gym_memberships (gym_id);
create index gym_memberships_invited_email_idx on public.gym_memberships (lower(invited_email));

create trigger gym_memberships_touch before update on public.gym_memberships
  for each row execute function public.touch_updated_at();

-- Creating a gym makes its creator the owner member.
create or replace function public.handle_new_gym()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.gym_memberships (gym_id, profile_id, role, status, joined_at)
  values (new.id, new.owner_profile_id, 'owner', 'active', now());
  return new;
end;
$$;

create trigger on_gym_created
  after insert on public.gyms
  for each row execute function public.handle_new_gym();

-- ---------------------------------------------------------------------------
-- guardian_links: guardian -> student. Not a gym role. No DOB collected.
-- ---------------------------------------------------------------------------
create table public.guardian_links (
  id                  uuid primary key default gen_random_uuid(),
  guardian_profile_id uuid not null references public.profiles (id) on delete cascade,
  student_profile_id  uuid not null references public.profiles (id) on delete cascade,
  status              public.link_status not null default 'pending',
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (guardian_profile_id, student_profile_id),
  check (guardian_profile_id <> student_profile_id)
);
create index guardian_links_student_idx on public.guardian_links (student_profile_id);

create trigger guardian_links_touch before update on public.guardian_links
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Commercial foundation. Client read-only; service role writes.
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  subject_type       public.subject_type not null,
  subject_id         uuid not null,
  provider           text not null default 'manual',
  provider_ref       text,
  product_key        text not null,
  status             text not null default 'active',
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index subscriptions_subject_idx on public.subscriptions (subject_type, subject_id);

create table public.gym_sponsorships (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms (id) on delete cascade,
  student_profile_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id    uuid references public.subscriptions (id) on delete set null,
  status             text not null default 'active',
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index gym_sponsorships_student_idx on public.gym_sponsorships (student_profile_id);
create index gym_sponsorships_gym_idx on public.gym_sponsorships (gym_id);

create table public.entitlement_grants (
  id              uuid primary key default gen_random_uuid(),
  subject_type    public.subject_type not null,
  subject_id      uuid not null,
  entitlement_key text not null,
  source_type     public.grant_source not null,
  source_id       uuid,
  valid_from      timestamptz not null default now(),
  valid_until     timestamptz,
  created_at      timestamptz not null default now()
);
create index entitlement_grants_subject_idx
  on public.entitlement_grants (subject_type, subject_id, entitlement_key);

create table public.generation_quotas (
  id           uuid primary key default gen_random_uuid(),
  subject_type public.subject_type not null,
  subject_id   uuid not null,
  period_start date not null,
  period_end   date not null,
  allowance    integer not null check (allowance >= 0),
  used         integer not null default 0 check (used >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (subject_type, subject_id, period_start),
  check (period_end > period_start)
);

-- ---------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so policies can consult memberships
-- without recursing into gym_memberships' own RLS. search_path pinned.
-- ---------------------------------------------------------------------------
create or replace function public.is_gym_member(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships m
    where m.gym_id = p_gym_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.has_gym_role(p_gym_id uuid, p_roles public.gym_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships m
    where m.gym_id = p_gym_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

create or replace function public.is_gym_staff(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_gym_role(p_gym_id, array['owner','admin','instructor']::public.gym_role[]);
$$;

create or replace function public.is_active_guardian_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.guardian_links l
    where l.student_profile_id = p_student_id
      and l.guardian_profile_id = auth.uid()
      and l.status = 'active'
  );
$$;

-- Profiles a caller may see: self, active guardian/student counterparts,
-- and members of gyms where the caller is staff.
create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile_id = auth.uid()
    or exists (
      select 1 from public.guardian_links l
      where l.status = 'active'
        and ((l.guardian_profile_id = auth.uid() and l.student_profile_id = p_profile_id)
          or (l.student_profile_id = auth.uid() and l.guardian_profile_id = p_profile_id))
    )
    or exists (
      select 1 from public.gym_memberships target
      join public.gym_memberships me on me.gym_id = target.gym_id
      where target.profile_id = p_profile_id
        and target.status = 'active'
        and me.profile_id = auth.uid()
        and me.status = 'active'
        and me.role in ('owner','admin','instructor')
    );
$$;

revoke all on function public.is_gym_member(uuid) from public;
revoke all on function public.has_gym_role(uuid, public.gym_role[]) from public;
revoke all on function public.is_gym_staff(uuid) from public;
revoke all on function public.is_active_guardian_of(uuid) from public;
revoke all on function public.can_view_profile(uuid) from public;
grant execute on function public.is_gym_member(uuid) to authenticated;
grant execute on function public.has_gym_role(uuid, public.gym_role[]) to authenticated;
grant execute on function public.is_gym_staff(uuid) to authenticated;
grant execute on function public.is_active_guardian_of(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Experience resolution: server-authoritative answer to "which experiences
-- may this user enter". Reads only the caller's own memberships and links.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_experiences()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'instructor', exists (
      select 1 from public.gym_memberships m
      where m.profile_id = auth.uid() and m.status = 'active'
        and m.role in ('owner','admin','instructor')),
    'student', exists (
      select 1 from public.gym_memberships m
      where m.profile_id = auth.uid() and m.status = 'active' and m.role = 'student'),
    'parent', exists (
      select 1 from public.guardian_links l
      where l.guardian_profile_id = auth.uid() and l.status = 'active')
  );
$$;
revoke all on function public.resolve_experiences() from public;
grant execute on function public.resolve_experiences() to authenticated;

-- Accept an invite addressed to the caller's email. Runs as definer so the
-- caller never needs update rights on rows that are not yet theirs.
create or replace function public.accept_gym_invite(p_membership_id uuid)
returns public.gym_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.gym_memberships;
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  update public.gym_memberships
     set profile_id = auth.uid(),
         status = 'active',
         joined_at = now(),
         invited_email = null
   where id = p_membership_id
     and status = 'invited'
     and (
       profile_id = auth.uid()
       or (profile_id is null and v_email is not null and lower(invited_email) = lower(v_email))
     )
  returning * into v_row;
  if v_row.id is null then
    raise exception 'invite not found or not addressed to you' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
revoke all on function public.accept_gym_invite(uuid) from public;
grant execute on function public.accept_gym_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.gyms               enable row level security;
alter table public.gym_locations      enable row level security;
alter table public.gym_memberships    enable row level security;
alter table public.guardian_links     enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.gym_sponsorships   enable row level security;
alter table public.entitlement_grants enable row level security;
alter table public.generation_quotas  enable row level security;

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated using (public.can_view_profile(id));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- no insert (trigger) and no delete (auth.users cascade) for clients.

-- gyms
create policy gyms_select_member on public.gyms
  for select to authenticated using (public.is_gym_member(id));
create policy gyms_insert_self_owner on public.gyms
  for insert to authenticated with check (owner_profile_id = auth.uid());
create policy gyms_update_owner_admin on public.gyms
  for update to authenticated
  using (public.has_gym_role(id, array['owner','admin']::public.gym_role[]))
  with check (public.has_gym_role(id, array['owner','admin']::public.gym_role[]));
create policy gyms_delete_owner on public.gyms
  for delete to authenticated
  using (public.has_gym_role(id, array['owner']::public.gym_role[]));

-- gym_locations
create policy gym_locations_select_member on public.gym_locations
  for select to authenticated using (public.is_gym_member(gym_id));
create policy gym_locations_write_owner_admin on public.gym_locations
  for all to authenticated
  using (public.has_gym_role(gym_id, array['owner','admin']::public.gym_role[]))
  with check (public.has_gym_role(gym_id, array['owner','admin']::public.gym_role[]));

-- gym_memberships
-- Read: your own rows (any status), plus every row of gyms where you are staff.
create policy gym_memberships_select on public.gym_memberships
  for select to authenticated
  using (profile_id = auth.uid() or public.is_gym_staff(gym_id));
-- Insert: owners may add any non-owner role; admins may add instructors and students.
-- Nobody inserts an 'owner' row directly (trigger does it on gym creation).
create policy gym_memberships_insert_staff on public.gym_memberships
  for insert to authenticated
  with check (
    role <> 'owner'
    and (
      public.has_gym_role(gym_id, array['owner']::public.gym_role[])
      or (public.has_gym_role(gym_id, array['admin']::public.gym_role[])
          and role in ('instructor','student'))
    )
  );
-- Update: owners manage every non-owner row; admins manage instructor/student rows;
-- a member may only mark their own non-owner row as 'left'.
create policy gym_memberships_update_staff on public.gym_memberships
  for update to authenticated
  using (
    role <> 'owner'
    and (
      public.has_gym_role(gym_id, array['owner']::public.gym_role[])
      or (public.has_gym_role(gym_id, array['admin']::public.gym_role[])
          and role in ('instructor','student'))
    )
  )
  with check (
    role <> 'owner'
    and (
      public.has_gym_role(gym_id, array['owner']::public.gym_role[])
      or (public.has_gym_role(gym_id, array['admin']::public.gym_role[])
          and role in ('instructor','student'))
    )
  );
create policy gym_memberships_leave_self on public.gym_memberships
  for update to authenticated
  using (profile_id = auth.uid() and role <> 'owner')
  with check (profile_id = auth.uid() and role <> 'owner' and status = 'left');
create policy gym_memberships_delete_owner on public.gym_memberships
  for delete to authenticated
  using (role <> 'owner' and public.has_gym_role(gym_id, array['owner']::public.gym_role[]));

-- guardian_links
create policy guardian_links_select_party on public.guardian_links
  for select to authenticated
  using (guardian_profile_id = auth.uid() or student_profile_id = auth.uid());
-- A guardian proposes a link (pending). Activation is the student's (or a later
-- reviewed onboarding flow's) act, never the guardian's alone.
create policy guardian_links_insert_guardian on public.guardian_links
  for insert to authenticated
  with check (guardian_profile_id = auth.uid() and status = 'pending');
create policy guardian_links_student_respond on public.guardian_links
  for update to authenticated
  using (student_profile_id = auth.uid())
  with check (student_profile_id = auth.uid() and status in ('active','revoked'));
create policy guardian_links_guardian_revoke on public.guardian_links
  for update to authenticated
  using (guardian_profile_id = auth.uid())
  with check (guardian_profile_id = auth.uid() and status = 'revoked');

-- Commercial tables: read your own subject rows; gym rows readable by owner/admin.
-- No client writes at all: the service role is the only writer.
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (
    (subject_type = 'profile' and subject_id = auth.uid())
    or (subject_type = 'gym' and public.has_gym_role(subject_id, array['owner','admin']::public.gym_role[]))
  );
create policy entitlement_grants_select on public.entitlement_grants
  for select to authenticated
  using (
    (subject_type = 'profile' and subject_id = auth.uid())
    or (subject_type = 'gym' and public.is_gym_member(subject_id))
  );
create policy generation_quotas_select on public.generation_quotas
  for select to authenticated
  using (
    (subject_type = 'profile' and subject_id = auth.uid())
    or (subject_type = 'gym' and public.is_gym_staff(subject_id))
  );
create policy gym_sponsorships_select on public.gym_sponsorships
  for select to authenticated
  using (
    student_profile_id = auth.uid()
    or public.has_gym_role(gym_id, array['owner','admin']::public.gym_role[])
  );
