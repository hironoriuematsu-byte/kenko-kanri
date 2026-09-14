-- ============================================================
-- 0130_hm_checkup_round.sql : 年に複数回の定期健診(実施回)に対応する
-- ============================================================
-- 特定業務従事者など、年に2回(半年に1回)定期健診を行う事業場では、
-- 1回目と2回目を別々に集計・報告する必要がある。
--
-- hm_checkups.round(実施回、既定 1)を追加し、
--   ・取込・個別入力で「1回目 / 2回目 …」を指定できる
--   ・同じ方の記録への統合(0129)は、同じ実施回の中でだけ行う
--   ・一覧・集計・報告書は年度と実施回の組み合わせごとに出す
-- ============================================================

alter table public.hm_checkups
  add column if not exists round smallint not null default 1
  check (round between 1 and 4);

create index if not exists hm_checkups_company_year_round_idx
  on public.hm_checkups (company_id, fiscal_year desc, round);


-- ------------------------------------------------------------
-- 取込関数: 実施回(p_round、既定 1)を受け取る。統合は同じ実施回の中だけ
-- ------------------------------------------------------------
drop function if exists public.hm_import_checkups(uuid, int, text, text[], jsonb, text);
drop function if exists public.hm_import_checkups(uuid, int, text, text[], jsonb, text, boolean);
drop function if exists public.hm_import_checkups(uuid, int, text, text[], jsonb, text, boolean, int);

create function public.hm_import_checkups(
  p_company_id uuid,
  p_fiscal_year int,
  p_checkup_type text,
  p_findings_judgments text[],
  p_rows jsonb,
  p_special_kind text default null,
  p_merge boolean default true,
  p_round int default 1
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_checkup_id uuid;
  v_existing uuid;
  v_count int := 0;
  v_merged int := 0;
  v_has_findings boolean;
  v_overall text;
  v_needs_followup boolean;
  v_order int;
  v_batch uuid := gen_random_uuid();
  v_name text;
  v_emp_no text;
  v_birth date;
  v_person uuid;
  v_kind text;
  v_round int := greatest(1, least(4, coalesce(p_round, 1)));
begin
  if not public.hm_company_can_write(p_company_id) then
    raise exception 'permission denied';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows';
  end if;

  v_kind := case when p_checkup_type = 'special'
                 then nullif(trim(coalesce(p_special_kind, '')), '') end;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_name := trim(coalesce(v_row ->> 'target_name', ''));
    if v_name = '' then
      continue;
    end if;
    v_emp_no := nullif(trim(coalesce(v_row ->> 'employee_no', '')), '');
    v_birth := nullif(v_row ->> 'birth_date', '')::date;
    v_person := nullif(v_row ->> 'person_id', '')::uuid;

    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');
    -- 総合判定が無い行は、項目判定のうち最も重いものを総合判定とみなす
    -- (別機関の血液検査だけのCSVを統合するときに、総合判定へ反映させるため)
    if v_overall is null and v_row ? 'items' then
      select upper(left(trim(it ->> 'judgment'), 1)) into v_overall
        from jsonb_array_elements(v_row -> 'items') it
       where public.hm_grade_rank(it ->> 'judgment') > 0
       order by public.hm_grade_rank(it ->> 'judgment') desc
       limit 1;
    end if;

    -- 有所見(既定ではC以上)。総合判定が無い行でも null にならないようにする
    v_has_findings := coalesce(v_overall = any (coalesce(p_findings_judgments, '{}')), false);
    if not v_has_findings and v_row ? 'items' then
      select exists (
        select 1 from jsonb_array_elements(v_row -> 'items') it
        where (it ->> 'judgment') = any (coalesce(p_findings_judgments, '{}'))
      ) into v_has_findings;
    end if;

    -- 受診勧奨: 総合判定 D 以上は「受診勧奨」の対象
    v_needs_followup := v_overall is not null and upper(left(v_overall, 1)) in ('D', 'E');

    -- 同じ企業・年度・実施回・種別に同じ方の記録があるか
    v_existing := null;
    if p_merge then
      select c.id into v_existing
        from public.hm_checkups c
       where c.company_id = p_company_id
         and c.fiscal_year = p_fiscal_year
         and c.round = v_round
         and c.checkup_type = p_checkup_type
         and coalesce(c.special_kind, '') = coalesce(v_kind, '')
         and (
           (v_person is not null and c.person_id = v_person)
           or (v_emp_no is not null and c.employee_no = v_emp_no and c.target_name = v_name)
           or (v_birth is not null and c.birth_date = v_birth and c.target_name = v_name)
         )
       order by c.created_at
       limit 1;
    end if;

    if v_existing is not null then
      v_checkup_id := v_existing;
      update public.hm_checkups c
         set overall_judgment = case
               when public.hm_grade_rank(v_overall) > public.hm_grade_rank(c.overall_judgment)
                 then v_overall else c.overall_judgment end,
             has_findings = c.has_findings or v_has_findings,
             followup_status = case
               when v_needs_followup and c.followup_status = 'none' then 'pending'
               else c.followup_status end,
             checkup_date = coalesce(c.checkup_date, nullif(v_row ->> 'checkup_date', '')::date),
             sex = coalesce(c.sex, nullif(v_row ->> 'sex', '')),
             birth_date = coalesce(c.birth_date, v_birth),
             employee_no = coalesce(c.employee_no, v_emp_no),
             person_id = coalesce(c.person_id, v_person),
             target_user_id = coalesce(c.target_user_id, nullif(v_row ->> 'target_user_id', '')::uuid),
             updated_at = now()
       where c.id = v_existing;
      select coalesce(max(sort_order) + 1, 0) into v_order
        from public.hm_checkup_items where checkup_id = v_existing;
      v_merged := v_merged + 1;
    else
      insert into public.hm_checkups (
        company_id, person_id, target_user_id, target_name, employee_no, sex, birth_date,
        fiscal_year, round, checkup_type, special_kind, checkup_date, overall_judgment,
        has_findings, followup_status, created_by, import_batch_id
      ) values (
        p_company_id,
        v_person,
        nullif(v_row ->> 'target_user_id', '')::uuid,
        v_name,
        v_emp_no,
        nullif(v_row ->> 'sex', ''),
        v_birth,
        p_fiscal_year,
        v_round,
        p_checkup_type,
        v_kind,
        nullif(v_row ->> 'checkup_date', '')::date,
        v_overall,
        v_has_findings,
        case when v_needs_followup then 'pending' else 'none' end,
        auth.uid(),
        v_batch
      ) returning id into v_checkup_id;
      v_order := 0;
    end if;

    if v_row ? 'items' then
      for v_item in select * from jsonb_array_elements(v_row -> 'items') loop
        if coalesce(trim(v_item ->> 'name'), '') = '' then
          continue;
        end if;
        insert into public.hm_checkup_items (checkup_id, item_name, value, judgment, sort_order, import_batch_id)
        values (
          v_checkup_id,
          trim(v_item ->> 'name'),
          nullif(trim(coalesce(v_item ->> 'value', '')), ''),
          nullif(trim(coalesce(v_item ->> 'judgment', '')), ''),
          v_order,
          v_batch
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
      'round', v_round,
      'checkup_type', p_checkup_type,
      'special_kind', p_special_kind,
      'count', v_count,
      'merged', v_merged,
      'batch_id', v_batch
    )
  );
  return jsonb_build_object('count', v_count, 'merged', v_merged, 'batch_id', v_batch);
end;
$$;

grant execute on function public.hm_import_checkups(uuid, int, text, text[], jsonb, text, boolean, int) to authenticated;


-- ------------------------------------------------------------
-- 直近の取込の一覧: 実施回も返す(戻り値の列が増えるため作り直す)
-- ------------------------------------------------------------
drop function if exists public.hm_recent_imports(uuid, int);

create function public.hm_recent_imports(p_company_id uuid, p_limit int default 5)
returns table (
  batch_id uuid,
  imported_at timestamptz,
  fiscal_year int,
  round int,
  checkup_type text,
  rows_count int,
  merged_count int,
  judged_count int
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and p_company_id = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;

  return query
    with created as (
      select c.import_batch_id as bid,
             max(c.created_at) as at,
             min(c.fiscal_year) as fy,
             min(c.round)::int as rd,
             min(c.checkup_type) as ct,
             count(*)::int as n,
             count(*) filter (where c.work_judgment is not null)::int as judged
        from public.hm_checkups c
       where c.company_id = p_company_id and c.import_batch_id is not null
       group by c.import_batch_id
    ),
    merged as (
      select i.import_batch_id as bid,
             max(i.created_at) as at,
             min(c.fiscal_year) as fy,
             min(c.round)::int as rd,
             min(c.checkup_type) as ct,
             count(distinct i.checkup_id)::int as n
        from public.hm_checkup_items i
        join public.hm_checkups c on c.id = i.checkup_id
       where c.company_id = p_company_id
         and i.import_batch_id is not null
         and (c.import_batch_id is null or c.import_batch_id <> i.import_batch_id)
       group by i.import_batch_id
    )
    select coalesce(cr.bid, m.bid),
           greatest(coalesce(cr.at, m.at), coalesce(m.at, cr.at)),
           coalesce(cr.fy, m.fy),
           coalesce(cr.rd, m.rd),
           coalesce(cr.ct, m.ct),
           coalesce(cr.n, 0),
           coalesce(m.n, 0),
           coalesce(cr.judged, 0)
      from created cr
      full join merged m on m.bid = cr.bid
     order by 2 desc
     limit greatest(coalesce(p_limit, 5), 1);
end;
$$;

grant execute on function public.hm_recent_imports(uuid, int) to authenticated;


-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('hm_checkups.round(実施回)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_checkups' and column_name = 'round')),
    ('hm_import_checkups(実施回に対応)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_import_checkups'
         and pg_get_function_arguments(p.oid) like '%p_round%')),
    ('hm_recent_imports(実施回を表示)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_recent_imports'
         and pg_get_function_result(p.oid) like '%round%'))
) as t(内容, 状態);
