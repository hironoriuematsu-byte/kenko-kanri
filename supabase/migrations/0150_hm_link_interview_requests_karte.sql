-- ============================================================
-- 0150_hm_link_interview_requests_karte.sql : 面接指導の申出から面談管理に登録したとき、従業員カルテにも登録する
-- ============================================================
-- 0148 では、面談をカルテ(hm_persons)に紐づけるのは、すでにカルテがある人だけだった。
-- 0150 からは、カルテがなければ作る。照合の順は健診結果からの一括登録(0141)と同じ:
--   アカウント → 社員番号 → 氏名+生年月日 → 同じ企業で氏名が1人だけ → 新しく作る
--   (社員番号・氏名+生年月日で見つけたカルテにアカウントが紐づいていなければ、紐づける)
-- あわせて、0148 で登録済みの面談のうちカルテと紐づいていないものも紐づける。
--
-- 前提: 0148(・0149)の実行後に実行する。ストレスチェックWebの 0024(profiles.birth_date)がなくても動く
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- ------------------------------------------------------------
-- 1. アカウントからカルテを探す(なければ作る)
-- ------------------------------------------------------------
create or replace function public.hm_person_for_user(p_user_id uuid, p_company_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  pr jsonb;
  v_name text;
  v_emp text;
  v_birth date;
  v_dept text;
  v_person uuid;
  v_linked uuid;
begin
  if p_user_id is null or p_company_id is null then
    return null;
  end if;
  -- 生年月日の列(stres 0024)がなくても動くよう、行を jsonb で読む
  select to_jsonb(p) into pr from public.profiles p where p.user_id = p_user_id;
  if pr is null then
    return null;
  end if;
  v_name := nullif(trim(coalesce(pr ->> 'name', '')), '');
  if v_name = '未設定' then
    v_name := null;
  end if;
  v_emp := nullif(trim(coalesce(pr ->> 'emp_id', '')), '');
  v_birth := nullif(pr ->> 'birth_date', '')::date;
  v_dept := nullif(trim(coalesce(pr ->> 'dept', '')), '');

  -- アカウントが紐づいたカルテ
  select id into v_person from public.hm_persons
   where company_id = p_company_id and user_id = p_user_id
   order by created_at limit 1;
  if v_person is not null then
    return v_person;
  end if;

  -- 社員番号
  if v_emp is not null then
    select id, user_id into v_person, v_linked from public.hm_persons
     where company_id = p_company_id and employee_no = v_emp
     order by created_at limit 1;
  end if;
  -- 氏名+生年月日
  if v_person is null and v_name is not null and v_birth is not null then
    select id, user_id into v_person, v_linked from public.hm_persons
     where company_id = p_company_id and full_name = v_name and birth_date = v_birth
     order by created_at limit 1;
  end if;
  if v_person is not null then
    -- 別のアカウントに紐づいたカルテは使わない(同じ社員番号の別人などを避ける)
    if v_linked is not null and v_linked <> p_user_id then
      v_person := null;
    elsif v_linked is null then
      update public.hm_persons set user_id = p_user_id, updated_at = now() where id = v_person;
      return v_person;
    else
      return v_person;
    end if;
  end if;
  -- 同じ企業で氏名が1人だけ(アカウントは紐づけない)
  if v_name is not null then
    select min(id::text)::uuid into v_person from public.hm_persons
     where company_id = p_company_id and full_name = v_name and user_id is null
    having count(*) = 1;
    if v_person is not null then
      return v_person;
    end if;
  end if;

  -- 新しく作る
  insert into public.hm_persons (company_id, user_id, full_name, employee_no, birth_date, department, created_by)
  values (p_company_id, p_user_id, coalesce(v_name, '(氏名未登録)'), v_emp, v_birth, v_dept, auth.uid())
  returning id into v_person;
  insert into public.hm_access_logs (user_id, action, target_table, target_id, detail)
  values (auth.uid(), 'create', 'hm_persons', v_person, jsonb_build_object('auto_created_from', 'interview_request'));
  return v_person;
end;
$$;

revoke all on function public.hm_person_for_user(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. 申出の内容を面談管理に反映する(カルテへの紐づけ・作成を加えた版)
-- ------------------------------------------------------------
create or replace function public.hm_link_interview_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r jsonb;
  v_company uuid;
  v_user uuid;
  v_status text;
  v_mode text;
  v_at timestamptz;
  v_method text;
  v_location text;
  v_hm_status text;
  v_name text;
  v_person uuid;
  v_existing record;
begin
  -- 日程の列(stres 0032)がなくても動くよう、行を jsonb で読む
  select to_jsonb(q) into r from public.interview_requests q where q.id = p_request_id;
  if r is null then
    return;
  end if;
  v_company := (r ->> 'company_id')::uuid;
  v_user := (r ->> 'user_id')::uuid;
  v_status := r ->> 'status';

  -- 健康管理Webを使う企業だけ
  if not coalesce((select c.hm_enabled from public.companies c where c.id = v_company), false) then
    return;
  end if;

  v_mode := r ->> 'schedule_mode';
  v_at := case when v_status = 'scheduled' then nullif(r ->> 'scheduled_at', '')::timestamptz end;
  v_method := case when v_status = 'scheduled' then case v_mode when 'online' then 'online' when 'visit' then 'in_person' end end;
  v_location := case
    when v_status <> 'scheduled' then null
    when v_mode = 'online' then nullif(r ->> 'meet_url', '')
    when v_mode = 'visit' then '次回訪問時(時間・場所は事業者担当者が調整)' || coalesce('・' || nullif(r ->> 'visit_note', ''), '')
  end;
  v_hm_status := case v_status when 'cancelled' then 'cancelled' when 'done' then 'done' else 'scheduled' end;

  select id, status, person_id into v_existing from public.hm_interviews where interview_request_id = p_request_id;

  if v_existing.id is null then
    -- 取り消し済みの申出は新しく登録しない
    if v_status = 'cancelled' then
      return;
    end if;
    select p.name into v_name from public.profiles p where p.user_id = v_user;
    -- 従業員カルテ(hm_persons)に紐づける。なければ作る
    v_person := public.hm_person_for_user(v_user, v_company);
    insert into public.hm_interviews (
      company_id, person_id, target_user_id, target_name, interview_type,
      scheduled_at, method, location, status, interview_request_id, pre_info
    ) values (
      v_company, v_person, v_user, coalesce(nullif(v_name, ''), '(氏名未登録)'), 'high_stress',
      v_at, v_method, v_location, v_hm_status, p_request_id,
      'ストレスチェックWebで面接指導の申出(申出日: '
        || to_char(((r ->> 'created_at')::timestamptz) at time zone 'Asia/Tokyo', 'YYYY/MM/DD')
        || ')。日程の調整と事前問診はストレスチェックWebで行います。'
    );
    -- サーバーや一括登録からはログイン中の利用者がいないため、記録は直接書く(hm_log_access はログイン必須)
    insert into public.hm_access_logs (user_id, action, target_table, target_id, detail)
    values (auth.uid(), 'auto_create', 'hm_interviews', null, jsonb_build_object('interview_request_id', p_request_id));
  else
    -- 以前に登録した面談でカルテと紐づいていなければ、紐づける
    if v_existing.person_id is null then
      update public.hm_interviews
         set person_id = public.hm_person_for_user(v_user, v_company)
       where id = v_existing.id;
    end if;
    -- 面談管理で実施済・取り消しにしたものは、日程を書き戻さない
    if v_existing.status <> 'scheduled' then
      return;
    end if;
    update public.hm_interviews
       set scheduled_at = v_at,
           method = v_method,
           location = v_location,
           status = v_hm_status,
           updated_at = now()
     where id = v_existing.id;
  end if;
end;
$$;


revoke all on function public.hm_link_interview_request(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. 0148 で登録済みの面談のうち、カルテと紐づいていないものを紐づける(なければ作る)
-- ------------------------------------------------------------
do $$
declare
  v record;
begin
  for v in
    select i.id, i.target_user_id, i.company_id
      from public.hm_interviews i
     where i.interview_request_id is not null
       and i.person_id is null
       and i.target_user_id is not null
  loop
    update public.hm_interviews
       set person_id = public.hm_person_for_user(v.target_user_id, v.company_id)
     where id = v.id;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('カルテを探す・作る関数',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc where proname = 'hm_person_for_user')),
    ('申出から登録した面談の数',
     (select count(*)::text from public.hm_interviews where interview_request_id is not null)),
    ('そのうちカルテと紐づいていない数(0 が正常)',
     (select count(*)::text from public.hm_interviews where interview_request_id is not null and person_id is null))
) as t(項目, 状態);
