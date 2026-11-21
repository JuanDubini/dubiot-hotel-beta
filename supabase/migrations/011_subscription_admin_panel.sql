begin;

-- Legacy hotels keep their existing data. Unconfigured limits remain unknown.
create table public.hotel_subscription_preferences (
  hotel_id uuid primary key references public.hotels(id),
  contact_phone text check (char_length(contact_phone) <= 40),
  user_limit integer check (user_limit > 0),
  email_notices_enabled boolean not null default false
);
alter table public.hotel_subscription_preferences enable row level security;
revoke all on public.hotel_subscription_preferences from public, anon, authenticated, service_role;

create function public.platform_admin_subscription_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_hotels jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.name, item.hotel_id), '[]'::jsonb)
  into v_hotels
  from (
    select h.id as hotel_id, h.name, h.slug, h.created_at, h.timezone, s.status,
      s.renewal_mode, s.renewal_authorization_id, prefs.contact_phone,
      prefs.user_limit, coalesce(prefs.email_notices_enabled, false) as email_notices_enabled,
      (select count(*) from public.hotel_memberships m
        where m.hotel_id = h.id and m.status = 'active') as active_users,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.user_id, 'name', nullif(btrim(p.full_name), ''),
        'email', u.email, 'phone', u.phone
      ) order by m.approved_at nulls last, m.requested_at, m.user_id), '[]'::jsonb)
        from public.hotel_memberships m
        join public.profiles p on p.id = m.user_id
        join auth.users u on u.id = m.user_id
        where m.hotel_id = h.id and m.role = 'hotel_manager' and m.status = 'active') as managers,
      (select to_jsonb(p) from public.hotel_subscription_periods p
        where p.hotel_id = h.id and p.kind = 'trial') as trial,
      (select to_jsonb(p) from public.hotel_subscription_periods p
        where p.hotel_id = h.id and p.starts_at <= v_now and p.ends_at > v_now) as current_period,
      (select to_jsonb(p) from public.hotel_subscription_periods p
        where p.hotel_id = h.id and p.starts_at > v_now order by p.starts_at limit 1) as next_period,
      (select to_jsonb(p) from public.hotel_subscription_periods p
        where p.hotel_id = h.id order by p.ends_at desc limit 1) as latest_period,
      (select to_jsonb(p) from public.hotel_subscription_periods p
        where p.hotel_id = h.id and p.ends_at <= v_now order by p.ends_at desc limit 1) as previous_period,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'customer_user_id', a.customer_user_id, 'agreed_at', a.agreed_at,
        'terms_version', a.terms_version, 'evidence_reference', a.evidence_reference,
        'revoked_at', a.revoked_at
      ) order by a.recorded_at desc, a.id), '[]'::jsonb)
        from public.hotel_renewal_authorizations a where a.hotel_id = h.id) as authorizations
    from public.hotels h
    left join public.hotel_subscriptions s on s.hotel_id = h.id
    left join public.hotel_subscription_preferences prefs on prefs.hotel_id = h.id
  ) item;

  return jsonb_build_object('generated_at', v_now, 'hotels', v_hotels);
end;
$$;

create function public.platform_admin_save_subscription_preferences(
  _hotel_id uuid, _contact_phone text, _user_limit integer, _email_notices_enabled boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before public.hotel_subscription_preferences%rowtype;
  v_phone text := nullif(btrim(_contact_phone), '');
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  -- Use a consistent lock order for preferences and offboarding.
  perform 1 from public.hotels where id = _hotel_id for update;
  if not found then
    raise exception 'Hotel not found' using errcode = '23503';
  end if;
  if _email_notices_enabled and exists (
    select 1 from public.hotel_subscriptions where hotel_id = _hotel_id and status = 'offboarded'
  ) then
    raise exception 'A closed subscription cannot enable email notices' using errcode = '22023';
  end if;
  select * into v_before from public.hotel_subscription_preferences where hotel_id = _hotel_id;
  if row(v_before.contact_phone, v_before.user_limit, coalesce(v_before.email_notices_enabled, false))
    is not distinct from row(v_phone, _user_limit, _email_notices_enabled) then
    return;
  end if;
  insert into public.hotel_subscription_preferences(hotel_id, contact_phone, user_limit, email_notices_enabled)
  values (_hotel_id, v_phone, _user_limit, _email_notices_enabled)
  on conflict (hotel_id) do update set contact_phone = excluded.contact_phone,
    user_limit = excluded.user_limit, email_notices_enabled = excluded.email_notices_enabled;

  insert into public.audit_logs(hotel_id, actor_id, actor_id_snapshot, action, entity_table, entity_id, details)
  values (_hotel_id, auth.uid(), auth.uid(), 'update', 'hotel_subscription_preferences', _hotel_id::text,
    jsonb_build_object(
      'contact_phone_changed', v_before.contact_phone is distinct from v_phone,
      'user_limit', jsonb_build_object('from', v_before.user_limit, 'to', _user_limit),
      'email_notices_enabled', jsonb_build_object(
        'from', coalesce(v_before.email_notices_enabled, false), 'to', _email_notices_enabled)
    ));
end;
$$;

-- Keep the original state transition available internally. Public callers must
-- use the dedicated, explicitly confirmed offboarding operation.
alter function public.platform_admin_set_hotel_subscription_status(uuid, text, text) set schema private;
revoke all on function private.platform_admin_set_hotel_subscription_status(uuid, text, text)
  from public, anon, authenticated, service_role;

create function public.platform_admin_set_hotel_subscription_status(
  _hotel_id uuid, _status text, _notes text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  if _status = 'offboarded' then
    raise exception 'Use the confirmed offboarding operation' using errcode = '22023';
  end if;
  perform private.platform_admin_set_hotel_subscription_status(_hotel_id, _status, _notes);
end;
$$;

create function public.platform_admin_offboard_hotel_subscription(
  _hotel_id uuid, _confirmation text, _notes text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text;
  v_prefs public.hotel_subscription_preferences%rowtype;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  select slug into strict v_slug from public.hotels where id = _hotel_id for update;
  if _confirmation is distinct from v_slug then
    raise exception 'Hotel confirmation does not match' using errcode = '22023';
  end if;
  perform private.platform_admin_set_hotel_subscription_status(_hotel_id, 'offboarded', _notes);
  select * into v_prefs from public.hotel_subscription_preferences where hotel_id = _hotel_id;
  if v_prefs.email_notices_enabled then
    perform public.platform_admin_save_subscription_preferences(
      _hotel_id, v_prefs.contact_phone, v_prefs.user_limit, false);
  end if;
end;
$$;

alter function public.platform_admin_renew_hotel_subscription(uuid, text, timestamptz, text) set schema private;
revoke all on function private.platform_admin_renew_hotel_subscription(uuid, text, timestamptz, text)
  from public, anon, authenticated, service_role;

create function public.platform_admin_renew_hotel_subscription(
  _hotel_id uuid, _plan text, _ends_at timestamptz, _notes text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_subscription public.hotel_subscriptions%rowtype;
  v_period_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  select * into strict v_subscription from public.hotel_subscriptions where hotel_id = _hotel_id for update;
  if v_subscription.renewal_mode <> 'manual' then
    raise exception 'Select manual renewal mode first' using errcode = '22023';
  end if;
  v_period_id := private.platform_admin_renew_hotel_subscription(_hotel_id, _plan, _ends_at, _notes);
  if v_subscription.status in ('trial', 'pending_renewal') and exists (
    select 1 from public.hotel_subscription_periods where hotel_id = _hotel_id
      and kind = 'paid' and starts_at <= clock_timestamp() and ends_at > clock_timestamp()
  ) then
    perform private.platform_admin_set_hotel_subscription_status(_hotel_id, 'active', _notes);
  end if;
  return v_period_id;
end;
$$;

revoke all on function
  public.platform_admin_subscription_overview(),
  public.platform_admin_save_subscription_preferences(uuid, text, integer, boolean),
  public.platform_admin_set_hotel_subscription_status(uuid, text, text),
  public.platform_admin_offboard_hotel_subscription(uuid, text, text),
  public.platform_admin_renew_hotel_subscription(uuid, text, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.platform_admin_subscription_overview(),
  public.platform_admin_save_subscription_preferences(uuid, text, integer, boolean),
  public.platform_admin_set_hotel_subscription_status(uuid, text, text),
  public.platform_admin_offboard_hotel_subscription(uuid, text, text),
  public.platform_admin_renew_hotel_subscription(uuid, text, timestamptz, text)
  to authenticated;

commit;
