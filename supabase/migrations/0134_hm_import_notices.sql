-- ============================================================
-- 0134_hm_import_notices.sql : 取込の通知(事業者担当者の取込を産業医事務所に知らせる)
-- ============================================================
-- 事業者担当者がCSVを取り込んだとき、産業医事務所のダッシュボードに
-- 「未確認の取込」として表示し、実施者が「確認」を押すまで残す。
--   ・hm_import_notices: 取込ごとに1行(取込ID = hm_checkups.import_batch_id)
--   ・hm_import_checkups: 取込の最後に通知を1行作る(実施者の取込も記録する)
--   ・hm_import_notices_pending(): 未確認の通知の一覧(実施者のみ)。
--       取り消された取込(該当の健診記録が無いもの)は表示しない
--   ・hm_confirm_import_notice(p_batch): 確認済みにする(実施者のみ)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create table if not exists public.hm_import_notices (
  batch_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year int not null,
  round int not null default 1,
  checkup_type text not null,
  special_kind text,
  count int not null default 0,
  merged int not null default 0,
  imported_by uuid,
  imported_by_role text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid
);

-- 直接の読み書きは許可しない(RPC経由のみ)
alter table public.hm_import_notices enable row level security;

create index if not exists hm_import_notices_pending_idx
  on public.hm_import_notices (created_at desc)
  where confirmed_at is null;


-- ------------------------------------------------------------
-- 取込関数(0133 と同じ。最後に通知を作る)
-- ------------------------------------------------------------
create or replace function public.hm_import_checkups(
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
  v_kana text;
  v_dept text;
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
    v_kana := nullif(trim(coalesce(v_row ->> 'target_name_kana', '')), '');
    v_dept := nullif(trim(coalesce(v_row ->> 'department', '')), '');
    v_emp_no := nullif(trim(coalesce(v_row ->> 'employee_no', '')), '');
    v_birth := nullif(v_row ->> 'birth_date', '')::date;
    v_person := nullif(v_row ->> 'person_id', '')::uuid;

    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');
    -- 総合判定が無い行は、項目判定のうち最も重いものを総合判定とみなす
    if v_overall is null and v_row ? 'items' then
      select upper(left(trim(it ->> 'judgment'), 1)) into v_overall
        from jsonb_array_elements(v_row -> 'items') it
       where public.hm_grade_rank(it ->> 'judgment') > 0
       order by public.hm_grade_rank(it ->> 'judgment') desc
       limit 1;
    end if;

    -- 有所見(既定ではC以上)
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
             target_name_kana = coalesce(c.target_name_kana, v_kana),
             department = coalesce(c.department, v_dept),
             person_id = coalesce(c.person_id, v_person),
             target_user_id = coalesce(c.target_user_id, nullif(v_row ->> 'target_user_id', '')::uuid),
             updated_at = now()
       where c.id = v_existing;
      select coalesce(max(sort_order) + 1, 0) into v_order
        from public.hm_checkup_items where checkup_id = v_existing;
      v_merged := v_merged + 1;
    else
      insert into public.hm_checkups (
        company_id, person_id, target_user_id, target_name, target_name_kana, department,
        employee_no, sex, birth_date,
        fiscal_year, round, checkup_type, special_kind, checkup_date, overall_judgment,
        has_findings, followup_status, created_by, import_batch_id
      ) values (
        p_company_id,
        v_person,
        nullif(v_row ->> 'target_user_id', '')::uuid,
        v_name,
        v_kana,
        v_dept,
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
  -- 取込の通知(産業医事務所のダッシュボードに「未確認の取込」として表示する)
  if v_count > 0 then
    insert into public.hm_import_notices (
      batch_id, company_id, fiscal_year, round, checkup_type, special_kind,
      count, merged, imported_by, imported_by_role
    ) values (
      v_batch, p_company_id, p_fiscal_year, v_round, p_checkup_type, v_kind,
      v_count, v_merged, auth.uid(), public.hm_my_role()
    );
  end if;

  return jsonb_build_object('count', v_count, 'merged', v_merged, 'batch_id', v_batch);
end;
$$;

grant execute on function public.hm_import_checkups(uuid, int, text, text[], jsonb, text, boolean, int) to authenticated;


-- ------------------------------------------------------------
-- 未確認の取込の一覧(実施者のみ)
-- ------------------------------------------------------------
create or replace function public.hm_import_notices_pending()
returns table (
  batch_id uuid,
  company_id uuid,
  company_name text,
  fiscal_year int,
  round int,
  checkup_type text,
  special_kind text,
  count int,
  merged int,
  imported_by_name text,
  imported_by_role text,
  created_at timestamptz
)
language sql security definer
set search_path = public
as $$
  select n.batch_id, n.company_id, c.name as company_name,
         n.fiscal_year, n.round, n.checkup_type, n.special_kind,
         n.count, n.merged,
         p.name as imported_by_name, n.imported_by_role, n.created_at
    from public.hm_import_notices n
    join public.companies c on c.id = n.company_id
    left join public.profiles p on p.user_id = n.imported_by
   where public.hm_is_office()
     and n.confirmed_at is null
     -- 取り消された取込(記録が残っていないもの)は出さない
     and exists (select 1 from public.hm_checkups h where h.import_batch_id = n.batch_id)
   order by n.created_at desc;
$$;

grant execute on function public.hm_import_notices_pending() to authenticated;


-- ------------------------------------------------------------
-- 確認済みにする(実施者のみ)
-- ------------------------------------------------------------
create or replace function public.hm_confirm_import_notice(p_batch uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_import_notices
     set confirmed_at = now(), confirmed_by = auth.uid()
   where batch_id = p_batch and confirmed_at is null;
  perform public.hm_log_access(
    'confirm_import', 'hm_import_notices', p_batch, jsonb_build_object('batch_id', p_batch)
  );
end;
$$;

grant execute on function public.hm_confirm_import_notice(uuid) to authenticated;

-- 確認用: true なら完了
-- select exists (
--   select 1 from information_schema.tables where table_name = 'hm_import_notices'
-- ) as "0134 完了";
