-- RentFlow M1: row-level security, grants, triggers and the owner-signup function.
--
-- Access model
--   owner   → everything in their org.
--   manager → read-only on the properties listed in user_property_access (and the
--             rooms/beds/tenancies/tenants inside them). Manager writes arrive in M2
--             as scoped functions that also enforce business rules.
--   anon    → nothing.
-- Helper functions live in the `private` schema, which the Supabase API does not expose.
-- They are SECURITY DEFINER so policies can read org_members without recursing into RLS.
--
-- Every statement is followed by a statement-breakpoint marker because the migrator
-- runs one statement per round trip.

create schema if not exists private;
--> statement-breakpoint
revoke all on schema private from public;
--> statement-breakpoint
grant usage on schema private to authenticated;
--> statement-breakpoint

-- ─── Generic triggers ───────────────────────────────────────────────────────

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
--> statement-breakpoint

-- Writes one audit_log row per insert/update/delete. No-op updates are skipped.
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row    jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (v_before - 'updated_at') = (v_after - 'updated_at') then
    return new;
  end if;
  v_row := coalesce(v_after, v_before);
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after)
  values (
    case when tg_table_name = 'orgs' then (v_row ->> 'id')::uuid else (v_row ->> 'org_id')::uuid end,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;
--> statement-breakpoint

-- An org must always keep at least one owner (unless the org itself is being deleted).
create function private.keep_one_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.org_id <> old.org_id or new.user_id <> old.user_id)
     and exists (select 1 from public.orgs o where o.id = old.org_id)
     and not exists (
       select 1 from public.org_members m
       where m.org_id = old.org_id and m.role = 'owner' and m.id <> old.id
     )
  then
    raise exception 'An organisation must keep at least one owner' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
--> statement-breakpoint

-- ─── Access helpers (used by policies) ──────────────────────────────────────

create function private.is_org_member(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid())
  );
$$;
--> statement-breakpoint

create function private.is_org_owner(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
--> statement-breakpoint

-- True if the current user shares at least one org with p_user_id.
create function private.shares_org_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.org_members mine
    join public.org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;
--> statement-breakpoint

-- Owners can access every property in their org; managers only those granted to them.
create function private.can_access_property(p_property_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.properties p
    join public.org_members m on m.org_id = p.org_id and m.user_id = (select auth.uid())
    where p.id = p_property_id
      and (
        m.role = 'owner'
        or exists (
          select 1 from public.user_property_access a
          where a.property_id = p.id and a.user_id = m.user_id
        )
      )
  );
$$;
--> statement-breakpoint

create function private.can_access_room(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_access_property(r.property_id) from public.rooms r where r.id = p_room_id),
    false
  );
$$;
--> statement-breakpoint

create function private.can_access_bed(p_bed_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_access_property(r.property_id)
     from public.beds b join public.rooms r on r.id = b.room_id
     where b.id = p_bed_id),
    false
  );
$$;
--> statement-breakpoint

-- True if the tenant has (or had) a tenancy in a property the user can access.
create function private.can_access_tenant(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenancies tc
    where tc.tenant_id = p_tenant_id and private.can_access_bed(tc.bed_id)
  );
$$;
--> statement-breakpoint

revoke all on all functions in schema private from public;
--> statement-breakpoint
grant execute on function
  private.is_org_member(uuid),
  private.is_org_owner(uuid),
  private.shares_org_with(uuid),
  private.can_access_property(uuid),
  private.can_access_room(uuid),
  private.can_access_bed(uuid),
  private.can_access_tenant(uuid)
to authenticated;
--> statement-breakpoint

-- ─── Owner signup ───────────────────────────────────────────────────────────

-- Called once by a freshly logged-in owner. Creates their users row, a new org,
-- and makes them its owner, all in one transaction. Returns the new org id.
create function public.create_owner_org(p_org_name text, p_owner_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_phone text := auth.jwt() ->> 'phone';
  v_org   uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if coalesce(btrim(p_org_name), '') = '' then
    raise exception 'Business name is required' using errcode = '22023';
  end if;
  if coalesce(v_phone, '') = '' then
    raise exception 'Phone number missing from session' using errcode = '28000';
  end if;
  -- Supabase stores phones without the leading "+".
  if left(v_phone, 1) <> '+' then
    v_phone := '+' || v_phone;
  end if;
  -- Guards against double-submits creating two orgs.
  if exists (select 1 from public.org_members m where m.user_id = v_uid and m.role = 'owner') then
    raise exception 'You already own an organisation' using errcode = '23505';
  end if;

  insert into public.users (id, phone, name)
  values (v_uid, v_phone, nullif(btrim(p_owner_name), ''))
  on conflict (id) do update set name = coalesce(excluded.name, public.users.name);

  insert into public.orgs (name) values (btrim(p_org_name)) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_uid, 'owner');
  return v_org;
end;
$$;
--> statement-breakpoint
revoke all on function public.create_owner_org(text, text) from public, anon;
--> statement-breakpoint
grant execute on function public.create_owner_org(text, text) to authenticated;
--> statement-breakpoint

-- ─── Triggers ───────────────────────────────────────────────────────────────

create trigger set_updated_at before update on public.orgs for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.users for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.org_members for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.user_property_access for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.properties for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.rooms for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.beds for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.tenants for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on public.tenancies for each row execute function private.set_updated_at();
--> statement-breakpoint

create trigger audit after insert or update or delete on public.orgs for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.org_members for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.user_property_access for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.properties for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.tenants for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after insert or update or delete on public.tenancies for each row execute function private.audit_row();
--> statement-breakpoint
-- Rooms and beds: skip inserts (bulk generation would flood the log) but record changes.
create trigger audit after update or delete on public.rooms for each row execute function private.audit_row();
--> statement-breakpoint
create trigger audit after update or delete on public.beds for each row execute function private.audit_row();
--> statement-breakpoint

create trigger keep_one_owner before update or delete on public.org_members for each row execute function private.keep_one_owner();
--> statement-breakpoint

-- ─── Grants ─────────────────────────────────────────────────────────────────
-- Supabase grants everything to anon/authenticated by default. Start from zero
-- and grant only what the policies below are written for.

revoke all on all tables in schema public from anon, authenticated;
--> statement-breakpoint
alter default privileges in schema public revoke all on tables from anon, authenticated;
--> statement-breakpoint
alter default privileges in schema public revoke all on functions from public, anon;
--> statement-breakpoint
grant all on all tables in schema public to service_role;
--> statement-breakpoint

grant select, update on public.orgs to authenticated;
--> statement-breakpoint
grant select on public.users to authenticated;
--> statement-breakpoint
-- Phone is the login identity and comes from Supabase Auth, so it is not editable here.
grant update (name, email) on public.users to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on
  public.org_members,
  public.user_property_access,
  public.properties,
  public.rooms,
  public.beds,
  public.tenants,
  public.tenancies
to authenticated;
--> statement-breakpoint
-- Append-only: rows are written by the audit trigger only.
grant select on public.audit_log to authenticated;
--> statement-breakpoint

-- ─── Row-level security ─────────────────────────────────────────────────────
-- SELECT policies check is_org_owner(org_id) first: it is cheap, and it works for
-- INSERT … RETURNING, where helpers that look the row up by id can't see it yet.

alter table public.orgs enable row level security;
--> statement-breakpoint
alter table public.users enable row level security;
--> statement-breakpoint
alter table public.org_members enable row level security;
--> statement-breakpoint
alter table public.user_property_access enable row level security;
--> statement-breakpoint
alter table public.properties enable row level security;
--> statement-breakpoint
alter table public.rooms enable row level security;
--> statement-breakpoint
alter table public.beds enable row level security;
--> statement-breakpoint
alter table public.tenants enable row level security;
--> statement-breakpoint
alter table public.tenancies enable row level security;
--> statement-breakpoint
alter table public.audit_log enable row level security;
--> statement-breakpoint

-- orgs: created only via create_owner_org(); never deleted from the app.
create policy orgs_select on public.orgs for select to authenticated
  using (private.is_org_member(id));
--> statement-breakpoint
create policy orgs_update on public.orgs for update to authenticated
  using (private.is_org_owner(id)) with check (private.is_org_owner(id));
--> statement-breakpoint

-- users: yourself, plus people who share an org with you.
create policy users_select on public.users for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));
--> statement-breakpoint
create policy users_update on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
--> statement-breakpoint

-- org_members: members see their colleagues; only owners change membership.
-- TODO(m2): manager invites by phone number.
create policy org_members_select on public.org_members for select to authenticated
  using (private.is_org_member(org_id));
--> statement-breakpoint
create policy org_members_insert on public.org_members for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy org_members_update on public.org_members for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy org_members_delete on public.org_members for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint

-- user_property_access: owners manage it; a manager can see their own grants.
create policy user_property_access_select on public.user_property_access for select to authenticated
  using (private.is_org_owner(org_id) or user_id = (select auth.uid()));
--> statement-breakpoint
create policy user_property_access_insert on public.user_property_access for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy user_property_access_update on public.user_property_access for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy user_property_access_delete on public.user_property_access for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint

-- properties: owners write; owners + granted managers read.
-- TODO(m2): honour the "edit_prices" manager permission.
create policy properties_select on public.properties for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_property(id));
--> statement-breakpoint
create policy properties_insert on public.properties for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy properties_update on public.properties for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy properties_delete on public.properties for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint

-- rooms / beds: same shape. The composite foreign keys guarantee the parent is in the same org.
create policy rooms_select on public.rooms for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_property(property_id));
--> statement-breakpoint
create policy rooms_insert on public.rooms for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy rooms_update on public.rooms for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy rooms_delete on public.rooms for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint

create policy beds_select on public.beds for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_room(room_id));
--> statement-breakpoint
create policy beds_insert on public.beds for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy beds_update on public.beds for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy beds_delete on public.beds for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint

-- tenants / tenancies: owners write; managers read within their properties.
-- TODO(m2): manager add/check-out through scoped functions.
create policy tenants_select on public.tenants for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_tenant(id));
--> statement-breakpoint
create policy tenants_insert on public.tenants for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy tenants_update on public.tenants for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy tenants_delete on public.tenants for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint

create policy tenancies_select on public.tenancies for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_bed(bed_id));
--> statement-breakpoint
create policy tenancies_insert on public.tenancies for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy tenancies_update on public.tenancies for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy tenancies_delete on public.tenancies for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint

-- audit_log: owners read their org's log.
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.is_org_owner(org_id));
