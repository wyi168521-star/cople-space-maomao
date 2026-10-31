import { createSupabaseClient } from '../lib/supabase'

export default defineNuxtPlugin({
  name: 'supabase',
  setup() {
    const config = useRuntimeConfig()
    if (import.meta.client && import.meta.dev) {
      let origin = '(missing or invalid URL)'
      try { origin = new URL(String(config.public.supabaseUrl)).origin } catch {}
      console.info('[LoveSupabase] configuration', { origin, keyConfigured: Boolean(config.public.supabaseAnonKey) })
    }
    const supabase = createSupabaseClient({
      url: config.public.supabaseUrl as string,
      anonKey: config.public.supabaseAnonKey as string,
      isClient: import.meta.client,
    })
    return { provide: { supabase } }
  },
})
