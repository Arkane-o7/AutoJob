import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return Response.json({ ok: false, code: "method_not_allowed" }, { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!url || !serviceKey || !token) return Response.json({ ok: false, code: "not_authenticated" }, { status: 401, headers: cors });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return Response.json({ ok: false, code: "not_authenticated" }, { status: 401, headers: cors });
  while (true) {
    const { data: files, error: listError } = await admin.storage.from("resumes").list(data.user.id, { limit: 100 });
    if (listError) return Response.json({ ok: false, code: "resume_cleanup_failed" }, { status: 500, headers: cors });
    if (!files?.length) break;
    const removal = await admin.storage.from("resumes").remove(files.map((file) => `${data.user.id}/${file.name}`));
    if (removal.error) return Response.json({ ok: false, code: "resume_cleanup_failed" }, { status: 500, headers: cors });
  }
  const deletion = await admin.auth.admin.deleteUser(data.user.id);
  if (deletion.error) return Response.json({ ok: false, code: "delete_failed" }, { status: 500, headers: cors });
  return Response.json({ ok: true }, { headers: cors });
});
