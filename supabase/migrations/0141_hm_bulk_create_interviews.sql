-- ============================================================
-- 0141_hm_bulk_create_interviews.sql : 通知書の画面から産業医面談をまとめて登録する
-- ============================================================
-- 「産業医面談通知」のタブで選んだ従業員について、面談日を決めて
-- 産業医面談管理(hm_interviews)に予定をまとめて登録する。
--   ・hm_interviews.checkup_id を追加し、どの健診結果から登録した面談かを持つ
--     (同じ健診結果から二重に登録しない目安にする)
--   ・hm_bulk_create_interviews(p_checkup_ids, p_scheduled_date, p_method, p_location):
--       実施者、または書き込みできる事業者担当者(hm_company_can_write)が実行できる。
--       健診結果ごとに:
--         - 同じ健診結果からの面談(中止以外)がすでにあれば登録しない(skipped)
--         - カルテ(hm_persons)に紐付いていなければ、社員番号 → 氏名+生年月日 → 氏名(一意)
--           の順で探し、なければ作って紐付ける
--         - 面談種別「健診事後措置面談」・状態「予定」で登録する
--       戻り値: {"created": n, "skipped": n, "ids": [...]}
--   ・既存テーブル・既存ポリシーは変更しない(列の追加と関数の追加のみ)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_interviews
  add column if not exists checkup_id uuid references public.hm_checkups(id);

create index if not exists hm_interviews_checkup_idx
  on public.hm_interviews (checkup_id);

-- 列単位GRANT: 公開してよい列として checkup_id を読める・書けるようにする
grant select (checkup_id), insert (checkup_id), update (checkup_id)
  on public.hm_interviews to authenticated;

create or replace function public.hm_bulk_create_interviews(
  p_checkup_ids uuid[],
  p_scheduled_date date,
  p_method text default null,
  p_location text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_checkup record;
  v_person_id uuid;
  v_user_id uuid;
  v_interview_id uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_ids uuid[] := '{}';
  v_company uuid;
begin
  if p_checkup_ids is null or array_length(p_checkup_ids, 1) is null then
    return jsonb_build_object('created', 0, 'skipped', 0, 'ids', '[]'::jsonb);
  end if;
  if p_method is not null and p_method not in ('in_person', 'online', 'phone') then
    raise exception 'invalid method';
  end if;

  -- 1回の呼び出しは1企業分に限る(権限の確認を企業単位で行う)
  select count(distinct company_id) into v_created
    from public.hm_checkups where id = any(p_checkup_ids);
  if v_created <> 1 then
    raise exception 'checkups must belong to one company';
  end if;
  v_created := 0;
  select company_id into v_company
    from public.hm_checkups where id = any(p_checkup_ids) limit 1;

  if not (public.hm_is_office() or public.hm_company_can_write(v_company)) then
    raise exception 'permission denied';
  end if;

  for v_checkup in
    select id, company_id, person_id, target_user_id, target_name, employee_no, birth_date
      from public.hm_checkups
     where id = any(p_checkup_ids)
     order by employee_no nulls last, target_name
  loop
    -- 同じ健診結果からの面談(中止以外)がすでにあれば登録しない
    if exists (
      select 1 from public.hm_interviews
       where checkup_id = v_checkup.id and status <> 'cancelled'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- カルテへの紐付け(社員番号 → 氏名+生年月日 → 氏名が一意 → 新規作成)
    v_person_id := v_checkup.person_id;
    if v_person_id is null and v_checkup.employee_no is not null and v_checkup.employee_no <> '' then
      select id into v_person_id from public.hm_persons
       where company_id = v_checkup.company_id and employee_no = v_checkup.employee_no
       limit 1;
    end if;
    if v_person_id is null and v_checkup.birth_date is not null then
      select id into v_person_id from public.hm_persons
       where company_id = v_checkup.company_id
         and full_name = v_checkup.target_name
         and birth_date = v_checkup.birth_date
       limit 1;
    end if;
    if v_person_id is null then
      select min(id::text)::uuid into v_person_id from public.hm_persons
       where company_id = v_checkup.company_id and full_name = v_checkup.target_name
      having count(*) = 1;
    end if;
    if v_person_id is null then
      insert into public.hm_persons (company_id, full_name, employee_no, birth_date, created_by)
      values (v_checkup.company_id, v_checkup.target_name,
              nullif(v_checkup.employee_no, ''), v_checkup.birth_date, auth.uid())
      returning id into v_person_id;
      perform public.hm_log_access(
        'create', 'hm_persons', v_person_id,
        jsonb_build_object('auto_created_from', 'bulk_interview', 'checkup_id', v_checkup.id)
      );
    end if;
    if v_checkup.person_id is null then
      update public.hm_checkups set person_id = v_person_id where id = v_checkup.id;
    end if;

    select user_id into v_user_id from public.hm_persons where id = v_person_id;

    insert into public.hm_interviews (
      company_id, person_id, target_user_id, target_name, interview_type,
      scheduled_at, method, location, status, checkup_id, created_by
    ) values (
      v_checkup.company_id, v_person_id, coalesce(v_user_id, v_checkup.target_user_id),
      v_checkup.target_name, 'checkup_followup',
      -- 日付のみを扱う(正午にしてタイムゾーンによる日付ずれを防ぐ)
      (p_scheduled_date::timestamp + interval '12 hours') at time zone 'Asia/Tokyo',
      p_method, nullif(p_location, ''), 'scheduled', v_checkup.id, auth.uid()
    )
    returning id into v_interview_id;

    v_ids := v_ids || v_interview_id;
    v_created := v_created + 1;
    perform public.hm_log_access(
      'create', 'hm_interviews', v_interview_id,
      jsonb_build_object('from', 'checkup_notice', 'checkup_id', v_checkup.id)
    );
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'ids', to_jsonb(v_ids));
end;
$$;

revoke all on function public.hm_bulk_create_interviews(uuid[], date, text, text) from public;
grant execute on function public.hm_bulk_create_interviews(uuid[], date, text, text) to authenticated;

-- 確認: 列と関数が作られていること
select * from (
  values
    ('hm_interviews.checkup_id',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_interviews' and column_name = 'checkup_id')),
    ('hm_bulk_create_interviews',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_bulk_create_interviews'))
) as t(内容, 状態);
