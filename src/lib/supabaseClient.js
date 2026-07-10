import { createClient } from "@supabase/supabase-js";

// ── Fill these in after creating your Supabase project ──────────────────────
// Supabase Dashboard → Project Settings → API → Project URL / anon public key
const SUPABASE_URL = "https://vahgqzteajcodcoacwoy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhaGdxenRlYWpjb2Rjb2Fjd295Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NDY4ODksImV4cCI6MjA5OTIyMjg4OX0.zX91sRHREdw3g-Z1hn2CcSJMBGDYtdKdTQUk5fhFstY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export const SHOP_ID = "tws-main";
