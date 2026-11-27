// Mocked order-unlock checks for this quiz. Synthetic ids only.
// Chrome is pinned to 127.0.0.1 for the vault, the order host, and Mantle,
// so a missed mock cannot redeem a real order or code.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const VAULT_HOST = 'snappy-tundra-7uesdvk.tmp.now';
const API = 'https://' + API_HOST;
const VAULT = 'https://' + VAULT_HOST;
const ORDER = 'P847291038475610293';
const ORDER2 = 'P640281937465028173';
const CODE = 'LVABCD';
const PORT = 8944;
const BASE = `http://127.0.0.1:${PORT}/`;
const ART = '/opt/cursor/artifacts';

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER) || patternError(ORDER2)) throw new Error('synthetic order is not a legal id');
if (!/^LV[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    vaultMode: 'ok',
    vaultRemaining: 2,
    posts: 0,
    peeks: 0,
    vaultPosts: 0,
    vaultGets: 0,
    mantleGets: 0,
    mantleDecr: 0,
    mantleIncr: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handleVault(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' ' + u.pathname + u.search);
  if (u.pathname === '/order/get' || u.pathname === '/order/redeem' || u.pathname.includes('/orders/')) {
    state.unexpected.push('vault-order ' + req.method() + ' ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (u.pathname === '/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === 'down') {
      await req.abort('failed');
      return;
    }
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted' });
    return send(req, 200, { ok: true, remaining: state.vaultRemaining, max: 3 });
  }
  if (u.pathname === '/get') {
    state.vaultGets++;
    const quiz = u.searchParams.get('quiz');
    if (quiz !== 'values') return send(req, 400, { ok: false, error: 'invalid' });
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    return send(req, 200, { ok: true, remaining: state.vaultRemaining, max: 3 });
  }
  state.unexpected.push('vault ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        await req.continue();
        return;
      }
      if (u.hostname === VAULT_HOST) return await handleVault(req, u, state);
      if (u.hostname === API_HOST || u.hostname.endsWith('.vercel.app')) {
        state.urls.push(req.method() + ' ' + u.hostname + u.pathname + u.search);
        state.posts += u.pathname === '/order/redeem' ? 1 : 0;
        state.peeks += u.pathname === '/order/get' ? 1 : 0;
        state.unexpected.push('vercel ' + req.method() + ' ' + u.pathname);
        await req.abort('failed');
        return;
      }
      if (u.hostname === 'mantledb.sh') {
        state.urls.push(req.method() + ' mantle ' + u.pathname);
        if (req.method() === 'GET') state.mantleGets++;
        if (req.method() === 'POST' && u.pathname.includes('/increment/')) {
          const body = JSON.parse(req.postData() || '{}');
          if (body.by === -1) state.mantleDecr++;
          else if (body.by === 1) state.mantleIncr++;
        }
        state.unexpected.push('mantle ' + req.method() + ' ' + u.pathname);
        await req.abort('failed');
        return;
      }
      state.unexpected.push(u.hostname + req.url());
      await req.abort('failed');
    } catch (e) {
      state.unexpected.push('handler ' + e.message);
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      posts: state.posts, peeks: state.peeks,
      vaultPosts: state.vaultPosts, vaultGets: state.vaultGets,
      mantleGets: state.mantleGets, mantleDecr: state.mantleDecr, mantleIncr: state.mantleIncr,
      bodies: state.bodies, urls: state.urls, unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    ans = Array(QS.length).fill(3);
    qi = QS.length - 1;
    finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#qno', (el) => el.textContent);
  await page.click('#opts .opt');
  await page.waitForFunction((prev) => document.getElementById('qno').textContent !== prev, { timeout: 3000 }, before);
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    let max = 0;
    let min = 0;
    let offender = '';
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right > max) {
        max = r.right;
        offender = (el.id || el.className || el.tagName).toString().slice(0, 80);
      }
      if (r.left < min) min = r.left;
    }
    const input = document.getElementById('codeInput');
    const inputFit = !input || input.getClientRects().length === 0
      ? null
      : input.scrollWidth <= input.clientWidth + 2;
    return { vw, max: Math.round(max), min: Math.round(min), offender, inputFit, overflow: max > vw + 1 || min < -1 };
  });
}

async function shot(page, name) {
  await mkdir(ART, { recursive: true });
  await page.screenshot({ path: join(ART, name), fullPage: false });
}

async function newPage(browser, state, opts = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__test_ready')) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__test_ready', '1');
    } catch (e) {}
  });
  await page.setViewport(opts.viewport || { width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(BASE + (opts.path || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemVault === 'function' && typeof shownOrderUses === 'function');
  return { page, errors };
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => /\/orders\/|\/order\/|vercel|mantle/i.test(u));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.posts === 0 && state.peeks === 0 && state.vaultPosts === 0 && state.vaultGets === 0, msg, state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, msg, state);
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('format helpers reject patterns and keep LV codes off the order path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order, other) => ({
    good: orderFormatError(order),
    other: orderFormatError(other),
    repeat: orderFormatError('P111111111111111111'),
    seq: orderFormatError('P123456789012345678'),
    pasted: classifyInput(' 「p8472-9103-8475-610293」 '),
    code: classifyInput(' lv ab cd '),
    junk: classifyInput('hello'),
    badCode: classifyInput('LVIIII'),
    shortP: classifyInput('P12345'),
    quiz: QUIZ_KEY,
    api: API_BASE,
    vault: LEGACY_API_BASE,
    usesKey: ORDER_USES_KEY,
    p19: orderFormatError('P9900000000000001378'),
    p19c: classifyInput('P9900000000000001378').type,
    copy: orderSuccessText({ ok: true, uses: 1, remaining: 2 }),
    lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0 }),
    laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0 }),
    paid: redeemOrder(order).paidVerified,
    separate: redeemOrder(other).uses,
    again: redeemOrder(order).uses,
    stored: JSON.parse(localStorage.getItem(ORDER_USES_KEY)),
    foreign: localStorage.getItem('soft_persimmon_order_uses'),
  }), ORDER, ORDER2);
  assert(out.good === '' && out.other === '', 'legal synthetic id rejected');
  assert(out.repeat === 'invalid' && out.seq === 'invalid', 'pattern ids should be invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced LV code ' + JSON.stringify(out.code));
  assert(out.junk.type === 'order-invalid' && out.badCode.type === 'order-invalid' && out.shortP.type === 'order-invalid', 'classifier mixed');
  assert(out.quiz === 'values' && out.api === API && out.vault === VAULT, 'quiz/api constants');
  assert(out.usesKey === 'love_values_order_uses', out.usesKey);
  assert(out.p19 === 'invalid' && out.p19c === 'order-invalid', '19-digit id must stay invalid');
  assert(out.copy === '验证成功，还可以测 2 次', out.copy);
  assert(out.lastCopy === '验证成功，这是最后一次', out.lastCopy);
  assert(out.laterCopy === '验证成功', out.laterCopy);
  assert(out.paid === false, 'paidVerified must stay false');
  assert(out.separate === 1 && out.again === 2, 'counts must be stored per order id ' + JSON.stringify(out.stored));
  assert(out.stored[ORDER] === 2 && out.stored[ORDER2] === 1 && out.foreign == null, 'storage key ' + JSON.stringify(out.stored));
  assertNoOrderNet(state, 'format checks and the local counter must not hit the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('first unlock, refresh, continue', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const visible = await page.evaluate(() => document.body.innerText);
  assert(!visible.includes('验证码') && !visible.includes('已付款') && !visible.includes('paidVerified'), 'start copy');
  assert(visible.includes('恋爱观匹配度测试'), 'product title');
  await openAndSubmit(page, ' 「p8472-9103-8475-610293」 ');
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'first start should display one use');
  assertNoOrderNet(state, 'first start must not call the network');
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次' && !toast.includes('付款'), 'success copy ' + toast);
  const known = await page.evaluate(() => QS.some((q) => q.t === document.getElementById('qtext').textContent));
  assert(known, 'first question is not one of this quiz questions');
  const prog1 = await page.$eval('#qprog', (el) => el.textContent);
  assert(prog1 === '1 / 18', prog1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'refresh at question 1 must not change the display count');
  assertNoOrderNet(state, 'refresh must not call the network');
  await answerOne(page);
  await answerOne(page);
  const prog = await page.$eval('#qprog', (el) => el.textContent);
  assert(prog === '3 / 18', 'progress ' + prog);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    qi,
    a0: ans[0],
    a1: ans[1],
  }));
  assert(resumed.prog === '3 / 18' && resumed.qi === 2 && resumed.a0 === 1 && resumed.a1 === 1, 'mid refresh ' + JSON.stringify(resumed));
  assert(await shownUses(page) === 1, 'mid refresh must not change the display count');
  assertNoOrderNet(state, 'mid refresh must not call the network');
  await page.click('#qback');
  await page.click('#qback');
  await page.click('#qback');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    sel: document.querySelectorAll('#opts .opt.sel').length,
    a0: ans[0],
  }));
  assert(cont.prog === '1 / 18' && cont.sel === 1 && cont.a0 === 1, 'continue kept this attempt ' + JSON.stringify(cont));
  assert(await shownUses(page) === 1, 'continue must not change the display count');
  assertNoOrderNet(state, 'continue must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('result refresh and view-last do not advance; retest does; later entry still starts', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstIndex = await page.$eval('.index-num', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const peeked = await page.$eval('.index-num', (el) => el.textContent);
  assert(peeked === firstIndex, 'result refresh changed the index');
  assert(await shownUses(page) === 1, 'result refresh changed the display count');
  assertNoOrderNet(state, 'result refresh must not call the network');

  await page.click('#btnViewLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, 'view last changed the display count');
  assertNoOrderNet(state, 'view last must not call the network for an order');

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 2, 'retest should display the second use');
  const secondToast = await page.$eval('#toast', (el) => el.textContent);
  assert(secondToast === '验证成功，还可以测 1 次', secondToast);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('qprog').textContent, len: ans.length }));
  assert(restarted.prog === '1 / 18' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 3, 'third displayed use');
  const thirdToast = await page.$eval('#toast', (el) => el.textContent);
  assert(thirdToast === '验证成功，这是最后一次', thirdToast);
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功');
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
    blocked: document.body.innerText.includes('次数已经用完') || document.body.innerText.includes('暂时验证不了'),
  }), ORDER);
  assert(after.quiz, 'a later entry must still open the quiz');
  assert(after.toast === '验证成功' && !after.toast.includes('用完') && !after.toast.includes('暂时验证不了'), after.toast);
  assert(after.blocked === false, 'format-valid id must not show a hard block');
  assert(await shownUses(page) === 4, 'later entry still records a display count');
  assertNoOrderNet(state, 'later entry must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('19-digit, repeating, and sequence ids are rejected locally', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'P123456789012345678');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.$eval('#codeInput', (el) => { el.value = 'P9900000000000001378'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.$eval('#codeInput', (el) => { el.value = 'P111111111111111111'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.$eval('#codeInput', (el) => { el.value = 'hello'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  const gate = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    uses: shownOrderUses(id),
    raw: localStorage.getItem(ORDER_USES_KEY),
  }), ORDER);
  assert(!gate.quiz && gate.uses === 0 && gate.raw == null, 'rejected id started the quiz ' + JSON.stringify(gate));
  assertNoOrderNet(state, 'invalid input reached the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('access code hits the vault and does not call Mantle or an order endpoint', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ' lv ab cd ');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.bodies[0].quiz === 'values' && state.bodies[0].code === CODE, 'vault body', state);
  assert(!('orderId' in state.bodies[0]), 'legacy redeem must not send orderId', state);
  assert(state.vaultGets === 0 && state.posts === 0 && state.peeks === 0, 'code unlock must not peek or call /order', state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, 'this quiz must not touch Mantle', state);
  assert(state.unexpected.length === 0, 'unexpected', state);
  assert(state.urls.some((u) => u.startsWith('POST /redeem')), 'vault url', state);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次', toast);
  const stored = await page.evaluate(() => localStorage.getItem(ORDER_USES_KEY));
  assert(stored == null, 'a vault code must not write the order display count');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();

  const miss = freshState();
  miss.vaultMode = 'not_found';
  const missed = await newPage(browser, miss);
  await openAndSubmit(missed.page, CODE);
  await missed.page.waitForFunction(() => document.getElementById('toast').textContent.includes('验证码不正确'));
  const onQuiz = await missed.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz && miss.vaultPosts === 1, 'vault miss should not start', miss);
  assert(miss.mantleGets === 0 && miss.mantleDecr === 0 && miss.posts === 0 && miss.unexpected.length === 0, 'vault miss must not fall through', miss);
  await missed.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const second = await newPage(browser, done);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('此验证码已用完'));
  const blocked = await second.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!blocked && done.vaultPosts === 1 && done.mantleDecr === 0 && done.unexpected.length === 0, 'exhausted vault stays on the vault', done);
  await second.page.close();

  const down = freshState();
  down.vaultMode = 'down';
  const offline = await newPage(browser, down);
  await openAndSubmit(offline.page, CODE);
  await offline.page.waitForFunction(() => document.getElementById('toast').textContent.includes('网络异常'));
  assert(await offline.page.evaluate(() => !isUnlocked()), 'vault outage unlocked');
  assert(down.mantleGets === 0 && down.unexpected.length === 0, 'vault outage must not call Mantle', down);
  await offline.page.close();
});

test('saved order result stays available with no server', async (browser) => {
  const state = freshState();
  const { page } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const revealed = await page.evaluate(() => document.getElementById('result').classList.contains('active') && isUnlocked());
  assert(revealed, 'saved order result did not come back');
  assert(await shownUses(page) === 1, 'restoring a result changed the display count');
  assertNoOrderNet(state, 'restoring a result must not call the network');
  await page.close();
});

test('query string does not send an order request', async (browser) => {
  const order = freshState();
  const p1 = await newPage(browser, order, { path: '?code=' + ORDER });
  await p1.page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  const idle = await p1.page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    uses: shownOrderUses(id),
  }), ORDER);
  assert(!idle.quiz && idle.uses === 0, 'query order must not auto-start ' + JSON.stringify(idle));
  assertNoOrderNet(order, 'query order must not call the network');
  await p1.page.close();

  const code = freshState();
  const p2 = await newPage(browser, code, { path: '?code=' + CODE });
  await p2.page.waitForSelector('#codeMask.show');
  assert(code.vaultPosts === 0 && code.unexpected.length === 0, 'query code must not redeem before submit', code);
  const prefill = await p2.page.$eval('#codeInput', (el) => el.value);
  assert(prefill === CODE, 'query code prefill ' + prefill);
  await p2.page.click('#btnCodeOk');
  await waitQuiz(p2.page);
  assert(code.vaultPosts === 1 && code.bodies[0].code === CODE && code.bodies[0].quiz === 'values' && code.posts === 0, 'submitted query code uses the vault', code);
  assert(code.mantleGets === 0 && code.unexpected.length === 0, 'submitted query code must not call Mantle', code);
  await p2.page.close();
});

test('order gate copy at 320 and 390', async (browser) => {
  for (const width of [320, 390]) {
    const state = freshState();
    const { page, errors } = await newPage(browser, state, { viewport: { width, height: 780, isMobile: true, hasTouch: true } });
    let box = await overflow(page);
    assert(!box.overflow, width + ' start overflow ' + JSON.stringify(box));
    await shot(page, `love-values-${width}-start.png`);
    await page.click('#btnStart');
    await page.waitForSelector('#codeMask.show');
    await page.$eval('#codeInput', (el, v) => { el.value = v; }, ORDER);
    box = await overflow(page);
    assert(!box.overflow, width + ' modal overflow ' + JSON.stringify(box));
    assert(box.inputFit === true, width + ' order id clipped in the field ' + JSON.stringify(box));
    const gate = await page.evaluate(() => ({
      title: document.querySelector('.code-panel h3').textContent,
      hint: document.querySelector('.code-hint').innerText,
      placeholder: document.getElementById('codeInput').placeholder,
    }));
    assert(gate.title === '输入订单号', gate.title);
    assert(gate.hint.includes('我的订单') && gate.hint.includes('3 次'), gate.hint);
    assert(gate.placeholder === '订单号', gate.placeholder);
    assert(!gate.hint.includes('本地') && !gate.hint.includes('假'), gate.hint);
    await shot(page, `love-values-${width}-order.png`);
    await page.evaluate(() => {
      closeCodeModal();
      const scores = {};
      DIM_IDS.forEach((id) => { scores[id] = 60; });
      renderResult(analyze(scores));
      show('result');
    });
    box = await overflow(page);
    assert(!box.overflow, width + ' result overflow ' + JSON.stringify(box));
    const retry = await page.$eval('#btnRetry', (el) => el.textContent);
    assert(retry === '重新测试', retry);
    await shot(page, `love-values-${width}-result.png`);
    assertNoOrderNet(state, 'layout pass must not call the network');
    assert(errors.length === 0, errors.join('\n'));
    await page.close();
  }
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 300));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${API_HOST} 127.0.0.1, MAP ${VAULT_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
