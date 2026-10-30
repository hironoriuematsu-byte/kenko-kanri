-- ============================================================
-- 0152_hm_iken_web.sql : 健診結果の医師意見聴取Web(50人未満の事業場向け・Web申込)
-- ============================================================
-- 産業医の選任義務がない事業場(労働者50人未満)向けに、健康診断結果についての
-- 医師の意見聴取(労働安全衛生法第66条の4)を、Webで申し込んでクレジットカードで支払い、
-- 健康管理Webで健診結果を送る → 産業医が就業判定 → 担当者が健康管理Webで確認、の流れで提供する。
--
--   hm_iken_companies : Web申込で登録した事業場(担当者・業務内容)
--   hm_iken_orders    : 申込と支払いの記録(年度の申込 / 件数の追加)。書き込みはサーバー(service_role)のみ
--   hm_iken_plans     : 事業場×年度の意見聴取の件数枠(健診結果1件 = 1名1回の健康診断)
--   hm_iken_jobs      : 健診結果の受付(ファイル1つごと)と返却の記録。返却期限は画面側で営業日から計算する
--
--   hm_iken_provision_order() : 支払い済みにして件数枠を加える(Webhook から。二重に加えない)
--   hm_iken_status()          : 事業場の年度の件数枠と使った件数(担当者・実施者)
--   hm_iken_open_jobs()       : 未返却の受付の一覧(実施者のみ)
--   hm_iken_return()          : 返却済みにする(実施者のみ)
--   hm_iken_report_targets()  : 返却のお知らせメールの送り先(実施者のみ)
--
-- 方針: 追加のみ / hm_ 接頭辞 / SECURITY DEFINER / 既存テーブルは変更しない
-- 前提: 0135・0136(hm_csv_uploads)
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- ------------------------------------------------------------
-- 1. Web申込で登録した事業場
-- ------------------------------------------------------------
create table if not exists public.hm_iken_companies (
  company_id    uuid primary key references public.companies(id) on delete cascade,
  biz_id        text,          -- 登録番号(インボイス)または法人番号の13桁(先頭のTは除く)
  office_name   text not null, -- 事業場名
  office_key    text not null, -- 事業場名を比較用にそろえたもの
  address       text,
  workers       int,
  work_info     text,          -- 業務内容・勤務形態(深夜業・交替制・有害業務など)。意見を述べる医師に提供する情報
  contact_name  text not null,
  contact_email text not null,
  contact_phone text,
  created_at    timestamptz not null default now()
);
alter table public.hm_iken_companies enable row level security;
-- 同じ番号・同じ事業場の二重登録を防ぐ
create unique index if not exists uq_hm_iken_companies_biz_office
  on public.hm_iken_companies (biz_id, office_key) where biz_id is not null;

drop policy if exists hm_iken_companies_read on public.hm_iken_companies;
create policy hm_iken_companies_read on public.hm_iken_companies
  for select to authenticated
  using (public.hm_is_office() or company_id = public.hm_my_company());

-- 業務内容は担当者が後から直せる(それ以外の列はサーバーで登録)
create or replace function public.hm_iken_set_work_info(p_company_id uuid, p_work_info text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (public.hm_is_office() or public.hm_company_can_write(p_company_id)) then
    raise exception 'permission denied';
  end if;
  update public.hm_iken_companies
     set work_info = nullif(trim(left(coalesce(p_work_info, ''), 2000)), '')
   where company_id = p_company_id;
end;
$$;
revoke all on function public.hm_iken_set_work_info(uuid, text) from public, anon;
grant execute on function public.hm_iken_set_work_info(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 2. 申込・支払いの記録
-- ------------------------------------------------------------
create table if not exists public.hm_iken_orders (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('new', 'add')), -- new: 年度の申込 / add: 件数の追加
  status                text not null default 'pending'
                          check (status in ('pending', 'paid', 'expired', 'failed')),
  company_id            uuid not null references public.companies(id) on delete cascade,
  fiscal_year           int not null,
  seats                 int not null check (seats > 0),       -- 申込の件数
  seats_granted         int not null check (seats_granted > 0), -- 付与する件数枠(最低料金の範囲まで付与)
  unit_price            int not null,
  amount                int not null,                          -- 税込
  company_name          text not null,
  contact_name          text not null,
  contact_email         text not null,
  ordered_by            uuid,
  stripe_session_id     text,
  stripe_payment_intent text,
  stripe_invoice_id     text,
  error                 text,
  created_at            timestamptz not null default now(),
  paid_at               timestamptz
);
alter table public.hm_iken_orders enable row level security;
create index if not exists hm_iken_orders_company_idx on public.hm_iken_orders (company_id, created_at desc);

drop policy if exists hm_iken_orders_read on public.hm_iken_orders;
create policy hm_iken_orders_read on public.hm_iken_orders
  for select to authenticated
  using (public.hm_is_office() or company_id = public.hm_my_company());

-- ------------------------------------------------------------
-- 3. 事業場×年度の件数枠
-- ------------------------------------------------------------
create table if not exists public.hm_iken_plans (
  company_id  uuid not null references public.companies(id) on delete cascade,
  fiscal_year int not null,
  seats       int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (company_id, fiscal_year)
);
alter table public.hm_iken_plans enable row level security;

drop policy if exists hm_iken_plans_read on public.hm_iken_plans;
create policy hm_iken_plans_read on public.hm_iken_plans
  for select to authenticated
  using (public.hm_is_office() or company_id = public.hm_my_company());

-- 支払い済みにして件数枠を加える(Webhook から service_role で呼ぶ)。
-- Stripe は同じ通知を再送することがあるので、支払い済みの申込にはもう加えない(already = true)
create or replace function public.hm_iken_provision_order(p_order uuid, p_payment_intent text)
returns table (company_id uuid, fiscal_year int, seats int, already boolean)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  o public.hm_iken_orders%rowtype;
begin
  select * into o from public.hm_iken_orders where id = p_order for update;
  if not found then
    raise exception 'order not found';
  end if;
  if o.status = 'paid' then
    return query select o.company_id, o.fiscal_year,
      (select pl.seats from public.hm_iken_plans pl where pl.company_id = o.company_id and pl.fiscal_year = o.fiscal_year),
      true;
    return;
  end if;
  update public.hm_iken_orders
     set status = 'paid', paid_at = now(), stripe_payment_intent = p_payment_intent, error = null
   where id = o.id;
  insert into public.hm_iken_plans as pl (company_id, fiscal_year, seats)
  values (o.company_id, o.fiscal_year, o.seats_granted)
  on conflict (company_id, fiscal_year)
  do update set seats = pl.seats + excluded.seats, updated_at = now();
  return query select o.company_id, o.fiscal_year,
    (select pl.seats from public.hm_iken_plans pl where pl.company_id = o.company_id and pl.fiscal_year = o.fiscal_year),
    false;
end;
$$;
revoke all on function public.hm_iken_provision_order(uuid, text) from public, anon, authenticated;
grant execute on function public.hm_iken_provision_order(uuid, text) to service_role;

-- 事業場の年度の件数枠と、使った件数(その年度に取り込まれた健診結果の件数。種別を問わない)
create or replace function public.hm_iken_status(p_company_id uuid, p_fiscal_year int)
returns table (seats int, used int)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.hm_is_office() or p_company_id = public.hm_my_company()) then
    raise exception 'permission denied';
  end if;
  return query
    select coalesce((select pl.seats from public.hm_iken_plans pl
                      where pl.company_id = p_company_id and pl.fiscal_year = p_fiscal_year), 0),
           (select count(*)::int from public.hm_checkups c
             where c.company_id = p_company_id and c.fiscal_year = p_fiscal_year);
end;
$$;
revoke all on function public.hm_iken_status(uuid, int) from public, anon;
grant execute on function public.hm_iken_status(uuid, int) to authenticated;

-- ------------------------------------------------------------
-- 4. 健診結果の受付と返却
-- ------------------------------------------------------------
create table if not exists public.hm_iken_jobs (
  id          uuid primary key default gen_random_uuid(),
  upload_id   uuid unique references public.hm_csv_uploads(id) on delete set null,
  company_id  uuid not null references public.companies(id) on delete cascade,
  file_name   text,
  received_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by uuid
);
alter table public.hm_iken_jobs enable row level security;
create index if not exists hm_iken_jobs_open_idx on public.hm_iken_jobs (received_at) where returned_at is null;
create index if not exists hm_iken_jobs_company_idx on public.hm_iken_jobs (company_id, received_at desc);

drop policy if exists hm_iken_jobs_read on public.hm_iken_jobs;
create policy hm_iken_jobs_read on public.hm_iken_jobs
  for select to authenticated
  using (public.hm_is_office() or company_id = public.hm_my_company());

-- Web申込の事業場から健診結果(CSV・PDF)が送られたら、受付を記録する
create or replace function public.hm_iken_on_upload()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.hm_iken_companies ic where ic.company_id = new.company_id) then
    insert into public.hm_iken_jobs (upload_id, company_id, file_name, received_at)
    values (new.id, new.company_id, new.file_name, new.created_at)
    on conflict (upload_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists hm_iken_on_upload on public.hm_csv_uploads;
create trigger hm_iken_on_upload
  after insert on public.hm_csv_uploads
  for each row execute function public.hm_iken_on_upload();

-- 未返却の受付(実施者のみ)
create or replace function public.hm_iken_open_jobs()
returns table (id uuid, company_id uuid, company_name text, file_name text, received_at timestamptz, upload_status text)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  return query
    select j.id, j.company_id, c.name, j.file_name, j.received_at, u.status
      from public.hm_iken_jobs j
      join public.companies c on c.id = j.company_id
      left join public.hm_csv_uploads u on u.id = j.upload_id
     where j.returned_at is null
     order by j.received_at;
end;
$$;
revoke all on function public.hm_iken_open_jobs() from public, anon;
grant execute on function public.hm_iken_open_jobs() to authenticated;

-- 返却済みにする(実施者のみ)。その事業場の未返却の受付をまとめて返却済みにし、件数を返す
create or replace function public.hm_iken_return(p_company_id uuid)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_iken_jobs
     set returned_at = now(), returned_by = auth.uid()
   where company_id = p_company_id and returned_at is null;
  get diagnostics v_count = row_count;
  perform public.hm_log_access('iken_return', 'hm_iken_jobs', null,
    jsonb_build_object('company_id', p_company_id, 'jobs', v_count));
  return v_count;
end;
$$;
revoke all on function public.hm_iken_return(uuid) from public, anon;
grant execute on function public.hm_iken_return(uuid) to authenticated;

-- 返却のお知らせメールの送り先(実施者のみ)。事業者担当者(hm_my_role と同じ判定)と、申込時の担当者
create or replace function public.hm_iken_report_targets(p_company_id uuid)
returns table (name text, email text)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  return query
    select distinct on (lower(t.email)) t.name, t.email
      from (
        select p.name::text as name, u.email::text as email
          from public.profiles p
          join auth.users u on u.id = p.user_id
         where p.company_id = p_company_id
           and u.email is not null
           and (
             p.role = 'company'
             or (coalesce((to_jsonb(p) ->> 'hm_company_access')::boolean, false) and p.role in ('employee', 'jimu'))
           )
        union all
        select ic.contact_name, ic.contact_email
          from public.hm_iken_companies ic
         where ic.company_id = p_company_id
      ) t
     order by lower(t.email), t.name;
end;
$$;
revoke all on function public.hm_iken_report_targets(uuid) from public, anon;
grant execute on function public.hm_iken_report_targets(uuid) to authenticated;


-- ------------------------------------------------------------
-- 5. 権限: 画面からは読み取りのみ(RLSで自社・実施者に限定)。書き込みはRPCとサーバー(service_role)だけ
-- ------------------------------------------------------------
revoke all on public.hm_iken_companies, public.hm_iken_orders, public.hm_iken_plans, public.hm_iken_jobs from anon, authenticated;
grant select on public.hm_iken_companies, public.hm_iken_orders, public.hm_iken_plans, public.hm_iken_jobs to authenticated;
grant all on public.hm_iken_companies, public.hm_iken_orders, public.hm_iken_plans, public.hm_iken_jobs to service_role;


-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('hm_iken_companies', (select case when to_regclass('public.hm_iken_companies') is not null then '✅OK' else '❌未適用' end)),
    ('hm_iken_orders',    (select case when to_regclass('public.hm_iken_orders')    is not null then '✅OK' else '❌未適用' end)),
    ('hm_iken_plans',     (select case when to_regclass('public.hm_iken_plans')     is not null then '✅OK' else '❌未適用' end)),
    ('hm_iken_jobs',      (select case when to_regclass('public.hm_iken_jobs')      is not null then '✅OK' else '❌未適用' end)),
    ('受付のトリガー',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_trigger where tgname = 'hm_iken_on_upload'))
) as t(内容, 状態);
