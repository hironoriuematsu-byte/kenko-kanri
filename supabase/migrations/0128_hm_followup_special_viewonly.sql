-- ============================================================
-- 0128_hm_followup_special_viewonly.sql :
--   (1) 閲覧のみの担当者(書き込み不可)への対応
--   (2) 特殊健診の種類(有機溶剤・鉛 など)を記録できるようにする
--   (3) 受診勧奨のフォローアップを画面から扱えるようにする(関数は既存)
-- ============================================================
--
-- (1) ストレスチェックWeb側の profiles.hm_view_only(0020)が true の担当者は、
--     健康管理Webでは閲覧のみとし、登録・編集・取込を行えない。
--     書き込み系の関数は hm_company_can_write() で判定する。
--
-- (2) hm_checkups.special_kind を追加し、取込・個別入力で指定できるようにする。
--     取込関数はこの列を受け取れるよう引数を1つ増やす(省略可)。
--
-- 【前提】ストレスチェックWebの 0020 を先に適用しておく
-- ============================================================


-- ------------------------------------------------------------
-- (1) 閲覧のみの判定と、企業側の書き込み可否
-- ------------------------------------------------------------
create or replace function public.hm_is_view_only()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select hm_view_only from public.profiles where id = auth.uid()),
    false
  )
$$;

-- 指定企業に対して書き込みできるか
--   実施者: 常に可 / 企業担当者: 自社かつ閲覧のみでない場合に可
create or replace function public.hm_company_can_write(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.hm_is_office()
      or (
        public.hm_my_role() = 'company'
        and p_company_id = public.hm_my_company()
        and not public.hm_is_view_only()
      )
$$;

grant execute on function public.hm_is_view_only() to authenticated;
grant execute on function public.hm_company_can_write(uuid) to authenticated;


-- ------------------------------------------------------------
-- (2) 特殊健診の種類
-- ------------------------------------------------------------
alter table public.hm_checkups
  add column if not exists special_kind text;


-- ------------------------------------------------------------
-- 取込関数: 特殊健診の種類を受け取り、閲覧のみの担当者を拒否する
-- (引数が増えるため作り直す。p_special_kind は省略可)
-- ------------------------------------------------------------
drop function if exists public.hm_import_checkups(uuid, int, text, text[], jsonb);

create function public.hm_import_checkups(
  p_company_id uuid,
  p_fiscal_year int,
  p_checkup_type text,
  p_findings_judgments text[],
  p_rows jsonb,
  p_special_kind text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_checkup_id uuid;
  v_count int := 0;
  v_has_findings boolean;
  v_overall text;
  v_needs_followup boolean;
  v_order int;
  v_batch uuid := gen_random_uuid();
begin
  if not public.hm_company_can_write(p_company_id) then
    raise exception 'permission denied';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(v_row ->> 'target_name'), '') = '' then
      continue;
    end if;

    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');

    -- 有所見(既定ではC以上)
    v_has_findings := v_overall = any (coalesce(p_findings_judgments, '{}'));
    if not v_has_findings and v_row ? 'items' then
      select exists (
        select 1 from jsonb_array_elements(v_row -> 'items') it
        where (it ->> 'judgment') = any (coalesce(p_findings_judgments, '{}'))
      ) into v_has_findings;
    end if;

    -- 受診勧奨: 総合判定 D 以上は「受診勧奨」の対象、A〜Cは措置不要
    v_needs_followup := v_overall is not null and upper(left(v_overall, 1)) in ('D', 'E');

    insert into public.hm_checkups (
      company_id, person_id, target_user_id, target_name, employee_no, sex, birth_date,
      fiscal_year, checkup_type, special_kind, checkup_date, overall_judgment,
      has_findings, followup_status, created_by, import_batch_id
    ) values (
      p_company_id,
      nullif(v_row ->> 'person_id', '')::uuid,
      nullif(v_row ->> 'target_user_id', '')::uuid,
      trim(v_row ->> 'target_name'),
      nullif(trim(coalesce(v_row ->> 'employee_no', '')), ''),
      nullif(v_row ->> 'sex', ''),
      nullif(v_row ->> 'birth_date', '')::date,
      p_fiscal_year,
      p_checkup_type,
      case when p_checkup_type = 'special' then nullif(trim(coalesce(p_special_kind, '')), '') end,
      nullif(v_row ->> 'checkup_date', '')::date,
      v_overall,
      v_has_findings,
      case when v_needs_followup then 'pending' else 'none' end,
      auth.uid(),
      v_batch
    ) returning id into v_checkup_id;

    v_order := 0;
    if v_row ? 'items' then
      for v_item in select * from jsonb_array_elements(v_row -> 'items') loop
        if coalesce(trim(v_item ->> 'name'), '') = '' then
          continue;
        end if;
        insert into public.hm_checkup_items (checkup_id, item_name, value, judgment, sort_order)
        values (
          v_checkup_id,
          trim(v_item ->> 'name'),
          nullif(trim(coalesce(v_item ->> 'value', '')), ''),
          nullif(trim(coalesce(v_item ->> 'judgment', '')), ''),
          v_order
        );
        v_order := v_order + 1;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  perform public.hm_log_access(
    'import', 'hm_checkups', null,
    jsonb_build_object(
      'company_id', p_company_id,
      'fiscal_year', p_fiscal_year,
      'checkup_type', p_checkup_type,
      'special_kind', p_special_kind,
      'count', v_count,
      'batch_id', v_batch
    )
  );
  return jsonb_build_object('count', v_count, 'batch_id', v_batch);
end;
$$;

grant execute on function public.hm_import_checkups(uuid, int, text, text[], jsonb, text) to authenticated;


-- ------------------------------------------------------------
-- (3) 受診勧奨の状態変更: 閲覧のみの担当者を拒否する
-- ------------------------------------------------------------
create or replace function public.hm_set_followup(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.hm_checkups where id = p_id;
  if v_company is null then
    raise exception 'checkup not found';
  end if;
  if not public.hm_company_can_write(v_company) then
    raise exception 'permission denied';
  end if;
  if p_status not in ('none', 'pending', 'recommended', 'done') then
    raise exception 'invalid status';
  end if;
  update public.hm_checkups
     set followup_status = p_status,
         followup_note = case when p_note is null then followup_note else nullif(p_note, '') end,
         updated_at = now()
   where id = p_id;
  perform public.hm_log_access(
    'followup', 'hm_checkups', p_id, jsonb_build_object('status', p_status)
  );
end;
$$;

grant execute on function public.hm_set_followup(uuid, text, text) to authenticated;


-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('profiles.hm_view_only(ストレスチェックWeb側 0020)',
     (select case when count(*) > 0 then '✅OK' else '❌先に stres の 0020 を適用してください' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = 'hm_view_only')),
    ('hm_company_can_write(書き込み可否)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_company_can_write')),
    ('hm_checkups.special_kind(特殊健診の種類)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_checkups' and column_name = 'special_kind')),
    ('hm_import_checkups(特殊健診の種類に対応)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_import_checkups'
         and pg_get_function_arguments(p.oid) like '%p_special_kind%'))
) as t(内容, 状態);
