// The browser's IMultisigCoordinator: every call goes to the local service, which keeps the Safe and
// its proposals in a file per network. The Safe module calls the six methods; the page uses the rest.
import { IMultisigCoordinator } from '@tetherto/wdk-protocol-multisig-safe'
import { parse, stringify } from '../json.js'

export default class RemoteCoordinator extends IMultisigCoordinator {
  constructor ({ network, baseUrl = '/api' }) {
    super()
    this._base = `${baseUrl}/safe/${network}`
    this._meta = null
  }

  // what the page knows about the next proposal (asset, amount, recipient, proposer signer), stored
  // with it; the module itself only sends the user operation
  describeNext (meta) {
    this._meta = meta
  }

  async submitProposal (proposalId, proposal) {
    const meta = this._meta
    this._meta = null
    return this._call('POST', '/proposals', { proposalId, proposal, meta })
  }

  async getProposal (proposalId) {
    return this._call('GET', `/proposals/${proposalId}`, undefined, { missing: null })
  }

  async confirmProposal (proposalId, signature) {
    return this._call('POST', `/proposals/${proposalId}/confirmations`, { signature })
  }

  async submitMessage (safeAddress, messageId, message) {
    return this._call('POST', '/messages', { safeAddress, messageId, message })
  }

  async getMessage (messageId) {
    return this._call('GET', `/messages/${messageId}`, undefined, { missing: null })
  }

  async confirmMessage (messageId, signature) {
    return this._call('POST', `/messages/${messageId}/confirmations`, { signature })
  }

  // --- the page's side of the service ------------------------------------------------------------
  async getSafe () {
    return (await this._call('GET', '')).safe
  }

  async createSafe ({ owners, threshold, saltNonce }) {
    return (await this._call('POST', '', { owners, threshold, saltNonce })).safe
  }

  async forgetSafe () {
    await this._call('DELETE', '')
  }

  async listProposals () {
    return this._call('GET', '/proposals')
  }

  // the module returns the user operation hash and leaves the coordinator unaware; the page records it
  async recordExecution (proposalId, execution) {
    return this._call('POST', `/proposals/${proposalId}/execution`, execution)
  }

  async _call (method, path, body, { missing } = {}) {
    const res = await fetch(this._base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? stringify(body) : undefined
    })
    if (res.status === 404 && missing !== undefined) return missing
    const text = await res.text()
    if (!res.ok) {
      let message = text
      try { message = JSON.parse(text).error ?? text } catch {}
      throw new Error(`safe service: ${message}`)
    }
    return text ? parse(text) : null
  }
}
