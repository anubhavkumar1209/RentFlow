-- M1 (spec v2): access rules for floors, and users may change their own app language.
-- Same shape as rooms: owners write, owners + managers of the property read.

create trigger set_updated_at before update on public.floors for each row execute function private.set_updated_at();
--> statement-breakpoint
create trigger audit after update or delete on public.floors for each row execute function private.audit_row();
--> statement-breakpoint
revoke all on public.floors from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on public.floors to authenticated;
--> statement-breakpoint
grant all on public.floors to service_role;
--> statement-breakpoint
alter table public.floors enable row level security;
--> statement-breakpoint
create policy floors_select on public.floors for select to authenticated
  using (private.is_org_owner(org_id) or private.can_access_property(property_id));
--> statement-breakpoint
create policy floors_insert on public.floors for insert to authenticated
  with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy floors_update on public.floors for update to authenticated
  using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
--> statement-breakpoint
create policy floors_delete on public.floors for delete to authenticated
  using (private.is_org_owner(org_id));
--> statement-breakpoint
grant update (language) on public.users to authenticated;
--> statement-breakpoint

-- Inactive members lose access everywhere: the helpers only count active memberships.
create or replace function private.is_org_member(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.active
  );
$$;
--> statement-breakpoint
create or replace function private.is_org_owner(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.role = 'owner' and m.active
  );
$$;
--> statement-breakpoint
create or replace function private.can_access_property(p_property_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.properties p
    join public.org_members m on m.org_id = p.org_id and m.user_id = (select auth.uid()) and m.active
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
