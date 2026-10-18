/* Test della libreria con le risposte reali del termostato. Esegui: node test/test-lib.js */
'use strict';
var assert = require('assert');
var L = require('../lib.js');
var passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; } }

console.log('Parsing delle risposte reali');

t('CRONO INFO TUTTO', function () {
  var p = L.parseResponse('INT=23.6 C RH=58.0 % CRONO=MANUALE(RISC) TM=9.2 C RELE=SPENTO ALIM=SI GSM=58% NSIM=3331234567 14/09/2026 21:48:11');
  var f = p.fields;
  assert.strictEqual(f.temp, 23.6);
  assert.strictEqual(f.rh, 58);
  assert.strictEqual(f.mode, 'manual');
  assert.strictEqual(f.season, 'heat');
  assert.strictEqual(f.tm, 9.2);
  assert.strictEqual(f.relay, false);
  assert.strictEqual(f.power, true);
  assert.strictEqual(f.gsm, 58);
  assert.strictEqual(f.nsim, '3331234567');
  assert.strictEqual(f.deviceTime, '2026-09-14T21:48:11');
  assert.deepStrictEqual(p.extra, {});
  assert.strictEqual(p.recognized, true);
});

t('CRONO SPENTO', function () {
  var f = L.parseResponse('CRONO=SPENTO (ANTIGELO=3.0 C)').fields;
  assert.strictEqual(f.mode, 'off');
  assert.strictEqual(f.t0, 3);
  assert.strictEqual(f.t0Off, false);
  assert.strictEqual(f.season, undefined);
});

t('CRONO ACCESO MANUALE 5h', function () {
  var f = L.parseResponse('CRONO=ACCESO (MANUALE TM=20.0 C)').fields;
  assert.strictEqual(f.mode, 'manual');
  assert.strictEqual(f.tm, 20);
});

t('Tm 20', function () { assert.deepStrictEqual(L.parseResponse('TM=20.0 C').fields, { tm: 20 }); });
t('T1 12', function () { assert.deepStrictEqual(L.parseResponse('T1=12.0 C').fields, { t1: 12 }); });
t('T0 3', function () { assert.deepStrictEqual(L.parseResponse('T0 ANTIGELO=3.0 C').fields, { t0: 3, t0Off: false }); });

console.log('Parsing: casi limite');

t('virgola decimale e minuscolo', function () {
  var f = L.parseResponse('int=21,5 c rh=40,0 % crono=automatico(cond)').fields;
  assert.strictEqual(f.temp, 21.5); assert.strictEqual(f.rh, 40);
  assert.strictEqual(f.mode, 'auto'); assert.strictEqual(f.season, 'cool');
});
t('ACCESO (AUTOMATICO ...)', function () {
  assert.strictEqual(L.parseResponse('CRONO=ACCESO (AUTOMATICO)').fields.mode, 'auto');
});
t('antigelo disattivato', function () {
  var f = L.parseResponse('T0 ANTIGELO=DISABILITATO').fields;
  assert.strictEqual(f.t0, null); assert.strictEqual(f.t0Off, true);
});
t('"MINIMA INT" in un allarme non diventa temperatura', function () {
  var p = L.parseResponse('ALLARME MINIMA INT=5.0 C');
  assert.strictEqual(p.fields.temp, undefined);
});
t('testo non riconosciuto', function () {
  var p = L.parseResponse('Gentile cliente, il suo credito sta per esaurirsi');
  assert.strictEqual(p.recognized, false);
});
t('chiavi sconosciute finiscono in extra', function () {
  var p = L.parseResponse('INT=20.0 C SP=18.5 C CRONO=MANUALE(RISC)');
  assert.strictEqual(p.extra.SP, '18.5 C');
  assert.strictEqual(p.fields.temp, 20);
});
t('rubrica', function () {
  var p = L.parseResponse('RUBRICA 1=3331112222 2=vuoto 3=vuoto 4=+393480000000 5=vuoto');
  assert.deepStrictEqual(p.rubrica, { 1: '3331112222', 2: null, 3: null, 4: '+393480000000', 5: null });
  assert.strictEqual(p.recognized, true);
});
t('data non valida ignorata', function () {
  assert.strictEqual(L.parseResponse('INT=20 C 45/13/2026 99:99:99').fields.deviceTime, undefined);
});

console.log('Stato');

t('fusione di risposte successive', function () {
  var s = L.applyToState(null, L.parseResponse('T1=12.0 C'), 1000);
  s = L.applyToState(s, L.parseResponse('INT=22.0 C CRONO=SPENTO (ANTIGELO=3.0 C)'), 2000);
  assert.strictEqual(s.fields.t1, 12); assert.strictEqual(s.ts.t1, 1000);
  assert.strictEqual(s.fields.temp, 22); assert.strictEqual(s.fields.mode, 'off');
  s = L.applyToState(s, L.parseResponse('T0 ANTIGELO=DISABILITATO'), 3000);
  assert.strictEqual(s.fields.t0, null); assert.strictEqual(s.fields.t0Off, true);
  s = L.applyToState(s, L.parseResponse('T0 ANTIGELO=4.0 C'), 4000);
  assert.strictEqual(s.fields.t0, 4); assert.strictEqual(s.fields.t0Off, false);
});

console.log('Comandi');

t('modo + timer', function () {
  assert.strictEqual(L.cmd.mode('off').text, 'CRONO SPENTO');
  assert.strictEqual(L.cmd.mode('manual', 5, 'H').text, 'CRONO ACCESO MANUALE 5 H');
  assert.strictEqual(L.cmd.mode('auto', '2', 'g').text, 'CRONO ACCESO AUTOMATICO 2 G');
  assert.strictEqual(L.cmd.mode('off', '', 'H').text, 'CRONO SPENTO');
  assert.strictEqual(L.cmd.mode('off', 0, 'H').text, 'CRONO SPENTO');
  assert.strictEqual(L.cmd.mode('off', 100, 'H').ok, false);
  assert.strictEqual(L.cmd.mode('off', 1.5, 'H').ok, false);
});
t('spento con antigelo disattivato: avviso', function () {
  var c = L.cmd.mode('off', '', 'H', { fields: { t0Off: true, season: 'heat' } });
  assert.ok(c.danger);
});
t('stagione', function () {
  assert.strictEqual(L.cmd.season('heat').text, 'CRONO RISCALDAMENTO');
  assert.strictEqual(L.cmd.season('cool').text, 'CRONO CONDIZIONAMENTO');
});
t('Tm e T0: limiti', function () {
  assert.strictEqual(L.cmd.tm(18.5).text, 'Tm 18.5');
  assert.strictEqual(L.cmd.tm('18,5').text, 'Tm 18.5');
  assert.strictEqual(L.cmd.tm(1.9).ok, false);
  assert.strictEqual(L.cmd.tm(50.1).ok, false);
  assert.strictEqual(L.cmd.tm('abc').ok, false);
  assert.strictEqual(L.cmd.t0(3).text, 'T0 3.0');
  assert.strictEqual(L.cmd.t0(0.5).ok, false);
  assert.strictEqual(L.cmd.t0('off').text, 'T0 DISABILITATO');
  assert.ok(L.cmd.t0('off').danger);
});
t('T1<=T2<=T3 rifiutato', function () {
  var r = L.cmd.temps({ t1: 20, t2: 15 }, {});
  assert.strictEqual(r.ok, false); assert.ok(/T1 ≤ T2 ≤ T3/.test(r.error));
  assert.strictEqual(L.cmd.temps({ t1: 20 }, { t2: 15, t3: 18 }).ok, false);
  assert.strictEqual(L.cmd.temps({ t3: 10 }, { t1: 5, t2: 15 }).ok, false);
});
t('T1/T2/T3: ordine di invio sicuro', function () {
  // aumento: prima T3, poi T2, poi T1
  assert.strictEqual(L.cmd.temps({ t1: 20, t2: 22, t3: 25 }, { t1: 5, t2: 15, t3: 18 }).text, 'T3 25.0 T2 22.0 T1 20.0');
  // diminuzione: prima T1, poi T2, poi T3
  assert.strictEqual(L.cmd.temps({ t1: 2, t2: 3, t3: 4 }, { t1: 5, t2: 15, t3: 18 }).text, 'T1 2.0 T2 3.0 T3 4.0');
  // un solo valore
  assert.strictEqual(L.cmd.temps({ t1: 12 }, { t1: 5, t2: 15, t3: 18 }).text, 'T1 12.0');
  // valori attuali ignoti: avviso ma comando valido
  var u = L.cmd.temps({ t1: 12 }, {});
  assert.strictEqual(u.ok, true); assert.ok(u.warnings.length === 1);
});
t('rubrica', function () {
  assert.strictEqual(L.cmd.rubricaSet([{ idx: 2, number: '333 111 222' }]).text, 'RUBRICA 2 333111222');
  assert.strictEqual(L.cmd.rubricaSet([{ idx: 2, number: '333111222' }, { idx: 5, number: '+39333111223' }]).text, 'RUBRICA 2 333111222 5 +39333111223');
  assert.strictEqual(L.cmd.rubricaSet([{ idx: 2, number: 'vuoto' }]).text, 'RUBRICA 2 VUOTO');
  assert.ok(L.cmd.rubricaSet([{ idx: 2, number: 'vuoto' }]).danger);
  assert.strictEqual(L.cmd.rubricaSet([{ idx: 6, number: '333111222' }]).ok, false);
  assert.strictEqual(L.cmd.rubricaSet([{ idx: 1, number: '12' }]).ok, false);
  assert.strictEqual(L.cmd.rubricaSet([{ idx: 1, number: '333' }, { idx: 1, number: '444444' }]).ok, false);
  assert.strictEqual(L.cmd.rubricaList().text, 'RUBRICA');
});
t('allarmi', function () {
  assert.strictEqual(L.cmd.alarmThreshold('min', { soglia: 5, isteresi: 1, ritardo: 10 }).text, 'IMPOSTA ALLARME MINIMA INT 5.0 1.0 10');
  assert.strictEqual(L.cmd.alarmThreshold('max', { soglia: 30, isteresi: 2, ritardo: 0 }).text, 'IMPOSTA ALLARME MASSIMA INT 30.0 2.0 0');
  assert.strictEqual(L.cmd.alarmThreshold('min', { soglia: 60, isteresi: 1, ritardo: 10 }).ok, false);
  assert.strictEqual(L.cmd.alarmThreshold('min', { soglia: 5, isteresi: 1, ritardo: -1 }).ok, false);
  assert.strictEqual(L.cmd.alarmRecipients('power', [1]).text, 'INVIO ALLARME ALIMENTAZIONE 1');
  assert.strictEqual(L.cmd.alarmRecipients('max', [4, 2, 2]).text, 'INVIO ALLARME MASSIMA 2 4');
  assert.strictEqual(L.cmd.alarmRecipients('min', []).text, 'INVIO ALLARME MINIMA VUOTO');
  assert.strictEqual(L.cmd.alarmRecipients('min', [7]).ok, false);
});
t('altri comandi', function () {
  assert.strictEqual(L.cmd.forward(3).text, 'INOLTRA 3');
  assert.strictEqual(L.cmd.forward('none').text, 'INOLTRA NESSUNO');
  assert.strictEqual(L.cmd.password('2276').text, 'PASSWORD 2276');
  assert.strictEqual(L.cmd.password('22').ok, false);
  assert.strictEqual(L.cmd.simNumber('333 123 4567').text, 'CRONO NUMERO 3331234567');
  assert.strictEqual(L.cmd.info().text, 'CRONO INFO TUTTO');
  assert.strictEqual(L.cmd.counter(true).text, 'COUNTER RESET');
  assert.strictEqual(L.cmd.clock().text, 'OROLOGIO');
});

console.log('Composizione SMS');

t('password e massimo 3 comandi', function () {
  var c = L.compose([L.cmd.temps({ t1: 12 }, { t1: 5, t2: 15, t3: 18 })], { password: '1234' });
  assert.strictEqual(c.body, '1234 T1 12.0'); assert.strictEqual(c.plain, 'T1 12.0');
  assert.strictEqual(L.compose([L.cmd.tm(20)], {}).body, 'Tm 20.0');
  assert.strictEqual(L.compose([L.cmd.tm(20)], { password: '12' }).ok, false);
  var four = [L.cmd.tm(20), L.cmd.tm(20), L.cmd.tm(20), L.cmd.tm(20)];
  assert.strictEqual(L.compose(four).ok, false);
  assert.strictEqual(L.compose([L.cmd.tm(500)]).ok, false);
  assert.strictEqual(L.compose([L.cmd.info()]).readOnly, true);
  assert.strictEqual(L.compose([L.cmd.mode('off')]).readOnly, false);
});
t('URI sms:', function () {
  assert.strictEqual(L.smsUrl('333 123 4567', 'CRONO SPENTO'), 'sms:3331234567?&body=CRONO%20SPENTO');
  assert.strictEqual(L.smsUrl('+39 333 123 4567', 'Tm 20.0'), 'sms:+393331234567?&body=Tm%2020.0');
  assert.strictEqual(L.smsUrl('', 'x'), null);
  assert.strictEqual(L.smsUrl('12', 'x'), null);
});
t('ora del termostato e "x fa"', function () {
  var ms = L.deviceTimeMs('2026-09-14T21:48:11');
  assert.strictEqual(new Date(ms).getHours(), 21);
  assert.strictEqual(L.ago(30 * 1000), 'pochi secondi fa');
  assert.strictEqual(L.ago(3 * 3600 * 1000), '3 ore fa');
  assert.strictEqual(L.ago(5 * 86400 * 1000), '5 giorni fa');
});

console.log('\n' + passed + ' test superati' + (process.exitCode ? ' (CI SONO FALLIMENTI)' : ''));
