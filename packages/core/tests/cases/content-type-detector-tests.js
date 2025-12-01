import {
  assert,
  assertEach,
  assertSequence
} from '@yamf/test'

import {
  isJsonString,
  detectFromBuffer,
  detectContentType
} from '../../src/http-primitives/content-type-detector.js'

import { Buffer } from 'node:buffer'
/**
 * Content Type Detector Tests
 * These tests work for both gateway and registry implementations
 */

// Test isJsonString function
export function testIsJsonString_ValidJSON() {
  assertEach([
    '{"key": "value"}',
    '[]',
    '[1, 2, 3]',
    '{"nested": {"object": true}}',
    'null',
    '123',
    '"string"'
  ], result => isJsonString(result) === true)
}

export function testIsJsonString_InvalidJSON() {
  assertEach([
    'not json',
    '{invalid}',
    'undefined',
    '',
    '<html>'
  ], result => isJsonString(result) === false)
}

// Test detectFromBuffer function
export function testDetectFromBuffer_WithBuffer() {
  const buffer = Buffer.from('test data')
  assert(
    detectFromBuffer(buffer),
    type => type === 'application/octet-stream'
  )
}

export function testDetectFromBuffer_WithNonBuffer() {
  assertEach([
    'string',
    { key: 'value' },
    123,
    null,
    undefined
  ], result => detectFromBuffer(result) === null)
}

// Test detectContentType with various payloads
export function testDetectContentType_JSONString() {
  assert(
    detectContentType('{"key": "value"}'),
    type => type === 'application/json'
  )
}

export function testDetectContentType_HTMLString() {
  assertEach([
    '<div>Hello</div>',
    '<html><body>Test</body></html>'
  ], result => detectContentType(result) === 'text/html')
}

export function testDetectContentType_XMLString() {
  assert(
    detectContentType('<root><item>Test</item></root>', '/data.xml'),
    type => type === 'application/xml'
  )
}

export function testDetectContentType_PlainText() {
  assertEach([
    'plain text',
    'just some words',
    '12345 no tags here'
  ], result => detectContentType(result) === 'text/plain')
}

export function testDetectContentType_Object() {
  assertEach([
    { key: 'value' },
    [1, 2, 3]
  ], result => detectContentType(result) === 'application/json')
}

export function testDetectContentType_Buffer() {
  const buffer = Buffer.from('binary data')
  assert(detectContentType(buffer) === 'application/octet-stream')
}

export function testDetectContentType_NullObject() {
  assert(detectContentType(null) === 'text/plain')
}

export function testDetectContentType_URLBasedDetection() {
  // URL-based detection should take priority
  assertSequence([
      detectContentType('any content', '/file.json'),
      detectContentType('any content', '/file.html'),
      detectContentType('any content', '/file.xml')
    ],
    (type) => type === 'application/json',
    (type) => type === 'text/html',
    (type) => type === 'application/xml'
  )
}

// Test for gateway implementation (identical behavior)
export function testGatewayContentTypeDetector_JSONString() {
  assert(
    detectContentType('{"key": "value"}'),
    type => type === 'application/json'
  )
}

export function testGatewayContentTypeDetector_HTMLString() {
  assert(
    detectContentType('<div>Hello</div>'),
    type => type === 'text/html'
  )
}

export function testGatewayContentTypeDetector_PlainText() {
  assert(
    detectContentType('plain text'),
    type => type === 'text/plain'
  )
}
