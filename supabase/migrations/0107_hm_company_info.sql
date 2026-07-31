-- ============================================================
-- 0107_hm_company_info.sql : 企業補足情報(住所等)
-- ============================================================
-- 既存 companies テーブルは変更禁止のため、補足情報を別テーブルで持つ。
-- 診療情報提供依頼書等の文書に「企業名+住所」を記載するために使用。
-- ============================================================

create table if not exists public.hm_company_info (
  company_id uuid primary key references public.companies(id),
  address text,          -- 所在地(文書に記載される)
  tel text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.hm_company_info enable row level security;

create policy hm_company_info_select on public.hm_company_info
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

create policy hm_company_info_insert on public.hm_company_info
  for insert with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

create policy hm_company_info_update on public.hm_company_info
  for update using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  )
  with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

revoke delete on public.hm_company_info from anon, authenticated;

drop trigger if exists hm_company_info_set_updated_at on public.hm_company_info;
create trigger hm_company_info_set_updated_at
  before update on public.hm_company_info
  for each row execute function public.hm_set_updated_at();
