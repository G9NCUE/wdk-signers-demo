// What every route of the service shares: JSON bodies with bigints, and two refusals. A POST must
// say it carries JSON, and a request that names a browser origin must come from this machine:
// the service signs with real keys, a page from elsewhere gets nothing, not even a derive.
import { parse, stringify } from '../src/lib/json.js'

export class BadRequest extends Error {}

export async function readJson (c) {
  const type = c.req.header('content-type') || ''
  if (!type.startsWith('application/json')) throw new BadRequest('expected an application/json body')
  const text = await c.req.text()
  try {
    return text ? parse(text) : {}
  } catch {
    throw new BadRequest('malformed JSON body')
  }
}

export const json = (c, value, status = 200) => c.body(stringify(value), status, { 'content-type': 'application/json' })

export const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export async function localOnly (c, next) {
  const origin = c.req.header('origin')
  if (origin && !LOCAL_ORIGIN.test(origin)) return c.json({ error: 'the signer service answers this machine only' }, 403)
  await next()
}

// a provider's reason for being unavailable, without the local paths a readFileSync error carries
export const publicReason = (reason) => (reason ? reason.replace(/'?\/[^\s']+\/[^\s']*'?/g, 'a local file') : reason)
