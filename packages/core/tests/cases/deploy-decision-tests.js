import { assert } from '@yamf/test'
import { deployDecisionFromReplicas } from '../../src/registry/deploy-decision.js'

const H = 'sha256-abc'

export async function testDeployDecisionRolloutWhenEmpty () {
  const r = deployDecisionFromReplicas([], H, 1)
  await assert(r.decision, (d) => d === 'rollout')
}

export async function testDeployDecisionRollingWhenSourceHashMissing () {
  const current = [
    { location: 'http://127.0.0.1:20001' },
    { location: 'http://127.0.0.1:20002' }
  ]
  const r = deployDecisionFromReplicas(current, H, 1)
  await assert(r.decision, (d) => d === 'rolling')
  await assert(r.otherHash.length, (n) => n === 2)
  await assert(r.sameHash.length, (n) => n === 0)
}

export async function testDeployDecisionRollingWhenHashDiffers () {
  const current = [
    { location: 'http://127.0.0.1:1', sourceHash: 'sha256-old' }
  ]
  const r = deployDecisionFromReplicas(current, H, 1)
  await assert(r.decision, (d) => d === 'rolling')
}

export async function testDeployDecisionScaleWhenUnderReplicatedSameHash () {
  const current = [
    { location: 'http://127.0.0.1:1', sourceHash: H }
  ]
  const r = deployDecisionFromReplicas(current, H, 2)
  await assert(r.decision, (d) => d === 'scale')
}

export async function testDeployDecisionNoopWhenSatisfied () {
  const current = [
    { location: 'http://127.0.0.1:1', sourceHash: H }
  ]
  const r = deployDecisionFromReplicas(current, H, 1)
  await assert(r.decision, (d) => d === 'noop')
}

export async function testDeployDecisionRollingWhenOneMissingOneMatch () {
  const current = [
    { location: 'http://127.0.0.1:1', sourceHash: H },
    { location: 'http://127.0.0.1:2' }
  ]
  const r = deployDecisionFromReplicas(current, H, 1)
  await assert(r.decision, (d) => d === 'rolling')
}
