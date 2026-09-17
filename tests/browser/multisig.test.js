// The Multisig page in a real Chrome: the tab, the configuration dropdown, the three owner cards,
// the flow line, the setup sheet with its predicted address. Nothing is created or sent: the sheet
// is cancelled. Needs `npm run dev` up and the Chrome that Playwright drives through its `chrome`
// channel. Skips cleanly when either is missing. Run: npm run test:browser
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

const URL = process.env.DEMO_URL || 'http://localhost:5173/'

let browser, page, errors, skip
before(async () => {
  try { await fetch(URL) } catch { skip = `dev server not reachable at ${URL}, run npm run dev`; return }
  let chromium
  try { ({ chromium } = await import('playwright')) } catch { skip = 'playwright not installed, npm install --save-dev playwright'; return }
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  } catch (e) { skip = `chrome not available: ${e.message.split('\n')[0]}`; return }
  page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
  errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
})
after(async () => { await browser?.close() })

const guard = (t) => { if (skip) { t.skip(skip); return true } return false }

test('the Multisig tab opens the page on Arbitrum with a configuration dropdown and three owners', async (t) => {
  if (guard(t)) return
  await page.goto(URL)
  await page.waitForSelector('.nav a')
  // the Safe runs on mainnet; the wallet suite may have left the testnet toggle on
  if (await page.$eval('.testnet-toggle input', i => i.checked)) await page.click('.testnet-toggle')
  await page.click('.nav a:has-text("WDK Multisig")')
  await page.waitForSelector('.ms')
  assert.equal(await page.evaluate(() => location.hash), '#multisig')
  assert.equal(await page.$eval('.topbar-title h1', h => h.textContent), 'WDK Multisig')
  const options = await page.$$eval('.select option', os => os.map(o => o.textContent))
  assert.deepEqual(options, ['Seed only', 'Multi-signer'])
  await page.waitForFunction(() => !/Loading the Safe/.test(document.querySelector('.banner')?.innerText || ''), null, { timeout: 15000 })
  assert.equal(await page.$$eval('.owner', els => els.length), 3, 'three owner cards')
})

test('the two configurations show different owners: three seed accounts, or seed plus Dfns and Openfort', async (t) => {
  if (guard(t)) return
  await page.selectOption('.select', 'seed')
  await page.waitForFunction(() => !/Loading the Safe/.test(document.querySelector('.banner')?.innerText || ''), null, { timeout: 15000 })
  const seedOwners = await page.$$eval('.owner .owner-head .label', els => els.map(e => e.textContent))
  assert.deepEqual(seedOwners, ['Seed phrase #0', 'Seed phrase #1', 'Seed phrase #2'])
  assert.deepEqual(await page.$$eval('.owner .custody', els => els.map(e => e.textContent)), ['local', 'local', 'local'])

  await page.selectOption('.select', 'mixed')
  await page.waitForFunction(() => !/Loading the Safe/.test(document.querySelector('.banner')?.innerText || ''), null, { timeout: 15000 })
  const mixed = await page.$$eval('.owner .owner-head .label', els => els.map(e => e.textContent))
  assert.deepEqual([...mixed].sort(), ['Dfns #0', 'Openfort', 'Seed phrase #0'])
  assert.deepEqual(await page.$$eval('.owner .custody', els => els.map(e => e.textContent).sort()), ['local', 'remote', 'remote'])
})

test('a registered Safe shows its banner, its flow and its proposals; an unregistered one offers the setup sheet', async (t) => {
  if (guard(t)) return
  const banner = await page.$eval('.banner', e => e.innerText)
  if (/not set up/.test(banner)) {
    await page.click('.banner .btn.primary')
    await page.waitForSelector('.modal')
    await page.waitForFunction(() => !/resolving/.test(document.querySelector('.modal')?.innerText || ''), null, { timeout: 30000 })
    const rows = await page.$$eval('.check', els => els.map(e => e.querySelector('.label').textContent))
    assert.ok(rows.includes('Seed phrase #0') && rows.includes('Seed phrase #2'), 'the seed offers its three accounts')
    await page.waitForFunction(() => /0x[0-9a-fA-F]{40}/.test(document.querySelector('.predicted')?.innerText || ''), null, { timeout: 30000 })
    await page.click('.modal .btn:has-text("Cancel")')
    assert.equal(await page.$('.modal'), null)
    return
  }
  assert.match(banner, /SAFE · MULTI-SIGNER · 2 OF 3/i)
  assert.match(banner, /0x[0-9a-fA-F]{40}/)
  await page.waitForFunction(() => /USDT0/.test(document.querySelector('.banner')?.innerText || ''), null, { timeout: 20000 })
  const steps = await page.$$eval('.step-title', els => els.map(e => e.textContent))
  assert.equal(steps.length, 3)
  assert.match(steps[0], /Proposed/)
  assert.match(steps[2], /Executed/)
  assert.ok(await page.$('.proposals'), 'the proposals list is there')
})

test('the Wallet tab brings the phone back and no page error was raised', async (t) => {
  if (guard(t)) return
  await page.click('.nav a:has-text("WDK Signers")')
  await page.waitForSelector('.phone')
  assert.equal(await page.evaluate(() => location.hash), '#wallet')
  assert.deepEqual(errors.filter(e => !/favicon|net::ERR|Failed to load resource/.test(e)), [])
})
