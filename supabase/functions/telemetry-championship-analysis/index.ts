import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const header = req.headers.get("Authorization");
    if (!header?.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({ error: "Server configuration incomplete" }, 500);

    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(header.slice(7));
    if (authError || !authData.user) return json({ error: "Invalid authentication" }, 401);
    const userId = authData.user.id;
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    const body = await req.json();
    const championshipId = typeof body?.championship_id === "string" ? body.championship_id.trim() : "";
    const referenceSessionId = typeof body?.reference_session_id === "string" ? body.reference_session_id.trim() : "";
    if (!championshipId || !referenceSessionId) return json({ error: "championship_id and reference_session_id are required" }, 400);

    // Caller must be an approved entrant in this championship.
    const { data: callerRegistration, error: callerRegError } = await admin
      .from("championship_registrations").select("id")
      .eq("championship_id", championshipId).eq("user_id", userId).eq("status", "approved").maybeSingle();
    if (callerRegError) return json({ error: "Could not verify championship registration" }, 500);
    if (!callerRegistration) return json({ error: "Approved championship registration required" }, 403);

    // Reference session must belong to a driver owned by the caller.
    const { data: callerDrivers, error: callerDriversError } = await admin
      .from("drivers").select("id").eq("user_id", userId);
    if (callerDriversError) return json({ error: "Could not verify pilot account" }, 500);
    const callerDriverIds = (callerDrivers || []).map((d) => d.id);
    if (!callerDriverIds.length) return json({ error: "No driver profile linked to this account" }, 403);

    const { data: reference, error: referenceError } = await admin
      .from("telemetry_sessions")
      .select("id,user_id,driver_id,track_name,track_config,car_name,status,started_at")
      .eq("id", referenceSessionId).eq("user_id", userId).in("driver_id", callerDriverIds)
      .eq("status", "completed").maybeSingle();
    if (referenceError) return json({ error: "Could not load reference session" }, 500);
    if (!reference) return json({ error: "Completed reference session not found" }, 404);
    if (!reference.track_name || !reference.car_name) {
      return json({ error: "Reference session needs track and car metadata" }, 422);
    }
    // Assetto Corsa may send an empty track_config for the default layout.
    // Empty and null are valid default-layout identifiers when comparing sessions.
    const layout = reference.track_config || "";

    // Only accounts that explicitly enabled sharing for this championship are eligible.
    const { data: shares, error: sharesError } = await admin
      .from("telemetry_championship_shares").select("user_id")
      .eq("championship_id", championshipId).eq("enabled", true);
    if (sharesError) return json({ error: "Could not load sharing permissions" }, 500);
    const sharedUserIds = [...new Set([userId, ...(shares || []).map((s) => s.user_id)])];

    // Keep the audience constrained to approved registrations, even if a share row remains after rejection.
    const { data: registrations, error: registrationsError } = await admin
      .from("championship_registrations").select("user_id,pilot_name")
      .eq("championship_id", championshipId).eq("status", "approved").in("user_id", sharedUserIds);
    if (registrationsError) return json({ error: "Could not load approved entrants" }, 500);
    const approvedUsers = (registrations || []).map((r) => r.user_id);
    if (!approvedUsers.length) return json({ reference, pilots: [] });

    const { data: drivers, error: driversError } = await admin
      .from("drivers").select("id,user_id,name").in("user_id", approvedUsers);
    if (driversError) return json({ error: "Could not load approved pilot profiles" }, 500);
    const driverIds = (drivers || []).map((d) => d.id);
    if (!driverIds.length) return json({ reference, pilots: [] });

    const { data: sessions, error: sessionsError } = await admin
      .from("telemetry_sessions")
      .select("id,user_id,driver_id,track_name,track_config,car_name,session_mode,started_at,best_lap_ms,total_laps")
      .in("user_id", approvedUsers).in("driver_id", driverIds).eq("status", "completed")
      .eq("track_name", reference.track_name).eq("car_name", reference.car_name)
      .order("started_at", { ascending: false }).limit(300);
    if (sessionsError) return json({ error: "Could not load comparable sessions" }, 500);
    // Treat null/empty configuration as the same default layout, but never mix named layouts.
    const matchingSessions = (sessions || []).filter((s) => (s.track_config || "") === layout);
    const sessionIds = matchingSessions.map((s) => s.id);
    if (!sessionIds.length) return json({ reference, pilots: [] });

    // Never return Storage paths, signed URLs, or raw JSONL samples from this endpoint.
    const { data: laps, error: lapsError } = await admin
      .from("telemetry_laps")
      .select("session_id,driver_id,lap_number,lap_time_ms,sector1_ms,sector2_ms,sector3_ms,valid,created_at")
      .in("session_id", sessionIds).eq("valid", true).not("lap_time_ms", "is", null)
      .order("lap_time_ms", { ascending: true }).limit(2000);
    if (lapsError) return json({ error: "Could not load valid lap summaries" }, 500);

    const driverById = new Map((drivers || []).map((d) => [d.id, d]));
    const sessionById = new Map(matchingSessions.map((s) => [s.id, s]));
    const grouped = new Map();
    for (const lap of (laps || [])) {
      const session = sessionById.get(lap.session_id);
      const driver = driverById.get(lap.driver_id);
      if (!session || !driver) continue;
      const key = driver.id;
      if (!grouped.has(key)) grouped.set(key, { driver_id: driver.id, pilot_name: driver.name || "Piloto", laps: [] });
      grouped.get(key).laps.push({
        session_id: session.id, session_started_at: session.started_at,
        lap_number: lap.lap_number, lap_time_ms: lap.lap_time_ms,
        sector1_ms: lap.sector1_ms, sector2_ms: lap.sector2_ms, sector3_ms: lap.sector3_ms,
        valid: lap.valid,
      });
    }
    // Ignore obvious partial/disconnected recordings still marked valid by older agents.
    // Use the fastest recorded lap as reference, keeping only plausible complete laps.
    const pilots = [...grouped.values()].map((pilot) => {
      const fastest = Math.min(...pilot.laps.map((lap) => lap.lap_time_ms));
      const plausible = pilot.laps.filter((lap) => Number.isFinite(lap.lap_time_ms) &&
        lap.lap_time_ms >= 30000 && lap.lap_time_ms <= fastest * 1.65);
      if (!plausible.length) return null;
      return {
        ...pilot, laps: plausible,
        best_lap_ms: Math.min(...plausible.map((lap) => lap.lap_time_ms)),
        average_lap_ms: Math.round(plausible.reduce((sum, lap) => sum + lap.lap_time_ms, 0) / plausible.length),
        valid_laps: plausible.length,
      };
    }).filter(Boolean);
    return json({
      ok: true,
      championship_id: championshipId,
      matching: { track_name: reference.track_name, track_config: reference.track_config, car_name: reference.car_name },
      pilots,
      privacy: "Only approved entrants with sharing enabled; no raw telemetry files or Storage paths are returned.",
    });
  } catch (error) {
    console.error("Championship telemetry analysis error:", error);
    return json({ error: "Invalid request" }, 400);
  }
});
