// 👥 みんなでルーム（全部の ゲームで 使う 部品）— 監督 11/5「今まで作ってきたゲームも新しくつくるすべてのゲームにみんなでルームを作りたい」／パパ 11/23「全部のゲームがマルチプレイ対応 優先的に実装しよう」
// 中身は 太平洋の翼 v6 の「GAS中継所」の 写し（v6-1029a の gasJoinRoom）。v6 は 書きかえていない（5本の テストが 通っている 形を こわさない）
// ponytail: v6 は まだ 自分の 写しを 使う, v6 を さわる 用事が できた ときに この 部品へ 乗りかえる
//
// しくみ：みんなが 数秒ごとに GAS（ログ置き場）の「いる人リスト」を 見に行き、自分あての 手紙（WebRTC の offer/answer/ice）を 受け取る。
//   手紙の やり取りが 終われば、あとは WebRTC で 直接 つながる（ゲームの データは GAS を 通らない）
// v6 で 踏んだ 穴（10/24・10/25 のログで 見つけた）を 最初から ふさぐ：
//   ① ひとりの 間も 同じ 中継所に いる（だまって ほかへ 移ると、あとから 来た 人と 一生 会えない）→ GAS だけ
//   ② 「はいる」の 押し直し・連打で 切れない → 同じ あいことばで 入って いる 間は 何も しない
//   ③ 人数は「つながって いる 数」で 数える（位置が 届いた 数では ない）
//   ④ ID は 開くたびに 作る（同じ PC の 2画面が 同じ ID に ならない）・ID の 小さい ほうから 声を かける（道が 2本 できない）
// ⚠ 部屋の 名前に ゲームの 名前を つける（'edo-r' + あいことば）＝ 同じ あいことばでも ゲームが ちがえば 別の 部屋（v6 は 'r' + あいことば のまま）
//   本物の GAS が この 形の 名前を 受けることは 11/23 に 確かめた（peers が 返った）
// ⚠ 別の 家どうし（別の 回線）で つながるかは この部品では まだ 確かめていない（STUN だけ。?turn= で 中継サーバーを 足せる＝v6 と 同じ）
// ponytail: GAS だけ（公開の 中継所 mqtt/nostr/torrent へは 移らない）, GAS が 落ちた ログ（net_gas_err）が 本番で 続いたら v6 の 順ぐりを 写す
(function () {
  'use strict';
  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const TURN_Q = new URLSearchParams(location.search).get('turn');
  const ICE = TURN_Q ? (() => { const [urls, username, credential] = TURN_Q.split('|'); return { iceServers: [...STUN, { urls, username, credential }] }; })() : { iceServers: STUN };

  // opt: { game:'edo', url, key, max:10, log(type,data) }
  function create(opt) {
    const log = opt.log || (() => {}), MAX = opt.max || 10;
    const net = { me: 'g' + Math.random().toString(36).slice(2, 10), word: '', on: false, err: '', status: '', conns: {}, acts: {}, joinFns: [], leaveFns: [], stop: true, gen: 0 };
    const call = body => fetch(opt.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ key: opt.key, sig: 1 }, body)) })
      .then(r => { if (!r.ok) throw new Error('GAS HTTP ' + r.status); return r.json(); });
    const room = () => opt.game + '-r' + net.word;
    const setStatus = s => { net.status = s; if (net.onStatus) net.onStatus(s); };
    // 監督ルール（9/6）「ネットで同時プレイは最大10人」。みんなが 同じ ならべ方（ID の 順）で 切る＝どの 画面でも 同じ 10人（v6 netSeatOk と 同じ）
    net.seatOk = id => [net.me, ...Object.keys(net.conns).filter(k => net.conns[k].open)].sort().slice(0, MAX).includes(id);
    net.count = () => Object.keys(net.conns).filter(k => net.conns[k].open && net.seatOk(k)).length;   // ③ つながって いる 数（じぶんは 入れない）
    net.isHost = () => [net.me, ...Object.keys(net.conns).filter(k => net.conns[k].open && net.seatOk(k))].sort()[0] === net.me;   // あずかり役＝ID が いちばん 小さい 人
    net.on_ = (kind, fn) => { net.acts[kind] = fn; };
    net.onJoin = fn => net.joinFns.push(fn); net.onLeave = fn => net.leaveFns.push(fn);
    net.send = (kind, d) => { if (!net.on) return; const msg = JSON.stringify({ a: kind, d });
      for (const id in net.conns) { const c = net.conns[id]; if (c.dc && c.dc.readyState === 'open' && net.seatOk(id)) { try { c.dc.send(msg); } catch (e) {} } } };
    function drop(id) { const c = net.conns[id]; if (!c) return; delete net.conns[id]; try { c.pc.close(); } catch (e) {} if (c.open) { log('net_peer_leave', { id }); net.leaveFns.forEach(f => f(id)); } }
    function conn(id, initiator) {
      if (net.conns[id]) return net.conns[id];
      const gen = net.gen, c = { pc: new RTCPeerConnection(ICE), dc: null, open: false, pend: [] }; net.conns[id] = c;
      c.pc.onicecandidate = e => { if (e.candidate && gen === net.gen) call({ action: 'send', room: room(), me: net.me, to: id, m: { t: 'ice', c: e.candidate } }).catch(() => {}); };
      c.pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(c.pc.connectionState) && net.conns[id] === c) drop(id); };   // 切れたら 消す＝つぎの 見回りで 道を 作り直す
      const wire = dc => { c.dc = dc;
        dc.onopen = () => { c.open = true; log('net_peer_join', { id, n: net.count() }); net.joinFns.forEach(f => f(id)); };
        dc.onclose = () => { if (net.conns[id] === c) drop(id); };
        dc.onmessage = ev => { if (!net.seatOk(id)) return; let p; try { p = JSON.parse(ev.data); } catch (e) { return; } const h = p && net.acts[p.a]; if (h) { try { h(p.d, id); } catch (e) { log('net_bad', { a: String(p.a).slice(0, 8), msg: String(e).slice(0, 80) }); } } };
      };
      if (initiator) { wire(c.pc.createDataChannel('game'));
        c.pc.createOffer().then(o => c.pc.setLocalDescription(o)).then(() => call({ action: 'send', room: room(), me: net.me, to: id, m: { t: 'offer', s: c.pc.localDescription } })).catch(() => {}); }
      else c.pc.ondatachannel = e => wire(e.channel);
      return c;
    }
    async function onMsg(from, m) {
      if (!m || typeof m !== 'object') return;
      const c = conn(from, false), flush = async () => { for (const i of c.pend.splice(0)) await c.pc.addIceCandidate(i).catch(() => {}); };
      if (m.t === 'offer') { await c.pc.setRemoteDescription(m.s); await c.pc.setLocalDescription(await c.pc.createAnswer());
        await call({ action: 'send', room: room(), me: net.me, to: from, m: { t: 'answer', s: c.pc.localDescription } }); await flush(); }
      else if (m.t === 'answer') { await c.pc.setRemoteDescription(m.s); await flush(); }
      else if (m.t === 'ice') { if (c.pc.remoteDescription) await c.pc.addIceCandidate(m.c).catch(() => {}); else c.pend.push(m.c); }   // 手紙の 順番が 入れかわる ことが ある
    }
    async function loop(gen) {
      if (net.stop || gen !== net.gen) return;
      let wait = 3000;
      try {
        const j = await call({ action: 'poll', room: room(), me: net.me });
        if (gen !== net.gen) return;
        if (!j || !Array.isArray(j.peers)) throw new Error('GAS の 返事に peers が ない');
        if (net.err) { net.err = ''; }
        for (const id of j.peers) if (typeof id === 'string' && id !== net.me && !net.conns[id] && net.me < id) conn(id, true);   // ④ ID の 小さい ほうから
        for (const it of (j.msgs || [])) await onMsg(it.from, it.m).catch(() => {});
        const ids = Object.keys(net.conns), allOpen = ids.length > 0 && ids.every(k => net.conns[k].open);
        wait = allOpen ? 6000 : ids.length ? 1500 : 3000;   // ponytail: ひとりの 間は 3秒ごと（GAS の 1日の 枠を 食わない）, 本番で 会うまでが 遅いと 言われたら 縮める
        setStatus(net.count() ? `👥 ${net.count() + 1}人で あそんでいる（あいことば ${net.word}）` : `👥 あいことば ${net.word} の 部屋で まっている…`);
      } catch (e) {
        const msg = String((e && e.message) || e); if (msg !== net.err) log('net_gas_err', { msg: msg.slice(0, 120) });
        net.err = msg; wait = 4000; setStatus('⚠ つなぐ 所に とどかない。まって もう一度 ためす…');
      }
      setTimeout(() => loop(gen), wait);
    }
    net.join = word => {
      word = String(word || '').trim();
      if (!/^\d{1,8}$/.test(word)) { setStatus('あいことばは 数字だけ／1〜8けたで 打ってね'); return false; }
      if (net.on && net.word === word) return true;   // ② 同じ あいことばの 押し直し・連打は 何も しない
      net.leave(true); net.gen++; net.word = word; net.on = true; net.stop = false;
      log('net_join', { word, me: net.me, game: opt.game }); setStatus('つないでいます…（すこし まってね）');
      loop(net.gen); return true;
    };
    net.leave = quiet => { if (!net.on) return; net.stop = true; net.gen++; for (const id of Object.keys(net.conns)) drop(id); net.on = false; if (!quiet) { log('net_leave', { word: net.word }); setStatus(''); } net.word = ''; };
    return net;
  }
  window.YuNet = { create };
})();
