-- ============================================================
-- 0147_hm_employee_access_fix.sql : 従業員・実施事務従事者からの閲覧範囲を締める
-- ============================================================
-- 点検で見つかった2点を直す。
--
-- (1) ファイル保管(Storage バケット hm-files)
--     これまでの閲覧条件は「パスの第1階層が自社のID」だけで、ロールを見ていなかった。
--     そのため、健康管理Webにログインした従業員・実施事務従事者が、自社フォルダのファイル
--     (従業員カルテの診断書、健診結果のCSV・PDF、作業環境測定、巡視の写真 など)を
--     一覧・取得できる状態だった(画面には出ないが、仕組みの上では可能)。
--     → 実施者は全社、事業者担当者は自社、従業員は「従業員に公開された議事録」の添付だけに限る。
--
-- (2) 受診報告(hm_consult_reports)
--     閲覧条件にロールの確認が無く、同じ企業の従業員が他の方の受診報告を読める状態だった。
--     → 実施者と、その企業の事業者担当者だけに限る。
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- ------------------------------------------------------------
-- (1) Storage hm-files の閲覧
--     パス: <company_id>/<minutes_id>/<file>          … 議事録の添付
--           <company_id>/persons/<person_id>/<file>    … 従業員カルテ
--           <company_id>/checkup-uploads/<id>.pdf      … 健診結果の送付
--           <company_id>/env/<file>, <company_id>/patrols/<id>/<file> など
-- ------------------------------------------------------------
drop policy if exists hm_files_select on storage.objects;
create policy hm_files_select on storage.objects
  for select using (
    bucket_id = 'hm-files'
    and (
      public.hm_is_office()
      or (
        public.hm_my_role() = 'company'
        and (storage.foldername(name))[1] = public.hm_my_company()::text
      )
      -- 従業員: 自社の、従業員に公開された議事録の添付ファイルだけ
      or (
        public.hm_my_role() = 'employee'
        and (storage.foldername(name))[1] = public.hm_my_company()::text
        and exists (
          select 1
            from public.hm_minutes m
           where m.id::text = (storage.foldername(name))[2]
             and m.company_id = public.hm_my_company()
             and m.published_to_employees
             and m.deleted_at is null
        )
      )
    )
  );

-- ------------------------------------------------------------
-- (2) 受診報告の閲覧
-- ------------------------------------------------------------
drop policy if exists hm_consult_reports_select on public.hm_consult_reports;
create policy hm_consult_reports_select on public.hm_consult_reports
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

-- ------------------------------------------------------------
-- 確認: 2つの方針がロールを確認していること
-- ------------------------------------------------------------
select policyname as 方針,
       case when qual like '%hm_my_role%' then '✅ロール確認あり' else '❌' end as 状態
  from pg_policies
 where (schemaname = 'storage' and policyname = 'hm_files_select')
    or (schemaname = 'public' and policyname = 'hm_consult_reports_select');
