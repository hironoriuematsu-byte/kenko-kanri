-- ============================================================
-- 0111_hm_hygiene_patrols.sql : 衛生管理者巡視記録(チェックリスト形式)
-- ============================================================
--   * hm_checklist_items   : 企業別チェックリスト項目(工場用/オフィス用、編集可)
--   * hm_hygiene_patrols   : 巡視記録(実施時の項目と判定をJSONで保存。
--                            後から項目を編集しても過去の記録は変わらない)
-- 作成・編集: office / company(自社)。削除はofficeのみ(RPC・ログ記録)
-- ============================================================

-- ------------------------------------------------------------
-- 1. チェックリスト項目(企業別テンプレート)
-- ------------------------------------------------------------

create table if not exists public.hm_checklist_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  checklist_type text not null check (checklist_type in ('factory', 'office')),
  item_text text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hm_checklist_items_company_idx
  on public.hm_checklist_items (company_id, checklist_type, sort_order);

alter table public.hm_checklist_items enable row level security;

create policy hm_checklist_items_select on public.hm_checklist_items
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

create policy hm_checklist_items_insert on public.hm_checklist_items
  for insert with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

create policy hm_checklist_items_update on public.hm_checklist_items
  for update using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  )
  with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

create policy hm_checklist_items_delete on public.hm_checklist_items
  for delete using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

-- ------------------------------------------------------------
-- 2. 衛生管理者巡視記録
-- ------------------------------------------------------------

create table if not exists public.hm_hygiene_patrols (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  patrol_date date not null,
  checklist_type text not null check (checklist_type in ('factory', 'office')),
  inspector_name text,          -- 巡視者(衛生管理者)氏名
  results jsonb not null default '[]',
    -- [{ "item": "項目文", "result": "ok"|"ng"|"na", "note": "メモ" }, ...]
  summary text,                 -- 特記事項・改善指示
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists hm_hygiene_patrols_company_idx
  on public.hm_hygiene_patrols (company_id, patrol_date desc);

alter table public.hm_hygiene_patrols enable row level security;

create policy hm_hygiene_patrols_select on public.hm_hygiene_patrols
  for select using (
    deleted_at is null
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  );

create policy hm_hygiene_patrols_insert on public.hm_hygiene_patrols
  for insert with check (
    created_by = auth.uid()
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  );

create policy hm_hygiene_patrols_update on public.hm_hygiene_patrols
  for update using (
    deleted_at is null
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  )
  with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

revoke delete on public.hm_hygiene_patrols from anon, authenticated;

create or replace function public.hm_delete_hygiene_patrol(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason required';
  end if;
  update public.hm_hygiene_patrols
     set deleted_at = now(), updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then
    raise exception 'record not found or already deleted';
  end if;
  perform public.hm_log_access(
    'delete', 'hm_hygiene_patrols', p_id, jsonb_build_object('reason', p_reason)
  );
end;
$$;

drop trigger if exists hm_hygiene_patrols_set_updated_at on public.hm_hygiene_patrols;
create trigger hm_hygiene_patrols_set_updated_at
  before update on public.hm_hygiene_patrols
  for each row execute function public.hm_set_updated_at();
