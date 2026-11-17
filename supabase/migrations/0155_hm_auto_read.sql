-- ============================================================
-- 0155_hm_auto_read.sql : 健診結果の自動読み取り(AI)と、事務所の基準による就業判定の自動付与
-- ============================================================
-- 事業者担当者・産業医事務所が送ったCSV・PDFを、AIが読み取り、今の判定基準(A〜D・R)で判定して、
-- 就業判定をすぐに返す。読み取りに疑いのある方は「確認待ち」にして、自動では取り込まない。
--
--   ・hm_csv_uploads: 読み取りの状態と結果、ファイルの中身の照合用の値(同じファイルの送り直しに気づく)を持つ
--   ・hm_checkups: 自動で付けた就業判定の印(work_judgment_auto)と、読み取り元(source_upload_id・source_page)
--       医師が就業判定を変えたら、自動の印は外れる(以後、自動では変えない)
--   ・hm_settings: 事務所の設定(PDFの読み取り結果を確認なしで返すか)
--   ・hm_auto_apply: 読み取り結果の登録(取込+就業判定+お知らせ+記録)。サーバーの処理だけが呼べる
--
-- 就業判定の基準(サーバー側で決めて、この関数に渡す):
--   就業制限の検討水準(R)の項目がある → 判定保留(産業医が確認して確定する)
--   総合判定D(要医療)              → 通常勤務可・受診が条件
--   それ以外                        → 通常勤務可
--   特殊健診は自動では判定しない
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- ------------------------------------------------------------
-- 1. 送られたファイルの、読み取りの状態
-- ------------------------------------------------------------
alter table public.hm_csv_uploads add column if not exists file_hash text;
alter table public.hm_csv_uploads add column if not exists uploaded_role text;
alter table public.hm_csv_uploads add column if not exists read_status text not null default 'none';
alter table public.hm_csv_uploads add column if not exists read_work jsonb;        -- 読み取りの途中経過(PDFを分けて読む)
alter table public.hm_csv_uploads add column if not exists read_result jsonb;      -- 読み取りの結果(要約と、確認待ちの方)
alter table public.hm_csv_uploads add column if not exists read_error text;
alter table public.hm_csv_uploads add column if not exists read_updated_at timestamptz;

alter table public.hm_csv_uploads drop constraint if exists hm_csv_uploads_read_status_check;
alter table public.hm_csv_uploads add constraint hm_csv_uploads_read_status_check
  check (read_status in ('none', 'reading', 'review', 'done', 'failed'));

create index if not exists hm_csv_uploads_hash_idx on public.hm_csv_uploads (company_id, file_hash) where file_hash is not null;
create index if not exists hm_csv_uploads_read_idx on public.hm_csv_uploads (read_status) where read_status in ('reading', 'review', 'failed');

-- ------------------------------------------------------------
-- 2. 健診の記録: 自動で付けた就業判定の印と、読み取り元
-- ------------------------------------------------------------
alter table public.hm_checkups add column if not exists work_judgment_auto boolean not null default false;
alter table public.hm_checkups add column if not exists source_upload_id uuid references public.hm_csv_uploads(id) on delete set null;
alter table public.hm_checkups add column if not exists source_page int;

create index if not exists hm_checkups_source_upload_idx on public.hm_checkups (source_upload_id) where source_upload_id is not null;

-- 医師(や担当者)が就業判定を変えたら、自動の印を外す。
-- 自動の登録(hm_auto_apply)の中での変更は、印を付けたままにする
create or replace function public.hm_checkups_clear_auto()
returns trigger
language plpgsql
as $$
begin
  if new.work_judgment_auto
     and coalesce(current_setting('hm.auto', true), '') <> 'on'
     and (new.work_judgment is distinct from old.work_judgment
          or new.work_judgment_note is distinct from old.work_judgment_note
          or new.work_judgment_condition is distinct from old.work_judgment_condition) then
    new.work_judgment_auto := false;
  end if;
  return new;
end;
$$;

drop trigger if exists hm_checkups_clear_auto on public.hm_checkups;
create trigger hm_checkups_clear_auto before update on public.hm_checkups
  for each row execute function public.hm_checkups_clear_auto();

-- ------------------------------------------------------------
-- 3. 事務所の設定
-- ------------------------------------------------------------
create table if not exists public.hm_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.hm_settings enable row level security;
revoke all on public.hm_settings from anon, authenticated;
grant select on public.hm_settings to authenticated;
drop policy if exists hm_settings_select_office on public.hm_settings;
create policy hm_settings_select_office on public.hm_settings for select using (public.hm_is_office());

-- ------------------------------------------------------------
-- 4. 読み取り結果の登録(サーバーの処理だけが呼べる)
--    p_people: [{ mode: 'new' | 'add', existing_id, page, row: {氏名など}, items: [{name, value, judgment}],
--                 wj: { judgment, condition, note } | null }]
--    年度・健診の種類・実施回は、送られたファイルの記録(hm_csv_uploads)のものを使う
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
    v_needs_followup := v_overall is not null and upper(left(v_overall, 1)) in ('D', 'E');

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

-- サーバーの処理(service_role)だけが呼べる
revoke all on function public.hm_auto_apply(uuid, uuid, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.hm_auto_apply(uuid, uuid, text, jsonb, text, jsonb) to service_role;

-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('読み取りの状態(hm_csv_uploads の列)',
     (select case when count(*) = 7 then '✅OK' else '❌未適用' end from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_csv_uploads'
         and column_name in ('file_hash', 'uploaded_role', 'read_status', 'read_work', 'read_result', 'read_error', 'read_updated_at'))),
    ('自動判定の印と読み取り元(hm_checkups の列)',
     (select case when count(*) = 3 then '✅OK' else '❌未適用' end from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_checkups'
         and column_name in ('work_judgment_auto', 'source_upload_id', 'source_page'))),
    ('医師が判定を変えたら自動の印を外す仕組み',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end from pg_trigger where tgname = 'hm_checkups_clear_auto')),
    ('事務所の設定(hm_settings)',
     (select case when to_regclass('public.hm_settings') is not null then '✅OK' else '❌未適用' end)),
    ('読み取り結果の登録(hm_auto_apply)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end from pg_proc where proname = 'hm_auto_apply'))
) as t(項目, 状態);
