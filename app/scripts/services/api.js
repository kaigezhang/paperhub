import bl from 'bl'
import OrbitDB from 'orbit-db'
import mh from 'multihashes'

import {createDaemon} from '../utils/ipfs'

const network = null
const user = 'paperhub'
const password = 'secret'
const LOG_NAME = 'papers'

let orbitdb
let el
let daemon

function getIpfs () {
  if (daemon) return Promise.resolve(daemon)

  return createDaemon().then((ipfs) => {
    daemon = ipfs
    return daemon
  })
}

function db () {
  if (orbitdb) return Promise.resolve(orbitdb)

  return getIpfs().then((ipfs) => {
    return OrbitDB.connect(network, user, password, ipfs)
  }).then((o) => {
    orbitdb = o
    return orbitdb
  })
}

function log () {
  if (el) return Promise.resolve(el)

  return db().then((orbit) => {
    el = orbit.eventlog(LOG_NAME)
    return el
  })
}

// start connecting immediately
db()
  .catch((err) => {
    console.error('error starting ipfs and orbit-db', err)
    console.error(err.stack)
  })

function collect (stream) {
  return new Promise((resolve, reject) => {
    stream.pipe(bl((err, buf) => {
      if (err) return reject(err)
      resolve(buf)
    }))
  })
}

// -- Public Interface

export const feed = () => {
  return log().then((eventlog) => {
    const res = eventlog.iterator({limit: -1}).collect()
    console.log('fetched', res)
    return res
  })
}

export const store = (obj) => {
  let record = {
    author: obj.author,
    title: obj.title,
    description: obj.description,
    year: obj.year
  }

  return getIpfs().then((ipfs) => {
    if (!obj.paper) return

    return ipfs.files.add(obj.paper.content).then((res) => {
      record.paper = mh.toB58String(res[0].node.multihash())
    })
  }).then(log)
    .then((eventlog) => eventlog.add(JSON.stringify(record)))
}

export const events = () => {
  return db().then((orbit) => orbit.events)
}

export const get = (hash) => {
  return log().then((eventlog) => {
    return eventlog.iterator({gte: hash, limit: 1}).collect()[0]
  })
    .then((res) => {
      if (!res) {
        return {
          key: hash
        }
      }

      const parsed = JSON.parse(res.payload.value)
      return {
        key: hash,
        result: {
          ...parsed,
          timestamp: res.payload.meta.ts
        }
      }
    })
    .then((res) => {
      if (!res.result || !res.result.paper) return res
      const hash = res.result.paper

      return getIpfs().then((ipfs) => ipfs.cat(hash))
        .then(collect)
        .then((buf) => {
          res.result.paper = {
            hash,
            content: buf
          }
          return res
        })
    })
}
