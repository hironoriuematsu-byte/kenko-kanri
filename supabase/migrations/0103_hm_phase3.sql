-- ============================================================
-- 0103_hm_phase3.sql : 健康管理Web Phase 3 健康診断結果管理
-- ============================================================
-- 前提: 0101, 0102 適用済み
-- 方針: 追加のみ。書き込みはすべて SECURITY DEFINER RPC 経由
--   (取込・判定入力・事後措置・削除に権限チェック+ログを強制するため、
--    テーブルへの直接insert/update/deleteのGRANTを与えない)
-- 健診結果は事業者保有情報のため company も取込・閲覧可(スト以外チェックと異なる)。
-- 就業判定(医師の意見)の入力のみ office 限定。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 健診受診記録(hm_checkups) 1人1年度1種別につき1行
-- ------------------------------------------------------------

create table if not exists public.hm_checkups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  target_user_id uuid references public.profiles(id),  -- 従業員アカウント(任意)
  target_name text not null,
  employee_no text,
  fiscal_year int not null,                            -- 年度(4月始まり)
  checkup_type text not null default 'regular'
    check (checkup_type in ('regular', 'hiring', 'special')),
  checkup_date date,
  overall_judgment text,               -- 総合判定(A〜E等、健診機関の表記のまま)
  has_findings boolean not null default false,  -- 有所見
  -- 就業判定(医師の意見) 入力はofficeのみ(RPC)、閲覧はcompany可
  work_judgment text
    check (work_judgment in ('normal', 'restricted', 'leave')),
  work_judgment_note text,
  work_judgment_date date,
  -- 事後措置フォロー
  followup_status text not null default 'none'
    check (followup_status in ('none', 'pending', 'recommended', 'done')),
  followup_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hm_checkups_company_year_idx
  on public.hm_checkups (company_id, fiscal_year desc);
create index if not exists hm_checkups_target_idx
  on public.hm_checkups (target_user_id);

alter table public.hm_checkups enable row level security;

-- 書き込みは全てRPC経由: select以外のGRANTを剥奪
revoke all on public.hm_checkups from anon, authenticated;
grant select on public.hm_checkups to authenticated;

create policy hm_checkups_select on public.hm_checkups
  for select using (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    or (public.hm_my_role() = 'employee' and target_user_id = auth.uid())
  );

-- ------------------------------------------------------------
-- 2. 検査項目(hm_checkup_items)
-- ------------------------------------------------------------

create table if not exists public.hm_checkup_items (
  id uuid primary key default gen_random_uuid(),
  checkup_id uuid not null references public.hm_checkups(id) on delete cascade,
  item_name text not null,
  value text,
  judgment text,        -- 項目別判定(A〜E等、任意)
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hm_checkup_items_checkup_idx
  on public.hm_checkup_items (checkup_id, sort_order);

alter table public.hm_checkup_items enable row level security;

revoke all on public.hm_checkup_items from anon, authenticated;
grant select on public.hm_checkup_items to authenticated;

create policy hm_checkup_items_select on public.hm_checkup_items
  for select using (
    exists (select 1 from public.hm_checkups c where c.id = checkup_id)
  );

-- ------------------------------------------------------------
-- 3. 取込・入力RPC(office / company自社)
-- ------------------------------------------------------------
-- p_rows: [{ "target_name": "...", "employee_no": "...", "target_user_id": null,
--            "checkup_date": "2026-06-01", "overall_judgment": "C",
--            "items": [{"name": "血圧", "value": "142/90", "judgment": "C"}] }, ...]
-- p_findings_judgments: 有所見とみなす判定の配列(例 {C,D,E})

create or replace function public.hm_import_checkups(
  p_company_id uuid,
  p_fiscal_year int,
  p_checkup_type text,
  p_findings_judgments text[],
  p_rows jsonb
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_checkup_id uuid;
  v_count int := 0;
  v_has_findings boolean;
  v_order int;
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

    v_has_findings :=
      (v_row ->> 'overall_judgment') = any (coalesce(p_findings_judgments, '{}'));
    if not v_has_findings and v_row ? 'items' then
      select exists (
        select 1 from jsonb_array_elements(v_row -> 'items') it
        where (it ->> 'judgment') = any (coalesce(p_findings_judgments, '{}'))
      ) into v_has_findings;
    end if;

    insert into public.hm_checkups (
      company_id, target_user_id, target_name, employee_no,
      fiscal_year, checkup_type, checkup_date, overall_judgment,
      has_findings, followup_status, created_by
    ) values (
      p_company_id,
      nullif(v_row ->> 'target_user_id', '')::uuid,
      trim(v_row ->> 'target_name'),
      nullif(trim(coalesce(v_row ->> 'employee_no', '')), ''),
      p_fiscal_year,
      p_checkup_type,
      nullif(v_row ->> 'checkup_date', '')::date,
      nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), ''),
      v_has_findings,
      case when v_has_findings then 'pending' else 'none' end,
      auth.uid()
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
      'count', v_count
    )
  );
  return v_count;
end;
$$;

-- 就業判定(医師の意見) officeのみ
create or replace function public.hm_save_work_judgment(
  p_id uuid,
  p_judgment text,
  p_note text,
  p_date date default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_checkups
     set work_judgment = nullif(p_judgment, ''),
         work_judgment_note = nullif(p_note, ''),
         work_judgment_date = coalesce(p_date, current_date),
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'checkup not found';
  end if;
  perform public.hm_log_access(
    'work_judgment', 'hm_checkups', p_id, jsonb_build_object('judgment', p_judgment)
  );
end;
$$;

-- 事後措置ステータス office / company(自社)
create or replace function public.hm_set_followup(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.hm_checkups where id = p_id;
  if v_company is null then
    raise exception 'checkup not found';
  end if;
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and v_company = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;
  if p_status not in ('none', 'pending', 'recommended', 'done') then
    raise exception 'invalid status';
  end if;
  update public.hm_checkups
     set followup_status = p_status,
         followup_note = nullif(p_note, ''),
         updated_at = now()
   where id = p_id;
  perform public.hm_log_access(
    'followup', 'hm_checkups', p_id, jsonb_build_object('status', p_status)
  );
end;
$$;

-- 削除(取込ミスの修正用) officeのみ・理由必須・ログ記録
create or replace function public.hm_delete_checkup(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason required';
  end if;
  perform public.hm_log_access(
    'delete', 'hm_checkups', p_id, jsonb_build_object('reason', p_reason)
  );
  delete from public.hm_checkups where id = p_id;
  if not found then
    raise exception 'checkup not found';
  end if;
end;
$$;

drop trigger if exists hm_checkups_set_updated_at on public.hm_checkups;
create trigger hm_checkups_set_updated_at
  before update on public.hm_checkups
  for each row execute function public.hm_set_updated_at();
