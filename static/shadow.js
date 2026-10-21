// ===================================================================
// Shadow practice: listen to a phrase in an American/Indian accent,
// repeat it immediately, get rated. Voice only.
// ===================================================================
(function () {
  const SH = {
    set: null, item: null, running: false, results: [], mic: null, audio: null,
    ttsCache: new Map(), doneResolve: null, nextResolve: null, inited: false, genStop: false,
  };
  const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
  const PREF_KEYS = ["sh-accent", "sh-engine", "sh-voice", "sh-pace", "sh-showtext", "sh-autonext", "sh-autoretry", "sh-natural", "sh-headphones"];
  const STOP = new Set("a an the and or but so of to in on at for with by is are was were be been it its this that i we you they he she as from into than then".split(" "));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // like $, but returns a harmless dummy if an element is missing (e.g. an old cached index.html)
  const $ = (sel) => document.querySelector(sel) || { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, addEventListener() {}, insertAdjacentHTML() {}, value: "", checked: false, options: [], files: [] };
  const pref = (k) => { try { return localStorage.getItem("sh_" + k); } catch { return null; } };
  const setPref = (k, v) => { try { localStorage.setItem("sh_" + k, v); } catch {} };

  // ------------------------------------------------------------ init
  window.shadowInit = async function () {
    if (!SH.inited) {
      SH.inited = true;
      PREF_KEYS.forEach((id) => {
        const el = $("#" + id), v = pref(id);
        if (v != null && id !== "sh-voice") { if (el.type === "checkbox") el.checked = v === "1"; else el.value = v; }
        el.addEventListener("change", () => { setPref(id, el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value); if (id === "sh-accent" || id === "sh-engine") fillVoices(); });
      });
      try { if (pref("sh-engine") == null && typeof SETTINGS !== "undefined" && !SETTINGS.has_openai_key) $("#sh-engine").value = "browser"; } catch {}
      if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = fillVoices;
      try { fillVoices(); } catch (e) { console.error(e); }
      try { bindUI(); } catch (e) { console.error("Shadow UI binding failed", e); }
    }
    await loadSetList();
  };
  window.shadowStop = function () { stopRun(); };

  function fillVoices() {
    const engine = $("#sh-engine").value, accent = $("#sh-accent").value, sel = $("#sh-voice");
    const saved = pref("sh-voice");
    let note = "";
    if (engine === "openai") {
      sel.innerHTML = OPENAI_VOICES.map((v) => `<option value="${v}">${v}</option>`).join("");
      note = `OpenAI voice speaks with ${accent === "indian" ? "an Indian" : "an American"} English accent. Each phrase is generated once and saved, so replays are free (about $0.015 per minute of new audio).`;
    } else {
      const lang = accent === "indian" ? "en-IN" : "en-US";
      const all = (window.speechSynthesis ? speechSynthesis.getVoices() : []);
      let vs = all.filter((v) => v.lang.replace("_", "-").startsWith(lang));
      if (!vs.length) {
        note = accent === "indian"
          ? "⚠ No Indian English voice is installed in this browser. Use Microsoft Edge (it has Neerja / Prabhat Indian voices) or choose the OpenAI voice."
          : "⚠ No US English voice found in this browser; using any English voice.";
        vs = all.filter((v) => v.lang.startsWith("en"));
      } else note = "Free browser voice. Natural-sounding voices are best in Microsoft Edge (\"Online (Natural)\").";
      vs.sort((a, b) => (/natural|online/i.test(b.name) ? 1 : 0) - (/natural|online/i.test(a.name) ? 1 : 0));
      sel.innerHTML = vs.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("");
    }
    if (saved && [...sel.options].some((o) => o.value === saved)) sel.value = saved;
    $("#sh-voice-note").textContent = note;
  }

  // ------------------------------------------------------------ sets & list
  async function loadSetList() {
    let sets;
    try { sets = await api("/api/shadow/sets"); }
    catch (e) {
      $("#sh-list").innerHTML = '<p class="msg err"><b>The app needs a restart to load Shadow practice.</b><br>Close the black run.bat window and double-click run.bat again.</p>';
      return;
    }
    const sel = $("#sh-set"), cur = sel.value || pref("set");
    sel.innerHTML = sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.with_answers}/${s.count} answers)</option>`).join("") || '<option value="">No sets yet - create one</option>';
    if (cur && sets.some((s) => s.id === cur)) sel.value = cur;
    if (sel.value) await loadSet(sel.value);
  }
  async function loadSet(id, keepItem) {
    SH.set = await api("/api/shadow/sets/" + encodeURIComponent(id));
    setPref("set", id);
    const topics = [...new Set(SH.set.items.map((i) => i.topic).filter(Boolean))];
    const tsel = $("#sh-topic"), tcur = tsel.value;
    tsel.innerHTML = '<option value="">All topics</option>' + topics.map((t) => `<option>${esc(t)}</option>`).join("");
    if (topics.includes(tcur)) tsel.value = tcur;
    renderList();
    if (keepItem && SH.item) selectItem(SH.item.id, true);
  }
  function filtered() {
    if (!SH.set) return [];
    const t = $("#sh-topic").value, hi = $("#sh-high").checked, rd = $("#sh-ready").checked, q = $("#sh-search").value.toLowerCase();
    return SH.set.items.filter((i) => (!t || i.topic === t) && (!hi || i.high) && (!rd || i.answer) && (!q || i.question.toLowerCase().includes(q)));
  }
  function renderList() {
    const items = filtered();
    const missing = items.filter((i) => !i.answer).length;
    $("#sh-gen-all").textContent = `✨ Generate missing answers (${missing})`;
    $("#sh-gen-all").disabled = !missing;
    $("#sh-list").innerHTML = items.map((i) => `
      <div class="sh-item ${SH.item && SH.item.id === i.id ? "active" : ""}" data-id="${i.id}">
        <span class="n">${i.n}.</span>
        <span>${esc(i.question)}</span>
        <span class="badges">
          ${i.high ? '<span class="tag high">HIGH</span>' : ""}
          ${i.answer ? '<span class="tag ok">answer</span>' : '<span class="tag no">no answer</span>'}
          ${i.best != null ? `<span class="tag" title="best score, ${i.runs} run(s)">★ ${i.best}</span>` : ""}
        </span>
      </div>`).join("") || '<p class="hint">No questions match.</p>';
  }

  function selectItem(id, silent) {
    if (SH.running) stopRun();
    SH.item = SH.set.items.find((i) => i.id === id);
    if (!SH.item) return;
    if (!silent) renderList();
    $("#sh-empty").classList.add("hidden"); $("#sh-main").classList.remove("hidden");
    $("#sh-qtopic").textContent = `#${SH.item.n} · ${SH.item.topic || ""}${SH.item.high ? " · HIGH priority" : ""}`;
    $("#sh-qtext").textContent = SH.item.question;
    const has = !!SH.item.answer;
    $("#sh-meta").textContent = has ? `${SH.item.phrases.length} phrases · ~${Math.round(SH.item.answer.split(/\s+/).length / 2.3)} s spoken` + (SH.item.best != null ? ` · best ${SH.item.best} (${SH.item.runs} runs)` : "") : "No answer yet - click Generate, or Edit to write your own.";
    ["#sh-start", "#sh-phrases", "#sh-listen", "#sh-recall"].forEach((s) => ($(s).disabled = !has));
    $("#sh-editbox").classList.add("hidden");
    $("#sh-results").innerHTML = ""; $("#sh-summary").innerHTML = "";
    setStatus("Ready", ""); $("#sh-progress").textContent = ""; $("#sh-phrase").classList.add("hidden");
    SH.results = [];
    if (has) prefetch(SH.item.phrases[0]);
  }

  // ------------------------------------------------------------ TTS
  const natural = () => $("#sh-natural").checked;
  async function ttsUrl(text) {
    const style = natural() ? "natural" : "plain";
    const k = [$("#sh-voice").value, $("#sh-accent").value, $("#sh-pace").value, style, text].join("|");
    if (!SH.ttsCache.has(k)) {
      const p = postJSON("/api/tts", { text, accent: $("#sh-accent").value, voice: $("#sh-voice").value, pace: $("#sh-pace").value, style }).then((r) => r.url);
      p.catch(() => SH.ttsCache.delete(k));
      SH.ttsCache.set(k, p);
    }
    return SH.ttsCache.get(k);
  }
  function prefetch(text) { if (text && $("#sh-engine").value === "openai") ttsUrl(text).catch(() => {}); }

  // speaks text; resolves with spoken duration in seconds
  async function speak(text) {
    if ($("#sh-engine").value === "openai") {
      try {
        const url = await ttsUrl(text);
        return await new Promise((res, rej) => {
          const a = new Audio(url); SH.audio = a;
          const t0 = performance.now();
          a.onended = () => res(a.duration && isFinite(a.duration) ? a.duration : (performance.now() - t0) / 1000);
          a.onerror = () => rej(new Error("audio playback failed"));
          a.play().catch(rej);
        });
      } catch (e) {
        $("#sh-voice-note").textContent = "OpenAI voice failed (" + e.message + "). Switched to the free browser voice.";
        $("#sh-engine").value = "browser"; fillVoices();
      }
    }
    return await new Promise((res) => {
      if (!("speechSynthesis" in window)) return res(text.split(/\s+/).length / 2.5);
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices().find((x) => x.name === $("#sh-voice").value);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = $("#sh-accent").value === "indian" ? "en-IN" : "en-US";
      u.rate = $("#sh-pace").value === "slow" ? 0.85 : 1;
      let t0 = performance.now();
      u.onstart = () => (t0 = performance.now());
      u.onend = u.onerror = () => res((performance.now() - t0) / 1000);
      speechSynthesis.speak(u);
    });
  }
  // ---------- "thinking while speaking" delivery ----------
  // Real speakers pause unevenly: short breaths between sentences, longer 0.7-1.5 s pauses when
  // moving to a new idea, and silence is usually 15-25% of the time. We split the answer into
  // sentences, add a few light fillers at idea changes, and play them with uneven gaps.
  const TRANSITION = /^(first|second|third|then|next|after that|finally|so\b|the result|what i learned|to make|for example|in practice|overall|honestly|the key|the hard|the biggest|nothing|and finally|that's why|at my last|at my previous|in my last|my rule|step|two reasons|but|instead|however|in short)/i;
  function rng(seed) { let x = seed % 2147483647 || 1; return () => ((x = (x * 48271) % 2147483647) / 2147483647); }
  function naturalPlan(text) {
    const sents = (text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text]).map((t) => t.trim()).filter(Boolean);
    let seed = 0; for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
    const r = rng(seed);
    let lastFiller = -3;
    return sents.map((t, i) => {
      const nxt = sents[i + 1] || "";
      const idea = /^(the result|what i learned|so\b|in short|overall)/i.test(nxt) || (TRANSITION.test(nxt) ? r() < 0.6 : r() < 0.2);
      let say = t;
      const fillerOk = TRANSITION.test(t) && !/^(first|second|third|then|next|finally|so|and|but|um|uh)\b/i.test(t);
      if (i > 0 && fillerOk && i - lastFiller > 2 && r() < 0.5) {
        const f = ["So, ", "Um, ", "And, ", "Uh, "][Math.floor(r() * 4)];
        say = f + t.charAt(0).toLowerCase() + t.slice(1); lastFiller = i;
      } else if (t.split(/\s+/).length > 13 && r() < 0.3) {
        say = t.replace(/, /, ", ... "); // a short mid-sentence "thinking" beat
      }
      const gap = !nxt ? 0 : idea ? 0.75 + r() * 0.65 : 0.2 + r() * 0.35;
      return { text: t, say, gap };
    });
  }
  function urlDuration(url) {
    return new Promise((res) => { const a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : 0); a.onerror = () => res(0); a.src = url; });
  }
  // Plays the whole answer naturally; resolves with total seconds (speech + pauses).
  async function speakNatural(text, onSentence) {
    if (!natural()) return speak(text);
    const token = (SH.seq = (SH.seq || 0) + 1);
    const plan = naturalPlan(text);
    if ($("#sh-engine").value === "openai") {
      try {
        const urls = await Promise.all(plan.map((p) => ttsUrl(p.say)));
        const durs = await Promise.all(urls.map(urlDuration));
        const speech = durs.reduce((a, b) => a + b, 0), gaps = plan.reduce((a, p) => a + p.gap, 0);
        // the voice already pauses briefly at commas; nudge our gaps so total silence lands near 15-25%,
        // but only scale a little so short and long pauses stay clearly different (uneven, like real speech)
        if (speech && gaps) { const k = Math.min(1.25, Math.max(0.75, (speech * 0.13) / gaps)); plan.forEach((p) => (p.gap = p.gap ? Math.min(1.5, Math.max(0.2, p.gap * k)) : 0)); }
      } catch (e) { /* speak() below falls back to the browser voice */ }
    }
    const t0 = performance.now();
    for (let i = 0; i < plan.length; i++) {
      if (SH.seq !== token) break;
      if (onSentence) onSentence(plan[i].text, i);
      await speak(plan[i].say);
      if (SH.seq !== token) break;
      if (plan[i].gap) await sleep(plan[i].gap * 1000);
    }
    return (performance.now() - t0) / 1000;
  }

  function stopAudio() {
    SH.seq = (SH.seq || 0) + 1;
    if (SH.audio) { try { SH.audio.pause(); } catch {} SH.audio = null; }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  window.shSpeak = (t) => speak(t);

  // ------------------------------------------------------------ microphone + voice activity detection
  // With headphones we record the raw microphone: the browser's echo cancellation / noise suppression
  // mutes your voice whenever the app's voice is playing (double-talk), which makes recordings choppy.
  async function getMic() {
    const raw = $("#sh-headphones").checked;
    if (SH.mic && SH.mic.active && SH.micRaw === raw) return SH.mic;
    if (SH.mic) SH.mic.getTracks().forEach((t) => t.stop());
    const c = raw
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 }
      : { echoCancellation: true, noiseSuppression: false, autoGainControl: true };
    try { SH.mic = await navigator.mediaDevices.getUserMedia({ audio: c }); }
    catch (e) { SH.mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    SH.micRaw = raw;
    return SH.mic;
  }
  function pickMime() {
    return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }
  // records until the user stops talking (silence), presses Done, or time runs out
  async function recordRepeat(maxSec, silenceMs = 1300, noSpeechSec = 7, hold = null) {
    let held = !!hold, releasedAt = null;
    if (hold) hold.finally(() => { held = false; releasedAt = performance.now(); });
    const stream = await getMic();
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : {});
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    rec.start(250);
    const t0 = performance.now();
    let noise = 1, started = null, lastVoice = null, aboveMs = 0, samples = [];
    $("#sh-done").classList.remove("hidden");
    const result = await new Promise((resolve) => {
      SH.doneResolve = () => resolve("done");
      const iv = setInterval(() => {
        if (!SH.running && !SH.recallMode) { clearInterval(iv); return resolve("stopped"); }
        an.getFloatTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / buf.length), now = performance.now(), el = (now - t0) / 1000;
        samples.push(rms);
        // noise floor = quietest moment so far (smoothed over 150 ms)
        if (samples.length >= 3) noise = Math.min(noise, (samples[samples.length - 1] + samples[samples.length - 2] + samples[samples.length - 3]) / 3);
        const thr = Math.max(0.006, Math.min(0.03, noise * 2.5));
        $("#sh-level").style.width = Math.min(100, rms * 900) + "%";
        if (rms > thr) { aboveMs += 50; if (aboveMs >= 150 && !started) started = now - 150; lastVoice = now; } else aboveMs = 0;
        if (held) return; // speak-along: keep recording for the whole time the voice is playing
        if (releasedAt) {
          // voice finished: give the speaker time to finish their last words
          const since = now - releasedAt;
          if ((since > 1500 && (!lastVoice || now - lastVoice > 1200)) || since > 8000) { clearInterval(iv); resolve("ended"); }
          return;
        }
        if (started && now - lastVoice > silenceMs) { clearInterval(iv); resolve("silence"); }
        else if (!started && el > noSpeechSec) { clearInterval(iv); resolve("nospeech"); }
        else if (el > maxSec) { clearInterval(iv); resolve("max"); }
      }, 50);
      SH._iv = iv;
    });
    clearInterval(SH._iv); SH.doneResolve = null;
    $("#sh-done").classList.add("hidden"); $("#sh-level").style.width = "0";
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    try { ctx.close(); } catch {}
    const endT = lastVoice || performance.now();
    const speechSec = started ? (endT - started) / 1000 : 0;
    // pauses inside the speech (approximate)
    let pauses = 0, long = 0, run = 0, silent = 0, maxPause = 0, shortP = 0;
    const thr = Math.max(0.006, Math.min(0.03, noise * 2.5));
    const sIdx = started ? Math.floor((started - t0) / 50) : 0, eIdx = Math.min(Math.floor((endT - t0) / 50), samples.length - 1);
    for (let i = sIdx; i <= eIdx; i++) {
      if (samples[i] <= thr) run++;
      else {
        if (run >= 5) { silent += run; shortP++; maxPause = Math.max(maxPause, run / 20); }
        if (run >= 14) pauses++; if (run >= 40) long++; run = 0;
      }
    }
    const span = Math.max(1, eIdx - sIdx + 1);
    const rhythm = { silence_pct: Math.round((100 * silent) / span), thinking_pauses: pauses, all_pauses: shortP, longest_pause_sec: +maxPause.toFixed(1) };
    return { blob: new Blob(chunks, { type: rec.mimeType || "audio/webm" }), reason: result, heardSpeech: !!started, speechSec,
             vm: { pauses_over_0_7s: pauses, pauses_over_2s: long, ...rhythm }, rhythm,
             lagSec: releasedAt && lastVoice ? Math.max(0, (lastVoice - releasedAt) / 1000) : null };
  }

  async function scoreRec(r, target, refSec, idx, kind) {
    const fd = new FormData();
    fd.append("audio", r.blob, "rep.webm");
    fd.append("set_id", SH.set.id); fd.append("item_id", SH.item.id); fd.append("phrase_index", idx); fd.append("kind", kind || (idx === -1 ? "whole" : "phrase"));
    fd.append("target", target); fd.append("duration", r.speechSec); fd.append("ref_duration", refSec || 0);
    fd.append("voice_metrics", JSON.stringify(r.vm));
    return api("/api/shadow/score", { method: "POST", body: fd });
  }

  // ------------------------------------------------------------ status helpers
  function setStatus(text, cls) { const s = $("#sh-status"); s.textContent = text; s.className = "sh-status " + (cls || ""); }
  function showPhrase(text, force) {
    const el = $("#sh-phrase");
    if ($("#sh-showtext").checked || force) { el.textContent = text; el.classList.remove("hidden"); } else el.classList.add("hidden");
  }
  const scls = (s) => (s >= 80 ? "good" : s >= 60 ? "mid" : "bad");

  function clipName(label) {
    const q = (SH.item ? `Q${SH.item.n}_` + SH.item.question : "answer").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 50);
    const kind = /along/i.test(label) ? "speak-along" : /memory/i.test(label) ? "from-memory" : label.replace(/[^A-Za-z0-9]+/g, "-");
    const d = new Date(); const ts = d.toISOString().slice(0, 10) + "_" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
    return `${q}_${kind}_${ts}`.replace(/_+/g, "_");
  }

  function renderRow(idx, target, res, label) {
    const words = (res.words || []).map((w) =>
      w.s === "ok" ? `<span>${esc(w.w)}</span>` :
      w.s === "missed" ? `<span class="missed" title="missed">${esc(w.w)}</span>` :
      `<span class="wrong" title="heard: ${esc(w.heard || "?")}">${esc(w.w)}</span>`).join(" ");
    const pace = res.pace_ratio ? (res.pace_ratio > 1.3 ? "slower than model" : res.pace_ratio < 0.8 ? "faster than model" : "good pace") : "";
    const id = "shrow" + idx;
    const rh = res.rhythm;
    const rhythmHtml = rh ? `<div class="sh-heard">Rhythm: silence ${rh.silence_pct}% <span class="${rh.silence_pct >= 12 && rh.silence_pct <= 28 ? "up" : "down"}">(natural 15-25%)</span> · ${rh.thinking_pauses} thinking pause(s) ≥0.7 s <span class="${rh.thinking_pauses >= 2 ? "up" : "down"}">(aim for 3-6 at idea changes)</span> · longest ${rh.longest_pause_sec}s</div>` : "";
    const html = `<div class="sh-row" id="${id}">
      <div class="sc score ${scls(res.score)}">${res.score}</div>
      <div>
        <div class="hint">${esc(label)} · accuracy ${res.accuracy}% ${pace ? "· " + pace : ""}${res.fluency < 100 ? " · hesitations" : ""}${res.extra_words ? ` · ${res.extra_words} extra word(s)` : ""}</div>
        <div class="sh-words">${words}</div>
        <div class="sh-heard">You said: “${esc(res.heard || "")}”</div>${rhythmHtml}
      </div>
      <div class="btns">
        <button title="Hear the model again" data-say="${esc(target)}">🔊</button>
        ${res.recording ? `<button title="Hear yourself" data-play="${esc(res.recording)}">▶ me</button>
          <button title="Download your recording as WAV (plays on any phone/computer)" data-dl="${esc(res.recording)}" data-dlname="${esc(clipName(label))}">⬇ Download</button>
          <a class="hint" href="${esc(res.recording)}" download="${esc(clipName(label))}.webm" title="Original WebM file (smaller)">webm</a>
          <button class="primary" title="An OpenAI audio model listens to your recording and rates tone, phrasing, pauses and naturalness" data-analyze="${esc(res.recording)}">🎧 AI listens</button>` : ""}
      </div></div>
      <div class="sh-analysis" data-for="${esc(res.recording || "")}"></div>`;
    if (res.recording) DELIV[res.recording] = { target, question: SH.item ? SH.item.question : "", mode: /along/i.test(label) ? "speak-along (speaking at the same time as a model voice)" : /memory/i.test(label) ? "answering from memory" : "repeating a phrase after a model voice", rhythm: res.rhythm || null, accent: $("#sh-accent").value };
    const ex = document.getElementById(id);
    if (ex) { const nx = ex.nextElementSibling; if (nx && nx.classList.contains("sh-analysis")) nx.remove(); ex.outerHTML = html; }
    else $("#sh-results").insertAdjacentHTML("afterbegin", html);
  }

  // ------------------------------------------------------------ main loop
  // Speak along: the voice plays the whole answer and you speak WITH it; recording covers the whole answer.
  async function runAlong() {
    const it = SH.item; if (!it || !it.answer) return;
    try { await getMic(); } catch (e) { setStatus("Microphone blocked: " + e.message, "speak"); return; }
    SH.running = true; toggleRunning(true);
    $("#sh-summary").innerHTML = ""; SH.results = [];
    $("#sh-progress").textContent = "Speak along: talk at the same time as the voice. Use headphones so the mic doesn't hear the voice.";
    if ($("#sh-engine").value === "openai") {
      setStatus("⏳ Preparing voice...", "score");
      try { await Promise.all(natural() ? naturalPlan(it.answer).map((p) => ttsUrl(p.say)) : [ttsUrl(it.answer)]); } catch (e) {}
    }
    for (const n of ["3", "2", "1"]) { if (!SH.running) break; setStatus(`Get ready... ${n}`, "listen"); await sleep(700); }
    if (!SH.running) { toggleRunning(false); return; }
    showPhrase(it.answer);
    let refSec = 0;
    const voice = speakNatural(it.answer, (t) => showPhrase(t)).then((d) => (refSec = d));
    const recP = recordRepeat(600, 1300, 10, voice);
    setStatus("🗣 Speak along now - recording the whole answer", "speak");
    const r = await recP;
    stopAudio();
    if (!SH.running) return;
    SH.running = false; toggleRunning(false);
    if (!r.heardSpeech) return setStatus("🤔 I didn't hear you. Check your microphone and try again.", "score");
    setStatus("⏳ Scoring...", "score");
    try {
      const res = await scoreRec(r, it.answer, refSec, -1, "speak-along");
      res.target = it.answer; res.index = 0; res.ref = refSec;
      SH.results[0] = res;
      const lag = r.lagSec == null ? "" : r.lagSec < 1.5 ? " · you kept up with the voice ✓" : ` · you finished ${r.lagSec.toFixed(1)} s after the voice`;
      res.rhythm = r.rhythm;
      renderRow("along", it.answer, res, "Speak along - whole answer" + lag);
      showPhrase(it.answer, true);
      await showSummary("along");
    } catch (e) { setStatus("Scoring failed: " + e.message, "speak"); }
  }

  async function runShadow(indices) {
    const it = SH.item; if (!it || !it.answer) return;
    try { await getMic(); } catch (e) { setStatus("Microphone blocked: " + e.message, "speak"); return; }
    SH.running = true; toggleRunning(true);
    $("#sh-summary").innerHTML = "";
    const whole = false;
    const phrases = whole ? [it.answer] : it.phrases;
    indices = indices || phrases.map((_, i) => i);
    if (!indices.length) indices = [0];
    for (let k = 0; k < indices.length && SH.running; k++) {
      const i = indices[k], text = phrases[i];
      let tries = 0;
      while (SH.running) {
        $("#sh-progress").textContent = whole ? "Whole answer" : `Phrase ${i + 1} of ${phrases.length}`;
        setStatus("🔊 Listen...", "listen"); showPhrase(text);
        prefetch(phrases[indices[k + 1]]);
        let ref;
        try { ref = await speak(text); } catch (e) { setStatus("Voice error: " + e.message); SH.running = false; break; }
        if (!SH.running) break;
        await sleep(150);
        setStatus("🎙 Your turn - repeat now", "speak");
        const maxSec = Math.max(6, ref * 2.2 + 3);
        const r = await recordRepeat(maxSec, whole ? 2200 : 1300, whole ? 10 : 7);
        if (!SH.running) break;
        if (!r.heardSpeech) {
          setStatus("🤔 I didn't hear you - let's try again", "score"); await sleep(1300);
          if (++tries >= 3) break; else continue;
        }
        setStatus("⏳ Scoring...", "score");
        let res;
        try { res = await scoreRec(r, text, ref, whole ? -1 : i); }
        catch (e) { setStatus("Scoring failed: " + e.message, "speak"); SH.running = false; break; }
        res.target = text; res.index = i; res.ref = ref;
        SH.results[i] = res;
        renderRow(whole ? "w" : i, text, res, whole ? "Whole answer" : `Phrase ${i + 1}`);
        setStatus(`${res.score >= 85 ? "🎉 Great" : res.score >= 70 ? "👍 Good" : "🔁 Keep going"} - ${res.score}/100`, "");
        showPhrase(text, true);
        if (res.score < 70 && $("#sh-autoretry").checked && tries < 1) {
          tries++; await sleep(1500);
          if (!SH.running) break;
          setStatus("🔁 Let's do that one again", "score"); await sleep(900);
          continue;
        }
        break;
      }
      if (!SH.running) break;
      if (k < indices.length - 1) {
        if ($("#sh-autonext").checked) await sleep(1100);
        else {
          $("#sh-next").classList.remove("hidden");
          await new Promise((r) => (SH.nextResolve = r));
          $("#sh-next").classList.add("hidden");
        }
      }
    }
    const finished = SH.running;
    SH.running = false; toggleRunning(false);
    if (finished || SH.results.filter(Boolean).length) await showSummary(whole ? "whole" : "phrase");
  }

  function toggleRunning(on) {
    $("#sh-start").classList.toggle("hidden", on); $("#sh-phrases").classList.toggle("hidden", on); $("#sh-stop").classList.toggle("hidden", !on);
    ["#sh-listen", "#sh-recall", "#sh-edit", "#sh-generate", "#sh-hearq"].forEach((s) => ($(s).disabled = on));
  }
  function stopRun() {
    SH.running = false; SH.recallMode = false;
    stopAudio();
    if (SH.doneResolve) SH.doneResolve();
    if (SH.nextResolve) { SH.nextResolve(); SH.nextResolve = null; }
    $("#sh-next").classList.add("hidden");
    setStatus("Stopped", "");
    toggleRunning(false);
  }

  async function showSummary(mode) {
    const rs = SH.results.filter(Boolean);
    if (!rs.length) return;
    const avg = (k) => Math.round(rs.reduce((a, r) => a + (Number(r[k]) || 0), 0) / rs.length);
    const score = avg("score"), acc = avg("accuracy");
    const paces = rs.map((r) => r.pace_ratio).filter(Boolean);
    const pace = paces.length ? (paces.reduce((a, b) => a + b, 0) / paces.length) : null;
    const tough = new Map();
    rs.forEach((r) => (r.words || []).forEach((w) => { if (w.s !== "ok" && !STOP.has(w.w) && w.w.length > 2) tough.set(w.w, (tough.get(w.w) || 0) + 1); }));
    const weak = SH.results.map((r, i) => (r && r.score < 80 ? i : null)).filter((x) => x !== null);
    setStatus(`Done - average ${score}/100`, "");
    $("#sh-summary").innerHTML = `<div class="card" style="margin:0 0 10px">
      <div class="row between"><h3 style="margin:0">Run summary</h3><span class="score ${scls(score)}">${score}<span class="hint">/100</span></span></div>
      <div class="metrics"><span>Word accuracy ${acc}%</span><span>Phrases ${rs.length}</span>
        <span>Pace ${pace ? (pace > 1.3 ? "slower than the model (" + pace.toFixed(2) + "×)" : pace < 0.8 ? "faster than the model (" + pace.toFixed(2) + "×)" : "matches the model ✓") : "-"}</span></div>
      ${tough.size ? `<p><b>Words to practise</b> (click to hear them in the ${$("#sh-accent").value} accent):<br>${[...tough.keys()].slice(0, 20).map((w) => `<button class="word-btn" data-say="${esc(w)}">🔊 ${esc(w)}</button>`).join("")}</p>` : "<p>No problem words - excellent!</p>"}
      <div class="row">
        ${weak.length && mode === "phrase" ? `<button id="sh-weak" class="primary">🔁 Practise ${weak.length} weak phrase(s) again</button>` : ""}
        <button id="sh-again">${mode === "along" ? "↻ Speak along again" : "↻ Whole run again"}</button>
        <button id="sh-coach">💡 AI pronunciation &amp; delivery tips</button>
        <button id="sh-recall2">🧠 Now say it from memory</button>
        <button id="sh-nextq">Next question →</button>
      </div>
      <div id="sh-coachbox"></div></div>`;
    $("#sh-weak") && ($("#sh-weak").onclick = () => runShadow(weak));
    $("#sh-again").onclick = () => { SH.results = []; $("#sh-results").innerHTML = ""; mode === "along" ? runAlong() : runShadow(); };
    $("#sh-coach").onclick = coach;
    $("#sh-recall2").onclick = recall;
    $("#sh-nextq").onclick = nextQuestion;
    try {
      await postJSON("/api/shadow/progress", { set_id: SH.set.id, item_id: SH.item.id, score, mode, accent: $("#sh-accent").value, phrases: rs.length });
      SH.item.runs = (SH.item.runs || 0) + 1; SH.item.best = Math.max(SH.item.best || 0, score); renderList();
    } catch {}
  }

  async function coach() {
    const box = $("#sh-coachbox");
    box.innerHTML = '<p><span class="spinner"></span>Getting tips...</p>';
    const results = SH.results.filter(Boolean).map((r) => ({ target: r.target, heard: r.heard, score: r.score, missed: r.missed, said_differently: r.wrong, pace_vs_model: r.pace_ratio, hesitation_score: r.fluency, rhythm: r.rhythm }));
    try {
      const c = await postJSON("/api/shadow/coach", { accent: $("#sh-accent").value, results });
      box.innerHTML = `<div class="eval"><p>${esc(c.summary)}</p>
        ${(c.pronunciation || []).length ? `<h3>Pronunciation</h3><table><tr><th>Word</th><th>How to say it</th><th></th></tr>${c.pronunciation.map((p) => `<tr><td><b>${esc(p.word)}</b></td><td>${esc(p.tip)}</td><td><button data-say="${esc(p.word)}">🔊</button></td></tr>`).join("")}</table>` : ""}
        <h3>Fluency &amp; pace</h3>${list(c.fluency_and_pace)}
        <h3>Sound more natural</h3>${list(c.sound_more_natural)}
        <p><b>Next:</b> ${esc(c.next_step)}</p></div>`;
    } catch (e) { box.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
  }

  async function recall() {
    if (!SH.item || !SH.item.answer) return;
    try { await getMic(); } catch (e) { return setStatus("Microphone blocked: " + e.message, "speak"); }
    SH.recallMode = true; SH.running = true; toggleRunning(true);
    $("#sh-phrase").classList.add("hidden");
    setStatus("🔊 Question...", "listen");
    await speak(SH.item.question);
    if (!SH.running) return;
    setStatus("🧠 Answer from memory - pause 3 s or press Space when finished", "speak");
    $("#sh-progress").textContent = "Recall mode: no prompts";
    const r = await recordRepeat(240, 3500, 12);
    SH.recallMode = false;
    if (!SH.running) return;
    SH.running = false; toggleRunning(false);
    if (!r.heardSpeech) return setStatus("I didn't hear an answer.", "score");
    setStatus("⏳ Scoring...", "score");
    try {
      const res = await scoreRec(r, SH.item.answer, SH.item.answer.split(/\s+/).length / 2.4, -1, "from-memory");
      res.rhythm = r.rhythm;
      renderRow("recall", SH.item.answer, res, "From memory - how much of the model answer you reproduced");
      setStatus(`Recall: ${res.accuracy}% of the answer reproduced`, "");
      await postJSON("/api/shadow/progress", { set_id: SH.set.id, item_id: SH.item.id, score: res.score, mode: "recall", accent: $("#sh-accent").value });
    } catch (e) { setStatus("Scoring failed: " + e.message, "speak"); }
  }

  function nextQuestion() {
    const items = filtered(), i = items.findIndex((x) => x.id === SH.item.id);
    const nxt = items.slice(i + 1).find((x) => x.answer) || items.find((x) => x.answer);
    if (nxt) selectItem(nxt.id);
  }

  // ------------------------------------------------------------ download as WAV
  async function toWav(url, rate) {
      const buf = await (await fetch(url)).arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(buf);
      try { ctx.close(); } catch {}
      const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
      const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
      const pcm = (await off.startRendering()).getChannelData(0);
      const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
      const w = (o, str) => [...str].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
      w(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
      out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
      out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
      w(36, "data"); out.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
      return { blob: new Blob([out], { type: "audio/wav" }), seconds: decoded.duration };
  }
  window.downloadWav = async function (url, name, btn) {
    const old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }
    try {
      const { blob } = await toWav(url, 32000);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (name || "recording") + ".wav";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      // fall back to the original file
      const a = document.createElement("a"); a.href = url; a.download = (name || "recording") + ".webm";
      document.body.appendChild(a); a.click(); a.remove();
    } finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
  };

  // ------------------------------------------------------------ AI listens: delivery analysis
  const DELIV = (window.DELIV = window.DELIV || {});
  const blobToB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
  window.analyzeDelivery = async function (url, ctxInfo, btn, panel) {
    ctxInfo = ctxInfo || DELIV[url] || {};
    const old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "🎧 Listening..."; }
    if (panel) panel.innerHTML = '<p><span class="spinner"></span>The AI is listening to your recording (15-40 s)...</p>';
    try {
      const { blob, seconds } = await toWav(url, 16000);
      if (seconds > 300) throw new Error("Recording is longer than 5 minutes - too long to analyze.");
      const r = await postJSON("/api/analyze_delivery", { recording: url, wav_b64: await blobToB64(blob), seconds, ...ctxInfo });
      if (panel) panel.innerHTML = renderDelivery(r);
    } catch (e) {
      if (panel) panel.innerHTML = `<p class="msg err">${esc(e.message)}</p>`;
    } finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
  };
  function bar(label, v) {
    const n = Number(v) || 0;
    return `<span>${esc(label)}</span><div class="bar"><div style="width:${n * 10}%"></div></div><b>${esc(v ?? "-")}</b>`;
  }
  const ul = (a) => (a && a.length ? `<ul>${a.map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>` : "<p class='hint'>-</p>");
  function renderDelivery(d) {
    const sc = d.scores || {};
    const nat = Number(d.naturalness_score);
    return `<div class="eval deliv">
      <div class="row between"><h3 style="margin:0">🎧 How you sound to a listener</h3>
        <span><span class="score ${scls(nat * 10)}" style="font-size:26px">${esc(d.naturalness_score ?? "-")}</span><span class="hint">/10 natural</span></span></div>
      <p><span class="pill">${esc(d.sounds_like || "")}</span> ${d.would_interviewer_notice ? `<b>Would an interviewer notice it's rehearsed?</b> ${esc(d.would_interviewer_notice)}` : ""}</p>
      <p>${esc(d.listener_impression || "")}</p>
      <div class="bars">${Object.entries(sc).map(([k, v]) => bar(k.replace(/_/g, " "), v)).join("")}</div>
      ${(d.timeline || []).length ? `<h3>Part by part</h3><table><tr><th>When</th><th>What a listener hears</th><th></th><th>Fix</th></tr>${d.timeline.map((t) => `<tr><td>${esc(t.time)}</td><td>${esc(t.what_happens)}</td><td>${t.rating === "good" ? "✅" : t.rating === "ok" ? "🟡" : "🔴"}</td><td>${esc(t.fix || "")}</td></tr>`).join("")}</table>` : ""}
      <div class="grid2"><div><h3>✅ What works</h3>${ul(d.strengths)}</div><div><h3>🎯 Top fixes</h3>${ul(d.top_fixes)}</div></div>
      <h3>⏸ Pauses, punctuation &amp; phrasing</h3>${ul(d.pauses_and_phrasing)}
      <h3>🎵 Tone &amp; intonation</h3>${ul(d.tone_and_intonation)}
      ${(d.pronunciation || []).length ? `<h3>🗣 Pronunciation</h3><table><tr><th>Word</th><th>What it sounded like</th><th>How to say it</th><th></th></tr>${d.pronunciation.map((p) => `<tr><td><b>${esc(p.word)}</b></td><td>${esc(p.issue)}</td><td>${esc(p.how_to_say)}</td><td><button data-say="${esc(p.word)}">🔊</button></td></tr>`).join("")}</table>` : ""}
      <h3>🏋 Practice plan</h3>${ul(d.practice_plan)}
      <p class="hint">Analyzed by ${esc(d.model || "AI")}${d.cached ? " (saved result)" : ""}.</p>
    </div>`;
  }

  // ------------------------------------------------------------ UI bindings
  function bindUI() {
    $("#sh-set").onchange = () => loadSet($("#sh-set").value);
    ["#sh-topic", "#sh-high", "#sh-ready"].forEach((s) => ($(s).onchange = renderList));
    $("#sh-search").oninput = renderList;
    $("#sh-list").onclick = (e) => { const el = e.target.closest(".sh-item"); if (el) selectItem(+el.dataset.id); };
    $("#sh-start").onclick = () => { SH.results = []; $("#sh-results").innerHTML = ""; runAlong(); };
    $("#sh-phrases").onclick = () => { SH.results = []; $("#sh-results").innerHTML = ""; runShadow(); };
    $("#sh-stop").onclick = stopRun;
    $("#sh-done").onclick = () => SH.doneResolve && SH.doneResolve();
    $("#sh-next").onclick = () => { if (SH.nextResolve) { SH.nextResolve(); SH.nextResolve = null; } };
    $("#sh-hearq").onclick = () => speak(SH.item.question);
    $("#sh-listen").onclick = async () => {
      if (SH.running) return;
      setStatus("🎧 Listening to the full answer...", "listen"); showPhrase(SH.item.answer);
      await speakNatural(SH.item.answer, (t) => showPhrase(t)); setStatus("Ready", "");
    };
    $("#sh-recall").onclick = recall;
    $("#sh-edit").onclick = () => { $("#sh-edittext").value = SH.item.answer || ""; $("#sh-editbox").classList.remove("hidden"); };
    $("#sh-editcancel").onclick = () => $("#sh-editbox").classList.add("hidden");
    $("#sh-editsave").onclick = async () => {
      const r = await postJSON(`/api/shadow/sets/${SH.set.id}/items/${SH.item.id}`, { answer: $("#sh-edittext").value });
      SH.item.answer = $("#sh-edittext").value.trim(); SH.item.phrases = r.phrases;
      selectItem(SH.item.id); renderList();
    };
    $("#sh-generate").onclick = async () => {
      if (SH.item.answer && !confirm("Replace the current answer with a new AI-generated one?")) return;
      setStatus("✨ Writing an answer from your resume...", "score");
      try {
        const r = await postJSON(`/api/shadow/sets/${SH.set.id}/items/${SH.item.id}/generate`, {});
        SH.item.answer = r.answer; SH.item.phrases = r.phrases; selectItem(SH.item.id); renderList();
      } catch (e) { setStatus("Failed: " + e.message, "speak"); }
    };
    $("#sh-gen-all").onclick = async () => {
      if ($("#sh-gen-all").dataset.busy) { SH.genStop = true; return; }
      const todo = filtered().filter((i) => !i.answer);
      if (!todo.length || !confirm(`Generate ${todo.length} answers from your resume with the AI model? (roughly $0.001-0.02 each depending on model)`)) return;
      SH.genStop = false; $("#sh-gen-all").dataset.busy = "1"; $("#sh-gen-all").textContent = "■ Stop generating";
      let n = 0;
      for (const it of todo) {
        if (SH.genStop) break;
        msg($("#sh-gen-msg"), `Generating ${++n}/${todo.length}...`);
        try {
          const r = await postJSON(`/api/shadow/sets/${SH.set.id}/items/${it.id}/generate`, {});
          it.answer = r.answer; it.phrases = r.phrases;
        } catch (e) { msg($("#sh-gen-msg"), "Stopped: " + e.message, "err"); break; }
      }
      delete $("#sh-gen-all").dataset.busy;
      if (!SH.genStop) msg($("#sh-gen-msg"), `Done (${n}).`, "ok");
      renderList();
      if (SH.item) selectItem(SH.item.id, true);
    };
    $("#sh-new-btn").onclick = () => $("#sh-new").classList.toggle("hidden");
    $("#sh-new-create").onclick = async () => {
      const fd = new FormData();
      fd.append("name", $("#sh-new-name").value || "Shadow set");
      if ($("#sh-new-qfile").files[0]) fd.append("questions_file", $("#sh-new-qfile").files[0]);
      fd.append("questions_text", $("#sh-new-qtext").value);
      if ($("#sh-new-resume").files[0]) fd.append("resume_file", $("#sh-new-resume").files[0]);
      fd.append("job_description", $("#sh-new-jd").value);
      msg($("#sh-new-msg"), "Creating...");
      try {
        const r = await api("/api/shadow/sets", { method: "POST", body: fd });
        setPref("set", r.id); $("#sh-set").value = "";
        await loadSetList(); $("#sh-set").value = r.id; await loadSet(r.id);
        msg($("#sh-new-msg"), "Created. Now click “Generate missing answers”.", "ok");
      } catch (e) { msg($("#sh-new-msg"), e.message, "err"); }
    };
    $("#sh-set-delete").onclick = async () => {
      if (!$("#sh-set").value || !confirm("Delete this shadow set and its progress?")) return;
      await api("/api/shadow/sets/" + encodeURIComponent($("#sh-set").value), { method: "DELETE" });
      SH.set = null; SH.item = null; $("#sh-main").classList.add("hidden"); $("#sh-empty").classList.remove("hidden");
      $("#sh-set").value = ""; setPref("set", ""); loadSetList();
    };
    // play buttons inside results / summary / coach
    document.getElementById("view-shadow").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.say) { if (!SH.running) speak(b.dataset.say); }
      if (b.dataset.play) { stopAudio(); const a = new Audio(b.dataset.play); SH.audio = a; a.play(); }
      if (b.dataset.dl) downloadWav(b.dataset.dl, b.dataset.dlname, b);
      if (b.dataset.analyze) {
        const row = b.closest(".sh-row"), panel = row && row.nextElementSibling;
        analyzeDelivery(b.dataset.analyze, null, b, panel && panel.classList.contains("sh-analysis") ? panel : null);
      }
    });
    document.addEventListener("keydown", (e) => {
      if ($("#view-shadow").classList.contains("hidden")) return;
      if (e.target.matches("input, textarea, select")) return;
      if (e.code === "Space" && SH.doneResolve) { e.preventDefault(); SH.doneResolve(); }
      if (e.code === "Escape" && (SH.running || SH.recallMode)) stopRun();
    });
  }
})();
