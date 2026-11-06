import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const newSecretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = legacyServiceKey || newSecretKeys.default;
const publicKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || publicKeys.default || serviceKey;
const ORIGIN = "https://tohatsuwahyu.github.io";
// 追加で許可するOrigin（カンマ区切り、例: http://localhost:8000）。未設定なら本番のみ。
const ALLOWED = [ORIGIN, ...(Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean)];

let currentOrigin = ORIGIN;
function json(body: unknown, status = 200, origin = currentOrigin) {
  // origin は呼び出し側で検証済みの値のみ渡す
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });
}

function tokenHex() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dbHeaders(extra: Record<string, string> = {}) {
  if (!serviceKey) throw new Error("SERVER_KEY_MISSING");
  const h: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json", ...extra };
  if (legacyServiceKey) h.Authorization = "Bearer " + legacyServiceKey;
  return h;
}

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(PROJECT_URL + "/rest/v1/" + path, {
    ...init,
    headers: { ...dbHeaders(), ...(init.headers as Record<string, string> || {}) },
  });
  const text = await res.text();
  let value: any = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  if (!res.ok) throw new Error(value?.message || value?.hint || "DATABASE_REQUEST_FAILED");
  return value;
}

function query(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

async function staffUser(req: Request, roles: string[] = ["admin"]) {
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) throw new Error("ADMIN_LOGIN_REQUIRED");
  const res = await fetch(PROJECT_URL + "/auth/v1/user", {
    headers: { apikey: publicKey, Authorization: "Bearer " + jwt },
  });
  if (!res.ok) throw new Error("ADMIN_LOGIN_REQUIRED");
  const user = await res.json();
  const rows = await db("profiles?" + query({ id: "eq." + user.id, select: "role", limit: "1" }));
  if (!rows[0] || !roles.includes(rows[0].role)) throw new Error("ADMIN_ONLY");
  return user;
}

async function verifyOperator(code: string, token: string) {
  if (!/^[A-Z0-9._-]{2,40}$/.test(code) || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error("OPERATOR_QR_INVALID");
  }
  const rows = await db("operators?" + query({
    code: "eq." + code,
    active: "eq.true",
    select: "id,code,name,active,qr_token_hash",
    limit: "1",
  }));
  const operator = rows[0];
  if (!operator?.qr_token_hash || operator.qr_token_hash !== await sha256(token.toLowerCase())) {
    throw new Error("OPERATOR_QR_INVALID");
  }
  return { id: operator.id, code: operator.code, name: operator.name };
}

async function snapshot(operator: any, code: string) {
  const partRows = await db("parts?" + query({ code: "eq." + code, select: "*", limit: "1" }));
  const part = partRows[0];
  if (!part) throw new Error("PART_NOT_FOUND");
  if (part.status === "completed") throw new Error("PART_COMPLETED");
  const processRows = await db("processes?" + query({ active: "eq.true", select: "*" }));
  const processId = (part.route || [])[part.current_step || 0];
  const process = processRows.find((p: any) => p.id === processId);
  if (!process) throw new Error("PROCESS_NOT_FOUND");
  const sessions = await db("work_sessions?" + query({
    part_id: "eq." + part.id,
    select: "id,part_id,operator_id,process_id,status,started_at,ended_at",
    order: "started_at.desc",
    limit: "300",
  }));
  const ids = sessions.map((s: any) => s.id);
  let segments: any[] = [];
  if (ids.length) {
    segments = await db("work_segments?" + query({
      session_id: "in.(" + ids.join(",") + ")",
      select: "id,session_id,segment_type,started_at,ended_at",
      limit: "1000",
    }));
  }
  let breaks: unknown = null;
  try {
    const st = await db("app_settings?" + query({ key: "eq.breaks", select: "value", limit: "1" }));
    breaks = st[0] ? st[0].value : null;
  } catch (_) { /* 設定テーブル未作成でも動作させる */ }
  return { operator, part, process, processes: processRows, sessions, segments, breaks };
}

const MESSAGES: Record<string, string> = {
  ADMIN_LOGIN_REQUIRED: "管理者ログインが必要です。",
  ADMIN_ONLY: "この操作は管理者・生産管理のみ可能です。",
  OPERATOR_QR_INVALID: "作業者QRが無効です。管理者に再発行を依頼してください。",
  OPERATOR_NOT_FOUND: "作業者が見つかりません。",
  PART_NOT_FOUND: "登録されていないPart QRです。",
  PART_COMPLETED: "このPartは全工程が完了しています。",
  PROCESS_NOT_FOUND: "工程情報を確認できません。生産計画と工程マスタを確認してください。",
  ROUTE_FINISHED: "このPartは全工程が完了しています。",
  OPERATOR_ALREADY_RUNNING: "別の作業を中断してから開始してください。",
  NO_RUNNING_SESSION: "終了する作業がありません。",
  OTHER_OPERATOR_RUNNING: "他の作業者が同じ工程で作業中です。最後の人が工程完了を選んでください。",
  INVALID_RESULT: "操作内容を確認してください。",
  INVALID_EVENT: "中断理由を確認してください。",
  INVALID_END_TIME: "終了時刻が開始より前、または未来です。",
  INVALID_QTY: "数量が正しくありません。",
  UNKNOWN_ACTION: "未対応の操作です。Edge Functionの更新が必要な可能性があります。",
  SERVER_KEY_MISSING: "Supabase Edge Functionのサーバーキー設定が必要です。",
};
function clientError(e: unknown) {
  const raw = e instanceof Error ? e.message : "REQUEST_FAILED";
  const code = raw in MESSAGES ? raw : "REQUEST_FAILED";
  return { error: MESSAGES[code] || "Supabaseの記録に失敗しました。管理者に連絡してください。", code };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  currentOrigin = origin && ALLOWED.includes(origin) ? origin : ORIGIN;
  if (origin && !ALLOWED.includes(origin)) return json({ error: "ORIGIN_NOT_ALLOWED", code: "ORIGIN_NOT_ALLOWED" }, 403, ORIGIN);
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: {
      "Access-Control-Allow-Origin": origin || ORIGIN,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED", code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await req.json();
    if (body.action === "issue_qr") {
      await staffUser(req, ["admin"]);
      const id = String(body.operator_id || "");
      const rows = await db("operators?" + query({
        id: "eq." + id,
        active: "eq.true",
        select: "id,code,name",
        limit: "1",
      }));
      const operator = rows[0];
      if (!operator) throw new Error("OPERATOR_NOT_FOUND");
      const token = tokenHex();
      await db("operators?id=eq." + encodeURIComponent(operator.id), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ qr_token_hash: await sha256(token) }),
      });
      return json({ qr: "OP:" + operator.code + ":" + token, name: operator.name });
    }

    if (body.action === "admin_close_session") {
      await staffUser(req, ["admin", "manager"]);
      const sid = String(body.session_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new Error("NO_RUNNING_SESSION");
      await db("rpc/admin_close_session", {
        method: "POST",
        body: JSON.stringify({ p_session_id: sid, p_ended_at: body.ended_at || null, p_note: String(body.note || "").slice(0, 200) }),
      });
      return json({ ok: true }, 200, origin && ALLOWED.includes(origin) ? origin : ORIGIN);
    }

    if (body.action === "identify" || body.action === "part" || body.action === "start" || body.action === "close") {
      const operator = await verifyOperator(String(body.code || "").toUpperCase(), String(body.token || ""));
      if (body.action === "identify") {
        // 終了し忘れの作業があれば返す（現場端末のバナー表示用）
        const run = await db("work_sessions?" + query({ operator_id: "eq." + operator.id, status: "eq.running", select: "part_id,started_at", limit: "1" }));
        let running = null;
        if (run[0]) {
          const pr = await db("parts?" + query({ id: "eq." + run[0].part_id, select: "code,part_no,name", limit: "1" }));
          if (pr[0]) running = { part_code: pr[0].code, part_no: pr[0].part_no, name: pr[0].name, started_at: run[0].started_at };
        }
        return json({ operator, running });
      }

      const partCode = String(body.part_code || "").trim().toUpperCase();
      if (!/^[A-Z0-9._/-]{1,80}$/.test(partCode)) throw new Error("PART_NOT_FOUND");

      if (body.action === "start") {
        await db("rpc/operator_start", {
          method: "POST",
          body: JSON.stringify({ p_part_code: partCode, p_operator_id: operator.id }),
        });
      } else if (body.action === "close") {
        const allowed = ["STOP", "HOLD_MATERIAL", "HOLD_MACHINE", "URGENT_SWITCH", "NG"];
        const eventType = String(body.event_type || "STOP");
        if (!allowed.includes(eventType)) throw new Error("INVALID_EVENT");
        const result = String(body.result || "");
        const note = String(body.note || "").slice(0, 500);
        const qty = (v: unknown) => {
          if (v === null || v === undefined || v === "") return null;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || n > 9999999) throw new Error("INVALID_QTY");
          return Math.round(n * 100) / 100;
        };
        await db("rpc/operator_close", {
          method: "POST",
          body: JSON.stringify({
            p_part_code: partCode,
            p_operator_id: operator.id,
            p_result: result,
            p_event_type: eventType,
            p_note: note,
            p_qty_good: qty(body.qty_good),
            p_qty_ng: qty(body.qty_ng),
          }),
        });
        return json({ ok: true });
      }
      return json(await snapshot(operator, partCode));
    }
    throw new Error("UNKNOWN_ACTION");
  } catch (e) {
    return json(clientError(e), 200, origin && ALLOWED.includes(origin) ? origin : ORIGIN);
  }
});
