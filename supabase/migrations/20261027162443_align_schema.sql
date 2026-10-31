-- ① 补列（couples + 其他表）

alter table public.couples add column if not exists cover_path text;
alter table public.couples add column if not exists settings jsonb;
update public.couples set settings = '{}' where settings is null;
alter table public.couples alter column settings set default '{}';
alter table public.couples alter column settings set not null;

-- couples
alter table public.couples add column if not exists name_a text;
alter table public.couples add column if not exists name_b text;
alter table public.couples add column if not exists start_date date;
alter table public.couples add column if not exists created_at timestamptz default now();

-- couple_members
alter table public.couple_members add column if not exists role text;

-- memories
alter table public.memories add column if not exists body text;
alter table public.memories add column if not exists location text;
alter table public.memories add column if not exists author_role text;
alter table public.memories add column if not exists created_at timestamptz default now();

-- albums
alter table public.albums add column if not exists cover_path text;
alter table public.albums add column if not exists created_at timestamptz default now();

-- anniversaries
alter table public.anniversaries add column if not exists repeat_yearly boolean default true;
alter table public.anniversaries add column if not exists icon text;
alter table public.anniversaries add column if not exists created_at timestamptz default now();

-- ② 建表（memory_media / album_media / whispers）

create table if not exists public.memory_media (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('photo','video')),
  taken_at date,
  created_at timestamptz not null default now()
);

create table if not exists public.album_media (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('photo','video')),
  taken_at date,
  created_at timestamptz not null default now()
);

create table if not exists public.whispers (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text,
  media_path text,
  media_type text check (media_type in ('photo','video','voice')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ③ 约束（DO 块）

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'couple_members_role_check'
      and conrelid = 'public.couple_members'::regclass
  ) then
    alter table public.couple_members
      add constraint couple_members_role_check check (role in ('a','b'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'memories_author_role_check'
      and conrelid = 'public.memories'::regclass
  ) then
    alter table public.memories
      add constraint memories_author_role_check check (author_role in ('a','b'));
  end if;
end $$;

-- ④ 索引（9 条）

create index if not exists idx_couple_members_user on public.couple_members (user_id);
create index if not exists idx_couple_members_couple on public.couple_members (couple_id);
create index if not exists idx_memories_couple_date on public.memories (couple_id, date desc);
create index if not exists idx_albums_couple on public.albums (couple_id);
create index if not exists idx_anniversaries_couple on public.anniversaries (couple_id);
create index if not exists idx_whispers_couple_created on public.whispers (couple_id, created_at desc);
create index if not exists idx_whispers_sender on public.whispers (sender_id);
create index if not exists idx_memory_media_memory on public.memory_media (memory_id);
create index if not exists idx_album_media_album on public.album_media (album_id);

-- ⑤ 辅助函数

create or replace function public.user_couple_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select couple_id from public.couple_members where user_id = auth.uid();
$$;

grant execute on function public.user_couple_ids() to authenticated;

create or replace function public.love_sync_memory_fields() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  member_role text;
  trusted_writer boolean;
begin
  select r.rolsuper or r.rolbypassrls or r.oid = c.relowner into trusted_writer
  from pg_catalog.pg_roles r cross join pg_catalog.pg_class c
  where r.rolname = current_user and c.oid = tg_relid;

  if tg_op = 'INSERT' then
    if new.date is not null and new.memory_date is not null and new.date <> new.memory_date then
      raise exception '字段 date 与 memory_date 冲突';
    end if;
    new.date := coalesce(new.date, new.memory_date);
    new.memory_date := new.date;
    new.author_id := coalesce(new.author_id, auth.uid());
    if not coalesce(trusted_writer, false) and new.author_id is distinct from auth.uid() then
      raise exception 'author_id 必须是当前用户';
    end if;
    if new.body is not null and new.content is not null and new.body <> new.content then
      raise exception 'body 与 content 冲突';
    end if;
    new.body := coalesce(new.body, new.content);
    new.content := coalesce(new.body, new.title);
    new.title := coalesce(new.title, left(split_part(new.content, E'\n', 1), 120));
  else
    if (new.id, new.couple_id, new.created_at) is distinct from (old.id, old.couple_id, old.created_at)
      or (new.author_id is distinct from old.author_id and not coalesce(trusted_writer, false)) then
      raise exception '记忆归属不可修改';
    end if;
    if new.date is distinct from old.date then
      if new.memory_date is distinct from old.memory_date and new.date is distinct from new.memory_date then
        raise exception '字段 date 与 memory_date 冲突';
      end if;
      new.memory_date := new.date;
    else
      new.date := new.memory_date;
    end if;
    if new.body is distinct from old.body then
      if new.content is distinct from old.content and new.content is distinct from coalesce(new.body, new.title) then
        raise exception 'body 与 content 冲突';
      end if;
      new.content := coalesce(new.body, new.title);
    elsif new.content is distinct from old.content then
      new.body := new.content;
      if new.title = left(split_part(old.content, E'\n', 1), 120) then
        new.title := left(split_part(new.content, E'\n', 1), 120);
      end if;
    elsif new.body is null then
      new.content := new.title;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.author_id is not distinct from old.author_id then
    -- 伴侣的成员行受 RLS 隐藏；编辑内容时沿用原作者角色，不重新查询。
    member_role := old.author_role;
  else
    select role into member_role from public.couple_members
    where couple_id = new.couple_id and user_id = new.author_id;
  end if;
  if tg_op = 'UPDATE' and new.author_id is distinct from old.author_id then
    -- 既有定义者权限账号移交 RPC 可以变更作者，并重算角色。
    new.author_role := member_role;
  elsif new.author_role is not null and new.author_role is distinct from member_role then
    raise exception 'author_role 必须与实际作者角色一致';
  end if;
  new.author_role := member_role;
  return new;
end $$;

revoke all on function public.love_sync_memory_fields() from public;

-- ⑥ RLS 策略（各表）

alter table public.couple_members enable row level security;

-- 旧的宽策略会与新策略按 OR 叠加，必须移除才能限制为本人记录。
drop policy if exists "members read own couple" on public.couple_members;
drop policy if exists "members read own memberships" on public.couple_members;
create policy "members read own memberships"
on public.couple_members for select to authenticated
using (user_id = auth.uid());

-- 成员表收紧后，既有情书策略不能再直接读取伴侣的成员行。
-- 仅在旧情书策略存在时，改用已有的定义者权限成员校验函数。
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'couple_letters'
      and policyname = 'letters send to partner'
  ) then
    alter policy "letters send to partner" on public.couple_letters
    with check (
      sender_id = auth.uid()
      and public.is_couple_member(couple_id)
      and public.is_couple_member(couple_id, recipient_id)
    );
  end if;
end $$;

alter table public.couples enable row level security;

-- 移除仓库旧的同类宽松策略，统一使用新策略的角色及成员范围。
drop policy if exists "couples read as member" on public.couples;
drop policy if exists "couples update as member" on public.couples;

drop policy if exists "couples readable by members" on public.couples;
create policy "couples readable by members"
on public.couples for select to authenticated
using (id in (select public.user_couple_ids()));

drop policy if exists "couples updatable by members" on public.couples;
create policy "couples updatable by members"
on public.couples for update to authenticated
using (id in (select public.user_couple_ids()))
with check (id in (select public.user_couple_ids()));

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.memories'::regclass and tgname = 'love_sync_core'
      and tgfoid = to_regprocedure('public.love_sync_core_fields()')
  ) then
    create or replace trigger love_sync_core
    before insert or update on public.memories
    for each row execute function public.love_sync_memory_fields();
  end if;
end $$;

alter table public.memories enable row level security;

drop policy if exists "memories read by couple" on public.memories;
drop policy if exists "memories create by couple" on public.memories;
drop policy if exists "memories update by author" on public.memories;
drop policy if exists "memories delete by author" on public.memories;

drop policy if exists "memories readable by members" on public.memories;
create policy "memories readable by members"
on public.memories for select to authenticated
using (couple_id in (select public.user_couple_ids()));

drop policy if exists "memories insertable by members" on public.memories;
create policy "memories insertable by members"
on public.memories for insert to authenticated
with check (couple_id in (select public.user_couple_ids()));

drop policy if exists "memories updatable by members" on public.memories;
create policy "memories updatable by members"
on public.memories for update to authenticated
using (couple_id in (select public.user_couple_ids()))
with check (couple_id in (select public.user_couple_ids()));

drop policy if exists "memories deletable by members" on public.memories;
create policy "memories deletable by members"
on public.memories for delete to authenticated
using (couple_id in (select public.user_couple_ids()));

-- 相册：保持原有创建者写入权限；缺少旧归属字段时不开放创建者操作。
alter table public.albums enable row level security;
drop policy if exists "albums read by couple" on public.albums;
drop policy if exists "albums create by couple" on public.albums;
drop policy if exists "albums update by creator" on public.albums;
drop policy if exists "albums delete by creator" on public.albums;
create policy "albums read by couple" on public.albums for select to authenticated
using (couple_id in (select public.user_couple_ids()));
create policy "albums create by couple" on public.albums for insert to authenticated
with check (couple_id in (select public.user_couple_ids()) and to_jsonb(albums)->>'created_by' = auth.uid()::text);
create policy "albums update by creator" on public.albums for update to authenticated
using (couple_id in (select public.user_couple_ids()) and to_jsonb(albums)->>'created_by' = auth.uid()::text)
with check (couple_id in (select public.user_couple_ids()) and to_jsonb(albums)->>'created_by' = auth.uid()::text);
create policy "albums delete by creator" on public.albums for delete to authenticated
using (couple_id in (select public.user_couple_ids()) and to_jsonb(albums)->>'created_by' = auth.uid()::text);

-- 纪念日：成员读取和更新，创建及删除保留原创建者要求。
alter table public.anniversaries enable row level security;
drop policy if exists "anniversaries read by couple" on public.anniversaries;
drop policy if exists "anniversaries create by couple" on public.anniversaries;
drop policy if exists "anniversaries update by couple" on public.anniversaries;
drop policy if exists "anniversaries delete by creator" on public.anniversaries;
create policy "anniversaries read by couple" on public.anniversaries for select to authenticated
using (couple_id in (select public.user_couple_ids()));
create policy "anniversaries create by couple" on public.anniversaries for insert to authenticated
with check (couple_id in (select public.user_couple_ids()) and to_jsonb(anniversaries)->>'created_by' = auth.uid()::text);
create policy "anniversaries update by couple" on public.anniversaries for update to authenticated
using (couple_id in (select public.user_couple_ids()))
with check (couple_id in (select public.user_couple_ids()));
create policy "anniversaries delete by creator" on public.anniversaries for delete to authenticated
using (couple_id in (select public.user_couple_ids()) and to_jsonb(anniversaries)->>'created_by' = auth.uid()::text);

-- 记忆媒体：成员读取，直接写入仍仅允许记忆作者。
alter table public.memory_media enable row level security;
drop policy if exists "memory media read by couple" on public.memory_media;
drop policy if exists "memory media create by author" on public.memory_media;
drop policy if exists "memory media update by author" on public.memory_media;
drop policy if exists "memory media delete by author" on public.memory_media;
create policy "memory media read by couple" on public.memory_media for select to authenticated
using (exists (select 1 from public.memories m where m.id = memory_id
  and m.couple_id in (select public.user_couple_ids())));
create policy "memory media create by author" on public.memory_media for insert to authenticated
with check (exists (select 1 from public.memories m where m.id = memory_id
  and m.couple_id in (select public.user_couple_ids()) and to_jsonb(m)->>'author_id' = auth.uid()::text));
create policy "memory media update by author" on public.memory_media for update to authenticated
using (exists (select 1 from public.memories m where m.id = memory_id
  and m.couple_id in (select public.user_couple_ids()) and to_jsonb(m)->>'author_id' = auth.uid()::text))
with check (exists (select 1 from public.memories m where m.id = memory_id
  and m.couple_id in (select public.user_couple_ids()) and to_jsonb(m)->>'author_id' = auth.uid()::text));
create policy "memory media delete by author" on public.memory_media for delete to authenticated
using (exists (select 1 from public.memories m where m.id = memory_id
  and m.couple_id in (select public.user_couple_ids()) and to_jsonb(m)->>'author_id' = auth.uid()::text));

-- 相册媒体：成员可读、新增和删除，不开放 UPDATE。
alter table public.album_media enable row level security;
drop policy if exists "album media read by couple" on public.album_media;
drop policy if exists "album media create by couple" on public.album_media;
drop policy if exists "album media delete by legacy permission" on public.album_media;
create policy "album media read by couple" on public.album_media for select to authenticated
using (exists (select 1 from public.albums a where a.id = album_id
  and a.couple_id in (select public.user_couple_ids())));
create policy "album media create by couple" on public.album_media for insert to authenticated
with check (exists (select 1 from public.albums a where a.id = album_id
  and a.couple_id in (select public.user_couple_ids())));
create policy "album media delete by legacy permission" on public.album_media for delete to authenticated
using (exists (select 1 from public.albums a where a.id = album_id
  and a.couple_id in (select public.user_couple_ids())));

-- 悄悄话：成员读取，发送者创建/撤回，收件人仅可改已读时间。
alter table public.whispers enable row level security;
drop policy if exists "whispers read by couple" on public.whispers;
drop policy if exists "whispers create by sender" on public.whispers;
drop policy if exists "whispers update recipient" on public.whispers;
drop policy if exists "whispers delete sender" on public.whispers;
create policy "whispers read by couple" on public.whispers for select to authenticated
using (couple_id in (select public.user_couple_ids()));
create policy "whispers create by sender" on public.whispers for insert to authenticated
with check (couple_id in (select public.user_couple_ids()) and sender_id = auth.uid());
create policy "whispers update recipient" on public.whispers for update to authenticated
using (couple_id in (select public.user_couple_ids()) and sender_id <> auth.uid())
with check (couple_id in (select public.user_couple_ids()) and sender_id <> auth.uid());
create policy "whispers delete sender" on public.whispers for delete to authenticated
using (couple_id in (select public.user_couple_ids()) and sender_id = auth.uid());

revoke all on public.memory_media, public.album_media, public.whispers from public, anon, authenticated;
grant select, insert, update, delete on public.memory_media to authenticated;
grant select, insert, delete on public.album_media, public.whispers to authenticated;
grant update (read_at) on public.whispers to authenticated;
grant all on public.memory_media, public.album_media, public.whispers to service_role;

-- ⑦ Storage bucket + 策略

-- 旧头像策略与媒体策略同处 storage.objects，先补齐其登录角色依赖。
do $$
begin
  if to_regprocedure('public.is_same_couple_user(uuid)') is not null then
    grant execute on function public.is_same_couple_user(uuid) to authenticated;
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies where schemaname='storage'
      and tablename='objects' and policyname='avatars read by couple'
  ) then
    alter policy "avatars read by couple" on storage.objects to authenticated;
  end if;
end $$;

-- 沿用现有 bucket 和文件路径。已有文件与大小/MIME 设置保留，统一私有访问。
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('memory-photos', 'memory-photos', false, 8388608, array['image/jpeg','image/png','image/webp']),
  ('album-media', 'album-media', false, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']),
  ('message-media', 'message-media', false, 41943040, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict (id) do update set public = false;

-- 先移除仓库旧策略，避免宽松策略 OR 叠加和无效 UUID 路径强制转换报错。
drop policy if exists "memory photos read by couple" on storage.objects;
drop policy if exists "memory photos upload by couple" on storage.objects;
drop policy if exists "memory photos delete by couple" on storage.objects;
drop policy if exists "message images read by couple" on storage.objects;
drop policy if exists "message images upload by couple" on storage.objects;
drop policy if exists "album media read couple" on storage.objects;
drop policy if exists "album media upload couple" on storage.objects;
drop policy if exists "album media delete uploader" on storage.objects;
drop policy if exists "album media delete couple" on storage.objects;
drop policy if exists "message media read by couple" on storage.objects;
drop policy if exists "message media upload by couple" on storage.objects;
drop policy if exists "message media delete by couple" on storage.objects;

-- 使用文本比较校验路径前缀，畸形路径不需要转换为 UUID。
create policy "memory photos read by couple" on storage.objects for select to authenticated
using (bucket_id = 'memory-photos' and strpos(name, '/') > 0
  and length(split_part(name, '/', 2)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));
create policy "memory photos upload by couple" on storage.objects for insert to authenticated
with check (bucket_id = 'memory-photos' and strpos(name, '/') > 0
  and length(split_part(name, '/', 2)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));
create policy "memory photos delete by couple" on storage.objects for delete to authenticated
using (bucket_id = 'memory-photos' and strpos(name, '/') > 0
  and length(split_part(name, '/', 2)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));

create policy "album media read couple" on storage.objects for select to authenticated
using (bucket_id = 'album-media' and strpos(name, '/') > 0
  and length(split_part(name, '/', 2)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));
create policy "album media upload couple" on storage.objects for insert to authenticated
with check (bucket_id = 'album-media' and strpos(name, '/') > 0
  and length(split_part(name, '/', 2)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));
create policy "album media delete couple" on storage.objects for delete to authenticated
using (bucket_id = 'album-media' and strpos(name, '/') > 0
  and length(split_part(name, '/', 2)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));

create policy "message media read by couple" on storage.objects for select to authenticated
using (bucket_id = 'message-media' and split_part(name, '/', 2) = 'messages'
  and length(split_part(name, '/', 3)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));
create policy "message media upload by couple" on storage.objects for insert to authenticated
with check (bucket_id = 'message-media' and split_part(name, '/', 2) = 'messages'
  and length(split_part(name, '/', 3)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));
create policy "message media delete by couple" on storage.objects for delete to authenticated
using (bucket_id = 'message-media' and split_part(name, '/', 2) = 'messages'
  and length(split_part(name, '/', 3)) > 0
  and lower(split_part(name, '/', 1)) in (select c::text from public.user_couple_ids() c));

-- 本地完整基础结构的权限收尾；只处理应用 public 表和 couple-media 配置。
-- 放在所有基础建表/升级之后、align_schema 的只读自检之前执行。

-- 旧的每日问答允许跨情侣读取“双方已答”的内容；同时收紧计数辅助函数。
do $finalize_daily_answers$
begin
  if to_regclass('public.daily_questions') is not null
    and to_regclass('public.daily_answers') is not null
    and to_regprocedure('public.is_couple_member(uuid,uuid)') is not null then
    execute $function$
      create or replace function public.daily_answer_count(target_question_id uuid)
      returns bigint
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select count(*)
        from public.daily_answers a
        join public.daily_questions q on q.id = a.question_id
        where a.question_id = target_question_id
          and public.is_couple_member(q.couple_id);
      $body$;
    $function$;

    drop policy if exists "answers read after both" on public.daily_answers;
    create policy "answers read after both" on public.daily_answers
      for select to authenticated
      using (
        exists (
          select 1 from public.daily_questions q
          where q.id = question_id and public.is_couple_member(q.couple_id)
        )
        and (user_id = auth.uid() or public.daily_answer_count(question_id) >= 2)
      );

    -- UPDATE 也必须验证问题归属，防止把自己的答案移入其他情侣的问题。
    drop policy if exists "answers update self" on public.daily_answers;
    create policy "answers update self" on public.daily_answers
      for update to authenticated
      using (
        user_id = auth.uid()
        and exists (
          select 1 from public.daily_questions q
          where q.id = question_id and public.is_couple_member(q.couple_id)
        )
      )
      with check (
        user_id = auth.uid()
        and exists (
          select 1 from public.daily_questions q
          where q.id = question_id and public.is_couple_member(q.couple_id)
        )
      );
  end if;
end
$finalize_daily_answers$;

-- 所有 public 应用表启用 RLS；保留策略原有范围，仅限定为登录角色。
-- PostgreSQL 的隐式 UPDATE 校验明确写出，便于验收和后续审计。
do $finalize_public_policies$
declare
  relation_row record;
  policy_row record;
begin
  for relation_row in
    select tablename from pg_catalog.pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', relation_row.tablename);
  end loop;

  for policy_row in
    select tablename, policyname, cmd, qual, with_check
    from pg_catalog.pg_policies where schemaname = 'public'
  loop
    execute format('alter policy %I on public.%I to authenticated',
      policy_row.policyname, policy_row.tablename);
    if policy_row.cmd in ('UPDATE', 'ALL') and policy_row.with_check is null then
      execute format('alter policy %I on public.%I with check (%s)',
        policy_row.policyname, policy_row.tablename, coalesce(policy_row.qual, 'false'));
    end if;
  end loop;
end
$finalize_public_policies$;

-- 新版本地 Supabase 不保证自动授予 API 权限：按实际 RLS 命令显式授权。
-- 不开放 TRUNCATE、REFERENCES、TRIGGER，也不开放没有策略的内部账号映射表。
do $finalize_public_grants$
declare
  relation_row record;
  operation_name text;
  whisper_columns text;
begin
  grant usage on schema public to authenticated, service_role;

  for relation_row in
    select tablename from pg_catalog.pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated',
      relation_row.tablename);
    execute format('grant all on table public.%I to service_role', relation_row.tablename);

    if relation_row.tablename = 'whispers' then
      -- 表级 REVOKE 不会移除既有列级授权；清除后仅恢复 read_at。
      select string_agg(format('%I', a.attname), ', ' order by a.attnum)
      into whisper_columns
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.whispers'::regclass
        and a.attnum > 0 and not a.attisdropped;
      if whisper_columns is not null then
        execute format('revoke update (%s) on table public.whispers from public, anon, authenticated',
          whisper_columns);
      end if;
    end if;

    if relation_row.tablename = 'account_usernames' then
      continue;
    end if;

    foreach operation_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if exists (
        select 1 from pg_catalog.pg_policies p
        where p.schemaname = 'public' and p.tablename = relation_row.tablename
          and p.cmd in (operation_name, 'ALL')
      ) then
        if relation_row.tablename = 'whispers' and operation_name = 'UPDATE' then
          if exists (
            select 1 from pg_catalog.pg_attribute a
            where a.attrelid = 'public.whispers'::regclass
              and a.attname = 'read_at' and a.attnum > 0 and not a.attisdropped
          ) then
            grant update (read_at) on public.whispers to authenticated;
          end if;
        else
          execute format('grant %s on table public.%I to authenticated',
            operation_name, relation_row.tablename);
        end if;
      end if;
    end loop;
  end loop;
end
$finalize_public_grants$;

-- 策略依赖的辅助函数显式授权，避免依赖默认 PUBLIC EXECUTE。
-- 不批量开放业务内部函数或触发器函数。
do $finalize_helper_grants$
declare
  function_name text;
  function_id regprocedure;
begin
  foreach function_name in array array[
    'public.user_couple_ids()',
    'public.is_couple_member(uuid,uuid)',
    'public.is_same_couple_user(uuid)',
    'public.daily_answer_count(uuid)'
  ] loop
    function_id := to_regprocedure(function_name);
    if function_id is not null then
      execute format('revoke all on function %s from public, anon', function_id);
      execute format('grant execute on function %s to authenticated, service_role', function_id);
    end if;
  end loop;
end
$finalize_helper_grants$;

-- 新的统一媒体 bucket；现有应用 bucket、对象和策略均保留。
do $finalize_couple_media$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('couple-media', 'couple-media', false)
    on conflict (id) do update set public = false;
  end if;

  if to_regclass('storage.objects') is not null
    and to_regprocedure('public.user_couple_ids()') is not null then
    drop policy if exists "couple media readable by members" on storage.objects;
    create policy "couple media readable by members" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'couple-media' and strpos(name, '/') > 0
        and length(split_part(name, '/', 2)) > 0
        and lower(split_part(name, '/', 1)) in
          (select c::text from public.user_couple_ids() c)
      );

    drop policy if exists "couple media insertable by members" on storage.objects;
    create policy "couple media insertable by members" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'couple-media' and strpos(name, '/') > 0
        and length(split_part(name, '/', 2)) > 0
        and lower(split_part(name, '/', 1)) in
          (select c::text from public.user_couple_ids() c)
      );

    drop policy if exists "couple media deletable by members" on storage.objects;
    create policy "couple media deletable by members" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'couple-media' and strpos(name, '/') > 0
        and length(split_part(name, '/', 2)) > 0
        and lower(split_part(name, '/', 1)) in
          (select c::text from public.user_couple_ids() c)
      );
  end if;
end
$finalize_couple_media$;

-- ⑧ 数据自检（必须位于文件末尾）

select 'couples' t, count(*) from public.couples
union all select 'couple_members', count(*) from public.couple_members
union all select 'memories', count(*) from public.memories
union all select 'albums', count(*) from public.albums
union all select 'anniversaries', count(*) from public.anniversaries;

do $$
declare n int;
begin
  select count(*) into n from public.couples;
  raise notice 'couples 现有 % 行', n;
end $$;
