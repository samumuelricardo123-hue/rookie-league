// Public read-only race flag feed for the Assetto Corsa HUD app.
// Never exposes Supabase keys, pilot data, or write operations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Server configuration missing");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.rpc("race_chat_flag_state");
    if (error) throw error;
    if (!data) return new Response(JSON.stringify({ mode: "OFFLINE", version: 0 }), { headers: cors });
    return new Response(JSON.stringify(data), { headers: cors });
  } catch (_error) {
    return new Response(JSON.stringify({ error: "Flag service unavailable" }), { status: 503, headers: cors });
  }
});
