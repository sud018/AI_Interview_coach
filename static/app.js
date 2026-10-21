// ===================================================================
// AI Interviewer - frontend
// ===================================================================
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const md = (t) => (window.marked ? marked.parse(t || "") : `<pre style="white-space:pre-wrap">${esc(t)}</pre>`);

let SETTINGS = {};
let QUESTIONS = [];          // working list [{question, reference_answer, category}]
let SESSION = null;          // current interview session
let CUR = 0;                 // current question index
let stream = null, videoRec = null, audioRec = null, videoChunks = [], audioChunks = [];
let recStart = 0, timerInt = null, frameInt = null, frames = [], pollInt = null;
let vmCtx = null, vmInt = null, vmSamples = [];

// --- approximate voice measurements (loudness every 100 ms) used to judge natural vs read delivery
function startVoiceMeter() {
  vmSamples = [];
  try {
    vmCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = vmCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const an = vmCtx.createAnalyser(); an.fftSize = 2048; src.connect(an);
    const buf = new Float32Array(an.fftSize);
    vmInt = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      vmSamples.push(Math.sqrt(sum / buf.length));
    }, 100);
  } catch { vmCtx = null; }
}
function stopVoiceMeter() {
  clearInterval(vmInt);
  if (vmCtx) { try { vmCtx.close(); } catch {} vmCtx = null; }
  const s = vmSamples; if (s.length < 30) return null;
  const sorted = [...s].sort((a, b) => a - b);
  const noise = sorted[Math.floor(s.length * 0.1)], loud = sorted[Math.floor(s.length * 0.9)];
  if (loud - noise < 0.002) return null;
  const thr = noise + 0.2 * (loud - noise);
  const voiced = s.map((v) => v > thr);
  const first = voiced.indexOf(true), last = voiced.lastIndexOf(true);
  if (first < 0) return null;
  const pauses = []; let run = 0;
  for (let i = first; i <= last; i++) { if (!voiced[i]) run++; else { if (run >= 7) pauses.push(run / 10); run = 0; } }
  const v = s.filter((x, i) => voiced[i]); const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  const speakSec = (last - first + 1) / 10;
  return {
    speaking_span_sec: +speakSec.toFixed(1),
    time_to_start_speaking_sec: +(first / 10).toFixed(1),
    voiced_ratio: +(v.length / (last - first + 1)).toFixed(2),
    pauses_over_0_7s: pauses.length,
    pauses_over_2s: pauses.filter((p) => p >= 2).length,
    longest_pause_sec: pauses.length ? Math.max(...pauses) : 0,
    pauses_per_minute: +(pauses.length / (speakSec / 60)).toFixed(1),
    volume_variation: +(sd / mean).toFixed(2),
    note: "volume_variation below ~0.35 suggests flat/monotone delivery; very few pauses with long fluent stretches can indicate reading or memorized recitation",
  };
}

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  let data;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const postJSON = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function msg(el, text, cls = "") { el.textContent = text; el.className = "msg " + cls; }

// ------------------------------------------------------------ views
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + view).classList.remove("hidden");
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "history") loadHistory();
  if (view === "settings") fillSettings();
  if (view === "questions") loadSets();
  if (view === "shadow" && window.shadowInit) shadowInit();
  if (view !== "shadow" && window.shadowStop) shadowStop();
  if (view !== "interview") stopCamera();
}
document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

// ------------------------------------------------------------ model choices
const MODELS = [
  { id: "gpt-6-luna", label: "gpt-6-luna - Cheapest (~$0.001 per answer) - recommended to start" },
  { id: "gpt-6.1-sol", label: "gpt-6.1-sol - Best coaching quality (~$0.02 per answer)" },
  { id: "gpt-4o-mini", label: "gpt-4o-mini - Cheap, reads webcam images (~$0.001 per answer)" },
  { id: "__custom", label: "Other (type model name)..." },
];
function initModelSelect(sel, customInput) {
  sel.innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("");
  sel.onchange = () => customInput.classList.toggle("hidden", sel.value !== "__custom");
}
function setModel(sel, customInput, value) {
  const known = MODELS.some((m) => m.id === value && m.id !== "__custom");
  sel.value = known ? value : "__custom";
  customInput.value = known ? "" : (value || "");
  customInput.classList.toggle("hidden", known);
}
const PROVIDERS = [
  { id: "openai", label: "OpenAI", model: "gpt-6-luna", keyHint: "sk-..." },
  { id: "anthropic", label: "Anthropic (Claude)", model: "claude-sonnet-5-5", keyHint: "sk-ant-..." },
  { id: "gemini", label: "Google Gemini", model: "gemini-2.5-flash", keyHint: "AIza..." },
  { id: "groq", label: "Groq (also does speech-to-text)", model: "llama-3.3-70b-versatile", keyHint: "gsk_..." },
  { id: "openrouter", label: "OpenRouter (many models)", model: "openai/gpt-4o-mini", keyHint: "sk-or-..." },
  { id: "ollama", label: "Ollama (free, runs on this computer)", model: "llama3.1", keyHint: "not needed" },
  { id: "custom", label: "Other OpenAI-compatible API", model: "", keyHint: "API key" },
];
const prov = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
function getModel(sel, customInput, provider = "openai") {
  return sel.value === "__custom" ? (customInput.value.trim() || prov(provider).model || "gpt-6-luna") : sel.value;
}
// Non-OpenAI providers: hide the OpenAI model list and show a free-text model box.
function syncModelUI(sel, input, wrap, provider) {
  if (provider === "openai") {
    wrap.classList.remove("hidden");
    input.classList.toggle("hidden", sel.value !== "__custom");
  } else {
    wrap.classList.add("hidden");
    sel.value = "__custom";
    input.classList.remove("hidden");
  }
  input.placeholder = prov(provider).model ? "Model name, e.g. " + prov(provider).model : "Type exact model name";
}
function onProviderSwitch(sel, input, wrap, provider) {
  if (provider === "openai") setModel(sel, input, "gpt-6-luna"); else input.value = "";
  syncModelUI(sel, input, wrap, provider);
}
for (const id of ["#setup-provider", "#s-llm_provider"]) $(id).innerHTML = PROVIDERS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("");
initModelSelect($("#setup-model"), $("#setup-model-custom"));
initModelSelect($("#s-chat_model"), $("#s-chat_model-custom"));

function setupProviderUI() {
  const p = $("#setup-provider").value, P = prov(p);
  $("#setup-base-wrap").classList.toggle("hidden", p !== "custom");
  $("#setup-key-label").textContent = p === "openai" ? "OpenAI API key" : P.label.split(" (")[0] + " API key" + (p === "ollama" ? " (optional)" : "");
  $("#setup-key").placeholder = P.keyHint;
  $("#setup-openai-wrap").classList.toggle("hidden", p === "openai");
  $("#setup-voice-hint").classList.toggle("hidden", p === "openai");
  syncModelUI($("#setup-model"), $("#setup-model-custom"), $("#setup-model-wrap"), p);
}
$("#setup-provider").onchange = () => { onProviderSwitch($("#setup-model"), $("#setup-model-custom"), $("#setup-model-wrap"), $("#setup-provider").value); setupProviderUI(); };
function settingsProviderUI() {
  const p = $("#s-llm_provider").value;
  $("#s-base-wrap").classList.toggle("hidden", p !== "custom");
  $("#s-llmkey-wrap").classList.toggle("hidden", p === "openai");
  $("#s-llm-key").placeholder = (SETTINGS.has_llm_key ? "Paste a new key to change it" : prov(p).keyHint);
  syncModelUI($("#s-chat_model"), $("#s-chat_model-custom"), $("#s-model-wrap"), p);
}
$("#s-llm_provider").onchange = () => { onProviderSwitch($("#s-chat_model"), $("#s-chat_model-custom"), $("#s-model-wrap"), $("#s-llm_provider").value); settingsProviderUI(); };

// ------------------------------------------------------------ boot
async function boot() {
  SETTINGS = await api("/api/settings");
  try { QUESTIONS = JSON.parse(localStorage.getItem("ai_iv_questions") || "[]"); } catch { QUESTIONS = []; }
  renderQuestions();
  try { $("#iv-jd").value = localStorage.getItem("ai_iv_jd") || ""; } catch {}
  $("#iv-jd").addEventListener("input", () => { try { localStorage.setItem("ai_iv_jd", $("#iv-jd").value); } catch {} });
  if (!SETTINGS.has_key) {
    $("#setup-role").value = SETTINGS.target_role || "";
    $("#setup-years").value = SETTINGS.experience_years || "";
    $("#setup-provider").value = SETTINGS.llm_provider || "openai";
    $("#setup-base").value = SETTINGS.llm_base_url || "";
    setModel($("#setup-model"), $("#setup-model-custom"), SETTINGS.chat_model);
    setupProviderUI();
    show("setup");
  } else {
    $("#nav").classList.remove("hidden");
    show("questions");
  }
}

$("#setup-save").onclick = async () => {
  const p = $("#setup-provider").value;
  const key = $("#setup-key").value.trim(), okey = $("#setup-openai-key").value.trim();
  if (!key && p !== "ollama") return msg($("#setup-msg"), "Please paste your key.", "err");
  if (p === "custom" && !$("#setup-base").value.trim()) return msg($("#setup-msg"), "Please enter the base URL.", "err");
  const body = { llm_provider: p, llm_base_url: $("#setup-base").value.trim(),
    chat_model: getModel($("#setup-model"), $("#setup-model-custom"), p),
    target_role: $("#setup-role").value, experience_years: $("#setup-years").value };
  if (p === "openai") body.openai_api_key = key; else { body.llm_api_key = key; if (okey) body.openai_api_key = okey; }
  msg($("#setup-msg"), "Testing...");
  try {
    await postJSON("/api/settings/test", body);
    if (okey && p !== "openai") await postJSON("/api/settings/test", { kind: "openai", openai_api_key: okey });
    SETTINGS = await postJSON("/api/settings", body);
    $("#nav").classList.remove("hidden");
    show("questions");
  } catch (e) { msg($("#setup-msg"), "Test failed: " + e.message, "err"); }
};

// ------------------------------------------------------------ settings
const SKEYS = ["llm_provider", "llm_base_url", "chat_model", "transcribe_model", "audio_model", "analyze_body_language", "speak_questions", "answer_time_limit_sec",
  "candidate_name", "target_role", "experience_years", "tech_stack", "job_description"];
function fillSettings() {
  $("#set-key-current").textContent = SETTINGS.has_openai_key ? `(current: ${SETTINGS.openai_api_key})` : "(not set)";
  $("#set-llmkey-current").textContent = SETTINGS.has_llm_key ? `(current: ${SETTINGS.llm_api_key})` : "(not set)";
  $("#s-key").value = "";
  $("#s-llm-key").value = "";
  SKEYS.forEach((k) => {
    const el = $("#s-" + k);
    if (k === "chat_model") return setModel(el, $("#s-chat_model-custom"), SETTINGS[k]);
    if (el.type === "checkbox") el.checked = !!SETTINGS[k]; else el.value = SETTINGS[k] ?? "";
  });
  if (!$("#s-llm_provider").value) $("#s-llm_provider").value = "openai";
  settingsProviderUI();
}
$("#s-save").onclick = async () => {
  const body = {};
  SKEYS.forEach((k) => { const el = $("#s-" + k); body[k] = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value); });
  body.chat_model = getModel($("#s-chat_model"), $("#s-chat_model-custom"), body.llm_provider);
  if ($("#s-key").value.trim()) body.openai_api_key = $("#s-key").value.trim();
  if ($("#s-llm-key").value.trim()) body.llm_api_key = $("#s-llm-key").value.trim();
  SETTINGS = await postJSON("/api/settings", body);
  fillSettings();
  msg($("#s-msg"), "Saved.", "ok");
};
$("#s-test").onclick = async () => {
  msg($("#s-test-msg"), "Testing...");
  try { await postJSON("/api/settings/test", { kind: "openai", openai_api_key: $("#s-key").value.trim() }); msg($("#s-test-msg"), "Key works ✓", "ok"); }
  catch (e) { msg($("#s-test-msg"), e.message, "err"); }
};
$("#s-test-llm").onclick = async () => {
  msg($("#s-test-llm-msg"), "Testing...");
  const p = $("#s-llm_provider").value;
  try {
    await postJSON("/api/settings/test", { llm_provider: p, llm_base_url: $("#s-llm_base_url").value.trim(),
      chat_model: getModel($("#s-chat_model"), $("#s-chat_model-custom"), p),
      llm_api_key: $("#s-llm-key").value.trim(), openai_api_key: $("#s-key").value.trim() });
    msg($("#s-test-llm-msg"), "Provider and model work ✓", "ok");
  } catch (e) { msg($("#s-test-llm-msg"), e.message, "err"); }
};

// ------------------------------------------------------------ questions
function saveLocal() { localStorage.setItem("ai_iv_questions", JSON.stringify(QUESTIONS)); }
function renderQuestions() {
  $("#q-count").textContent = QUESTIONS.length;
  const list = $("#q-list");
  if (!QUESTIONS.length) { list.innerHTML = '<p class="hint">No questions yet. Upload a file or type some above.</p>'; return; }
  list.innerHTML = QUESTIONS.map((q, i) => `
    <div class="q-item" data-i="${i}">
      <div class="num">${i + 1}.</div>
      <div>
        <textarea rows="2" data-f="question">${esc(q.question)}</textarea>
        <div class="meta">
          <input data-f="category" placeholder="Category (optional)" value="${esc(q.category)}" style="max-width:200px">
          <input data-f="reference_answer" placeholder="Expected answer / notes (optional)" value="${esc(q.reference_answer)}">
        </div>
      </div>
      <div class="actions">
        <button data-a="learn">📘 Learn</button>
        <button data-a="up">↑</button>
        <button data-a="del" class="danger">✕</button>
      </div>
    </div>`).join("");
}
$("#q-list").addEventListener("input", (e) => {
  const item = e.target.closest(".q-item"); if (!item || !e.target.dataset.f) return;
  QUESTIONS[+item.dataset.i][e.target.dataset.f] = e.target.value; saveLocal();
});
$("#q-list").addEventListener("click", (e) => {
  const a = e.target.dataset.a; if (!a) return;
  const i = +e.target.closest(".q-item").dataset.i;
  if (a === "del") QUESTIONS.splice(i, 1);
  if (a === "up" && i > 0) [QUESTIONS[i - 1], QUESTIONS[i]] = [QUESTIONS[i], QUESTIONS[i - 1]];
  if (a === "learn") return openLesson(QUESTIONS[i]);
  saveLocal(); renderQuestions();
});
function addQuestions(qs) {
  const existing = new Set(QUESTIONS.map((q) => q.question.trim().toLowerCase()));
  let n = 0;
  qs.forEach((q) => { if (q.question && !existing.has(q.question.trim().toLowerCase())) { QUESTIONS.push({ question: q.question, reference_answer: q.reference_answer || "", category: q.category || "" }); n++; } });
  saveLocal(); renderQuestions();
  return n;
}
$("#q-file").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  msg($("#q-msg"), "Reading file...");
  try {
    const r = await api("/api/questions/parse" + ($("#q-ai").checked ? "?ai=1" : ""), { method: "POST", body: fd });
    const n = addQuestions(r.questions);
    msg($("#q-msg"), `Added ${n} questions from ${f.name}. Review and edit them below.`, "ok");
    if (!$("#set-name").value) $("#set-name").value = f.name.replace(/\.[^.]+$/, "");
  } catch (err) { msg($("#q-msg"), err.message, "err"); }
  e.target.value = "";
};
$("#q-add-text").onclick = async () => {
  const text = $("#q-text").value.trim(); if (!text) return;
  msg($("#q-msg"), "Parsing...");
  try {
    const r = await postJSON("/api/questions/parse" + ($("#q-ai").checked ? "?ai=1" : ""), { text });
    msg($("#q-msg"), `Added ${addQuestions(r.questions)} questions.`, "ok"); $("#q-text").value = "";
  } catch (err) { msg($("#q-msg"), err.message, "err"); }
};
$("#q-add-one").onclick = () => { QUESTIONS.push({ question: "", reference_answer: "", category: "" }); saveLocal(); renderQuestions(); };
$("#q-clear").onclick = () => { if (confirm("Clear all questions from the list?")) { QUESTIONS = []; saveLocal(); renderQuestions(); } };

async function loadSets() {
  const sets = await api("/api/question-sets");
  $("#set-select").innerHTML = '<option value="">-- load a saved set --</option>' + sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.count})</option>`).join("");
}
$("#set-save").onclick = async () => {
  const name = $("#set-name").value.trim() || "Question set";
  await postJSON("/api/question-sets", { name, questions: QUESTIONS }); loadSets(); msg($("#q-msg"), `Saved set "${name}".`, "ok");
};
$("#set-load").onclick = async () => {
  const id = $("#set-select").value; if (!id) return;
  const s = await api("/api/question-sets/" + encodeURIComponent(id));
  QUESTIONS = s.questions || []; saveLocal(); renderQuestions(); $("#set-name").value = s.name;
};
$("#set-delete").onclick = async () => {
  const id = $("#set-select").value; if (!id || !confirm("Delete this saved set?")) return;
  await api("/api/question-sets/" + encodeURIComponent(id), { method: "DELETE" }); loadSets();
};

// ------------------------------------------------------------ lesson modal
async function openLesson(q) {
  if (!q.question.trim()) return;
  $("#modal-title").textContent = "Learn: " + q.question;
  $("#modal-body").innerHTML = '<p><span class="spinner"></span>Preparing your lesson (10-30 s)...</p>';
  $("#modal").classList.remove("hidden");
  try {
    const r = await postJSON("/api/learn", { ...q, job_description: (SESSION && SESSION.job_description) || $("#iv-jd").value });
    $("#modal-body").innerHTML = md(r.markdown);
  } catch (e) { $("#modal-body").innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
}
$("#modal-close").onclick = () => { $("#modal").classList.add("hidden"); speechSynthesis.cancel(); };

// ------------------------------------------------------------ interview
$("#iv-start").onclick = async () => {
  let qs = QUESTIONS.filter((q) => q.question.trim());
  if (!qs.length) return alert("Add some questions first.");
  if ($("#iv-shuffle").checked) qs = qs.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  SESSION = await postJSON("/api/sessions", { name: $("#iv-name").value || "Interview", mode: $("#iv-mode").value, job_description: $("#iv-jd").value, questions: qs });
  CUR = 0;
  show("interview");
  await startCamera();
  showQuestion();
};

async function startCamera() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: true, noiseSuppression: true } });
    $("#iv-video").srcObject = stream;
  } catch (e) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      msg($("#iv-status"), "Camera not available - recording audio only.", "err");
    } catch (e2) {
      msg($("#iv-status"), "Could not access camera/microphone (" + e2.message + "). You can type your answers instead.", "err");
    }
  }
}
function stopCamera() {
  if (videoRec && videoRec.state !== "inactive") { try { videoRec.stop(); audioRec.stop(); } catch {} }
  if (vmCtx) stopVoiceMeter();
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  clearInterval(timerInt); clearInterval(frameInt); clearInterval(pollInt);
  speechSynthesis.cancel();
}

function speak(text, onEnd) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1; u.lang = "en-US";
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
  speechSynthesis.speak(u);
}

function showQuestion() {
  clearInterval(pollInt);
  const q = SESSION.questions[CUR];
  $("#iv-progress").textContent = `Question ${CUR + 1} of ${SESSION.questions.length}`;
  $("#iv-category").textContent = q.category || "";
  $("#iv-question").textContent = q.question;
  $("#iv-timer").textContent = "00:00";
  $("#iv-typed").value = "";
  $("#iv-after").style.display = "none";
  $("#iv-record").classList.remove("hidden"); $("#iv-stop").classList.add("hidden");
  $("#iv-record").disabled = false;
  if (SESSION.mode === "coach") $("#iv-feedback").innerHTML = '<p class="hint">Take a moment, then click <b>Start answering</b>. Speak as if you are in the real interview.</p>';
  else $("#iv-feedback").innerHTML = '<p class="hint">Real interview mode: feedback will be shown at the end. Answers are evaluated in the background.</p>';
  msg($("#iv-status"), "");
  if (SETTINGS.speak_questions) speak(q.question);
}
$("#iv-repeat").onclick = () => speak(SESSION.questions[CUR].question);

function pickMime(cands) { return cands.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || ""; }

$("#iv-record").onclick = () => {
  if (!stream) return msg($("#iv-status"), "No microphone available. Use the typed answer box.", "err");
  speechSynthesis.cancel();
  videoChunks = []; audioChunks = []; frames = [];
  const hasVideo = stream.getVideoTracks().length > 0;
  if (hasVideo) {
    const vm = pickMime(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]);
    videoRec = new MediaRecorder(stream, vm ? { mimeType: vm, videoBitsPerSecond: 1500000 } : {});
    videoRec.ondataavailable = (e) => e.data.size && videoChunks.push(e.data);
    videoRec.start(1000);
  } else videoRec = null;
  const am = pickMime(["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]);
  audioRec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), am ? { mimeType: am, audioBitsPerSecond: 64000 } : {});
  audioRec.ondataavailable = (e) => e.data.size && audioChunks.push(e.data);
  audioRec.start(1000);
  startVoiceMeter();

  recStart = Date.now();
  $("#iv-rec").classList.remove("hidden");
  $("#iv-record").classList.add("hidden"); $("#iv-stop").classList.remove("hidden");
  msg($("#iv-status"), "Recording... speak clearly and look at the camera.");
  const limit = Number(SETTINGS.answer_time_limit_sec) || 180;
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $("#iv-timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    if (s >= limit) { msg($("#iv-status"), "Time limit reached."); stopAndSubmit(); }
  }, 250);
  if (hasVideo) { setTimeout(captureFrame, 3000); frameInt = setInterval(captureFrame, 15000); }
};

function captureFrame() {
  const v = $("#iv-video"); if (!v.videoWidth) return;
  const c = document.createElement("canvas"); c.width = 480; c.height = Math.round(480 * v.videoHeight / v.videoWidth);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  frames.push(c.toDataURL("image/jpeg", 0.7));
}
function pickFrames(arr, n = 4) {
  if (arr.length <= n) return arr;
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * (arr.length - 1) / (n - 1))]);
}
const stopRec = (rec) => new Promise((res) => { if (!rec || rec.state === "inactive") return res(); rec.onstop = res; rec.stop(); });

$("#iv-stop").onclick = () => stopAndSubmit();
async function stopAndSubmit() {
  clearInterval(timerInt); clearInterval(frameInt);
  if (!audioRec || audioRec.state === "inactive") return;
  captureFrame();
  $("#iv-stop").disabled = true;
  await Promise.all([stopRec(videoRec), stopRec(audioRec)]);
  const voiceMetrics = stopVoiceMeter();
  $("#iv-stop").disabled = false;
  $("#iv-rec").classList.add("hidden");
  const duration = (Date.now() - recStart) / 1000;
  const fd = new FormData();
  if (videoChunks.length) fd.append("video", new Blob(videoChunks, { type: videoRec.mimeType || "video/webm" }), "video.webm");
  fd.append("audio", new Blob(audioChunks, { type: audioRec.mimeType || "audio/webm" }), "audio.webm");
  fd.append("duration", duration);
  fd.append("frames", JSON.stringify(pickFrames(frames)));
  if (voiceMetrics) fd.append("voice_metrics", JSON.stringify(voiceMetrics));
  await submitAnswer(fd);
}
$("#iv-typed-submit").onclick = async () => {
  const t = $("#iv-typed").value.trim(); if (!t) return;
  const fd = new FormData(); fd.append("typed_answer", t); fd.append("duration", 0);
  await submitAnswer(fd);
};

async function submitAnswer(fd) {
  $("#iv-record").classList.remove("hidden"); $("#iv-stop").classList.add("hidden");
  $("#iv-record").disabled = true;
  msg($("#iv-status"), "Uploading recording...");
  try {
    await api(`/api/sessions/${SESSION.id}/questions/${CUR}/answer`, { method: "POST", body: fd });
  } catch (e) { msg($("#iv-status"), "Upload failed: " + e.message, "err"); $("#iv-record").disabled = false; return; }
  msg($("#iv-status"), "Saved ✓", "ok");
  if (SESSION.mode === "coach") {
    $("#iv-feedback").innerHTML = '<p><span class="spinner"></span>Transcribing and evaluating your answer...</p>';
    const qi = CUR;
    pollInt = setInterval(async () => {
      const s = await api("/api/sessions/" + SESSION.id);
      SESSION = s;
      const atts = s.questions[qi].attempts, a = atts[atts.length - 1];
      if (a.status === "processing") { $("#iv-feedback").innerHTML = `<p><span class="spinner"></span>${a.stage === "evaluating" ? "Evaluating your answer..." : "Transcribing your answer..."}</p>`; return; }
      clearInterval(pollInt);
      $("#iv-feedback").innerHTML = a.status === "error" ? `<p class="msg err">${esc(a.error)}</p>` : renderEval(a, SESSION.id);
      $("#iv-after").style.display = "flex";
      $("#iv-next").textContent = CUR + 1 >= SESSION.questions.length ? "Finish & see results →" : "Next question →";
    }, 2000);
  } else {
    nextQuestion();
  }
}
$("#iv-retry").onclick = () => showQuestion();
$("#iv-next").onclick = () => nextQuestion();
$("#iv-skip").onclick = () => { if (audioRec && audioRec.state === "recording") return; nextQuestion(); };
$("#iv-end").onclick = () => { if (confirm("End the interview now and see results?")) finishInterview(); };
function nextQuestion() {
  if (CUR + 1 >= SESSION.questions.length) return finishInterview();
  CUR++; showQuestion();
}
function finishInterview() { stopCamera(); openSession(SESSION.id); }

// ------------------------------------------------------------ evaluation rendering
const scoreCls = (s) => (s >= 7.5 ? "good" : s >= 5 ? "mid" : "bad");
const list = (arr) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>` : "<p class='hint'>-</p>");

function renderEval(a, sid) {
  const ev = a.evaluation || {}, m = a.metrics || {};
  const sc = ev.scores || {};
  const fill = Object.entries(m.filler_words || {}).map(([k, v]) => `${k}×${v}`).join(", ") || "none";
  const id = "ma" + Math.random().toString(36).slice(2);
  return `<div class="eval">
    <div class="row between">
      <div><span class="score ${scoreCls(ev.score)}">${ev.score ?? "-"}</span><span class="hint"> / 10</span> &nbsp; <span class="pill">${esc(ev.verdict || "")}</span></div>
      <span class="hint">Attempt ${a.attempt}</span>
    </div>
    <p>${esc(ev.summary)}</p>
    <div class="bars">${Object.entries(sc).map(([k, v]) => `<span>${esc(k.replace(/_/g, " "))}</span><div class="bar"><div style="width:${(Number(v) || 0) * 10}%"></div></div><b>${v}</b>`).join("")}</div>
    <div class="metrics"><span>⏱ ${m.duration_sec ?? 0}s</span><span>📝 ${m.word_count ?? 0} words</span><span>🗣 ${m.words_per_minute ?? 0} wpm (ideal 130-160)</span><span>Fillers: ${esc(fill)}</span></div>
    ${renderProgress(ev.progress_vs_previous, ev.score)}
    ${renderTone(ev.tone_authenticity)}
    <h3>Your answer (transcript)</h3><div class="box transcript">${esc(a.transcript || "(nothing transcribed)")}</div>
    <h3>✅ What you did well</h3>${list(ev.what_you_did_well)}
    <h3>🔧 Where to improve</h3>${list(ev.improvements)}
    <h3>❓ Missing points</h3>${list(ev.missing_points)}
    ${ev.mistakes && ev.mistakes.length ? `<h3>⚠ Mistakes</h3>${list(ev.mistakes)}` : ""}
    <h3>🏆 Model answer (how an experienced professional would say it)</h3>
    <div class="box" id="${id}">${esc(ev.model_answer)}</div>
    <div class="row"><button onclick="speak(document.getElementById('${id}').innerText)">🔊 Listen to model answer</button><button onclick="speechSynthesis.cancel()">Stop</button></div>
    <h3>🧱 Answer structure to use</h3><div class="box">${esc(ev.answer_structure)}</div>
    <h3>📚 Technical terms to use</h3>
    ${(ev.technical_terms_to_use || []).length ? `<table><tr><th>Term</th><th>Use it like this</th></tr>${ev.technical_terms_to_use.map((t) => `<tr><td><b>${esc(t.term)}</b></td><td>${esc(t.how_to_use)}</td></tr>`).join("")}</table>` : "<p class='hint'>-</p>"}
    <h3>🗣 Say it better</h3>
    ${(ev.better_phrasing || []).length ? `<table><tr><th>You said</th><th>Say instead</th></tr>${ev.better_phrasing.map((t) => `<tr><td>${esc(t.you_said)}</td><td>${esc(t.say_instead)}</td></tr>`).join("")}</table>` : "<p class='hint'>-</p>"}
    <h3>🎤 Delivery</h3>
    <ul>${Object.entries(ev.delivery_feedback || {}).map(([k, v]) => `<li><b>${esc(k.replace(/_/g, " "))}:</b> ${esc(v)}</li>`).join("")}</ul>
    <h3>🔁 Likely follow-up questions</h3>
    <ul>${(ev.likely_follow_ups || []).map((f) => `<li><b>${esc(f.question)}</b><br><span class="hint">${esc(f.how_to_answer)}</span></li>`).join("")}</ul>
    <h3>🏋 Practice drill</h3><div class="box">${esc(ev.practice_drill)}</div>
  </div>`;
}

function renderTone(t) {
  if (!t) return "";
  const s = Number(t.score);
  return `<div class="tone-box ${scoreCls(s)}">
    <h3>🎭 Tone: how genuine you sound <span class="pill">${esc(t.rating)}</span> <b>${esc(t.score)}/10</b></h3>
    <p>${esc(t.verdict)}</p>
    ${(t.evidence || []).length ? `<b>What gave it away:</b>${list(t.evidence)}` : ""}
    ${(t.how_to_sound_natural || []).length ? `<b>How to sound natural and experienced:</b>${list(t.how_to_sound_natural)}` : ""}
  </div>`;
}
function renderProgress(p, score) {
  if (!p) return "";
  const ch = Number(p.score_change);
  const arrow = isNaN(ch) ? "" : ch > 0 ? `<span class="up">▲ +${ch}</span>` : ch < 0 ? `<span class="down">▼ ${ch}</span>` : `<span>= 0</span>`;
  return `<div class="progress-box">
    <h3>📈 Compared with your previous attempt: ${esc(p.previous_score)} → ${esc(score)} ${arrow}</h3>
    <p>${esc(p.overall)}</p>
    <div class="grid2">
      <div><b class="up">✔ Improved</b>${list(p.improved)}</div>
      <div><b class="down">✘ Still not improved</b>${list(p.not_improved)}</div>
    </div>
    ${(p.new_issues || []).length ? `<b>⚠ New issues this time</b>${list(p.new_issues)}` : ""}
    ${p.next_focus ? `<p><b>👉 Focus next:</b> ${esc(p.next_focus)}</p>` : ""}
  </div>`;
}

// ------------------------------------------------------------ results / session detail
async function openSession(id) {
  show("results");
  const s = await api("/api/sessions/" + id);
  SESSION = s;
  $("#res-title").textContent = s.name;
  const done = s.questions.map((q) => q.attempts.filter((a) => a.status === "done").pop()).filter(Boolean);
  const avg = done.length ? (done.reduce((t, a) => t + (Number(a.evaluation.score) || 0), 0) / done.length).toFixed(1) : "-";
  const pending = s.questions.some((q) => q.attempts.some((a) => a.status === "processing"));
  $("#res-sub").innerHTML = `${s.created} · ${done.length}/${s.questions.length} answered · average score <b>${avg}</b>/10${s.job_description ? " · tailored to your job description" : ""} ${pending ? ' · <span class="spinner"></span>some answers are still being evaluated - click Refresh in a moment' : ""}`;
  $("#res-report-box").innerHTML = s.report ? renderReport(s.report) : "";
  $("#res-questions").innerHTML = s.questions.map((q, i) => {
    const last = q.attempts[q.attempts.length - 1];
    let body = "<p class='hint'>Not answered.</p>";
    if (last) {
      if (last.status === "processing") body = `<p><span class="spinner"></span>${esc(last.stage)}...</p>`;
      else if (last.status === "error") body = `<p class="msg err">${esc(last.error)}</p>`;
      else body = renderEval(last, s.id);
      const base = `${s.name}_Q${i + 1}_attempt${last.attempt}`.replace(/[^A-Za-z0-9]+/g, "_");
      const dl = (last.video ? `<a href="/media/${s.id}/${last.video}" download="${base}_video.webm"><button>⬇ Download video</button></a> ` : "") +
        (last.audio ? `<button onclick="downloadWav('/media/${s.id}/${last.audio}', '${base}_voice', this)">⬇ Download voice (WAV)</button>
          <button class="primary" onclick="analyzeDelivery('/media/${s.id}/${last.audio}', {question: ${esc(JSON.stringify(q.question))}, target: ${esc(JSON.stringify(last.transcript || ""))}, mode: 'answering an interview question in their own words'}, this, document.getElementById('deliv-${i}'))">🎧 AI listens: analyze my delivery</button>` : "");
      if (last.video) body = `<video controls src="/media/${s.id}/${last.video}"></video><div class="row">${dl}</div><div id="deliv-${i}"></div>` + body;
      else if (last.audio) body = `<audio controls src="/media/${s.id}/${last.audio}"></audio><div class="row">${dl}</div><div id="deliv-${i}"></div>` + body;
    }
    const sc = last && last.evaluation ? `<span class="score ${scoreCls(last.evaluation.score)}" style="font-size:22px">${last.evaluation.score}/10</span>` : "";
    return `<div class="card res-q"><details ${i === 0 ? "open" : ""}><summary class="row between"><b>Q${i + 1}. ${esc(q.question)}</b> ${sc}</summary>
      <div class="row"><button onclick="practiceOne(${i})">↻ Practice this question again</button>
      <button onclick='openLesson(${JSON.stringify({ question: q.question, reference_answer: q.reference_answer, category: q.category }).replace(/'/g, "&#39;")})'>📘 Learn</button>
      <span class="hint">${q.attempts.length} attempt(s)</span></div>${body}</details></div>`;
  }).join("");
}
$("#res-refresh").onclick = () => openSession(SESSION.id);
$("#res-report").onclick = async () => {
  $("#res-report-box").innerHTML = '<p><span class="spinner"></span>Building your full training report (20-60 s)...</p>';
  try { await postJSON(`/api/sessions/${SESSION.id}/report`, {}); openSession(SESSION.id); }
  catch (e) { $("#res-report-box").innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
};
window.practiceOne = async (i) => {
  SESSION.mode = "coach"; CUR = i;
  show("interview"); await startCamera(); showQuestion();
};

function renderReport(r) {
  return `<div class="eval">
    <h2>Training report <span class="score ${scoreCls(r.overall_score)}" style="font-size:24px">${r.overall_score}/10</span> <span class="pill">${esc(r.readiness)}</span></h2>
    <p><b>${esc(r.headline)}</b></p>
    <div class="grid2"><div><h3>💪 Strengths</h3>${list(r.strengths)}</div><div><h3>🎯 Weaknesses</h3>${list(r.weaknesses)}</div></div>
    <h3>🗣 How to speak like an experienced professional</h3>${list(r.communication_coaching)}
    <h3>📚 Vocabulary to master</h3>
    <table><tr><th>Term</th><th>Meaning</th><th>Example</th></tr>${(r.vocabulary_to_master || []).map((v) => `<tr><td><b>${esc(v.term)}</b></td><td>${esc(v.meaning)}</td><td>${esc(v.example)}</td></tr>`).join("")}</table>
    <h3>📖 Topics to study</h3>
    <table><tr><th>Topic</th><th>Why</th><th>What to cover</th></tr>${(r.topics_to_study || []).map((t) => `<tr><td><b>${esc(t.topic)}</b></td><td>${esc(t.why)}</td><td>${esc(t.what_to_cover)}</td></tr>`).join("")}</table>
    <h3>🗓 7-day training plan</h3>
    ${(r.seven_day_plan || []).map((d) => `<p><b>Day ${esc(d.day)}: ${esc(d.focus)}</b></p>${list(d.tasks)}`).join("")}
    ${r.tone_summary ? `<h3>🎭 Tone overall</h3><p>${esc(r.tone_summary)}</p>` : ""}
    <h3>💬 Phrases bank</h3>${list(r.phrases_bank)}
    <h3>➡ Next session</h3><p>${esc(r.next_session_advice)}</p>
    <p class="hint">Also saved as report.md in this interview's folder.</p>
  </div>`;
}

// ------------------------------------------------------------ history
async function loadHistory() {
  const items = await api("/api/sessions");
  $("#hist-list").innerHTML = items.length ? items.map((s) => `
    <div class="hist-item">
      <div><b>${esc(s.name)}</b><br><span class="hint">${esc(s.created)} · ${s.answered}/${s.questions} answered ${s.has_report ? "· report ✓" : ""}</span></div>
      <div class="row">${s.avg_score != null ? `<span class="score ${scoreCls(s.avg_score)}" style="font-size:20px">${s.avg_score}</span>` : ""}
        <button onclick="openSession('${esc(s.id)}')">Open</button>
        <button class="danger" onclick="delSession('${esc(s.id)}')">Delete</button></div>
    </div>`).join("") : "<p class='hint'>No interviews yet.</p>";
}
window.delSession = async (id) => { if (!confirm("Delete this interview and its recordings?")) return; await api("/api/sessions/" + id, { method: "DELETE" }); loadHistory(); };
window.openSession = openSession; window.openLesson = openLesson; window.speak = speak;

boot();
