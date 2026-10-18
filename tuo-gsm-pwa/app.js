/* TUO GSM - interfaccia. Dati solo in localStorage del telefono; nessuna richiesta di rete. */
(function () {
  'use strict';

  var L = window.TuoLib;
  if (!L) { document.body.textContent = 'Errore: lib.js non caricato'; return; }

  var APP_VERSION = '1.0.0';
  var KEYS = { settings: 'tuo.settings', state: 'tuo.state', log: 'tuo.log', pending: 'tuo.pending' };
  var MAX_LOG = 40;
  var STALE_MS = 6 * 3600 * 1000;
  var PENDING_MAX_MS = 6 * 3600 * 1000;

  /* ---------- storage (con fallback in memoria se localStorage non e' disponibile) ---------- */
  var mem = {};
  var store = {
    get: function (k, def) {
      try {
        var v = window.localStorage.getItem(k);
        if (v == null) return k in mem ? mem[k] : def;
        return JSON.parse(v);
      } catch (e) { return k in mem ? mem[k] : def; }
    },
    set: function (k, v) {
      mem[k] = v;
      try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignora */ }
    },
    remove: function (k) {
      delete mem[k];
      try { window.localStorage.removeItem(k); } catch (e) { /* ignora */ }
    }
  };

  var settings = store.get(KEYS.settings, null) || { number: '', password: '', usePwd: false };
  var state = store.get(KEYS.state, null) || L.emptyState();
  var logs = store.get(KEYS.log, null) || [];
  var pending = store.get(KEYS.pending, null);
  var dirty = {};

  /* ---------- helper DOM ---------- */
  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDateTime(ms) {
    var d = new Date(ms);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || Math.min(7000, 2200 + msg.length * 45));
  }

  /* ---------- persistenza ---------- */
  function saveState() { store.set(KEYS.state, state); }
  function saveLogs() { store.set(KEYS.log, logs); }
  function addLog(dir, text, note) {
    logs.unshift({ t: Date.now(), dir: dir, text: text, note: note || '' });
    if (logs.length > MAX_LOG) logs.length = MAX_LOG;
    saveLogs();
    renderLog();
  }

  /* ---------- rendering ---------- */
  var MODE_LABEL = { auto: 'AUTOMATICO', manual: 'MANUALE', off: 'SPENTO' };
  var SEASON_LABEL = { heat: 'Riscaldamento', cool: 'Condizionamento' };
  var FIELD_LABEL = {
    temp: 'temperatura', rh: 'umidità', mode: 'funzionamento', season: 'stagione', tm: 'Tm', t0: 'antigelo',
    t1: 'T1', t2: 'T2', t3: 'T3', relay: 'stato impianto', power: 'alimentazione', gsm: 'segnale GSM',
    nsim: 'numero SIM', deviceTime: 'ora del termostato', counterHours: 'contaore'
  };

  function dataAgeMs() {
    var f = state.fields, now = Date.now();
    var dt = f.deviceTime ? L.deviceTimeMs(f.deviceTime) : null;
    if (dt != null) return now - dt;
    if (state.ts && state.ts.temp) return now - state.ts.temp;
    return null;
  }

  function renderStatus() {
    var f = state.fields;
    var has = f.temp != null || f.mode || f.relay != null || f.power != null;
    $('emptyState').hidden = !!has;
    $('statusBody').hidden = !has;

    var age = dataAgeMs();
    $('freshness').textContent = age == null ? 'Nessun dato ancora' : 'Dati di ' + L.ago(age);

    if (!has) return;

    $('tInt').textContent = L.isNum(f.temp) ? L.fmt(f.temp) : '--.-';
    $('vRh').textContent = L.isNum(f.rh) ? L.fmt(f.rh) + ' %' : '--';

    var chip = $('chipRelay'), vr = $('vRelay');
    chip.className = 'chip relay';
    if (f.relay === true) {
      chip.className += ' on' + (f.season === 'cool' ? ' cool' : '');
      vr.textContent = f.season === 'cool' ? 'Condizionatore acceso' : (f.season === 'heat' ? 'Riscaldamento acceso' : 'Impianto acceso');
    } else if (f.relay === false) vr.textContent = 'Impianto spento';
    else vr.textContent = 'Impianto: --';

    var bm = $('badgeMode');
    bm.textContent = MODE_LABEL[f.mode] || '--';
    bm.className = 'badge' + (f.mode ? ' m-' + f.mode : '');
    $('badgeSeason').textContent = SEASON_LABEL[f.season] || '--';

    var sp = '--';
    if (f.mode === 'manual') sp = L.isNum(f.tm) ? L.fmt(f.tm) + ' °C (Tm)' : 'Tm non nota';
    else if (f.mode === 'auto') sp = 'dal programma orario';
    else if (f.mode === 'off') {
      if (f.season === 'cool') sp = 'nessuna regolazione';
      else if (f.t0Off) sp = 'antigelo disattivato';
      else sp = L.isNum(f.t0) ? L.fmt(f.t0) + ' °C (antigelo)' : 'solo antigelo';
    }
    $('vSetpoint').textContent = sp;

    $('vPower').textContent = f.power === true ? 'presente' : (f.power === false ? 'ASSENTE' : '--');
    $('powerWarn').hidden = f.power !== false;

    var g = f.gsm, bars = g >= 75 ? 4 : g >= 50 ? 3 : g >= 25 ? 2 : g > 0 ? 1 : 0;
    $('gsmBars').className = 'bars b' + (L.isNum(g) ? bars : 0);
    $('vGsm').textContent = L.isNum(g) ? g + ' %' : '--';

    $('vSim').textContent = f.nsim || '--';

    var dt = f.deviceTime ? L.deviceTimeMs(f.deviceTime) : null;
    $('vDevTime').textContent = dt != null ? fmtDateTime(dt) : '--';

    var warn = $('staleWarn');
    if (age != null && age > STALE_MS) {
      warn.hidden = false;
      warn.textContent = 'Questi dati risalgono a ' + L.ago(age) + ' e potrebbero non essere attuali. Premi Aggiorna per chiedere lo stato.';
    } else warn.hidden = true;

    var keys = Object.keys(state.extra || {}), box = $('extraBox'), ul = $('extraList');
    ul.textContent = '';
    box.hidden = keys.length === 0;
    keys.forEach(function (k) { ul.appendChild(el('li', null, k + ' = ' + state.extra[k])); });

    qsa('[data-mode]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === f.mode); });
    qsa('[data-season]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-season') === f.season); });
  }

  function renderTemps() {
    ['tm', 't0', 't1', 't2', 't3'].forEach(function (k) {
      var input = $('in-' + k), known = $('known-' + k), f = state.fields, v = f[k];
      if (!dirty[k]) input.value = L.isNum(v) ? L.fmt(v) : '';
      if (k === 't0' && f.t0Off) known.textContent = 'attualmente disattivato';
      else if (L.isNum(v)) known.textContent = 'noto: ' + L.fmt(v) + ' °C' + (state.ts[k] ? ' · ' + L.ago(Date.now() - state.ts[k]) : '');
      else known.textContent = 'valore non noto';
    });
    refreshSend();
  }

  function refreshSend() {
    var has = function (k) { return dirty[k] && $('in-' + k).value !== ''; };
    $('send-tm').disabled = !has('tm');
    $('send-t0').disabled = !has('t0');
    $('send-t123').disabled = !(has('t1') || has('t2') || has('t3'));
    ['tm', 't0', 't1', 't2', 't3'].forEach(function (k) {
      var row = document.querySelector('.trow[data-key="' + k + '"]');
      if (row) row.classList.toggle('dirty', !!dirty[k]);
    });
  }

  function renderRubrica() {
    var ul = $('rubricaList');
    ul.textContent = '';
    for (var i = 1; i <= L.LIMITS.slots; i++) {
      var li = el('li');
      li.appendChild(el('span', null, 'Posizione ' + i));
      var v = state.rubrica ? state.rubrica[i] : undefined;
      li.appendChild(el('span', 'num', state.rubrica ? (v ? v : 'vuota') : 'sconosciuta'));
      ul.appendChild(li);
    }
    if (!state.rubrica) {
      var tip = el('li'); tip.appendChild(el('span', 'muted small-text', 'Premi “Leggi rubrica” per scaricarla.'));
      ul.appendChild(tip);
    }
  }

  function renderCounter() {
    var h = state.fields.counterHours;
    $('counterVal').textContent = L.isNum(h) ? 'Ore di funzionamento: ' + h + ' h' : 'Ore di funzionamento: non ancora lette.';
  }

  function renderLog() {
    var ul = $('logList');
    ul.textContent = '';
    if (!logs.length) { ul.appendChild(el('li', 'muted', 'Nessun messaggio.')); return; }
    logs.forEach(function (e) {
      var li = el('li');
      var meta = el('span', 'meta');
      meta.appendChild(el('span', e.dir === 'out' ? 'dir-out' : 'dir-in', e.dir === 'out' ? 'SMS preparato' : 'Risposta'));
      meta.appendChild(document.createTextNode(' · ' + fmtDateTime(e.t) + (e.note ? ' · ' + e.note : '')));
      li.appendChild(meta);
      li.appendChild(el('code', null, e.text));
      ul.appendChild(li);
    });
  }

  function renderPending() {
    var box = $('pending');
    if (!pending || Date.now() - pending.t > PENDING_MAX_MS) { box.hidden = true; return; }
    box.hidden = false;
    $('pendingText').textContent = 'Hai inviato «' + pending.text + '»? Quando il termostato risponde, copia il messaggio ricevuto e incollalo qui.';
  }

  function renderSettings() {
    $('setNumber').value = settings.number || '';
    $('setPwd').value = settings.password || '';
    $('setUsePwd').checked = !!settings.usePwd;
    $('appVersion').textContent = 'Versione app ' + APP_VERSION;
    if (!$('simNum').value && state.fields.nsim) $('simNum').value = state.fields.nsim;
  }

  function renderAll() {
    renderStatus(); renderTemps(); renderRubrica(); renderCounter(); renderLog(); renderPending();
  }

  /* ---------- importazione risposte ---------- */
  function importText(text) {
    var parsed = L.parseResponse(text);
    var msg = $('importMsg');
    msg.hidden = false;
    if (!parsed.recognized) {
      msg.className = 'note warn';
      msg.textContent = 'Questo testo non sembra una risposta del termostato, quindi non ho cambiato nulla. Controlla di aver copiato il messaggio giusto.';
      addLog('in', parsed.raw.slice(0, 300), 'non riconosciuta');
      return false;
    }
    state = L.applyToState(state, parsed, Date.now());
    saveState();

    var updated = Object.keys(parsed.fields).filter(function (k) { return FIELD_LABEL[k]; }).map(function (k) { return FIELD_LABEL[k]; });
    if (parsed.rubrica) updated.push('rubrica');
    Object.keys(parsed.fields).forEach(function (k) { delete dirty[k]; });

    if (parsed.fields.nsim && !settings.number) {
      settings.number = parsed.fields.nsim;
      store.set(KEYS.settings, settings);
      renderSettings();
      toast('Numero del termostato salvato dalla risposta');
    }
    addLog('in', parsed.raw.slice(0, 300));
    pending = null; store.remove(KEYS.pending);
    $('pasteArea').value = '';
    msg.className = 'note ok';
    msg.textContent = 'Aggiornato: ' + (updated.join(', ') || 'dati') + '.';
    renderAll();
    renderSettings();
    return true;
  }

  function pasteFromClipboard() {
    function fallback() {
      $('pasteCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('pasteArea').focus();
      toast('Tieni premuto nel campo e scegli “Incolla”, poi “Importa testo”');
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (txt) {
        if (!txt || !txt.trim()) { toast('Gli appunti sono vuoti: copia prima il messaggio ricevuto'); fallback(); return; }
        $('pasteArea').value = txt;
        importText(txt);
      }, fallback);
    } else fallback();
  }

  /* ---------- invio SMS ---------- */
  var lastFocus = null, modalCtx = null;

  function launchSms(url) {
    if (window.__tuoSmsHook) { window.__tuoSmsHook(url); return; }
    var a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 800);
  }

  function openSettings(msg) {
    $('settings').open = true;
    $('settings').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (msg) toast(msg);
  }

  function requestSend(cmds, opts) {
    opts = opts || {};
    var list = Array.isArray(cmds) ? cmds : [cmds];
    var composed = L.compose(list, { password: settings.usePwd ? settings.password : '' });
    if (!composed.ok) {
      toast(composed.error, 7000);
      if (/password/i.test(composed.error)) openSettings();
      return;
    }
    if (L.cleanNumber(settings.number).replace(/\D/g, '').length < 6) {
      openSettings('Inserisci prima il numero di telefono del termostato');
      return;
    }
    modalCtx = { composed: composed, opts: opts };
    if (composed.readOnly) { confirmSend(); return; }
    openModal(composed);
  }

  function openModal(c) {
    lastFocus = document.activeElement;
    clearTimeout(toastTimer);
    $('toast').hidden = true;
    $('mTo').textContent = 'Termostato · ' + settings.number;
    $('mBody').textContent = c.body;
    var ul = $('mSummary'); ul.textContent = '';
    c.summaries.forEach(function (s) { ul.appendChild(el('li', null, s)); });
    var w = $('mWarn'); w.textContent = '';
    c.dangers.forEach(function (d) { w.appendChild(el('p', 'note danger', d)); });
    c.warnings.forEach(function (d) { w.appendChild(el('p', 'note warn', d)); });
    if (settings.usePwd) w.appendChild(el('p', 'note', 'Il messaggio inizia con la password SMS, come impostato.'));
    $('modal').hidden = false;
    $('mCancel').focus();
  }

  function closeModal() {
    $('modal').hidden = true;
    modalCtx = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignora */ } }
  }

  function confirmSend() {
    if (!modalCtx) return;
    var c = modalCtx.composed, opts = modalCtx.opts;
    var url = L.smsUrl(settings.number, c.body);
    if (!url) { closeModal(); toast('Numero del termostato non valido'); return; }
    var isModal = !$('modal').hidden;
    if (isModal) { $('modal').hidden = true; }
    modalCtx = null;
    addLog('out', c.plain, c.readOnly ? 'solo lettura' : '');
    pending = { t: Date.now(), text: c.plain };
    store.set(KEYS.pending, pending);
    renderPending();
    launchSms(url);
    if (opts.afterNote) setTimeout(function () { toast(opts.afterNote, 8000); }, 600);
  }

  /* ---------- eventi ---------- */
  function num(id) { return $(id).value; }

  function bindTemps() {
    qsa('input[data-key]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        dirty[inp.getAttribute('data-key')] = true;
        refreshSend();
      });
    });
    var defaults = { tm: 20, t0: 5, t1: 12, t2: 18, t3: 21 };
    qsa('.step').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = $(b.getAttribute('data-for')), key = inp.getAttribute('data-key');
        var v = parseFloat(inp.value);
        if (!isFinite(v)) v = L.isNum(state.fields[key]) ? state.fields[key] : defaults[key];
        v = Math.round((v + parseFloat(b.getAttribute('data-step'))) * 10) / 10;
        var min = parseFloat(inp.min), max = parseFloat(inp.max);
        if (v < min) v = min;
        if (v > max) v = max;
        inp.value = v.toFixed(1);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    $('send-tm').addEventListener('click', function () { requestSend(L.cmd.tm(num('in-tm'))); });
    $('send-t0').addEventListener('click', function () { requestSend(L.cmd.t0(num('in-t0'))); });
    $('btnT0Off').addEventListener('click', function () { requestSend(L.cmd.t0('off')); });
    $('send-t123').addEventListener('click', function () {
      var nv = {};
      ['t1', 't2', 't3'].forEach(function (k) { if (dirty[k] && $('in-' + k).value !== '') nv[k] = $('in-' + k).value; });
      requestSend(L.cmd.temps(nv, { t1: state.fields.t1, t2: state.fields.t2, t3: state.fields.t3 }));
    });
  }

  function timerHint() {
    var raw = $('timerVal').value, u = $('timerUnit').value, hint = $('modeHint');
    var base = 'Spento: il termostato mantiene solo la temperatura antigelo. Manuale: segue la temperatura Tm. Automatico: segue il programma orario.';
    var n = parseInt(raw, 10);
    if (!raw || !n) { hint.textContent = base; return; }
    var t = L.cmd.mode('manual', n, u);
    if (!t.ok) { hint.textContent = t.error; return; }
    var human = n + (u === 'H' ? (n === 1 ? ' ora' : ' ore') : (n === 1 ? ' giorno' : ' giorni'));
    hint.textContent = 'Con una durata di ' + human + ' — Spento: poi torna al funzionamento precedente. Manuale: poi passa ad automatico. Automatico: poi si spegne.';
  }

  function bindControls() {
    qsa('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        requestSend(L.cmd.mode(b.getAttribute('data-mode'), $('timerVal').value, $('timerUnit').value, state));
      });
    });
    qsa('[data-season]').forEach(function (b) {
      b.addEventListener('click', function () { requestSend(L.cmd.season(b.getAttribute('data-season'))); });
    });
    $('timerVal').addEventListener('input', timerHint);
    $('timerUnit').addEventListener('change', timerHint);

    $('btnRefresh').addEventListener('click', function () { requestSend(L.cmd.info(true)); });

    $('btnRubSet').addEventListener('click', function () {
      requestSend(L.cmd.rubricaSet([{ idx: num('rubIdx'), number: num('rubNum') }]));
    });
    $('btnRubList').addEventListener('click', function () { requestSend(L.cmd.rubricaList()); });
    $('btnRubDel').addEventListener('click', function () {
      requestSend(L.cmd.rubricaSet([{ idx: num('rubIdx'), number: 'VUOTO' }]));
    });

    $('btnAlMin').addEventListener('click', function () {
      requestSend(L.cmd.alarmThreshold('min', { soglia: num('alMinS'), isteresi: num('alMinH'), ritardo: num('alMinD') }));
    });
    $('btnAlMax').addEventListener('click', function () {
      requestSend(L.cmd.alarmThreshold('max', { soglia: num('alMaxS'), isteresi: num('alMaxH'), ritardo: num('alMaxD') }));
    });
    qsa('[data-send-recip]').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-send-recip');
        var row = document.querySelector('.recip[data-kind="' + kind + '"]');
        var idxs = qsa('input[type=checkbox]:checked', row).map(function (c) { return parseInt(c.value, 10); });
        requestSend(L.cmd.alarmRecipients(kind, idxs));
      });
    });
    $('btnFwd').addEventListener('click', function () { requestSend(L.cmd.forward(num('fwdIdx'))); });
    $('btnSim').addEventListener('click', function () { requestSend(L.cmd.simNumber(num('simNum'))); });
    $('btnClock').addEventListener('click', function () { requestSend(L.cmd.clock()); });
    $('btnCounter').addEventListener('click', function () { requestSend(L.cmd.counter(false)); });
    $('btnCounterReset').addEventListener('click', function () { requestSend(L.cmd.counter(true)); });
    $('btnPwd').addEventListener('click', function () {
      requestSend(L.cmd.password(num('newPwd')), { afterNote: 'Quando arriva la conferma, aggiorna la password anche in Impostazioni dell’app.' });
    });
  }

  function buildRecipients() {
    qsa('.recip .checks').forEach(function (box) {
      for (var i = 1; i <= L.LIMITS.slots; i++) {
        var lab = el('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = String(i);
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(String(i)));
        box.appendChild(lab);
      }
    });
  }

  function bindPasteAndSettings() {
    $('btnPastePending').addEventListener('click', pasteFromClipboard);
    $('btnDismissPending').addEventListener('click', function () { pending = null; store.remove(KEYS.pending); renderPending(); });
    $('btnPasteClip').addEventListener('click', pasteFromClipboard);
    $('btnImport').addEventListener('click', function () {
      var v = $('pasteArea').value;
      if (!v.trim()) { toast('Incolla prima il testo della risposta'); return; }
      importText(v);
    });
    $('btnLogClear').addEventListener('click', function () { logs = []; saveLogs(); renderLog(); });

    $('btnSaveSettings').addEventListener('click', function () {
      var number = L.cleanNumber($('setNumber').value), pwd = $('setPwd').value.trim(), use = $('setUsePwd').checked;
      if (number && number.replace(/\D/g, '').length < 6) { toast('Numero di telefono non valido'); return; }
      if (pwd && !/^\d{4}$/.test(pwd)) { toast('La password SMS deve avere 4 cifre'); return; }
      if (use && !pwd) { toast('Inserisci la password SMS oppure togli la spunta'); return; }
      settings = { number: number, password: pwd, usePwd: use };
      store.set(KEYS.settings, settings);
      renderSettings();
      toast('Impostazioni salvate');
    });
    $('btnWipe').addEventListener('click', function () {
      if (!window.confirm('Cancellare numero, password, stato e registro salvati in questo telefono?')) return;
      [KEYS.settings, KEYS.state, KEYS.log, KEYS.pending].forEach(function (k) { store.remove(k); });
      settings = { number: '', password: '', usePwd: false };
      state = L.emptyState(); logs = []; pending = null; dirty = {};
      renderAll(); renderSettings();
      toast('Dati cancellati');
    });
  }

  function bindModal() {
    $('mCancel').addEventListener('click', closeModal);
    $('mConfirm').addEventListener('click', confirmSend);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if ($('modal').hidden) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key === 'Tab') {
        var a = $('mCancel'), b = $('mConfirm');
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    });
  }

  /* ---------- avvio ---------- */
  function importFromHash() {
    var m = /^#r=(.*)$/.exec(window.location.hash || '');
    if (!m) return;
    var text = '';
    try { text = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { text = m[1]; }
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* ignora */ }
    if (text.trim()) importText(text);
  }

  function init() {
    buildRecipients();
    bindTemps(); bindControls(); bindPasteAndSettings(); bindModal();
    renderSettings(); renderAll();
    importFromHash();
    window.addEventListener('hashchange', importFromHash);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { renderPending(); renderStatus(); }
    });
    setInterval(function () { renderStatus(); }, 60000);

    if (!settings.number) $('settings').open = true;

    if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* l'app funziona anche senza */ });
      });
    }
  }

  init();
})();
