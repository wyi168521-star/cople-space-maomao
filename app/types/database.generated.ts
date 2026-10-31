
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "account_usernames": {
                  Row: {
                    "created_at": string,"user_id": string,"username": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string,"username": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string,"username"?: string
                  }
                  Relationships: [

                  ]
                },"ai_generations": {
                  Row: {
                    "couple_id": string,"created_at": string,"feature": string,"id": string,"input_summary": string | null,"model": string | null,"output": string,"provider": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"created_at"?: string,"feature": string,"id"?: string,"input_summary"?: string | null,"model"?: string | null,"output": string,"provider"?: string,"user_id": string
                  }
                  Update: {
                    "couple_id"?: string,"created_at"?: string,"feature"?: string,"id"?: string,"input_summary"?: string | null,"model"?: string | null,"output"?: string,"provider"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_generations_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_generations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_saved_works": {
                  Row: {
                    "content": string,"couple_id": string,"created_at": string,"id": string,"kind": string,"memory_id": string | null,"title": string,"updated_at": string,"user_id": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"couple_id": string,"created_at"?: string,"id"?: string,"kind": string,"memory_id"?: string | null,"title": string,"updated_at"?: string,"user_id": string,"work_date"?: string
                  }
                  Update: {
                    "content"?: string,"couple_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"memory_id"?: string | null,"title"?: string,"updated_at"?: string,"user_id"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_saved_works_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_saved_works_memory_id_fkey"
      columns: ["memory_id"]
isOneToOne: false
      referencedRelation: "memories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_saved_works_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"album_media": {
                  Row: {
                    "album_id": string,"created_at": string,"id": string,"media_type": string,"storage_path": string,"taken_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "album_id": string,"created_at"?: string,"id"?: string,"media_type": string,"storage_path": string,"taken_at"?: string | null
                  }
                  Update: {
                    "album_id"?: string,"created_at"?: string,"id"?: string,"media_type"?: string,"storage_path"?: string,"taken_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "album_media_album_id_fkey"
      columns: ["album_id"]
isOneToOne: false
      referencedRelation: "albums"
      referencedColumns: ["id"]
    }
                  ]
                },"album_photos": {
                  Row: {
                    "album_id": string,"caption": string | null,"created_at": string,"id": string,"media_type": string,"medium_path": string | null,"original_path": string | null,"path": string,"taken_date": string,"thumb_path": string | null,"uploaded_by": string,"video_poster_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "album_id": string,"caption"?: string | null,"created_at"?: string,"id"?: string,"media_type"?: string,"medium_path"?: string | null,"original_path"?: string | null,"path": string,"taken_date"?: string,"thumb_path"?: string | null,"uploaded_by": string,"video_poster_path"?: string | null
                  }
                  Update: {
                    "album_id"?: string,"caption"?: string | null,"created_at"?: string,"id"?: string,"media_type"?: string,"medium_path"?: string | null,"original_path"?: string | null,"path"?: string,"taken_date"?: string,"thumb_path"?: string | null,"uploaded_by"?: string,"video_poster_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "album_photos_album_id_fkey"
      columns: ["album_id"]
isOneToOne: false
      referencedRelation: "albums"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "album_photos_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"albums": {
                  Row: {
                    "couple_id": string,"cover_path": string | null,"created_at": string,"created_by": string,"description": string | null,"id": string,"name": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"cover_path"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"name": string,"title": string
                  }
                  Update: {
                    "couple_id"?: string,"cover_path"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"name"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "albums_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "albums_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"anniversaries": {
                  Row: {
                    "couple_id": string,"created_at": string,"created_by": string,"event_date": string,"icon": string | null,"id": string,"kind": string,"note": string | null,"recurring": boolean,"repeat_yearly": boolean,"target_date": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"created_at"?: string,"created_by": string,"event_date": string,"icon"?: string | null,"id"?: string,"kind"?: string,"note"?: string | null,"recurring": boolean,"repeat_yearly"?: boolean,"target_date": string,"title": string
                  }
                  Update: {
                    "couple_id"?: string,"created_at"?: string,"created_by"?: string,"event_date"?: string,"icon"?: string | null,"id"?: string,"kind"?: string,"note"?: string | null,"recurring"?: boolean,"repeat_yearly"?: boolean,"target_date"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "anniversaries_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anniversaries_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"call_records": {
                  Row: {
                    "answered_at": string | null,"call_id": string,"call_mode": string,"caller_id": string,"couple_id": string,"duration_seconds": number,"ended_at": string | null,"id": string,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answered_at"?: string | null,"call_id": string,"call_mode": string,"caller_id": string,"couple_id": string,"duration_seconds"?: number,"ended_at"?: string | null,"id"?: string,"started_at"?: string,"status"?: string
                  }
                  Update: {
                    "answered_at"?: string | null,"call_id"?: string,"call_mode"?: string,"caller_id"?: string,"couple_id"?: string,"duration_seconds"?: number,"ended_at"?: string | null,"id"?: string,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "call_records_caller_id_fkey"
      columns: ["caller_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_records_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"couple_letters": {
                  Row: {
                    "content": string,"couple_id": string,"created_at": string,"id": string,"recipient_id": string,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"couple_id": string,"created_at"?: string,"id"?: string,"recipient_id": string,"sender_id": string
                  }
                  Update: {
                    "content"?: string,"couple_id"?: string,"created_at"?: string,"id"?: string,"recipient_id"?: string,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couple_letters_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "couple_letters_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "couple_letters_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"couple_members": {
                  Row: {
                    "couple_id": string,"joined_at": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"joined_at"?: string,"role": string,"user_id": string
                  }
                  Update: {
                    "couple_id"?: string,"joined_at"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couple_members_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "couple_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"couple_pet_rewards": {
                  Row: {
                    "couple_id": string,"reward_key": string,"reward_type": string,"unlocked_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"reward_key": string,"reward_type": string,"unlocked_at"?: string
                  }
                  Update: {
                    "couple_id"?: string,"reward_key"?: string,"reward_type"?: string,"unlocked_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couple_pet_rewards_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"couple_pets": {
                  Row: {
                    "accessories": NonNullable<Json>,"couple_id": string,"experience": number,"hunger": number,"id": string,"level": number,"mood": number,"name": string,"skin": string,"species": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accessories"?: NonNullable<Json>,"couple_id": string,"experience"?: number,"hunger"?: number,"id"?: string,"level"?: number,"mood"?: number,"name"?: string,"skin"?: string,"species"?: string,"updated_at"?: string
                  }
                  Update: {
                    "accessories"?: NonNullable<Json>,"couple_id"?: string,"experience"?: number,"hunger"?: number,"id"?: string,"level"?: number,"mood"?: number,"name"?: string,"skin"?: string,"species"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couple_pets_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: true
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"couple_streak_milestones": {
                  Row: {
                    "achieved_at": string,"couple_id": string,"milestone_days": number,"reward_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achieved_at"?: string,"couple_id": string,"milestone_days": number,"reward_key": string
                  }
                  Update: {
                    "achieved_at"?: string,"couple_id"?: string,"milestone_days"?: number,"reward_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couple_streak_milestones_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"couple_streaks": {
                  Row: {
                    "couple_id": string,"current_days": number,"id": string,"last_completed_date": string | null,"level": number,"longest_days": number,"protection_count": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"current_days"?: number,"id"?: string,"last_completed_date"?: string | null,"level"?: number,"longest_days"?: number,"protection_count"?: number,"updated_at"?: string
                  }
                  Update: {
                    "couple_id"?: string,"current_days"?: number,"id"?: string,"last_completed_date"?: string | null,"level"?: number,"longest_days"?: number,"protection_count"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couple_streaks_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: true
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"couples": {
                  Row: {
                    "cover_path": string | null,"created_at": string,"created_by": string,"id": string,"love_letter": string | null,"name": string,"name_a": string,"name_b": string,"relationship_start": string,"settings": NonNullable<Json>,"start_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cover_path"?: string | null,"created_at"?: string,"created_by": string,"id"?: string,"love_letter"?: string | null,"name": string,"name_a": string,"name_b": string,"relationship_start": string,"settings"?: NonNullable<Json>,"start_date": string
                  }
                  Update: {
                    "cover_path"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"love_letter"?: string | null,"name"?: string,"name_a"?: string,"name_b"?: string,"relationship_start"?: string,"settings"?: NonNullable<Json>,"start_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couples_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"daily_answers": {
                  Row: {
                    "answer": string,"created_at": string,"id": string,"question_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": string,"created_at"?: string,"id"?: string,"question_id": string,"user_id": string
                  }
                  Update: {
                    "answer"?: string,"created_at"?: string,"id"?: string,"question_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_answers_question_id_fkey"
      columns: ["question_id"]
isOneToOne: false
      referencedRelation: "daily_questions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_answers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"daily_questions": {
                  Row: {
                    "category": string,"couple_id": string,"created_at": string,"id": string,"question": string,"question_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"couple_id": string,"created_at"?: string,"id"?: string,"question": string,"question_date"?: string
                  }
                  Update: {
                    "category"?: string,"couple_id"?: string,"created_at"?: string,"id"?: string,"question"?: string,"question_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_questions_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"code": string,"couple_id": string,"created_at": string,"created_by": string,"expires_at": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"code": string,"couple_id": string,"created_at"?: string,"created_by": string,"expires_at"?: string,"id"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"code"?: string,"couple_id"?: string,"created_at"?: string,"created_by"?: string,"expires_at"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"memories": {
                  Row: {
                    "author_id": string,"author_role": string | null,"body": string | null,"content": string,"couple_id": string,"created_at": string,"date": string,"id": string,"location": string | null,"memory_date": string,"photos": NonNullable<Json>,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"author_role"?: string | null,"body"?: string | null,"content": string,"couple_id": string,"created_at"?: string,"date": string,"id"?: string,"location"?: string | null,"memory_date": string,"photos"?: NonNullable<Json>,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"author_role"?: string | null,"body"?: string | null,"content"?: string,"couple_id"?: string,"created_at"?: string,"date"?: string,"id"?: string,"location"?: string | null,"memory_date"?: string,"photos"?: NonNullable<Json>,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memories_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memories_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"memory_comments": {
                  Row: {
                    "content": string,"couple_id": string,"created_at": string,"id": string,"memory_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"couple_id": string,"created_at"?: string,"id"?: string,"memory_id": string,"user_id": string
                  }
                  Update: {
                    "content"?: string,"couple_id"?: string,"created_at"?: string,"id"?: string,"memory_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memory_comments_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memory_comments_memory_id_fkey"
      columns: ["memory_id"]
isOneToOne: false
      referencedRelation: "memories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memory_comments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"memory_favorites": {
                  Row: {
                    "couple_id": string,"created_at": string,"memory_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"created_at"?: string,"memory_id": string,"user_id": string
                  }
                  Update: {
                    "couple_id"?: string,"created_at"?: string,"memory_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memory_favorites_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memory_favorites_memory_id_fkey"
      columns: ["memory_id"]
isOneToOne: false
      referencedRelation: "memories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memory_favorites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"memory_media": {
                  Row: {
                    "created_at": string,"id": string,"media_type": string,"memory_id": string,"storage_path": string,"taken_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"media_type": string,"memory_id": string,"storage_path": string,"taken_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"media_type"?: string,"memory_id"?: string,"storage_path"?: string,"taken_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "memory_media_memory_id_fkey"
      columns: ["memory_id"]
isOneToOne: false
      referencedRelation: "memories"
      referencedColumns: ["id"]
    }
                  ]
                },"memory_reactions": {
                  Row: {
                    "couple_id": string,"created_at": string,"emoji": string,"memory_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"created_at"?: string,"emoji": string,"memory_id": string,"user_id": string
                  }
                  Update: {
                    "couple_id"?: string,"created_at"?: string,"emoji"?: string,"memory_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memory_reactions_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memory_reactions_memory_id_fkey"
      columns: ["memory_id"]
isOneToOne: false
      referencedRelation: "memories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memory_reactions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "content": string | null,"couple_id": string,"created_at": string,"id": string,"image_path": string | null,"media_path": string | null,"media_type": string | null,"read_at": string | null,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: string | null,"couple_id": string,"created_at"?: string,"id"?: string,"image_path"?: string | null,"media_path"?: string | null,"media_type"?: string | null,"read_at"?: string | null,"sender_id": string
                  }
                  Update: {
                    "content"?: string | null,"couple_id"?: string,"created_at"?: string,"id"?: string,"image_path"?: string | null,"media_path"?: string | null,"media_type"?: string | null,"read_at"?: string | null,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string,"id": string,"last_login_at": string | null,"last_login_user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name": string,"id": string,"last_login_at"?: string | null,"last_login_user_agent"?: string | null
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"last_login_at"?: string | null,"last_login_user_agent"?: string | null
                  }
                  Relationships: [

                  ]
                },"push_tokens": {
                  Row: {
                    "couple_id": string,"created_at": string,"device_label": string | null,"id": string,"last_seen_at": string,"platform": string,"token": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "couple_id": string,"created_at"?: string,"device_label"?: string | null,"id"?: string,"last_seen_at"?: string,"platform": string,"token": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "couple_id"?: string,"created_at"?: string,"device_label"?: string | null,"id"?: string,"last_seen_at"?: string,"platform"?: string,"token"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_tokens_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"streak_activity_events": {
                  Row: {
                    "activity_date": string,"activity_type": string,"actor_id": string,"couple_id": string,"created_at": string,"id": string,"mood": number | null,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_date": string,"activity_type"?: string,"actor_id": string,"couple_id": string,"created_at"?: string,"id"?: string,"mood"?: number | null,"note"?: string | null
                  }
                  Update: {
                    "activity_date"?: string,"activity_type"?: string,"actor_id"?: string,"couple_id"?: string,"created_at"?: string,"id"?: string,"mood"?: number | null,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "streak_activity_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "streak_activity_events_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                },"streak_day_actions": {
                  Row: {
                    "activity_date": string,"activity_type": string,"couple_id": string,"created_at": string,"mood": number | null,"note": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_date": string,"activity_type"?: string,"couple_id": string,"created_at"?: string,"mood"?: number | null,"note"?: string | null,"user_id": string
                  }
                  Update: {
                    "activity_date"?: string,"activity_type"?: string,"couple_id"?: string,"created_at"?: string,"mood"?: number | null,"note"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "streak_day_actions_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "streak_day_actions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"together_items": {
                  Row: {
                    "category": string,"completed": boolean,"completed_at": string | null,"completed_by": string | null,"couple_id": string,"created_at": string,"created_by": string,"id": string,"note": string | null,"planned_date": string | null,"priority": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"completed"?: boolean,"completed_at"?: string | null,"completed_by"?: string | null,"couple_id": string,"created_at"?: string,"created_by": string,"id"?: string,"note"?: string | null,"planned_date"?: string | null,"priority"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "category"?: string,"completed"?: boolean,"completed_at"?: string | null,"completed_by"?: string | null,"couple_id"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"note"?: string | null,"planned_date"?: string | null,"priority"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "together_items_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "together_items_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "together_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"whispers": {
                  Row: {
                    "body": string | null,"couple_id": string,"created_at": string,"id": string,"media_path": string | null,"media_type": string | null,"read_at": string | null,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"couple_id": string,"created_at"?: string,"id"?: string,"media_path"?: string | null,"media_type"?: string | null,"read_at"?: string | null,"sender_id": string
                  }
                  Update: {
                    "body"?: string | null,"couple_id"?: string,"created_at"?: string,"id"?: string,"media_path"?: string | null,"media_type"?: string | null,"read_at"?: string | null,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "whispers_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "wishes": {
                  Row: {
                    "couple_id": string,"created_at": string,"created_by": string,"description": string | null,"id": string,"is_completed": boolean,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                           "couple_id"?: string | null,"created_at"?: string | null,"created_by"?: string | null,"description"?: string | null,"id"?: string | null,"is_completed"?: boolean | null,"title"?: string | null
                         }
                        Update: {
                           "couple_id"?: string | null,"created_at"?: string | null,"created_by"?: string | null,"description"?: string | null,"id"?: string | null,"is_completed"?: boolean | null,"title"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "together_items_couple_id_fkey"
      columns: ["couple_id"]
isOneToOne: false
      referencedRelation: "couples"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "together_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "accept_couple_invitation":
{ Args: { "invitation_code": string }; Returns: undefined
                           },
"create_couple":
{ Args: { "p_name_a": string,"p_name_b": string,"p_start_date": string }; Returns: string
                           },
"create_couple_with_invitation":
{ Args: { "couple_name": string,"relationship_start": string }; Returns: string
                           },
"daily_answer_count":
{ Args: { "target_question_id": string }; Returns: number
                           },
"ensure_couple_pet":
{ Args: Record<PropertyKey, never>; Returns: {
              "accessories": NonNullable<Json>,
"couple_id": string,
"experience": number,
"hunger": number,
"id": string,
"level": number,
"mood": number,
"name": string,
"skin": string,
"species": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "couple_pets"
        isOneToOne: true
        isSetofReturn: false
      } },
"get_couple_profiles":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"display_name": string,"user_id": string
            }[]
                           },
"get_couple_streak_history":
{ Args: { "p_month"?: string }; Returns: Json
                           },
"get_couple_streak_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_couple_streak_status_payload":
{ Args: { "completed_count": number,"milestone_days"?: number,"newly_completed"?: boolean,"pet": Omit<Database["public"]['Tables']["couple_pets"]['Row'], Database["public"]['Tables']["couple_pets"]['ComputedFields']>,"protection_earned"?: boolean,"protection_used"?: boolean,"reward_key"?: string,"streak": Omit<Database["public"]['Tables']["couple_streaks"]['Row'], Database["public"]['Tables']["couple_streaks"]['ComputedFields']>,"target_couple": string,"today_date": string }; Returns: Json
                           },
"interact_with_couple_pet":
{ Args: { "p_action": string }; Returns: {
              "accessories": NonNullable<Json>,
"couple_id": string,
"experience": number,
"hunger": number,
"id": string,
"level": number,
"mood": number,
"name": string,
"skin": string,
"species": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "couple_pets"
        isOneToOne: true
        isSetofReturn: false
      } },
"is_couple_member":
{ Args: { "target_couple_id": string,"target_user_id"?: string }; Returns: boolean
                           },
"is_same_couple_user":
{ Args: { "p_target_user_id": string }; Returns: boolean
                           },
"join_couple":
{ Args: { "p_couple_id": string }; Returns: string
                           },
"leave_couple_space":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"prepare_account_deletion":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"record_couple_activity":
{ Args: { "p_activity_date"?: string }; Returns: Json
                           },
"record_couple_activity_context":
{ Args: { "p_activity_date": string,"p_activity_type": string,"p_mood": number,"p_note": string }; Returns: Json
                           },
"record_couple_activity_core":
{ Args: { "p_activity_date"?: string }; Returns: Json
                           },
"regenerate_couple_invitation":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"save_ai_diary":
{ Args: { "p_content": string,"p_title": string,"p_work_date": string }; Returns: string
                           },
"update_couple_pet_style":
{ Args: { "p_accessories"?: Json,"p_skin": string,"p_species"?: string }; Returns: {
              "accessories": NonNullable<Json>,
"couple_id": string,
"experience": number,
"hunger": number,
"id": string,
"level": number,
"mood": number,
"name": string,
"skin": string,
"species": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "couple_pets"
        isOneToOne: true
        isSetofReturn: false
      } },
"user_couple_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {

          }
        },"public": {
          Enums: {

          }
        }
} as const
