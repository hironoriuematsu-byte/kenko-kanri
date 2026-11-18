-- ============================================================
-- 0161_hm_checkup_kinds.sql : 1つのファイルに入っている複数の種類の健診を、種類ごとに分けて登録する
-- ============================================================
-- 健診機関から届くCSV・PDFには、定期健診と特殊健診、有機溶剤と特定化学物質 のように、
-- いくつかの種類の健診結果が一緒に入っていることがある。
-- 自動の読み取りが種類を見分けて、同じ方でも種類ごとに別の記録として登録できるようにする。
--
--   ・hm_auto_apply: 行ごとに「健診種別(checkup_type)」「特殊健診の種類(special_kind)」を指定できる
--       指定のない行は、今までどおりファイルを送るときに選んだ種別・種類で登録する
--       取込のまとまり(取り消しの単位)・お知らせ・記録は、種類ごとに分ける
--   ・hm_auto_apply_sections: この対応が入っていることを、アプリから確かめるための関数
--   ・送るときに選んだ種類は、複数なら「,」区切りで hm_csv_uploads.special_kind に入る(空 = おまかせ)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

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
  v_type text;        -- この行の健診種別(行に指定があればそれ、なければファイルの種別)
  v_rkind text;       -- この行の特殊健診の種類
  v_key text;         -- 区分(種別+種類)の見出し
  v_batches jsonb := '{}'::jsonb;  -- 区分ごとの取込のまとまり(取り消し・お知らせを種類ごとにするため)
  v_b jsonb;
  v_first uuid;
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
  -- ファイルの種類は、1つのときだけそのまま使う(複数「,」区切り・おまかせのときは、行ごとの指定で決まる)
  v_kind := case when u.checkup_type = 'special' and position(',' in coalesce(u.special_kind, '')) = 0
                 then nullif(trim(coalesce(u.special_kind, '')), '') end;
  -- この関数の中での就業判定の変更は、自動の印を付けたままにする
  perform set_config('hm.auto', 'on', true);

  for v_p in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    v_row := v_p -> 'row';
    if trim(coalesce(v_row ->> 'target_name', '')) = '' then
      continue;
    end if;
    -- どの健診の結果として登録するか(1つのファイルに複数の種類が入っているとき、行ごとに指定される)
    v_type := coalesce(nullif(trim(coalesce(v_row ->> 'checkup_type', '')), ''), u.checkup_type);
    if v_type not in ('regular', 'hiring', 'special') then
      raise exception 'invalid checkup type: %', v_type;
    end if;
    v_rkind := case
      when v_type <> 'special' then null
      when v_row ? 'special_kind' then nullif(trim(coalesce(v_row ->> 'special_kind', '')), '')
      else v_kind end;
    v_key := v_type || '|' || coalesce(v_rkind, '');
    if not (v_batches ? v_key) then
      v_batches := v_batches || jsonb_build_object(v_key, jsonb_build_object(
        'batch', case when v_batches = '{}'::jsonb then v_batch else gen_random_uuid() end,
        'type', v_type, 'kind', v_rkind, 'count', 0, 'merged', 0));
    end if;
    v_b := v_batches -> v_key;

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
      v_b := jsonb_set(v_b, '{merged}', to_jsonb((v_b ->> 'merged')::int + 1));
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
        u.fiscal_year, v_round, v_type, v_rkind,
        nullif(v_row ->> 'checkup_date', '')::date,
        v_overall, v_has_findings,
        case when v_needs_followup then 'pending' else 'none' end,
        p_actor, (v_b ->> 'batch')::uuid, p_upload_id, nullif(v_p ->> 'page', '')::int
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
        v_order, (v_b ->> 'batch')::uuid
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
    v_batches := jsonb_set(v_batches, array[v_key], jsonb_set(v_b, '{count}', to_jsonb((v_b ->> 'count')::int + 1)));
  end loop;

  -- 記録とお知らせは、区分(健診種別・特殊健診の種類)ごとに残す
  for v_key, v_b in select key, value from jsonb_each(v_batches) loop
    if (v_b ->> 'count')::int > 0 then
      v_first := coalesce(v_first, (v_b ->> 'batch')::uuid);
      insert into public.hm_access_logs (user_id, action, target_table, target_id, detail, company_id)
      values (p_actor, 'import', 'hm_checkups', null,
        jsonb_build_object('company_id', u.company_id, 'fiscal_year', u.fiscal_year, 'round', v_round,
          'checkup_type', v_b ->> 'type', 'special_kind', v_b ->> 'kind', 'count', (v_b ->> 'count')::int, 'merged', (v_b ->> 'merged')::int,
          'batch_id', v_b ->> 'batch', 'auto', true, 'auto_judged', v_judged, 'upload_id', p_upload_id),
        u.company_id);
      insert into public.hm_import_notices (
        batch_id, company_id, fiscal_year, round, checkup_type, special_kind, count, merged, imported_by, imported_by_role
      ) values (
        (v_b ->> 'batch')::uuid, u.company_id, u.fiscal_year, v_round, v_b ->> 'type', v_b ->> 'kind',
        (v_b ->> 'count')::int, (v_b ->> 'merged')::int, p_actor, p_actor_role
      );
    end if;
  end loop;

  update public.hm_csv_uploads
     set read_status = p_read_status,
         read_result = p_read_result,
         read_work = case when p_read_status in ('done', 'review') then null else read_work end,
         read_error = null,
         read_updated_at = now(),
         status = case when p_read_status = 'done' then 'imported' else status end,
         finished_at = case when p_read_status = 'done' then now() else finished_at end,
         finished_by = case when p_read_status = 'done' then p_actor else finished_by end,
         batch_id = case when v_count > 0 then coalesce(batch_id, v_first, v_batch) else batch_id end
   where id = p_upload_id;

  return jsonb_build_object('count', v_count, 'merged', v_merged, 'judged', v_judged, 'batch_id', coalesce(v_first, v_batch), 'sections', v_batches);
end;
$$;

revoke all on function public.hm_auto_apply(uuid, uuid, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.hm_auto_apply(uuid, uuid, text, jsonb, text, jsonb) to service_role;

-- この対応が入っているか(アプリが、種類ごとに分けて登録する前に確かめる)
create or replace function public.hm_auto_apply_sections()
returns boolean
language sql immutable
as $$ select true $$;
revoke all on function public.hm_auto_apply_sections() from public, anon, authenticated;
grant execute on function public.hm_auto_apply_sections() to service_role;

-- 適用状況
select 項目, 状態 from (
  select 1 as ord, '種類ごとに分けて登録する(hm_auto_apply)' as 項目,
         (select case when count(*) > 0 then '✅OK' else '❌未適用' end from pg_proc
           where proname = 'hm_auto_apply' and prosrc like '%v_batches%') as 状態
  union all
  select 2, 'アプリからの確認用(hm_auto_apply_sections)',
         (select case when count(*) > 0 then '✅OK' else '❌未適用' end from pg_proc where proname = 'hm_auto_apply_sections')
  union all
  select 3, '登録されている特殊健診の種類(件数)',
         coalesce((select string_agg(k || ' ' || n::text || '件', ' / ' order by n desc)
                     from (select coalesce(nullif(trim(special_kind), ''), '(種類未設定)') as k, count(*) as n
                             from public.hm_checkups where checkup_type = 'special' group by 1) t), 'なし')
) t
order by ord;
