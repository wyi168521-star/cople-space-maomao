/** 包含迁移 20261027090005_init 的核心行类型子集；不是完整的生成式 Database schema。 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type CoupleRole = 'a' | 'b'

export type ProfileRow = {
  id: string
  display_name: string
  avatar_url: string | null
  created_at: string
  last_login_user_agent: string | null
  // Postgres 的 timestamptz 经 API 返回 ISO 日期字符串。
  last_login_at: string | null
}

export type CoupleRow = {
  id: string
  name: string
  relationship_start: string
  name_a: string
  name_b: string
  start_date: string
  cover_path: string | null
  settings: Json
  created_by: string
  created_at: string
}

export type CoupleMemberRow = {
  couple_id: string
  user_id: string
  role: CoupleRole
  joined_at: string
}

export type InvitationRow = {
  id: string
  couple_id: string
  code: string
  created_by: string
  expires_at: string
  accepted_by: string | null
  accepted_at: string | null
  created_at: string
}

export type MemoryRow = {
  id: string
  couple_id: string
  author_id: string
  content: string
  memory_date: string
  date: string
  title: string
  body: string | null
  author_role: CoupleRole | null
  location: string | null
  photos: Json[]
  created_at: string
  updated_at: string
}

export type MemoryMediaRow = {
  id: string
  memory_id: string
  storage_path: string
  media_type: 'photo' | 'video'
  taken_at: string | null
  created_at: string
}

export type AlbumRow = {
  id: string
  couple_id: string
  created_by: string
  name: string
  description: string | null
  cover_path: string | null
  title: string
  created_at: string
}

export type AlbumMediaRow = {
  id: string
  album_id: string
  storage_path: string
  media_type: 'photo' | 'video'
  taken_at: string | null
  created_at: string
}

export type AnniversaryRow = {
  id: string
  couple_id: string
  created_by: string
  title: string
  event_date: string
  kind: 'anniversary' | 'birthday' | 'travel' | 'custom'
  recurring: boolean
  note: string | null
  target_date: string
  repeat_yearly: boolean
  icon: string | null
  created_at: string
}

export type WhisperRow = {
  id: string
  couple_id: string
  sender_id: string
  body: string | null
  media_path: string | null
  media_type: 'photo' | 'video' | 'voice' | null
  read_at: string | null
  created_at: string
}
