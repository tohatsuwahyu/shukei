/* TSH FLOW | 作業時間集計 — framework-free app
 * Pages: operator (kiosk) / dashboard / signage / admin (計画) / master (マスタ)
 * Browser code only ever holds the publishable key. Never put a service_role key here.
 */
(function () {
"use strict";

/* ============================================================
 * 1. Helpers
 * ============================================================ */
var $ = function (s, p) { return (p || document).querySelector(s); };
var $$ = function (s, p) { return Array.prototype.slice.call((p || document).querySelectorAll(s)); };
var page = document.body.dataset.page;
var TZ = "Asia/Tokyo";                      // 工場のタイムゾーン固定（端末設定に依存しない）
var STALE_HOURS = 10;                       // これ以上動きっぱなしの作業は「終了忘れ」とみなす
var PART_CODE_RE = /^[A-Z0-9._\/-]{1,80}$/; // スキャナと同じ規則（登録時にも検証）
var HISTORY_DAYS = { dashboard: 60, signage: 7, admin: 14, master: 7 };

var esc = function (v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
};
var pad = function (n) { return (n < 10 ? "0" : "") + n; };
var dayFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ });
var dtFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
var tmFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
var day = function (v) { return dayFmt.format(new Date(v)); };           // YYYY-MM-DD (JST)
var dt = function (v) { return v ? dtFmt.format(new Date(v)) : "—"; };
var tm = function (v) { return v ? tmFmt.format(new Date(v)) : "—"; };
var dayStart = function (d) { return new Date(d + "T00:00:00+09:00"); };
var dayEnd = function (d) { return new Date(dayStart(d).getTime() + 86400000); };
var addDays = function (d, n) { return day(dayStart(d).getTime() + n * 86400000 + 43200000); };
var nowMs = function () { return Date.now(); };

function fmtMin(m) {
  m = Math.max(0, Math.round(m || 0));
  if (m < 60) return m + "分";
  var h = Math.floor(m / 60), r = m % 60;
  return h + "時間" + (r ? r + "分" : "");
}
function fmtHours(m) { return (Math.round((m || 0) / 6) / 10).toFixed(1); }
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor(sec % 3600 / 60)) + ":" + pad(sec % 60);
}
function jstInputValue(ms) {
  var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day + "T" + (p.hour === "24" ? "00" : p.hour) + ":" + p.minute;
}
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

/* ---------- icons (inline SVG, no external request) ---------- */
var ICONS = {
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
  chart: '<path d="M4 4v16h16"/><rect x="7" y="11" width="3" height="6" rx=".5"/><rect x="12" y="7" width="3" height="10" rx=".5"/><rect x="17" y="13" width="3" height="4" rx=".5"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  tool: '<path d="M14.5 6.5a4 4 0 0 0 5 5L10 21a2.1 2.1 0 0 1-3-3z"/><path d="M14 7l3-3"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  ng: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M14 6l4 4"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'
};
function icon(n, cls) {
  return '<svg class="i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || "") + "</svg>";
}
function hydrateIcons(root) {
  $$("[data-i]", root).forEach(function (el) {
    if (el.dataset.iDone) return;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.i));
    el.dataset.iDone = "1";
  });
}

/* ---------- toast / dialogs ---------- */
function toast(msg, type) {
  var box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  var el = document.createElement("div");
  el.className = "toast toast-" + (type || "info");
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = icon(type === "error" ? "alert" : type === "ok" ? "done" : "clock") + "<span>" + esc(msg) + "</span>";
  box.appendChild(el);
  setTimeout(function () { el.classList.add("out"); setTimeout(function () { el.remove(); }, 250); }, type === "error" ? 6500 : 3500);
}
function show(e) {
  console.error(e);
  toast(friendly(e), "error");
}
function friendly(e) {
  var m = (e && (e.message || e.error_description)) || String(e || "");
  if (e && e.code === "23505") return "同じコードがすでに登録されています。";
  if (/Failed to fetch|NetworkError|Load failed|Failed to send/i.test(m)) return "ネットワークに接続できません。通信状況を確認してください。";
  if (/JWT|expired/i.test(m)) return "ログインの有効期限が切れました。再度ログインしてください。";
  if (/permission denied|row-level security/i.test(m)) return "この操作を行う権限がありません。";
  return m || "エラーが発生しました。";
}
function confirmDialog(message, okLabel, danger) {
  return new Promise(function (resolve) {
    var d = $("#confirmDialog");
    if (!d) {
      d = document.createElement("dialog"); d.id = "confirmDialog"; d.className = "dialog";
      d.innerHTML = '<form method="dialog"><h2 id="confirmTitle">確認</h2><p id="confirmText"></p><menu><button value="cancel" class="btn btn-quiet">キャンセル</button><button value="ok" id="confirmOk" class="btn btn-primary">OK</button></menu></form>';
      document.body.appendChild(d);
    }
    $("#confirmText", d).textContent = message;
    var ok = $("#confirmOk", d); ok.textContent = okLabel || "OK"; ok.className = "btn " + (danger ? "btn-danger" : "btn-primary");
    d.returnValue = "";
    d.onclose = function () { resolve(d.returnValue === "ok"); };
    d.showModal();
  });
}

/* ============================================================
 * 2. State, Supabase, data layer
 * ============================================================ */
var cfg = window.APP_CONFIG || {};
var live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY && window.supabase);
var sb = live ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY,
  page === "operator" ? { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } : undefined) : null;

var state = { operators: [], processes: [], parts: [], sessions: [], segments: [], events: [], user: null, role: null, since: 0, truncated: false, loadedAt: 0 };
var idx = { part: {}, proc: {}, op: {}, sess: {}, segs: {}, sessByPart: {} };

function reindex() {
  idx = { part: {}, proc: {}, op: {}, sess: {}, segs: {}, sessByPart: {} };
  state.parts.forEach(function (x) { idx.part[x.id] = x; });
  state.processes.forEach(function (x) { idx.proc[x.id] = x; });
  state.operators.forEach(function (x) { idx.op[x.id] = x; });
  state.sessions.forEach(function (x) { idx.sess[x.id] = x; (idx.sessByPart[x.part_id] = idx.sessByPart[x.part_id] || []).push(x); });
  state.segments.forEach(function (x) { (idx.segs[x.session_id] = idx.segs[x.session_id] || []).push(x); });
}

/* PostgRESTは1回で最大1000行まで。ページングで取りこぼしを防ぐ。 */
async function fetchAll(table, cols, mod) {
  var out = [], from = 0, size = 1000;
  for (var i = 0; i < 60; i++) {
    var q = sb.from(table).select(cols);
    if (mod) q = mod(q);
    var r = await q.order("id").range(from, from + size - 1);
    if (r.error) throw r.error;
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < size) return out;
    from += size;
  }
  state.truncated = true;
  return out;
}

async function fetchRole() {
  if (!state.user) { state.role = null; return; }
  var r = await sb.from("profiles").select("role").eq("id", state.user.id).maybeSingle();
  if (r.error) throw r.error;
  state.role = (r.data || {}).role || null;
}

async function load() {
  if (!live) throw new Error("Supabase接続設定が見つかりません。管理者に連絡してください。");
  if (!state.since) state.since = nowMs() - (HISTORY_DAYS[page] || 30) * 86400000;
  var since = new Date(state.since).toISOString();
  state.truncated = false;
  var jobs = [
    fetchAll("operators", "id,code,name,active,created_at", function (q) { return q.eq("active", true).order("code"); }),
    fetchAll("processes", "*", function (q) { return q.eq("active", true).order("created_at"); }),
    fetchAll("parts", "*", function (q) { return q.order("created_at", { ascending: false }); })
  ];
  if (page !== "master") {
    jobs.push(
      fetchAll("work_sessions", "id,part_id,operator_id,process_id,status,started_at,ended_at", function (q) { return q.or("status.eq.running,started_at.gte." + since).order("started_at", { ascending: false }); }),
      fetchAll("work_segments", "id,session_id,segment_type,started_at,ended_at", function (q) { return q.or("ended_at.is.null,started_at.gte." + since); }),
      fetchAll("work_events", "id,session_id,event_type,occurred_at,note", function (q) { return q.gte("occurred_at", since).order("occurred_at", { ascending: false }); })
    );
  }
  var r = await Promise.all(jobs);
  state.operators = r[0]; state.processes = r[1]; state.parts = r[2];
  state.sessions = r[3] || []; state.segments = r[4] || []; state.events = r[5] || [];
  state.loadedAt = nowMs();
  reindex();
}

/* ---------- domain helpers ---------- */
var STATUS = {
  ready: { t: "工程待ち", c: "pill-neutral" },
  in_progress: { t: "作業中", c: "pill-ok" },
  paused: { t: "中断・保留", c: "pill-warn" },
  completed: { t: "全工程完了", c: "pill-done" }
};
function statusPill(s) { var x = STATUS[s] || { t: "未着手", c: "pill-neutral" }; return '<span class="pill ' + x.c + '">' + x.t + "</span>"; }
var EVENTS = {
  HOLD_MATERIAL: { t: "材料切れ", i: "box" },
  HOLD_MACHINE: { t: "設備トラブル", i: "tool" },
  URGENT_SWITCH: { t: "急ぎ仕事へ切替", i: "zap" },
  NG: { t: "NG・修正", i: "ng" }
};
function eventName(x) { return (EVENTS[x] || {}).t || x; }

function procOf(part) { return part && idx.proc[(part.route || [])[part.current_step || 0]]; }
function segMins(g, a, b) {            // 区間 [a,b) と重なる分
  var s = new Date(g.started_at).getTime(), e = g.ended_at ? new Date(g.ended_at).getTime() : nowMs();
  if (a != null) s = Math.max(s, a);
  if (b != null) e = Math.min(e, b);
  return Math.max(0, (e - s) / 60000);
}
function sessMins(id, a, b) {
  return (idx.segs[id] || []).reduce(function (n, g) { return g.segment_type === "work" ? n + segMins(g, a, b) : n; }, 0);
}
function partMins(partId) {
  return (idx.sessByPart[partId] || []).reduce(function (n, s) { return n + sessMins(s.id); }, 0);
}
function pairMins(partId, procId) {
  return (idx.sessByPart[partId] || []).reduce(function (n, s) { return s.process_id === procId ? n + sessMins(s.id) : n; }, 0);
}
function stdOf(procId) { return Number((idx.proc[procId] || {}).standard_minutes) || 0; }
function stdToDate(p) {                 // 「ここまで」の標準時間（完了済み工程＋現工程）
  var r = p.route || [], n = p.status === "completed" ? r.length : Math.min(r.length, (p.current_step || 0) + 1);
  return r.slice(0, n).reduce(function (t, id) { return t + stdOf(id); }, 0);
}
function stdTotal(p) { return (p.route || []).reduce(function (t, id) { return t + stdOf(id); }, 0); }
function dueState(p) {
  if (!p.due_date || p.status === "completed") return null;
  var d = String(p.due_date).slice(0, 10), t = day(nowMs());
  if (d < t) return "over";
  if (d <= addDays(t, 2)) return "soon";
  return null;
}
function dueChip(p) {
  if (!p.due_date) return "—";
  var s = dueState(p), d = String(p.due_date).slice(5, 10).replace("-", "/");
  return '<span class="due' + (s ? " due-" + s : "") + '">' + d + (s === "over" ? " 遅れ" : s === "soon" ? " 間近" : "") + "</span>";
}
function runningSessions() { return state.sessions.filter(function (s) { return s.status === "running"; }); }
function isStale(s) { return s.status === "running" && (nowMs() - new Date(s.started_at).getTime()) > STALE_HOURS * 3600000; }
function routeDots(p) {
  var r = p.route || [], cur = p.current_step || 0;
  return '<span class="route" title="' + esc(r.map(function (id) { return (idx.proc[id] || {}).name || "?"; }).join(" → ")) + '">' +
    r.map(function (id, i) {
      var c = p.status === "completed" || i < cur ? "done" : i === cur ? "cur" : "";
      return '<i class="' + c + '"></i>';
    }).join("") + "</span>";
}

/* ---------- CSV ---------- */
function csvCell(v) {
  if (typeof v === "number") return String(v);
  var s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;       // 表計算ソフトの数式注入を防ぐ
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(name, rows) {
  var text = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  var a = document.createElement("a"), url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}
function csvRows(t) {
  var out = [], row = [], v = "", q = false;
  for (var i = 0; i < t.length; i++) {
    var c = t[i], n = t[i + 1];
    if (c === '"' && q && n === '"') { v += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === "," && !q) { row.push(v.trim()); v = ""; }
    else if ((c === "\n" || c === "\r") && !q) {
      if (c === "\r" && n === "\n") i++;
      row.push(v.trim()); if (row.some(function (x) { return x; })) out.push(row); row = []; v = "";
    } else v += c;
  }
  row.push(v.trim()); if (row.some(function (x) { return x; })) out.push(row);
  return out;
}
async function readCsvFile(file) {
  if (!file) throw new Error("先にCSVファイルを選択してください。");
  var buf = await file.arrayBuffer(), txt = new TextDecoder("utf-8").decode(buf);
  if ((txt.match(/�/g) || []).length > 2) { try { txt = new TextDecoder("shift_jis").decode(buf); } catch (e) { /* keep utf-8 */ } }
  var rows = csvRows(txt);
  if (rows.length < 2) throw new Error("CSVにデータ行がありません。");
  return rows;
}
function keyOf(s) { return String(s || "").replace(/^﻿/, "").replace(/[\s_.\-]/g, "").toLowerCase(); }
function headerGetter(header) {
  var h = header.map(keyOf);
  return function (row, names) {
    var i = names.map(keyOf).map(function (k) { return h.indexOf(k); }).filter(function (k) { return k >= 0; })[0];
    return i == null ? "" : String(row[i] || "").trim();
  };
}

/* ============================================================
 * 3. Shell (sidebar / topbar / tabbar), auth gate
 * ============================================================ */
var NAV = [
  { k: "operator", href: "operator.html", i: "scan", t: "現場スキャン", g: "OPERATIONS" },
  { k: "admin", href: "admin.html", i: "clipboard", t: "生産計画" },
  { k: "dashboard", href: "dashboard.html", i: "chart", t: "実績・分析" },
  { k: "signage", href: "signage.html", i: "monitor", t: "現場モニター" },
  { k: "master", href: "master.html", i: "sliders", t: "マスタ・QR", g: "SYSTEM" },
  { k: "guide", href: "guide.html", i: "help", t: "利用ガイド" }
];
var CRUMB = { admin: "生産管理 / 生産計画", dashboard: "管理 / 実績・分析", signage: "生産管理 / 現場モニター", master: "管理者 / マスタ・QR" };

function renderShell() {
  var sb_ = $("#sidebar"), tb = $("#topbar"), tab = $("#tabbar");
  if (sb_) {
    var h = '<a href="index.html" class="side-brand" aria-label="TSH FLOW ホーム"><img class="logo" src="assets/tsh-logo.png" alt="TOHATSU HATSUJO" width="114" height="50"><span><b>TSH FLOW</b><small>Manufacturing Operations</small></span></a><nav class="side-nav" aria-label="メインメニュー">';
    NAV.forEach(function (n) {
      if (n.g) h += '<p class="side-label">' + n.g + "</p>";
      h += '<a class="side-link' + (n.k === page ? " active" : "") + '" href="' + n.href + '"' + (n.k === page ? ' aria-current="page"' : "") + ">" + icon(n.i) + "<span>" + n.t + "</span></a>";
    });
    sb_.innerHTML = h + "</nav>";
  }
  if (tb) {
    tb.innerHTML = '<p class="crumb">' + esc(CRUMB[page] || "") + '</p><div class="top-actions"><span id="netBadge" class="net-badge"></span><span id="loginUser" class="top-user hidden"></span><button id="logoutButton" type="button" class="btn btn-ghost btn-sm hidden">' + icon("logout") + "<span>ログアウト</span></button></div>";
  }
  if (tab) {
    var main = ["operator", "admin", "dashboard", "signage", "master"];
    tab.innerHTML = NAV.filter(function (n) { return main.indexOf(n.k) >= 0; }).map(function (n) {
      return '<a href="' + n.href + '" class="' + (n.k === page ? "active" : "") + '">' + icon(n.i) + "<span>" + n.t.replace("マスタ・QR", "マスタ").replace("現場スキャン", "スキャン") + "</span></a>";
    }).join("");
  }
  hydrateIcons();
}
function netBadge() {
  var el = $("#netBadge"); if (!el) return;
  var ok = live && navigator.onLine !== false;
  el.className = "net-badge " + (ok ? "net-ok" : "net-bad");
  el.innerHTML = "<i></i>" + (ok ? "オンライン" : live ? "オフライン" : "接続設定なし");
}

var STAFF = ["manager", "admin"];
function loginAddress(v) {
  var x = String(v || "").trim();
  if (!x) throw new Error("ログインIDを入力してください。");
  if (x.indexOf("@") >= 0) return x;
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(x)) throw new Error("ログインIDは英数字と . - _ で入力してください。");
  return x.toLowerCase() + "@shukei.local";
}
function roleLabel(r) { return r === "admin" ? "管理者" : r === "manager" ? "生産管理" : "現場端末"; }

/* 認証ゲート: ログイン → ロール確認 → workspace 表示。通過したら onReady() を呼ぶ */
async function gate(required, onReady) {
  var login = $("#loginPanel"), denied = $("#deniedPanel"), ws = $("#workspace"), msg = $("#loginMessage");
  var user = $("#loginUser"), out = $("#logoutButton");
  async function check() {
    if (live && !state.user) { var a = await sb.auth.getUser(); state.user = a.data && a.data.user || null; }
    if (state.user && !state.role) { try { await fetchRole(); } catch (e) { state.user = null; state.role = null; } }
    var ok = !!state.user && required.indexOf(state.role) >= 0;
    if (login) login.classList.toggle("hidden", !!state.user);
    if (denied) denied.classList.toggle("hidden", !(state.user && !ok));
    if (ws) ws.classList.toggle("hidden", !ok);
    if (user) { user.textContent = state.user ? (state.user.email || "").replace("@shukei.local", "") + " · " + roleLabel(state.role) : ""; user.classList.toggle("hidden", !state.user); }
    if (out) out.classList.toggle("hidden", !state.user);
    return ok;
  }
  if (out) out.onclick = async function () { await sb.auth.signOut(); state.user = null; state.role = null; var r = await check(); if (!r) { var f = $("#loginPassword"); if (f) f.value = ""; } };
  var form = $("#loginForm");
  if (form) form.onsubmit = async function (e) {
    e.preventDefault();
    var btn = $("button", form); btn.disabled = true; if (msg) msg.textContent = "";
    try {
      var r = await sb.auth.signInWithPassword({ email: loginAddress($("#loginEmail").value), password: $("#loginPassword").value });
      if (r.error) throw new Error("ログインIDまたはPIN・パスワードが正しくありません。");
      state.user = r.data.user; state.role = null;
      if (await check()) await onReady();
    } catch (x) { if (msg) msg.textContent = x.message || String(x); }
    finally { btn.disabled = false; }
  };
  if (!live) { if (msg) msg.textContent = "Supabase接続設定が見つかりません。"; if (login) login.classList.remove("hidden"); return; }
  if (await check()) await onReady();
}

/* ============================================================
 * 4. Edge Function gateway (作業者QR認証つき)
 * ============================================================ */
async function gateway(payload) {
  if (!live) throw new Error("Supabase接続設定が見つかりません。管理者に連絡してください。");
  var r = await sb.functions.invoke("operator-gateway", { body: payload });
  if (r.error) {
    var ctx = r.error.context, body = null;
    try { body = ctx && ctx.json ? await ctx.json() : null; } catch (e) { body = null; }
    var err = new Error(body && body.error || r.error.message || "Supabaseに接続できません。"); err.code = body && body.code; throw err;
  }
  if (r.data && r.data.error) { var e2 = new Error(r.data.error); e2.code = r.data.code; throw e2; }
  return r.data;
}

/* ============================================================
 * 5. QR rendering / printing
 * ============================================================ */
function drawQr(el, text, size) {
  el.innerHTML = "";
  if (!window.QRCode) { el.textContent = "QRライブラリを読み込めません"; return; }
  new window.QRCode(el, { text: text, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
}
function labelHtml(it) {
  return '<article class="label label-' + it.kind + '"><div class="label-qr" data-qr="' + esc(it.value) + '"></div><div class="label-text"><p class="label-kicker">' + esc(it.kicker) + '</p><h3>' + esc(it.title) + "</h3><p>" + esc(it.line1 || "") + "</p><p>" + esc(it.line2 || "") + '</p><code>' + esc(it.code) + "</code></div></article>";
}
function printLabels(items) {
  var area = $("#printArea");
  if (!area) return;
  area.innerHTML = items.map(labelHtml).join("");
  $$("[data-qr]", area).forEach(function (el) { drawQr(el, el.dataset.qr, 128); });
  document.body.classList.add("printing");
  var done = function () { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(function () { window.print(); setTimeout(done, 1500); }, 150);
}
function partLabel(p) {
  return { kind: "part", value: "PART:" + p.code, kicker: p.customer || "PART QR", title: p.name || p.code, line1: "製番 " + (p.plan_no || "—") + " / " + (p.part_no || "—"), line2: "数量 " + (p.quantity || 1) + (p.due_date ? " / 納期 " + String(p.due_date).slice(5, 10).replace("-", "/") : ""), code: p.code };
}
var qrCur = null;
function openQrDialog(item, secret) {
  var d = $("#qrDialog"); if (!d) return;
  qrCur = item;
  drawQr($("#qrBox"), item.value, 220);
  $("#qrTitle").textContent = item.title;
  $("#qrSub").textContent = (item.line1 || "") + (item.line2 ? "  " + item.line2 : "");
  $("#qrCode").textContent = secret ? "認証トークンはQR内に格納されています" : item.value;
  $("#qrWarn").classList.toggle("hidden", !secret);
  if (!d.open) d.showModal();
}

/* ============================================================
 * 6. KIOSK (operator.html)
 * ============================================================ */
var I18N = {
  ja: {
    t1: "作業者QRをスキャン", s1: "作業者カードをカメラにかざしてください。", t2: "Part QRをスキャン", s2: "現品票または製品のQRをかざしてください。",
    st1: "作業者", st2: "Part", st3: "作業", notLogged: "作業者未選択", switchW: "作業者を変更", hello: "{n}さん",
    camStart: "カメラを起動しています…", camHint: "QRコードを枠内に入れてください", camErr: "カメラを開始できません。ブラウザのカメラ許可を確認してください。",
    manual: "コードを手入力", manualPh: "例：PT-001", open: "開く", scannerHint: "バーコードリーダーも使えます",
    standby: "開始待ち", working: "作業中", start: "開始", complete: "工程完了", pause: "中断", report: "問題を報告", back: "戻る",
    curProc: "現在工程", thisSession: "今回の作業時間", total: "累計実作業", std: "標準（現工程まで）", qty: "数量", due: "納期", customer: "得意先", planNo: "製番",
    issueTitle: "中断の理由を選択", noteTitle: "理由を入力", notePh: "内容（任意）", record: "記録する", cancel: "キャンセル",
    doneStart: "作業を開始しました", doneComplete: "工程完了を記録しました", donePause: "中断を記録しました", next: "次工程：", allDone: "全工程が完了しました", totalNow: "累計",
    runBanner: "作業中のPartがあります：", resume: "開く", otherRun: "他の作業者が同じ工程で作業中です。最後の人が「工程完了」を選んでください。",
    idle: "操作がないため作業者を解除しました", badQr: "このQRコードは作業時間集計用ではありません。", needWorker: "最初に作業者QRを読み取ってください。",
    offline: "ネットワークに接続できません。再接続を待っています…", soundOn: "音あり", soundOff: "音なし", sec: "秒後に自動で戻ります",
    HOLD_MATERIAL: "材料切れ", HOLD_MACHINE: "設備トラブル", URGENT_SWITCH: "急ぎ仕事へ切替", NG: "NG・修正", process: "工程"
  },
  id: {
    t1: "Pindai QR operator", s1: "Arahkan kartu operator ke kamera.", t2: "Pindai QR Part", s2: "Arahkan QR pada kartu barang atau produk.",
    st1: "Operator", st2: "Part", st3: "Kerja", notLogged: "Belum ada operator", switchW: "Ganti operator", hello: "{n}",
    camStart: "Menyalakan kamera…", camHint: "Posisikan QR di dalam bingkai", camErr: "Kamera tidak dapat dinyalakan. Periksa izin kamera di browser.",
    manual: "Input kode manual", manualPh: "Contoh: PT-001", open: "Buka", scannerHint: "Barcode scanner juga bisa dipakai",
    standby: "Siap mulai", working: "Sedang bekerja", start: "Mulai", complete: "Selesai proses", pause: "Jeda", report: "Laporkan masalah", back: "Kembali",
    curProc: "Proses saat ini", thisSession: "Waktu kerja kali ini", total: "Total waktu aktual", std: "Standar (s/d proses ini)", qty: "Jumlah", due: "Tenggat", customer: "Pelanggan", planNo: "No. Produksi",
    issueTitle: "Pilih alasan jeda", noteTitle: "Tulis alasan", notePh: "Catatan (opsional)", record: "Simpan", cancel: "Batal",
    doneStart: "Pekerjaan dimulai", doneComplete: "Penyelesaian proses tercatat", donePause: "Jeda tercatat", next: "Proses berikut: ", allDone: "Semua proses selesai", totalNow: "Total",
    runBanner: "Ada pekerjaan yang sedang berjalan: ", resume: "Buka", otherRun: "Operator lain masih mengerjakan proses yang sama. Orang terakhir memilih “Selesai proses”.",
    idle: "Operator dilepas karena tidak ada aktivitas", badQr: "QR ini bukan untuk pencatatan waktu kerja.", needWorker: "Pindai QR operator terlebih dahulu.",
    offline: "Tidak ada koneksi jaringan. Menunggu sambungan…", soundOn: "Suara aktif", soundOff: "Suara mati", sec: "detik lagi kembali otomatis",
    HOLD_MATERIAL: "Material habis", HOLD_MACHINE: "Mesin bermasalah", URGENT_SWITCH: "Pindah ke pekerjaan mendesak", NG: "NG / perbaikan", process: "Proses"
  }
};
var ERR_ID = {
  OPERATOR_QR_INVALID: "QR operator tidak valid. Minta admin untuk menerbitkan ulang.", PART_NOT_FOUND: "QR Part belum terdaftar.", PART_COMPLETED: "Part ini sudah selesai semua proses.",
  PROCESS_NOT_FOUND: "Informasi proses tidak ditemukan. Hubungi admin.", ROUTE_FINISHED: "Part ini sudah selesai semua proses.",
  OPERATOR_ALREADY_RUNNING: "Hentikan dulu pekerjaan lain sebelum memulai.", NO_RUNNING_SESSION: "Tidak ada pekerjaan yang sedang berjalan.",
  OTHER_OPERATOR_RUNNING: "Operator lain masih mengerjakan proses yang sama. Orang terakhir memilih “Selesai proses”."
};
var K = {
  lang: store("tsh-lang") === "id" ? "id" : "ja", sound: store("tsh-sound") !== "off",
  worker: null, token: null, part: null, process: null, processes: [], sessions: [], segments: [], running: null,
  busy: false, scanner: null, scanStarting: false, idleAt: nowMs(), lastText: "", lastAt: 0, pendingEvent: null, doneTimer: null
};
function T(k, v) {
  var s = (I18N[K.lang] && I18N[K.lang][k]) || I18N.ja[k] || k;
  if (v) Object.keys(v).forEach(function (x) { s = s.replace("{" + x + "}", v[x]); });
  return s;
}
function kErr(e) {
  if (K.lang === "id" && e && e.code && ERR_ID[e.code]) return ERR_ID[e.code];
  return friendly(e);
}
function kStep() { return !K.worker ? 1 : !K.part ? 2 : 3; }
function kActive() {
  if (!K.worker || !K.part) return null;
  return K.sessions.filter(function (s) { return s.operator_id === K.worker.id && s.part_id === K.part.id && s.status === "running"; })[0] || null;
}
function kIndex() { // snapshot用の簡易インデックス
  idx = { part: {}, proc: {}, op: {}, sess: {}, segs: {}, sessByPart: {} };
  if (K.part) idx.part[K.part.id] = K.part;
  K.processes.forEach(function (x) { idx.proc[x.id] = x; });
  K.sessions.forEach(function (x) { idx.sess[x.id] = x; (idx.sessByPart[x.part_id] = idx.sessByPart[x.part_id] || []).push(x); });
  K.segments.forEach(function (x) { (idx.segs[x.session_id] = idx.segs[x.session_id] || []).push(x); });
}
function kApply(d) {
  if (d.operator) K.worker = d.operator;
  K.part = d.part; K.process = d.process; K.processes = d.processes || []; K.sessions = d.sessions || []; K.segments = d.segments || [];
  kIndex();
}
function kBump() { K.idleAt = nowMs(); }
var actx = null;
function beep(ok) {
  if (K.sound) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.value = ok ? 880 : 220; g.gain.value = 0.07; o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + (ok ? 0.09 : 0.25));
    } catch (e) { /* audio is optional */ }
  }
  try { if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 40, 60]); } catch (e) { /* optional */ }
}

function kRender() {
  var step = kStep();
  document.documentElement.lang = K.lang === "id" ? "id" : "ja";
  $$("[data-t]").forEach(function (el) { el.textContent = T(el.dataset.t); });
  $$("[data-tp]").forEach(function (el) { el.placeholder = T(el.dataset.tp); });
  $$("#kSteps li").forEach(function (li) {
    var n = Number(li.dataset.step);
    li.className = n < step ? "done" : n === step ? "active" : "";
  });
  $("#kLang span").textContent = K.lang === "ja" ? "日本語" : "Indonesia";
  $("#kSound").innerHTML = icon(K.sound ? "vol" : "mute") + "<span>" + T(K.sound ? "soundOn" : "soundOff") + "</span>";
  var chip = $("#kWorker");
  if (K.worker) {
    chip.className = "worker-chip on";
    chip.innerHTML = '<span class="avatar">' + esc(String(K.worker.name || "?").trim().charAt(0)) + '</span><span class="who"><b>' + esc(T("hello", { n: K.worker.name })) + "</b><small>" + esc(K.worker.code) + '</small></span><button type="button" id="kSwitch" class="btn btn-ghost btn-sm">' + esc(T("switchW")) + "</button>";
    $("#kSwitch").onclick = function () { kLogout(); };
  } else { chip.className = "worker-chip"; chip.innerHTML = icon("user") + "<span>" + esc(T("notLogged")) + "</span>"; }

  $("#scanSection").classList.toggle("hidden", step === 3);
  $("#jobSection").classList.toggle("hidden", step !== 3);
  if (step < 3) {
    $("#kTitle").textContent = T(step === 1 ? "t1" : "t2");
    $("#kSub").textContent = T(step === 1 ? "s1" : "s2");
    $("#manualBox").classList.toggle("hidden", step !== 2);
    var rb = $("#runBanner"), show_ = step === 2 && !!K.running;
    rb.classList.toggle("hidden", !show_);
    if (show_) {
      $("#runBannerText").textContent = T("runBanner") + (K.running.part_no || K.running.part_code) + " / " + (K.running.name || "");
      $("#runBannerBtn").textContent = T("resume");
    }
    kStartScan();
  } else { kStopScan(); kRenderJob(); }
  kTick();
}

function kRenderJob() {
  var p = K.part, pr = K.process, s = kActive();
  var st = $("#jobStatus"); st.className = "pill " + (s ? "pill-ok" : "pill-neutral"); st.innerHTML = (s ? '<i class="pulse"></i>' : "") + esc(T(s ? "working" : "standby"));
  $("#jobTitle").textContent = (p.part_no || p.code) + " / " + p.name;
  $("#jobProcess").textContent = T("curProc") + "：" + (pr ? pr.name : "—");
  var meta = [[T("customer"), p.customer], [T("planNo"), p.plan_no], [T("qty"), p.quantity + (K.lang === "ja" ? " 個" : " pcs")], [T("due"), p.due_date ? String(p.due_date).slice(0, 10).replace(/-/g, "/") : ""]];
  $("#jobMeta").innerHTML = meta.filter(function (m) { return m[1]; }).map(function (m) { return "<div><dt>" + esc(m[0]) + "</dt><dd>" + esc(m[1]) + "</dd></div>"; }).join("");
  $("#jobRoute").innerHTML = (p.route || []).map(function (id, i) {
    var c = i < (p.current_step || 0) ? "done" : i === (p.current_step || 0) ? "cur" : "";
    return '<li class="' + c + '"><b>' + (i + 1) + "</b><span>" + esc((idx.proc[id] || {}).name || "?") + "</span></li>";
  }).join("");
  $("#timerBox").classList.toggle("hidden", !s);
  $("#workActions").innerHTML = s
    ? '<button id="btnComplete" class="kbtn kbtn-primary">' + icon("done") + "<span>" + esc(T("complete")) + '</span></button><button id="btnPause" class="kbtn kbtn-warn">' + icon("pause") + "<span>" + esc(T("pause")) + '</span></button><button id="btnIssue" class="kbtn kbtn-quiet">' + icon("alert") + "<span>" + esc(T("report")) + "</span></button>"
    : '<button id="btnStart" class="kbtn kbtn-primary kbtn-xl">' + icon("play") + "<span>" + esc(T("start")) + '</span></button><button id="btnBack" class="kbtn kbtn-quiet">' + icon("left") + "<span>" + esc(T("back")) + "</span></button>";
  var on = function (id, fn) { var el = $(id); if (el) el.onclick = function () { kBump(); fn(); }; };
  on("#btnStart", kStart);
  on("#btnBack", function () { K.part = null; K.process = null; kRender(); });
  on("#btnComplete", function () {
    var others = K.sessions.some(function (x) { return x.part_id === K.part.id && x.process_id === K.process.id && x.status === "running" && x.id !== s.id; });
    if (others) { toast(T("otherRun"), "error"); beep(false); return; }
    kClose("complete");
  });
  on("#btnPause", function () { kClose("pause"); });
  on("#btnIssue", function () { $("#issueDialog").showModal(); });
}

function kTick() {
  var clock = $("#kClock"); if (clock) clock.textContent = tm(nowMs());
  if (kStep() === 3) {
    var s = kActive(), p = K.part;
    var actual = partMins(p.id), std = stdToDate(p);
    $("#actualTime").textContent = fmtMin(actual);
    $("#standardTime").textContent = std ? fmtMin(std) : "—";
    var bar = $("#jobBar"); bar.style.width = std ? Math.min(100, actual / std * 100) + "%" : "0%"; bar.parentNode.classList.toggle("over", std > 0 && actual > std);
    if (s) $("#jobTimer").textContent = fmtClock((nowMs() - new Date(s.started_at).getTime()) / 1000);
  }
  var rb = $("#runBannerTime");
  if (rb && K.running && !$("#runBanner").classList.contains("hidden")) rb.textContent = fmtClock((nowMs() - new Date(K.running.started_at).getTime()) / 1000);
  var nb = $("#netBanner"); if (nb) nb.classList.toggle("hidden", navigator.onLine !== false);
}

async function kBusy(fn) {
  if (K.busy) return;
  K.busy = true; document.body.classList.add("is-busy");
  try { return await fn(); } catch (e) { beep(false); toast(kErr(e), "error"); } finally { K.busy = false; document.body.classList.remove("is-busy"); }
}
function kLogout(auto) {
  K.worker = null; K.token = null; K.part = null; K.process = null; K.sessions = []; K.segments = []; K.running = null;
  kIndex(); kRender();
  if (auto) toast(T("idle"), "info");
}
async function kStart() {
  return kBusy(async function () {
    var d = await gateway({ action: "start", code: K.worker.code, token: K.token, part_code: K.part.code });
    kApply(d); beep(true); kRender(); toast(T("doneStart"), "ok");
  });
}
async function kClose(result, reason, note) {
  return kBusy(async function () {
    var p = K.part, proc = K.process, total = partMins(p.id);
    var nextName = null;
    if (result === "complete") { var r = p.route || [], n = r.indexOf(proc.id) + 1; nextName = n < r.length ? (K.processes.filter(function (x) { return x.id === r[n]; })[0] || {}).name || "" : ""; }
    await gateway({ action: "close", code: K.worker.code, token: K.token, part_code: p.code, result: result, event_type: reason || "STOP", note: note || "" });
    K.part = null; K.process = null; K.sessions = []; K.segments = []; K.running = null; kIndex();
    beep(true); kDone(result === "complete" ? "doneComplete" : "donePause", result === "complete" ? (nextName ? T("next") + nextName : T("allDone")) : "", T("totalNow") + " " + fmtMin(total));
  });
}
function kDone(titleKey, line1, line2) {
  var o = $("#doneOverlay"), left = 3;
  $("#doneIcon").innerHTML = icon(titleKey === "donePause" ? "pause" : "done");
  o.className = "done-overlay " + (titleKey === "donePause" ? "is-pause" : "is-ok");
  $("#doneTitle").textContent = T(titleKey);
  $("#doneSub").textContent = [line1, line2].filter(Boolean).join("  ·  ");
  var cd = $("#doneCount");
  var finish = function () { clearInterval(K.doneTimer); o.className = "done-overlay hidden"; kRender(); };
  cd.textContent = left + " " + T("sec");
  clearInterval(K.doneTimer);
  K.doneTimer = setInterval(function () { left--; if (left <= 0) finish(); else cd.textContent = left + " " + T("sec"); }, 1000);
  o.onclick = finish;
  kRenderBehind();
}
function kRenderBehind() { $("#scanSection").classList.add("hidden"); $("#jobSection").classList.add("hidden"); }

async function kAccept(raw) {
  var v = String(raw || "").trim(), m;
  if ((m = v.match(/^OP:([A-Z0-9._-]{2,40}):([a-f0-9]{64})$/i))) {
    return kBusy(async function () {
      var d = await gateway({ action: "identify", code: m[1].toUpperCase(), token: m[2].toLowerCase() });
      K.worker = d.operator; K.token = m[2].toLowerCase(); K.running = d.running || null;
      K.part = null; K.process = null; K.sessions = []; K.segments = []; kIndex(); beep(true); kRender();
    });
  }
  if ((m = v.match(/^PART:([A-Z0-9._\/-]{1,80})$/i))) {
    if (!K.worker || !K.token) { beep(false); toast(T("needWorker"), "error"); return; }
    return kBusy(async function () {
      var d = await gateway({ action: "part", code: K.worker.code, token: K.token, part_code: m[1].toUpperCase() });
      kApply(d); beep(true); kRender();
    });
  }
  beep(false); toast(T("badQr"), "error");
}
function kOnDecode(text) {
  var t = nowMs();
  if (K.busy || (text === K.lastText && t - K.lastAt < 2500)) return;
  K.lastText = text; K.lastAt = t; kBump(); kAccept(text);
}

/* ---------- camera ---------- */
async function kStartScan() {
  var msg = $("#cameraMessage");
  if (K.scanner || K.scanStarting) return;
  var tries = 0;
  while (!window.Html5Qrcode && tries++ < 20) await new Promise(function (r) { setTimeout(r, 150); });
  if (!window.Html5Qrcode) { if (msg) msg.textContent = T("camErr"); return; }
  if (kStep() === 3) return;
  K.scanStarting = true;
  if (msg) msg.textContent = T("camStart");
  var cfgScan = { fps: 10, qrbox: function (w, h) { var s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s }; } };
  try {
    var sc = new window.Html5Qrcode("reader");
    try { await sc.start({ facingMode: "environment" }, cfgScan, kOnDecode, function () {}); }
    catch (e1) { await sc.start({ facingMode: "user" }, cfgScan, kOnDecode, function () {}); }
    K.scanner = sc;
    if (msg) msg.textContent = T("camHint");
    if (kStep() === 3) kStopScan();
  } catch (e) { K.scanner = null; if (msg) msg.textContent = T("camErr"); }
  finally { K.scanStarting = false; }
}
async function kStopScan() {
  var sc = K.scanner; K.scanner = null;
  if (sc) { try { await sc.stop(); } catch (e) { /* already stopped */ } try { sc.clear(); } catch (e) { /* ignore */ } }
}

/* ---------- setup ---------- */
function setupKiosk() {
  hydrateIcons();
  var wake = null;
  var lock = async function () { try { if (navigator.wakeLock && document.visibilityState === "visible") wake = await navigator.wakeLock.request("screen"); } catch (e) { wake = null; } };
  lock();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { lock(); if (kStep() < 3) kStartScan(); } else kStopScan();
  });
  ["pointerdown", "keydown"].forEach(function (ev) { document.addEventListener(ev, kBump, { passive: true }); });
  $("#kLang").onclick = function () { K.lang = K.lang === "ja" ? "id" : "ja"; store("tsh-lang", K.lang); kRender(); };
  $("#kSound").onclick = function () { K.sound = !K.sound; store("tsh-sound", K.sound ? "on" : "off"); kRender(); if (K.sound) beep(true); };
  $("#manualForm").onsubmit = function (e) {
    e.preventDefault();
    var v = $("#manualCode").value.trim().toUpperCase();
    if (v) { $("#manualCode").value = ""; kAccept("PART:" + v); }
  };
  $("#runBannerBtn").onclick = function () { if (K.running) kAccept("PART:" + K.running.part_code); };
  $$("[data-event]").forEach(function (b) {
    b.onclick = function (e) {
      e.preventDefault(); $("#issueDialog").close();
      K.pendingEvent = b.dataset.event;
      $("#noteTitle").textContent = T(K.pendingEvent); $("#eventNote").value = ""; $("#noteDialog").showModal();
    };
  });
  $("#noteForm").onsubmit = function (e) {
    if (e.submitter && e.submitter.value === "cancel") return;
    e.preventDefault(); var why = K.pendingEvent; $("#noteDialog").close(); kClose("pause", why, $("#eventNote").value);
  };
  // キーボードウェッジ型バーコードリーダー: 文字列＋Enter を検出
  var buf = "", last = 0;
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    var t = nowMs(); if (t - last > 120) buf = ""; last = t;
    if (e.key === "Enter") { if (/^(OP|PART):/i.test(buf)) kAccept(buf); buf = ""; }
    else if (e.key.length === 1) buf += e.key;
  });
  setInterval(function () {
    kTick();
    if (K.worker && !K.busy) {
      var limit = kActive() ? 300000 : 90000;
      if (nowMs() - K.idleAt > limit && $("#doneOverlay").classList.contains("hidden")) kLogout(true);
    }
  }, 1000);
  window.addEventListener("online", kTick); window.addEventListener("offline", kTick);
  kRender();
}

/* ============================================================
 * 7. DASHBOARD
 * ============================================================ */
var D = { day: "", proc: "", chip: "all", q: "", limit: 25, timer: null };

async function ensureWindow(d) {
  var need = dayStart(d).getTime() - 86400000;
  if (need < state.since) { state.since = need; await load(); }
}
async function dashReload() {
  await ensureWindow(D.day);
  await load();
  dashRender();
}
function dashDaySessions() {
  var a = dayStart(D.day).getTime(), b = dayEnd(D.day).getTime();
  return state.sessions.filter(function (s) {
    if (D.proc && s.process_id !== D.proc) return false;
    return (idx.segs[s.id] || []).some(function (g) { return segMins(g, a, b) > 0 || (!g.ended_at && new Date(g.started_at) < b && D.day === day(nowMs())); });
  });
}
function bars(sel, rows) {
  var max = Math.max.apply(null, [1].concat(rows.map(function (x) { return x.value; })));
  $(sel).innerHTML = rows.filter(function (x) { return x.value > 0.5; }).sort(function (a, b) { return b.value - a.value; }).map(function (x) {
    return '<div class="bar-row"><b title="' + esc(x.label) + '">' + esc(x.label) + '</b><div class="bar"><i style="width:' + Math.max(2, x.value / max * 100) + '%"></i></div><span>' + fmtMin(x.value) + "</span></div>";
  }).join("") || '<p class="empty">この日の記録はありません。</p>';
}
function dashRender() {
  var f = $("#filterProcess"), old = D.proc;
  f.innerHTML = '<option value="">全工程</option>' + state.processes.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join("");
  f.value = old;
  var a = dayStart(D.day).getTime(), b = dayEnd(D.day).getTime();
  var ss = dashDaySessions(), isToday = D.day === day(nowMs());
  var dayMin = ss.reduce(function (n, s) { return n + sessMins(s.id, a, b); }, 0);
  var inDay = {}; ss.forEach(function (s) { inDay[s.id] = true; });
  var holds = state.events.filter(function (e) { var t = new Date(e.occurred_at).getTime(); return EVENTS[e.event_type] && t >= a && t < b && (!D.proc || (idx.sess[e.session_id] || {}).process_id === D.proc); });
  var run = runningSessions(), stale = run.filter(isStale);
  var overdue = state.parts.filter(function (p) { return dueState(p) === "over"; });
  var soon = state.parts.filter(function (p) { return dueState(p) === "soon"; });

  // alerts
  var al = "";
  if (stale.length) al += '<div class="alert alert-warn">' + icon("alert") + "<div><b>終了忘れの可能性があります（" + stale.length + "件）</b><p>" + stale.map(function (s) { return esc((idx.part[s.part_id] || {}).part_no || "—") + "（" + esc((idx.op[s.operator_id] || {}).name || "—") + " / " + fmtMin((nowMs() - new Date(s.started_at)) / 60000) + "）"; }).join("、") + "。下の作業明細から終了時刻を指定して締められます。</p></div></div>";
  if (state.truncated) al += '<div class="alert alert-info">' + icon("clock") + "<div><b>データが多いため一部のみ表示しています</b><p>期間を絞って確認してください。</p></div></div>";
  $("#alertArea").innerHTML = al;

  $("#kpiGrid").innerHTML = [
    ["clock", "実作業時間", fmtHours(dayMin) + "<small> 時間</small>", fmtMin(dayMin) + "（" + (isToday ? "本日" : D.day.slice(5).replace("-", "/")) + "）", ""],
    ["users", "稼働中の作業者", run.length + "<small> 人</small>", "この日の参加 " + new Set(ss.map(function (s) { return s.operator_id; })).size + "人", run.length ? "ok" : ""],
    ["alert", "中断・NG", holds.length + "<small> 件</small>", Object.keys(EVENTS).map(function (k) { var n = holds.filter(function (e) { return e.event_type === k; }).length; return n ? EVENTS[k].t + n : ""; }).filter(Boolean).join("・") || "記録なし", holds.length ? "warn" : ""],
    ["calendar", "納期遅れ", overdue.length + "<small> 件</small>", "2日以内 " + soon.length + "件", overdue.length ? "bad" : ""]
  ].map(function (x) { return '<article class="kpi ' + x[4] + '"><span class="kpi-icon">' + icon(x[0]) + '</span><div><p>' + x[1] + "</p><strong>" + x[2] + "</strong><small>" + x[3] + "</small></div></article>"; }).join("");

  // part table
  var q = D.q.toLowerCase();
  var parts = state.parts.filter(function (p) {
    if (D.chip === "over" ? dueState(p) !== "over" : D.chip !== "all" && p.status !== D.chip) return false;
    return !q || [p.code, p.plan_no, p.part_no, p.name, p.customer, p.product_no].join(" ").toLowerCase().indexOf(q) >= 0;
  });
  var rank = { in_progress: 0, paused: 1, ready: 2, completed: 3 };
  parts.sort(function (x, y) { return (rank[x.status] - rank[y.status]) || String(x.due_date || "9999").localeCompare(String(y.due_date || "9999")); });
  var counts = { all: state.parts.length, in_progress: 0, paused: 0, ready: 0, completed: 0, over: overdue.length };
  state.parts.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
  $$("#partChips [data-chip]").forEach(function (c) { c.classList.toggle("on", c.dataset.chip === D.chip); var n = $("b", c); if (n) n.textContent = counts[c.dataset.chip] || 0; });
  $("#partCount").textContent = parts.length + " 件";
  var shown = parts.slice(0, D.limit);
  $("#partReport").innerHTML = shown.map(function (p) {
    var q_ = procOf(p), act = partMins(p.id), std = stdToDate(p), diff = std ? act - std : 0, cur = Math.min(p.current_step || 0, (p.route || []).length);
    return "<tr><td><b>" + esc(p.plan_no || p.code) + "</b><small>" + esc(p.code) + "</small></td><td>" + esc(p.name) + "<small>" + esc(p.part_no || "") + (p.customer ? " · " + esc(p.customer) : "") + "</small></td><td>" +
      esc(q_ ? q_.name : p.status === "completed" ? "完了" : "—") + '<small class="route-line">' + routeDots(p) + " " + cur + "/" + (p.route || []).length + "</small></td><td>" + dueChip(p) + "</td><td>" + statusPill(p.status) + '</td><td class="num">' + fmtMin(act) +
      "<small>" + (std ? "標準 " + fmtMin(std) + ' <em class="' + (diff > 0 ? "neg" : "pos") + '">' + (diff > 0 ? "+" : "") + Math.round(diff) + "分</em>" : "標準未設定") + "</small></td></tr>";
  }).join("") || '<tr><td colspan="6" class="empty">条件に合う計画がありません。</td></tr>';
  var more = $("#partMore"); more.classList.toggle("hidden", parts.length <= D.limit); more.textContent = "さらに表示（残り " + (parts.length - D.limit) + " 件）";

  bars("#processReport", state.processes.map(function (p) { return { label: p.name, value: ss.filter(function (s) { return s.process_id === p.id; }).reduce(function (n, s) { return n + sessMins(s.id, a, b); }, 0) }; }));
  bars("#operatorReport", state.operators.map(function (o) { return { label: o.name, value: ss.filter(function (s) { return s.operator_id === o.id; }).reduce(function (n, s) { return n + sessMins(s.id, a, b); }, 0) }; }));

  $("#eventReport").innerHTML = holds.slice(0, 30).map(function (e) {
    var s = idx.sess[e.session_id] || {}, p = idx.part[s.part_id] || {}, o = idx.op[s.operator_id] || {};
    return '<div class="event"><span class="event-i">' + icon((EVENTS[e.event_type] || {}).i || "alert") + "</span><div><b>" + esc(eventName(e.event_type)) + "</b><small>" + dt(e.occurred_at) + " · " + esc(p.part_no || p.code || "—") + " · " + esc(o.name || "—") + "</small>" + (e.note ? "<p>" + esc(e.note) + "</p>" : "") + "</div></div>";
  }).join("") || '<p class="empty">この日の中断・NG記録はありません。</p>';

  // part×process variance (cumulative per pair)
  var seen = {}, pairs = [];
  ss.forEach(function (s) { var k = s.part_id + "|" + s.process_id; if (seen[k]) return; seen[k] = 1; var act = pairMins(s.part_id, s.process_id), std = stdOf(s.process_id); pairs.push({ s: s, act: act, std: std, diff: std ? act - std : -1e9 }); });
  pairs.sort(function (x, y) { return y.diff - x.diff; });
  $("#varianceReport").innerHTML = pairs.slice(0, 12).map(function (x) {
    var p = idx.part[x.s.part_id] || {}, pr = idx.proc[x.s.process_id] || {}, pct = x.std ? Math.round(x.act / x.std * 100) : null;
    return "<tr><td><b>" + esc(p.part_no || p.code || "—") + "</b></td><td>" + esc(pr.name || "—") + '</td><td class="num">' + fmtMin(x.act) + '</td><td class="num">' + (x.std ? fmtMin(x.std) : "—") + '</td><td class="num">' + (pct == null ? "—" : '<span class="pill ' + (pct > 120 ? "pill-bad" : pct > 100 ? "pill-warn" : "pill-ok") + '">' + pct + "%</span>") + "</td></tr>";
  }).join("") || '<tr><td colspan="5" class="empty">記録がありません。</td></tr>';

  // sessions
  var staff = STAFF.indexOf(state.role) >= 0;
  $("#sessionReport").innerHTML = ss.slice().sort(function (x, y) { return new Date(y.started_at) - new Date(x.started_at); }).slice(0, 200).map(function (s) {
    var p = idx.part[s.part_id] || {}, pr = idx.proc[s.process_id] || {}, o = idx.op[s.operator_id] || {}, runningNow = s.status === "running", st = isStale(s);
    return "<tr" + (st ? ' class="row-warn"' : "") + "><td>" + dt(s.started_at) + "</td><td>" + (s.ended_at ? tm(s.ended_at) : "—") + "</td><td><b>" + esc(p.part_no || p.code || "—") + "</b></td><td>" + esc(o.name || "—") + "</td><td>" + esc(pr.name || "—") + '</td><td class="num">' + fmtMin(sessMins(s.id, a, b)) + "</td><td>" +
      (runningNow ? '<span class="pill ' + (st ? "pill-bad" : "pill-ok") + '"><i class="pulse"></i>' + (st ? "終了忘れ？" : "作業中") + "</span>" : '<span class="pill pill-neutral">終了</span>') + "</td><td>" +
      (runningNow && staff ? '<button class="btn btn-secondary btn-sm" data-force="' + esc(s.id) + '">終了する</button>' : "") + "</td></tr>";
  }).join("") || '<tr><td colspan="8" class="empty">この日の記録がありません。</td></tr>';
  $$("[data-force]").forEach(function (b) { b.onclick = function () { openForceClose(b.dataset.force); }; });

  $("#dashboardNotice").textContent = "最終更新 " + tm(state.loadedAt) + (state.since ? " ・ 直近" + Math.round((nowMs() - state.since) / 86400000) + "日分" : "");
}
function openForceClose(id) {
  var s = idx.sess[id]; if (!s) return;
  var p = idx.part[s.part_id] || {}, o = idx.op[s.operator_id] || {};
  $("#forceInfo").textContent = (p.part_no || p.code) + " / " + (o.name || "") + " / 開始 " + dt(s.started_at);
  var inp = $("#forceEnd"); inp.value = jstInputValue(nowMs()); inp.min = jstInputValue(new Date(s.started_at).getTime()); inp.max = jstInputValue(nowMs());
  $("#forceNote").value = "";
  $("#forceForm").dataset.id = id; $("#forceDialog").showModal();
}
async function submitForceClose(e) {
  if (e.submitter && e.submitter.value === "cancel") return;
  e.preventDefault();
  var f = e.target, btn = e.submitter; btn.disabled = true;
  try {
    var end = new Date($("#forceEnd").value + ":00+09:00");
    if (isNaN(end)) throw new Error("終了時刻を入力してください。");
    await gateway({ action: "admin_close_session", session_id: f.dataset.id, ended_at: end.toISOString(), note: $("#forceNote").value });
    $("#forceDialog").close(); toast("作業を終了しました。", "ok"); await dashReload();
  } catch (x) { show(x); } finally { btn.disabled = false; }
}
function exportDashboardCsv() {
  var a = dayStart(D.day).getTime(), b = dayEnd(D.day).getTime(), ss = dashDaySessions();
  var rows = [["作業時間集計結果", D.day], [], ["Part別進捗"], ["Part QR", "製番", "図番", "品名", "状態", "実作業時間(分)", "標準時間・現工程まで(分)", "標準時間・全工程(分)", "納期"]]
    .concat(state.parts.map(function (p) { return [p.code, p.plan_no, p.part_no, p.name, (STATUS[p.status] || {}).t, Math.round(partMins(p.id)), Math.round(stdToDate(p)), Math.round(stdTotal(p)), p.due_date || ""]; }))
    .concat([[], ["作業明細（当日分）"], ["開始", "終了", "Part QR", "図番", "作業者", "工程", "当日実作業(分)", "状態"]])
    .concat(ss.map(function (s) {
      var p = idx.part[s.part_id] || {}, o = idx.op[s.operator_id] || {}, q = idx.proc[s.process_id] || {};
      return [s.started_at, s.ended_at || "", p.code || "", p.part_no || "", o.name || "", q.name || "", Math.round(sessMins(s.id, a, b)), s.status];
    }))
    .concat([[], ["工程別 標準比較（Part×工程の累計）"], ["図番", "工程", "累計実作業(分)", "標準(分)", "達成率(%)"]]);
  var seen = {};
  ss.forEach(function (s) { var k = s.part_id + "|" + s.process_id; if (seen[k]) return; seen[k] = 1; var act = pairMins(s.part_id, s.process_id), std = stdOf(s.process_id); rows.push([(idx.part[s.part_id] || {}).part_no || "", (idx.proc[s.process_id] || {}).name || "", Math.round(act), Math.round(std), std ? Math.round(act / std * 100) : ""]); });
  downloadCsv("作業時間集計_" + D.day + ".csv", rows);
}
async function setupDashboard() {
  D.day = day(nowMs()); $("#filterDate").value = D.day;
  var go = function (d) { D.day = d; $("#filterDate").value = d; D.limit = 25; dashReload().catch(show); };
  $("#filterDate").onchange = function () { if (this.value) go(this.value); };
  $("#datePrev").onclick = function () { go(addDays(D.day, -1)); };
  $("#dateNext").onclick = function () { go(addDays(D.day, 1)); };
  $("#dateToday").onclick = function () { go(day(nowMs())); };
  $("#filterProcess").onchange = function () { D.proc = this.value; dashRender(); };
  $("#partSearch").oninput = function () { D.q = this.value.trim(); D.limit = 25; dashRender(); };
  $$("#partChips [data-chip]").forEach(function (c) { c.onclick = function () { D.chip = c.dataset.chip; D.limit = 25; dashRender(); }; });
  $("#partMore").onclick = function () { D.limit += 50; dashRender(); };
  $("#refreshDashboard").onclick = function () { var b = this; b.disabled = true; dashReload().catch(show).then(function () { b.disabled = false; }); };
  $("#exportCsv").onclick = exportDashboardCsv;
  $("#forceForm").onsubmit = submitForceClose;
  $("#autoRefresh").onchange = function () {
    clearInterval(D.timer); store("tsh-auto", this.checked ? "1" : "0");
    if (this.checked) D.timer = setInterval(function () { if (document.visibilityState === "visible") dashReload().catch(console.error); }, 60000);
  };
  $("#autoRefresh").checked = store("tsh-auto") === "1"; $("#autoRefresh").onchange.call($("#autoRefresh"));
  await load(); dashRender();
  setInterval(function () { if (!$("#workspace").classList.contains("hidden")) dashRender(); }, 30000);
}

/* ============================================================
 * 8. SIGNAGE
 * ============================================================ */
var SG = { page: 0, per: 10 };
function sgRender() {
  var run = runningSessions(), parts = state.parts.filter(function (p) { return p.status !== "completed"; });
  var working = parts.filter(function (p) { return p.status === "in_progress"; }), waiting = parts.filter(function (p) { return p.status === "ready"; }), paused = parts.filter(function (p) { return p.status === "paused"; });
  var overdue = parts.filter(function (p) { return dueState(p) === "over"; });
  var today = day(nowMs()), a = dayStart(today).getTime(), b = dayEnd(today).getTime();
  $("#sgKpis").innerHTML = [["作業中", working.length, "ok"], ["工程待ち", waiting.length, ""], ["中断・保留", paused.length, paused.length ? "warn" : ""], ["納期遅れ", overdue.length, overdue.length ? "bad" : ""]]
    .map(function (x) { return '<article class="sg-kpi ' + x[2] + '"><span>' + x[0] + "</span><strong>" + x[1] + "<small>件</small></strong></article>"; }).join("");
  var rank = { in_progress: 0, paused: 1, ready: 2 };
  var rows = parts.slice().sort(function (x, y) { return (rank[x.status] - rank[y.status]) || String(x.due_date || "9999").localeCompare(String(y.due_date || "9999")); });
  var pages = Math.max(1, Math.ceil(rows.length / SG.per)); if (SG.page >= pages) SG.page = 0;
  var slice = rows.slice(SG.page * SG.per, SG.page * SG.per + SG.per);
  $("#sgPage").textContent = rows.length > SG.per ? (SG.page + 1) + " / " + pages + " ページ" : rows.length + " 件";
  $("#signagePartRows").innerHTML = slice.map(function (p) {
    var q = procOf(p), ws = run.filter(function (s) { return s.part_id === p.id; });
    var who = ws.map(function (s) { return esc((idx.op[s.operator_id] || {}).name || "—"); }).join(" / ");
    var el = ws.length ? Math.max.apply(null, ws.map(function (s) { return nowMs() - new Date(s.started_at); })) : 0;
    return "<tr><td><b>" + esc(p.plan_no || p.code) + "</b><small>" + esc(p.code) + "</small></td><td>" + esc(p.customer || "—") + "</td><td>" + esc(p.name || "—") + "<small>" + esc(p.product_no || p.part_no || "") + "</small></td><td>" + esc(q ? q.name : "—") + "<small>" + routeDots(p) + "</small></td><td>" + dueChip(p) + "</td><td>" + statusPill(p.status) + "</td><td>" + (who || "—") + (el ? '<small class="mono" data-since="' + (nowMs() - el) + '">' + fmtClock(el / 1000) + "</small>" : "") + "</td></tr>";
  }).join("") || '<tr><td colspan="7" class="empty">表示する生産計画がありません。</td></tr>';
  $("#signageOperatorRows").innerHTML = state.operators.map(function (o) {
    var mine = run.filter(function (s) { return s.operator_id === o.id; })[0];
    var min = state.sessions.filter(function (s) { return s.operator_id === o.id; }).reduce(function (n, s) { return n + sessMins(s.id, a, b); }, 0);
    return { o: o, mine: mine, min: min };
  }).sort(function (x, y) { return (!!y.mine - !!x.mine) || (y.min - x.min); }).map(function (x) {
    var p = x.mine && idx.part[x.mine.part_id];
    return '<li class="op-row' + (x.mine ? " on" : "") + '"><span class="avatar">' + esc(String(x.o.name).charAt(0)) + '</span><div><b>' + esc(x.o.name) + "</b><small>" + (p ? "作業中：" + esc(p.part_no || p.code) : "待機") + '</small></div><span class="num">' + fmtHours(x.min) + "<small> h</small></span></li>";
  }).join("") || '<li class="empty">作業者データがありません。</li>';
  $("#signageClock").textContent = new Date().toLocaleString("ja-JP", { timeZone: TZ, month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  $("#signageUpdated").textContent = "更新 " + tm(state.loadedAt);
}
async function setupSignage() {
  await load(); sgRender();
  setInterval(async function () { try { await load(); sgRender(); } catch (e) { console.error(e); } }, 30000);
  setInterval(function () { $("#signageClock").textContent = new Date().toLocaleString("ja-JP", { timeZone: TZ, month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }); $$("[data-since]").forEach(function (el) { el.textContent = fmtClock((nowMs() - Number(el.dataset.since)) / 1000); }); }, 1000);
  setInterval(function () { SG.page++; sgRender(); }, 12000);
  $("#sgFull").onclick = function () { if (document.fullscreenElement) document.exitFullscreen(); else (document.documentElement.requestFullscreen || function () {}).call(document.documentElement); };
}

/* ============================================================
 * 9. ADMIN (生産計画)
 * ============================================================ */
var A = { tab: "list", q: "", status: "all", sort: "due", limit: 40, picked: {}, route: [], preview: null };

function adminTab(name) {
  A.tab = name;
  $$("#adminTabs [data-tab]").forEach(function (b) { var on = b.dataset.tab === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  $$(".tab-pane").forEach(function (p) { p.classList.toggle("hidden", p.dataset.pane !== name); });
}
function renderPlanList() {
  var q = A.q.toLowerCase();
  var list = state.parts.filter(function (p) {
    if (A.status === "over" ? dueState(p) !== "over" : A.status !== "all" && p.status !== A.status) return false;
    return !q || [p.code, p.plan_no, p.part_no, p.name, p.customer, p.model, p.product_no, p.order_no].join(" ").toLowerCase().indexOf(q) >= 0;
  });
  list.sort(function (x, y) {
    if (A.sort === "new") return String(y.created_at).localeCompare(String(x.created_at));
    if (A.sort === "plan") return String(x.plan_no).localeCompare(String(y.plan_no));
    return String(x.due_date || "9999").localeCompare(String(y.due_date || "9999"));
  });
  $("#planCount").textContent = list.length + " / " + state.parts.length + " 件";
  var shown = list.slice(0, A.limit);
  $("#planList").innerHTML = shown.map(function (p) {
    var q_ = procOf(p);
    return '<tr><td class="chk"><input type="checkbox" data-pick="' + esc(p.code) + '" aria-label="選択"' + (A.picked[p.code] ? " checked" : "") + "></td><td><b>" + esc(p.plan_no || "—") + "</b><small>" + esc(p.code) + "</small></td><td>" + esc(p.customer || "—") + "<small>" + esc(p.model || "") + "</small></td><td>" + esc(p.name || "—") + "<small>" + esc(p.product_no || "—") + " / " + esc(p.part_no || "—") + '</small></td><td class="num">' + esc(p.quantity || 1) + "</td><td>" + dueChip(p) + "</td><td>" + esc(q_ ? q_.name : p.status === "completed" ? "完了" : "—") + "<small>" + routeDots(p) + "</small></td><td>" + statusPill(p.status) + '</td><td><button type="button" class="btn btn-secondary btn-sm" data-part-qr="' + esc(p.code) + '">' + icon("qr") + "QR</button></td></tr>";
  }).join("") || '<tr><td colspan="9" class="empty">条件に合う計画がありません。CSV取込または個別登録から追加してください。</td></tr>';
  var more = $("#planMore"); more.classList.toggle("hidden", list.length <= A.limit); more.textContent = "さらに表示（残り " + (list.length - A.limit) + " 件）";
  $$("[data-part-qr]").forEach(function (b) { b.onclick = function () { var p = state.parts.filter(function (x) { return x.code === b.dataset.partQr; })[0]; if (p) openQrDialog(partLabel(p)); }; });
  $$("[data-pick]").forEach(function (c) { c.onchange = function () { if (c.checked) A.picked[c.dataset.pick] = 1; else delete A.picked[c.dataset.pick]; pickUi(list); }; });
  $("#pickAll").checked = shown.length > 0 && shown.every(function (p) { return A.picked[p.code]; });
  $("#pickAll").onchange = function () { shown.forEach(function (p) { if (this.checked) A.picked[p.code] = 1; else delete A.picked[p.code]; }, this); renderPlanList(); };
  pickUi(list);
  $("#printPicked").onclick = function () {
    var items = state.parts.filter(function (p) { return A.picked[p.code]; }).map(partLabel);
    if (!items.length) items = list.slice(0, 60).map(partLabel);
    printLabels(items);
  };
}
function pickUi(list) {
  var n = Object.keys(A.picked).length;
  $("#printPicked").innerHTML = icon("print") + "<span>" + (n ? "選択した " + n + " 件のQRを印刷" : "表示中のQRをまとめて印刷") + "</span>";
}
function renderRoutePicker() {
  var box = $("#routeOptions"); if (!box) return;
  box.innerHTML = state.processes.length ? state.processes.map(function (p) {
    var i = A.route.indexOf(p.id);
    return '<button type="button" class="chip-route' + (i >= 0 ? " on" : "") + '" data-proc="' + esc(p.id) + '">' + (i >= 0 ? "<b>" + (i + 1) + "</b>" : "") + esc(p.name) + "</button>";
  }).join("") : '<span class="route-empty">工程マスタが未登録です。先に「マスタ・QR」で工程を登録してください。</span>';
  $$("[data-proc]", box).forEach(function (b) {
    b.onclick = function () {
      var i = A.route.indexOf(b.dataset.proc);
      if (i >= 0) A.route.splice(i, 1); else A.route.push(b.dataset.proc);
      renderRoutePicker();
    };
  });
  $("#routePreview").textContent = A.route.length ? A.route.map(function (id) { return (idx.proc[id] || {}).name; }).join("  →  ") : "工程をクリックした順に並びます";
}
function validateCode(code) {
  if (!code) return "Part QRコードを入力してください。";
  if (!PART_CODE_RE.test(code)) return "Part QRコードは英数字と . _ / - のみ（80文字以内）で入力してください。日本語やスペースは読み取れません。";
  return "";
}
async function savePlan(v) {
  var cur = await sb.from("parts").select("id,current_step,status").eq("code", v.code).maybeSingle();
  if (cur.error) throw cur.error;
  if (cur.data) {
    var upd = Object.assign({}, v);
    var r = await sb.from("parts").update(upd).eq("id", cur.data.id);          // 進捗(current_step/status)は触らない
    if (r.error) throw r.error;
    return { updated: true, warn: cur.data.status !== "completed" && cur.data.current_step >= v.route.length };
  }
  var i = await sb.from("parts").insert(v);
  if (i.error) throw i.error;
  return { updated: false };
}
function rowRecord(get, row, code, route) {
  return {
    code: code, plan_no: get(row, ["生産計画No", "計画No", "plan_no", "製番", "製造番号"]), customer: get(row, ["得意先", "客先", "customer", "client"]),
    model: get(row, ["機種", "model", "kikishu"]), order_no: get(row, ["受注No", "受注番号", "order_no"]), product_no: get(row, ["品番", "品目コード", "product_no", "item_code"]),
    part_no: get(row, ["図番", "drawing_no", "part_no"]) || code, name: get(row, ["品名", "part_name", "部品名"]) || code,
    quantity: Number(get(row, ["数量", "qty", "quantity"])) || 1, due_date: get(row, ["納期", "due_date", "delivery_date"]).replace(/\//g, "-") || null,
    lot_no: get(row, ["ロットNo", "ロット番号", "lot_no"]), note: get(row, ["備考", "note", "remarks"]), route: route
  };
}
async function buildPreview(file) {
  var rows = await readCsvFile(file), get = headerGetter(rows[0]);
  await load();
  var errors = [], map = {}, dups = 0;
  rows.slice(1).forEach(function (r, n) {
    var line = n + 2, code = get(r, ["Part QR", "part_code", "QRコード", "管理番号", "現品票No", "現品票番号"]).toUpperCase();
    if (!code && !r.some(function (x) { return x; })) return;
    var ce = validateCode(code); if (ce) { errors.push(line + "行目：" + ce); return; }
    var names = get(r, ["工程順", "route", "工程ルート", "工程"]).split(/[>＞→,，、/／|｜;；]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    var route = [], bad = [];
    names.forEach(function (x) { var p = state.processes.filter(function (y) { return keyOf(y.code) === keyOf(x) || keyOf(y.name) === keyOf(x); })[0]; if (p) route.push(p.id); else bad.push(x); });
    if (!names.length) { errors.push(line + "行目（" + code + "）：工程順が空です。"); return; }
    if (bad.length) { errors.push(line + "行目（" + code + "）：工程マスタにない工程 → " + bad.join("、")); return; }
    if (map[code]) dups++;
    map[code] = rowRecord(get, r, code, route);
  });
  var records = Object.keys(map).map(function (k) { return map[k]; });
  var existing = {}; state.parts.forEach(function (p) { existing[p.code] = p; });
  var added = records.filter(function (x) { return !existing[x.code]; }).length;
  var shortened = records.filter(function (x) { var o = existing[x.code]; return o && o.status !== "completed" && o.current_step >= x.route.length; }).map(function (x) { return x.code; });
  return { records: records, errors: errors, added: added, changed: records.length - added, dups: dups, shortened: shortened };
}
function renderPreview(pv) {
  var box = $("#importPreview"); A.preview = pv;
  if (!pv) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  var ok = pv.errors.length === 0 && pv.records.length > 0;
  box.classList.remove("hidden");
  box.innerHTML = '<div class="preview-sum"><div><b>' + pv.added + "</b><span>新規</span></div><div><b>" + pv.changed + "</b><span>更新</span></div><div class=\"" + (pv.errors.length ? "bad" : "") + '"><b>' + pv.errors.length + "</b><span>エラー</span></div></div>" +
    (pv.errors.length ? '<div class="alert alert-bad">' + icon("alert") + "<div><b>修正が必要な行があります（取り込みは行われていません）</b><ul>" + pv.errors.slice(0, 12).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + (pv.errors.length > 12 ? "<li>…ほか " + (pv.errors.length - 12) + " 件</li>" : "") + "</ul></div></div>" : "") +
    (pv.dups ? '<div class="alert alert-info">' + icon("alert") + "<div>同じPart QRが " + pv.dups + " 件重複しています。最後の行を採用します。</div></div>" : "") +
    (pv.shortened.length ? '<div class="alert alert-warn">' + icon("alert") + "<div><b>工程順が短くなるPartがあります</b><p>" + pv.shortened.slice(0, 6).map(esc).join("、") + " — 現在工程が工程順の範囲を超えるため、取込後に確認してください。</p></div></div>" : "") +
    (ok ? '<div class="preview-table table-wrap"><table><thead><tr><th>Part QR</th><th>製番</th><th>品名</th><th>数量</th><th>納期</th><th>工程順</th></tr></thead><tbody>' + pv.records.slice(0, 6).map(function (x) { return "<tr><td>" + esc(x.code) + "</td><td>" + esc(x.plan_no) + "</td><td>" + esc(x.name) + '</td><td class="num">' + x.quantity + "</td><td>" + esc(x.due_date || "—") + "</td><td>" + esc(x.route.map(function (id) { return (idx.proc[id] || {}).name; }).join(" → ")) + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
    '<div class="preview-actions"><button type="button" id="importCancel" class="btn btn-quiet">キャンセル</button><button type="button" id="importGo" class="btn btn-primary"' + (ok ? "" : " disabled") + ">" + icon("check") + "この内容で取り込む（" + pv.records.length + "件）</button></div>";
  $("#importCancel").onclick = function () { renderPreview(null); };
  $("#importGo").onclick = async function () {
    var b = this; b.disabled = true;
    try {
      var r = await sb.from("parts").upsert(pv.records, { onConflict: "code" });   // 進捗列は送らない＝既存Partの進捗は保持
      if (r.error) throw r.error;
      toast("取込完了：新規 " + pv.added + " 件、更新 " + pv.changed + " 件", "ok");
      renderPreview(null); $("#dennouImport").value = ""; await load(); renderAdmin(); adminTab("list");
    } catch (e) { show(e); b.disabled = false; }
  };
}
function renderAdmin() { renderPlanList(); renderRoutePicker(); }
function setupAdmin() {
  adminTab("list");
  $$("#adminTabs [data-tab]").forEach(function (b) { b.onclick = function () { adminTab(b.dataset.tab); }; });
  $("#planSearch").oninput = function () { A.q = this.value.trim(); A.limit = 40; renderPlanList(); };
  $("#planStatus").onchange = function () { A.status = this.value; A.limit = 40; renderPlanList(); };
  $("#planSort").onchange = function () { A.sort = this.value; renderPlanList(); };
  $("#planMore").onclick = function () { A.limit += 60; renderPlanList(); };
  $("#planRefresh").onclick = function () { var b = this; b.disabled = true; load().then(renderAdmin).catch(show).then(function () { b.disabled = false; }); };
  $("#importCsv").onclick = async function () {
    var b = this; b.disabled = true; $("#importMessage").textContent = "確認中…";
    try { var pv = await buildPreview($("#dennouImport").files[0]); renderPreview(pv); $("#importMessage").textContent = "内容を確認して「取り込む」を押してください。"; }
    catch (e) { renderPreview(null); $("#importMessage").textContent = e.message; show(e); }
    finally { b.disabled = false; }
  };
  $("#downloadTemplate").onclick = function () { downloadCsv("電脳工場_現品票取込テンプレート.csv", [["製番", "得意先", "機種", "受注No.", "品番", "図番", "品名", "数量", "納期", "ロットNo.", "備考", "Part QR", "工程順"], ["P-2026-001", "株式会社サンプル", "BP-200", "SO-001", "AB-1001", "A-100", "ブラケットA", 24, "2026-12-01", "", "", "PT-001", "レーザー工程>曲げ工程>検査工程"]]); };
  $("#planForm").onsubmit = async function (e) {
    e.preventDefault();
    var m = $("#planFormMessage"), btn = $("button[type=submit]", e.target); m.className = "form-msg"; btn.disabled = true;
    try {
      var code = $("#partCode").value.trim().toUpperCase(), ce = validateCode(code);
      if (ce) throw new Error(ce);
      if (!A.route.length) throw new Error("工程順を1つ以上選択してください。");
      var res = await savePlan({
        code: code, plan_no: $("#planNo").value.trim(), customer: $("#planCustomer").value.trim(), model: $("#planModel").value.trim(), order_no: $("#planOrderNo").value.trim(),
        product_no: $("#planProductNo").value.trim(), part_no: $("#partNo").value.trim(), name: $("#partName").value.trim(), quantity: Number($("#partQuantity").value) || 1,
        due_date: $("#planDueDate").value || null, lot_no: $("#planLotNo").value.trim(), note: $("#planNote").value.trim(), route: A.route.slice()
      });
      e.target.reset(); $("#partQuantity").value = 1; A.route = [];
      await load(); renderAdmin();
      toast(res.updated ? "既存の計画を更新しました（進捗は保持）" : "計画を登録しました", "ok");
      if (res.warn) toast("工程順が短くなったため、現在工程を確認してください。", "error");
      var p = state.parts.filter(function (x) { return x.code === code; })[0]; if (p) openQrDialog(partLabel(p));
    } catch (x) { m.className = "form-msg bad"; m.textContent = friendly(x); }
    finally { btn.disabled = false; }
  };
  $("#partCode").addEventListener("input", function () { this.value = this.value.toUpperCase(); var er = validateCode(this.value.trim()); this.setCustomValidity(this.value && er ? er : ""); });
  renderAdmin();
}

/* ============================================================
 * 10. MASTER (作業者・工程・QR)
 * ============================================================ */
function renderMaster() {
  $("#operatorList").innerHTML = state.operators.map(function (o) {
    return '<li class="op-row"><span class="avatar">' + esc(String(o.name).charAt(0)) + "</span><div><b>" + esc(o.name) + "</b><small>" + esc(o.code) + '</small></div><div class="row-actions"><button type="button" class="btn btn-secondary btn-sm" data-opqr="' + esc(o.id) + '">' + icon("qr") + 'QR再発行</button><button type="button" class="btn btn-ghost btn-sm danger" data-opoff="' + esc(o.id) + '">無効化</button></div></li>';
  }).join("") || '<li class="empty">作業者がまだ登録されていません。</li>';
  $("#operatorCount").textContent = state.operators.length + " 名";
  $("#processList").innerHTML = state.processes.map(function (p) {
    return "<tr><td><b>" + esc(p.code) + "</b></td><td>" + esc(p.name) + '</td><td><div class="inline-save"><input type="number" min="0" step="1" value="' + (p.standard_minutes == null ? "" : esc(Number(p.standard_minutes))) + '" data-std="' + esc(p.id) + '" aria-label="標準時間(分)" placeholder="—"><span>分</span><button type="button" class="btn btn-secondary btn-sm" data-stdsave="' + esc(p.id) + '">保存</button></div></td></tr>';
  }).join("") || '<tr><td colspan="3" class="empty">工程が登録されていません。</td></tr>';
  $("#processCount").textContent = state.processes.length + " 工程";
  $$("[data-opqr]").forEach(function (b) { b.onclick = function () { issueOperatorQr(b.dataset.opqr, true); }; });
  $$("[data-opoff]").forEach(function (b) {
    b.onclick = async function () {
      var o = idx.op[b.dataset.opoff];
      if (!await confirmDialog((o ? o.name : "") + " さんを無効化します。作業者QRは使えなくなり、一覧から非表示になります。", "無効化する", true)) return;
      var r = await sb.from("operators").update({ active: false }).eq("id", b.dataset.opoff);
      if (r.error) return show(r.error);
      toast("無効化しました。", "ok"); await load(); renderMaster();
    };
  });
  $$("[data-stdsave]").forEach(function (b) {
    b.onclick = async function () {
      var inp = $('[data-std="' + b.dataset.stdsave + '"]'), raw = inp.value.trim(), v = raw === "" ? null : Number(raw);
      if (raw !== "" && (!isFinite(v) || v < 0)) return toast("標準時間は0以上の数字で入力してください。", "error");
      var r = await sb.from("processes").update({ standard_minutes: v }).eq("id", b.dataset.stdsave);
      if (r.error) return show(r.error);
      toast("標準時間を保存しました。", "ok"); await load(); renderMaster();
    };
  });
}
async function issueOperatorQr(id, confirmFirst) {
  var o = idx.op[id]; if (!o) throw new Error("作業者が見つかりません。");
  if (confirmFirst && !await confirmDialog(o.name + " さんのQRを再発行します。以前のカードは使えなくなります。よろしいですか？", "再発行する", true)) return;
  var d = await gateway({ action: "issue_qr", operator_id: o.id });
  var item = { kind: "operator", value: d.qr, kicker: "作業者カード", title: o.name, line1: "作業者コード " + o.code, line2: "", code: o.code };
  openQrDialog(item, true);
}
async function importMaster(file, kind) {
  var rows = await readCsvFile(file), get = headerGetter(rows[0]), recs = [], errs = [];
  rows.slice(1).forEach(function (row, n) {
    var code = get(row, kind === "operators" ? ["コード", "作業者コード", "operator_code"] : ["工程コード", "コード", "process_code"]).toUpperCase();
    var name = get(row, kind === "operators" ? ["氏名", "作業者名", "名前", "name"] : ["工程名", "名称", "name"]);
    if (!code && !name) return;
    if (!code || !name) return errs.push((n + 2) + "行目：コードと名称が必要です。");
    if (!/^[A-Z0-9._-]{2,40}$/.test(code)) return errs.push((n + 2) + "行目：コードは英数字と . _ - の2〜40文字にしてください（" + code + "）。");
    if (kind === "operators") recs.push({ code: code, name: name, active: true });
    else {
      var raw = get(row, ["標準時間", "標準時間分", "standard_minutes", "時間"]), min = raw === "" ? null : Number(raw);
      if (raw !== "" && (!isFinite(min) || min < 0)) return errs.push((n + 2) + "行目：標準時間は0以上の数字にしてください。");
      recs.push({ code: code, name: name, standard_minutes: min, active: true });
    }
  });
  if (errs.length) throw new Error(errs.slice(0, 5).join(" / ") + (errs.length > 5 ? " …ほか" + (errs.length - 5) + "件" : ""));
  if (!recs.length) throw new Error("登録できる行がありません。");
  var r = await sb.from(kind).upsert(recs, { onConflict: "code" });
  if (r.error) throw r.error;
  await load(); renderMaster();
  return recs.length;
}
function setupMaster() {
  renderMaster();
  $("#operatorForm").onsubmit = async function (e) {
    e.preventDefault();
    var btn = $("button", e.target); btn.disabled = true;
    try {
      var c = $("#newOperatorCode").value.trim().toUpperCase(), n = $("#newOperatorName").value.trim();
      if (!/^[A-Z0-9._-]{2,40}$/.test(c)) throw new Error("作業者コードは英数字と . _ - の2〜40文字で入力してください。");
      if (!n) throw new Error("氏名を入力してください。");
      var r = await sb.from("operators").insert({ code: c, name: n }); if (r.error) throw r.error;
      e.target.reset(); await load(); renderMaster();
      var o = state.operators.filter(function (x) { return x.code === c; })[0]; if (o) await issueOperatorQr(o.id, false);
    } catch (x) { show(x); } finally { btn.disabled = false; }
  };
  $("#processForm").onsubmit = async function (e) {
    e.preventDefault();
    var btn = $("button", e.target); btn.disabled = true;
    try {
      var c = $("#newProcessCode").value.trim().toUpperCase(), n = $("#newProcessName").value.trim(), m = $("#newStandardMinutes").value;
      if (!/^[A-Z0-9._-]{2,40}$/.test(c)) throw new Error("工程コードは英数字と . _ - の2〜40文字で入力してください。");
      var r = await sb.from("processes").insert({ code: c, name: n, standard_minutes: m === "" ? null : Number(m) }); if (r.error) throw r.error;
      e.target.reset(); await load(); renderMaster(); toast("工程を登録しました。", "ok");
    } catch (x) { show(x); } finally { btn.disabled = false; }
  };
  var imp = function (id, file, kind, label) {
    $(id).onclick = async function () {
      var m = $("#masterImportMessage"), b = this; b.disabled = true; m.textContent = "取込中…";
      try { var n = await importMaster($(file).files[0], kind); m.textContent = label + "を " + n + " 件取り込みました。"; toast(label + "を取り込みました。", "ok"); }
      catch (x) { m.textContent = "取込できません：" + x.message; show(x); } finally { b.disabled = false; }
    };
  };
  imp("#importOperatorMaster", "#operatorMasterCsv", "operators", "作業者マスタ");
  imp("#importProcessMaster", "#processMasterCsv", "processes", "工程マスタ");
  $("#downloadOperatorTemplate").onclick = function () { downloadCsv("作業者マスタ_テンプレート.csv", [["コード", "氏名"], ["OP001", "山田 太郎"]]); };
  $("#downloadProcessTemplate").onclick = function () { downloadCsv("工程マスタ_テンプレート.csv", [["工程コード", "工程名", "標準時間（分）"], ["LASER", "レーザー工程", 25]]); };
}

/* ============================================================
 * 11. Boot
 * ============================================================ */
function setupCommon() {
  var d = $("#qrDialog");
  if (d) {
    $("#qrPrint").onclick = function () { if (qrCur) { d.close(); printLabels([qrCur]); } };
    $("#qrClose").onclick = function () { d.close(); };
  }
  window.addEventListener("online", netBadge); window.addEventListener("offline", netBadge);
}
document.addEventListener("DOMContentLoaded", function () {
  renderShell(); hydrateIcons(); netBadge(); setupCommon();
  var run = {
    operator: function () { setupKiosk(); },
    dashboard: function () { return gate(STAFF, setupDashboard); },
    signage: function () { return gate(STAFF, setupSignage); },
    admin: function () { return gate(STAFF, async function () { await load(); setupAdmin(); }); },
    master: function () { return gate(["admin"], async function () { await load(); setupMaster(); }); }
  }[page];
  if (run) Promise.resolve().then(run).catch(show);
});
})();
