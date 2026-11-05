/* 作業時間集計システム | framework-free browser application */
(() => {
  "use strict";
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const page = document.body.dataset.page;
  const config = window.APP_CONFIG || {};
  const live = Boolean(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY && window.supabase);
  const sb = live ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY) : null;
  const STORE = "shukei-jikan-v1-demo";
  const now = () => new Date().toISOString();
  const shortDate = (date) => new Date(date).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const dateOnly = (date) => new Date(date).toISOString().slice(0, 10);
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#039;", '"':"&quot;" }[c]));

  const initialDemo = () => {
    const t = new Date(); const earlier = new Date(t.getTime() - 54 * 60000).toISOString(); const recent = new Date(t.getTime() - 17 * 60000).toISOString();
    return {
      operators: [{ id:"op-001", code:"OP001", name:"田中 太郎", active:true },{ id:"op-002", code:"OP002", name:"佐藤 花子", active:true },{ id:"op-003", code:"OP003", name:"鈴木 健", active:true }],
      processes: [{ id:"pr-laser", code:"LASER", name:"レーザー工程", standard_minutes:25, active:true },{ id:"pr-bend", code:"BEND", name:"曲げ工程", standard_minutes:30, active:true },{ id:"pr-spot", code:"SPOT", name:"スポット工程", standard_minutes:20, active:true },{ id:"pr-weld", code:"WELD", name:"溶接工程", standard_minutes:45, active:true },{ id:"pr-assembly", code:"ASSEMBLY", name:"組立工程", standard_minutes:40, active:true },{ id:"pr-inspect", code:"INSPECT", name:"検査工程", standard_minutes:15, active:true }],
      sessions: [{ id:"s-001", operator_id:"op-001", process_id:"pr-laser", status:"stopped", started_at:earlier, ended_at:recent, created_at:earlier },{ id:"s-002", operator_id:"op-002", process_id:"pr-bend", status:"running", started_at:recent, ended_at:null, created_at:recent }],
      segments: [{ id:"seg-001", session_id:"s-001", segment_type:"work", started_at:earlier, ended_at:recent },{ id:"seg-002", session_id:"s-002", segment_type:"work", started_at:recent, ended_at:null }],
      events: [{ id:"ev-001", session_id:"s-001", event_type:"STOP", occurred_at:recent, note:"", created_at:recent }]
    };
  };
  let state = { operators:[], processes:[], sessions:[], segments:[], events:[], selectedOperator:null, selectedProcess:null, scanner:null, pendingEvent:null, user:null };

  function readDemo() { try { return JSON.parse(localStorage.getItem(STORE)) || initialDemo(); } catch { return initialDemo(); } }
  function writeDemo(data) { localStorage.setItem(STORE, JSON.stringify(data)); }
  async function loadData() {
    if (!live) { Object.assign(state, readDemo()); return; }
    const results = await Promise.all([
      sb.from("operators").select("*").eq("active", true).order("code"),
      sb.from("processes").select("*").eq("active", true).order("code"),
      sb.from("work_sessions").select("*").order("started_at", { ascending:false }).limit(500),
      sb.from("work_segments").select("*").order("started_at", { ascending:false }).limit(1500),
      sb.from("work_events").select("*").order("occurred_at", { ascending:false }).limit(500)
    ]);
    const issue = results.find(r => r.error)?.error;
    if (issue) throw issue;
    [state.operators, state.processes, state.sessions, state.segments, state.events] = results.map(r => r.data || []);
  }
  async function reloadAndRender() { await loadData(); if (page === "operator") renderOperator(); if (page === "dashboard") renderDashboard(); if (page === "admin") renderAdmin(); }
  function saveDemoMutation(mutator) { const data = readDemo(); mutator(data); writeDemo(data); Object.assign(state, data); }
  function byId(list, id) { return list.find(x => x.id === id); }
  function operatorName(id) { const x = byId(state.operators,id); return x ? x.name : "—"; }
  function processName(id) { const x = byId(state.processes,id); return x ? x.name : "—"; }
  function activeSession() { return state.sessions.find(s => s.operator_id === state.selectedOperator?.id && s.process_id === state.selectedProcess?.id && ["running","paused"].includes(s.status)); }
  function openSegment(sessionId) { return state.segments.find(s => s.session_id === sessionId && !s.ended_at); }
  function minutesForSession(id) { return state.segments.filter(s => s.session_id === id && s.segment_type === "work").reduce((sum,s) => sum + Math.max(0, (new Date(s.ended_at || now()) - new Date(s.started_at)) / 60000), 0); }
  function fmtMinutes(value) { return `${Math.round(value)}分`; }
  function setModeBadges() { $$("#modeBadge").forEach(el => { el.textContent = live ? "SUPABASE接続" : "デモモード"; el.className = `mode-badge ${live ? "mode-live" : "mode-demo"}`; }); }
  function requireSelection() { if (!state.selectedOperator || !state.selectedProcess) { alert("先に作業者QRと工程QRを読み取ってください。"); return false; } return true; }

  async function createSession() {
    if (!requireSelection()) return;
    const existing = activeSession();
    if (existing?.status === "paused") { await recordEvent("RESUME"); return; }
    if (existing) { alert("この作業はすでに記録中です。"); return; }
    const at = now();
    if (!live) {
      const id = uid(); saveDemoMutation(d => { d.sessions.unshift({ id, operator_id:state.selectedOperator.id, process_id:state.selectedProcess.id, status:"running", started_at:at, ended_at:null, created_at:at }); d.segments.unshift({ id:uid(), session_id:id, segment_type:"work", started_at:at, ended_at:null }); d.events.unshift({ id:uid(), session_id:id, event_type:"START", occurred_at:at, note:"", created_at:at }); });
    } else {
      const { data: session, error } = await sb.from("work_sessions").insert({ operator_id:state.selectedOperator.id, process_id:state.selectedProcess.id, status:"running", started_at:at }).select().single(); if (error) throw error;
      const { error: segmentError } = await sb.from("work_segments").insert({ session_id:session.id, segment_type:"work", started_at:at }); if (segmentError) throw segmentError;
      const { error:eventError } = await sb.from("work_events").insert({ session_id:session.id, event_type:"START", occurred_at:at }); if (eventError) throw eventError;
    }
    await reloadAndRender(); announce("作業を開始しました。");
  }
  async function closeActiveSegment(sessionId, at) {
    const segment = openSegment(sessionId); if (!segment) return;
    if (!live) saveDemoMutation(d => { const x=d.segments.find(v=>v.id===segment.id); if(x)x.ended_at=at; });
    else { const { error } = await sb.from("work_segments").update({ ended_at:at }).eq("id", segment.id); if (error) throw error; }
  }
  async function recordEvent(type, note = "") {
    const session = activeSession(); if (!session && type !== "NG") { alert("記録中の作業がありません。"); return; }
    const at = now();
    if (type === "RESUME") {
      if (!session || session.status !== "paused") { alert("再開できる中断作業がありません。"); return; }
      if (!live) saveDemoMutation(d => { const x=d.sessions.find(v=>v.id===session.id); x.status="running"; d.segments.unshift({id:uid(),session_id:session.id,segment_type:"work",started_at:at,ended_at:null}); d.events.unshift({id:uid(),session_id:session.id,event_type:"RESUME",occurred_at:at,note,created_at:at}); });
      else { const a=await sb.from("work_sessions").update({status:"running"}).eq("id",session.id); if(a.error)throw a.error; const b=await sb.from("work_segments").insert({session_id:session.id,segment_type:"work",started_at:at}); if(b.error)throw b.error; const c=await sb.from("work_events").insert({session_id:session.id,event_type:"RESUME",occurred_at:at,note}); if(c.error)throw c.error; }
    } else if (type === "NG") {
      if (!session) { alert("NGは、作業者と工程を選択してから記録してください。"); return; }
      if (!live) saveDemoMutation(d => d.events.unshift({id:uid(),session_id:session.id,event_type:"NG",occurred_at:at,note,created_at:at}));
      else { const {error}=await sb.from("work_events").insert({session_id:session.id,event_type:"NG",occurred_at:at,note}); if(error)throw error; }
    } else {
      await closeActiveSegment(session.id, at);
      const finalStatus = type === "URGENT_SWITCH" ? "stopped" : "paused";
      if (!live) saveDemoMutation(d => { const x=d.sessions.find(v=>v.id===session.id); x.status=finalStatus; if(finalStatus==="stopped")x.ended_at=at; d.events.unshift({id:uid(),session_id:session.id,event_type:type,occurred_at:at,note,created_at:at}); });
      else { const u=await sb.from("work_sessions").update({status:finalStatus,ended_at:finalStatus==="stopped"?at:null}).eq("id",session.id); if(u.error)throw u.error; const e=await sb.from("work_events").insert({session_id:session.id,event_type:type,occurred_at:at,note}); if(e.error)throw e.error; }
    }
    if (type === "URGENT_SWITCH") { state.selectedOperator=null; state.selectedProcess=null; }
    await reloadAndRender(); announce(eventLabel(type) + "を記録しました。");
  }
  async function stopSession() {
    const session = activeSession(); if (!session) { alert("終了する作業がありません。"); return; }
    const at=now(); await closeActiveSegment(session.id,at);
    if(!live) saveDemoMutation(d=>{const x=d.sessions.find(v=>v.id===session.id);x.status="stopped";x.ended_at=at;d.events.unshift({id:uid(),session_id:session.id,event_type:"STOP",occurred_at:at,note:"",created_at:at});});
    else { const u=await sb.from("work_sessions").update({status:"stopped",ended_at:at}).eq("id",session.id);if(u.error)throw u.error; const e=await sb.from("work_events").insert({session_id:session.id,event_type:"STOP",occurred_at:at});if(e.error)throw e.error; }
    state.selectedOperator=null; state.selectedProcess=null;
    await reloadAndRender(); announce("作業を終了しました。次の作業は、作業者QRから読み取ってください。");
  }
  function eventLabel(type) { return ({ START:"開始",STOP:"終了",RESUME:"作業再開",HOLD_MATERIAL:"材料切れ",HOLD_MACHINE:"設備トラブル",URGENT_SWITCH:"急ぎ仕事へ切替",NG:"NG・修正" })[type] || type; }
  function announce(text) { const hint=$("#operatorHint"); if(hint) hint.textContent=text; }

  function renderOperator() {
    const summary=$("#selectionSummary"); if(!summary)return;
    const session=activeSession();
    const stepIndex = !state.selectedOperator ? 0 : !state.selectedProcess ? 1 : !session ? 2 : 3;
    $$(".operator-steps .step").forEach((step, index) => step.classList.toggle("active", index <= stepIndex));
    summary.innerHTML=`<div><span>作業者</span><b>${escapeHtml(state.selectedOperator?.name || "未選択")}</b></div><div><span>作業指示</span><b>${escapeHtml(state.selectedProcess?.name || "未選択")}</b></div><div><span>開始時刻</span><b>${session ? shortDate(session.started_at) : "—"}</b></div>`;
    const status=$("#scanStatus");
    status.textContent=session?.status === "running" ? "作業中" : session?.status === "paused" ? "中断中" : "待機中";
    status.className=`scan-status ${session?.status === "running" ? "scan-running" : session?.status === "paused" ? "scan-paused" : "scan-wait"}`;
    if(!session && !state.selectedOperator) announce("作業者QRをスキャンしてください"); else if(!session && !state.selectedProcess) announce("作業指示QRをスキャンしてください"); else if(!session) announce("開始QRをスキャンしてください"); else if(session.status === "paused") announce("再開する場合は、開始QRをスキャンしてください"); else announce("作業中です。終了時は完了QRをスキャンしてください");
    $("#issueArea")?.classList.toggle("hidden", session?.status !== "running");
  }
  async function acceptQr(raw) {
    const value=String(raw).trim().toUpperCase(); if(!value)return;
    if(value.startsWith("OP:")) { const code=value.slice(3); const found=state.operators.find(x=>x.code.toUpperCase()===code); if(!found) throw new Error(`作業者QR「${code}」は登録されていません。`); state.selectedOperator=found; announce(`作業者「${found.name}」を選択しました。次に工程QRを読み取ってください。`); }
    else if(value.startsWith("JOB:") || value.startsWith("PROC:")) { const code=value.split(":").slice(1).join(":"); const found=state.processes.find(x=>x.code.toUpperCase()===code); if(!found) throw new Error(`作業指示QR「${code}」は登録されていません。`); state.selectedProcess=found; announce(`作業指示「${found.name}」を選択しました。開始QRを読み取ってください。`); }
    else if(value === "ACT:START") await createSession(); else if(value === "ACT:STOP") await stopSession();
    else if(value.startsWith("EX:")) { const type={ MATERIAL:"HOLD_MATERIAL", MACHINE:"HOLD_MACHINE", URGENT:"URGENT_SWITCH", NG:"NG", RESUME:"RESUME" }[value.slice(3)]; if(!type)throw new Error("未対応の例外QRです。"); await promptEvent(type); }
    else throw new Error("このQRコードは作業時間集計システム用ではありません。" );
    renderOperator();
  }
  async function startScanner() { if(!window.Html5Qrcode){alert("カメラ読取を準備中です。数秒後にもう一度押してください。");return;} const reader=$("#reader");reader.classList.remove("hidden"); if(state.scanner)await state.scanner.stop().catch(()=>{}); state.scanner=new Html5Qrcode("reader"); await state.scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:230,height:230}},async text=>{await state.scanner.stop().catch(()=>{});reader.classList.add("hidden");try{await acceptQr(text);}catch(e){alert(e.message||e);}}); }
  async function promptEvent(type) { if(type === "RESUME")return recordEvent(type); state.pendingEvent=type; $("#noteTitle").textContent=eventLabel(type); $("#eventNote").value=""; $("#noteDialog").showModal(); }
  function setupOperator(){ renderOperator(); $("#openScanner").addEventListener("click",()=>startScanner().catch(e=>alert(e.message||e))); $("#manualScanForm")?.addEventListener("submit",async e=>{e.preventDefault();try{await acceptQr($("#manualCode").value);$("#manualCode").value="";}catch(err){alert(err.message||err);}}); $("#openIssueMenu")?.addEventListener("click",()=>$("#issueDialog").showModal()); $$("[data-event]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault(); if($("#issueDialog")?.open)$("#issueDialog").close(); promptEvent(b.dataset.event);})); $("#noteForm").addEventListener("submit",async e=>{if(e.submitter?.value==="cancel")return;e.preventDefault();try{await recordEvent(state.pendingEvent,$("#eventNote").value.trim());$("#noteDialog").close();}catch(err){alert(err.message||err);}}); }

  function filterSessions(){const d=$("#filterDate")?.value||dateOnly(now()),p=$("#filterProcess")?.value||"";return state.sessions.filter(s=>dateOnly(s.started_at)===d&&(!p||s.process_id===p));}
  function renderDashboard(){ const filter=$("#filterProcess");if(!filter)return;const chosen=filter.value;filter.innerHTML=`<option value="">全工程</option>`+state.processes.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");filter.value=chosen;const sessions=filterSessions();const work=sessions.reduce((a,s)=>a+minutesForSession(s.id),0);const holding=state.events.filter(e=>sessions.some(s=>s.id===e.session_id)&&["HOLD_MATERIAL","HOLD_MACHINE"].includes(e.event_type));const ng=state.events.filter(e=>sessions.some(s=>s.id===e.session_id)&&e.event_type==="NG");$("#kpiGrid").innerHTML=[ ["実作業時間",fmtMinutes(work)],["参加作業者",`${new Set(sessions.map(s=>s.operator_id)).size}人`],["中断件数",`${holding.length}件`],["NG・修正",`${ng.length}件`] ].map(x=>`<div class="kpi"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
    renderBars("#processReport",state.processes.map(p=>({label:p.name,value:sessions.filter(s=>s.process_id===p.id).reduce((a,s)=>a+minutesForSession(s.id),0)})));
    renderBars("#operatorReport",state.operators.map(o=>({label:o.name,value:sessions.filter(s=>s.operator_id===o.id).reduce((a,s)=>a+minutesForSession(s.id),0)})));
    $("#eventReport").innerHTML=state.events.filter(e=>sessions.some(s=>s.id===e.session_id)&&!["START","STOP","RESUME"].includes(e.event_type)).map(e=>{const s=byId(state.sessions,e.session_id);return `<div class="session-item"><span><b>${eventLabel(e.event_type)}</b>　${escapeHtml(s?`${operatorName(s.operator_id)} / ${processName(s.process_id)}`:"—")}<br><small>${shortDate(e.occurred_at)}　${escapeHtml(e.note||"備考なし")}</small></span></div>`;}).join("")||`<p class="empty">この日の中断・NG記録はありません。</p>`;
    $("#sessionReport").innerHTML=sessions.map(s=>`<tr><td>${shortDate(s.started_at)}</td><td>${escapeHtml(operatorName(s.operator_id))}</td><td>${escapeHtml(processName(s.process_id))}</td><td>${fmtMinutes(minutesForSession(s.id))}</td><td><span class="status-pill status-${s.status}">${s.status==="running"?"作業中":s.status==="paused"?"中断中":"終了"}</span></td></tr>`).join("")||`<tr><td colspan="5" class="empty">該当する記録はありません。</td></tr>`;
    $("#dashboardNotice").textContent=live?"Supabaseの保存データを表示中":"サンプルデータを表示中";
  }
  function renderBars(selector,rows){const el=$(selector);const max=Math.max(1,...rows.map(x=>x.value));el.innerHTML=rows.filter(x=>x.value>0).map(x=>`<div class="report-row"><b>${escapeHtml(x.label)}</b><div class="bar"><i style="width:${x.value/max*100}%"></i></div><span>${fmtMinutes(x.value)}</span></div>`).join("")||`<p class="empty">該当データがありません。</p>`;}
  function csvExport(){
    const sessions=filterSessions(), date=$("#filterDate").value;
    const processRows=state.processes.map(p=>[p.code,p.name,Math.round(sessions.filter(s=>s.process_id===p.id).reduce((a,s)=>a+minutesForSession(s.id),0))]).filter(r=>r[2]>0);
    const operatorRows=state.operators.map(o=>[o.code,o.name,Math.round(sessions.filter(s=>s.operator_id===o.id).reduce((a,s)=>a+minutesForSession(s.id),0))]).filter(r=>r[2]>0);
    const detailRows=sessions.map(s=>[s.started_at,s.ended_at||"",operatorName(s.operator_id),processName(s.process_id),Math.round(minutesForSession(s.id)),s.status]);
    const eventRows=state.events.filter(e=>sessions.some(s=>s.id===e.session_id)&&!["START","STOP","RESUME"].includes(e.event_type)).map(e=>{const s=byId(state.sessions,e.session_id);return [e.occurred_at,eventLabel(e.event_type),s?operatorName(s.operator_id):"",s?processName(s.process_id):"",e.note||""];});
    const rows=[["作業時間集計結果",date],[],["作業指示別集計"],["作業指示No.","作業名","実作業時間（分）"],...processRows,[],["作業者別工数"],["作業者コード","作業者名","投入工数（分・人）"],...operatorRows,[],["中断・NG記録"],["日時","内容","作業者","作業指示","備考"],...eventRows,[],["作業明細"],["開始日時","終了日時","作業者","作業指示","実作業時間（分）","状態"],...detailRows];
    const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));a.download=`作業時間集計結果_${date}.csv`;a.click();URL.revokeObjectURL(a.href);
  }
  function setupDashboard(){const d=$("#filterDate");d.value=dateOnly(now());d.addEventListener("change",renderDashboard);$("#filterProcess").addEventListener("change",renderDashboard);$("#refreshDashboard").addEventListener("click",()=>reloadAndRender().catch(e=>alert(e.message||e)));$("#exportCsv").addEventListener("click",csvExport);renderDashboard();}

  async function addMaster(kind, values){if(!live){saveDemoMutation(d=>d[kind].push({id:uid(),...values,active:true}));}else{const {error}=await sb.from(kind).insert(values);if(error)throw error;}await reloadAndRender();}
  function qrOptions(){const kind=$("#qrKind").value,target=$("#qrTarget"),label=$("#qrTargetLabel");let opts=[];if(kind==="operator")opts=state.operators.map(o=>({value:`OP:${o.code}`,text:`${o.code} / ${o.name}`}));if(kind==="process")opts=state.processes.map(p=>({value:`JOB:${p.code}`,text:`${p.code} / ${p.name}`}));if(kind==="action")opts=[{value:"ACT:START",text:"開始QR（共通）"},{value:"ACT:STOP",text:"完了QR（共通）"}];label.firstChild.textContent=kind==="action"?"操作":"対象";target.innerHTML=opts.map(o=>`<option value="${o.value}">${escapeHtml(o.text)}</option>`).join("");}
  function makeQr(){const val=$("#qrTarget").value,title=$("#qrTarget").selectedOptions[0]?.textContent||"";$("#qrcode").innerHTML="";$("#qrTitle").textContent=title;$("#qrValue").textContent=val;if(window.QRCode)new QRCode($("#qrcode"),{text:val,width:190,height:190,correctLevel:QRCode.CorrectLevel.M});else $("#qrcode").textContent=val;}
  async function refreshAuth(){if(!live)return;const {data}=await sb.auth.getSession();state.user=data.session?.user||null;}
  function renderAdmin(){if(!$("#qrKind"))return;qrOptions();const msg=$("#loginMessage");if(!live){msg.textContent="デモモードではログイン不要です。Supabase接続後は管理者のみ登録できます。";}else{msg.textContent=state.user?`ログイン中：${state.user.email}`:"管理者アカウントでログインしてください。";$("#logoutButton").classList.toggle("hidden",!state.user);}}
  function showRegisteredQr(kind, code){$("#qrKind").value=kind;qrOptions();$("#qrTarget").value=`${kind==="operator"?"OP":"JOB"}:${code}`;makeQr();}
  function setupAdmin(){renderAdmin();$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();if(!live){$("#loginMessage").textContent="デモモードのためログインは不要です。";return;}const {error}=await sb.auth.signInWithPassword({email:$("#loginEmail").value,password:$("#loginPassword").value});if(error){$("#loginMessage").textContent=error.message;return;}await refreshAuth();renderAdmin();});$("#logoutButton").addEventListener("click",async()=>{await sb.auth.signOut();await refreshAuth();renderAdmin();});$("#operatorMasterForm").addEventListener("submit",async e=>{e.preventDefault();try{const code=$("#newOperatorCode").value.trim().toUpperCase();await addMaster("operators",{code,name:$("#newOperatorName").value.trim()});e.target.reset();showRegisteredQr("operator",code);}catch(err){alert(err.message||err);}});$("#processMasterForm").addEventListener("submit",async e=>{e.preventDefault();try{const code=$("#newProcessCode").value.trim().toUpperCase(),v=$("#newStandardMinutes").value;await addMaster("processes",{code,name:$("#newProcessName").value.trim(),standard_minutes:v?Number(v):null});e.target.reset();showRegisteredQr("process",code);}catch(err){alert(err.message||err);}});$("#qrKind").addEventListener("change",qrOptions);$("#makeQr").addEventListener("click",makeQr);$("#printQr").addEventListener("click",()=>window.print());}

  async function boot(){setModeBadges();try{await loadData();if(page==="home")return;if(page==="operator")setupOperator();if(page==="dashboard")setupDashboard();if(page==="admin"){await refreshAuth();setupAdmin();}}catch(error){console.error(error);alert(`データを読み込めませんでした。\n${error.message||error}`);}}
  document.addEventListener("DOMContentLoaded",boot);
})();
