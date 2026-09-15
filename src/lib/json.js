// JSON with bigints, shared by the browser signer and the Node service.
// Unsigned transactions and authorizations carry bigints (value, gas, nonce, chainId).
export function stringify (value) {
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v))
}

export function parse (text) {
  return JSON.parse(text, (_, v) => (v && typeof v === 'object' && '$bigint' in v ? BigInt(v.$bigint) : v))
}
