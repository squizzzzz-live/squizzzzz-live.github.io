const { chromium } = require('playwright');
// Testrunden: erst tests/e2e/rounds, sonst im festen Klon auf Martins Mac (Worktrees haben keine)
const ROUNDS = [__dirname + "/rounds", require("os").homedir() + "/Desktop/SQUIZZZzZ/05 App/30 App-Repo/tests/e2e/rounds"].find((d) => require("fs").existsSync(d + "/buzz.sqb"));
if (!ROUNDS) { console.error("Testrunden fehlen: keypad.sqq und buzz.sqb nach tests/e2e/rounds/ legen (siehe tests/README.md)"); process.exit(1); }
const B = "http://localhost:8770";
(async () => {
  const br = await chromium.launch({ executablePath: require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: [] }); const ctx = await br.newContext(); const errs = [];
  const mk = async (n, vp) => { const p = await ctx.newPage(); await p.setViewportSize(vp); p.on('pageerror', e => errs.push(n + ': ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(n + ' console: ' + m.text())); return p; };
  const shot = async (p, n) => { await p.waitForTimeout(400); await p.screenshot({ path: `shots/buzz-${n}.png` }); };
  const host = await mk('host', { width: 1440, height: 950 });
  await host.goto(B + "/host/"); await host.evaluate(() => localStorage.clear()); await host.reload(); await host.waitForTimeout(500);
  await host.fill('#new-title', 'Buzztest'); await host.fill('#wish', 'BUZZ'); await host.click('#create'); await host.waitForTimeout(500);
  await host.click('a[data-tab=spieler]'); await host.waitForTimeout(200);
  await host.fill('#add-names', 'Anna\nBen\nCarla\nMoritz'); await host.click('#add-btn'); await host.waitForTimeout(300);
  await host.fill('#team-name', 'Rot'); await host.click('#team-add'); await host.fill('#team-name', 'Blau'); await host.click('#team-add'); await host.waitForTimeout(300);
  const sels = host.locator('#p-rows select.team-sel'); // Anna Rot, Ben Blau, Carla Rot, Moritz Blau
  const order = ['Rot','Blau','Rot','Blau']; for (let i = 0; i < 4; i++) await sels.nth(i).selectOption({ label: order[i] });
  const P = {};
  for (const n of ['Anna','Ben','Carla','Moritz']) { const p = await mk(n, { width: 390, height: 844 }); await p.goto(`${B}/?g=BUZZ`); await p.waitForTimeout(400); await p.click(`.name-btn span:text-is("${n}")`); P[n] = p; }
  await host.click('a[data-tab=rezeption]'); await host.waitForTimeout(200); await host.click('#sound-btn'); await host.waitForTimeout(1500); console.log('audio state', await host.evaluate(() => document.getElementById('sound-chip').textContent)); await shot(host, '00_rezeption_sound');
  await host.click('a[data-tab=spiel]'); await host.setInputFiles('#round-file', ROUNDS + '/buzz.sqb'); await host.click('#round-load'); await host.waitForTimeout(700);
  await host.selectOption('#lock-who', 'team'); await host.selectOption('#lock-len', '2');
  await shot(host, '01_ready');
  await host.click('#b-open'); await host.waitForTimeout(500); await shot(P.Anna, '02_anna_buzz');
  await Promise.all([P.Moritz.click('#bz-btn'), P.Anna.waitForTimeout(60).then(() => P.Anna.click('#bz-btn', { force: true, timeout: 2000 }).catch(() => {}))]); await host.waitForTimeout(700);
  console.log('played', JSON.stringify(await host.evaluate(() => globalThis.__sqzLastPlay)));
  // Blitz nur beim Schnellsten (Moritz), nicht bei den anderen
  const flash = async (p) => p.evaluate(() => document.getElementById('buzzflash')?.classList.contains('on'));
  const fl = { Moritz: await flash(P.Moritz), Anna: await flash(P.Anna) }; console.log('flash', JSON.stringify(fl));
  if (!fl.Moritz || fl.Anna) errs.push('Blitz falsch: ' + JSON.stringify(fl));
  await shot(host, '03_host_buzzed'); await shot(P.Ben, '04_ben_dran'); await shot(P.Anna, '05_anna_other');
  await host.click('#b-wrong'); await host.waitForTimeout(700);
  await shot(P.Moritz, '06_moritz_locked'); await shot(P.Anna, '07_anna_reopen'); await shot(host, '08_host_after_wrong');
  await P.Carla.click('#bz-btn'); await host.waitForTimeout(700); await host.keyboard.press('r'); await host.waitForTimeout(700);
  await shot(P.Carla, '09_carla_reveal'); await shot(P.Ben, '10_ben_reveal'); await host.check('#sb-show'); await shot(host, '11_host_reveal');
  await host.click('#q-next'); await host.waitForTimeout(400); await host.click('#b-open'); await host.waitForTimeout(500); await shot(P.Moritz, '12_moritz_still_locked_q2');
  await shot(host, '13_host_q2');
  await host.locator('#b-locks button').first().click(); await host.waitForTimeout(500); await shot(host, '14_host_unlock');
  await host.click('#q-next').catch(()=>{});
  // Springen
  await host.selectOption('#q-jump', '5'); await host.waitForTimeout(400); console.log('jump pos:', await host.textContent('#r-pos'));
  await host.click('#round-unload'); await host.click('#round-unload'); await host.waitForTimeout(500);
  // Spontan
  await host.click('#otf-start'); await host.waitForTimeout(500); await shot(host, '20_otf_empty');
  await host.selectOption('#otf-type', 'multi'); await host.fill('#otf-text', 'Welches Team gewinnt heute?'); await host.click('#otf-go'); await host.waitForTimeout(600);
  await shot(P.Anna, '21_anna_otf_mc'); await P.Anna.click('.choice >> nth=1'); await P.Carla.click('.choice >> nth=2');
  await host.click('#q-close'); await host.waitForTimeout(300); await host.click('#q-reveal'); await host.waitForTimeout(400);
  console.log('err without key:', await host.textContent('#error'));
  await host.fill('#q-key', 'B'); await host.dispatchEvent('#q-key', 'change'); await host.waitForTimeout(400); await host.click('#q-reveal'); await host.waitForTimeout(500);
  await shot(P.Anna, '22_anna_otf_reveal'); await shot(host, '23_host_otf_reveal');
  await host.click('#otf-toggle'); await host.selectOption('#otf-type', 'buzz'); await host.fill('#otf-sol', 'Paris'); await host.click('#otf-go'); await host.waitForTimeout(600);
  await P.Carla.click('#bz-btn'); await host.waitForTimeout(600); await shot(P.Anna, '24_anna_otf_buzzed'); await shot(host, '25_host_otf_buzzed');
  console.log('ERRORS', errs); await br.close();
})();
