// A multisig coordinator that keeps proposals in memory (or in any store with get/set), instead of
// the Safe Transaction Service. Same six methods as IMultisigCoordinator, same shapes as the service
// returns: a proposal carries `userOperation` and `confirmations: [{ owner, signature }]`.
// Owners are recovered from their signature over the SafeOp hash, which is the proposal id.
import { IMultisigCoordinator } from '@tetherto/wdk-protocol-multisig-safe'
import { getAddress, recoverAddress } from 'ethers'

export default class LocalCoordinator extends IMultisigCoordinator {
  // store: { get(key), set(key, value) } async or not; a Map by default
  constructor ({ store = new Map(), owners = [] } = {}) {
    super()
    this._store = store
    this._owners = owners.map(o => getAddress(o))
  }

  // a proposal id is the SafeOp hash: submitting it again is the same operation, its confirmations stay
  async submitProposal (proposalId, proposal) {
    const known = await this.getProposal(proposalId)
    if (known) return known
    const raw = proposerSignatureOf(proposal.userOperation.signature)
    const owner = this._recover(proposalId, raw)
    const record = { ...proposal, proposalId, confirmations: [{ owner, signature: raw, at: new Date().toISOString() }], createdAt: new Date().toISOString() }
    await this._store.set(proposalId, record)
    return record
  }

  async getProposal (proposalId) {
    return (await this._store.get(proposalId)) ?? null
  }

  async confirmProposal (proposalId, signature) {
    const record = await this.getProposal(proposalId)
    if (!record) throw new Error(`unknown proposal ${proposalId}`)
    const owner = this._recover(proposalId, signature)
    if (record.confirmations.some(c => c.owner === owner)) return record
    record.confirmations.push({ owner, signature, at: new Date().toISOString() })
    await this._store.set(proposalId, record)
    return record
  }

  // the module submits `{ message, signature }` and reads `record.message` back to hash it, so the
  // message is kept as it was given and the proposer's signature is the first confirmation, as the
  // Safe Transaction Service does; a message id is the hash the owners sign
  async submitMessage (safeAddress, messageId, { message, signature }) {
    const known = await this.getMessage(messageId)
    if (known) return known
    const owner = this._recover(messageId, signature)
    const record = { safeAddress, messageId, message, confirmations: [{ owner, signature, at: new Date().toISOString() }], createdAt: new Date().toISOString() }
    await this._store.set(`msg:${messageId}`, record)
    return record
  }

  async getMessage (messageId) {
    return (await this._store.get(`msg:${messageId}`)) ?? null
  }

  async confirmMessage (messageId, signature) {
    const record = await this.getMessage(messageId)
    if (!record) throw new Error(`unknown message ${messageId}`)
    const owner = this._recover(messageId, signature)
    if (record.confirmations.some(c => c.owner === owner)) return record
    record.confirmations.push({ owner, signature, at: new Date().toISOString() })
    await this._store.set(`msg:${messageId}`, record)
    return record
  }

  _recover (hash, signature) {
    const owner = recoverAddress(hash, normaliseV(signature))
    if (this._owners.length && !this._owners.includes(owner)) throw new Error(`signature by ${owner}, not an owner of this Safe`)
    return owner
  }
}

// the proposer's signature travels inside the user operation, in the Safe 4337 module's format:
// 6 bytes validAfter, 6 bytes validUntil, then the 65-byte signature(s)
export function proposerSignatureOf (userOpSignature) {
  const hex = userOpSignature.startsWith('0x') ? userOpSignature.slice(2) : userOpSignature
  return '0x' + hex.slice(24, 24 + 130)
}

// a Safe "eth_sign" style signature carries v + 4; ethers wants 27 or 28
function normaliseV (signature) {
  const hex = signature.slice(2)
  const v = parseInt(hex.slice(128, 130), 16)
  if (v === 31 || v === 32) return '0x' + hex.slice(0, 128) + (v - 4).toString(16)
  return signature
}
