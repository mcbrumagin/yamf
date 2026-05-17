import { assert } from '@yamf/test'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, sign } from 'node:crypto'
import { envConfig } from '../../src/index.js'
import {
  verifyEd25519SignatureOnDeployHash,
  enforceDeployBundleEd25519Policy,
  signDeployHashWithEd25519Pem
} from '../../src/registry/deploy-bundle-signature.js'

export async function testEd25519SignAndVerifyRoundTrip () {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const hash = 'sha256-deadbeef00'
  const s = sign(null, Buffer.from(hash, 'utf8'), privateKey)
  const ok = verifyEd25519SignatureOnDeployHash(hash, s.toString('base64'), [publicKey])
  await assert(ok, (b) => b === true)
}

export async function testEnforcePolicyRequiresSigWhenKeyFile () {
  const d = mkdtempSync(join(tmpdir(), 'yamf-deploy-sig-'))
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const raw32 = spki.subarray(-32)
  const keysPath = join(d, 'authorized_keys')
  writeFileSync(keysPath, raw32.toString('base64') + '\n', 'utf8')
  const prev = process.env.YAMF_DEPLOY_AUTHORIZED_KEYS
  process.env.YAMF_DEPLOY_AUTHORIZED_KEYS = keysPath
  envConfig.set('YAMF_DEPLOY_AUTHORIZED_KEYS', keysPath)
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const keyPath = join(d, 'priv.pem')
  writeFileSync(keyPath, pem, 'utf8')
  const hash = 'sha256-abc12'
  const sigB64 = signDeployHashWithEd25519Pem(hash, keyPath)
  try {
    const noSig = enforceDeployBundleEd25519Policy({ hash, headers: {} })
    await assert(noSig, (o) => 'status' in o && o.status === 401)
    const good = enforceDeployBundleEd25519Policy({
      hash,
      headers: { 'yamf-bundle-signature': sigB64 }
    })
    await assert(good, (o) => o && o.ok === true)
    const goodWithAlg = enforceDeployBundleEd25519Policy({
      hash,
      headers: { 'yamf-bundle-signature': sigB64, 'yamf-bundle-signature-alg': 'ed25519' }
    })
    await assert(goodWithAlg, (o) => o && o.ok === true)
    const unsupportedAlg = enforceDeployBundleEd25519Policy({
      hash,
      headers: { 'yamf-bundle-signature': sigB64, 'yamf-bundle-signature-alg': 'ed448' }
    })
    await assert(unsupportedAlg, (o) => 'status' in o && o.status === 415)
  } finally {
    if (prev != null) process.env.YAMF_DEPLOY_AUTHORIZED_KEYS = prev
    else delete process.env.YAMF_DEPLOY_AUTHORIZED_KEYS
    envConfig.set('YAMF_DEPLOY_AUTHORIZED_KEYS', null)
    rmSync(d, { recursive: true, force: true })
  }
}
