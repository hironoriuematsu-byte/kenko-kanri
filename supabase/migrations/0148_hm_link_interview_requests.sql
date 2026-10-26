-- ============================================================
-- 0148_hm_link_interview_requests.sql : ストレスチェックWebの面接指導の申出を、産業医面談管理に自動で登録し、
--                                     申出をした人のストレスチェック結果を面談管理・カルテで見られるようにする
-- ============================================================
-- 高ストレス者がストレスチェックWebで面接指導を申し出ると、健康管理Webを使う企業(companies.hm_enabled)では、
-- 産業医面談管理(hm_interviews)に「高ストレス面接指導」の予定が自動で入る(日時は未定)。
-- その後ストレスチェックWebで日程が決まる・取り消される・実施済になると、面談管理の予定も合わせて変わる。
-- 面談管理で「実施済」にすると、ストレスチェックWebの申出も「実施済」になる。
--
--   * hm_interviews.interview_request_id(0102 で用意済み)で申出と面談を1対1につなぐ
--   * hm_link_interview_request(): 申出の内容を面談管理に反映する(なければ作る)
--   * 申出の追加・変更のたびに自動で呼ぶトリガー(interview_requests)
--   * 面談管理で実施済にしたら申出も実施済にするトリガー(hm_interviews)
--
-- 安全のため: 連携で問題が起きても、面接指導の申出そのもの(ストレスチェックWeb)は止めない(警告だけ出す)。
-- 面談管理の予定に入るのは、申出があったことと日程だけ。相談内容・事前問診の内容は入れない。
--
-- 方針: 追加のみ / hm_ 接頭辞 / SECURITY DEFINER
-- 前提: ストレスチェックWebの 0016(profiles の別名列・companies.hm_enabled)。日程の連携は stres の 0032 があれば使う
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- 1つの申出に面談は1つ
create unique index if not exists hm_interviews_request_uniq
  on public.hm_interviews (interview_request_id)
  where interview_request_id is not null;

-- ------------------------------------------------------------
-- 1. 申出の内容を面談管理に反映する(なければ作る)
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

  select id, status into v_existing from public.hm_interviews where interview_request_id = p_request_id;

  if v_existing.id is null then
    -- 取り消し済みの申出は新しく登録しない
    if v_status = 'cancelled' then
      return;
    end if;
    select p.name into v_name from public.profiles p where p.user_id = v_user;
    -- 従業員カルテ(hm_persons)と紐づいていれば、面談からカルテを開けるようにする
    select hp.id into v_person from public.hm_persons hp where hp.user_id = v_user and hp.company_id = v_company limit 1;
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
-- 2. 申出の追加・変更のたびに反映するトリガー
--    連携で問題が起きても、申出の保存は止めない
-- ------------------------------------------------------------
create or replace function public.hm_on_interview_request_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- 面談管理からの書き戻しでは呼ばない(行き来を防ぐ)
  end if;
  begin
    perform public.hm_link_interview_request(new.id);
  exception when others then
    raise warning 'hm_link_interview_request failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists hm_interview_requests_link on public.interview_requests;
create trigger hm_interview_requests_link
  after insert or update on public.interview_requests
  for each row execute function public.hm_on_interview_request_change();

-- ------------------------------------------------------------
-- 3. 面談管理で実施済にしたら、ストレスチェックWebの申出も実施済にする
-- ------------------------------------------------------------
create or replace function public.hm_on_interview_done()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.interview_request_id is not null and new.status = 'done' and old.status is distinct from 'done' then
    begin
      update public.interview_requests
         set status = 'done'
       where id = new.interview_request_id
         and status in ('pending', 'scheduled');
    exception when others then
      raise warning 'interview_requests update failed for %: %', new.interview_request_id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists hm_interviews_done_to_request on public.hm_interviews;
create trigger hm_interviews_done_to_request
  after update of status on public.hm_interviews
  for each row execute function public.hm_on_interview_done();

-- ------------------------------------------------------------
-- 4. 面接指導を申し出た人のストレスチェック結果(面談管理・カルテに表示する)
--    実施者(office): 申出に結びつく結果をすべて
--    事業者担当者(company・自社): 本人が会社への結果の提供に同意している結果だけ
--      (面接指導の申出により同意したものとみなされ、ストレスチェックWebは申出のときに同意を記録している)
--    従業員本人には返さない(本人はストレスチェックWebで見る)
-- ------------------------------------------------------------
create or replace function public.hm_requested_stress_results(p_user_id uuid)
returns table (
  interview_request_id uuid,
  requested_at timestamptz,
  request_status text,
  result_id uuid,
  fiscal_year int,
  examined_at timestamptz,
  questionnaire text,
  score_a int,
  score_b int,
  score_c int,
  high_stress boolean
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_office boolean := public.hm_is_office();
  v_company uuid;
begin
  select p.company_id into v_company from public.profiles p where p.user_id = p_user_id;
  if not (v_office or (public.hm_my_role() = 'company' and v_company = public.hm_my_company())) then
    raise exception 'permission denied';
  end if;
  insert into public.hm_access_logs (user_id, action, target_table, target_id, detail)
  values (auth.uid(), 'view_requested_stress_results', 'results', p_user_id, null);
  return query
    select q.id, q.created_at, q.status, r.id, r.fiscal_year, r.created_at,
           coalesce(to_jsonb(r) ->> 'questionnaire', '57'),
           r.score_a, r.score_b, r.score_c, r.high_stress
      from public.interview_requests q
      join public.results r on r.id = q.result_id
     where q.user_id = p_user_id
       and q.status <> 'cancelled'
       and (v_office or r.consent)
     order by r.fiscal_year desc, q.created_at desc;
end;
$$;

revoke all on function public.hm_requested_stress_results(uuid) from public, anon;
grant execute on function public.hm_requested_stress_results(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. すでにある申出(申出受付・日程調整済)を面談管理に登録する
-- ------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  for v_id in
    select q.id
      from public.interview_requests q
      join public.companies c on c.id = q.company_id
     where c.hm_enabled
       and q.status in ('pending', 'scheduled')
       and not exists (select 1 from public.hm_interviews i where i.interview_request_id = q.id)
  loop
    perform public.hm_link_interview_request(v_id);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('申出→面談管理の自動登録(トリガー)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_trigger where tgname = 'hm_interview_requests_link')),
    ('面談管理で実施済→申出も実施済(トリガー)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_trigger where tgname = 'hm_interviews_done_to_request')),
    ('申出をした人のストレスチェック結果(関数)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end
        from pg_proc where proname = 'hm_requested_stress_results')),
    ('面談管理に登録済みの申出の数',
     (select count(*)::text from public.hm_interviews where interview_request_id is not null))
) as t(項目, 状態);
