begin;

create table private.hotel_trial_import_key (
  singleton boolean primary key default true check (singleton),
  key_hash bytea not null
);
revoke all on private.hotel_trial_import_key from public, anon, authenticated, service_role;

create table public.hotel_trial_requests (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique check (char_length(source_id) between 1 and 250),
  submitted_at timestamptz not null check (isfinite(submitted_at)),
  contact_name text check (char_length(contact_name) <= 160),
  hotel_name text check (char_length(hotel_name) <= 180),
  contact_role text check (char_length(contact_role) <= 100),
  email text not null check (char_length(email) <= 254 and email ~ '^[^ @]+@[^ @.]+[.][^ @]+$'),
  phone text check (char_length(phone) <= 60),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'activated')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  hotel_id uuid references public.hotels(id),
  activated_at timestamptz,
  activated_by uuid,
  check ((status = 'pending') = (reviewed_at is null and reviewed_by is null)),
  check ((status = 'activated') = (activated_at is not null and activated_by is not null and hotel_id is not null))
);
create index hotel_trial_requests_status_date on public.hotel_trial_requests(status, submitted_at desc);
alter table public.hotel_trial_requests enable row level security;
revoke all on public.hotel_trial_requests from public, anon, authenticated, service_role;

create function public.platform_admin_rotate_trial_import_key()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  v_key := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into private.hotel_trial_import_key(key_hash)
  values (sha256(convert_to(v_key, 'UTF8')))
  on conflict (singleton) do update set key_hash = excluded.key_hash;
  insert into public.audit_logs(actor_id, actor_id_snapshot, action, entity_table, details)
    values (auth.uid(), auth.uid(), 'rotate_key', 'hotel_trial_import_key', '{}'::jsonb);
  return v_key;
end;
$$;

create function public.ingest_hotel_trial_requests(_key text, _responses jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if _key is null or char_length(_key) <> 64 or not exists (
    select 1 from private.hotel_trial_import_key where key_hash = sha256(convert_to(_key, 'UTF8'))
  ) then
    raise exception 'Invalid form import key' using errcode = '42501';
  end if;
  if jsonb_typeof(_responses) is distinct from 'array' then
    raise exception 'Expected an array of form responses' using errcode = '22023';
  end if;
  if jsonb_array_length(_responses) > 100 then
    raise exception 'Maximum 100 responses per batch' using errcode = '22023';
  end if;

  insert into public.hotel_trial_requests(source_id, submitted_at, contact_name, hotel_name, contact_role, email, phone)
  select response.id, response.submitted_at, nullif(btrim(response.contact_name), ''),
    nullif(btrim(response.hotel_name), ''), nullif(btrim(response.contact_role), ''),
    lower(btrim(response.email)), nullif(btrim(response.phone), '')
  from jsonb_to_recordset(_responses) as response(
    id text, submitted_at timestamptz, contact_name text, hotel_name text, contact_role text, email text, phone text
  )
  on conflict (source_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create function public.platform_admin_trial_requests(_status text default 'pending', _offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  if _status is null or _status not in ('pending', 'approved', 'rejected', 'activated')
    or _offset is null or _offset < 0 then
    raise exception 'Invalid request filter' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.hotel_trial_requests where status = _status),
    'hotels', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'slug', h.slug) order by h.name), '[]'::jsonb)
      from public.hotels h where h.status = 'active'),
    'requests', (select coalesce(jsonb_agg(to_jsonb(result) order by result.submitted_at desc, result.id), '[]'::jsonb)
      from (
        select r.id, r.submitted_at, r.contact_name, r.hotel_name, r.contact_role, r.email, r.phone, r.status,
          h.name as activated_hotel_name, exists (
            select 1 from auth.users u where lower(u.email) = r.email and u.email_confirmed_at is not null
          ) as account_confirmed
        from public.hotel_trial_requests r left join public.hotels h on h.id = r.hotel_id
        where r.status = _status
        order by r.submitted_at desc, r.id
        limit 25 offset _offset
      ) result)
  );
end;
$$;

create function public.platform_admin_review_trial_request(_id uuid, _status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  if _status is null or _status not in ('approved', 'rejected') then
    raise exception 'Invalid review decision' using errcode = '22023';
  end if;
  update public.hotel_trial_requests set status = _status, reviewed_at = clock_timestamp(), reviewed_by = auth.uid()
    where id = _id and status = 'pending';
  if not found then
    raise exception 'Trial request is no longer pending' using errcode = '22023';
  end if;
  insert into public.audit_logs(actor_id, actor_id_snapshot, action, entity_table, entity_id)
    values (auth.uid(), auth.uid(), _status, 'hotel_trial_requests', _id::text);
end;
$$;

create function public.platform_admin_activate_trial_request(
  _id uuid, _hotel_id uuid default null, _hotel_name text default null, _hotel_slug text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.hotel_trial_requests%rowtype;
  v_user_id uuid;
  v_hotel_id uuid := _hotel_id;
  v_now timestamptz := clock_timestamp();
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator MFA required' using errcode = '42501';
  end if;
  select * into strict v_request from public.hotel_trial_requests where id = _id for update;
  if v_request.status = 'activated' then
    return v_request.hotel_id;
  end if;
  if v_request.status <> 'approved' then
    raise exception 'Approve the request before activating access' using errcode = '22023';
  end if;
  select u.id into v_user_id from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = v_request.email and u.email_confirmed_at is not null;
  if v_user_id is null then
    raise exception 'The applicant needs a confirmed DubIoT account' using errcode = '22023';
  end if;

  if v_hotel_id is null then
    if nullif(btrim(_hotel_name), '') is null or char_length(_hotel_name) > 180
      or _hotel_slug is null or char_length(_hotel_slug) > 80
      or _hotel_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'Enter a hotel name and a valid unique code' using errcode = '22023';
    end if;
    insert into public.hotels(name, slug) values (btrim(_hotel_name), _hotel_slug)
      returning id into v_hotel_id;
  else
    perform 1 from public.hotels where id = v_hotel_id and status = 'active' for update;
    if not found then
      raise exception 'Select an active hotel' using errcode = '22023';
    end if;
  end if;
  -- Keep existing contracts intact; inactive contracts require a separate review.
  if not exists (select 1 from public.hotel_subscriptions where hotel_id = v_hotel_id) then
    perform public.platform_admin_start_hotel_subscription(v_hotel_id);
  elsif not exists (
    select 1 from public.hotel_subscriptions s
      join public.hotel_subscription_periods p on p.hotel_id = s.hotel_id
    where s.hotel_id = v_hotel_id and s.status in ('trial', 'active')
      and p.starts_at <= clock_timestamp() and p.ends_at > clock_timestamp()
  ) then
    raise exception 'Review the existing hotel subscription before activating access' using errcode = '22023';
  end if;

  insert into public.hotel_memberships(hotel_id, user_id, role, status, approved_by, approved_at)
  values (v_hotel_id, v_user_id, 'hotel_manager', 'active', auth.uid(), v_now)
  on conflict (hotel_id, user_id) do update set role = excluded.role, status = excluded.status,
    approved_by = excluded.approved_by, approved_at = excluded.approved_at
  where hotel_memberships.status in ('pending', 'active');
  if not found then
    raise exception 'Review this user''s suspended or rejected membership first' using errcode = '22023';
  end if;
  update public.hotel_trial_requests
    set status = 'activated', hotel_id = v_hotel_id, activated_at = clock_timestamp(), activated_by = auth.uid()
    where id = _id;
  insert into public.audit_logs(hotel_id, actor_id, actor_id_snapshot, action, entity_table, entity_id)
    values (v_hotel_id, auth.uid(), auth.uid(), 'activated', 'hotel_trial_requests', _id::text);
  return v_hotel_id;
end;
$$;

revoke all on function public.ingest_hotel_trial_requests(text,jsonb),
  public.platform_admin_rotate_trial_import_key(), public.platform_admin_trial_requests(text,integer),
  public.platform_admin_review_trial_request(uuid,text), public.platform_admin_activate_trial_request(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_hotel_trial_requests(text,jsonb) to anon;
grant execute on function public.platform_admin_rotate_trial_import_key(), public.platform_admin_trial_requests(text,integer),
  public.platform_admin_review_trial_request(uuid,text), public.platform_admin_activate_trial_request(uuid,uuid,text,text)
  to authenticated;

commit;
