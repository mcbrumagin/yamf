/**
 * Cross-cut 2: contract diff / backward compatibility
 */

import { assert } from '@yamf/test'
import {
  areServiceContractsEqual,
  isBackwardCompatibleServiceContract,
  diffServiceContracts,
  checkDeployContractGate
} from '../../src/service/contract-compatibility.js'

const k = (a, b) => ({ enforce: true, contractType: 'signature', expectedKeys: a, params: b || [], hasRestParam: false, hasDestructuring: true, extractedAt: 1 })

export async function testAreServiceContractsEqualStableOrder () {
  const a = { x: 1, y: 2 }
  const b = { y: 2, x: 1 }
  assert([areServiceContractsEqual(a, b)], ([x]) => x === true)
}

export async function testBackwardCompatRelaxesRequired () {
  const oldC = k(['a', 'b'])
  const newC = k(['a'])
  assert([isBackwardCompatibleServiceContract(oldC, newC)], ([x]) => x === true)
}

export async function testBackwardIncompatTightensRequired () {
  const oldC = k(['a'])
  const newC = k(['a', 'b'])
  assert([isBackwardCompatibleServiceContract(oldC, newC)], ([x]) => x === false)
}

export async function testBackwardIncompatDropsContract () {
  const oldC = k(['a'])
  assert([isBackwardCompatibleServiceContract(oldC, null)], ([x]) => x === false)
}

export async function testCheckDeployAllowBreaking () {
  const oldC = k(['a'])
  const newC = k(['a', 'b'])
  const g = checkDeployContractGate(oldC, newC, { allowBreaking: true })
  assert([g.allowed, g.reason != null], ([a, b]) => a === true && b)
}

export async function testCheckDeployRejects () {
  const oldC = k(['a'])
  const newC = k(['a', 'b'])
  const g = checkDeployContractGate(oldC, newC, { allowBreaking: false })
  assert([g.allowed], ([a]) => a === false)
}
