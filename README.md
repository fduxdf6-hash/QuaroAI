import nodeVersionAlias from 'node-version-alias'

// Note: the following examples might be out-of-sync with the actual versions
console.log(await nodeVersionAlias('latest')) // 19.3.0
console.log(await nodeVersionAlias('lts')) // 18.12.1
console.log(await nodeVersionAlias('lts/erbium')) // 12.22.12
console.log(await nodeVersionAlias('erbium')) // 12.22.12
console.log(await nodeVersionAlias('lts/-2')) // 14.21.2

// Normal version ranges
console.log(await nodeVersionAlias('10.0.0')) // 10.0.0
console.log(await nodeVersionAlias('10')) // 10.24.1
console.log(await nodeVersionAlias('^10')) // 10.24.1
console.log(await nodeVersionAlias('>=10')) // 19.3.0

// Allowed options
await nodeVersionAlias('latest', {
  // Use a mirror for Node.js binaries
  mirror: 'https://npmmirror.com/mirrors/node',
  // Do not cache the list of available Node.js versions
  fetch: true,
  // Cancels when the signal is aborted
  signal: new AbortController().signal,
})
