-- ============================================================
-- 0142_hm_consult_reports.sql : 受診勧奨通知のQRコードから本人が受診報告を送る
-- ============================================================
-- 受診勧奨通知書に本人専用のQRコードを印字し、受診後にスマートフォンで読み取って
-- 受診報告(受診日・医療機関・診療科・結果・医師の指示)を送れるようにする。
-- 送信されると、その健診結果の受診勧奨の状態が自動で「受診済」になる。
--
--   ・hm_report_tokens: 本人専用の受付番号(推測できない乱数)。画面からは読めず、RPC経由だけで使う
--   ・hm_consult_reports: 受診報告(実施者と当該企業の担当者が閲覧できる。削除・変更は不可)
--   ・hm_ensure_report_tokens(p_ids): 受付番号を発行する(実施者・書き込みできる事業者担当者)
--   ・hm_report_verify_kind(p_token): ログインなしで呼ぶ。本人確認に何を聞くか
--       ('birth_date' / 'employee_no' / 'name')だけを返し、個人情報は返さない
--   ・hm_report_lookup(p_token, p_answer): 本人確認に合えば氏名・健診日・医師の意見を返す
--   ・hm_report_submit(p_token, p_answer, ...): 報告を保存し、受診勧奨を「受診済」にする
--   受付番号は発行から1年で無効になる。既存テーブル・既存ポリシーは変更しない
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create table if not exists public.hm_report_tokens (
  checkup_id uuid primary key references public.hm_checkups(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

-- 受付番号は画面から直接読めないようにし(権限なし・RLSのみ)、RPC経由だけで使う
alter table public.hm_report_tokens enable row level security;
revoke all on public.hm_report_tokens from anon, authenticated;

create table if not exists public.hm_consult_reports (
  id uuid primary key default gen_random_uuid(),
  checkup_id uuid not null references public.hm_checkups(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  visit_date date,
  facility text,            -- 医療機関名
  department text,          -- 診療科
  result text,              -- 受診結果(異常なし / 経過観察 / 治療開始 など)
  instruction text,         -- 診断名・医師からの指示
  submitted_at timestamptz not null default now()
);

create index if not exists hm_consult_reports_checkup_idx
  on public.hm_consult_reports (checkup_id, submitted_at desc);

alter table public.hm_consult_reports enable row level security;

-- 閲覧: 実施者と、当該企業の担当者。書き込みはRPCのみ(削除・変更は不可)
drop policy if exists hm_consult_reports_select on public.hm_consult_reports;
create policy hm_consult_reports_select on public.hm_consult_reports
  for select using (
    public.hm_is_office() or company_id = public.hm_my_company()
  );

revoke all on public.hm_consult_reports from anon, authenticated;
grant select on public.hm_consult_reports to authenticated;


-- ------------------------------------------------------------
-- 受付番号の発行(通知書を作る画面から)
-- ------------------------------------------------------------
create or replace function public.hm_ensure_report_tokens(p_ids uuid[])
returns table (id uuid, token text)
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_n int;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  select count(distinct c.company_id) into v_n from public.hm_checkups c where c.id = any(p_ids);
  if v_n <> 1 then
    raise exception 'checkups must belong to one company';
  end if;
  select c.company_id into v_company from public.hm_checkups c where c.id = any(p_ids) limit 1;
  if not (public.hm_is_office() or public.hm_company_can_write(v_company)) then
    raise exception 'permission denied';
  end if;

  -- 期限切れ(1年)の受付番号は捨てて発行し直す
  delete from public.hm_report_tokens t
   where t.checkup_id = any(p_ids) and t.created_at < now() - interval '1 year';
  insert into public.hm_report_tokens (checkup_id, token)
  -- 受付番号は UUID(乱数122ビット)の16進32桁。pgcrypto(extensionsスキーマ)に頼らない
  select c.id, replace(gen_random_uuid()::text, '-', '')
    from public.hm_checkups c
   where c.id = any(p_ids)
  on conflict (checkup_id) do nothing;

  perform public.hm_log_access(
    'report_token', 'hm_checkups', null,
    jsonb_build_object('company_id', v_company, 'count', array_length(p_ids, 1))
  );

  return query
    select t.checkup_id, t.token from public.hm_report_tokens t where t.checkup_id = any(p_ids);
end;
$$;

revoke all on function public.hm_ensure_report_tokens(uuid[]) from public;
grant execute on function public.hm_ensure_report_tokens(uuid[]) to authenticated;


-- ------------------------------------------------------------
-- 本人確認の方法(ログインなし)。生年月日があれば生年月日、なければ社員番号、なければ氏名
-- ------------------------------------------------------------
create or replace function public.hm_report_verify_kind(p_token text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v record;
begin
  if p_token is null or length(p_token) <> 32 then
    return 'invalid';
  end if;
  select c.birth_date, c.employee_no, t.created_at into v
    from public.hm_report_tokens t
    join public.hm_checkups c on c.id = t.checkup_id
   where t.token = p_token;
  if not found then
    return 'invalid';
  end if;
  if v.created_at < now() - interval '1 year' then
    return 'expired';
  end if;
  if v.birth_date is not null then
    return 'birth_date';
  elsif v.employee_no is not null and v.employee_no <> '' then
    return 'employee_no';
  else
    return 'name';
  end if;
end;
$$;

revoke all on function public.hm_report_verify_kind(text) from public;
grant execute on function public.hm_report_verify_kind(text) to anon, authenticated;


-- 本人確認(内部用): 受付番号と答えが合えば健診結果の行を返す
create or replace function public.hm_report_resolve(p_token text, p_answer text)
returns public.hm_checkups
language plpgsql security definer
set search_path = public
as $$
declare
  c public.hm_checkups;
  v_ok boolean := false;
  v_answer text := regexp_replace(coalesce(p_answer, ''), '\s', '', 'g');
begin
  if p_token is null or length(p_token) <> 32 then
    raise exception 'invalid token';
  end if;
  select c2.* into c
    from public.hm_report_tokens t
    join public.hm_checkups c2 on c2.id = t.checkup_id
   where t.token = p_token and t.created_at >= now() - interval '1 year';
  if not found then
    raise exception 'invalid token';
  end if;
  if c.birth_date is not null then
    -- 2026-04-01 / 2026/4/1 / 20260401 のいずれでも受け付ける
    v_ok := regexp_replace(v_answer, '[^0-9]', '', 'g') = to_char(c.birth_date, 'YYYYMMDD');
  elsif c.employee_no is not null and c.employee_no <> '' then
    v_ok := v_answer = regexp_replace(c.employee_no, '\s', '', 'g');
  else
    v_ok := v_answer = regexp_replace(c.target_name, '\s', '', 'g');
  end if;
  if not v_ok then
    raise exception 'verification failed';
  end if;
  return c;
end;
$$;

revoke all on function public.hm_report_resolve(text, text) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 本人確認後に表示する内容(氏名・健診日・医師の意見・送信済みの報告)
-- ------------------------------------------------------------
create or replace function public.hm_report_lookup(p_token text, p_answer text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c public.hm_checkups;
  v_company text;
  v_last timestamptz;
begin
  c := public.hm_report_resolve(p_token, p_answer);
  select name into v_company from public.companies where id = c.company_id;
  select max(submitted_at) into v_last from public.hm_consult_reports where checkup_id = c.id;
  return jsonb_build_object(
    'target_name', c.target_name,
    'company_name', v_company,
    'checkup_date', c.checkup_date,
    'work_judgment_note', c.work_judgment_note,
    'last_submitted_at', v_last
  );
end;
$$;

revoke all on function public.hm_report_lookup(text, text) from public;
grant execute on function public.hm_report_lookup(text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 受診報告の送信。受診勧奨の状態を「受診済」にする
-- ------------------------------------------------------------
create or replace function public.hm_report_submit(
  p_token text,
  p_answer text,
  p_visit_date date,
  p_facility text,
  p_department text,
  p_result text,
  p_instruction text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  c public.hm_checkups;
  v_id uuid;
begin
  c := public.hm_report_resolve(p_token, p_answer);
  if p_visit_date is null then
    raise exception 'visit_date required';
  end if;
  if p_result is null or p_result = '' then
    raise exception 'result required';
  end if;

  insert into public.hm_consult_reports (
    checkup_id, company_id, visit_date, facility, department, result, instruction
  ) values (
    c.id, c.company_id, p_visit_date,
    left(nullif(trim(p_facility), ''), 200),
    left(nullif(trim(p_department), ''), 100),
    left(p_result, 100),
    left(nullif(trim(p_instruction), ''), 2000)
  )
  returning id into v_id;

  update public.hm_checkups
     set followup_status = 'done', updated_at = now()
   where id = c.id and coalesce(followup_status, 'none') <> 'done';

  -- ログインなしの操作なので hm_log_access は使わず、user_id なしで記録する
  insert into public.hm_access_logs (user_id, action, target_table, target_id, detail)
  values (null, 'consult_report', 'hm_consult_reports', v_id,
          jsonb_build_object('checkup_id', c.id, 'company_id', c.company_id));

  return v_id;
end;
$$;

revoke all on function public.hm_report_submit(text, text, date, text, text, text, text) from public;
grant execute on function public.hm_report_submit(text, text, date, text, text, text, text) to anon, authenticated;


-- 確認
select * from (
  values
    ('hm_report_tokens',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from information_schema.tables
       where table_schema = 'public' and table_name = 'hm_report_tokens')),
    ('hm_consult_reports',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from information_schema.tables
       where table_schema = 'public' and table_name = 'hm_consult_reports')),
    ('hm_report_submit',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_report_submit'))
) as t(内容, 状態);
