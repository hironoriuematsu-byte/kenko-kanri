-- ============================================================
-- 0159_hm_high_stress_interview_visibility.sql :
--   「高ストレス面接指導」の面談予定を、本人の申出がある場合だけ会社の担当者に見せる
-- ============================================================
-- ストレスチェックの結果(高ストレスかどうかを含む)は、本人の同意がなければ事業者に提供できない。
-- 面接指導を申し出た方は、会社への結果の提供に同意したものとして扱える。
-- これまで、会社の担当者には自社の面談予定がすべて(種類の名前つきで)見えていたため、
-- 申出をしていない方を「高ストレス面接指導」として手で登録すると、高ストレスであることが会社に伝わってしまった。
--
--   ・hm_interviews.request_confirmed: 本人から面接指導の申出があった(会社への結果の提供に同意している)ことを、
--       産業医事務所が確かめた印。紙で受検した方など、ストレスチェックWebの画面から申し出ていない方に使う
--   ・会社の担当者に見える「高ストレス面接指導」は、次のどちらかに限る:
--       ストレスチェックWebからの申出で登録された面談(interview_request_id がある)
--       / 産業医事務所が申出を確かめた面談(request_confirmed)
--   ・ほかの種類の面談(健診事後措置・長時間労働・復職 など)の見え方は変えない
--   ・request_confirmed を変えられるのは産業医事務所だけ
--
-- 注意: これまでに手で登録した「高ストレス面接指導」のうち、申出と結びついていないものは、
--       このSQLの実行後、会社の担当者から見えなくなる(最後に件数を表示する)。
--       申出のあった方は、面談の「予定を編集」で「本人から面接指導の申出があった」にチェックを入れると、また見えるようになる。
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_interviews add column if not exists request_confirmed boolean not null default false;

grant select (request_confirmed) on public.hm_interviews to authenticated;
grant insert (request_confirmed) on public.hm_interviews to authenticated;
grant update (request_confirmed) on public.hm_interviews to authenticated;

-- 申出の確認の印を変えられるのは、産業医事務所だけ
create or replace function public.hm_interviews_guard_request_confirmed()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.request_confirmed and auth.uid() is not null and not public.hm_is_office() then
      new.request_confirmed := false;
    end if;
  elsif new.request_confirmed is distinct from old.request_confirmed
        and auth.uid() is not null and not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  return new;
end;
$$;

drop trigger if exists hm_interviews_guard_request_confirmed on public.hm_interviews;
create trigger hm_interviews_guard_request_confirmed
  before insert or update on public.hm_interviews
  for each row execute function public.hm_interviews_guard_request_confirmed();

-- 行レベル: office=全社 / company=自社(高ストレス面接指導は申出のあるものだけ) / employee=本人が対象の面談のみ
drop policy if exists hm_interviews_select on public.hm_interviews;
create policy hm_interviews_select on public.hm_interviews
  for select using (
    public.hm_is_office()
    or (
      public.hm_my_role() = 'company'
      and company_id = public.hm_my_company()
      and (interview_type <> 'high_stress' or interview_request_id is not null or request_confirmed)
    )
    or (public.hm_my_role() = 'employee' and target_user_id = auth.uid())
  );

-- 予定の変更(日程調整): office / company(自社。見える面談だけ)
drop policy if exists hm_interviews_update on public.hm_interviews;
create policy hm_interviews_update on public.hm_interviews
  for update using (
    status = 'scheduled'
    and (
      public.hm_is_office()
      or (
        public.hm_my_role() = 'company'
        and company_id = public.hm_my_company()
        and (interview_type <> 'high_stress' or interview_request_id is not null or request_confirmed)
      )
    )
  )
  with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

-- 適用状況と、会社の担当者から見えなくなる面談の件数(企業ごとの内訳つき。結果は1つの表にまとめて表示する)
select 項目, 状態 from (
  select 1 as ord, '申出の確認の印(hm_interviews.request_confirmed)' as 項目,
         (select case when count(*) = 1 then '✅OK' else '❌未適用' end from information_schema.columns
           where table_schema = 'public' and table_name = 'hm_interviews' and column_name = 'request_confirmed') as 状態
  union all
  select 2, '会社に見せる条件(高ストレス面接指導は申出のあるものだけ)',
         (select case when count(*) = 2 then '✅OK' else '❌未適用' end from pg_policies
           where schemaname = 'public' and tablename = 'hm_interviews'
             and policyname in ('hm_interviews_select', 'hm_interviews_update') and qual like '%request_confirmed%')
  union all
  select 3, 'ストレスチェックWebの申出から登録された高ストレス面接指導(今までどおり会社に見える)',
         (select count(*)::text || ' 件' from public.hm_interviews
           where interview_type = 'high_stress' and interview_request_id is not null)
  union all
  select 4, '手で登録された高ストレス面接指導(会社から見えなくなる。申出のあった方は「予定を編集」でチェックを入れる)',
         (select count(*)::text || ' 件' from public.hm_interviews
           where interview_type = 'high_stress' and interview_request_id is null and not request_confirmed)
  union all
  select 5, '　└ 内訳: ' || c.name,
         count(*)::text || ' 件(うち予定中 ' || (count(*) filter (where i.status = 'scheduled'))::text || ' 件)'
    from public.hm_interviews i
    join public.companies c on c.id = i.company_id
   where i.interview_type = 'high_stress' and i.interview_request_id is null and not i.request_confirmed
   group by c.name
) t
order by ord, 項目;
