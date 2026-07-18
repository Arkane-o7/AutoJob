import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};

const safeText = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const redactText = (value: unknown, max: number) => safeText(value, max * 2)
  .replace(/data:[^\s,;]+(?:;base64)?,[^\s]+/gi, "[redacted-data]")
  .replace(/(?:https?:\/\/|www\.)\S+/gi, "[redacted-url]")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
  .replace(/\b(?:[A-Za-z0-9+/_-]{20,}={0,2})\b/g, "[redacted-token]")
  .replace(/(?:\+?\d[\s().-]*){8,}\d/g, "[redacted-phone]")
  .slice(0, max);
const safeDomain = (value: unknown) => safeText(value, 255).toLowerCase().replace(/[^a-z0-9.-]/g, "");
const SAFE_ATTRIBUTES = new Set(["aria-labelledby", "aria-describedby", "aria-required", "aria-haspopup", "aria-expanded", "aria-controls", "data-automation-id", "data-testid", "data-test", "data-ui"]);

function sanitizePayload(raw: Record<string, unknown>) {
  const fields = Array.isArray(raw.fields) ? raw.fields.slice(0, 80).map((entry) => {
    const field = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const attributes = field.attributes && typeof field.attributes === "object" ? field.attributes as Record<string, unknown> : {};
    return {
      label: redactText(field.label, 300),
      tag: safeText(field.tag, 24).toLowerCase().replace(/[^a-z0-9-]/g, ""),
      type: safeText(field.type, 48),
      role: safeText(field.role, 48),
      required: Boolean(field.required),
      autocomplete: redactText(field.autocomplete, 80),
      attributes: Object.fromEntries(Object.entries(attributes).filter(([key]) => SAFE_ATTRIBUTES.has(key.toLowerCase())).map(([key, value]) => [key.toLowerCase(), redactText(value, 120)])),
      ancestors: Array.isArray(field.ancestors) ? field.ancestors.slice(0, 4).map((item) => {
        const ancestor = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return { tag: safeText(ancestor.tag, 24), role: safeText(ancestor.role, 48) };
      }) : []
    };
  }) : [];
  return {
    report_version: 1,
    generated_at: new Date().toISOString(),
    source_domain: safeDomain(raw.source_domain),
    platform: safeText(raw.platform, 80),
    extension_version: safeText(raw.extension_version, 40),
    fields
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return Response.json({ ok: false, code: "method_not_allowed" }, { status: 405, headers: cors });
  if (Number(request.headers.get("content-length") || 0) > 65_536) return Response.json({ ok: false, code: "payload_too_large" }, { status: 413, headers: cors });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return Response.json({ ok: false, code: "server_not_configured" }, { status: 503, headers: cors });
  const authorization = request.headers.get("authorization") || "";
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ ok: false, code: "not_authenticated" }, { status: 401, headers: cors });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ ok: false, code: "invalid_json" }, { status: 400, headers: cors }); }
  if (JSON.stringify(body).length > 65_536) return Response.json({ ok: false, code: "payload_too_large" }, { status: 413, headers: cors });
  const description = redactText(body.description, 2000);
  const expected = redactText(body.expected_behavior, 2000);
  const actual = redactText(body.actual_behavior, 2000);
  const payload = sanitizePayload((body.diagnostic_payload && typeof body.diagnostic_payload === "object" ? body.diagnostic_payload : body) as Record<string, unknown>);
  if (!description || !payload.source_domain || payload.fields.length === 0) return Response.json({ ok: false, code: "missing_required_fields" }, { status: 400, headers: cors });

  const hour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [hourResult, dayResult] = await Promise.all([
    admin.from("support_reports").select("id", { count: "exact", head: true }).eq("user_id", userData.user.id).gte("created_at", hour),
    admin.from("support_reports").select("id", { count: "exact", head: true }).eq("user_id", userData.user.id).gte("created_at", day)
  ]);
  if (hourResult.error || dayResult.error) return Response.json({ ok: false, code: "rate_limit_unavailable" }, { status: 503, headers: cors });
  const hourCount = hourResult.count;
  const dayCount = dayResult.count;
  if ((hourCount || 0) >= 5 || (dayCount || 0) >= 20) return Response.json({ ok: false, code: "rate_limited" }, { status: 429, headers: cors });

  const { data, error } = await admin.from("support_reports").insert({
    user_id: userData.user.id,
    extension_version: payload.extension_version,
    source_domain: payload.source_domain,
    platform: payload.platform,
    description,
    expected_behavior: expected,
    actual_behavior: actual,
    diagnostic_payload: payload
  }).select("reference_code").single();
  if (error) return Response.json({ ok: false, code: "insert_failed" }, { status: 500, headers: cors });
  return Response.json({ ok: true, referenceCode: data.reference_code }, { headers: { ...cors, "content-type": "application/json" } });
});
