-- DubIoT Hotel — tighten beta role requests and require reasons for critical states.
-- Apply after migrations 001–005. Review first if this project already contains
-- manually provisioned memberships or operational status history.

-- A supervisor request must be approved by the hotel manager. Only technician
-- and staff roles remain self-service for the public Hotel Demo beta tenant.
create or replace function public.request_hotel_membership(_hotel_id uuid, _requested_role text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_hotel_slug text;
  v_membership_id uuid;
  v_status text;
begin
  if v_actor is null then raise exception 'Authenticated actor required'; end if;
  if not exists (
    select 1 from auth.users u
    where u.id = v_actor and u.email_confirmed_at is not null
  ) then raise exception 'A verified email is required'; end if;
  if _requested_role not in ('supervisor','technician','staff') then
    raise exception 'Invalid requested role';
  end if;
  select h.slug into v_hotel_slug from public.hotels h
    where h.id = _hotel_id and h.status = 'active';
  if not found then raise exception 'Active hotel not found'; end if;

  select m.id, m.status into v_membership_id, v_status
    from public.hotel_memberships m
    where m.hotel_id = _hotel_id and m.user_id = v_actor
    for update;

  if not found then
    insert into public.hotel_memberships(hotel_id, user_id, role, status)
    values (_hotel_id, v_actor, _requested_role,
      case when v_hotel_slug = 'hotel-demo' and _requested_role in ('technician','staff') then 'active' else 'pending' end)
    returning id into v_membership_id;
    if v_hotel_slug = 'hotel-demo' and _requested_role in ('technician','staff') then
      update public.hotel_memberships set approved_at = clock_timestamp() where id = v_membership_id;
    end if;
    return v_membership_id;
  end if;

  if v_status = 'active' then raise exception 'An active membership already exists'; end if;
  if v_status = 'pending' then
    update public.hotel_memberships
      set role = _requested_role,
          status = case when v_hotel_slug = 'hotel-demo' and _requested_role in ('technician','staff') then 'active' else 'pending' end,
          requested_at = clock_timestamp(), approved_by = null,
          approved_at = case when v_hotel_slug = 'hotel-demo' and _requested_role in ('technician','staff') then clock_timestamp() else null end,
          rejected_by = null, rejected_at = null, rejection_reason = null,
          revoked_by = null, revoked_at = null, revocation_reason = null
      where id = v_membership_id;
    return v_membership_id;
  end if;
  raise exception 'Rejected or suspended membership requires hotel manager review';
end;
$$;
revoke all on function public.request_hotel_membership(uuid, text) from public, anon;
grant execute on function public.request_hotel_membership(uuid, text) to authenticated;

-- The previous beta migration auto-approved self-selected supervisors. If the
-- demo has no manager yet, bootstrap its oldest auto-approved supervisor as the
-- first hotel manager so the owner is not locked out; queue any other such
-- memberships for review. A later manager-approved membership has an actor.
with managerless_demo as (
  select h.id as hotel_id from public.hotels h
  where h.slug = 'hotel-demo' and not exists (
    select 1 from public.hotel_memberships active_manager
    where active_manager.hotel_id = h.id and active_manager.role = 'hotel_manager'
      and active_manager.status = 'active'
  )
), first_manager as (
  select distinct on (m.hotel_id) m.id
  from public.hotel_memberships m
  join managerless_demo h on h.hotel_id = m.hotel_id
  where m.role = 'supervisor' and m.status = 'active' and m.approved_by is null
  order by m.hotel_id, m.requested_at asc
)
update public.hotel_memberships m
set role = 'hotel_manager', approved_at = coalesce(m.approved_at, clock_timestamp())
from first_manager f where f.id = m.id;

update public.hotel_memberships m
set status = 'pending', approved_by = null, approved_at = null
from public.hotels h
where h.id = m.hotel_id and h.slug = 'hotel-demo'
  and m.role = 'supervisor' and m.status = 'active' and m.approved_by is null;

-- A reason is retained with the asset so its automatic history entry can
-- explain why it became critical or unavailable.
alter table public.equipment add column if not exists status_reason text not null default '';
grant update (status_reason) on public.equipment to authenticated;

-- Preserve the technician's restricted update surface with the new column.
create or replace function private.guard_equipment_technician_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.has_hotel_role(old.hotel_id, array['hotel_manager','supervisor']::text[])
     and (new.hotel_id is distinct from old.hotel_id
       or new.name is distinct from old.name
       or new.category is distinct from old.category
       or new.location is distinct from old.location
       or new.status is distinct from old.status
       or new.status_reason is distinct from old.status_reason
       or new.notes is distinct from old.notes
       or new.created_by is distinct from old.created_by) then
    raise exception 'Technicians may update asset model, serial number and photo only';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_equipment_technician_update() from public, anon, authenticated;

create or replace function private.guard_equipment_status_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('critical','out_of_service')
     and length(trim(coalesce(new.status_reason,''))) = 0 then
    raise exception 'A reason is required for critical or out-of-service status';
  end if;
  if new.status is distinct from old.status and new.status not in ('critical','out_of_service') then
    new.status_reason := '';
  end if;
  return new;
end;
$$;
drop trigger if exists equipment_status_reason_guard on public.equipment;
create trigger equipment_status_reason_guard before update of status, status_reason
  on public.equipment for each row execute procedure private.guard_equipment_status_reason();
revoke all on function private.guard_equipment_status_reason() from public, anon, authenticated;

create or replace function private.log_equipment_history()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  old_label text;
  new_label text;
  reason text;
begin
  if tg_op = 'INSERT' then
    insert into public.equipment_history(hotel_id, equipment_id, event_type, title, details)
    values (new.hotel_id, new.id, 'created', 'Activo registrado',
            'Activo agregado al inventario del hotel.');
  elsif new.status is distinct from old.status then
    old_label := case old.status when 'operational' then 'Operativo' when 'review' then 'En revisión' when 'critical' then 'Crítico' when 'out_of_service' then 'Fuera de servicio' else old.status end;
    new_label := case new.status when 'operational' then 'Operativo' when 'review' then 'En revisión' when 'critical' then 'Crítico' when 'out_of_service' then 'Fuera de servicio' else new.status end;
    reason := nullif(trim(coalesce(new.status_reason,'')), '');
    insert into public.equipment_history(hotel_id, equipment_id, event_type, title, details)
    values (new.hotel_id, new.id, 'status_change', 'Estado actualizado',
            old_label || ' → ' || new_label || case when reason is null then '' else ' · Motivo: ' || reason end);
  end if;
  return new;
end;
$$;
revoke all on function private.log_equipment_history() from public, anon, authenticated;

-- Correct only the known demo typos called out in the beta UX audit.
update public.equipment_history
set title = replace(replace(title, 'jubta', 'junta'), 'diano', 'diario'),
    details = replace(replace(details, 'lajunta', 'la junta'), 'diano', 'diario')
where title ilike '%jubta%' or title ilike '%diano%'
   or details ilike '%lajunta%' or details ilike '%diano%';
update public.issues
set title = replace(replace(title, 'jubta', 'junta'), 'diano', 'diario'),
    description = replace(replace(description, 'lajunta', 'la junta'), 'diano', 'diario')
where title ilike '%jubta%' or title ilike '%diano%'
   or description ilike '%lajunta%' or description ilike '%diano%';
update public.daily_checks
set check_name = replace(check_name, 'diano', 'diario'),
    notes = replace(notes, 'diano', 'diario')
where check_name ilike '%diano%' or notes ilike '%diano%';
