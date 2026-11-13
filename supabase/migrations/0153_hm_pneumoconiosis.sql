-- ============================================================
-- 0153_hm_pneumoconiosis.sql : じん肺健康管理台帳(じん肺健康管理実施状況報告 様式第8号 の集計用)
-- ============================================================
-- じん肺健康管理実施状況報告(じん肺法施行規則 様式第8号)は、毎年12月末現在の事業場の「じん肺健康管理の状況」を
-- 翌年2月末までに労基署へ報告するもの(じん肺健康診断を行わない年も報告する)。
-- 健診機関の結果票は紙(様式第3号)のことが多く、管理区分は労働局長の決定通知で決まるため、1人ずつ台帳に入力して集計する。
--
--   * hm_pneumo_workers: 粉じん作業に従事している/従事したことのある在籍労働者(1行=1人)
--       粉じん作業の状況(現在従事・過去に従事)、粉じん作業コード、じん肺管理区分とその内訳、決定日・決定前の区分、
--       作業転換日、合併症(1〜6号)と療養開始日、退職日
--   * hm_pneumo_exams: じん肺健康診断の受診記録(就業時・定期・定期外・離職時、定期外の肺がん検査)
--   * 閲覧・入力: 実施者と、その企業の事業者担当者(管理区分の決定通知は事業者に届くため)
--
-- 方針: 追加のみ / hm_ 接頭辞
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create table if not exists public.hm_pneumo_workers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid references public.hm_persons(id) on delete set null,
  full_name text not null,
  dust_status text not null default 'current' check (dust_status in ('current', 'past')), -- current: 現在粉じん作業に従事 / past: 過去に従事(現在は非粉じん作業)
  dust_work_code text check (dust_work_code is null or dust_work_code ~ '^[0-9]{3}$'),        -- 粉じん作業コード(様式の裏の一覧)
  kanri text not null default '1' check (kanri in ('1', '2', '3i', '3ro', '4')),            -- じん肺管理区分
  kanri_detail text check (kanri_detail is null or kanri_detail in ('PR3', 'PR4AB', 'PR4C', 'F++', 'other')), -- 管理3ロ・管理4の内訳
  kanri_decided_on date,                                                                     -- 管理区分の決定日(労働局長の通知書)
  kanri_previous text check (kanri_previous is null or kanri_previous in ('1', '2', '3i', '3ro', '4')), -- 決定前の管理区分
  transferred_on date,                                                                       -- 粉じん作業から他の作業へ転換した日
  complication smallint check (complication is null or complication between 1 and 6),       -- 合併症(じん肺法施行規則第1条 1〜6号)
  complication_started_on date,                                                              -- 合併症の療養を開始した日
  left_on date,                                                                              -- 退職日(12月末に在籍していなければ集計しない)
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hm_pneumo_workers_company_idx on public.hm_pneumo_workers (company_id, full_name);

create table if not exists public.hm_pneumo_exams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  worker_id uuid not null references public.hm_pneumo_workers(id) on delete cascade,
  exam_date date not null,
  exam_kind text not null default 'periodic' check (exam_kind in ('hiring', 'periodic', 'extra', 'leaving')), -- 就業時・定期・定期外・離職時
  lung_cancer boolean not null default false,  -- 定期外健診で肺がんに関する検査を行った
  xray text,                                   -- エックス線写真の像(例: 0/0、1/0)
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists hm_pneumo_exams_company_idx on public.hm_pneumo_exams (company_id, exam_date);
create index if not exists hm_pneumo_exams_worker_idx on public.hm_pneumo_exams (worker_id, exam_date desc);

drop trigger if exists hm_pneumo_workers_set_updated_at on public.hm_pneumo_workers;
create trigger hm_pneumo_workers_set_updated_at
  before update on public.hm_pneumo_workers
  for each row execute function public.hm_set_updated_at();

-- 閲覧・入力: 実施者、またはその企業の事業者担当者
alter table public.hm_pneumo_workers enable row level security;
alter table public.hm_pneumo_exams enable row level security;

drop policy if exists hm_pneumo_workers_all on public.hm_pneumo_workers;
create policy hm_pneumo_workers_all on public.hm_pneumo_workers
  for all
  using (public.hm_is_office() or (public.hm_my_role() = 'company' and company_id = public.hm_my_company()))
  with check (public.hm_is_office() or (public.hm_my_role() = 'company' and company_id = public.hm_my_company()));

drop policy if exists hm_pneumo_exams_all on public.hm_pneumo_exams;
create policy hm_pneumo_exams_all on public.hm_pneumo_exams
  for all
  using (public.hm_is_office() or (public.hm_my_role() = 'company' and company_id = public.hm_my_company()))
  with check (
    (public.hm_is_office() or (public.hm_my_role() = 'company' and company_id = public.hm_my_company()))
    and exists (select 1 from public.hm_pneumo_workers w where w.id = worker_id and w.company_id = hm_pneumo_exams.company_id)
  );

revoke all on public.hm_pneumo_workers from anon;
revoke all on public.hm_pneumo_exams from anon;
grant select, insert, update, delete on public.hm_pneumo_workers to authenticated;
grant select, insert, update, delete on public.hm_pneumo_exams to authenticated;

-- 適用状況の確認
select * from (
  values
    ('じん肺健康管理台帳(表)',
     (select case when count(*) = 2 then '✅OK' else '❌未適用' end
        from information_schema.tables
       where table_schema = 'public' and table_name in ('hm_pneumo_workers', 'hm_pneumo_exams'))),
    ('閲覧・入力の権限(RLS)',
     (select case when count(*) = 2 then '✅OK' else '❌未適用' end
        from pg_policies where tablename in ('hm_pneumo_workers', 'hm_pneumo_exams')))
) as t(項目, 状態);
