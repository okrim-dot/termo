/*
 * TUO GSM - libreria pura (nessuna dipendenza dal DOM).
 *  - parseResponse(): interpreta in modo tollerante le risposte SMS del termostato
 *  - applyToState():  fonde le risposte in uno stato persistente
 *  - cmd.*:           costruisce e valida i comandi SMS (sintassi italiana, manuale Vemer V3IS01003-010)
 *  - compose():       unisce fino a 3 comandi in un SMS, con password opzionale
 *  - smsUrl():        URI sms: compatibile con iOS e Android
 *
 * Funziona sia in Node (require) sia nel browser (window.TuoLib).
 * Niente lookbehind nelle regex: Safari < 16.4 non le supporta.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TuoLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    tMin: 2, tMax: 50,          // T1/T2/T3/Tm (manuale p.12-13)
    t0Min: 1, t0Max: 50,        // antigelo via SMS (manuale p.12)
    timerMin: 1, timerMax: 99,  // temporizzazione (manuale p.11)
    alarmMin: 0, alarmMax: 50,  // scala di misura 0..50 C (manuale p.37)
    slots: 5,                   // posizioni in rubrica
    smsChars: 160
  };

  var NUM = '(-?\\d+(?:[.,]\\d+)?)';

  function toNum(s) { return parseFloat(String(s).replace(',', '.')); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function fmt(v) { return round1(v).toFixed(1); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------------ */
  /* PARSING DELLE RISPOSTE                                              */
  /* ------------------------------------------------------------------ */

  var KNOWN_KEYS = { INT: 1, RH: 1, CRONO: 1, TM: 1, RELE: 1, ALIM: 1, GSM: 1, NSIM: 1,
                     T0: 1, T1: 1, T2: 1, T3: 1, ANTIGELO: 1 };

  function parseResponse(raw) {
    var text = String(raw == null ? '' : raw).replace(/ /g, ' ').trim();
    var out = { raw: text, fields: {}, extra: {}, rubrica: null, recognized: false };
    if (!text) return out;
    var up = text.toUpperCase();
    var f = out.fields;
    var m;

    // INT= e' la temperatura misurata. Nei messaggi di allarme "MINIMA INT" e' solo
    // un nome di comando, quindi lo escludo prima di cercare.
    var forTemp = up.replace(/(MINIMA|MASSIMA)\s+INT\b/g, ' ');
    m = new RegExp('(?:^|[^A-Z0-9])INT\\s*=\\s*' + NUM).exec(forTemp);
    if (m) f.temp = toNum(m[1]);

    m = new RegExp('\\bRH\\s*=\\s*' + NUM).exec(up);
    if (m) f.rh = toNum(m[1]);

    // CRONO=MANUALE(RISC) | CRONO=SPENTO (ANTIGELO=3.0 C) | CRONO=ACCESO (MANUALE TM=20.0 C)
    m = /\bCRONO\s*=\s*([A-Z]+)\s*(?:\(([^)]*)\))?/.exec(up);
    if (m) {
      var w = m[1], inner = m[2] || '';
      if (w === 'SPENTO') f.mode = 'off';
      else if (w === 'ACCESO') {
        if (/\bAUTOMATIC/.test(inner)) f.mode = 'auto';
        else if (/\bMANUAL/.test(inner)) f.mode = 'manual';
        else if (/\bSPENT/.test(inner)) f.mode = 'off';
      }
      else if (/^AUTOMATIC/.test(w)) f.mode = 'auto';
      else if (/^MANUAL/.test(w)) f.mode = 'manual';
      var both = w + ' ' + inner;
      if (/\bRISC/.test(both)) f.season = 'heat';
      else if (/\bCOND/.test(both)) f.season = 'cool';
      if (!f.mode && !f.season) f.modeRaw = (w + ' ' + inner).trim();
    }

    m = new RegExp('\\bTM\\s*=\\s*' + NUM).exec(up);
    if (m) f.tm = toNum(m[1]);

    m = new RegExp('\\bANTIGELO\\s*=\\s*(?:' + NUM + '|(DISABILITATO|OFF|NO))').exec(up);
    if (m) {
      if (m[1] != null) { f.t0 = toNum(m[1]); f.t0Off = false; }
      else { f.t0 = null; f.t0Off = true; }
    } else {
      m = new RegExp('\\bT0\\s*=\\s*' + NUM).exec(up);
      if (m) { f.t0 = toNum(m[1]); f.t0Off = false; }
    }

    var reT = new RegExp('\\bT([123])\\s*=\\s*' + NUM, 'g');
    while ((m = reT.exec(up)) !== null) f['t' + m[1]] = toNum(m[2]);

    m = /\bRELE\s*=\s*([A-Z]+)/.exec(up);
    if (m) {
      if (/^(ACCESO|ON|CHIUSO|ATTIVO)$/.test(m[1])) f.relay = true;
      else if (/^(SPENTO|OFF|APERTO|DISATTIVO)$/.test(m[1])) f.relay = false;
    }

    m = /\bALIM\s*=\s*([A-Z]+)/.exec(up);
    if (m) {
      if (m[1] === 'SI') f.power = true;
      else if (m[1] === 'NO') f.power = false;
    }

    m = /\bGSM\s*=\s*(\d+)/.exec(up);
    if (m) f.gsm = parseInt(m[1], 10);

    m = /\bNSIM\s*=\s*(\+?\d+)/.exec(up);
    if (m) f.nsim = m[1];

    m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
    if (m) {
      var d = +m[1], mo = +m[2], y = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60 && s < 60) {
        f.deviceTime = y + '-' + pad2(mo) + '-' + pad2(d) + 'T' + pad2(h) + ':' + pad2(mi) + ':' + pad2(s);
      }
    }

    // Risposta a COUNTER: formato non documentato, provo a leggere "<numero> H" vicino a COUNTER.
    m = /\bCOUNTER\b[^0-9]{0,12}(\d{1,5})\s*H?/.exec(up);
    if (m) f.counterHours = parseInt(m[1], 10);

    // RUBRICA 1=numero 2=vuoto ...
    var ri = up.indexOf('RUBRICA');
    if (ri !== -1) {
      var tail = text.slice(ri + 7), slots = {}, found = false, reS = /(?:^|[^0-9])([1-5])\s*=\s*([^\s]+)/g, sm;
      while ((sm = reS.exec(tail)) !== null) {
        found = true;
        slots[sm[1]] = /^vuot[oa]$/i.test(sm[2]) ? null : sm[2];
      }
      if (found) out.rubrica = slots;
    }

    // Qualsiasi altra coppia CHIAVE=valore non riconosciuta: la conservo, la UI la mostra.
    var reX = /\b([A-Z][A-Z0-9]*)\s*=\s*([^\s()]+)(?:\s+(C|%|H|G|MIN)\b)?/g, xm;
    while ((xm = reX.exec(up)) !== null) {
      if (KNOWN_KEYS[xm[1]]) continue;
      if (/^[1-5]$/.test(xm[1])) continue;
      out.extra[xm[1]] = xm[2] + (xm[3] ? ' ' + xm[3] : '');
    }

    out.recognized = Object.keys(f).length > 0 || !!out.rubrica;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* STATO                                                               */
  /* ------------------------------------------------------------------ */

  function emptyState() {
    return { fields: {}, ts: {}, rubrica: null, rubricaTs: 0, extra: {} };
  }

  function applyToState(state, parsed, nowMs) {
    var s = JSON.parse(JSON.stringify(state || emptyState()));
    if (!s.fields) s.fields = {};
    if (!s.ts) s.ts = {};
    if (!s.extra) s.extra = {};
    Object.keys(parsed.fields).forEach(function (k) {
      s.fields[k] = parsed.fields[k];
      s.ts[k] = nowMs;
    });
    if (parsed.fields.t0 === null) s.fields.t0 = null;
    Object.keys(parsed.extra).forEach(function (k) { s.extra[k] = parsed.extra[k]; });
    if (parsed.rubrica) { s.rubrica = parsed.rubrica; s.rubricaTs = nowMs; }
    return s;
  }

  // La data/ora del termostato e' "locale" senza fuso: la leggo come ora locale del telefono.
  function deviceTimeMs(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(iso);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 90) return 'pochi secondi fa';
    var min = Math.round(s / 60);
    if (min < 60) return min + ' min fa';
    var h = Math.round(min / 60);
    if (h < 48) return h + (h === 1 ? ' ora fa' : ' ore fa');
    return Math.round(h / 24) + ' giorni fa';
  }

  /* ------------------------------------------------------------------ */
  /* COSTRUZIONE COMANDI                                                 */
  /* ------------------------------------------------------------------ */

  function bad(msg) { return { ok: false, error: msg }; }
  function good(text, summary, extra) {
    var r = { ok: true, text: text, summary: summary, readOnly: false, danger: null, warnings: [] };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  function checkRange(v, min, max, label) {
    var n = typeof v === 'number' ? v : toNum(v);
    if (!isNum(n)) return { ok: false, error: label + ': inserisci un numero' };
    n = round1(n);
    if (n < min || n > max) return { ok: false, error: label + ' deve essere tra ' + fmt(min) + ' e ' + fmt(max) + ' °C' };
    return { ok: true, value: n };
  }

  function parseTimer(n, unit) {
    if (n === '' || n == null) return { ok: true, suffix: '', human: '' };
    var v = typeof n === 'number' ? n : parseInt(String(n), 10);
    if (!isFinite(v) || v === 0) return { ok: true, suffix: '', human: '' };
    if (v < LIMITS.timerMin || v > LIMITS.timerMax || Math.floor(v) !== v) {
      return { ok: false, error: 'La durata deve essere un intero tra 1 e 99' };
    }
    var u = String(unit || 'H').toUpperCase();
    if (u !== 'H' && u !== 'G') return { ok: false, error: 'Unità non valida (ore o giorni)' };
    return { ok: true, suffix: ' ' + v + ' ' + u, human: v + (u === 'H' ? (v === 1 ? ' ora' : ' ore') : (v === 1 ? ' giorno' : ' giorni')) };
  }

  var cmd = {
    info: function (full) {
      return good(full === false ? 'CRONO INFO' : 'CRONO INFO TUTTO',
        'Richiedi lo stato completo del termostato', { readOnly: true });
    },

    mode: function (mode, timerN, timerUnit, ctx) {
      var t = parseTimer(timerN, timerUnit);
      if (!t.ok) return bad(t.error);
      var base, sum, after = '';
      if (mode === 'off') {
        base = 'CRONO SPENTO'; sum = 'Spegni il termostato';
        after = 'poi torna al funzionamento precedente (automatico o manuale)';
      } else if (mode === 'manual') {
        base = 'CRONO ACCESO MANUALE'; sum = 'Funzionamento manuale (usa la temperatura Tm)';
        after = 'poi passa ad automatico';
      } else if (mode === 'auto') {
        base = 'CRONO ACCESO AUTOMATICO'; sum = 'Funzionamento automatico (segue il programma orario)';
        after = 'poi si spegne';
      } else return bad('Modo sconosciuto');
      var r = good(base + t.suffix, sum + (t.human ? ' per ' + t.human + ', ' + after : ' fino a nuovo comando'));
      if (mode === 'off' && ctx && ctx.fields && ctx.fields.t0Off && ctx.fields.season !== 'cool') {
        r.danger = "L'antigelo risulta disattivato: da spento non c'è nessuna temperatura minima garantita (rischio gelo impianto).";
      }
      return r;
    },

    season: function (s) {
      if (s === 'heat') return good('CRONO RISCALDAMENTO', 'Imposta il modo riscaldamento (inverno)');
      if (s === 'cool') return good('CRONO CONDIZIONAMENTO', 'Imposta il modo condizionamento (estate)');
      return bad('Stagione sconosciuta');
    },

    tm: function (v) {
      var c = checkRange(v, LIMITS.tMin, LIMITS.tMax, 'Tm');
      if (!c.ok) return bad(c.error);
      return good('Tm ' + fmt(c.value), 'Temperatura manuale Tm = ' + fmt(c.value) + ' °C');
    },

    t0: function (v) {
      if (v === 'off' || v === null) {
        return good('T0 DISABILITATO', 'Disattiva la temperatura antigelo (T0)',
          { danger: 'Senza antigelo, a termostato spento non c’è nessuna temperatura minima garantita: rischio di gelo dell’impianto.' });
      }
      var c = checkRange(v, LIMITS.t0Min, LIMITS.t0Max, 'T0 (antigelo)');
      if (!c.ok) return bad(c.error);
      return good('T0 ' + fmt(c.value), 'Temperatura antigelo T0 = ' + fmt(c.value) + ' °C');
    },

    // newVals: {t1?, t2?, t3?} da inviare; cur: ultimi valori noti {t1,t2,t3}
    temps: function (newVals, cur) {
      cur = cur || {};
      var keys = ['t1', 't2', 't3'], pend = {}, any = false, i, j, k;
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (newVals[k] != null && newVals[k] !== '') {
          var c = checkRange(newVals[k], LIMITS.tMin, LIMITS.tMax, k.toUpperCase());
          if (!c.ok) return bad(c.error);
          pend[k] = c.value; any = true;
        }
      }
      if (!any) return bad('Nessun valore da inviare');

      var fin = {}, unknown = false;
      keys.forEach(function (kk) {
        fin[kk] = pend[kk] != null ? pend[kk] : (isNum(cur[kk]) ? cur[kk] : null);
        if (fin[kk] == null) unknown = true;
      });
      var known = keys.filter(function (kk) { return fin[kk] != null; });
      for (i = 0; i < known.length; i++) for (j = i + 1; j < known.length; j++) {
        if (fin[known[i]] > fin[known[j]]) {
          return bad('Deve valere T1 ≤ T2 ≤ T3, ma ' + known[i].toUpperCase() + ' = ' + fmt(fin[known[i]]) +
            ' è maggiore di ' + known[j].toUpperCase() + ' = ' + fmt(fin[known[j]]));
        }
      }

      function sorted(st) {
        var ks = keys.filter(function (x) { return st[x] != null; });
        for (var a = 0; a < ks.length; a++) for (var b = a + 1; b < ks.length; b++) if (st[ks[a]] > st[ks[b]]) return false;
        return true;
      }
      // Ordine di invio che mantiene T1<=T2<=T3 valido a ogni passo (se il termostato
      // controlla ogni comando singolarmente).
      var st = { t1: isNum(cur.t1) ? cur.t1 : null, t2: isNum(cur.t2) ? cur.t2 : null, t3: isNum(cur.t3) ? cur.t3 : null };
      var left = keys.filter(function (kk) { return pend[kk] != null; }), order = [];
      while (left.length) {
        var pick = null;
        for (i = 0; i < left.length; i++) {
          var trial = { t1: st.t1, t2: st.t2, t3: st.t3 };
          trial[left[i]] = pend[left[i]];
          if (sorted(trial)) { pick = left[i]; break; }
        }
        if (pick === null) pick = left[0];
        st[pick] = pend[pick]; order.push(pick); left.splice(left.indexOf(pick), 1);
      }
      var text = order.map(function (kk) { return kk.toUpperCase() + ' ' + fmt(pend[kk]); }).join(' ');
      var sum = order.map(function (kk) { return kk.toUpperCase() + ' = ' + fmt(pend[kk]) + ' °C'; }).join(', ');
      var r = good(text, 'Temperature del programma automatico: ' + sum);
      if (unknown) r.warnings.push('Non conosco i valori attuali di tutte le temperature: il termostato verifica da solo che T1 ≤ T2 ≤ T3 e potrebbe rifiutare un valore.');
      return r;
    },

    clock: function () { return good('OROLOGIO', "Sincronizza data e ora del termostato (serve il numero SIM impostato, vedi “Numero SIM”)"); },

    counter: function (reset) {
      if (reset) return good('COUNTER RESET', "Azzera il contaore di funzionamento dell'impianto",
        { danger: 'Il contaore verrà azzerato e non si può recuperare.' });
      return good('COUNTER', "Richiedi le ore di funzionamento dell'impianto", { readOnly: true });
    },

    rubricaList: function () { return good('RUBRICA', 'Mostra la rubrica del termostato', { readOnly: true }); },

    // entries: [{idx:1..5, number:'+39...' | 'VUOTO'}]
    rubricaSet: function (entries) {
      if (!entries || !entries.length) return bad('Nessuna voce');
      var parts = [], sums = [], del = false, seen = {};
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], idx = parseInt(e.idx, 10);
        if (!(idx >= 1 && idx <= LIMITS.slots)) return bad('La posizione in rubrica va da 1 a 5');
        if (seen[idx]) return bad('Posizione ' + idx + ' ripetuta');
        seen[idx] = true;
        var n = String(e.number == null ? '' : e.number).trim();
        if (/^vuoto$/i.test(n)) { parts.push(idx + ' VUOTO'); sums.push('cancella la posizione ' + idx); del = true; continue; }
        var clean = n.replace(/[\s.\-()]/g, '');
        if (!/^\+?\d{6,15}$/.test(clean)) return bad('Numero non valido: usa solo cifre ed eventualmente il + iniziale');
        parts.push(idx + ' ' + clean); sums.push('posizione ' + idx + ' = ' + clean);
      }
      var r = good('RUBRICA ' + parts.join(' '), 'Rubrica: ' + sums.join('; '));
      if (del) r.danger = 'Un numero cancellato dalla rubrica non potrà più comandare il termostato senza password, né riceverà gli allarmi.';
      return r;
    },

    // kind: 'min' | 'max'
    alarmThreshold: function (kind, o) {
      var name = kind === 'min' ? 'MINIMA' : kind === 'max' ? 'MASSIMA' : null;
      if (!name) return bad('Tipo di allarme sconosciuto');
      var s = checkRange(o.soglia, LIMITS.alarmMin, LIMITS.alarmMax, 'Soglia');
      if (!s.ok) return bad(s.error);
      var h = checkRange(o.isteresi, 0, 20, 'Isteresi');
      if (!h.ok) return bad(h.error);
      var d = parseInt(o.ritardo, 10);
      if (!isFinite(d) || d < 0 || d > 999) return bad('Il ritardo è un numero di minuti tra 0 e 999');
      return good('IMPOSTA ALLARME ' + name + ' INT ' + fmt(s.value) + ' ' + fmt(h.value) + ' ' + d,
        'Allarme temperatura ' + (kind === 'min' ? 'minima' : 'massima') + ': soglia ' + fmt(s.value) +
        ' °C, isteresi ' + fmt(h.value) + ' °C, ritardo ' + d + ' min');
    },

    // kind: 'min' | 'max' | 'power'; idxs: [] => VUOTO
    alarmRecipients: function (kind, idxs) {
      var name = { min: 'MINIMA', max: 'MASSIMA', power: 'ALIMENTAZIONE' }[kind];
      if (!name) return bad('Tipo di allarme sconosciuto');
      var label = { min: 'temperatura minima', max: 'temperatura massima', power: 'mancanza alimentazione' }[kind];
      if (!idxs || !idxs.length) {
        return good('INVIO ALLARME ' + name + ' VUOTO', 'Nessun destinatario per l’allarme ' + label,
          { danger: 'Nessuno riceverà più l’SMS di questo allarme.' });
      }
      var uniq = [];
      for (var i = 0; i < idxs.length; i++) {
        var n = parseInt(idxs[i], 10);
        if (!(n >= 1 && n <= LIMITS.slots)) return bad('La posizione in rubrica va da 1 a 5');
        if (uniq.indexOf(n) === -1) uniq.push(n);
      }
      uniq.sort();
      return good('INVIO ALLARME ' + name + ' ' + uniq.join(' '),
        'Allarme ' + label + ' inviato alle posizioni di rubrica: ' + uniq.join(', ') + ' (sostituisce i destinatari precedenti)');
    },

    forward: function (idx) {
      if (idx === 'none' || idx === null) {
        return good('INOLTRA NESSUNO', 'Disattiva l’inoltro dei messaggi non riconosciuti');
      }
      var n = parseInt(idx, 10);
      if (!(n >= 1 && n <= LIMITS.slots)) return bad('La posizione in rubrica va da 1 a 5');
      return good('INOLTRA ' + n, 'Inoltra i messaggi non riconosciuti alla posizione di rubrica ' + n);
    },

    password: function (p) {
      if (!/^\d{4}$/.test(String(p || ''))) return bad('La nuova password deve avere esattamente 4 cifre');
      return good('PASSWORD ' + p, 'Cambia la password dei comandi SMS',
        { danger: 'Dopo il cambio, aggiorna la password anche nelle Impostazioni di questa app.' });
    },

    simNumber: function (n) {
      var clean = String(n || '').replace(/[\s.\-()]/g, '');
      if (!/^\+?\d{6,15}$/.test(clean)) return bad('Numero SIM non valido');
      return good('CRONO NUMERO ' + clean, 'Comunica al termostato il numero della sua SIM (per la sincronizzazione automatica dell’ora)');
    }
  };

  /* ------------------------------------------------------------------ */
  /* SMS                                                                 */
  /* ------------------------------------------------------------------ */

  function compose(cmds, opts) {
    opts = opts || {};
    var list = Array.isArray(cmds) ? cmds : [cmds];
    if (!list.length) return bad('Nessun comando');
    var i;
    for (i = 0; i < list.length; i++) if (!list[i] || !list[i].ok) return bad(list[i] && list[i].error ? list[i].error : 'Comando non valido');
    if (list.length > 3) return bad('Il termostato accetta al massimo 3 comandi per SMS');
    var plain = list.map(function (c) { return c.text; }).join(' ');
    var body = plain;
    if (opts.password) {
      if (!/^\d{4}$/.test(opts.password)) return bad('La password SMS deve avere 4 cifre (Impostazioni)');
      body = opts.password + ' ' + plain;
    }
    var warnings = [], dangers = [];
    list.forEach(function (c) {
      (c.warnings || []).forEach(function (w) { warnings.push(w); });
      if (c.danger) dangers.push(c.danger);
    });
    if (body.length > LIMITS.smsChars) warnings.push('Il messaggio supera 160 caratteri e verrà spedito come SMS multiplo.');
    return {
      ok: true, body: body, plain: plain, length: body.length,
      summaries: list.map(function (c) { return c.summary; }),
      warnings: warnings, dangers: dangers,
      readOnly: list.every(function (c) { return c.readOnly; })
    };
  }

  function cleanNumber(n) { return String(n == null ? '' : n).replace(/[^\d+]/g, ''); }

  // "?&body=" e' il formato che funziona sia su iOS sia su Android.
  function smsUrl(number, body) {
    var num = cleanNumber(number);
    if (num.replace(/\D/g, '').length < 6) return null;
    return 'sms:' + num + '?&body=' + encodeURIComponent(body);
  }

  return {
    LIMITS: LIMITS, parseResponse: parseResponse, emptyState: emptyState, applyToState: applyToState,
    deviceTimeMs: deviceTimeMs, ago: ago, cmd: cmd, compose: compose, smsUrl: smsUrl,
    cleanNumber: cleanNumber, fmt: fmt, isNum: isNum
  };
});
