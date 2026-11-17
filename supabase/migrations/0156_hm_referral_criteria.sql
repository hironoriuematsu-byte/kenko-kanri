-- ============================================================
-- 0156_hm_referral_criteria.sql : 受診勧奨の基準(事務所基準)を、要医療(D)の判定と分ける
-- ============================================================
-- これまでは、総合判定が要医療(D)であれば、そのまま受診勧奨(事後措置)と「受診が条件」(就業判定)の対象にしていた。
-- 要医療(D)の判定はそのままにして、受診勧奨と「受診が条件」だけを、より緩い事務所の基準で決められるようにする。
--
--   ・判定基準(hm_judgment_rules)に、区分「S = 受診勧奨の基準」を追加する。
--       要医療(D)と判定された項目のうち、S の基準に届いたものだけを受診勧奨の対象にする。
--       S の行がない項目は、これまでどおり、要医療(D)であれば受診勧奨の対象。
--   ・γ-GTP の受診勧奨の基準を 201 以上(200 を超える)として登録する(要医療(D)は 101 以上のまま)。
--   ・取込(hm_import_checkups)・判定の再計算(hm_apply_judgments)・自動の読み取り(hm_auto_apply)が、
--       画面・サーバー側で S の基準に照らした結果(needs_followup)を受け取って、受診勧奨の状態を決める。
--       結果が渡されないとき(古い画面)は、これまでどおり総合判定 D 以上で決める。
--   ・再計算で受診勧奨の基準に届かなくなった方は、受診勧奨を「措置不要」に戻し、「受診が条件」も外す
--       (勧奨済・受診済の方は変えない)。
--
-- すでに取り込んだ結果に反映するには、このSQLのあと、健康診断管理の「判定を再計算（事務所基準）」を押す。
-- 【前提】0155 を先に実行しておく
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- ------------------------------------------------------------
-- 1. 判定基準に「S = 受診勧奨の基準」を追加
-- ------------------------------------------------------------
alter table public.hm_judgment_rules drop constraint if exists hm_judgment_rules_grade_check;
alter table public.hm_judgment_rules add constraint hm_judgment_rules_grade_check
  check (grade in ('B', 'C', 'D', 'R', 'S'));

-- γ-GTP: 受診勧奨は 201 以上(すでに S の行があれば、何もしない。画面で変えた値を上書きしない)
insert into public.hm_judgment_rules (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
select 'ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'S', 201, null, null, 9
 where not exists (select 1 from public.hm_judgment_rules where item_key = 'ggt' and grade = 'S');

-- ------------------------------------------------------------
-- 2. 取込(手作業の取込画面)
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

    -- 受診勧奨: 画面側で「受診勧奨の基準(事務所基準)」に照らした結果(needs_followup)が渡されていれば、それを使う。
    -- 渡されていなければ、これまでどおり総合判定 D 以上を対象にする
    v_needs_followup := case
      when v_row ? 'needs_followup' then coalesce((v_row ->> 'needs_followup')::boolean, false)
      else v_overall is not null and upper(left(v_overall, 1)) in ('D', 'E') end;

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
             -- 再取込で健診日・性別・生年月日が指定されていれば、新しい値で更新する(空のときだけ元の値を残す)
             checkup_date = coalesce(nullif(v_row ->> 'checkup_date', '')::date, c.checkup_date),
             sex = coalesce(nullif(v_row ->> 'sex', ''), c.sex),
             birth_date = coalesce(v_birth, c.birth_date),
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

-- ------------------------------------------------------------
-- 3. 判定の再計算
-- ------------------------------------------------------------
create or replace function public.hm_apply_judgments(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_count int := 0;
  v_reset int := 0;
  v_overall text;
  v_id uuid;
  v_prev_overall text;
  v_work text;
  v_condition text;
  v_became_severe boolean;
  v_flag boolean;      -- 受診勧奨の対象か(画面側で事務所基準に照らした結果)。渡されていなければ null
  v_need boolean;      -- 受診勧奨の状態を合わせる先(null は変えない)
  v_followup text;
  v_cleared int := 0;  -- 受診勧奨の対象から外した人数
  v_added int := 0;    -- 受診勧奨の対象にした人数
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_id := (v_row ->> 'checkup_id')::uuid;

    -- 検査項目の判定
    if v_row ? 'items' then
      for v_item in select * from jsonb_array_elements(v_row -> 'items') loop
        update public.hm_checkup_items
           set judgment = nullif(trim(coalesce(v_item ->> 'judgment', '')), '')
         where id = (v_item ->> 'id')::uuid;
      end loop;
    end if;

    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');

    select overall_judgment, work_judgment, work_judgment_condition, followup_status
      into v_prev_overall, v_work, v_condition, v_followup
      from public.hm_checkups where id = v_id;

    -- 受診勧奨の対象か。画面側の結果(needs_followup)があればそれを使い、無ければ総合判定 D 以上で決める
    v_flag := case when v_row ? 'needs_followup' then coalesce((v_row ->> 'needs_followup')::boolean, false) end;
    v_need := coalesce(v_flag, case when v_overall is null then null else upper(left(v_overall, 1)) in ('D', 'E') end);

    -- D 未満 → D(E) に上がったか(受診勧奨の基準に届かない方は、通常勤務可のままでよいので含めない)
    v_became_severe :=
      v_overall is not null
      and upper(left(v_overall, 1)) in ('D', 'E')
      and (v_prev_overall is null or upper(left(v_prev_overall, 1)) not in ('D', 'E'))
      and coalesce(v_flag, true);

    -- 総合判定・有所見(指定があるときのみ更新する)。
    -- 受診勧奨の状態は総合判定に合わせる(取込時の既定と同じ規則。勧奨済・受診済は変えない)。
    -- D に上がった方で就業判定が「通常勤務可」(判定条件なし)なら「判定保留」に戻して再判定を促す
    update public.hm_checkups
       set overall_judgment = coalesce(v_overall, overall_judgment),
           has_findings = coalesce((v_row ->> 'has_findings')::boolean, has_findings),
           followup_status = case
             when v_need is null then followup_status
             when v_need and followup_status = 'none' then 'pending'
             when not v_need and followup_status = 'pending' then 'none'
             else followup_status end,
           -- 受診勧奨の基準に届かなくなった方は、「受診が条件」も外す(勧奨済・受診済の方は変えない)
           work_judgment_condition = case
             when v_flag = false and followup_status in ('none', 'pending')
                  and work_judgment = 'normal' and work_judgment_condition = 'consult' then null
             else work_judgment_condition end,
           work_judgment = case
             when v_became_severe and v_work = 'normal' and v_condition is null then 'pending'
             else work_judgment end,
           updated_at = now()
     where id = v_id;

    if v_became_severe and v_work = 'normal' and v_condition is null then
      v_reset := v_reset + 1;
      perform public.hm_log_access(
        'reset_work_judgment', 'hm_checkups', v_id,
        jsonb_build_object('reason', 'recompute_became_severe', 'from', v_prev_overall, 'to', v_overall)
      );
    end if;

    if v_need is not null and v_need and v_followup = 'none' then
      v_added := v_added + 1;
    elsif v_need is not null and not v_need and v_followup = 'pending' then
      v_cleared := v_cleared + 1;
    end if;

    v_count := v_count + 1;
  end loop;

  perform public.hm_log_access(
    'recompute_judgments', 'hm_checkups', null,
    jsonb_build_object('count', v_count, 'reset_pending', v_reset, 'followup_cleared', v_cleared, 'followup_added', v_added)
  );
  return jsonb_build_object('count', v_count, 'reset_pending', v_reset, 'followup_cleared', v_cleared, 'followup_added', v_added);
end;
$$;

-- ------------------------------------------------------------
-- 4. 自動の読み取り(AI)の登録
-- ------------------------------------------------------------
create or replace function public.hm_auto_apply(
  p_upload_id uuid,
  p_actor uuid,
  p_actor_role text,
  p_people jsonb,
  p_read_status text,
  p_read_result jsonb
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  u public.hm_csv_uploads%rowtype;
  v_p jsonb;
  v_row jsonb;
  v_item jsonb;
  v_wj jsonb;
  v_id uuid;
  v_batch uuid := gen_random_uuid();
  v_count int := 0;
  v_merged int := 0;
  v_judged int := 0;
  v_order int;
  v_overall text;
  v_has_findings boolean;
  v_needs_followup boolean;
  v_round int;
  v_kind text;
  v_findings text[] := array['C', 'D', 'E', 'R'];
begin
  select * into u from public.hm_csv_uploads where id = p_upload_id for update;
  if not found then
    raise exception 'upload not found';
  end if;
  if u.fiscal_year is null or u.checkup_type is null then
    raise exception 'upload has no fiscal year / checkup type';
  end if;
  v_round := greatest(1, least(4, coalesce(u.round, 1)));
  v_kind := case when u.checkup_type = 'special' then nullif(trim(coalesce(u.special_kind, '')), '') end;
  -- この関数の中での就業判定の変更は、自動の印を付けたままにする
  perform set_config('hm.auto', 'on', true);

  for v_p in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    v_row := v_p -> 'row';
    if trim(coalesce(v_row ->> 'target_name', '')) = '' then
      continue;
    end if;
    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');
    if v_overall is null and v_p ? 'items' then
      select upper(left(trim(it ->> 'judgment'), 1)) into v_overall
        from jsonb_array_elements(v_p -> 'items') it
       where public.hm_grade_rank(it ->> 'judgment') > 0
       order by public.hm_grade_rank(it ->> 'judgment') desc
       limit 1;
    end if;
    v_has_findings := coalesce(v_overall = any (v_findings), false)
      or exists (select 1 from jsonb_array_elements(coalesce(v_p -> 'items', '[]'::jsonb)) it
                  where upper(left(trim(coalesce(it ->> 'judgment', '')), 1)) = any (v_findings));
    -- 受診勧奨: サーバー側で「受診勧奨の基準(事務所基準)」に照らした結果が渡されていれば、それを使う
    v_needs_followup := case
      when v_p ? 'needs_followup' then coalesce((v_p ->> 'needs_followup')::boolean, false)
      else v_overall is not null and upper(left(v_overall, 1)) in ('D', 'E') end;

    if v_p ->> 'mode' = 'add' then
      -- すでにある記録に、項目を足す
      v_id := (v_p ->> 'existing_id')::uuid;
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
             birth_date = coalesce(c.birth_date, nullif(v_row ->> 'birth_date', '')::date),
             person_id = coalesce(c.person_id, nullif(v_row ->> 'person_id', '')::uuid),
             target_user_id = coalesce(c.target_user_id, nullif(v_row ->> 'target_user_id', '')::uuid),
             updated_at = now()
       where c.id = v_id and c.company_id = u.company_id;
      if not found then
        raise exception 'existing checkup not found';
      end if;
      select coalesce(max(sort_order) + 1, 0) into v_order from public.hm_checkup_items where checkup_id = v_id;
      v_merged := v_merged + 1;
    else
      insert into public.hm_checkups (
        company_id, person_id, target_user_id, target_name, target_name_kana, department,
        employee_no, sex, birth_date,
        fiscal_year, round, checkup_type, special_kind, checkup_date, overall_judgment,
        has_findings, followup_status, created_by, import_batch_id, source_upload_id, source_page
      ) values (
        u.company_id,
        nullif(v_row ->> 'person_id', '')::uuid,
        nullif(v_row ->> 'target_user_id', '')::uuid,
        trim(v_row ->> 'target_name'),
        nullif(trim(coalesce(v_row ->> 'target_name_kana', '')), ''),
        nullif(trim(coalesce(v_row ->> 'department', '')), ''),
        nullif(trim(coalesce(v_row ->> 'employee_no', '')), ''),
        nullif(v_row ->> 'sex', ''),
        nullif(v_row ->> 'birth_date', '')::date,
        u.fiscal_year, v_round, u.checkup_type, v_kind,
        nullif(v_row ->> 'checkup_date', '')::date,
        v_overall, v_has_findings,
        case when v_needs_followup then 'pending' else 'none' end,
        p_actor, v_batch, p_upload_id, nullif(v_p ->> 'page', '')::int
      ) returning id into v_id;
      v_order := 0;
    end if;

    for v_item in select * from jsonb_array_elements(coalesce(v_p -> 'items', '[]'::jsonb)) loop
      if coalesce(trim(v_item ->> 'name'), '') = '' then
        continue;
      end if;
      insert into public.hm_checkup_items (checkup_id, item_name, value, judgment, sort_order, import_batch_id)
      values (
        v_id,
        trim(v_item ->> 'name'),
        nullif(trim(coalesce(v_item ->> 'value', '')), ''),
        nullif(trim(coalesce(v_item ->> 'judgment', '')), ''),
        v_order, v_batch
      );
      v_order := v_order + 1;
    end loop;

    -- 就業判定(事務所の基準)。医師がすでに判定している方は変えない
    v_wj := v_p -> 'wj';
    if v_wj is not null and jsonb_typeof(v_wj) = 'object' and (v_wj ->> 'judgment') in ('normal', 'pending') then
      update public.hm_checkups c
         set work_judgment = v_wj ->> 'judgment',
             work_judgment_condition = case when v_wj ->> 'judgment' = 'normal' and v_wj ->> 'condition' = 'consult' then 'consult' end,
             work_judgment_note = nullif(v_wj ->> 'note', ''),
             work_judgment_date = current_date,
             work_judgment_auto = true,
             updated_at = now()
       where c.id = v_id and (c.work_judgment is null or c.work_judgment_auto);
      if found then
        v_judged := v_judged + 1;
      end if;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.hm_access_logs (user_id, action, target_table, target_id, detail, company_id)
    values (p_actor, 'import', 'hm_checkups', null,
      jsonb_build_object('company_id', u.company_id, 'fiscal_year', u.fiscal_year, 'round', v_round,
        'checkup_type', u.checkup_type, 'special_kind', v_kind, 'count', v_count, 'merged', v_merged,
        'batch_id', v_batch, 'auto', true, 'auto_judged', v_judged, 'upload_id', p_upload_id),
      u.company_id);
    insert into public.hm_import_notices (
      batch_id, company_id, fiscal_year, round, checkup_type, special_kind, count, merged, imported_by, imported_by_role
    ) values (
      v_batch, u.company_id, u.fiscal_year, v_round, u.checkup_type, v_kind, v_count, v_merged, p_actor, p_actor_role
    );
  end if;

  update public.hm_csv_uploads
     set read_status = p_read_status,
         read_result = p_read_result,
         read_work = case when p_read_status in ('done', 'review') then null else read_work end,
         read_error = null,
         read_updated_at = now(),
         status = case when p_read_status = 'done' then 'imported' else status end,
         finished_at = case when p_read_status = 'done' then now() else finished_at end,
         finished_by = case when p_read_status = 'done' then p_actor else finished_by end,
         batch_id = case when v_count > 0 then coalesce(batch_id, v_batch) else batch_id end
   where id = p_upload_id;

  return jsonb_build_object('count', v_count, 'merged', v_merged, 'judged', v_judged, 'batch_id', v_batch);
end;
$$;

revoke all on function public.hm_auto_apply(uuid, uuid, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.hm_auto_apply(uuid, uuid, text, jsonb, text, jsonb) to service_role;

-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('判定基準に「受診勧奨の基準(S)」を登録できる',
     (select case when pg_get_constraintdef(oid) like '%''S''%' then '✅OK' else '❌未適用' end
        from pg_constraint where conname = 'hm_judgment_rules_grade_check')),
    ('γ-GTP の受診勧奨の基準',
     (select coalesce((select '✅ ' || min_value::text || ' 以上' from public.hm_judgment_rules where item_key = 'ggt' and grade = 'S' limit 1), '❌未登録'))),
    ('γ-GTP の要医療(D)の基準(変更なし)',
     (select coalesce((select min_value::text || ' 以上' from public.hm_judgment_rules where item_key = 'ggt' and grade = 'D' limit 1), '(未登録)'))),
    ('取込・再計算・自動読み取りが受診勧奨の基準を受け取る',
     (select case when count(*) = 3 then '✅OK' else '❌未適用' end from pg_proc
       where proname in ('hm_import_checkups', 'hm_apply_judgments', 'hm_auto_apply') and prosrc like '%needs_followup%'))
) as t(項目, 状態);
