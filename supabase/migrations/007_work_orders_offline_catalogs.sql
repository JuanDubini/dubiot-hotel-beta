-- DubIoT Hotel — hotel catalogs, preventive work orders and field history metadata.
-- Apply after migrations 001–006.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists categories_hotel_name_unique
  on public.categories(hotel_id, lower(trim(name)));
create index if not exists categories_hotel_idx on public.categories(hotel_id, name);
alter table public.categories enable row level security;
revoke all on public.categories from anon, authenticated;
grant select, insert on public.categories to authenticated;
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated
  using ((select private.has_hotel_access(hotel_id)));
drop policy if exists categories_manager_insert on public.categories;
create policy categories_manager_insert on public.categories for insert to authenticated
  with check ((select private.has_hotel_role(hotel_id, array['hotel_manager']::text[]))
    and created_by = (select auth.uid()));

create table if not exists public.check_types (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists check_types_hotel_name_unique
  on public.check_types(hotel_id, lower(trim(name)));
create index if not exists check_types_hotel_idx on public.check_types(hotel_id, name);
alter table public.check_types enable row level security;
revoke all on public.check_types from anon, authenticated;
grant select, insert on public.check_types to authenticated;
drop policy if exists check_types_read on public.check_types;
create policy check_types_read on public.check_types for select to authenticated
  using ((select private.has_hotel_access(hotel_id)));
drop policy if exists check_types_manager_insert on public.check_types;
create policy check_types_manager_insert on public.check_types for insert to authenticated
  with check ((select private.has_hotel_role(hotel_id, array['hotel_manager']::text[]))
    and created_by = (select auth.uid()));

insert into public.categories(hotel_id, name)
select h.id, trim(e.category) from public.hotels h
join public.equipment e on e.hotel_id=h.id
where trim(e.category) <> ''
on conflict do nothing;
insert into public.check_types(hotel_id, name)
select h.id, trim(c.check_name) from public.hotels h
join public.daily_checks c on c.hotel_id=h.id
where trim(c.check_name) <> ''
on conflict do nothing;

-- Correct the remaining asset-label typo that was visible in the demo inventory.
update public.equipment set category='Hidráulica'
where lower(trim(category))='hidrulica';
update public.categories set name='Hidráulica'
where lower(trim(name))='hidrulica';
update public.equipment set location=regexp_replace(location,'esxterior','exterior','gi')
where location ~* 'esxterior';

-- Internal security-definer triggers may update status after a failed control.
-- Authenticated callers still pass through the field-level role guard.
create or replace function private.guard_equipment_technician_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('postgres','supabase_admin') then return new; end if;
  if not private.has_hotel_role(old.hotel_id, array['hotel_manager','supervisor']::text[])
     and (new.hotel_id is distinct from old.hotel_id
       or new.name is distinct from old.name or new.category is distinct from old.category
       or new.location is distinct from old.location or new.status is distinct from old.status
       or new.status_reason is distinct from old.status_reason or new.notes is distinct from old.notes
       or new.created_by is distinct from old.created_by) then
    raise exception 'Technicians may update asset model, serial number and photo only';
  end if;
  return new;
end; $$;
revoke all on function private.guard_equipment_technician_update() from public, anon, authenticated;

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  asset_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 5000),
  source text not null default 'manual' check (source in ('manual','control','sensor','preventive','request')),
  source_record_id uuid,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assigned_to uuid references public.profiles(id),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','assigned','in_progress','waiting_parts','resolved','verified')),
  started_at timestamptz,
  resolved_at timestamptz,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  time_spent_min integer not null default 0 check (time_spent_min >= 0),
  photos text[] not null default '{}',
  notes text not null default '' check (length(notes) <= 5000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint work_orders_same_hotel_asset_fk foreign key (hotel_id, asset_id)
    references public.equipment(hotel_id, id) on delete restrict
);
create unique index if not exists work_orders_source_record_unique
  on public.work_orders(source, source_record_id) where source_record_id is not null;
create index if not exists work_orders_hotel_status_due_idx
  on public.work_orders(hotel_id, status, due_at);
create index if not exists work_orders_assigned_status_idx
  on public.work_orders(assigned_to, status, due_at);
alter table public.work_orders enable row level security;
revoke all on public.work_orders from anon, authenticated;
grant select, insert, update on public.work_orders to authenticated;
drop policy if exists work_orders_select on public.work_orders;
create policy work_orders_select on public.work_orders for select to authenticated
  using ((select private.has_hotel_access(hotel_id)));
drop policy if exists work_orders_insert on public.work_orders;
create policy work_orders_insert on public.work_orders for insert to authenticated
  with check ((select private.has_hotel_role(hotel_id, array['hotel_manager','supervisor']::text[]))
    and created_by = (select auth.uid()));
drop policy if exists work_orders_update on public.work_orders;
create policy work_orders_update on public.work_orders for update to authenticated
  using ((select private.has_hotel_role(hotel_id, array['hotel_manager','supervisor']::text[]))
    or (assigned_to = (select auth.uid()) and (select private.has_hotel_role(hotel_id, array['technician']::text[]))))
  with check ((select private.has_hotel_role(hotel_id, array['hotel_manager','supervisor']::text[]))
    or (assigned_to = (select auth.uid()) and (select private.has_hotel_role(hotel_id, array['technician']::text[]))));

create or replace function private.guard_work_order()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := case when new.assigned_to is null then 'open' else 'assigned' end;
    new.started_at := null; new.resolved_at := null; new.verified_by := null; new.verified_at := null;
    new.created_at := clock_timestamp(); new.updated_at := new.created_at;
  else
    new.updated_at := clock_timestamp();
    if not private.has_hotel_role(old.hotel_id, array['hotel_manager','supervisor']::text[]) then
      if old.assigned_to is distinct from (select auth.uid())
         or new.hotel_id is distinct from old.hotel_id or new.asset_id is distinct from old.asset_id
         or new.title is distinct from old.title or new.description is distinct from old.description
         or new.source is distinct from old.source or new.source_record_id is distinct from old.source_record_id
         or new.priority is distinct from old.priority or new.assigned_to is distinct from old.assigned_to
         or new.due_at is distinct from old.due_at or new.created_by is distinct from old.created_by
         or new.started_at is distinct from old.started_at or new.resolved_at is distinct from old.resolved_at
         or new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at
         or new.created_at is distinct from old.created_at then
        raise exception 'Técnicos solo pueden actualizar sus órdenes asignadas';
      end if;
      if new.status is distinct from old.status and not (
        (old.status in ('assigned','in_progress','waiting_parts') and new.status in ('in_progress','waiting_parts','resolved'))
      ) then raise exception 'Transición de orden no permitida para técnico'; end if;
    end if;
    if new.assigned_to is not null and not exists (
      select 1 from public.hotel_memberships m where m.hotel_id=new.hotel_id and m.user_id=new.assigned_to
        and m.status='active' and m.role='technician'
    ) then raise exception 'La orden solo puede asignarse a técnicos activos del hotel'; end if;
    if new.status='in_progress' and old.status is distinct from new.status then new.started_at := clock_timestamp(); end if;
    if new.status='resolved' and old.status is distinct from new.status then new.resolved_at := clock_timestamp(); end if;
    if new.status='verified' and old.status is distinct from new.status then
      if not private.has_hotel_role(new.hotel_id, array['hotel_manager','supervisor']::text[]) then
        raise exception 'Solo un responsable o supervisor puede verificar una orden';
      end if;
      if old.status <> 'resolved' then raise exception 'La orden debe estar resuelta antes de verificarse'; end if;
      new.verified_by := (select auth.uid()); new.verified_at := clock_timestamp();
    elsif new.status <> 'verified' then new.verified_by := null; new.verified_at := null;
    else new.verified_by := old.verified_by; new.verified_at := old.verified_at; end if;
  end if;
  return new;
end; $$;
drop trigger if exists work_orders_guard on public.work_orders;
create trigger work_orders_guard before insert or update on public.work_orders
  for each row execute procedure private.guard_work_order();
revoke all on function private.guard_work_order() from public, anon, authenticated;

create or replace function private.validate_work_order_assignee()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.hotel_memberships m where m.hotel_id=new.hotel_id and m.user_id=new.assigned_to
      and m.status='active' and m.role='technician'
  ) then raise exception 'La persona asignada debe ser un técnico activo del mismo hotel'; end if;
  return new;
end; $$;
drop trigger if exists work_orders_assignee_guard on public.work_orders;
create trigger work_orders_assignee_guard before insert or update of hotel_id, assigned_to
  on public.work_orders for each row execute procedure private.validate_work_order_assignee();
revoke all on function private.validate_work_order_assignee() from public, anon, authenticated;

create or replace function private.log_work_order_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_details text;
begin
  if tg_op='INSERT' then
    v_title := 'Orden creada: ' || new.title;
    v_details := case new.priority when 'urgent' then 'Urgente' when 'high' then 'Alta' when 'low' then 'Baja' else 'Media' end
      || ' · ' || case new.source when 'control' then 'Generada por un control con falla' else 'Origen: ' || new.source end;
  elsif new.status is distinct from old.status then
    v_title := case new.status when 'assigned' then 'Orden asignada' when 'in_progress' then 'Reparación iniciada'
      when 'waiting_parts' then 'En espera de repuestos' when 'resolved' then 'Reparación terminada'
      when 'verified' then 'Orden verificada y cerrada' else 'Orden actualizada' end;
    v_details := new.title || case when coalesce(new.notes,'')='' then '' else ' · ' || new.notes end;
  else return new;
  end if;
  insert into public.equipment_history(hotel_id,equipment_id,event_type,title,details,actor_id)
  values (new.hotel_id,new.asset_id,'repair',left(v_title,160),left(v_details,5000),
    case when tg_op='INSERT' then new.created_by else (select auth.uid()) end);
  return new;
end; $$;
drop trigger if exists work_orders_history on public.work_orders;
create trigger work_orders_history after insert or update of status on public.work_orders
  for each row execute procedure private.log_work_order_history();
revoke all on function private.log_work_order_history() from public, anon, authenticated;

create or replace function private.open_work_order_for_failed_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_desc text;
begin
  if new.result <> 'failure' or new.equipment_id is null then return new; end if;
  v_title := 'Falla en control: ' || new.check_name;
  v_desc := coalesce(nullif(trim(new.notes),''),'El control diario encontró una falla.');
  insert into public.work_orders(hotel_id,asset_id,title,description,source,source_record_id,priority,status,created_by)
  values (new.hotel_id,new.equipment_id,left(v_title,160),left(v_desc,5000),'control',new.id,'high','open',new.checked_by)
  on conflict (source,source_record_id) where source_record_id is not null do nothing;
  update public.equipment set status='review',status_reason='Falla detectada en control: ' || left(new.check_name,120)
    where hotel_id=new.hotel_id and id=new.equipment_id and status <> 'review';
  return new;
end; $$;
drop trigger if exists daily_check_open_work_order on public.daily_checks;
create trigger daily_check_open_work_order after insert on public.daily_checks
  for each row execute procedure private.open_work_order_for_failed_check();
revoke all on function private.open_work_order_for_failed_check() from public, anon, authenticated;

alter table public.equipment_history
  add column if not exists occurred_at timestamptz not null default clock_timestamp(),
  add column if not exists photo_paths text[] not null default '{}';
create index if not exists equipment_history_occurred_idx
  on public.equipment_history(hotel_id,equipment_id,occurred_at desc);
create or replace function private.set_equipment_history_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.actor_id := (select auth.uid());
  if new.occurred_at is null then new.occurred_at := clock_timestamp(); end if;
  if new.occurred_at > clock_timestamp() then raise exception 'La fecha del hito no puede ser futura'; end if;
  new.created_at := clock_timestamp();
  return new;
end; $$;
revoke all on function private.set_equipment_history_metadata() from public, anon, authenticated;
grant insert (hotel_id,equipment_id,event_type,title,details,actor_id,occurred_at,photo_paths) on public.equipment_history to authenticated;

-- Expose approved catalog reads and work-order rows only through RLS.
-- Status history gets human-readable state labels for older records in the UI.

alter table public.equipment_history enable row level security;
revoke all on public.equipment_history from anon, authenticated;
grant select, insert on public.equipment_history to authenticated;
drop policy if exists equipment_history_select on public.equipment_history;
create policy equipment_history_select on public.equipment_history for select to authenticated
  using ((select private.has_hotel_access(hotel_id)));
drop policy if exists equipment_history_insert on public.equipment_history;
create policy equipment_history_insert on public.equipment_history for insert to authenticated
  with check ((select private.has_hotel_role(hotel_id, array['hotel_manager','supervisor','technician']::text[]))
    and actor_id = (select auth.uid()));

drop trigger if exists equipment_history_metadata on public.equipment_history;
create trigger equipment_history_metadata before insert on public.equipment_history
  for each row execute procedure private.set_equipment_history_metadata();

drop trigger if exists work_orders_audit on public.work_orders;
create trigger work_orders_audit after insert or update on public.work_orders
  for each row execute procedure private.write_audit_log();

