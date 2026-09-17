// The phone in a real Chrome: pick a signer, see the accounts, balances and history, sign a message,
// sign a populated transaction, read the log. Nothing is broadcast. Needs `npm run dev` up and the
// Chrome that Playwright drives through its `chrome` channel. Skips cleanly when either is missing.
// Run: npm run test:browser
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

const URL = process.env.DEMO_URL || 'http://localhost:5173/'
const SIGNER = process.env.DEMO_SIGNER || 'Dfns'

let browser, page, errors, skip
before(async () => {
  try { await fetch(URL) } catch { skip = `dev server not reachable at ${URL}, run npm run dev`; return }
  let chromium
  try { ({ chromium } = await import('playwright')) } catch { skip = 'playwright not installed, npm install --save-dev playwright'; return }
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch (e) { skip = `chrome not available: ${e.message.split('\n')[0]}`; return }
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
  errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
})
after(async () => { await browser?.close() })

const guard = (t) => { if (skip) { t.skip(skip); return true } return false }

test('the picker lists the seven signers with their custody badge', async (t) => {
  if (guard(t)) return
  await page.goto(URL)
  await page.waitForSelector('.chip')
  // the suite runs on the testnet; the default is mainnet, behind the toggle
  if (!(await page.$eval('.testnet-toggle input', i => i.checked))) await page.click('.testnet-toggle')
  await page.waitForFunction(() => document.querySelector('.tile .status-pill')?.textContent === 'Sepolia')
  await page.click('.chip')
  await page.waitForSelector('.sheet')
  const rows = await page.$$eval('.signer', els => els.map(b => [b.querySelector('.label').textContent, b.querySelector('.where').textContent, !b.disabled]))
  assert.deepEqual(rows.map(r => r[0]), ['Seed phrase', 'Ledger', 'MetaMask', 'Turnkey', 'Dfns', 'Openfort', 'Fireblocks'])
  assert.deepEqual(rows.map(r => r[1]), ['local', 'hardware', 'extension', 'remote', 'remote', 'remote', 'remote'])
  assert.equal(rows[0][2], true, 'the seed signer is always available')
})

test(`${SIGNER}: accounts, balances and history load on the phone`, async (t) => {
  if (guard(t)) return
  const row = await page.$(`.signer:has-text("${SIGNER}")`)
  if (await row.isDisabled()) return t.skip(`${SIGNER} is unavailable: ${await row.$eval('.reason', e => e.textContent)}`)
  await row.click()
  await page.waitForSelector('.state-dot.ready', { timeout: 60000 })
  await page.waitForFunction(() => /ETH/.test(document.querySelector('.tile-value')?.textContent || ''), null, { timeout: 30000 })
  const address = await page.$eval('.tile .addr code', c => c.getAttribute('title'))
  assert.match(address, /^0x[0-9a-fA-F]{40}$/)
  const pills = await page.$$eval('.pill', p => p.length)
  assert.ok(pills === 0 || pills === 3, 'three accounts for a derivable signer, none shown for a single key')
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('.history')?.innerText || ''), null, { timeout: 30000 })
  const history = await page.$eval('.history', e => e.innerText)
  assert.match(history, /History|HISTORY/)
  assert.match(history, /via Blockscout|VIA BLOCKSCOUT/)
})

test(`${SIGNER}: sign message and sign tx succeed and land in the log with their details`, async (t) => {
  if (guard(t)) return
  if (!(await page.$('.state-dot.ready'))) return t.skip('no signer ready')
  for (const [button, pattern] of [['Sign message', /message signed/], ['Sign tx', /transaction signed, not sent/]]) {
    const before = await page.$$eval('.log li', l => l.length)
    await page.click(`.action:has-text("${button}")`)
    await page.waitForFunction((n) => document.querySelectorAll('.log li').length > n, before, { timeout: 60000 })
    const text = await page.$eval('.log li:first-child .what', e => e.textContent)
    if (/quota|Resource exhausted/i.test(text)) return t.skip(`${SIGNER}: provider quota, ${text}`)
    assert.match(text, pattern)
    await page.click('.log li:first-child .row')
    const details = JSON.parse(await page.$eval('.log li:first-child .details', d => d.textContent))
    assert.ok(details.address && details.signature, `${button}: details carry the address and the signature`)
    if (button === 'Sign tx') assert.equal(details.recovered, details.address)
  }
})

test(`${SIGNER}: the send sheet lists the other demo accounts, then is cancelled, nothing sent`, async (t) => {
  if (guard(t)) return
  if (!(await page.$('.state-dot.ready'))) return t.skip('no signer ready')
  const sender = await page.$eval('.tile .addr code', c => c.getAttribute('title'))
  await page.click('.action:has-text("Send")')
  await page.waitForSelector('.targets')
  await page.waitForFunction(() => !/Resolving/.test(document.querySelector('.sheet')?.innerText || ''), null, { timeout: 60000 })
  const targets = await page.$$eval('.target', ts => ts.map(t => [t.getAttribute('title'), t.closest('li').querySelector('.label').textContent]))
  assert.ok(targets.length >= 2, 'at least the seed accounts are offered')
  assert.ok(targets.some(([, label]) => label === 'Seed phrase'), 'the seed accounts are always there')
  assert.ok(targets.every(([addr]) => addr.toLowerCase() !== sender.toLowerCase()), 'the sender is never a target')
  const primary = await page.$eval('.btn.primary', b => [b.textContent, b.disabled])
  assert.match(primary[0], /^Send 0\.0005 ETH to /)
  assert.equal(primary[1], false)
  await page.fill('.field input', '0.001')
  assert.match(await page.$eval('.btn.primary', b => b.textContent), /^Send 0\.001 ETH to /)
  const logBefore = await page.$$eval('.log li', l => l.length)
  await page.click('.btn:has-text("Cancel")')
  assert.equal((await page.$$('.targets')).length, 0, 'sheet closed')
  assert.equal(await page.$$eval('.log li', l => l.length), logBefore, 'nothing was sent')
})

test('the testnet toggle off puts the seed signer on Arbitrum with USDT0 balances and a gasless USDT0 send', async (t) => {
  if (guard(t)) return
  // the seed signer is on every network; the default browser signer may not be
  await page.click('.chip'); await page.waitForSelector('.sheet')
  await page.click('.sheet .signer:has-text("Seed phrase")')
  await page.waitForSelector('.state-dot.ready', { timeout: 60000 })
  await page.click('.tile .status-pill')
  await page.waitForSelector('.sheet')
  assert.deepEqual(await page.$$eval('.sheet .signer .label', els => els.map(e => e.textContent)), ['Sepolia'], 'testnet mode lists the testnets')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.testnet-toggle')
  await page.waitForSelector('.state-dot.ready', { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('.tokens')?.textContent.includes('USDT0'), null, { timeout: 30000 })
  assert.equal(await page.$eval('.tile .status-pill', e => e.textContent), 'Arbitrum One')
  await page.click('.action:has-text("Send")')
  await page.waitForSelector('.targets')
  await page.waitForFunction(() => !/Resolving/.test(document.querySelector('.sheet')?.innerText || ''), null, { timeout: 60000 })
  assert.deepEqual(await page.$$eval('.assets .pill', p => p.map(x => x.textContent)), ['ETH', 'USDT0'])
  assert.match(await page.$eval('.btn.primary', b => b.textContent), /^Send 1 USDT0 to .*, gasless$/)
  await page.click('.btn:has-text("Cancel")')
  await page.click('.tile .status-pill')
  assert.deepEqual(await page.$$eval('.sheet .signer .label', els => els.map(e => e.textContent)), ['Arbitrum One'], 'mainnet mode lists the mainnets')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.sheet', { state: 'detached' })
  await page.click('.testnet-toggle')
  await page.waitForSelector('.state-dot.ready', { timeout: 60000 })
  assert.equal(await page.$eval('.tile .status-pill', e => e.textContent), 'Sepolia')
})

test('no page errors during the run', (t) => {
  if (guard(t)) return
  assert.deepEqual(errors, [])
})
