import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, stringify } from '../src/lib/json.js'

test('bigints survive the round trip, nested and in arrays', () => {
  const tx = { chainId: 11155111n, value: 0n, gasLimit: 21000n, list: [{ nonce: 7n }], data: '0x', n: 3 }
  const back = parse(stringify(tx))
  assert.deepEqual(back, tx)
  assert.equal(typeof back.chainId, 'bigint')
  assert.equal(typeof back.n, 'number')
})

test('plain JSON passes through untouched', () => {
  assert.equal(stringify({ a: 1, b: 'x', c: null }), '{"a":1,"b":"x","c":null}')
  assert.deepEqual(parse('{"$bigint":"1"}'), 1n)
})
