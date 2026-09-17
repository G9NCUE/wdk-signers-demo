// The Safe configurations of the Multisig page: same module, same page, different owners behind
// the Safe. Each is its own Safe in the service (`.safe/<network>.<id>.json`).
export const CONFIGS = [
  {
    id: 'seed',
    label: 'Seed only',
    blurb: 'three accounts of the one seed phrase, the plain 2-of-3',
    owners: [{ signerId: 'seed', index: 0 }, { signerId: 'seed', index: 1 }, { signerId: 'seed', index: 2 }],
    threshold: 2
  },
  {
    id: 'mixed',
    label: 'Multi-signer',
    blurb: 'one seed account, a Dfns MPC key and an Openfort backend wallet, three custody models on one Safe',
    owners: [{ signerId: 'seed', index: 0 }, { signerId: 'dfns', index: 0 }, { signerId: 'openfort', index: 0 }],
    threshold: 2
  }
]

export const DEFAULT_CONFIG = 'mixed'
