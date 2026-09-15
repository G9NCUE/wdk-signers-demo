import { ISigner, InvalidSignerError } from '@tetherto/wdk-wallet'
import { Signature } from 'ethers'
import { parse, stringify } from '../lib/json.js'

// ISignerEvm whose every operation is answered by the local Node service (server/), which holds
// the real signer and its API keys. The browser only sees the derivation path and the results.
export default class RemoteSignerEvm extends ISigner {
  constructor ({ id, path, isDerivable, baseUrl = '/api' } = {}) {
    super()
    this._id = id
    this._path = path
    this._isDerivable = isDerivable
    this._baseUrl = baseUrl
    this._address = undefined
    this._publicKey = null
    this._disposed = false
  }

  get isDerivable () { return this._isDerivable }
  get index () { return this._path ? +this._path.split('/').pop() : undefined }
  get path () { return this._path }
  get address () { return this._address }
  get keyPair () { return { privateKey: null, publicKey: this._publicKey } }

  async derive (relPath) {
    if (!this.isDerivable) throw new InvalidSignerError('Cannot derive: this signer is a derived child.')
    const child = await this._call('derive', { relPath })
    return new RemoteSignerEvm({ id: this._id, path: child.path, isDerivable: false, baseUrl: this._baseUrl })
  }

  async getAddress () {
    if (this._address) return this._address
    const { address, publicKey } = await this._call('address')
    this._address = address
    this._publicKey = publicKey ? Uint8Array.from(publicKey) : null
    return address
  }

  async sign (message) {
    return (await this._call('sign', { message })).signature
  }

  async signTransaction (unsignedTx) {
    return (await this._call('signTransaction', { unsignedTx })).signedTransaction
  }

  async signTypedData ({ domain, types, message }) {
    return (await this._call('signTypedData', { domain, types, message })).signature
  }

  async signAuthorization (auth) {
    const { authorization } = await this._call('signAuthorization', { auth })
    return { ...authorization, signature: Signature.from(authorization.signature) }
  }

  dispose () {
    this._disposed = true
    this._publicKey = null
  }

  async _call (op, body = {}) {
    if (this._disposed) throw new InvalidSignerError('The signer has been disposed.')
    const res = await fetch(`${this._baseUrl}/signers/${this._id}/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stringify({ path: this._path, ...body })
    })
    const text = await res.text()
    if (!res.ok) {
      let message = text
      try { message = JSON.parse(text).error ?? text } catch {}
      throw new InvalidSignerError(`${this._id}: ${message}`)
    }
    return parse(text)
  }
}
