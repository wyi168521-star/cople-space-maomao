-- CoupleSpace：全新本地数据库的连贯基础结构。
-- 原迁移完整归档于 supabase/legacy-migrations/，没有丢弃仍在使用的业务表。
-- messages / couple_letters 等基础表先创建，再执行依赖它们的历史升级。
-- 此合并历史用于本地重新初始化；现有部署继续使用原有迁移历史。
-- 由 node supabase/scripts/rebuild-baseline.mjs 根据带哈希的来源清单生成。

begin;

-- ============================================================================
-- SOURCE: legacy-migrations/001_auth_and_couples.sql
-- SHA256: 622e6feb0048aabfb700d0815e5a1a1364939d420092ecc94de647afe6cb3f4f
-- ============================================================================
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  relationship_start date not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();
  end if;
end $$;

create or replace function public.create_couple_with_invitation(couple_name text, relationship_start date)
returns text language plpgsql security definer set search_path = public as $$
declare
  new_couple_id uuid;
  new_code text;
begin
  if exists (select 1 from couple_members where user_id = auth.uid()) then
    raise exception '你已经加入了一个情侣空间';
  end if;
  insert into couples (name, relationship_start, created_by)
  values (couple_name, relationship_start, auth.uid()) returning id into new_couple_id;
  insert into couple_members (couple_id, user_id) values (new_couple_id, auth.uid());
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into invitations (couple_id, code, created_by) values (new_couple_id, new_code, auth.uid());
  return new_code;
end;
$$;

create or replace function public.accept_couple_invitation(invitation_code text)
returns void language plpgsql security definer set search_path = public as $$
declare target invitations%rowtype;
begin
  if exists (select 1 from couple_members where user_id = auth.uid()) then
    raise exception '你已经加入了一个情侣空间';
  end if;
  select * into target from invitations
  where code = upper(invitation_code) and accepted_at is null and expires_at > now()
  for update;
  if target.id is null then raise exception '邀请码无效或已过期'; end if;
  if (select count(*) from couple_members where couple_id = target.couple_id) >= 2 then
    raise exception '这个空间已经有两位成员';
  end if;
  insert into couple_members (couple_id, user_id) values (target.couple_id, auth.uid());
  update invitations set accepted_by = auth.uid(), accepted_at = now() where id = target.id;
end;
$$;

alter table profiles enable row level security;
alter table couples enable row level security;
alter table couple_members enable row level security;
alter table invitations enable row level security;

create or replace function public.is_couple_member(target_couple_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target_couple_id and user_id = target_user_id
  );
$$;

drop policy if exists "profiles read self" on profiles;
drop policy if exists "profiles update self" on profiles;
drop policy if exists "members read own couple" on couple_members;
drop policy if exists "couples read as member" on couples;
drop policy if exists "couples update as member" on couples;
drop policy if exists "invitations read creator" on invitations;
create policy "profiles read self" on profiles for select using (id = auth.uid());
create policy "profiles update self" on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "members read own couple" on couple_members for select using (public.is_couple_member(couple_id));
create policy "couples read as member" on couples for select using (
  public.is_couple_member(id)
);
create policy "couples update as member" on couples for update using (
  public.is_couple_member(id)
);
create policy "invitations read creator" on invitations for select using (created_by = auth.uid());

revoke all on function public.create_couple_with_invitation(text, date) from public;
revoke all on function public.accept_couple_invitation(text) from public;
grant execute on function public.create_couple_with_invitation(text, date) to authenticated;
grant execute on function public.accept_couple_invitation(text) to authenticated;

-- ============================================================================
-- SOURCE: legacy-migrations/002_memories.sql
-- SHA256: 02035403b9dc8c2507ab302e010b753a537828dd78cba4ee77f006db6530e7df
-- ============================================================================
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null check (char_length(content) between 1 and 1000),
  memory_date date not null,
  location text check (location is null or char_length(location) <= 80),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_couple_date_idx on public.memories (couple_id, memory_date desc);
alter table public.memories enable row level security;
drop policy if exists "memories read by couple" on public.memories;
drop policy if exists "memories create by couple" on public.memories;
drop policy if exists "memories update by author" on public.memories;
drop policy if exists "memories delete by author" on public.memories;
create policy "memories read by couple" on public.memories for select using (public.is_couple_member(couple_id));
create policy "memories create by couple" on public.memories for insert with check (public.is_couple_member(couple_id) and author_id = auth.uid());
create policy "memories update by author" on public.memories for update using (author_id = auth.uid() and public.is_couple_member(couple_id)) with check (author_id = auth.uid() and public.is_couple_member(couple_id));
create policy "memories delete by author" on public.memories for delete using (author_id = auth.uid() and public.is_couple_member(couple_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-photos', 'memory-photos', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "memory photos read by couple" on storage.objects;
drop policy if exists "memory photos upload by couple" on storage.objects;
drop policy if exists "memory photos delete by couple" on storage.objects;
create policy "memory photos read by couple" on storage.objects for select using (
  bucket_id = 'memory-photos' and public.is_couple_member((storage.foldername(name))[1]::uuid)
);
create policy "memory photos upload by couple" on storage.objects for insert with check (
  bucket_id = 'memory-photos' and public.is_couple_member((storage.foldername(name))[1]::uuid)
);
create policy "memory photos delete by couple" on storage.objects for delete using (
  bucket_id = 'memory-photos' and public.is_couple_member((storage.foldername(name))[1]::uuid)
);

-- ============================================================================
-- SOURCE: legacy-migrations/003_ai_saved_works.sql
-- SHA256: 466e0d41058ef005669fbd5243190a08afadaea244eee0720467cb63496a79d1
-- ============================================================================
create table if not exists public.ai_saved_works(
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 user_id uuid not null references public.profiles(id),kind text not null check(kind in ('diary','love_letter')),
 work_date date not null default current_date,title text not null,content text not null check(char_length(content) between 1 and 5000),
 memory_id uuid references public.memories(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists ai_saved_diary_per_day on public.ai_saved_works(couple_id,kind,work_date) where kind='diary';
alter table public.ai_saved_works enable row level security;
drop policy if exists "ai works read couple" on public.ai_saved_works;drop policy if exists "ai works write couple" on public.ai_saved_works;drop policy if exists "ai works update couple" on public.ai_saved_works;drop policy if exists "ai works delete couple" on public.ai_saved_works;
create policy "ai works read couple" on public.ai_saved_works for select using(public.is_couple_member(couple_id));
create policy "ai works write couple" on public.ai_saved_works for insert with check(user_id=auth.uid() and public.is_couple_member(couple_id));
create policy "ai works update couple" on public.ai_saved_works for update using(public.is_couple_member(couple_id)) with check(public.is_couple_member(couple_id));
create policy "ai works delete couple" on public.ai_saved_works for delete using(public.is_couple_member(couple_id));
notify pgrst,'reload schema';

-- ============================================================================
-- SOURCE: legacy-migrations/003001_albums.sql
-- SHA256: 34559c9586a93c4256ed93533f766bbca67cded8a2269d5d7a0afd62af4367dc
-- ============================================================================
create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null references public.profiles(id), name text not null check (char_length(name) between 1 and 40),
  description text check (description is null or char_length(description) <= 160), cover_path text, created_at timestamptz not null default now()
);
create table if not exists public.album_photos (
  id uuid primary key default gen_random_uuid(), album_id uuid not null references public.albums(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id), path text not null unique, caption text check (caption is null or char_length(caption) <= 200),
  taken_date date not null default current_date, created_at timestamptz not null default now()
);
alter table public.albums enable row level security; alter table public.album_photos enable row level security;
drop policy if exists "albums read by couple" on public.albums; drop policy if exists "albums create by couple" on public.albums; drop policy if exists "albums update by creator" on public.albums; drop policy if exists "albums delete by creator" on public.albums;
create policy "albums read by couple" on public.albums for select using (public.is_couple_member(couple_id));
create policy "albums create by couple" on public.albums for insert with check (public.is_couple_member(couple_id) and created_by = auth.uid());
create policy "albums update by creator" on public.albums for update using (created_by = auth.uid());
create policy "albums delete by creator" on public.albums for delete using (created_by = auth.uid());
drop policy if exists "album photos read by couple" on public.album_photos; drop policy if exists "album photos create by couple" on public.album_photos; drop policy if exists "album photos delete by uploader" on public.album_photos;
create policy "album photos read by couple" on public.album_photos for select using (exists(select 1 from public.albums where id = album_id and public.is_couple_member(couple_id)));
create policy "album photos create by couple" on public.album_photos for insert with check (uploaded_by = auth.uid() and exists(select 1 from public.albums where id = album_id and public.is_couple_member(couple_id)));
create policy "album photos delete by uploader" on public.album_photos for delete using (uploaded_by = auth.uid());

-- ============================================================================
-- SOURCE: legacy-migrations/004_together_list.sql
-- SHA256: 41cc590fe33f424b4d0f100b839d8c8f469c2e4217e0a72b0f77b5d7cd1ad72d
-- ============================================================================
create table if not exists public.together_items (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null references public.profiles(id), title text not null check(char_length(title) between 1 and 100),
  note text check(note is null or char_length(note)<=500), category text not null check(category in('wish','travel','movie','date')),
  priority text not null default 'normal' check(priority in('low','normal','high')), planned_date date,
  completed boolean not null default false, completed_by uuid references public.profiles(id), completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists together_items_couple_idx on public.together_items(couple_id,completed,created_at desc);
alter table public.together_items enable row level security;
drop policy if exists "list read by couple" on public.together_items;drop policy if exists "list create by couple" on public.together_items;drop policy if exists "list update by couple" on public.together_items;drop policy if exists "list delete by creator" on public.together_items;
create policy "list read by couple" on public.together_items for select using(public.is_couple_member(couple_id));
create policy "list create by couple" on public.together_items for insert with check(public.is_couple_member(couple_id) and created_by=auth.uid());
create policy "list update by couple" on public.together_items for update using(public.is_couple_member(couple_id)) with check(public.is_couple_member(couple_id) and (completed_by is null or public.is_couple_member(couple_id,completed_by)));
create policy "list delete by creator" on public.together_items for delete using(created_by=auth.uid());

-- ============================================================================
-- SOURCE: legacy-migrations/005_anniversaries.sql
-- SHA256: dfb08d55b7bec67d03197103a6acf3187c33d2bccbffb8cabdd42a23f2d71062
-- ============================================================================
create table if not exists public.anniversaries(
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 created_by uuid not null references public.profiles(id),title text not null check(char_length(title) between 1 and 80),
 event_date date not null,kind text not null default 'custom' check(kind in('anniversary','birthday','travel','custom')),
 recurring boolean not null default true,note text check(note is null or char_length(note)<=300),created_at timestamptz not null default now()
);
create index if not exists anniversaries_couple_idx on public.anniversaries(couple_id,event_date);
alter table public.anniversaries enable row level security;
drop policy if exists "anniversaries read by couple" on public.anniversaries;drop policy if exists "anniversaries create by couple" on public.anniversaries;drop policy if exists "anniversaries update by couple" on public.anniversaries;drop policy if exists "anniversaries delete by creator" on public.anniversaries;
create policy "anniversaries read by couple" on public.anniversaries for select using(public.is_couple_member(couple_id));
create policy "anniversaries create by couple" on public.anniversaries for insert with check(public.is_couple_member(couple_id) and created_by=auth.uid());
create policy "anniversaries update by couple" on public.anniversaries for update using(public.is_couple_member(couple_id)) with check(public.is_couple_member(couple_id));
create policy "anniversaries delete by creator" on public.anniversaries for delete using(created_by=auth.uid());

-- ============================================================================
-- SOURCE: setup_messages.sql
-- SHA256: 77bc52695d5586a095b5fae6d57911d4243064696543ab824affcc01a2ca81a8
-- ============================================================================
create table if not exists public.messages(
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),content text check(content is null or char_length(content)<=2000),
 image_path text,read_at timestamptz,created_at timestamptz not null default now(),
 check(content is not null or image_path is not null)
);
create index if not exists messages_couple_created_idx on public.messages(couple_id,created_at desc);
alter table public.messages enable row level security;
drop policy if exists "messages read by couple" on public.messages;drop policy if exists "messages create by couple" on public.messages;drop policy if exists "messages update recipient" on public.messages;drop policy if exists "messages delete sender" on public.messages;
create policy "messages read by couple" on public.messages for select using(public.is_couple_member(couple_id));
create policy "messages create by couple" on public.messages for insert with check(public.is_couple_member(couple_id) and sender_id=auth.uid());
create policy "messages update recipient" on public.messages for update using(public.is_couple_member(couple_id) and sender_id<>auth.uid()) with check(public.is_couple_member(couple_id));
create policy "messages delete sender" on public.messages for delete using(sender_id=auth.uid());
drop policy if exists "message images read by couple" on storage.objects;drop policy if exists "message images upload by couple" on storage.objects;
create policy "message images read by couple" on storage.objects for select using(bucket_id='memory-photos' and (storage.foldername(name))[2]='messages' and public.is_couple_member((storage.foldername(name))[1]::uuid));
create policy "message images upload by couple" on storage.objects for insert with check(bucket_id='memory-photos' and (storage.foldername(name))[2]='messages' and public.is_couple_member((storage.foldername(name))[1]::uuid));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
  alter publication supabase_realtime add table public.messages;
 end if;
end $$;

-- ============================================================================
-- SOURCE: upgrade_message_media.sql
-- SHA256: 65b52ae55328d80f37ae82871fbd37c10fa6f82e2642a348f71251d4d740110f
-- ============================================================================
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_type text;
alter table public.messages drop constraint if exists messages_check;
alter table public.messages drop constraint if exists messages_content_or_media_check;
alter table public.messages add constraint messages_content_or_media_check check(content is not null or image_path is not null or media_path is not null);
alter table public.messages drop constraint if exists messages_media_type_check;
alter table public.messages add constraint messages_media_type_check check(media_type is null or media_type in ('image','video','audio'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('message-media','message-media',false,41943040,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "message media read by couple" on storage.objects;
drop policy if exists "message media upload by couple" on storage.objects;
drop policy if exists "message media delete by couple" on storage.objects;
create policy "message media read by couple" on storage.objects for select using(bucket_id='message-media' and (storage.foldername(name))[2]='messages' and public.is_couple_member((storage.foldername(name))[1]::uuid));
create policy "message media upload by couple" on storage.objects for insert with check(bucket_id='message-media' and (storage.foldername(name))[2]='messages' and public.is_couple_member((storage.foldername(name))[1]::uuid));
create policy "message media delete by couple" on storage.objects for delete using(bucket_id='message-media' and (storage.foldername(name))[2]='messages' and public.is_couple_member((storage.foldername(name))[1]::uuid));

-- ============================================================================
-- SOURCE: upgrade_album_media.sql
-- SHA256: f1305335025d2110c6820493c99b64ad87c2c0796723e78db35801e171c4b53a
-- ============================================================================
alter table public.album_photos add column if not exists media_type text not null default 'image';
alter table public.album_photos drop constraint if exists album_photos_media_type_check;
alter table public.album_photos add constraint album_photos_media_type_check check(media_type in ('image','video'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('album-media','album-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "album media read couple" on storage.objects;drop policy if exists "album media upload couple" on storage.objects;drop policy if exists "album media delete uploader" on storage.objects;
create policy "album media read couple" on storage.objects for select using(bucket_id='album-media' and public.is_couple_member((storage.foldername(name))[1]::uuid));
create policy "album media upload couple" on storage.objects for insert with check(bucket_id='album-media' and public.is_couple_member((storage.foldername(name))[1]::uuid));
create policy "album media delete uploader" on storage.objects for delete using(bucket_id='album-media' and public.is_couple_member((storage.foldername(name))[1]::uuid));
notify pgrst,'reload schema';

-- ============================================================================
-- SOURCE: upgrade_couple_letters.sql
-- SHA256: 9d8c9c5ea72e5fa89d48f33c31d9ba718e1c1c896956fd90660e72989ab99638
-- ============================================================================
create table if not exists public.couple_letters(
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),recipient_id uuid not null references public.profiles(id),
 content text not null check(char_length(content) between 1 and 1200),created_at timestamptz not null default now(),
 check(sender_id<>recipient_id)
);
create index if not exists couple_letters_recipient_idx on public.couple_letters(couple_id,recipient_id,created_at desc);
alter table public.couple_letters enable row level security;
drop policy if exists "letters read couple" on public.couple_letters;drop policy if exists "letters send to partner" on public.couple_letters;drop policy if exists "letters delete sender" on public.couple_letters;
create policy "letters read couple" on public.couple_letters for select using(public.is_couple_member(couple_id) and (sender_id=auth.uid() or recipient_id=auth.uid()));
create policy "letters send to partner" on public.couple_letters for insert with check(sender_id=auth.uid() and public.is_couple_member(couple_id) and exists(select 1 from public.couple_members cm where cm.couple_id=couple_letters.couple_id and cm.user_id=recipient_id));
create policy "letters delete sender" on public.couple_letters for delete using(sender_id=auth.uid());
notify pgrst,'reload schema';

-- ============================================================================
-- SOURCE: setup_account_management.sql
-- SHA256: 0c90a36a633ee6022ea19b583bd5bcaa7f8cdd8673a0c2075ff7d3c078049f13
-- ============================================================================
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
drop policy if exists "avatars read by authenticated" on storage.objects;drop policy if exists "avatars upload own" on storage.objects;drop policy if exists "avatars update own" on storage.objects;
create policy "avatars read by authenticated" on storage.objects for select to authenticated using(bucket_id='avatars');
create policy "avatars upload own" on storage.objects for insert to authenticated with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "avatars update own" on storage.objects for update to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create or replace function public.get_couple_profiles() returns table(user_id uuid,display_name text,avatar_url text) language sql stable security definer set search_path=public as $$ select p.id,p.display_name,p.avatar_url from profiles p join couple_members cm on cm.user_id=p.id where cm.couple_id=(select couple_id from couple_members where user_id=auth.uid()) $$;
create or replace function public.regenerate_couple_invitation() returns text language plpgsql security definer set search_path=public as $$ declare cid uuid;code text;begin select couple_id into cid from couple_members where user_id=auth.uid();if cid is null then raise exception '尚未加入情侣空间';end if;update invitations set expires_at=now() where couple_id=cid and accepted_at is null;code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));insert into invitations(couple_id,code,created_by)values(cid,code,auth.uid());return code;end;$$;
create or replace function public.leave_couple_space() returns void language plpgsql security definer set search_path=public as $$ begin delete from couple_members where user_id=auth.uid();end;$$;
revoke all on function public.get_couple_profiles() from public;revoke all on function public.regenerate_couple_invitation() from public;revoke all on function public.leave_couple_space() from public;
grant execute on function public.get_couple_profiles() to authenticated;grant execute on function public.regenerate_couple_invitation() to authenticated;grant execute on function public.leave_couple_space() to authenticated;

-- ============================================================================
-- SOURCE: setup_couple_cover.sql
-- SHA256: 809de3009211f0c12407b0188b6a540b96db8c450b39aca107e6e82ffec5697c
-- ============================================================================
alter table public.couples add column if not exists cover_path text;
notify pgrst, 'reload schema';

-- ============================================================================
-- SOURCE: upgrade_love_letter.sql
-- SHA256: c76fd194a0ea3fa66e9bd5f3aeb2a840e0fccef63b7dab670c5f98a009a0fc8f
-- ============================================================================
alter table public.couples add column if not exists love_letter text check(love_letter is null or char_length(love_letter) <= 1200);

-- ============================================================================
-- SOURCE: upgrade_ai_date_plans.sql
-- SHA256: e7d566131ec431743de5a6407758bea218f73347ff8e09400b7f71f3bfbaaffb
-- ============================================================================
alter table public.ai_saved_works drop constraint if exists ai_saved_works_kind_check;
alter table public.ai_saved_works add constraint ai_saved_works_kind_check check(kind in ('date_plan','diary','love_letter'));
notify pgrst,'reload schema';

-- ============================================================================
-- SOURCE: hotfix_invitation_code.sql
-- SHA256: d84c99cfab3eabc9e8a226d9955c02a9b31ae6a432c7ad0d140fd6fca4fe42ae
-- ============================================================================
create or replace function public.create_couple_with_invitation(couple_name text, relationship_start date)
returns text language plpgsql security definer set search_path = public as $$
declare
  new_couple_id uuid;
  new_code text;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;
  if exists (select 1 from couple_members where user_id = auth.uid()) then
    raise exception '你已经加入了一个情侣空间';
  end if;
  insert into couples (name, relationship_start, created_by)
  values (couple_name, relationship_start, auth.uid()) returning id into new_couple_id;
  insert into couple_members (couple_id, user_id) values (new_couple_id, auth.uid());
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into invitations (couple_id, code, created_by) values (new_couple_id, new_code, auth.uid());
  return new_code;
end;
$$;

revoke all on function public.create_couple_with_invitation(text, date) from public;
grant execute on function public.create_couple_with_invitation(text, date) to authenticated;

-- ============================================================================
-- SOURCE: setup_heart_ai.sql
-- SHA256: 55c4333f42635007942acf9124fe8331000aa1e59345f64df9fd69c335f912d8
-- ============================================================================
create table if not exists public.daily_questions(
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 question_date date not null default current_date,question text not null,category text not null default 'daily',
 created_at timestamptz not null default now(),unique(couple_id,question_date)
);
create table if not exists public.daily_answers(
 id uuid primary key default gen_random_uuid(),question_id uuid not null references public.daily_questions(id) on delete cascade,
 user_id uuid not null references public.profiles(id),answer text not null check(char_length(answer) between 1 and 1000),
 created_at timestamptz not null default now(),unique(question_id,user_id)
);
create table if not exists public.ai_generations(
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 user_id uuid not null references public.profiles(id),feature text not null,input_summary text,output text not null,
 provider text not null default 'xiaomi-mimo',model text,created_at timestamptz not null default now()
);
alter table public.daily_questions enable row level security;alter table public.daily_answers enable row level security;alter table public.ai_generations enable row level security;
create or replace function public.daily_answer_count(target_question_id uuid) returns bigint language sql stable security definer set search_path=public as $$select count(*) from public.daily_answers where question_id=target_question_id$$;
drop policy if exists "questions read couple" on public.daily_questions;drop policy if exists "questions create couple" on public.daily_questions;
create policy "questions read couple" on public.daily_questions for select using(public.is_couple_member(couple_id));
create policy "questions create couple" on public.daily_questions for insert with check(public.is_couple_member(couple_id));
drop policy if exists "answers read after both" on public.daily_answers;drop policy if exists "answers create self" on public.daily_answers;drop policy if exists "answers update self" on public.daily_answers;
create policy "answers read after both" on public.daily_answers for select using(user_id=auth.uid() or public.daily_answer_count(question_id)>=2);
create policy "answers create self" on public.daily_answers for insert with check(user_id=auth.uid() and exists(select 1 from public.daily_questions q where q.id=question_id and public.is_couple_member(q.couple_id)));
create policy "answers update self" on public.daily_answers for update using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "ai history read couple" on public.ai_generations;drop policy if exists "ai history create self" on public.ai_generations;
create policy "ai history read couple" on public.ai_generations for select using(public.is_couple_member(couple_id));
create policy "ai history create self" on public.ai_generations for insert with check(user_id=auth.uid() and public.is_couple_member(couple_id));
notify pgrst,'reload schema';

-- ============================================================================
-- SOURCE: legacy-migrations/006_message_audio.sql
-- SHA256: 9f968b40f71eddfa01e5d72f2be27763cb91045a2749c0eb210813a2f8c58110
-- ============================================================================
alter table public.messages drop constraint if exists messages_media_type_check;
alter table public.messages add constraint messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'audio'));

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'
]
where id = 'message-media';

-- ============================================================================
-- SOURCE: legacy-migrations/007_letters_realtime.sql
-- SHA256: 08a7ac8277a4a561b3e30769d10b1e837dee965c53d06d6d276cd06fc35aea15
-- ============================================================================
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'couple_letters'
  ) then
    alter publication supabase_realtime add table public.couple_letters;
  end if;
end $$;

-- ============================================================================
-- SOURCE: legacy-migrations/008_pet_streak.sql
-- SHA256: f1ba90956a963365ce9840b7790a2a3c0b1f342f22b45f0847bd046fff2f5a47
-- ============================================================================
create extension if not exists pgcrypto;

create table if not exists public.couple_pets (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null unique references public.couples(id) on delete cascade,
  name text not null default '小爱',
  species text not null default 'bunny' check (species in ('bunny','cat','puppy','bear')),
  level integer not null default 1 check (level between 1 and 100),
  experience integer not null default 0 check (experience >= 0),
  mood integer not null default 82 check (mood between 0 and 100),
  hunger integer not null default 78 check (hunger between 0 and 100),
  skin text not null default 'lavender',
  accessories jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.couple_streaks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null unique references public.couples(id) on delete cascade,
  current_days integer not null default 0 check (current_days >= 0),
  longest_days integer not null default 0 check (longest_days >= 0),
  last_completed_date date,
  protection_count integer not null default 0 check (protection_count >= 0),
  level integer not null default 1 check (level between 1 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.streak_day_actions (
  couple_id uuid not null references public.couples(id) on delete cascade,
  activity_date date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (couple_id, activity_date, user_id)
);

create index if not exists streak_day_actions_lookup_idx on public.streak_day_actions (couple_id, activity_date);

alter table public.couple_pets enable row level security;
alter table public.couple_streaks enable row level security;
alter table public.streak_day_actions enable row level security;

drop policy if exists "pets read by couple" on public.couple_pets;
create policy "pets read by couple" on public.couple_pets for select using (public.is_couple_member(couple_id));

drop policy if exists "streaks read by couple" on public.couple_streaks;
create policy "streaks read by couple" on public.couple_streaks for select using (public.is_couple_member(couple_id));

drop policy if exists "streak actions read by couple" on public.streak_day_actions;
create policy "streak actions read by couple" on public.streak_day_actions for select using (public.is_couple_member(couple_id));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'couple_pets') then
    alter publication supabase_realtime add table public.couple_pets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'couple_streaks') then
    alter publication supabase_realtime add table public.couple_streaks;
  end if;
end $$;

create or replace function public.ensure_couple_pet()
returns public.couple_pets
language plpgsql security definer set search_path = public
as $$
declare
  target_couple uuid;
  result public.couple_pets;
begin
  select couple_id into target_couple from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  insert into public.couple_pets (couple_id) values (target_couple) on conflict (couple_id) do nothing;
  insert into public.couple_streaks (couple_id) values (target_couple) on conflict (couple_id) do nothing;
  select * into result from public.couple_pets where couple_id = target_couple;
  return result;
end;
$$;

create or replace function public.record_couple_activity(p_activity_date date default current_date)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  target_couple uuid;
  streak public.couple_streaks;
  pet public.couple_pets;
  completed_count integer;
  newly_completed boolean := false;
begin
  if p_activity_date <> current_date then raise exception '只能记录今天的情侣互动'; end if;
  select couple_id into target_couple from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  perform public.ensure_couple_pet();
  insert into public.streak_day_actions (couple_id, activity_date, user_id)
  values (target_couple, p_activity_date, auth.uid()) on conflict do nothing;
  select count(*) into completed_count from public.streak_day_actions where couple_id = target_couple and activity_date = p_activity_date;
  select * into streak from public.couple_streaks where couple_id = target_couple for update;
  if completed_count >= 2 and streak.last_completed_date is distinct from p_activity_date then
    newly_completed := true;
    update public.couple_streaks
    set current_days = case when streak.last_completed_date = p_activity_date - 1 then streak.current_days + 1 else 1 end,
        longest_days = greatest(streak.longest_days, case when streak.last_completed_date = p_activity_date - 1 then streak.current_days + 1 else 1 end),
        last_completed_date = p_activity_date,
        level = least(100, greatest(1, floor((case when streak.last_completed_date = p_activity_date - 1 then streak.current_days + 1 else 1 end - 1) / 7) + 1)::integer),
        updated_at = now()
    where couple_id = target_couple
    returning * into streak;
    update public.couple_pets
    set experience = experience + 5,
        level = least(100, floor((experience + 5) / 50) + 1),
        mood = least(100, mood + 8),
        hunger = greatest(0, hunger - 3),
        updated_at = now()
    where couple_id = target_couple
    returning * into pet;
  else
    select * into pet from public.couple_pets where couple_id = target_couple;
  end if;
  return jsonb_build_object('streak', to_jsonb(streak), 'pet', to_jsonb(pet), 'today_completed', completed_count >= 2, 'newly_completed', newly_completed);
end;
$$;

create or replace function public.interact_with_couple_pet(p_action text)
returns public.couple_pets
language plpgsql security definer set search_path = public
as $$
declare
  target_couple uuid;
  result public.couple_pets;
begin
  if p_action not in ('feed', 'play', 'pet') then raise exception '不支持的宠物互动'; end if;
  select couple_id into target_couple from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  perform public.ensure_couple_pet();
  update public.couple_pets
  set hunger = case when p_action = 'feed' then least(100, hunger + 16) else hunger end,
      mood = case when p_action = 'play' then least(100, mood + 14) when p_action = 'pet' then least(100, mood + 7) else mood end,
      experience = experience + case when p_action = 'play' then 3 else 1 end,
      level = least(100, floor((experience + case when p_action = 'play' then 3 else 1 end) / 50) + 1),
      updated_at = now()
  where couple_id = target_couple
  returning * into result;
  return result;
end;
$$;

revoke all on function public.ensure_couple_pet() from public;
revoke all on function public.record_couple_activity(date) from public;
revoke all on function public.interact_with_couple_pet(text) from public;
grant execute on function public.ensure_couple_pet() to authenticated;
grant execute on function public.record_couple_activity(date) to authenticated;
grant execute on function public.interact_with_couple_pet(text) to authenticated;

-- ============================================================================
-- SOURCE: legacy-migrations/009_pet_style.sql
-- SHA256: 6d4e5536d2118e28697fa019e6a929e83d38364effc17dd5050f53306594731b
-- ============================================================================
create or replace function public.update_couple_pet_style(p_skin text, p_accessories jsonb default '[]'::jsonb)
returns public.couple_pets
language plpgsql security definer set search_path = public
as $$
declare
  target_couple uuid;
  result public.couple_pets;
begin
  if p_skin not in ('lavender', 'pink', 'mint', 'night') then raise exception '不支持的宠物外观'; end if;
  if jsonb_typeof(p_accessories) <> 'array' or jsonb_array_length(p_accessories) > 3 then raise exception '宠物配饰数量无效'; end if;
  select couple_id into target_couple from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  perform public.ensure_couple_pet();
  update public.couple_pets
  set skin = p_skin, accessories = p_accessories, updated_at = now()
  where couple_id = target_couple
  returning * into result;
  return result;
end;
$$;

revoke all on function public.update_couple_pet_style(text, jsonb) from public;
grant execute on function public.update_couple_pet_style(text, jsonb) to authenticated;

-- ============================================================================
-- SOURCE: legacy-migrations/010_pet_evolution.sql
-- SHA256: 9b1e7e2da91e44e2cad60ad019717692bb00407bb75658746e52831da66c9bf3
-- ============================================================================
alter table public.couple_pets drop constraint if exists couple_pets_species_check;
alter table public.couple_pets
  add constraint couple_pets_species_check
  check (species in ('bunny','cat','puppy','bear','fox','panda','penguin','hamster'));

drop function if exists public.update_couple_pet_style(text, jsonb);

create or replace function public.update_couple_pet_style(
  p_skin text,
  p_accessories jsonb default '[]'::jsonb,
  p_species text default null
)
returns public.couple_pets
language plpgsql security definer set search_path = public
as $$
declare
  target_couple uuid;
  result public.couple_pets;
begin
  if p_skin not in ('lavender', 'pink', 'mint', 'night') then
    raise exception '不支持的宠物外观';
  end if;
  if p_species is not null and p_species not in ('bunny','cat','puppy','bear','fox','panda','penguin','hamster') then
    raise exception '不支持的宠物种类';
  end if;
  if jsonb_typeof(p_accessories) <> 'array' or jsonb_array_length(p_accessories) > 3 then
    raise exception '宠物配饰数量无效';
  end if;
  select couple_id into target_couple from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  perform public.ensure_couple_pet();
  update public.couple_pets
  set skin = p_skin,
      accessories = p_accessories,
      species = coalesce(p_species, species),
      updated_at = now()
  where couple_id = target_couple
  returning * into result;
  return result;
end;
$$;

revoke all on function public.update_couple_pet_style(text, jsonb, text) from public;
grant execute on function public.update_couple_pet_style(text, jsonb, text) to authenticated;

-- ============================================================================
-- SOURCE: legacy-migrations/011_security_hardening.sql
-- SHA256: a5c34581f26ca7e3db72004fe93b3715bd703bc26d1b8b697572159524fdecfc
-- ============================================================================
-- Keep client updates limited to the fields each workflow is allowed to change.
-- RLS decides who may target a row; these triggers protect row ownership fields.

alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_type text;
alter table public.messages drop constraint if exists messages_check;
alter table public.messages drop constraint if exists messages_content_or_media_check;
alter table public.messages add constraint messages_content_or_media_check
  check (content is not null or image_path is not null or media_path is not null);
alter table public.messages drop constraint if exists messages_media_type_check;
alter table public.messages add constraint messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'audio'));

create or replace function public.is_same_couple_user(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.couple_members mine
    join public.couple_members target on target.couple_id = mine.couple_id
    where mine.user_id = auth.uid() and target.user_id = p_target_user_id
  );
$$;

drop policy if exists "avatars read by authenticated" on storage.objects;
drop policy if exists "avatars read by couple" on storage.objects;
create policy "avatars read by couple" on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars'
  and public.is_same_couple_user((storage.foldername(name))[1]::uuid)
);

create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.couple_id is distinct from old.couple_id
    or new.sender_id is distinct from old.sender_id
    or new.content is distinct from old.content
    or new.image_path is distinct from old.image_path
    or new.media_path is distinct from old.media_path
    or new.media_type is distinct from old.media_type
    or new.created_at is distinct from old.created_at then
    raise exception '消息归属和内容不可修改';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_message_update on public.messages;
create trigger guard_message_update
before update on public.messages
for each row execute function public.guard_message_update();

create or replace function public.guard_together_item_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.couple_id is distinct from old.couple_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception '清单归属不可修改';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_together_item_update on public.together_items;
create trigger guard_together_item_update
before update on public.together_items
for each row execute function public.guard_together_item_update();

create or replace function public.guard_anniversary_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.couple_id is distinct from old.couple_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception '纪念日归属不可修改';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_anniversary_update on public.anniversaries;
create trigger guard_anniversary_update
before update on public.anniversaries
for each row execute function public.guard_anniversary_update();

create or replace function public.guard_ai_work_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.couple_id is distinct from old.couple_id
    or new.user_id is distinct from old.user_id
    or new.kind is distinct from old.kind
    or new.work_date is distinct from old.work_date
    or new.memory_id is distinct from old.memory_id
    or new.created_at is distinct from old.created_at then
    raise exception 'AI 作品归属不可修改';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_ai_work_update on public.ai_saved_works;
create trigger guard_ai_work_update
before update on public.ai_saved_works
for each row execute function public.guard_ai_work_update();

revoke all on function public.guard_message_update() from public;
revoke all on function public.guard_together_item_update() from public;
revoke all on function public.guard_anniversary_update() from public;
revoke all on function public.guard_ai_work_update() from public;
revoke all on function public.is_same_couple_user(uuid) from public;

create or replace function public.save_ai_diary(
  p_work_date date,
  p_title text,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_couple uuid;
  existing_work public.ai_saved_works%rowtype;
  target_memory uuid;
begin
  select couple_id into target_couple
  from public.couple_members
  where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  if p_content is null or char_length(trim(p_content)) not between 1 and 1000 then
    raise exception '日记内容需要 1-1000 个字符';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 120 then
    raise exception '日记标题格式不正确';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_couple::text || ':' || p_work_date::text, 0));
  select * into existing_work
  from public.ai_saved_works
  where couple_id = target_couple and kind = 'diary' and work_date = p_work_date
  for update;

  if existing_work.id is not null then
    target_memory := existing_work.memory_id;
    if target_memory is not null then
      update public.memories
      set content = trim(p_content), memory_date = p_work_date, updated_at = now()
      where id = target_memory and couple_id = target_couple;
    else
      insert into public.memories(couple_id, author_id, content, memory_date, photos)
      values(target_couple, auth.uid(), trim(p_content), p_work_date, '[]'::jsonb)
      returning id into target_memory;
    end if;
    update public.ai_saved_works
    set content = trim(p_content), title = trim(p_title), memory_id = target_memory, updated_at = now()
    where id = existing_work.id;
    return existing_work.id;
  end if;

  insert into public.memories(couple_id, author_id, content, memory_date, photos)
  values(target_couple, auth.uid(), trim(p_content), p_work_date, '[]'::jsonb)
  returning id into target_memory;
  insert into public.ai_saved_works(couple_id, user_id, kind, work_date, title, content, memory_id)
  values(target_couple, auth.uid(), 'diary', p_work_date, trim(p_title), trim(p_content), target_memory)
  returning id into existing_work.id;
  return existing_work.id;
end;
$$;

revoke all on function public.save_ai_diary(date, text, text) from public;
grant execute on function public.save_ai_diary(date, text, text) to authenticated;

create table if not exists public.account_usernames(
  username text primary key check (username ~ '^[a-z0-9_]{4,20}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.account_usernames enable row level security;
revoke all on table public.account_usernames from anon, authenticated;

create or replace function public.sync_account_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_username text;
begin
  if coalesce(new.raw_user_meta_data ->> 'login_type', '') <> 'username' then
    return new;
  end if;
  next_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^a-z0-9_]', '', 'g'));
  if next_username !~ '^[a-z0-9_]{4,20}$' then
    raise exception '账号名格式不正确';
  end if;
  insert into public.account_usernames(username, user_id)
  values(next_username, new.id);
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'on_username_created') then
    create trigger on_username_created
    after insert on auth.users
    for each row execute function public.sync_account_username();
  end if;
end $$;

insert into public.account_usernames(username, user_id)
select lower(regexp_replace(raw_user_meta_data ->> 'username', '[^a-z0-9_]', '', 'g')), id
from auth.users
where coalesce(raw_user_meta_data ->> 'login_type', '') = 'username'
  and (raw_user_meta_data ->> 'username') ~ '^[a-zA-Z0-9_]{4,20}$'
on conflict (username) do nothing;

revoke all on function public.sync_account_username() from public;

notify pgrst, 'reload schema';

-- ============================================================================
-- SOURCE: legacy-migrations/012_account_security.sql
-- SHA256: 28af1fa9bf5c3bddcf93732a2ba18c2720027dc7741b5f4c967faab7cda7ab04
-- ============================================================================
-- Keep shared content when one member deletes their account; remove the
-- couple and its private data only when no partner remains.
alter table public.profiles add column if not exists last_login_user_agent text;
alter table public.profiles add column if not exists last_login_at timestamptz;

create or replace function public.prepare_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_couple uuid;
  partner_id uuid;
  member_count integer;
begin
  if current_user_id is null then raise exception '未登录'; end if;
  select couple_id into target_couple from public.couple_members where user_id = current_user_id;
  if target_couple is null then
    delete from public.profiles where id = current_user_id;
    return;
  end if;

  select count(*) into member_count from public.couple_members where couple_id = target_couple;
  select user_id into partner_id from public.couple_members where couple_id = target_couple and user_id <> current_user_id limit 1;
  if member_count <= 1 then
    delete from public.couples where id = target_couple;
  else
    update public.memories set author_id = partner_id where couple_id = target_couple and author_id = current_user_id;
    update public.albums set created_by = partner_id where couple_id = target_couple and created_by = current_user_id;
    update public.album_photos set uploaded_by = partner_id where album_id in (select id from public.albums where couple_id = target_couple) and uploaded_by = current_user_id;
    update public.messages set sender_id = partner_id where couple_id = target_couple and sender_id = current_user_id;
    update public.couple_letters set sender_id = partner_id where couple_id = target_couple and sender_id = current_user_id;
    update public.couple_letters set recipient_id = partner_id where couple_id = target_couple and recipient_id = current_user_id;
    update public.anniversaries set created_by = partner_id where couple_id = target_couple and created_by = current_user_id;
    update public.together_items set created_by = partner_id where couple_id = target_couple and created_by = current_user_id;
    update public.together_items set completed_by = partner_id where couple_id = target_couple and completed_by = current_user_id;
    update public.ai_saved_works set user_id = partner_id where couple_id = target_couple and user_id = current_user_id;
    update public.invitations set created_by = partner_id where couple_id = target_couple and created_by = current_user_id;
    update public.invitations set accepted_by = partner_id where couple_id = target_couple and accepted_by = current_user_id;
    update public.couples set created_by = partner_id where id = target_couple and created_by = current_user_id;
    delete from public.couple_members where couple_id = target_couple and user_id = current_user_id;
  end if;
  delete from public.profiles where id = current_user_id;
end;
$$;

revoke all on function public.prepare_account_deletion() from public;
grant execute on function public.prepare_account_deletion() to authenticated;

-- ============================================================================
-- SOURCE: legacy-migrations/013_call_history_and_member_realtime.sql
-- SHA256: fe8337d2baa0468a28ebf224ccb93062e682f0d5ea1749e9422daa77a72a48cc
-- ============================================================================
-- Shared call history and real-time member profile refreshes.
create table if not exists public.call_records (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique,
  couple_id uuid not null references public.couples(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  call_mode text not null check (call_mode in ('audio', 'video')),
  status text not null default 'calling' check (status in ('calling', 'connected', 'completed', 'cancelled', 'declined')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0)
);

create index if not exists call_records_couple_started_at_idx on public.call_records(couple_id, started_at desc);

alter table public.call_records enable row level security;
drop policy if exists "call records read by couple" on public.call_records;
drop policy if exists "call records create by caller" on public.call_records;
drop policy if exists "call records update by caller" on public.call_records;
create policy "call records read by couple" on public.call_records for select using (public.is_couple_member(couple_id));
create policy "call records create by caller" on public.call_records for insert with check (caller_id = auth.uid() and public.is_couple_member(couple_id));
create policy "call records update by caller" on public.call_records for update using (caller_id = auth.uid()) with check (caller_id = auth.uid() and public.is_couple_member(couple_id));

create or replace function public.guard_call_record_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.call_id is distinct from old.call_id
    or new.couple_id is distinct from old.couple_id
    or new.caller_id is distinct from old.caller_id
    or new.call_mode is distinct from old.call_mode
    or new.started_at is distinct from old.started_at then
    raise exception '通话记录的归属和开始时间不可修改';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_call_record_update on public.call_records;
create trigger guard_call_record_update before update on public.call_records for each row execute function public.guard_call_record_update();

-- Couple members need to receive their partner's profile row in Realtime.
drop policy if exists "profiles read couple" on public.profiles;
create policy "profiles read couple" on public.profiles for select using (id = auth.uid() or public.is_same_couple_user(id));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_records') then
    alter publication supabase_realtime add table public.call_records;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ============================================================================
-- SOURCE: legacy-migrations/014_media_variants.sql
-- SHA256: 408718f26326b6d908d5294885593aa8827f5538c8643b3162eee13c6d6ea116
-- ============================================================================
-- Fast media delivery: retain path for old clients and add optional variants.
-- Existing rows remain valid and are progressively upgraded by new uploads.
alter table public.album_photos add column if not exists thumb_path text;
alter table public.album_photos add column if not exists medium_path text;
alter table public.album_photos add column if not exists original_path text;

comment on column public.album_photos.path is 'Legacy-compatible original media path';
comment on column public.album_photos.thumb_path is 'Small list/grid image path';
comment on column public.album_photos.medium_path is 'Medium timeline/lightbox image path';
comment on column public.album_photos.original_path is 'Original-quality download path';

-- ============================================================================
-- SOURCE: legacy-migrations/015_push_tokens.sql
-- SHA256: 1be63a0bd7975361e874fb80e0a27f7ec9275fd4fac61bdc5af279a675feeaae
-- ============================================================================
-- Device push tokens used for background incoming-call notifications.
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  platform text not null check (platform in ('android', 'web')),
  token text not null unique,
  device_label text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_couple_platform_idx on public.push_tokens(couple_id, platform);
create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;
drop policy if exists "push tokens read by couple" on public.push_tokens;
drop policy if exists "push tokens insert own" on public.push_tokens;
drop policy if exists "push tokens update own" on public.push_tokens;
drop policy if exists "push tokens delete own" on public.push_tokens;
create policy "push tokens read by couple" on public.push_tokens for select using (public.is_couple_member(couple_id));
create policy "push tokens insert own" on public.push_tokens for insert with check (user_id = auth.uid() and public.is_couple_member(couple_id));
create policy "push tokens update own" on public.push_tokens for update using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_couple_member(couple_id));
create policy "push tokens delete own" on public.push_tokens for delete using (user_id = auth.uid());

create or replace function public.touch_push_token_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  new.last_seen_at = now();
  return new;
end;
$$;

drop trigger if exists push_tokens_touch_updated_at on public.push_tokens;
create trigger push_tokens_touch_updated_at before update on public.push_tokens for each row execute function public.touch_push_token_updated_at();

-- ============================================================================
-- SOURCE: legacy-migrations/016_streak_status.sql
-- SHA256: c327aa8cfd61c79d1dc2066165372e233dc5029e84a9abd0dba16e8dc6c0343f
-- ============================================================================
-- Keep the shared streak clock in the couple's primary timezone.
-- The web client consumes the date returned by these functions instead of
-- deriving a UTC date locally.
create or replace function public.get_couple_streak_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_couple uuid;
  streak public.couple_streaks;
  pet public.couple_pets;
  completed_count integer;
  today_date date := (now() at time zone 'Asia/Shanghai')::date;
  effective_current_days integer;
begin
  select couple_id into target_couple
  from public.couple_members
  where user_id = auth.uid();

  if target_couple is null then
    raise exception '请先绑定情侣空间';
  end if;

  perform public.ensure_couple_pet();

  select * into streak
  from public.couple_streaks
  where couple_id = target_couple;

  select * into pet
  from public.couple_pets
  where couple_id = target_couple;

  select count(*) into completed_count
  from public.streak_day_actions
  where couple_id = target_couple
    and activity_date = today_date;

  effective_current_days := case
    when streak.last_completed_date is null then 0
    when streak.last_completed_date >= today_date - 1 then streak.current_days
    else 0
  end;

  return jsonb_build_object(
    'today', today_date,
    'today_action_count', completed_count,
    'today_completed', completed_count >= 2,
    'streak', to_jsonb(streak) || jsonb_build_object('current_days', effective_current_days),
    'pet', to_jsonb(pet)
  );
end;
$$;

-- Recreate the write function so an omitted date uses the same Shanghai date
-- as the status function. Existing callers can continue omitting the arg.
create or replace function public.record_couple_activity(p_activity_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_couple uuid;
  streak public.couple_streaks;
  pet public.couple_pets;
  completed_count integer;
  newly_completed boolean := false;
  today_date date := (now() at time zone 'Asia/Shanghai')::date;
  effective_current_days integer;
begin
  p_activity_date := coalesce(p_activity_date, today_date);
  if p_activity_date <> today_date then
    raise exception '只能记录今天的情侣互动';
  end if;

  select couple_id into target_couple
  from public.couple_members
  where user_id = auth.uid();

  if target_couple is null then
    raise exception '请先绑定情侣空间';
  end if;

  perform public.ensure_couple_pet();

  insert into public.streak_day_actions (couple_id, activity_date, user_id)
  values (target_couple, p_activity_date, auth.uid())
  on conflict do nothing;

  select count(*) into completed_count
  from public.streak_day_actions
  where couple_id = target_couple
    and activity_date = p_activity_date;

  select * into streak
  from public.couple_streaks
  where couple_id = target_couple
  for update;

  if completed_count >= 2 and streak.last_completed_date is distinct from p_activity_date then
    newly_completed := true;
    update public.couple_streaks
    set current_days = case
          when streak.last_completed_date = p_activity_date - 1 then streak.current_days + 1
          else 1
        end,
        longest_days = greatest(
          streak.longest_days,
          case
            when streak.last_completed_date = p_activity_date - 1 then streak.current_days + 1
            else 1
          end
        ),
        last_completed_date = p_activity_date,
        level = least(100, greatest(1, floor((case
          when streak.last_completed_date = p_activity_date - 1 then streak.current_days + 1
          else 1
        end - 1) / 7) + 1)::integer),
        updated_at = now()
    where couple_id = target_couple
    returning * into streak;

    update public.couple_pets
    set experience = experience + 5,
        level = least(100, floor((experience + 5) / 50) + 1),
        mood = least(100, mood + 8),
        hunger = greatest(0, hunger - 3),
        updated_at = now()
    where couple_id = target_couple
    returning * into pet;
  else
    select * into pet
    from public.couple_pets
    where couple_id = target_couple;
  end if;

  effective_current_days := case
    when streak.last_completed_date is null then 0
    when streak.last_completed_date >= today_date - 1 then streak.current_days
    else 0
  end;

  return jsonb_build_object(
    'today', today_date,
    'today_action_count', completed_count,
    'streak', to_jsonb(streak) || jsonb_build_object('current_days', effective_current_days),
    'pet', to_jsonb(pet),
    'today_completed', completed_count >= 2,
    'newly_completed', newly_completed
  );
end;
$$;

revoke all on function public.get_couple_streak_status() from public;
grant execute on function public.get_couple_streak_status() to authenticated;
revoke all on function public.record_couple_activity(date) from public;
grant execute on function public.record_couple_activity(date) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'streak_day_actions'
  ) then
    alter publication supabase_realtime add table public.streak_day_actions;
  end if;
end $$;

-- ============================================================================
-- SOURCE: legacy-migrations/017_streak_protection.sql
-- SHA256: 9872addfa20691f81d86a225a9f9fde66206e5fd921a78ba601f9c38ea4f8084
-- ============================================================================
-- Make the existing protection_count field functional.
-- Missing one day can consume one protection; every 7-day milestone earns one,
-- capped at three stored protections.
create or replace function public.record_couple_activity_core(p_activity_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_couple uuid;
  streak public.couple_streaks;
  pet public.couple_pets;
  completed_count integer;
  newly_completed boolean := false;
  protection_used boolean := false;
  protection_earned boolean := false;
  today_date date := (now() at time zone 'Asia/Shanghai')::date;
  days_since_last integer;
  next_current_days integer;
  effective_current_days integer;
begin
  p_activity_date := coalesce(p_activity_date, today_date);
  if p_activity_date <> today_date then
    raise exception '只能记录今天的情侣互动';
  end if;

  select couple_id into target_couple
  from public.couple_members
  where user_id = auth.uid();

  if target_couple is null then
    raise exception '请先绑定情侣空间';
  end if;

  perform public.ensure_couple_pet();

  insert into public.streak_day_actions (couple_id, activity_date, user_id)
  values (target_couple, p_activity_date, auth.uid())
  on conflict do nothing;

  select count(*) into completed_count
  from public.streak_day_actions
  where couple_id = target_couple
    and activity_date = p_activity_date;

  select * into streak
  from public.couple_streaks
  where couple_id = target_couple
  for update;

  if completed_count >= 2 and streak.last_completed_date is distinct from p_activity_date then
    newly_completed := true;
    days_since_last := case
      when streak.last_completed_date is null then null
      else p_activity_date - streak.last_completed_date
    end;

    if days_since_last = 1 then
      next_current_days := streak.current_days + 1;
    elsif days_since_last = 2 and streak.protection_count > 0 then
      next_current_days := streak.current_days + 1;
      protection_used := true;
    else
      next_current_days := 1;
    end if;

    protection_earned := mod(next_current_days, 7) = 0;

    update public.couple_streaks
    set current_days = next_current_days,
        longest_days = greatest(streak.longest_days, next_current_days),
        last_completed_date = p_activity_date,
        protection_count = least(3, greatest(0, streak.protection_count
          - case when protection_used then 1 else 0 end
          + case when protection_earned then 1 else 0 end)),
        level = least(100, greatest(1, floor((next_current_days - 1) / 7) + 1)::integer),
        updated_at = now()
    where couple_id = target_couple
    returning * into streak;

    update public.couple_pets
    set experience = experience + 5,
        level = least(100, floor((experience + 5) / 50) + 1),
        mood = least(100, mood + 8),
        hunger = greatest(0, hunger - 3),
        updated_at = now()
    where couple_id = target_couple
    returning * into pet;
  else
    select * into pet
    from public.couple_pets
    where couple_id = target_couple;
  end if;

  effective_current_days := case
    when streak.last_completed_date is null then 0
    when streak.last_completed_date >= today_date - 1 then streak.current_days
    else 0
  end;

  return jsonb_build_object(
    'today', today_date,
    'today_action_count', completed_count,
    'streak', to_jsonb(streak) || jsonb_build_object('current_days', effective_current_days),
    'pet', to_jsonb(pet),
    'today_completed', completed_count >= 2,
    'newly_completed', newly_completed,
    'protection_used', protection_used,
    'protection_earned', protection_earned
  );
end;
$$;

-- Keep the existing public RPC name used by all current clients.
create or replace function public.record_couple_activity(p_activity_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.record_couple_activity_core(p_activity_date);
end;
$$;

revoke all on function public.record_couple_activity_core(date) from public;
grant execute on function public.record_couple_activity_core(date) to authenticated;
revoke all on function public.record_couple_activity(date) from public;
grant execute on function public.record_couple_activity(date) to authenticated;

-- ============================================================================
-- SOURCE: legacy-migrations/018_streak_history_rewards.sql
-- SHA256: 301e2b64793e0b600c9cb48d867e8ebd2e42cc714d3a94135b442e1a52d06347
-- ============================================================================
-- Activity context, streak history, milestones, and shared pet-house rewards.
alter table public.streak_day_actions
  add column if not exists activity_type text not null default 'manual',
  add column if not exists mood integer,
  add column if not exists note text;

alter table public.streak_day_actions
  drop constraint if exists streak_day_actions_mood_check;
alter table public.streak_day_actions
  add constraint streak_day_actions_mood_check check (mood is null or mood between 1 and 5);
alter table public.streak_day_actions
  drop constraint if exists streak_day_actions_note_check;
alter table public.streak_day_actions
  add constraint streak_day_actions_note_check check (note is null or char_length(note) <= 240);

create table if not exists public.streak_activity_events (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  activity_date date not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null default 'manual',
  mood integer,
  note text,
  created_at timestamptz not null default now(),
  constraint streak_activity_events_mood_check check (mood is null or mood between 1 and 5),
  constraint streak_activity_events_note_check check (note is null or char_length(note) <= 240)
);

create index if not exists streak_activity_events_lookup_idx
  on public.streak_activity_events (couple_id, activity_date, created_at desc);

create table if not exists public.couple_streak_milestones (
  couple_id uuid not null references public.couples(id) on delete cascade,
  milestone_days integer not null check (milestone_days in (3, 7, 14, 30, 100)),
  reward_key text not null,
  achieved_at timestamptz not null default now(),
  primary key (couple_id, milestone_days)
);

create table if not exists public.couple_pet_rewards (
  couple_id uuid not null references public.couples(id) on delete cascade,
  reward_key text not null,
  reward_type text not null check (reward_type in ('accessory', 'furniture')),
  unlocked_at timestamptz not null default now(),
  primary key (couple_id, reward_key)
);

alter table public.streak_activity_events enable row level security;
alter table public.couple_streak_milestones enable row level security;
alter table public.couple_pet_rewards enable row level security;

drop policy if exists "streak events read by couple" on public.streak_activity_events;
create policy "streak events read by couple" on public.streak_activity_events
  for select using (public.is_couple_member(couple_id));
drop policy if exists "streak milestones read by couple" on public.couple_streak_milestones;
create policy "streak milestones read by couple" on public.couple_streak_milestones
  for select using (public.is_couple_member(couple_id));
drop policy if exists "pet rewards read by couple" on public.couple_pet_rewards;
create policy "pet rewards read by couple" on public.couple_pet_rewards
  for select using (public.is_couple_member(couple_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'streak_activity_events'
  ) then
    alter publication supabase_realtime add table public.streak_activity_events;
  end if;
end $$;

create or replace function public.record_couple_activity_context(
  p_activity_date date,
  p_activity_type text,
  p_mood integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_couple uuid;
  streak public.couple_streaks;
  pet public.couple_pets;
  completed_count integer;
  newly_completed boolean := false;
  protection_used boolean := false;
  protection_earned boolean := false;
  today_date date := (now() at time zone 'Asia/Shanghai')::date;
  days_since_last integer;
  next_current_days integer;
  effective_current_days integer;
  milestone_days integer;
  reward_key text;
  reward_type text;
  activity_type text := coalesce(nullif(trim(p_activity_type), ''), 'manual');
  note_value text := nullif(left(trim(coalesce(p_note, '')), 240), '');
begin
  p_activity_date := coalesce(p_activity_date, today_date);
  if p_activity_date <> today_date then
    raise exception '只能记录今天的情侣互动';
  end if;
  if activity_type not in ('manual', 'message', 'photo', 'video', 'memory', 'checklist', 'letter', 'ai', 'pet', 'other') then
    activity_type := 'other';
  end if;
  if p_mood is not null and (p_mood < 1 or p_mood > 5) then
    raise exception '今日心情必须是 1 到 5';
  end if;

  select couple_id into target_couple
  from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  perform public.ensure_couple_pet();

  insert into public.streak_activity_events (couple_id, activity_date, actor_id, activity_type, mood, note)
  values (target_couple, p_activity_date, auth.uid(), activity_type, p_mood, note_value);

  insert into public.streak_day_actions (couple_id, activity_date, user_id, activity_type, mood, note)
  values (target_couple, p_activity_date, auth.uid(), activity_type, p_mood, note_value)
  on conflict (couple_id, activity_date, user_id) do update
    set activity_type = excluded.activity_type,
        mood = coalesce(excluded.mood, public.streak_day_actions.mood),
        note = coalesce(excluded.note, public.streak_day_actions.note),
        created_at = now();

  select count(*) into completed_count
  from public.streak_day_actions
  where couple_id = target_couple and activity_date = p_activity_date;

  select * into streak from public.couple_streaks
  where couple_id = target_couple for update;

  if completed_count >= 2 and streak.last_completed_date is distinct from p_activity_date then
    newly_completed := true;
    days_since_last := case when streak.last_completed_date is null then null else p_activity_date - streak.last_completed_date end;
    if days_since_last = 1 then
      next_current_days := streak.current_days + 1;
    elsif days_since_last = 2 and streak.protection_count > 0 then
      next_current_days := streak.current_days + 1;
      protection_used := true;
    else
      next_current_days := 1;
    end if;

    protection_earned := mod(next_current_days, 7) = 0;
    if next_current_days in (3, 7, 14, 30, 100) then
      milestone_days := next_current_days;
      reward_key := case next_current_days
        when 3 then 'pet-accessory-flower'
        when 7 then 'house-furniture-love-lamp'
        when 14 then 'pet-accessory-crown'
        when 30 then 'house-furniture-moon-sofa'
        when 100 then 'pet-accessory-bow'
      end;
      reward_type := case when next_current_days in (7, 30) then 'furniture' else 'accessory' end;
      insert into public.couple_streak_milestones (couple_id, milestone_days, reward_key)
      values (target_couple, milestone_days, reward_key)
      on conflict do nothing;
      if not found then
        milestone_days := null;
        reward_key := null;
      else
        insert into public.couple_pet_rewards (couple_id, reward_key, reward_type)
        values (target_couple, reward_key, reward_type)
        on conflict do nothing;
      end if;
    end if;

    update public.couple_streaks
    set current_days = next_current_days,
        longest_days = greatest(streak.longest_days, next_current_days),
        last_completed_date = p_activity_date,
        protection_count = least(3, greatest(0, streak.protection_count
          - case when protection_used then 1 else 0 end
          + case when protection_earned then 1 else 0 end)),
        level = least(100, greatest(1, floor((next_current_days - 1) / 7) + 1)::integer),
        updated_at = now()
    where couple_id = target_couple
    returning * into streak;

    update public.couple_pets
    set experience = experience + 5 + case when milestone_days is not null then 10 else 0 end,
        level = least(100, floor((experience + 5 + case when milestone_days is not null then 10 else 0 end) / 50) + 1),
        mood = least(100, mood + 8),
        hunger = greatest(0, hunger - 3),
        updated_at = now()
    where couple_id = target_couple
    returning * into pet;
  else
    select * into pet from public.couple_pets where couple_id = target_couple;
  end if;

  effective_current_days := case
    when streak.last_completed_date is null then 0
    when streak.last_completed_date >= today_date - 1 then streak.current_days
    else 0
  end;

  return public.get_couple_streak_status_payload(target_couple, today_date, completed_count, streak, pet,
    newly_completed, protection_used, protection_earned, milestone_days, reward_key);
end;
$$;

-- Shared payload helper keeps the status and write RPCs consistent.
create or replace function public.get_couple_streak_status_payload(
  target_couple uuid,
  today_date date,
  completed_count integer,
  streak public.couple_streaks,
  pet public.couple_pets,
  newly_completed boolean default false,
  protection_used boolean default false,
  protection_earned boolean default false,
  milestone_days integer default null,
  reward_key text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'today', today_date,
    'today_action_count', completed_count,
    'today_completed', completed_count >= 2,
    'today_actor_ids', coalesce((select jsonb_agg(user_id order by user_id) from public.streak_day_actions where couple_id = target_couple and activity_date = today_date), '[]'::jsonb),
    'today_actions', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'activity_type', activity_type, 'mood', mood, 'note', note, 'created_at', created_at) order by created_at) from public.streak_day_actions where couple_id = target_couple and activity_date = today_date), '[]'::jsonb),
    'streak', to_jsonb(streak) || jsonb_build_object('current_days', case
      when streak.last_completed_date is null then 0
      when streak.last_completed_date >= today_date - 1 then streak.current_days
      else 0
    end),
    'pet', to_jsonb(pet),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('reward_key', reward_key, 'reward_type', reward_type, 'unlocked_at', unlocked_at) order by unlocked_at) from public.couple_pet_rewards where couple_id = target_couple), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('days', milestone_days, 'reward_key', reward_key, 'achieved_at', achieved_at) order by milestone_days) from public.couple_streak_milestones where couple_id = target_couple), '[]'::jsonb),
    'newly_completed', newly_completed,
    'protection_used', protection_used,
    'protection_earned', protection_earned,
    'milestone_days', milestone_days,
    'reward_key', reward_key
  );
$$;

create or replace function public.record_couple_activity(p_activity_date date default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  return public.record_couple_activity_context(p_activity_date, 'manual', null, null);
end;
$$;

create or replace function public.get_couple_streak_status()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  target_couple uuid;
  streak public.couple_streaks;
  pet public.couple_pets;
  completed_count integer;
  today_date date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select couple_id into target_couple from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  perform public.ensure_couple_pet();
  select * into streak from public.couple_streaks where couple_id = target_couple;
  select * into pet from public.couple_pets where couple_id = target_couple;
  select count(*) into completed_count from public.streak_day_actions where couple_id = target_couple and activity_date = today_date;
  return public.get_couple_streak_status_payload(target_couple, today_date, completed_count, streak, pet);
end;
$$;

create or replace function public.get_couple_streak_history(p_month date default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  target_couple uuid;
  today_date date := (now() at time zone 'Asia/Shanghai')::date;
  month_start date := date_trunc('month', coalesce(p_month, today_date))::date;
  month_end date := (month_start + interval '1 month')::date;
begin
  select couple_id into target_couple from public.couple_members where user_id = auth.uid();
  if target_couple is null then raise exception '请先绑定情侣空间'; end if;
  return jsonb_build_object(
    'month', month_start,
    'days', coalesce((select jsonb_agg(day_row order by (day_row->>'date')) from (select jsonb_build_object('date', activity_date, 'count', count(*), 'actor_ids', jsonb_agg(user_id order by user_id), 'sources', jsonb_agg(distinct activity_type)) as day_row from public.streak_day_actions where couple_id = target_couple and activity_date >= month_start and activity_date < month_end group by activity_date) grouped_days), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('date', activity_date, 'actor_id', actor_id, 'activity_type', activity_type, 'mood', mood, 'note', note, 'created_at', created_at) order by created_at desc) from public.streak_activity_events where couple_id = target_couple and activity_date >= month_start and activity_date < month_end), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('days', milestone_days, 'reward_key', reward_key, 'achieved_at', achieved_at) order by milestone_days) from public.couple_streak_milestones where couple_id = target_couple), '[]'::jsonb),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('reward_key', reward_key, 'reward_type', reward_type, 'unlocked_at', unlocked_at) order by unlocked_at) from public.couple_pet_rewards where couple_id = target_couple), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.record_couple_activity_context(date, text, integer, text) from public;
grant execute on function public.record_couple_activity_context(date, text, integer, text) to authenticated;
revoke all on function public.get_couple_streak_status_payload(uuid, date, integer, public.couple_streaks, public.couple_pets, boolean, boolean, boolean, integer, text) from public;
revoke all on function public.get_couple_streak_status() from public;
grant execute on function public.get_couple_streak_status() to authenticated;
revoke all on function public.get_couple_streak_history(date) from public;
grant execute on function public.get_couple_streak_history(date) to authenticated;

-- ============================================================================
-- SOURCE: legacy-migrations/019_media_interactions.sql
-- SHA256: c455f8c4217f21cbc05aaade76429542e55e6261b09a48ae165fab1ff2a72e1b
-- ============================================================================
-- Media polish: durable video posters plus lightweight reactions for shared memories.
alter table public.album_photos add column if not exists video_poster_path text;
comment on column public.album_photos.video_poster_path is 'Generated JPEG poster for video grid previews';

create table if not exists public.memory_favorites (
  memory_id uuid not null references public.memories(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (memory_id, user_id)
);
create table if not exists public.memory_reactions (
  memory_id uuid not null references public.memories(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (memory_id, user_id, emoji)
);
create table if not exists public.memory_comments (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 240),
  created_at timestamptz not null default now()
);
create index if not exists memory_comments_memory_idx on public.memory_comments(memory_id, created_at desc);

alter table public.memory_favorites enable row level security;
alter table public.memory_reactions enable row level security;
alter table public.memory_comments enable row level security;
drop policy if exists "memory favorites read by couple" on public.memory_favorites;
drop policy if exists "memory favorites write by member" on public.memory_favorites;
create policy "memory favorites read by couple" on public.memory_favorites for select using (public.is_couple_member(couple_id));
create policy "memory favorites write by member" on public.memory_favorites for all using (user_id = auth.uid() and public.is_couple_member(couple_id)) with check (user_id = auth.uid() and public.is_couple_member(couple_id));
drop policy if exists "memory reactions read by couple" on public.memory_reactions;
drop policy if exists "memory reactions write by member" on public.memory_reactions;
create policy "memory reactions read by couple" on public.memory_reactions for select using (public.is_couple_member(couple_id));
create policy "memory reactions write by member" on public.memory_reactions for all using (user_id = auth.uid() and public.is_couple_member(couple_id)) with check (user_id = auth.uid() and public.is_couple_member(couple_id));
drop policy if exists "memory comments read by couple" on public.memory_comments;
drop policy if exists "memory comments write by member" on public.memory_comments;
create policy "memory comments read by couple" on public.memory_comments for select using (public.is_couple_member(couple_id));
create policy "memory comments write by member" on public.memory_comments for all using (user_id = auth.uid() and public.is_couple_member(couple_id)) with check (user_id = auth.uid() and public.is_couple_member(couple_id));

-- ============================================================================
-- SOURCE: legacy-migrations/020_album_photo_realtime_delete.sql
-- SHA256: c4de6542985edf3f2b8506eb03fff1e7c173d22edd8ea109ff615e87d321928a
-- ============================================================================
-- Both members own the shared album. Either member may remove a shared photo.
drop policy if exists "album photos delete by uploader" on public.album_photos;
drop policy if exists "album photos delete by couple" on public.album_photos;
create policy "album photos delete by couple"
  on public.album_photos for delete
  using (exists (
    select 1 from public.albums
    where public.albums.id = album_photos.album_id
      and public.is_couple_member(public.albums.couple_id)
  ));

-- Realtime needs the table in the publication so the other device removes it immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'album_photos'
  ) then
    alter publication supabase_realtime add table public.album_photos;
  end if;
end $$;

-- Storage objects are shared by the couple as well.
drop policy if exists "album media delete uploader" on storage.objects;
drop policy if exists "album media delete couple" on storage.objects;
create policy "album media delete couple"
  on storage.objects for delete
  using (
    bucket_id = 'album-media'
    and public.is_couple_member((storage.foldername(name))[1]::uuid)
  );

-- ============================================================================
-- SOURCE: legacy-migrations/20261027090005_init.sql
-- SHA256: 51b73b4cba4dd710bcd1faf7c3a28b07a74be1f6a1f0ba0047a28595694c7fad
-- ============================================================================
-- 增量升级：保留所有旧列、主键、历史表和现有 RPC。
-- 前置条件：已有仓库的业务表（包括 setup_messages / upgrade_* 媒体配置）。
-- 只创建本次新增的表；异常数据会使整个事务回滚，不删除或截断旧数据。
-- 来源文件的事务外壳已省略，由整份基础迁移统一管理。
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
-- 来源文件的事务外壳已省略，由整份基础迁移统一管理。

-- ============================================================================
-- SOURCE: legacy-migrations/20261027161714_align_core_schema.sql
-- SHA256: 298b8de74b91c5cd77b77a96e723be2b7204017a8e011d4a7048b0c55246686c
-- ============================================================================
-- 在 20261027090005_init 之后执行：补齐五张核心表清单中的列默认值。
-- 保留旧字段和上一份迁移；不改写历史数据或业务权限。
-- 来源文件的事务外壳已省略，由整份基础迁移统一管理。
set local lock_timeout = '10s';

create function public.love_anniversary_insert_default() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  -- DEFAULT 在 BEFORE 触发器之前填入。此处必须优先兼容旧客户端的 false。
  -- INSERT 同时提交 repeat_yearly=true 和 recurring=false 时也采用 recurring=false。
  -- UPDATE 不经过本分支，仍按 love_sync_core 的字段变更逻辑同步。
  if new.recurring is false and new.repeat_yearly is true then
    new.repeat_yearly := false;
  end if;
  return new;
end $$;

-- PostgreSQL 按名称顺序执行同类触发器；本触发器排在 love_sync_core 之前。
create trigger love_anniversary_insert_default
before insert on public.anniversaries
for each row execute function public.love_anniversary_insert_default();

alter table public.anniversaries alter column repeat_yearly set default true;
revoke all on function public.love_anniversary_insert_default() from public;
comment on column public.anniversaries.repeat_yearly is
  '默认每年重复；兼容旧 recurring。INSERT 的 true/false 歧义组合按旧 recurring=false 保存';
notify pgrst, 'reload schema';
-- 来源文件的事务外壳已省略，由整份基础迁移统一管理。

commit;
