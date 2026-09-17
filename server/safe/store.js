// One JSON file per network for the Safe and its proposals: `{ safe, proposals, messages }`.
// Written whole, through a temporary file, so a crash mid-write leaves the previous version.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const EMPTY = { safe: null, proposals: {}, messages: {} }

export default class SafeFileStore {
  constructor (file) {
    this.file = file
    this._data = null
  }

  read () {
    if (!this._data) {
      try {
        this._data = { ...EMPTY, ...JSON.parse(readFileSync(this.file, 'utf8')) }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
        this._data = structuredClone(EMPTY)
      }
    }
    return this._data
  }

  write (change) {
    const data = this.read()
    change(data)
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
    renameSync(tmp, this.file)
    return data
  }

  // the get/set pair LocalCoordinator wants, over the proposals and messages of this file
  get (key) {
    const { proposals, messages } = this.read()
    return key.startsWith('msg:') ? messages[key.slice(4)] : proposals[key]
  }

  set (key, value) {
    this.write(d => {
      if (key.startsWith('msg:')) d.messages[key.slice(4)] = value
      else d.proposals[key] = value
    })
  }
}
