-- hotels.created_at remains the timestamp of registration. Existing hotels
-- keep their operational status and receive a subscription only on activation.
begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = pg_catalog, public, extensions;

create table public.hotel_subscriptions (
  hotel_id uuid primary key references public.hotels(id),
  status text not null check (status in (
    'trial', 'active', 'pending_renewal', 'suspended', 'offboarded'
  )),
  activated_at timestamptz not null default clock_timestamp(),
  renewal_mode text not null default 'manual',
  renewal_authorization_id uuid,
  constraint hotel_subscription_renewal_mode_check check (
    (renewal_mode = 'manual' and renewal_authorization_id is null)
    or (renewal_mode = 'automatic' and renewal_authorization_id is not null)
  )
);

create table public.hotel_subscription_periods (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotel_subscriptions(hotel_id),
  kind text not null,
  plan text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unique (hotel_id, id),
  check (isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at),
  check (
    (kind = 'trial' and plan is null and ends_at = starts_at + interval '336 hours')
    or (kind = 'paid' and plan is not null and plan in ('basic', 'professional', 'enterprise'))
  ),
  constraint hotel_subscription_periods_no_overlap exclude using gist (
    hotel_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create unique index hotel_subscription_one_trial
  on public.hotel_subscription_periods(hotel_id) where kind = 'trial';
create index hotel_subscription_periods_by_end
  on public.hotel_subscription_periods(hotel_id, ends_at desc);

create table public.hotel_renewal_authorizations (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotel_subscriptions(hotel_id),
  -- Identity snapshots remain available if accounts are subsequently removed.
  customer_user_id uuid not null,
  agreed_at timestamptz not null,
  terms_version text not null check (btrim(terms_version) <> ''),
  evidence_reference text not null check (btrim(evidence_reference) <> ''),
  recorded_at timestamptz not null,
  recorded_by uuid not null,
  revoked_at timestamptz,
  revoked_by uuid,
  unique (hotel_id, id),
  check (isfinite(agreed_at) and agreed_at <= recorded_at),
  check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at >= recorded_at and revoked_at is not null and revoked_by is not null)
  )
);

alter table public.hotel_subscriptions
  add constraint hotel_subscription_authorization_same_hotel
  foreign key (hotel_id, renewal_authorization_id)
  references public.hotel_renewal_authorizations(hotel_id, id);

create table public.hotel_subscription_events (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotel_subscriptions(hotel_id),
  action text not null check (action in (
    'activated', 'renewed', 'status_changed', 'authorization_recorded',
    'authorization_revoked', 'renewal_mode_changed'
  )),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null default auth.uid(),
  previous_status text,
  new_status text,
  period_id uuid,
  authorization_id uuid,
  renewal_mode text check (renewal_mode in ('manual', 'automatic')),
  notes text,
  foreign key (hotel_id, period_id)
    references public.hotel_subscription_periods(hotel_id, id),
  foreign key (hotel_id, authorization_id)
    references public.hotel_renewal_authorizations(hotel_id, id)
);

create index hotel_subscription_events_by_date
  on public.hotel_subscription_events(hotel_id, occurred_at desc);

create trigger audit_hotel_subscription_events
  after insert on public.hotel_subscription_events
  for each row execute function private.write_audit_log();

alter table public.hotel_subscriptions enable row level security;
alter table public.hotel_subscription_periods enable row level security;
alter table public.hotel_renewal_authorizations enable row level security;
alter table public.hotel_subscription_events enable row level security;

revoke all on public.hotel_subscriptions, public.hotel_subscription_periods,
  public.hotel_renewal_authorizations, public.hotel_subscription_events
  from public, anon, authenticated, service_role;
grant select on public.hotel_subscriptions, public.hotel_subscription_periods,
  public.hotel_renewal_authorizations, public.hotel_subscription_events to authenticated;

create policy hotel_subscriptions_read on public.hotel_subscriptions
  for select to authenticated using (
    (select private.is_platform_admin())
    or private.has_hotel_role(hotel_id, array['hotel_manager'])
  );
create policy hotel_subscription_periods_read on public.hotel_subscription_periods
  for select to authenticated using (
    (select private.is_platform_admin())
    or private.has_hotel_role(hotel_id, array['hotel_manager'])
  );
create policy hotel_renewal_authorizations_read on public.hotel_renewal_authorizations
  for select to authenticated using ((select private.is_platform_admin()));
create policy hotel_subscription_events_read on public.hotel_subscription_events
  for select to authenticated using ((select private.is_platform_admin()));

create function public.platform_admin_start_hotel_subscription(
  _hotel_id uuid, _plan text default null, _paid_until timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_status text := 'trial';
  v_period_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  if (_plan is null) <> (_paid_until is null) then
    raise exception 'An initial paid period requires both a plan and an end timestamp'
      using errcode = '22023';
  end if;
  if _plan is not null then
    v_status := 'active';
  end if;

  insert into public.hotel_subscriptions(hotel_id, status, activated_at)
  values (_hotel_id, v_status, v_now);
  insert into public.hotel_subscription_periods(hotel_id, kind, plan, starts_at, ends_at)
  values (_hotel_id, case when _plan is null then 'trial' else 'paid' end,
          _plan, v_now, coalesce(_paid_until, v_now + interval '336 hours'))
  returning id into v_period_id;
  insert into public.hotel_subscription_events(hotel_id, action, new_status, period_id)
  values (_hotel_id, 'activated', v_status, v_period_id);
  return v_period_id;
end;
$$;

create function public.platform_admin_renew_hotel_subscription(
  _hotel_id uuid, _plan text, _ends_at timestamptz, _notes text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
  v_starts_at timestamptz;
  v_period_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  select status into strict v_status from public.hotel_subscriptions
    where hotel_id = _hotel_id for update;
  if v_status = 'offboarded' then
    raise exception 'Reopen the subscription before adding a period' using errcode = '22023';
  end if;
  select greatest(clock_timestamp(), max(ends_at)) into v_starts_at
    from public.hotel_subscription_periods where hotel_id = _hotel_id;
  insert into public.hotel_subscription_periods(hotel_id, kind, plan, starts_at, ends_at)
  values (_hotel_id, 'paid', _plan, v_starts_at, _ends_at)
  returning id into v_period_id;
  insert into public.hotel_subscription_events(hotel_id, action, period_id, notes)
  values (_hotel_id, 'renewed', v_period_id, _notes);
  return v_period_id;
end;
$$;

create function public.platform_admin_set_hotel_subscription_status(
  _hotel_id uuid, _status text, _notes text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_previous text;
  v_now timestamptz;
  v_authorization_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  if _status is null or _status not in ('trial', 'active', 'pending_renewal', 'suspended', 'offboarded') then
    raise exception 'Invalid subscription status' using errcode = '22023';
  end if;
  select status, renewal_authorization_id into strict v_previous, v_authorization_id
    from public.hotel_subscriptions where hotel_id = _hotel_id for update;
  if v_previous = _status then
    return;
  end if;
  v_now := clock_timestamp();
  if _status in ('trial', 'active') and not exists (
    select 1 from public.hotel_subscription_periods
    where hotel_id = _hotel_id
      and kind = case _status when 'trial' then 'trial' else 'paid' end
      and starts_at <= v_now and ends_at > v_now
  ) then
    raise exception 'The requested status requires a current period of the corresponding kind'
      using errcode = '22023';
  end if;
  if _status = 'offboarded' and v_authorization_id is not null then
    update public.hotel_subscriptions
      set renewal_mode = 'manual', renewal_authorization_id = null
      where hotel_id = _hotel_id;
    insert into public.hotel_subscription_events(hotel_id, action, authorization_id, renewal_mode)
    values (_hotel_id, 'renewal_mode_changed', v_authorization_id, 'manual');
  end if;
  update public.hotel_subscriptions set status = _status where hotel_id = _hotel_id;
  insert into public.hotel_subscription_events(hotel_id, action, previous_status, new_status, notes)
  values (_hotel_id, 'status_changed', v_previous, _status, _notes);
end;
$$;

create function public.platform_admin_record_hotel_renewal_authorization(
  _hotel_id uuid, _customer_user_id uuid, _agreed_at timestamptz,
  _terms_version text, _evidence_reference text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_authorization_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.hotel_memberships
    where hotel_id = _hotel_id and user_id = _customer_user_id
      and status = 'active' and role = 'hotel_manager'
  ) then
    raise exception 'Authorization requires an active customer representative for this hotel'
      using errcode = '22023';
  end if;
  insert into public.hotel_renewal_authorizations(
    hotel_id, customer_user_id, agreed_at, terms_version, evidence_reference, recorded_at, recorded_by
  )
  values (_hotel_id, _customer_user_id, _agreed_at, _terms_version, _evidence_reference,
          clock_timestamp(), auth.uid())
  returning id into v_authorization_id;
  insert into public.hotel_subscription_events(hotel_id, action, authorization_id)
  values (_hotel_id, 'authorization_recorded', v_authorization_id);
  return v_authorization_id;
end;
$$;

create function public.platform_admin_set_hotel_renewal_mode(
  _hotel_id uuid, _authorization_id uuid default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
  v_previous_authorization_id uuid;
  v_mode text := 'manual';
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  select status, renewal_authorization_id into strict v_status, v_previous_authorization_id
    from public.hotel_subscriptions where hotel_id = _hotel_id for update;
  if v_previous_authorization_id is not distinct from _authorization_id then
    return;
  end if;
  if _authorization_id is not null then
    if v_status = 'offboarded' or not exists (
      select 1 from public.hotel_renewal_authorizations
      where hotel_id = _hotel_id and id = _authorization_id and revoked_at is null
    ) then
      raise exception 'Automatic renewal requires a current authorization for this hotel'
        using errcode = '22023';
    end if;
    v_mode := 'automatic';
  end if;
  update public.hotel_subscriptions
    set renewal_mode = v_mode, renewal_authorization_id = _authorization_id
    where hotel_id = _hotel_id;
  insert into public.hotel_subscription_events(hotel_id, action, authorization_id, renewal_mode)
  values (_hotel_id, 'renewal_mode_changed',
          coalesce(_authorization_id, v_previous_authorization_id), v_mode);
end;
$$;

create function public.platform_admin_revoke_hotel_renewal_authorization(
  _hotel_id uuid, _authorization_id uuid, _notes text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
  v_current_authorization_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  select renewal_authorization_id into strict v_current_authorization_id
    from public.hotel_subscriptions where hotel_id = _hotel_id for update;
  select revoked_at into strict v_revoked_at from public.hotel_renewal_authorizations
    where hotel_id = _hotel_id and id = _authorization_id;
  if v_revoked_at is not null then
    return;
  end if;
  if v_current_authorization_id = _authorization_id then
    perform public.platform_admin_set_hotel_renewal_mode(_hotel_id);
  end if;
  update public.hotel_renewal_authorizations
    set revoked_at = clock_timestamp(), revoked_by = auth.uid()
    where hotel_id = _hotel_id and id = _authorization_id;
  insert into public.hotel_subscription_events(hotel_id, action, authorization_id, notes)
  values (_hotel_id, 'authorization_revoked', _authorization_id, _notes);
end;
$$;

revoke all on function
  public.platform_admin_start_hotel_subscription(uuid, text, timestamptz),
  public.platform_admin_renew_hotel_subscription(uuid, text, timestamptz, text),
  public.platform_admin_set_hotel_subscription_status(uuid, text, text),
  public.platform_admin_record_hotel_renewal_authorization(uuid, uuid, timestamptz, text, text),
  public.platform_admin_set_hotel_renewal_mode(uuid, uuid),
  public.platform_admin_revoke_hotel_renewal_authorization(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.platform_admin_start_hotel_subscription(uuid, text, timestamptz),
  public.platform_admin_renew_hotel_subscription(uuid, text, timestamptz, text),
  public.platform_admin_set_hotel_subscription_status(uuid, text, text),
  public.platform_admin_record_hotel_renewal_authorization(uuid, uuid, timestamptz, text, text),
  public.platform_admin_set_hotel_renewal_mode(uuid, uuid),
  public.platform_admin_revoke_hotel_renewal_authorization(uuid, uuid, text)
  to authenticated;

commit;
