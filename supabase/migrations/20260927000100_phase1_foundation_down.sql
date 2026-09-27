-- Reverses 20260927000100_phase1_foundation.sql. Not applied automatically;
-- run by hand to roll the foundation back. Destroys Phase 1 data.

drop function if exists public.accept_gym_invite(uuid);
drop function if exists public.resolve_experiences();
drop function if exists public.can_view_profile(uuid);
drop function if exists public.is_active_guardian_of(uuid);
drop function if exists public.is_gym_staff(uuid);
drop function if exists public.has_gym_role(uuid, public.gym_role[]);
drop function if exists public.is_gym_member(uuid);

drop table if exists public.generation_quotas;
drop table if exists public.entitlement_grants;
drop table if exists public.gym_sponsorships;
drop table if exists public.subscriptions;
drop table if exists public.guardian_links;

drop trigger if exists on_gym_created on public.gyms;
drop function if exists public.handle_new_gym();
drop table if exists public.gym_memberships;
drop table if exists public.gym_locations;
drop table if exists public.gyms;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;
drop function if exists public.touch_updated_at();

drop type if exists public.grant_source;
drop type if exists public.subject_type;
drop type if exists public.link_status;
drop type if exists public.membership_status;
drop type if exists public.gym_role;
