// The Safe side of the service, offline: one Safe per network described in a file, the coordinator
// over HTTP as the Safe module calls it, owners recovered from signatures, execution recorded,
// and the owner shim built on a remote account. Nothing touches a chain or a bundler.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HDNodeWallet, SigningKey, keccak256, toUtf8Bytes } from 'ethers'
import { SeedSignerEvm } from '@tetherto/wdk-wallet-evm/signers'
import { createWallet } from '../src/lib/wallet.js'
import { NETWORKS } from '../src/lib/networks.js'
import RemoteSignerEvm from '../src/signers/remote-signer-evm.js'
import RemoteCoordinator from '../src/lib/safe/remote-coordinator.js'
import SafeOwnerAccount from '../src/lib/safe/owner-account.js'
import { predictSafeAddress, safeConfigOf } from '../src/lib/safe/config.js'
import LocalCoordinator, { proposerSignatureOf } from '../src/lib/safe/local-coordinator.js'
import { registryOf, startService } from './helpers/service.js'

const MNEMONIC = 'test test test test test test test test test test test junk'
const key = (i) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`)
// three owners: seed #0 in the browser, and two accounts of the "remote" providers (keys 4 and 5,
// so the seed-only configuration, on keys 0 to 2, is a different Safe)
const OWNERS = [
  { signerId: 'seed', index: 0, address: key(0).address },
  { signerId: 'dfns', index: 0, address: key(4).address },
  { signerId: 'openfort', index: 0, address: key(5).address }
]
const signDigest = (i, digest) => new SigningKey(key(i).privateKey).sign(digest).serialized
// a proposal as the module submits it: the proposer's signature sits in the user operation after
// validAfter and validUntil (6 bytes each)
const proposalOf = (id, proposerIndex) => ({
  entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  moduleAddress: '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226',
  safeAddress: '0x0000000000000000000000000000000000000001',
  userOperation: { sender: '0x0000000000000000000000000000000000000001', nonce: '0', callData: '0x', signature: '0x' + '00'.repeat(12) + signDigest(proposerIndex, id).slice(2) },
  options: { validAfter: 0, validUntil: 0 }
})

let dir, service, logged
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wdk-safe-'))
  logged = []
  service = await startService(registryOf([{ id: 'hd', label: 'HD', kind: 'derivable', root: new SeedSignerEvm(MNEMONIC), networks: ['sepolia', 'arbitrum'] }]), { log: m => logged.push(m), safeDir: dir })
})
after(async () => {
  await service.close()
  rmSync(dir, { recursive: true, force: true })
})

const coordinator = (config = 'mixed') => new RemoteCoordinator({ network: 'arbitrum', config, baseUrl: service.baseUrl })

test('creating the Safe: refusals first, then a description with the predicted address, kept in a file', async () => {
  const c = coordinator()
  assert.equal(await c.getSafe(), null)
  await assert.rejects(new RemoteCoordinator({ network: 'sepolia', config: 'mixed', baseUrl: service.baseUrl }).createSafe({ owners: OWNERS, threshold: 2 }), /no Safe configuration/)
  await assert.rejects(c.createSafe({ owners: OWNERS, threshold: 4 }), /threshold must be between 1 and 3/)
  await assert.rejects(c.createSafe({ owners: [...OWNERS.slice(0, 2), { signerId: 'fireblocks', address: key(3).address }], threshold: 2 }), /fireblocks is not available on Arbitrum One/)
  await assert.rejects(c.createSafe({ owners: [OWNERS[0], { signerId: 'dfns', address: OWNERS[0].address.toLowerCase() }], threshold: 1 }), /share an address/)

  const safe = await c.createSafe({ owners: OWNERS, threshold: 2 })
  assert.match(safe.address, /^0x[0-9a-fA-F]{40}$/)
  assert.equal(safe.threshold, 2)
  assert.deepEqual(safe.owners.map(o => o.signerId).sort(), ['dfns', 'openfort', 'seed'])
  assert.equal(safe.owners.map(o => o.address).join(), [...safe.owners.map(o => o.address)].sort().join(), 'owners stored sorted, as the module hashes them')
  assert.match(safe.saltNonce, /^0x/)
  assert.equal(safe.address, await predictSafeAddress(NETWORKS.arbitrum, { owners: OWNERS.map(o => o.address), threshold: 2, saltNonce: safe.saltNonce }), 'the service predicts what the module predicts')
  assert.notEqual(safe.address, await predictSafeAddress(NETWORKS.arbitrum, { owners: OWNERS.map(o => o.address), threshold: 3 }), 'the threshold is part of the address')

  await assert.rejects(c.createSafe({ owners: OWNERS, threshold: 2 }), /already exists/)
  const onDisk = JSON.parse(readFileSync(join(dir, 'arbitrum.mixed.json'), 'utf8'))
  assert.equal(onDisk.safe.address, safe.address)
  assert.deepEqual((await c.getSafe()).owners, safe.owners)

  // another configuration is another Safe: three accounts of one seed, its own file
  const seedOnly = coordinator('seed')
  assert.equal(await seedOnly.getSafe(), null)
  const s2 = await seedOnly.createSafe({ owners: [0, 1, 2].map(i => ({ signerId: 'seed', index: i, address: key(i).address })), threshold: 2 })
  assert.deepEqual(s2.owners.map(o => [o.signerId, o.index]).sort((a, b) => a[1] - b[1]), [['seed', 0], ['seed', 1], ['seed', 2]])
  assert.notEqual(s2.address, safe.address)
  assert.equal((await c.getSafe()).address, safe.address, 'the mixed Safe is untouched')
  await assert.rejects(new RemoteCoordinator({ network: 'arbitrum', config: 'Bad Name', baseUrl: service.baseUrl }).getSafe(), /bad configuration name/)
})

test('a proposal travels through the coordinator: proposer recovered, second owner confirms, a stranger is refused', async () => {
  const c = coordinator()
  const id = keccak256(toUtf8Bytes('proposal one'))
  assert.equal(await c.getProposal(id), null)

  c.describeNext({ asset: 'USDT0', amount: '0.2', recipient: key(9).address })
  const proposed = await c.submitProposal(id, proposalOf(id, 0))
  assert.equal(proposed.proposedBy.signerId, 'seed')
  assert.equal(proposed.proposedBy.owner, key(0).address)
  assert.equal(proposed.proposedBy.index, 0)
  assert.equal(proposed.status, 'pending')
  assert.equal(proposed.meta.amount, '0.2')
  assert.equal(proposed.confirmations.length, 1)

  await assert.rejects(c.confirmProposal(id, signDigest(7, id)), /not an owner of this Safe/)
  await assert.rejects(c.confirmProposal(keccak256(toUtf8Bytes('nope')), signDigest(4, id)), /unknown proposal/)

  const confirmed = await c.confirmProposal(id, signDigest(4, id))
  assert.deepEqual(confirmed.confirmations.map(x => x.signerId), ['seed', 'dfns'])
  assert.equal(confirmed.status, 'ready', '2 of 3 reached')
  assert.equal((await c.confirmProposal(id, signDigest(4, id))).confirmations.length, 2, 'confirming twice counts once')

  const stored = await c.getProposal(id)
  assert.equal(stored.userOperation.signature.length, 2 + 24 + 130)
  assert.equal(proposerSignatureOf(stored.userOperation.signature), signDigest(0, id))
  assert.equal(stored.userOperation.ethereumTxHash, undefined, 'not executed yet')
})

test('execution is recorded by the page and the module reads it as executed; the list is newest first', async () => {
  const c = coordinator()
  const first = keccak256(toUtf8Bytes('proposal one'))
  const second = keccak256(toUtf8Bytes('proposal two'))
  await c.submitProposal(second, proposalOf(second, 5))

  const done = await c.recordExecution(first, { hash: '0xuserop', by: { signerId: 'openfort', index: 0, owner: key(5).address } })
  assert.equal(done.status, 'executed')
  assert.equal(done.execution.by.signerId, 'openfort')
  assert.equal(done.userOperation.ethereumTxHash, '0xuserop', 'what the module checks for status')
  const mined = await c.recordExecution(first, { hash: '0xuserop', by: done.execution.by, txHash: '0xtx', success: true })
  assert.equal(mined.execution.at, done.execution.at, 'the receipt keeps the execution time')
  assert.equal(mined.userOperation.ethereumTxHash, '0xtx')
  await assert.rejects(c.recordExecution(keccak256(toUtf8Bytes('nope')), { hash: '0x' }), /unknown proposal/)

  const list = await c.listProposals()
  assert.deepEqual(list.map(p => [p.proposalId, p.status, p.proposedBy.signerId]), [[second, 'pending', 'openfort'], [first, 'executed', 'seed']])

  // the service restarted on the same directory sees the same Safe and proposals
  const again = await startService(registryOf([]), { safeDir: dir })
  try {
    const c2 = new RemoteCoordinator({ network: 'arbitrum', config: 'mixed', baseUrl: again.baseUrl })
    assert.equal((await c2.getSafe()).threshold, 2)
    assert.equal((await c2.listProposals()).length, 2)
  } finally {
    await again.close()
  }
})

test('messages go through the same three calls', async () => {
  const c = coordinator()
  const id = keccak256(toUtf8Bytes('hello'))
  assert.equal(await c.getMessage(id), null)
  await c.submitMessage('0x0000000000000000000000000000000000000001', id, { message: 'hello', signature: signDigest(0, id) })
  await c.confirmMessage(id, signDigest(4, id))
  assert.equal((await c.getMessage(id)).confirmations.length, 1)
  await assert.rejects(c.confirmMessage(keccak256(toUtf8Bytes('nope')), '0x'), /unknown message/)
})

test('forgetting the Safe clears the description and the proposals, the chain is untouched', async () => {
  const c = coordinator()
  await c.forgetSafe()
  assert.equal(await c.getSafe(), null)
  assert.deepEqual(await c.listProposals(), [])
  await assert.rejects(c.submitProposal(keccak256(toUtf8Bytes('x')), proposalOf(keccak256(toUtf8Bytes('x')), 0)), /no Safe for this configuration yet/)
})

test('the owner shim runs the Safe module on a remote account: the module sees the account, not a seed', async () => {
  const [hd] = await (await fetch(`${service.baseUrl}/signers`)).json()
  const handle = createWallet(new RemoteSignerEvm({ id: hd.id, path: hd.path, isDerivable: true, baseUrl: service.baseUrl, network: 'arbitrum' }), 'arbitrum')
  const remoteOwner = await handle.wallet.getAccount(1)
  await remoteOwner.getAddress() // the remote account learns its public key on first resolution
  const seedHandle = createWallet(new SeedSignerEvm(MNEMONIC), 'arbitrum')
  const seedOwner = await seedHandle.wallet.getAccount(0)

  const options = { owners: OWNERS.map(o => o.address), threshold: 2 }
  const asRemote = new SafeOwnerAccount(remoteOwner, safeConfigOf(NETWORKS.arbitrum, options, new LocalCoordinator()))
  const asSeed = new SafeOwnerAccount(seedOwner, safeConfigOf(NETWORKS.arbitrum, options, new LocalCoordinator()))

  assert.equal(await asRemote.getAddress(), await asSeed.getAddress(), 'both owners predict the same Safe')
  assert.equal(asRemote.keyPair.privateKey, null, 'the remote owner has no key in the module')
  assert.equal(Buffer.from(asRemote.keyPair.publicKey).toString('hex'), Buffer.from(remoteOwner.keyPair.publicKey).toString('hex'), 'the module reads the given account')
  assert.equal(asRemote.path, remoteOwner.path)

  asRemote.dispose()
  assert.equal(await remoteOwner.getAddress(), key(1).address, 'disposing the shim leaves the account to its wallet')
  asSeed.dispose()
  handle.wallet.dispose()
  seedHandle.wallet.dispose()
})
