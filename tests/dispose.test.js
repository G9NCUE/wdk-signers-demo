// Dispose ownership, the property tetherto/wdk-playground PR #21 checks: switching signer disposes the
// previous wallet, its accounts stop signing, key material is gone, and a remote signer stops calling
// the service. Nothing else keeps a handle on a key.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import { createWallet, loadAccounts } from '../src/lib/wallet.js'
import RemoteSignerEvm from '../src/signers/remote-signer-evm.js'
import { registryOf, startService } from './helpers/service.js'

const MNEMONIC = 'test test test test test test test test test test test junk'

let service, calls
before(async () => {
  calls = 0
  const root = new SeedSignerEvm(MNEMONIC)
  service = await startService(registryOf([{ id: 'hd', label: 'HD', kind: 'derivable', root }]))
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, opts) => { if (String(url).includes(service.baseUrl)) calls++; return realFetch(url, opts) }
})
after(() => service.close())

test('a disposed wallet keeps no usable key: accounts refuse to sign, the seed signer is cleared', async () => {
  const handle = createWallet(new SeedSignerEvm(MNEMONIC))
  const [a0, a1] = await loadAccounts(handle, 2)
  await a0.account.sign('before')
  const before = a0.account.keyPair.privateKey
  assert.ok(before && before.length === 32, 'a live seed account exposes its 32-byte key')

  handle.wallet.dispose()

  for (const a of [a0, a1]) {
    let cleared
    try {
      const pk = a.account.keyPair.privateKey
      cleared = pk == null || (typeof pk.every === 'function' && pk.every(b => b === 0))
    } catch {
      cleared = true // keyPair unavailable once disposed
    }
    assert.equal(cleared, true, `account ${a.index}: key material gone after dispose`)
    await assert.rejects(a.account.sign('after'), /dispos|null|not|invalid/i, `account ${a.index}: signing refused after dispose`)
  }
})

test('a disposed remote signer makes no further call to the service', async () => {
  const [s] = await (await fetch(`${service.baseUrl}/signers`)).json()
  const handle = createWallet(new RemoteSignerEvm({ id: s.id, path: s.path, isDerivable: s.isDerivable, baseUrl: service.baseUrl }))
  const [a0] = await loadAccounts(handle, 1)
  await a0.account.sign('before')
  const seen = calls
  handle.wallet.dispose()
  await assert.rejects(a0.account.sign('after'), /disposed/)
  await assert.rejects(a0.account.getAddress().then(() => a0.account.signTypedData({ domain: {}, types: { A: [{ name: 'x', type: 'uint8' }] }, message: { x: 1 } })), /disposed/)
  assert.equal(calls, seen, 'no HTTP call after dispose')
})

test('the previous wallet is disposed before the next one is built, as the app does on a switch', async () => {
  const first = createWallet(new SeedSignerEvm(MNEMONIC))
  const [a] = await loadAccounts(first, 1)
  first.wallet.dispose()
  const second = createWallet(new SeedSignerEvm(MNEMONIC))
  const [b] = await loadAccounts(second, 1)
  assert.equal(await b.account.getAddress(), a.address, 'same seed, same address')
  await b.account.sign('second wallet works')
  await assert.rejects(a.account.sign('first is dead'))
  second.wallet.dispose()
})
