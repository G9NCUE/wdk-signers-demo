// What the paymaster's part of a user operation says about time. Candide's token paymaster on
// EntryPoint v0.6 signs a sponsorship that is valid for three minutes; the Safe 4337 module's
// SafeOp signature covers `paymasterAndData`, so a proposal not executed within that window
// cannot be repaired, it has to be proposed and signed again (verified 2026-09-17, "already
// expired." from eth_sendUserOperation).
// Layout seen on Arbitrum: paymaster (20 bytes), 3 bytes, validUntil as uint48, then the token,
// the exchange rate and the paymaster's signature.
export function sponsorshipOf (paymasterAndData) {
  const hex = typeof paymasterAndData === 'string' && paymasterAndData.startsWith('0x') ? paymasterAndData.slice(2) : ''
  if (hex.length < 58) return { paymaster: hex.length >= 40 ? '0x' + hex.slice(0, 40) : null, validUntil: null }
  const seconds = parseInt(hex.slice(46, 58), 16)
  const plausible = seconds > 1_600_000_000 && seconds < 4_000_000_000 // a unix time between 2020 and 2096
  return { paymaster: '0x' + hex.slice(0, 40), validUntil: plausible ? new Date(seconds * 1000) : null }
}

// 'expired' when the sponsorship is behind us, otherwise null
export function expiryOf (userOperation, now = Date.now()) {
  const { validUntil } = sponsorshipOf(userOperation?.paymasterAndData)
  if (!validUntil) return { expiresAt: null, expired: false }
  return { expiresAt: validUntil.toISOString(), expired: validUntil.getTime() <= now }
}
