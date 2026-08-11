-- ============================================================
-- 0113_hm_env_patrol_files.sql :
--   1) 作業環境測定(hm_env_measurements) 測定結果報告書のファイル管理
--   2) 産業医巡視記録の添付ファイル(hm_patrol_files) 写真等
-- ============================================================

-- ------------------------------------------------------------
-- 1. 作業環境測定
-- ------------------------------------------------------------

create table if not exists public.hm_env_measurements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  measurement_date date,
  title text,                 -- 測定内容(騒音・粉じん・有機溶剤など)
  note text,
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists hm_env_measurements_company_idx
  on public.hm_env_measurements (company_id, measurement_date desc);

alter table public.hm_env_measurements enable row level security;

create policy hm_env_measurements_select on public.hm_env_measurements
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

create policy hm_env_measurements_insert on public.hm_env_measurements
  for insert with check (
    uploaded_by = auth.uid()
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  );

-- 削除: office、またはアップロードした本人(company)
create policy hm_env_measurements_delete on public.hm_env_measurements
  for delete using (
    public.hm_is_office()
    or (
      public.hm_my_role() = 'company'
      and company_id = public.hm_my_company()
      and uploaded_by = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 2. 産業医巡視記録の添付(写真等)
-- ------------------------------------------------------------

create table if not exists public.hm_patrol_files (
  id uuid primary key default gen_random_uuid(),
  patrol_id uuid not null references public.hm_patrols(id),
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists hm_patrol_files_patrol_idx
  on public.hm_patrol_files (patrol_id, created_at);

alter table public.hm_patrol_files enable row level security;

-- 閲覧は親の巡視記録が見える人(office / company自社)
create policy hm_patrol_files_select on public.hm_patrol_files
  for select using (
    exists (select 1 from public.hm_patrols p where p.id = patrol_id)
  );

-- 追加・削除は巡視記録と同じくofficeのみ
create policy hm_patrol_files_insert on public.hm_patrol_files
  for insert with check (public.hm_is_office() and uploaded_by = auth.uid());

create policy hm_patrol_files_delete on public.hm_patrol_files
  for delete using (public.hm_is_office());
