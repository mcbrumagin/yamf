import {
  assert,
  assertErr,
  assertEach,
  assertErrEach,
  assertSequence,
  withEnv
} from '@yamf/test'

import {
  getRegistryHost,
  parseUrl,
  determineServiceHome,
  extractPort,
  validatePort,
  checkServiceUrlPort,
  validateServiceLocation,
  validateServiceName
} from '../../src/service/service-validator.js'

export async function testGetRegistryHost_ValidURL() {
  await withEnv({
    MICRO_REGISTRY_URL: 'http://localhost:8000'
  }, () => assert(getRegistryHost, r => r === 'http://localhost:8000'))
}

export async function testGetRegistryHost_MissingURL() {
  await withEnv({
    MICRO_REGISTRY_URL: undefined
  }, () => assertErr(getRegistryHost,
      err => err.message.includes('MICRO_REGISTRY_URL'),
      err => err.message.includes('env variable')
    )
  )
}

export function testParseUrl_ValidFormats() {
  assertSequence([
    'http://localhost:8000',
    'https://example.com:1234',
    'http://localhost',
    'https://hostname'
  ].map(u => () => parseUrl(u)),
    r => r.protocol === 'http:' && r.hostname === 'localhost' && r.port === '8000',
    r => r.protocol === 'https:' && r.hostname === 'example.com' && r.port === '1234',
    r => r.protocol === 'http:' && r.hostname === 'localhost' && !r.port,
    r => r.protocol === 'https:' && r.hostname === 'hostname' && !r.port
  )
}

export function testParseUrl_NoPort() {
  assertSequence([
    'http://localhost',
    'https://example.com'
  ].map(parseUrl),
    r => r.protocol === 'http:'
      && r.hostname === 'localhost'
      && r.pathname === '/'
      && !r.port,
    r => r.protocol === 'https:'
      && r.hostname === 'example.com'
      && r.pathname === '/'
      && !r.port
  )
}

export function testParseUrl_UrlWithPath() {
  assertSequence([
    'http://example.com:1234/endpointTest',
    'http://example.com/endpointTest'
  ].map(parseUrl),
    r => r.protocol === 'http:'
      && r.hostname === 'example.com'
      && r.pathname === '/endpointTest'
      && r.port === '1234',
    r => r.protocol === 'http:'
      && r.hostname === 'example.com'
      && r.pathname === '/endpointTest'
      && !r.port
  )
}

export function testParseUrl_InvalidFormat() {
  assertErrEach([
    '',
    'not a url!!!',
    'http://proto but with spaces',
    'http://almostGoodExceptPort:BAD',
    'localhost:8000',
    'localhost'
  ].map(u => () => parseUrl(u)),
    err => err.message.includes('Invalid URL')
  )
}

export async function testDetermineServiceHome_WithServiceURL() {
  await withEnv({
    MICRO_SERVICE_URL: 'http://service.example.com'
  }, () => {
    const result = determineServiceHome('http://registry.example.com:8000')
    assert(result, r => r === 'http://service.example.com')
  })
}

export async function testDetermineServiceHome_WithPort() {
  await withEnv({
    MICRO_SERVICE_URL: 'http://service.example.com:9000'
  }, () => {
    const result = determineServiceHome('http://registry.example.com:8000')
    assert(result, r => r === 'http://service.example.com:9000')
  })
}

export async function testDetermineServiceHome_UsesRegistryHost() {
  await withEnv({
    MICRO_SERVICE_URL: undefined
  }, async () => {
    const result = determineServiceHome('http://registry.example.com:8000')
    
    await assert(result, r => r === 'http://registry.example.com')
  })
}

export function testExtractPort_VariousFormats() {
  assertSequence([
    'http://localhost:8000',
    'https://example.com:443',
    'http://localhost',
    null,
    ''
  ].map(extractPort),
    p => p === '8000',
    p => p === '443',
    p => p === null,
    p => p === null,
    p => p === null
  )
}

export function testValidatePort_ValidPorts() {
  assertEach(['80', '443', '8000', '65535', '1']
  .map(p => () => validatePort(p)),
    port => typeof port === 'number',
    port => port >= 1,
    port => port <= 65535
  )
}

export function testValidatePort_InvalidPorts() {
  assertErrEach(['0', '65536', '-1', 'not-a-number']
  .map(p => () => validatePort(p)),
    err => err.message.includes('Invalid port number')
  )
}

export async function testCheckServiceUrlPort_NoURL() {
  await withEnv({
    MICRO_SERVICE_URL: undefined
  }, () => assert(checkServiceUrlPort,
      r => r.hasPort === false,
      r => r.port === null,
      r => r.url === null
    )
  )
}

export async function testCheckServiceUrlPort_WithPort() {
  await withEnv({
    MICRO_SERVICE_URL: 'http://localhost:9000'
  }, () => assert(checkServiceUrlPort,
      r => r.hasPort === true,
      r => r.port === 9000,
      r => r.url === 'http://localhost:9000'
    )
  )
}

export async function testValidateServiceLocation_ValidLocation() {
  await withEnv({
    MICRO_SERVICE_URL: undefined
  }, () => assert(() => validateServiceLocation('http://localhost:8000'),
      r => r.location === 'http://localhost:8000',
      r => r.port === 8000
    )
  )
}

export async function testValidateServiceLocation_EmptyLocation() {
  await withEnv({
    MICRO_SERVICE_URL: undefined
  }, () => assertErrEach(['', null]
    .map(l => () => validateServiceLocation(l)),
      err => err.message.includes('location cannot be empty')
    )
  )
}

export async function testValidateServiceLocation_MissingPort() {
  await withEnv({
    MICRO_SERVICE_URL: undefined
  }, () => assertErr(
      () => validateServiceLocation('http://localhost'),
      err => err.message.includes('missing port')
    )
  )
}

export async function testValidateServiceLocation_PortConflict() {
  await withEnv({
    MICRO_SERVICE_URL: 'http://localhost:9000'
  }, () => assertErr(
      () => validateServiceLocation('http://localhost:8000', 8000),
      err => err.message.includes('Port conflict'),
      err => err.message.includes('9000'),
      err => err.message.includes('8000')
    )
  )
}

export function testValidateServiceName_ValidNames() {
  assertEach([
    'myService',
    'my-service',
    'my_service',
    'myService123',
    'service$name'
  ].map(n => () => validateServiceName(n)),
    name => typeof name === 'string',
    name => name.length > 0
  )
}

export function testValidateServiceName_InvalidNames() {
  assertErrEach([
    'my service',
    'my@service',
    'my.service',
  ].map(n => () => validateServiceName(n)),
    err => err.message.includes('invalid characters')
  )
}

export function testValidateServiceName_NonString() {
  assertErrEach(['', 123, null, undefined]
  .map(n => () => validateServiceName(n)),
    err => err.message.includes('non-empty string')
  )
}
