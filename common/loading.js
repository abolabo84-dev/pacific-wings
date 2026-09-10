// ⏳ Yu's Games 共通の「よみこみ中」画面（パパ 9/10）。
//   「太平洋の翼は始まる前にローディングのバー演出がでて、その間に曲をDLする形にするってのは
//     どうかな？ 最初のローディング演出がついてれば割とそんなもんかと納得されるきもする」
//   → 3本のゲームで **同じ見た目** にする（直す場所を1つにするため このファイルに集める）。
//
// つかいかた（各ゲームの <script type="importmap"> より前に1行）:
//   <script src="../common/loading.js" data-title="太平洋の翼" data-sub="🎵 曲を よみこみ中…"></script>
//   ゲーム側:
//     const r = await YuLoad.fetchAll([{ name:'title', url:'../music/title.mp3' }, ...], { budgetSec: 12 });
//       → { ok:{name: blobURL}, ng:[name], bytes, ms, cut }   ※ 時間切れで打ち切ると cut=true
//     await YuLoad.done({ startLabel: '▶ はじめる' });   // おすまで待つ（曲の解禁に使う ひとさわり）
//     await YuLoad.done();                               // 何も落とさないゲーム＝minMs たったら 勝手に閉じる
//
// ⚠ これは クラシックスクリプト（type="module" ではない）。module は HTML を読み終わるまで走らないので、
//   ここで先に画面を出しておく＝開いた瞬間から「よみこみ中」が見える。
// ⚠ 数字は **実バイト**（Content-Length と 受けとった量）。落とすものが無いゲームでは % を出さない
//   （無いものを「何%」とは言わない）。
// ⚠ 落とせなくても ゲームは始める。曲は今までどおり 鳴らす時に取りにいく（悪くはならない）。
(function () {
  'use strict';
  const me = document.currentScript;
  const D = (me && me.dataset) || {};
  const Q = new URLSearchParams(location.search);
  const NOLOAD = Q.get('noload') === '1';          // 測定や開発で 画面を出したくない時
  const MIN_MS = +(D.minMs || 800);                 // 一瞬で消えると「切りかわり」に見えない
  const TIMEOUT_S = +(D.timeout || 25);             // module が いつまでも来ない（CDNが死んでいる等）

  const css = `
#yuLoad { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 30%, #163a5a, #070d14 75%); color: #eceff1;
  font-family: "Hiragino Maru Gothic ProN", "Yu Gothic", Meiryo, sans-serif; -webkit-user-select: none; user-select: none;
  transition: opacity .35s; }
#yuLoad.off { opacity: 0; pointer-events: none; }
#yuLoadBox { width: min(86vw, 420px); text-align: center; }
#yuLoadTitle { font-size: clamp(26px, 7vw, 40px); font-weight: bold; letter-spacing: .06em; margin-bottom: 6px;
  background: linear-gradient(90deg, #ffd54f, #4fc3f7, #81c784); -webkit-background-clip: text; background-clip: text; color: transparent; }
#yuLoadSub { font-size: clamp(13px, 3.6vw, 16px); color: #b0bec5; min-height: 1.4em; margin-bottom: 14px; }
#yuLoadBar { height: 16px; border: 2px solid #fff; border-radius: 9px; background: rgba(0,0,0,.5); overflow: hidden; position: relative; }
#yuLoadFill { height: 100%; width: 0%; background: linear-gradient(90deg, #4fc3f7, #81c784); transition: width .15s; }
#yuLoadFill.sweep { width: 35%; animation: yuSweep 1.1s ease-in-out infinite; }
@keyframes yuSweep { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
#yuLoadPct { font-size: clamp(12px, 3.2vw, 14px); color: #90a4ae; margin-top: 8px; min-height: 1.3em; font-variant-numeric: tabular-nums; }
/* ⚠ hidden 属性は UAの display:none だが、下の display:block（作者のCSS）に負けて **最初から見えていた**
   （スクショで発見。probe は属性しか見ていなかった）。作者側でも hidden を効かせる */
#yuLoad [hidden] { display: none !important; }
#yuLoadStart { display: block; margin: 18px auto 0; font-family: inherit; font-size: clamp(19px, 5vw, 26px); font-weight: bold;
  color: #fff; background: #e65100; border: 3px solid #fff; border-radius: 14px; padding: 12px 34px; cursor: pointer; }
#yuLoadStart:active { transform: scale(.96); }
#yuLoadSkip { display: block; margin: 16px auto 0; font-family: inherit; font-size: 13px; color: #90a4ae; background: none;
  border: 1px solid #546e7a; border-radius: 8px; padding: 6px 14px; cursor: pointer; }
#yuLoadMsg { margin-top: 12px; font-size: clamp(12px, 3.2vw, 14px); color: #ffab91; line-height: 1.6; }
#yuLoadTip { position: absolute; bottom: 14px; left: 0; right: 0; text-align: center; font-size: 11px; color: #546e7a; }
`;
  const el = {};
  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'yuLoad';
    root.innerHTML =
      '<div id="yuLoadBox">' +
        '<div id="yuLoadTitle"></div><div id="yuLoadSub"></div>' +
        '<div id="yuLoadBar"><div id="yuLoadFill" class="sweep"></div></div>' +
        '<div id="yuLoadPct"></div>' +
        '<button id="yuLoadStart" hidden>▶ はじめる</button>' +
        '<button id="yuLoadSkip" hidden>とばす ▸</button>' +
        '<div id="yuLoadMsg"></div>' +
      '</div><div id="yuLoadTip">Yu&#39;s Games</div>';
    // ⚠ <body> が まだ無いうちに走ることがある（head に置かれた時）。あれば body、無ければ html に付ける
    (document.body || document.documentElement).appendChild(root);
    for (const id of ['yuLoad', 'yuLoadTitle', 'yuLoadSub', 'yuLoadBar', 'yuLoadFill', 'yuLoadPct', 'yuLoadStart', 'yuLoadSkip', 'yuLoadMsg'])
      el[id] = document.getElementById(id);
    el.yuLoadTitle.textContent = D.title || document.title || '';
    el.yuLoadSub.textContent = D.sub || 'よみこみ中…';
  }

  const t0 = performance.now();
  const state = { shown: false, closed: false, skipAsked: false, aborter: null, log: [], timeoutTimer: 0 };
  const fmtMB = b => (b / 1048576).toFixed(1) + 'MB';

  function setProgress(frac, text) {
    if (!state.shown) return;
    el.yuLoadFill.classList.remove('sweep');
    el.yuLoadFill.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
    if (text != null) el.yuLoadPct.textContent = text;
  }

  // 落とす。⚠ 順番どおり（大事なものから）。budgetSec を過ぎたら いま落としている1本を切って 先へ進む
  async function fetchAll(items, opt) {
    opt = opt || {};
    const budgetMs = (+(Q.get('loadbudget') || opt.budgetSec || 12)) * 1000;   // ?loadbudget=3 で測定用に短くできる
    const ok = {}, ng = []; let bytes = 0, cut = false;
    const tStart = performance.now();
    if (NOLOAD || !items || !items.length) return { ok, ng: (items || []).map(i => i.name), bytes: 0, ms: 0, cut: false };
    if (state.shown) el.yuLoadSkip.hidden = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const remain = budgetMs - (performance.now() - tStart);
      if (remain <= 0 || state.skipAsked) { cut = true; ng.push(it.name); continue; }
      const ctrl = new AbortController(); state.aborter = ctrl;
      const timer = setTimeout(() => ctrl.abort(), remain);
      let got = 0, total = 0;
      try {
        const res = await fetch(it.url, { signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        total = +(res.headers.get('content-length') || 0);
        const reader = res.body.getReader(); const chunks = [];
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          chunks.push(r.value); got += r.value.length;
          setProgress((i + (total ? got / total : 0)) / items.length,
            i + '/' + items.length + '本（' + fmtMB(bytes + got) + '）');
        }
        const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
        ok[it.name] = URL.createObjectURL(blob);
        bytes += got;
        state.log.push({ name: it.name, bytes: got, total, ms: Math.round(performance.now() - tStart), ok: true });
        setProgress((i + 1) / items.length, (i + 1) + '/' + items.length + '本（' + fmtMB(bytes) + '）');
      } catch (e) {
        ng.push(it.name);
        if (ctrl.signal.aborted) cut = true;
        state.log.push({ name: it.name, bytes: got, total, ms: Math.round(performance.now() - tStart), ok: false,
                         why: ctrl.signal.aborted ? 'cut' : String((e && e.message) || e) });
      } finally { clearTimeout(timer); state.aborter = null; }
    }
    if (state.shown) el.yuLoadSkip.hidden = true;
    return { ok, ng, bytes, ms: Math.round(performance.now() - tStart), cut };
  }

  function close() {
    if (state.closed) return; state.closed = true;
    clearTimeout(state.timeoutTimer);
    if (!state.shown) return;
    el.yuLoad.classList.add('off');
    setTimeout(() => { if (el.yuLoad && el.yuLoad.parentNode) el.yuLoad.parentNode.removeChild(el.yuLoad); }, 400);
  }

  // 終わり。startLabel を渡すと「おすまで待つ」（曲の解禁に要る ひとさわり）。渡さなければ minMs たったら閉じる
  function done(opt) {
    opt = opt || {};
    clearTimeout(state.timeoutTimer);
    return new Promise(resolve => {
      const finish = () => { close(); resolve(); };
      if (NOLOAD || !state.shown) return finish();
      const wait = Math.max(0, MIN_MS - (performance.now() - t0));
      setTimeout(() => {
        if (opt.startLabel) {
          setProgress(1, opt.text != null ? opt.text : el.yuLoadPct.textContent);
          el.yuLoadSub.textContent = opt.sub || 'じゅんび できた！';
          el.yuLoadStart.textContent = opt.startLabel;
          el.yuLoadStart.hidden = false;
          el.yuLoadStart.addEventListener('click', finish, { once: true });
        } else { setProgress(1); finish(); }
      }, wait);
    });
  }

  function fail(msg) {
    if (!state.shown) return;
    el.yuLoadFill.classList.remove('sweep');
    el.yuLoadMsg.innerHTML = '⚠ ' + msg + '<br><button id="yuLoadRetry" style="margin-top:8px;font-family:inherit;font-size:14px;' +
      'padding:8px 16px;border-radius:8px;border:2px solid #fff;background:#37474f;color:#fff">🔄 もういちど</button>';
    document.getElementById('yuLoadRetry').onclick = () => location.reload();
  }

  function show() {
    if (NOLOAD || state.shown) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', show, { once: true }); return; }
    build(); state.shown = true;
    el.yuLoadSkip.addEventListener('click', () => { state.skipAsked = true; if (state.aborter) state.aborter.abort(); });
    // ⚠ ゲーム側が いつまでも done() を呼ばない＝module が来ていない（CDN や 回線）。だまって固まらず 言う
    state.timeoutTimer = setTimeout(() => { if (!state.closed) fail('よみこみが おわらない。電波のいい所で もういちど ひらいてね'); }, TIMEOUT_S * 1000);
  }

  window.YuLoad = { show, fetchAll, done, fail, close, setProgress,
                    get log() { return state.log; }, get shown() { return state.shown; } };
  show();
})();
