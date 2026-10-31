-- 增量升级：保留所有旧列、主键、历史表和现有 RPC。
-- 前置条件：已有仓库的业务表（包括 setup_messages / upgrade_* 媒体配置）。
-- 只创建本次新增的表；异常数据会使整个事务回滚，不删除或截断旧数据。
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.messages') is null or to_regclass('public.album_photos') is null then
    raise exception '请先完成既有 messages / album_photos 安装，再运行增量升级';
  end if;
  if exists (select 1 from public.couple_members group by couple_id having count(*) > 2) then
    raise exception '存在超过两位成员的空间，请人工检查；本迁移不会删除成员';
  end if;
end $$;

lock table public.couples, public.couple_members, public.memories, public.albums,
  public.album_photos, public.anniversaries, public.messages in access exclusive mode;

alter table public.couples
  add column name_a text,
  add column name_b text,
  add column start_date date,
  add column if not exists cover_path text,
  add column settings jsonb not null default '{}'::jsonb;
alter table public.couple_members add column role text;
alter table public.memories
  add column date date,
  add column title text,
  add column body text,
  add column author_role text;
alter table public.albums add column title text;
alter table public.anniversaries
  add column target_date date,
  add column repeat_yearly boolean,
  add column icon text;
-- 默认值由 BEFORE 触发器补齐，避免旧客户端 recurring=false 被新默认值覆盖。
alter table public.anniversaries alter column recurring drop default;
alter table public.album_photos add column if not exists media_type text not null default 'image';
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_type text;

with ranked as (
  select m.couple_id, m.user_id,
    row_number() over (partition by m.couple_id
      order by (m.user_id = c.created_by) desc, m.joined_at, m.user_id) as n
  from public.couple_members m join public.couples c on c.id = m.couple_id
)
update public.couple_members m set role = case when r.n = 1 then 'a' else 'b' end
from ranked r where m.couple_id = r.couple_id and m.user_id = r.user_id;

update public.couples c set
  name_a = coalesce((select p.display_name from public.couple_members m
    join public.profiles p on p.id = m.user_id where m.couple_id = c.id and m.role = 'a'),
    (select p.display_name from public.profiles p where p.id = c.created_by), ''),
  name_b = coalesce((select p.display_name from public.couple_members m
    join public.profiles p on p.id = m.user_id where m.couple_id = c.id and m.role = 'b'), ''),
  start_date = relationship_start;
update public.memories m set date = memory_date,
  title = left(split_part(content, E'\n', 1), 120), body = content,
  author_role = (select role from public.couple_members cm
    where cm.couple_id = m.couple_id and cm.user_id = m.author_id);
update public.albums set title = name;
update public.anniversaries set target_date = event_date, repeat_yearly = recurring;

alter table public.couples alter column name_a set not null,
  alter column name_b set not null, alter column start_date set not null;
alter table public.couple_members alter column role set not null,
  add constraint couple_members_role_check check (role in ('a', 'b')),
  add constraint couple_members_couple_role_key unique (couple_id, role);
alter table public.memories alter column date set not null, alter column title set not null,
  add constraint memories_author_role_check check (author_role in ('a', 'b'));
alter table public.albums alter column title set not null;
alter table public.anniversaries alter column target_date set not null,
  alter column repeat_yearly set not null;

-- 成员的旧 profiles 外键仍保留；profiles.id 已经引用 auth.users.id。
-- 角色是稳定标识，不能通过修改成员行互换；锁父行串行分配空位。
create function public.love_assign_member_role() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.couple_id, new.user_id, new.role) is distinct from
       (old.couple_id, old.user_id, old.role) then
      raise exception '成员归属和角色不可修改';
    end if;
    return new;
  end if;
  perform 1 from public.couples where id = new.couple_id for update;
  if new.role is null then
    new.role := case when exists (select 1 from public.couple_members
      where couple_id = new.couple_id and role = 'a') then 'b' else 'a' end;
  end if;
  return new;
end $$;
create trigger love_assign_member_role before insert or update on public.couple_members
for each row execute function public.love_assign_member_role();

create function public.love_fill_member_name() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.couples set
    name_a = case when new.role = 'a' and name_a = '' then
      coalesce((select display_name from public.profiles where id = new.user_id), '') else name_a end,
    name_b = case when new.role = 'b' and name_b = '' then
      coalesce((select display_name from public.profiles where id = new.user_id), '') else name_b end
  where id = new.couple_id;
  return new;
end $$;
create trigger love_fill_member_name after insert on public.couple_members
for each row execute function public.love_fill_member_name();

-- 新旧字段两边都能写。UPDATE 只传播被修改的一边；冲突直接报错。
create function public.love_sync_core_fields() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v jsonb := to_jsonb(new);
  prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  pair text[];
  pairs text[][];
  chosen jsonb;
  member_role text;
begin
  case tg_table_name
    when 'couples' then pairs := array[['start_date', 'relationship_start']];
    when 'memories' then pairs := array[['date', 'memory_date']];
    when 'albums' then pairs := array[['title', 'name']];
    when 'anniversaries' then pairs := array[['target_date', 'event_date'], ['repeat_yearly', 'recurring']];
  end case;
  foreach pair slice 1 in array pairs loop
    if tg_op = 'INSERT' then
      if v->>pair[1] is not null and v->>pair[2] is not null
        and v->pair[1] is distinct from v->pair[2] then
        raise exception '字段 % 与 % 冲突', pair[1], pair[2];
      end if;
      chosen := coalesce(nullif(v->pair[1], 'null'::jsonb), nullif(v->pair[2], 'null'::jsonb));
      if chosen is null and pair[1] = 'repeat_yearly' then chosen := 'true'::jsonb; end if;
    elsif v->pair[1] is distinct from prev->pair[1] then
      if v->pair[2] is distinct from prev->pair[2] and v->pair[1] is distinct from v->pair[2] then
        raise exception '字段 % 与 % 冲突', pair[1], pair[2];
      end if;
      chosen := v->pair[1];
    else
      chosen := v->pair[2];
    end if;
    v := v || jsonb_build_object(pair[1], chosen, pair[2], chosen);
  end loop;
  new := jsonb_populate_record(new, v);

  if tg_table_name = 'couples' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.name_a := coalesce(new.name_a,
      (select display_name from public.profiles where id = new.created_by), '');
    new.name_b := coalesce(new.name_b, '');
    new.name := coalesce(new.name, left(new.name_a || ' & ' || new.name_b, 40));
    if tg_op = 'UPDATE' then
      if (new.id, new.created_at) is distinct from (old.id, old.created_at)
        or (new.created_by is distinct from old.created_by and current_user in ('anon', 'authenticated')) then
        raise exception '空间归属不可修改';
      end if;
    end if;
  elsif tg_table_name = 'memories' then
    if tg_op = 'INSERT' then
      new.author_id := coalesce(new.author_id, auth.uid());
      if new.body is not null and new.content is not null and new.body <> new.content then
        raise exception 'body 与 content 冲突';
      end if;
      new.body := coalesce(new.body, new.content);
      new.content := coalesce(new.body, new.title);
      new.title := coalesce(new.title, left(split_part(new.content, E'\n', 1), 120));
    else
      if (new.id, new.couple_id, new.created_at) is distinct from (old.id, old.couple_id, old.created_at)
        or (new.author_id is distinct from old.author_id and current_user in ('anon', 'authenticated')) then
        raise exception '记忆归属不可修改';
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
    select role into member_role from public.couple_members
      where couple_id = new.couple_id and user_id = new.author_id;
    if tg_op = 'UPDATE' and new.author_id is distinct from old.author_id then
      -- 既有 SECURITY DEFINER 账号移交 RPC 可以转移作者；普通 API 不能修改作者。
      new.author_role := member_role;
    elsif new.author_role is not null and new.author_role is distinct from member_role then
      raise exception 'author_role 必须与实际作者角色一致';
    end if;
    new.author_role := member_role;
  else
    new.created_by := coalesce(new.created_by, auth.uid());
    if tg_op = 'UPDATE' then
      if (new.id, new.couple_id, new.created_at) is distinct from (old.id, old.couple_id, old.created_at)
        or (new.created_by is distinct from old.created_by and current_user in ('anon', 'authenticated')) then
        raise exception '记录归属不可修改';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger love_sync_core before insert or update on public.couples
for each row execute function public.love_sync_core_fields();
create trigger love_sync_core before insert or update on public.memories
for each row execute function public.love_sync_core_fields();
create trigger love_sync_core before insert or update on public.albums
for each row execute function public.love_sync_core_fields();
create trigger love_sync_core before insert or update on public.anniversaries
for each row execute function public.love_sync_core_fields();

create table public.memory_media (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('photo', 'video')),
  taken_at date,
  created_at timestamptz not null default now(),
  unique (memory_id, storage_path)
);
create table public.album_media (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('photo', 'video')),
  taken_at date,
  created_at timestamptz not null default now()
);
create table public.whispers (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text,
  media_path text,
  media_type text check (media_type in ('photo', 'video', 'voice')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index album_media_album_idx on public.album_media(album_id);
create index whispers_couple_created_idx on public.whispers(couple_id, created_at desc);

-- 旧 JSON 始终保留。无路径的展示项和重复路径不会被移除。
insert into public.memory_media(memory_id, storage_path, media_type, created_at)
select distinct m.id, photo->>'path', 'photo', m.created_at
from public.memories m cross join lateral jsonb_array_elements(m.photos) photo
where jsonb_typeof(photo->'path') = 'string' and photo->>'path' <> '';
insert into public.album_media(id, album_id, storage_path, media_type, taken_at, created_at)
select id, album_id, path, case when media_type = 'video' then 'video' else 'photo' end,
  taken_date, created_at from public.album_photos;
insert into public.whispers(id, couple_id, sender_id, body, media_path, media_type, read_at, created_at)
select id, couple_id, sender_id, content, coalesce(media_path, image_path),
  case media_type when 'audio' then 'voice' when 'video' then 'video' when 'image' then 'photo'
    else case when coalesce(media_path, image_path) is not null then 'photo' end end,
  read_at, created_at from public.messages;

-- 旧表 -> 新表。只有从已受 RLS/约束保护的旧行触发时才提升权限。
-- depth 用于避免双向同步递归，不承担权限检查。
create function public.love_mirror_legacy() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_table_name = 'memories' then
    if exists (select 1 from public.memory_media mm where mm.memory_id = new.id and mm.media_type = 'video'
      and exists (select 1 from jsonb_array_elements(new.photos) p where p->>'path' = mm.storage_path)) then
      raise exception '同一路径不能同时作为照片和视频';
    end if;
    delete from public.memory_media mm where mm.memory_id = new.id and mm.media_type = 'photo'
      and not exists (select 1 from jsonb_array_elements(new.photos) p where p->>'path' = mm.storage_path);
    insert into public.memory_media(memory_id, storage_path, media_type, taken_at, created_at)
    select distinct new.id, p->>'path', 'photo', null::date, new.created_at
      from jsonb_array_elements(new.photos) p
      where jsonb_typeof(p->'path') = 'string' and p->>'path' <> ''
    on conflict (memory_id, storage_path) do nothing;
  elsif tg_table_name = 'album_photos' then
    if tg_op = 'DELETE' then
      delete from public.album_media where id = old.id;
    else
      insert into public.album_media(id, album_id, storage_path, media_type, taken_at, created_at)
      values(new.id, new.album_id, new.path, case when new.media_type = 'video' then 'video' else 'photo' end,
        new.taken_date, new.created_at)
      on conflict (id) do update set album_id = excluded.album_id, storage_path = excluded.storage_path,
        media_type = excluded.media_type, taken_at = excluded.taken_at, created_at = excluded.created_at;
    end if;
  elsif tg_table_name = 'messages' then
    if tg_op = 'DELETE' then
      delete from public.whispers where id = old.id;
    else
      insert into public.whispers(id, couple_id, sender_id, body, media_path, media_type, read_at, created_at)
      values(new.id, new.couple_id, new.sender_id, new.content, coalesce(new.media_path, new.image_path),
        case new.media_type when 'audio' then 'voice' when 'video' then 'video' when 'image' then 'photo'
          else case when coalesce(new.media_path, new.image_path) is not null then 'photo' end end,
        new.read_at, new.created_at)
      on conflict (id) do update set couple_id = excluded.couple_id, sender_id = excluded.sender_id,
        body = excluded.body, media_path = excluded.media_path, media_type = excluded.media_type,
        read_at = excluded.read_at, created_at = excluded.created_at;
    end if;
  end if;
  return null;
end $$;
create trigger love_mirror_memories after insert or update of photos on public.memories
for each row execute function public.love_mirror_legacy();
create trigger love_mirror_album after insert or update or delete on public.album_photos
for each row execute function public.love_mirror_legacy();
create trigger love_mirror_messages after insert or update or delete on public.messages
for each row execute function public.love_mirror_legacy();

-- 新表 -> 旧表：以调用者身份写入，旧表 RLS 和内容不可修改保护仍然生效。
create function public.love_write_legacy() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  parent public.memories%rowtype;
  item jsonb;
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'memory_media' then
    if tg_op = 'UPDATE' and (new.id, new.memory_id, new.storage_path, new.media_type, new.created_at)
      is distinct from (old.id, old.memory_id, old.storage_path, old.media_type, old.created_at) then
      raise exception '媒体归属、路径和类型不可修改，请删除后重新添加';
    end if;
    select * into parent from public.memories
      where id = case when tg_op = 'DELETE' then old.memory_id else new.memory_id end for update;
    if not found then raise exception '无法访问记忆' using errcode = '42501'; end if;
    if (case when tg_op = 'DELETE' then old.media_type else new.media_type end) = 'photo' then
      if tg_op = 'INSERT' then
        item := jsonb_build_object('path', new.storage_path);
        update public.memories set photos = photos || jsonb_build_array(item), updated_at = now() where id = parent.id;
      elsif tg_op = 'DELETE' then
        update public.memories set photos = coalesce((select jsonb_agg(p order by n)
          from jsonb_array_elements(photos) with ordinality x(p, n)
          where p->>'path' is distinct from old.storage_path), '[]'::jsonb), updated_at = now() where id = parent.id;
      end if;
      if tg_op <> 'UPDATE' and not found then raise exception '只有作者能修改记忆媒体' using errcode = '42501'; end if;
    end if;
  elsif tg_table_name = 'album_media' then
    if tg_op = 'INSERT' then
      new.taken_at := coalesce(new.taken_at, current_date);
      insert into public.album_photos(id, album_id, uploaded_by, path, media_type, taken_date, created_at)
      values(new.id, new.album_id, auth.uid(), new.storage_path,
        case when new.media_type = 'photo' then 'image' else new.media_type end, new.taken_at, new.created_at);
    elsif tg_op = 'DELETE' then
      delete from public.album_photos where id = old.id;
      if not found then raise exception '无权删除相册媒体' using errcode = '42501'; end if;
    else
      raise exception '相册媒体沿用旧表权限，请删除后重新添加';
    end if;
  elsif tg_table_name = 'whispers' then
    if tg_op = 'INSERT' then
      insert into public.messages(id, couple_id, sender_id, content, media_path, media_type, read_at, created_at)
      values(new.id, new.couple_id, new.sender_id, new.body, new.media_path,
        case new.media_type when 'photo' then 'image' when 'voice' then 'audio' else new.media_type end,
        new.read_at, new.created_at);
    elsif tg_op = 'UPDATE' then
      if (new.id, new.couple_id, new.sender_id, new.body, new.media_path, new.media_type, new.created_at)
        is distinct from (old.id, old.couple_id, old.sender_id, old.body, old.media_path, old.media_type, old.created_at) then
        raise exception '悄悄话只允许收件人标记已读';
      end if;
      update public.messages set read_at = new.read_at where id = old.id;
      if not found then raise exception '无权标记已读' using errcode = '42501'; end if;
    else
      delete from public.messages where id = old.id;
      if not found then raise exception '无权删除悄悄话' using errcode = '42501'; end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger love_write_memory before insert or update or delete on public.memory_media
for each row execute function public.love_write_legacy();
create trigger love_write_album before insert or update or delete on public.album_media
for each row execute function public.love_write_legacy();
create trigger love_write_whispers before insert or update or delete on public.whispers
for each row execute function public.love_write_legacy();

alter table public.memory_media enable row level security;
alter table public.album_media enable row level security;
alter table public.whispers enable row level security;
create policy "memory media read by couple" on public.memory_media for select to authenticated
using (exists (select 1 from public.memories m where m.id = memory_id and public.is_couple_member(m.couple_id)));
create policy "memory media create by author" on public.memory_media for insert to authenticated
with check (exists (select 1 from public.memories m where m.id = memory_id
  and m.author_id = auth.uid() and public.is_couple_member(m.couple_id)));
create policy "memory media update by author" on public.memory_media for update to authenticated
using (exists (select 1 from public.memories m where m.id = memory_id
  and m.author_id = auth.uid() and public.is_couple_member(m.couple_id)))
with check (exists (select 1 from public.memories m where m.id = memory_id
  and m.author_id = auth.uid() and public.is_couple_member(m.couple_id)));
create policy "memory media delete by author" on public.memory_media for delete to authenticated
using (exists (select 1 from public.memories m where m.id = memory_id
  and m.author_id = auth.uid() and public.is_couple_member(m.couple_id)));
create policy "album media read by couple" on public.album_media for select to authenticated
using (exists (select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)));
create policy "album media create by couple" on public.album_media for insert to authenticated
with check (exists (select 1 from public.albums a where a.id = album_id and public.is_couple_member(a.couple_id)));
create policy "album media delete by legacy permission" on public.album_media for delete to authenticated
using (exists (select 1 from public.album_photos p join public.albums a on a.id = p.album_id
  where p.id = album_media.id and public.is_couple_member(a.couple_id)));
create policy "whispers read by couple" on public.whispers for select to authenticated
using (public.is_couple_member(couple_id));
create policy "whispers create by sender" on public.whispers for insert to authenticated
with check (public.is_couple_member(couple_id) and sender_id = auth.uid());
create policy "whispers update recipient" on public.whispers for update to authenticated
using (public.is_couple_member(couple_id) and sender_id <> auth.uid())
with check (public.is_couple_member(couple_id) and sender_id <> auth.uid());
create policy "whispers delete sender" on public.whispers for delete to authenticated
using (public.is_couple_member(couple_id) and sender_id = auth.uid());

revoke all on public.memory_media, public.album_media, public.whispers from public, anon, authenticated;
grant select, insert, update, delete on public.memory_media, public.whispers to authenticated;
grant select, insert, delete on public.album_media to authenticated;
grant all on public.memory_media, public.album_media, public.whispers to service_role;
revoke all on function public.love_assign_member_role() from public;
revoke all on function public.love_fill_member_name() from public;
revoke all on function public.love_sync_core_fields() from public;
revoke all on function public.love_mirror_legacy() from public;
revoke all on function public.love_write_legacy() from public;

comment on column public.couples.name is '兼容旧客户端的空间名称，独立于两位成员姓名';
comment on column public.couples.name_b is '未加入第二位成员时为空字符串；加入时自动补齐';
comment on table public.memory_media is '旧 photos 的路径投影和新增视频；旧 JSON 的缩略图等元数据保留不变';
comment on table public.album_media is '与 album_photos 同 ID 同步，沿用旧表写入权限及日期默认值';
comment on table public.whispers is '与 messages 同 ID 双向同步，收件人只可修改 read_at';
notify pgrst, 'reload schema';
commit;
