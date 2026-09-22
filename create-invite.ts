import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const SITE_BASE = "https://axon-systeme.github.io/axon-login";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_TYPES = ["education", "government", "company", "family"];
const SECTORS = ["school", "cafeteria", "archive"];

function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function requireIssuer(userId: string) {
  if (!UUID_RE.test(userId)) return null;
  const { data: user } = await supabase
    .from("users")
    .select("organization_id, role, status")
    .eq("id", userId)
    .maybeSingle();
  if (!user || user.status !== "active" || user.role !== "admin") return null;
  const { data: org } = await supabase
    .from("organizations")
    .select("org_type")
    .eq("id", user.organization_id)
    .maybeSingle();
  if (!org || org.org_type !== "company") return null;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = String(body.action || "create");
    const userId = String(body.user_id || "");

    if (!(await requireIssuer(userId))) {
      return jsonResponse({ error: "هذه العملية مخصصة لإدارة AXON فقط." }, 403);
    }

    if (action === "list") {
      const { data, error } = await supabase
        .from("signup_invites")
        .select("id, token, org_type_allowed, sector, used, used_by_email, used_at, expires_at, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return jsonResponse({
        success: true,
        invites: (data || []).map((i) => ({ ...i, link: `${SITE_BASE}/axon-signup.html?token=${i.token}` })),
      });
    }

    if (action === "revoke") {
      const id = String(body.id || "");
      if (!UUID_RE.test(id)) return jsonResponse({ error: "معرّف غير صالح." }, 400);
      const { error } = await supabase
        .from("signup_invites")
        .update({ used: true, used_by_email: null, used_at: new Date().toISOString() })
        .eq("id", id)
        .eq("used", false);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    if (action === "create") {
      const orgType = String(body.org_type_allowed || "");
      const sector = body.sector ? String(body.sector) : null;
      const days = Number(body.expires_days) > 0 ? Number(body.expires_days) : 2;

      if (!ORG_TYPES.includes(orgType)) return jsonResponse({ error: "نوع مؤسسة غير معروف." }, 400);
      if (sector && !SECTORS.includes(sector)) return jsonResponse({ error: "قطاع غير معروف." }, 400);
      if (days > 30) return jsonResponse({ error: "المدة القصوى 30 يومًا." }, 400);

      const token = genToken();
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

      const { error } = await supabase.from("signup_invites").insert({
        token,
        org_type_allowed: orgType,
        sector,
        expires_at: expiresAt,
        used: false,
      });
      if (error) throw error;

      return jsonResponse({ success: true, link: `${SITE_BASE}/axon-signup.html?token=${token}`, expires_at: expiresAt });
    }

    return jsonResponse({ error: "عملية غير معروفة." }, 400);
  } catch (err) {
    console.error(err);
    const detail = err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : "";
    return jsonResponse({ error: "تعذر تنفيذ العملية.", detail }, 500);
  }
});
