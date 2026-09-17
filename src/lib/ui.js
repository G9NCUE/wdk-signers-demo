// Small helpers both pages share: dates for the lists, what an error can tell beyond its message.
export function when (iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// the WDK error class, a cause, a provider's code
export function errorDetails (e) {
  const out = { error: e.message, type: e.name || e.constructor?.name }
  if (e.code !== undefined) out.code = e.code
  if (e.cause) out.cause = e.cause.message ?? String(e.cause)
  if (e.stack) out.stack = e.stack.split('\n').slice(0, 6).join('\n')
  return out
}
