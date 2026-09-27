-- Reverses migrations/20260927000100_phase1_foundation.sql. Kept OUTSIDE migrations/
-- so tooling never applies it as a forward step. Not applied automatically;
-- run by hand to roll the foundation back. Destroys Phase 1 data.
--
-- Order matters: tables go first (dropping a table drops its policies), then
-- the functions those policies used, then types. One transaction, so a
-- failure leaves the schema exactly as it was.

begin;

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.generation_quotas;
drop table if exists public.entitlement_grants;
drop table if exists public.gym_sponsorships;
drop table if exists public.subscriptions;
drop table if exists public.guardian_links;
drop table if exists public.gym_memberships;
drop table if exists public.gym_locations;
drop table if exists public.gyms;
drop table if exists public.profiles;

drop function if exists public.accept_gym_invite(uuid);
drop function if exists public.resolve_experiences();
drop function if exists public.can_view_profile(uuid);
drop function if exists public.is_active_guardian_of(uuid);
drop function if exists public.is_gym_staff(uuid);
drop function if exists public.has_gym_role(uuid, public.gym_role[]);
drop function if exists public.is_gym_member(uuid);
drop function if exists public.handle_new_gym();
drop function if exists public.handle_new_user();
drop function if exists public.touch_updated_at();

drop type if exists public.grant_source;
drop type if exists public.subject_type;
drop type if exists public.link_status;
drop type if exists public.membership_status;
drop type if exists public.gym_role;

commit;
