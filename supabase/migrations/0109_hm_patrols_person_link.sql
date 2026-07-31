-- ============================================================
-- 0109_hm_patrols_person_link.sql :
--   1) 産業医巡視記録(hm_patrols)
--   2) 面談とカルテ(hm_persons)の連携列
-- ============================================================

-- ------------------------------------------------------------
-- 1. 産業医巡視記録
-- ------------------------------------------------------------

create table if not exists public.hm_patrols (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  patrol_date date not null,
  areas text,             -- 巡視場所
  findings text,          -- 指摘事項・所見
  advice text,            -- 指導・助言
  note text,              -- 改善状況・備考
  physician_name text,    -- 巡視した産業医(作成時スナップショット)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz  -- 論理削除(officeのRPCのみ)
);

create index if not exists hm_patrols_company_date_idx
  on public.hm_patrols (company_id, patrol_date desc);

alter table public.hm_patrols enable row level security;

-- 閲覧: office=全社 / company=自社
create policy hm_patrols_select on public.hm_patrols
  for select using (
    deleted_at is null
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  );

-- 作成・編集はofficeのみ(巡視は産業医の業務)
create policy hm_patrols_insert on public.hm_patrols
  for insert with check (public.hm_is_office() and created_by = auth.uid());

create policy hm_patrols_update on public.hm_patrols
  for update using (public.hm_is_office() and deleted_at is null)
  with check (public.hm_is_office());

revoke delete on public.hm_patrols from anon, authenticated;

create or replace function public.hm_delete_patrol(p_id uuid, p_reason text)
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
  update public.hm_patrols
     set deleted_at = now(), updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then
    raise exception 'patrol not found or already deleted';
  end if;
  perform public.hm_log_access(
    'delete', 'hm_patrols', p_id, jsonb_build_object('reason', p_reason)
  );
end;
$$;

drop trigger if exists hm_patrols_set_updated_at on public.hm_patrols;
create trigger hm_patrols_set_updated_at
  before update on public.hm_patrols
  for each row execute function public.hm_set_updated_at();

-- ------------------------------------------------------------
-- 2. 面談 → カルテ(hm_persons) 連携列
-- ------------------------------------------------------------

alter table public.hm_interviews
  add column if not exists person_id uuid references public.hm_persons(id);

create index if not exists hm_interviews_person_idx
  on public.hm_interviews (person_id);

-- 0102で列単位GRANTにしているため、新列にも個別にGRANTを追加
grant select (person_id), insert (person_id), update (person_id)
  on public.hm_interviews to authenticated;
