import assert from 'node:assert/strict'
import test from 'node:test'
import { add, sub } from './math.mjs'

test('add handles positive, negative, zero and fractional numbers', () => {
  assert.equal(add(2, 3), 5)
  assert.equal(add(-2, -3), -5)
  assert.equal(add(-2, 3), 1)
  assert.equal(add(0, 4), 4)
  assert.equal(add(4, 0), 4)
  assert.equal(add(0.5, 0.25), 0.75)
})

test('sub preserves subtraction behavior', () => {
  assert.equal(sub(5, 2), 3)
  assert.equal(sub(2, 5), -3)
  assert.equal(sub(-2, -3), 1)
})
