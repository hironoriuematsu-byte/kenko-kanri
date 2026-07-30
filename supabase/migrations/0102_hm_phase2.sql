-- ============================================================
-- 0102_hm_phase2.sql : 健康管理Web Phase 2 面談管理
-- ============================================================
-- 前提: 0101_hm_phase1.sql 適用済み(hm_is_office 等のヘルパーを利用)
-- 方針: 追加のみ。既存テーブル・既存ポリシーは一切変更しない
--   * 実施記録・非公開メモは列単位GRANTで保護し、officeのみRPC経由で読み書き
--   * 危険操作は SECURITY DEFINER RPC + 権限チェック + hm_access_logs 記録
-- ============================================================

-- ------------------------------------------------------------
-- 1. 面談(hm_interviews)
-- ------------------------------------------------------------

create table if not exists public.hm_interviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  target_user_id uuid references public.profiles(id),  -- 対象者(アカウントがある場合)
  target_name text not null,                           -- 対象者氏名(表示用スナップショット)
  interview_type text not null check (interview_type in
    ('high_stress', 'long_hours', 'checkup_followup', 'return_to_work', 'other')),
  scheduled_at timestamptz,                            -- 予定日時
  method text check (method in ('in_person', 'online', 'phone')),
  location text,                                       -- 場所/URL等(健康情報は書かない)
  status text not null default 'scheduled'
    check (status in ('scheduled', 'done', 'cancelled')),
  interview_request_id uuid,   -- 既存interview_requests連携用(本運用時に接続)
  -- ここから実施記録(officeのみ・列単位GRANTで保護、読み書きはRPC経由)
  conducted_date date,         -- 実施日
  findings text,               -- 所見
  guidance text,               -- 本人への指導内容
  private_memo text,           -- 産業医の非公開メモ(企業側には一切表示しない)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hm_interviews_company_idx
  on public.hm_interviews (company_id, scheduled_at desc);
create index if not exists hm_interviews_target_idx
  on public.hm_interviews (target_user_id);

alter table public.hm_interviews enable row level security;

-- 列単位GRANT: いったん全て剥奪し、公開してよい列だけ許可する
-- (実施記録4列 conducted_date/findings/guidance/private_memo は
--  どのロールにも直接SELECTさせない。officeのみ下のRPCで読む)
revoke all on public.hm_interviews from anon, authenticated;

grant select (
  id, company_id, target_user_id, target_name, interview_type,
  scheduled_at, method, location, status, interview_request_id,
  created_by, created_at, updated_at
) on public.hm_interviews to authenticated;

grant insert (
  company_id, target_user_id, target_name, interview_type,
  scheduled_at, method, location, created_by
) on public.hm_interviews to authenticated;

grant update (
  target_user_id, target_name, interview_type, scheduled_at, method, location
) on public.hm_interviews to authenticated;

-- 行レベル: office=全社 / company=自社 / employee=本人が対象の面談のみ
create policy hm_interviews_select on public.hm_interviews
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    or (public.hm_my_role() = 'employee' and target_user_id = auth.uid())
  );

-- 予定の新規登録はofficeのみ
create policy hm_interviews_insert on public.hm_interviews
  for insert with check (
    public.hm_is_office() and created_by = auth.uid()
  );

-- 予定の変更(日程調整): office / company(自社)
create policy hm_interviews_update on public.hm_interviews
  for update using (
    status = 'scheduled'
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  )
  with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

-- 物理削除は不可(deleteポリシー・GRANTなし)

-- ------------------------------------------------------------
-- 2. 実施記録の読み書きRPC(officeのみ・ログ必須)
-- ------------------------------------------------------------

create or replace function public.hm_get_interview_record(p_id uuid)
returns table (
  conducted_date date,
  findings text,
  guidance text,
  private_memo text
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  perform public.hm_log_access('view_record', 'hm_interviews', p_id, null);
  return query
    select i.conducted_date, i.findings, i.guidance, i.private_memo
    from public.hm_interviews i
    where i.id = p_id;
end;
$$;

create or replace function public.hm_save_interview_record(
  p_id uuid,
  p_conducted_date date,
  p_findings text,
  p_guidance text,
  p_private_memo text,
  p_mark_done boolean default false
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_interviews
     set conducted_date = p_conducted_date,
         findings = p_findings,
         guidance = p_guidance,
         private_memo = p_private_memo,
         status = case when p_mark_done then 'done' else status end,
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'interview not found';
  end if;
  perform public.hm_log_access('save_record', 'hm_interviews', p_id, null);
end;
$$;

create or replace function public.hm_cancel_interview(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_interviews
     set status = 'cancelled', updated_at = now()
   where id = p_id and status = 'scheduled';
  if not found then
    raise exception 'interview not found or not cancellable';
  end if;
  perform public.hm_log_access(
    'cancel', 'hm_interviews', p_id, jsonb_build_object('reason', p_reason)
  );
end;
$$;

drop trigger if exists hm_interviews_set_updated_at on public.hm_interviews;
create trigger hm_interviews_set_updated_at
  before update on public.hm_interviews
  for each row execute function public.hm_set_updated_at();

-- ------------------------------------------------------------
-- 3. 意見書(hm_interview_opinions) — 企業側に公開するのはこれのみ
-- ------------------------------------------------------------

create table if not exists public.hm_interview_opinions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.hm_interviews(id),
  company_id uuid not null references public.companies(id),
  interview_date date,               -- 面談実施日(意見書に記載する日付)
  work_judgment text check (work_judgment in ('normal', 'restricted', 'leave')),
  opinion text,                      -- 就業上の措置に関する意見(企業向け)
  physician_name text,               -- 産業医氏名(作成時スナップショット)
  issued_date date,
  published boolean not null default false,  -- trueで企業側に公開
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hm_interview_opinions enable row level security;

-- 閲覧: office / company(自社かつ公開済みのみ)
create policy hm_opinions_select on public.hm_interview_opinions
  for select using (
    public.hm_is_office()
    or (
      public.hm_my_role() = 'company'
      and company_id = public.hm_my_company()
      and published
    )
  );

-- 作成・編集はofficeのみ
create policy hm_opinions_insert on public.hm_interview_opinions
  for insert with check (public.hm_is_office() and created_by = auth.uid());

create policy hm_opinions_update on public.hm_interview_opinions
  for update using (public.hm_is_office())
  with check (public.hm_is_office());

revoke delete on public.hm_interview_opinions from anon, authenticated;

drop trigger if exists hm_opinions_set_updated_at on public.hm_interview_opinions;
create trigger hm_opinions_set_updated_at
  before update on public.hm_interview_opinions
  for each row execute function public.hm_set_updated_at();
