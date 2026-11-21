-- DubIoT global administration console.
-- Platform-wide account data is exposed only through MFA-gated SECURITY DEFINER RPCs.
-- Passwords are never stored in profiles and cannot be read from Supabase Auth.

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default clock_timestamp()
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;

create or replace function public.record_my_presence()
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_seen timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  insert into public.user_presence(user_id,last_seen_at)
  values (v_user,clock_timestamp())
  on conflict (user_id) do update set last_seen_at=excluded.last_seen_at
  returning last_seen_at into v_seen;
  return v_seen;
end;
$$;
revoke all on function public.record_my_presence() from public, anon;
grant execute on function public.record_my_presence() to authenticated;

create or replace function public.platform_admin_overview()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrator with MFA required'; end if;
  with user_rows as (
    select u.id, lower(u.email) as email, u.created_at,
      u.email_confirmed_at, u.last_sign_in_at,
      coalesce(p.full_name,'') as full_name,
      coalesce(pr.last_seen_at, null) as last_seen_at,
      coalesce(jsonb_agg(jsonb_build_object(
        'membership_id',m.id,'hotel_id',h.id,'hotel_name',h.name,'hotel_slug',h.slug,
        'role',m.role,'status',m.status,'requested_at',m.requested_at,
        'approved_at',m.approved_at,'revoked_at',m.revoked_at,'revocation_reason',m.revocation_reason
      ) order by h.name) filter (where m.id is not null),'[]'::jsonb) as memberships
    from auth.users u
    left join public.profiles p on p.id=u.id
    left join public.user_presence pr on pr.user_id=u.id
    left join public.hotel_memberships m on m.user_id=u.id
    left join public.hotels h on h.id=m.hotel_id
    group by u.id,p.full_name,pr.last_seen_at
  )
  select jsonb_build_object(
    'generated_at',clock_timestamp(),
    'users',(select count(*) from user_rows),
    'confirmed',(select count(*) from user_rows where email_confirmed_at is not null),
    'online',(select count(*) from user_rows where last_seen_at > clock_timestamp()-interval '3 minutes'),
    'memberships_active',(select count(*) from public.hotel_memberships where status='active'),
    'memberships_pending',(select count(*) from public.hotel_memberships where status='pending'),
    'memberships_offboarded',(select count(*) from public.hotel_memberships where status='suspended'),
    'memberships_rejected',(select count(*) from public.hotel_memberships where status='rejected'),
    'hotels',(select count(*) from public.hotels),
    'accounts',coalesce((select jsonb_agg(to_jsonb(r) order by r.email) from user_rows r),'[]'::jsonb),
    'hotels_list',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'slug',h.slug,'status',h.status) order by h.name) from public.hotels h),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.platform_admin_overview() from public, anon;
grant execute on function public.platform_admin_overview() to authenticated;

create or replace function public.platform_admin_set_membership(
  _membership_id uuid, _role text, _status text, _reason text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrator with MFA required'; end if;
  if _role not in ('hotel_manager','supervisor','technician','staff') then raise exception 'Invalid role'; end if;
  if _status not in ('active','suspended','rejected') then raise exception 'Invalid membership state'; end if;
  update public.hotel_memberships m set
    role=_role,status=_status,
    approved_by=case when _status='active' then (select auth.uid()) else m.approved_by end,
    approved_at=case when _status='active' then clock_timestamp() else m.approved_at end,
    rejected_by=case when _status='rejected' then (select auth.uid()) else null end,
    rejected_at=case when _status='rejected' then clock_timestamp() else null end,
    rejection_reason=case when _status='rejected' then left(coalesce(_reason,''),1000) else null end,
    revoked_by=case when _status='suspended' then (select auth.uid()) else null end,
    revoked_at=case when _status='suspended' then clock_timestamp() else null end,
    revocation_reason=case when _status='suspended' then left(coalesce(_reason,''),1000) else null end
  where m.id=_membership_id returning m.id into v_id;
  if v_id is null then raise exception 'Membership not found'; end if;
  return v_id;
end;
$$;
revoke all on function public.platform_admin_set_membership(uuid,text,text,text) from public, anon;
grant execute on function public.platform_admin_set_membership(uuid,text,text,text) to authenticated;

-- For a new project, bootstrap the confirmed owner account privately in Supabase SQL:
-- update public.profiles p set platform_role='platform_admin'
-- from auth.users u where p.id=u.id
--   and lower(u.email)=lower('<correo confirmado del propietario>')
--   and u.email_confirmed_at is not null;
-- Do not commit the real address. AAL2/MFA is mandatory for global access.

