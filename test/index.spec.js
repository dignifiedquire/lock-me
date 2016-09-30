/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const series = require('async/series')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const Lock = require('../src')

describe('lock-me', () => {
  it('unix', () => {
    return testLock(false)
  })

  it.skip('portable', () => {
    return testLock(true)
  })
})

function testLock (isPortable) {
  const lock = Lock(isPortable)
  const tmpDir = os.tmpDir()

  const file = path.join(tmpDir, 'foo.lock')
  let lk

  return spawnChild(file, isPortable)
  // Lock in child
  .then((child) => child.send('lock'))
  // Crash child
  .then((child) => child.send('exit'))
  // Create a new child
  .then(() => spawnChild(file, isPortable))
  // Lock and unlock
  .then((child) => child.send('lock'))
  .then((child) => child.send('unlock'))
  .then((child) => new Promise((resolve, reject) => {
    series([
      // Lock in parent
      (cb) => lock(file, (err, _lk) => {
        if (err) {
          return cb(err)
        }

        lk = _lk
        cb()
      }),
      // Lock in parent a second time, should fail
      (cb) => lock(file, (err) => {
        expect(err).to.exist
        cb()
      })
    ], (err) => {
      if (err) {
        return reject(err)
      }
      resolve(child)
    })
  }))
  // Lock in child, should fail
  .then((child) => {
    return child.send('lock')
      .catch((err) => expect(err).to.exist)
      .then(() => child)
  })
  // Unlock in parent
  .then((child) => new Promise((resolve, reject) => {
    lk.close((err) => {
      if (err) {
        return reject(err)
      }
      resolve(child)
    })
  }))
  // Lock and unlock in the child
  .then((child) => child.send('lock'))
  .then((child) => child.send('unlock'))
}

function spawnChild (file, isPortable) {
  const proc = cp.fork(`${__dirname}/child.js`)
  let err

  proc.on('error', (error) => {
    err = error
  })

  function send (type, args) {
    return new Promise((resolve, reject) => {
      if (err) {
        reject(err)
        err = null
        return
      }
      console.log('sending', type, args)
      proc.send({type, args})
      proc.once('message', (msg) => {
        console.log('got message', msg)
        if (msg.error) {
          return reject(new Error(msg.error))
        }
        resolve({send})
      })
    })
  }

  return send('init', {file, isPortable})
}
