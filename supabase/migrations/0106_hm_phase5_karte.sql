-- ============================================================
-- 0106_hm_phase5_karte.sql : 健康管理Web Phase 5 従業員カルテ
-- ============================================================
-- 前提: 0101〜0104 適用済み
--   * hm_persons          : 従業員台帳(カルテの主体。アカウント紐付けは任意)
--   * hm_person_files     : カルテ添付書類(診断書等)。公開範囲つき
--   * hm_person_documents : 産業医が作成する文書(診療情報提供依頼書等)
-- 公開範囲(visibility): 'shared'=事務所+企業 / 'office_only'=産業医事務所のみ
-- office限定ファイルはStorage上も 'office/' プレフィックス配下に置き、
-- 企業側のストレージポリシーから物理的に分離する。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 従業員台帳(hm_persons)
-- ------------------------------------------------------------

create table if not exists public.hm_persons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid references public.profiles(id),   -- アカウント紐付け(任意)
  full_name text not null,
  kana text,
  employee_no text,
  birth_date date,
  department text,
  note text,                                     -- 備考(部署異動など)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hm_persons_company_idx
  on public.hm_persons (company_id, employee_no);

alter table public.hm_persons enable row level security;

create policy hm_persons_select on public.hm_persons
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

create policy hm_persons_insert on public.hm_persons
  for insert with check (
    created_by = auth.uid()
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  );

create policy hm_persons_update on public.hm_persons
  for update using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  )
  with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

revoke delete on public.hm_persons from anon, authenticated;

drop trigger if exists hm_persons_set_updated_at on public.hm_persons;
create trigger hm_persons_set_updated_at
  before update on public.hm_persons
  for each row execute function public.hm_set_updated_at();

-- ------------------------------------------------------------
-- 2. カルテ添付書類(hm_person_files)
-- ------------------------------------------------------------

create table if not exists public.hm_person_files (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.hm_persons(id),
  company_id uuid not null references public.companies(id),
  category text not null default 'other'
    check (category in ('medical_certificate', 'referral', 'checkup_report', 'other')),
  file_name text not null,
  storage_path text not null,
  note text,
  visibility text not null default 'shared'
    check (visibility in ('shared', 'office_only')),
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists hm_person_files_person_idx
  on public.hm_person_files (person_id, created_at desc);

alter table public.hm_person_files enable row level security;

-- 閲覧: office=全て / company=自社かつ共有(shared)のみ
create policy hm_person_files_select on public.hm_person_files
  for select using (
    public.hm_is_office()
    or (
      public.hm_my_role() = 'company'
      and company_id = public.hm_my_company()
      and visibility = 'shared'
    )
  );

-- 追加: office=任意の公開範囲 / company=自社かつsharedのみ
create policy hm_person_files_insert on public.hm_person_files
  for insert with check (
    uploaded_by = auth.uid()
    and (
      public.hm_is_office()
      or (
        public.hm_my_role() = 'company'
        and company_id = public.hm_my_company()
        and visibility = 'shared'
      )
    )
  );

-- 削除: office、またはアップロードした本人(company)
create policy hm_person_files_delete on public.hm_person_files
  for delete using (
    public.hm_is_office()
    or (
      public.hm_my_role() = 'company'
      and company_id = public.hm_my_company()
      and uploaded_by = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 3. 産業医作成文書(hm_person_documents) 診療情報提供依頼書など
-- ------------------------------------------------------------

create table if not exists public.hm_person_documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.hm_persons(id),
  company_id uuid not null references public.companies(id),
  doc_type text not null default 'referral_request'
    check (doc_type in ('referral_request', 'certificate_request', 'other')),
  title text not null,
  addressee text,                    -- 宛先(医療機関名・診療科・医師名)
  body text,
  issued_date date,
  physician_name text,
  visibility text not null default 'office_only'
    check (visibility in ('shared', 'office_only')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hm_person_documents_person_idx
  on public.hm_person_documents (person_id, created_at desc);

alter table public.hm_person_documents enable row level security;

-- 閲覧: office / company(自社かつ共有のみ)
create policy hm_person_documents_select on public.hm_person_documents
  for select using (
    public.hm_is_office()
    or (
      public.hm_my_role() = 'company'
      and company_id = public.hm_my_company()
      and visibility = 'shared'
    )
  );

-- 作成・編集はofficeのみ
create policy hm_person_documents_insert on public.hm_person_documents
  for insert with check (public.hm_is_office() and created_by = auth.uid());

create policy hm_person_documents_update on public.hm_person_documents
  for update using (public.hm_is_office())
  with check (public.hm_is_office());

revoke delete on public.hm_person_documents from anon, authenticated;

drop trigger if exists hm_person_documents_set_updated_at on public.hm_person_documents;
create trigger hm_person_documents_set_updated_at
  before update on public.hm_person_documents
  for each row execute function public.hm_set_updated_at();

-- ------------------------------------------------------------
-- 4. カルテの削除(登録ミス修正用) officeのみ・理由必須・ログ記録
--    添付書類・作成文書も併せて削除される(Storage上の実ファイルは別途)
-- ------------------------------------------------------------

create or replace function public.hm_delete_person(p_id uuid, p_reason text)
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
  perform public.hm_log_access(
    'delete', 'hm_persons', p_id, jsonb_build_object('reason', p_reason)
  );
  delete from public.hm_person_files where person_id = p_id;
  delete from public.hm_person_documents where person_id = p_id;
  delete from public.hm_persons where id = p_id;
  if not found then
    raise exception 'person not found';
  end if;
end;
$$;
