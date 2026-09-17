// The small helpers of src/lib, offline: recipients per network, balance and detail formatting,
// the signature normalisation and the resubmit rule of the local coordinator.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HDNodeWallet, SigningKey, keccak256, toUtf8Bytes } from 'ethers'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import { forgetRecipients, recipients, remember } from '../src/lib/recipients.js'
import { formatDetails, shortBalance } from '../src/lib/wallet.js'
import { NETWORKS } from '../src/lib/networks.js'
import LocalCoordinator from '../src/lib/safe/local-coordinator.js'

const MNEMONIC = 'test test test test test test test test test test test junk'
const key = (i) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`)

test('recipients: seed accounts resolved per network, prompting signers only once remembered, the sender excluded', async () => {
  forgetRecipients()
  let builds = 0
  const seed = { id: 'seed', label: 'Seed', key: 'local', available: true, isDerivable: true, build: async () => { builds++; return new SeedSignerEvm(MNEMONIC) } }
  const ledger = { id: 'ledger', label: 'Ledger', key: 'hardware', available: true, prompts: true, isDerivable: true, build: async () => { throw new Error('must not prompt') } }
  const broken = { id: 'broken', label: 'Broken', key: 'remote', available: true, isDerivable: false, build: async () => { throw new Error('no key') } }
  const net = NETWORKS.arbitrum

  let groups = await recipients([seed, ledger, broken], { net, exclude: key(0).address })
  assert.deepEqual(groups.map(g => [g.id, g.accounts.length, g.error]), [['seed', 1, null], ['broken', 0, 'no key']])
  assert.equal(groups[0].accounts[0].address, key(1).address, 'account 0 is the excluded sender')
  assert.equal(builds, 1)

  await recipients([seed], { net })
  assert.equal(builds, 1, 'resolved once per network')
  await recipients([seed], { net: NETWORKS.sepolia })
  assert.equal(builds, 2, 'another network is another resolution')

  remember('ledger', [{ index: 0, address: key(7).address }], net.id)
  groups = await recipients([ledger], { net })
  assert.deepEqual(groups[0].accounts, [{ index: 0, address: key(7).address }])
  assert.deepEqual(await recipients([ledger], { net: NETWORKS.sepolia }), [], 'remembered on one network only')
})

test('shortBalance and formatDetails edges', () => {
  assert.equal(shortBalance(null), null)
  assert.equal(shortBalance('0'), '0')
  assert.equal(shortBalance('0.00001'), '<0.0001')
  assert.equal(shortBalance('1.23456789'), '1.2346')
  assert.equal(shortBalance('12.5'), '12.5')
  assert.equal(shortBalance('error: rpc down'), 'error: rpc down')
  assert.equal(formatDetails({ value: 10n, nested: { gas: 21000n } }), '{\n  "value": "10",\n  "nested": {\n    "gas": "21000"\n  }\n}')
})

test('the local coordinator recovers a Safe-style signature (v + 4), refuses a stranger, keeps a resubmitted proposal', async () => {
  const owners = [key(0).address, key(1).address, key(2).address]
  const c = new LocalCoordinator({ owners })
  const id = keccak256(toUtf8Bytes('op'))
  const sign = (i) => new SigningKey(key(i).privateKey).sign(id).serialized
  const plusFour = (sig) => { const v = parseInt(sig.slice(-2), 16); return sig.slice(0, -2) + (v + 4).toString(16) }
  const proposal = (sig) => ({ userOperation: { signature: '0x' + '00'.repeat(12) + sig.slice(2) } })

  await assert.rejects(c.submitProposal(id, proposal(sign(9))), /not an owner/)
  const first = await c.submitProposal(id, proposal(plusFour(sign(0))))
  assert.equal(first.confirmations[0].owner, key(0).address, 'v 31/32 recovers like 27/28')
  await c.confirmProposal(id, plusFour(sign(1)))
  const again = await c.submitProposal(id, proposal(sign(2)))
  assert.deepEqual(again.confirmations.map(x => x.owner), [key(0).address, key(1).address], 'the same SafeOp hash keeps its confirmations')
  assert.equal(await c.getProposal(keccak256(toUtf8Bytes('other'))), null)
})
