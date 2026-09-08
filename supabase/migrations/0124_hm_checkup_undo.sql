-- ============================================================
-- 0124_hm_checkup_undo.sql : 健康診断管理の取り消し操作
-- ============================================================
--   (1) 就業判定の取り消し(未判定に戻す)  … hm_clear_work_judgment
--   (2) CSV取込のまとまり(バッチ)単位での取り消し
--        - hm_checkups.import_batch_id を追加し、取込ごとに同じIDを付ける
--        - hm_import_checkups は件数とバッチIDを返すよう変更
--        - hm_recent_imports  … 直近の取込の一覧
--        - hm_delete_import_batch … その取込で作成した記録をまとめて削除
--
--   いずれも実施者(office)のみ・監査ログに記録する。
--   健康診断個人票は5年保存が原則のため、削除は取込ミスの修正など
--   正当な理由がある場合に限る(理由を必須とし、ログに残す)。
-- ============================================================


-- ------------------------------------------------------------
-- (1) 就業判定の取り消し
--     判定・判定日・医師の意見をまとめて消し、未判定の状態に戻す
-- ------------------------------------------------------------
create or replace function public.hm_clear_work_judgment(p_ids uuid[])
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
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  update public.hm_checkups
     set work_judgment = null,
         work_judgment_note = null,
         work_judgment_date = null,
         updated_at = now()
   where id = any (p_ids)
     and work_judgment is not null;
  get diagnostics v_count = row_count;

  perform public.hm_log_access(
    'clear_work_judgment', 'hm_checkups', null,
    jsonb_build_object('ids', to_jsonb(p_ids), 'count', v_count)
  );
  return v_count;
end;
$$;

grant execute on function public.hm_clear_work_judgment(uuid[]) to authenticated;


-- ------------------------------------------------------------
-- (2) 取込のまとまりを識別する列
-- ------------------------------------------------------------
alter table public.hm_checkups
  add column if not exists import_batch_id uuid;

create index if not exists hm_checkups_import_batch_idx
  on public.hm_checkups (import_batch_id);


-- ------------------------------------------------------------
-- 取込RPC: バッチIDを付与し、件数とバッチIDを返す
-- (戻り値が int から jsonb に変わるため、作り直す)
-- ------------------------------------------------------------
drop function if exists public.hm_import_checkups(uuid, int, text, text[], jsonb);

create function public.hm_import_checkups(
  p_company_id uuid,
  p_fiscal_year int,
  p_checkup_type text,
  p_findings_judgments text[],
  p_rows jsonb
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
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and p_company_id = public.hm_my_company())
  ) then
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

    -- 事後措置: 総合判定 D 以上のみ受診勧奨、A〜Cは措置不要
    v_needs_followup := v_overall is not null and upper(left(v_overall, 1)) in ('D', 'E');

    insert into public.hm_checkups (
      company_id, person_id, target_user_id, target_name, employee_no, sex, birth_date,
      fiscal_year, checkup_type, checkup_date, overall_judgment,
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
      'count', v_count,
      'batch_id', v_batch
    )
  );
  return jsonb_build_object('count', v_count, 'batch_id', v_batch);
end;
$$;

grant execute on function public.hm_import_checkups(uuid, int, text, text[], jsonb) to authenticated;


-- ------------------------------------------------------------
-- 直近の取込の一覧(取り消しの候補として画面に表示する)
-- ------------------------------------------------------------
create or replace function public.hm_recent_imports(p_company_id uuid, p_limit int default 5)
returns table (
  batch_id uuid,
  imported_at timestamptz,
  fiscal_year int,
  checkup_type text,
  rows_count int,
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
    select c.import_batch_id,
           max(c.created_at),
           min(c.fiscal_year),
           min(c.checkup_type),
           count(*)::int,
           count(*) filter (where c.work_judgment is not null)::int
      from public.hm_checkups c
     where c.company_id = p_company_id
       and c.import_batch_id is not null
     group by c.import_batch_id
     order by max(c.created_at) desc
     limit greatest(coalesce(p_limit, 5), 1);
end;
$$;

grant execute on function public.hm_recent_imports(uuid, int) to authenticated;


-- ------------------------------------------------------------
-- 取込単位での取り消し(その取込で作成した健診記録をまとめて削除)
--   検査項目(hm_checkup_items)は外部キーの連鎖削除で一緒に消える
-- ------------------------------------------------------------
create or replace function public.hm_delete_import_batch(p_batch uuid, p_reason text)
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
  if p_batch is null then
    raise exception 'no batch';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason required';
  end if;

  select count(*) into v_count from public.hm_checkups where import_batch_id = p_batch;

  perform public.hm_log_access(
    'delete_import_batch', 'hm_checkups', null,
    jsonb_build_object('batch_id', p_batch, 'count', v_count, 'reason', p_reason)
  );

  delete from public.hm_checkups where import_batch_id = p_batch;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.hm_delete_import_batch(uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('hm_checkups.import_batch_id(取込のまとまり)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_checkups'
         and column_name = 'import_batch_id')),
    ('hm_clear_work_judgment(就業判定の取り消し)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_clear_work_judgment')),
    ('hm_recent_imports(直近の取込)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_recent_imports')),
    ('hm_delete_import_batch(取込の取り消し)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_delete_import_batch'))
) as t(内容, 状態);
