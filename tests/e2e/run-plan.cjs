const { chromium } = require('playwright');
// Testrunden: erst tests/e2e/rounds, sonst im festen Klon auf Martins Mac (Worktrees haben keine)
const ROUNDS = [__dirname + "/rounds", require("os").homedir() + "/Desktop/SQUIZZZzZ/05 App/30 App-Repo/tests/e2e/rounds"].find((d) => require("fs").existsSync(d + "/buzz.sqb"));
if (!ROUNDS) { console.error("Testrunden fehlen: keypad.sqq und buzz.sqb nach tests/e2e/rounds/ legen (siehe tests/README.md)"); process.exit(1); }
const fs = require('fs');
const B = "http://localhost:8770";
const FILES = {
  "00 Fragensammlung/Test/01_Kuh_Mini.sqq": fs.readFileSync(ROUNDS + '/keypad.sqq', 'utf8'),
  "00 Fragensammlung/Test/02_Zehner_Mini.sqb": fs.readFileSync(ROUNDS + '/buzz.sqb', 'utf8'),
  "00 Fragensammlung/Test/03_Reserve.sqq": fs.readFileSync(ROUNDS + '/keypad.sqq', 'utf8'),
  "00 Fragensammlung/Test/Clips/01 Frage.mp3": "", "00 Fragensammlung/Test/Clips/02 Frage.mp3": "", "00 Fragensammlung/Test/Clips/10 Frage.mp3": "",
  "00 Fragensammlung/Test/Erklärung.mp4": "",
  "01 Trailer/12 Intermezzo/Sparkling Blue Background.mp4": "", "01 Trailer/12 Intermezzo/Standbild Sparkling Background.jpg": "",
  "01 Trailer/14 Jovis tanzt/Jovis tanzt_V1.1.mp4": "",
};
// Steckbriefe aus Martins Vault (nur lokal, nie ins Repo); fehlt der Vault, läuft der Test mit zwei Mini-Notes
const VAULT = require('os').homedir() + '/Library/Mobile Documents/iCloud~md~obsidian/Documents/SQUIZZZzZ Operating System';
const NOTES = fs.existsSync(VAULT)
  ? fs.readdirSync(VAULT).filter((n) => /^SQ-0\d\d-.*\.md$/.test(n)).map((n) => ({ name: n, text: fs.readFileSync(VAULT + '/' + n, 'utf8') }))
  : [{ name: 'SQ-001-Test.md', text: '---\ntyp: Spiel\nid: SQ-001\nname: Test\nmechanik: ["Buzzin"]\nmedien: Film\ndauer: "10 min"\n---\n' },
     { name: 'SQ-002-Dalli.md', text: '---\ntyp: Spiel\nid: SQ-002\nname: Dalli\nmechanik: []\nmedien: keine\n---\n' }];
// R2: echte Ordner von Dalli und Kraut und Rüben nachbilden (Dateinamen, Rundendateien mit Inhalt) – nur lokal
const FS = require('os').homedir() + '/Desktop/SQUIZZZzZ/';
function addTree(rel, depth = 4) {
  if (!fs.existsSync(FS + rel)) return false;
  for (const e of fs.readdirSync(FS + rel, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel + '/' + e.name;
    if (e.isDirectory()) { if (depth > 0) addTree(r, depth - 1); else FILES[r + '/.keep'] = ''; }
    else FILES[r] = /\.(sqq|sqb|sqn)$/i.test(e.name) ? fs.readFileSync(FS + r, 'utf8') : '';
  }
  return true;
}
const R2 = fs.existsSync(VAULT) && addTree('00 Fragensammlung/Dalli-SQUIZZZzZ') && addTree('00 Fragensammlung/Kraut und Rüben');
const EXPECT_GAMES = NOTES.filter((n) => /^typ: Spiel$/m.test(n.text)).length;
(async () => {
  const br = await chromium.launch({ executablePath: require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }); const ctx = await br.newContext(); const errs = [];
  const mk = async (n, vp) => { const p = await ctx.newPage(); await p.setViewportSize(vp); p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(n + ' console: ' + m.text())); p.on('dialog', d => d.accept()); return p; };
  const shot = async (p, n) => { await p.waitForTimeout(350); await p.screenshot({ path: `shots/plan-${n}.png`, fullPage: false }); };
  fs.mkdirSync("shots", { recursive: true });
  const host = await mk('host', { width: 1440, height: 950 });
  await host.addInitScript(({ files, notes }) => {
    window.webkit = { messageHandlers: { sqz: { postMessage: async (m) => {
      const a = m.args || {};
      if (m.cmd === 'sqNotes') return { notes, pending: [] };
      if (m.cmd === 'info') return { version: 'test', root: '/x', rootFound: true, passcodeSet: true };
      const N = (s) => s.normalize('NFC');
      if (m.cmd === 'list') { const pre = a.path ? N(a.path) + '/' : ''; const names = new Map();
        Object.keys(files).filter(k => N(k).startsWith(pre)).forEach(k => { const d = pre ? pre.split('/').length - 1 : 0, parts = k.split('/'); names.set(parts[d], parts.length > d + 1); });
        return [...names].map(([name, dir]) => ({ name, dir, size: 1000 })); }
      if (m.cmd === 'qlab') {
        const Q = window.__Q = window.__Q || { lists: [{ uniqueID: 'L1', listName: 'Main Cue List', cues: [{ uniqueID: 'OLD1', number: '1.1', name: 'alt', type: 'audio' }] }], n: 0 };
        const main = Q.lists[0];
        const find = (id, arr = main.cues) => { for (const c of arr) { if (c.uniqueID === id) return { c, arr }; if (c.cues) { const r = find(id, c.cues); if (r) return r; } } return null; };
        const byNum = (num, arr = main.cues) => { for (const c of arr) { if (c.number === num) return c; if (c.cues) { const r = byNum(num, c.cues); if (r) return r; } } };
        const ad = a.address, args = a.args || []; let data = null, mm;
        if (ad === '/showMode') data = false;
        else if (ad === '/settings/audio/patchList') data = [{ name: 'Externe Kopfhörer', uniqueID: 'P1' }, { name: 'MacBook Air-Lautsprecher', uniqueID: 'P2' }];
        else if (ad === '/settings/video/stages') data = [{ name: 'Beamer alt', uniqueID: 'S0' }, { name: 'Integriertes Retina Display', uniqueID: 'S1' }];
        else if (ad === '/cueLists') data = JSON.parse(JSON.stringify(Q.lists));
        else if (ad === '/new') { const c = { uniqueID: 'C' + (++Q.n), type: args[0], number: '', name: '' }; if (args[0] === 'group') c.cues = []; main.cues.push(c); data = c.uniqueID; }
        else if ((mm = ad.match(/^\/delete_id\/(.+)$/))) { const f = find(mm[1]); f.arr.splice(f.arr.indexOf(f.c), 1); }
        else if ((mm = ad.match(/^\/move\/(.+)$/))) { const f = find(mm[1]); f.arr.splice(f.arr.indexOf(f.c), 1); const par = args[1] === 'L1' ? main : find(args[1]).c; par.cues.splice(args[0], 0, f.c); }
        else if ((mm = ad.match(/^\/cue_id\/([^/]+)\/(\w+)$/))) { const f = find(mm[1]); if (args.length) f.c[mm[2]] = args[0]; else data = f.c[mm[2]]; }
        else if ((mm = ad.match(/^\/cue\/(.+)\/(\w+)$/))) { const c = byNum(mm[1]); data = mm[2] === 'isBroken' ? false : (c ? c[mm[2]] ?? 0 : null); }
        return JSON.stringify({ status: 'ok', data });
      }
      if (m.cmd === 'read') { const key = Object.keys(files).find(k => N(k) === N(a.path)); if (key === undefined) throw new Error('Datei nicht lesbar: ' + a.path); return files[key]; }
      throw new Error('unbekannt');
    } } } };
  }, { files: FILES, notes: NOTES });
  await host.goto(B + "/host/"); await host.evaluate(() => localStorage.clear()); await host.reload(); await host.waitForTimeout(500);
  await host.fill('#new-title', 'Plantest'); await host.fill('#wish', 'PLAN'); await host.click('#create'); await host.waitForTimeout(500);
  await host.click('a[data-tab=spieler]'); await host.fill('#add-names', 'Anna\nBen'); await host.click('#add-btn'); await host.waitForTimeout(300);
  const P = {};
  for (const n of ['Anna', 'Ben']) { const p = await mk(n, { width: 390, height: 844 }); await p.goto(`${B}/?g=PLAN`); await p.waitForTimeout(400); await p.click(`.name-btn span:text-is("${n}")`); P[n] = p; }

  // Regieplan anlegen
  await host.click('a[data-tab=regieplan]'); await host.waitForTimeout(200);
  // R1: Spieleliste aus den Steckbriefen
  await host.waitForTimeout(400);
  const gl = await host.evaluate(() => ({ n: document.querySelectorAll('#games-list .game').length, info: document.getElementById('games-info').textContent }));
  console.log('Spiele', JSON.stringify(gl), 'erwartet', EXPECT_GAMES);
  if (gl.n !== EXPECT_GAMES || !gl.info.startsWith(EXPECT_GAMES + ' Spiele')) errs.push('Spieleliste falsch: ' + JSON.stringify(gl));
  await host.fill('#games-filter', 'dalli'); await host.waitForTimeout(100);
  const gf = await host.evaluate(() => document.querySelectorAll('#games-list .game').length);
  if (gf !== 1) errs.push('Suche „dalli“ liefert ' + gf);
  await shot(host, '01b_spiele'); await host.fill('#games-filter', '');
  for (const t of ['film', 'moderation', 'runde', 'runde', 'runde', 'sieger']) { await host.click(`[data-add-block=${t}]`); await host.waitForTimeout(120); }
  const card = (i) => `#plan-list [data-i="${i}"]`;
  await host.fill(`${card(0)} [data-k=title]`, 'Vorspann'); await host.dispatchEvent(`${card(0)} [data-k=title]`, 'change');
  await host.fill(`${card(1)} [data-k=notes]`, 'Begrüßung, Ankündigung Lissi'); await host.dispatchEvent(`${card(1)} [data-k=notes]`, 'change');
  await host.waitForTimeout(200);
  // Runde 1 per Durchsuchen
  await host.click(`${card(2)} [data-act=browse][data-key=file]`); await host.waitForTimeout(300); await shot(host, '01_browse');
  await host.click('.modal li[data-name="Test"]'); await host.waitForTimeout(200); await host.click('.modal li[data-name="01_Kuh_Mini.sqq"]'); await host.waitForTimeout(500);
  // Runde 2 + Reserve per Pfad eintippen
  await host.fill(`${card(3)} [data-k=file]`, '00 Fragensammlung/Test/02_Zehner_Mini.sqb'); await host.dispatchEvent(`${card(3)} [data-k=file]`, 'change'); await host.waitForTimeout(200);
  await host.fill(`${card(4)} [data-k=file]`, '00 Fragensammlung/Test/03_Reserve.sqq'); await host.dispatchEvent(`${card(4)} [data-k=file]`, 'change'); await host.waitForTimeout(200);
  await host.check(`${card(4)} [data-k=reserve]`); await host.waitForTimeout(200);
  await host.fill(`${card(2)} [data-k="s.points"]`, '5'); await host.dispatchEvent(`${card(2)} [data-k="s.points"]`, 'change');
  await host.fill(`${card(2)} [data-k="s.duration"]`, '15'); await host.dispatchEvent(`${card(2)} [data-k="s.duration"]`, 'change'); await host.waitForTimeout(200);
  await host.selectOption(`${card(2)} [data-k=mediaType]`, 'audio'); await host.waitForTimeout(300);
  await host.fill(`${card(2)} [data-k=clipsDir]`, '/Users/martinhohmann/Desktop/SQUIZZZzZ/00 Fragensammlung/Test/Clips/'); await host.dispatchEvent(`${card(2)} [data-k=clipsDir]`, 'change'); await host.waitForTimeout(200);
  await host.fill(`${card(2)} [data-k=explain]`, '00 Fragensammlung/Test/Erklärung.mp4'); await host.dispatchEvent(`${card(2)} [data-k=explain]`, 'change'); await host.waitForTimeout(200);
  await host.click('[data-add-block=leinwand]'); await host.waitForTimeout(150); await host.click('[data-add-block=pause]'); await host.waitForTimeout(250);
  await host.click('#plan-check'); await host.waitForTimeout(800);
  console.log('check:', await host.textContent('#plan-check-msg'));
  await host.evaluate(() => document.activeElement?.blur()); await host.waitForTimeout(200);
  await shot(host, '02_regieplan');
  console.log('round1:', await host.textContent(`${card(2)} .pb-check`), '| qlab:', await host.textContent(`${card(2)} .pb-qlab`), '| path:', await host.inputValue(`${card(2)} [data-k=clipsDir]`));
  console.log('pause:', await host.textContent(`${card(7)} .pb-qlab`), await host.textContent(`${card(7)} .pb-check`));
  await host.evaluate(() => window.scrollTo(0, 0)); await shot(host, '02b_top');
  console.log('outputs:', await host.$eval('[data-out=audio]', (e) => e.options[e.selectedIndex].text), '|', await host.$eval('[data-out=video]', (e) => e.options[e.selectedIndex].text));
  await host.click('#qlab-fill'); await host.waitForTimeout(1500);
  console.log('qlab-msg:', await host.textContent('#qlab-msg'), '|', await host.textContent('#qlab-state'));
  const tree = await host.evaluate(() => { const out = []; const walk = (arr, d) => arr.forEach((c) => { out.push('  '.repeat(d) + c.number + ' ' + c.name + ' [' + c.type + (c.continueMode ? ' →' + c.continueMode : '') + (c.audioOutputPatchNumber ? ' P' + c.audioOutputPatchNumber : '') + (c.stageID ? ' ' + c.stageID : '') + '] ' + (c.fileTarget ? c.fileTarget.split('/').slice(-2).join('/') : '')); if (c.cues) walk(c.cues, d + 1); }); walk(window.__Q.lists[0].cues, 0); return out.join('\n'); });
  console.log(tree);
  await shot(host, '02c_qlab');

  // Abend abarbeiten
  await host.click('a[data-tab=spiel]'); await host.waitForTimeout(300); await host.click('#round-panel'); await shot(host, '03_spiel_start');
  const label = () => host.textContent('#rb-next-label');
  const log = [];
  for (let i = 0; i < 200; i++) {
    const l = await label(); log.push(l);
    if (/Ende des Regieplans/.test(l)) break;
    if (/Warte auf den ersten Buzz/.test(l)) { await P.Ben.click('#bz-btn'); await host.waitForTimeout(500); continue; }
    if (/R = richtig/.test(l)) { await host.keyboard.press('r'); await host.waitForTimeout(500); continue; }
    if (/Antworten schließen/.test(l)) { for (const p of Object.values(P)) { await p.click('#pic-full').catch(() => {}); await p.click('.choice >> nth=0', { timeout: 1500 }).catch(() => {}); } }
    if (i === 3) await shot(host, '04_runde_frage');
    await host.keyboard.press('Space'); await host.waitForTimeout(450);
  }
  console.log(log.join('\n'));
  await shot(host, '05_ende');
  // Reserve einschieben per Chip
  await host.click('#rb-strip [data-i="4"]'); await host.waitForTimeout(700);
  console.log('nach Reserve-Klick:', await host.textContent('#rb-title'), '|', await label(), '| live:', await host.isVisible('#round-live'));
  await shot(host, '06_reserve'); await shot(P.Anna, '07_anna');
  // R2: Runde aus Steckbrief + Deck anlegen, alles vorbelegt, sofort geprüft
  if (R2) {
    await host.click('a[data-tab=regieplan]'); await host.waitForTimeout(300);
    const before = await host.evaluate(() => document.querySelectorAll('#plan-list .pblock').length);
    const addDeck = async (id, nr) => {
      await host.click(`#games-list [data-open="${id}"]`); await host.waitForTimeout(150);
      await host.click(`#games-list [data-add="${id}:${nr}"]`); await host.waitForTimeout(1500);
    };
    await addDeck('SQ-001', '4');
    await addDeck('SQ-014', '1');
    const got = await host.evaluate((n) => [...document.querySelectorAll('#plan-list .pblock')].slice(n).map((el) => ({
      title: el.querySelector('[data-k=title]').value, file: el.querySelector('[data-k=file]')?.value, explain: el.querySelector('[data-k=explain]')?.value,
      media: el.querySelector('[data-k=mediaType]')?.value, clips: el.querySelector('[data-k=clipsDir]')?.value || '', src: el.querySelector('.pb-src')?.textContent || '',
      check: el.querySelector('.pb-check')?.textContent || '' })), before);
    console.log('R2', JSON.stringify(got, null, 1));
    const [d, k] = got;
    if (!d || !/AroundTheWorld\.sqb$/.test(d.file) || d.media !== 'video' || !/04 Around the World$/.test(d.clips) || !/n\.0 Dalli/.test(d.explain) || !/10 Clips passen/.test(d.check) || !/SQ-001 · Deck 4/.test(d.src)) errs.push('R2 Dalli falsch: ' + JSON.stringify(d));
    if (!k || !/KrautUndRueben\.sqq$/.test(k.file) || k.media !== 'none' || !/^✓/.test(k.check) || !/Tasche 29/.test(k.src)) errs.push('R2 Kraut falsch: ' + JSON.stringify(k));
    await shot(host, '20_r2_runden');
  } else console.log('R2 übersprungen (kein Vault oder Fragensammlung)');
  console.log('ERRORS', errs);
  await br.close();
})();
