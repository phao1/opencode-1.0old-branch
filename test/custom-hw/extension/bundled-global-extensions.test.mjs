import assert from "node:assert/strict"
import { test } from "node:test"
import { composeGlobalExtensions } from "../../../agent-kernel-extension/src/custom-hw/extension/global-extension.ts"

test("registered extensions expose tools and receive events in order", async () => {
  const calls = []
  const hooks = await composeGlobalExtensions(
    [
      async () => ({ tool: { first: { description: "one" } }, event: async () => calls.push("first") }),
      async () => ({ tool: { second: { description: "two" } }, event: async () => calls.push("second") }),
    ],
    {},
  )
  assert.deepEqual(Object.keys(hooks.tool), ["first", "second"])
  await hooks.event({ event: { type: "session.idle" } })
  assert.deepEqual(calls, ["first", "second"])
})

test("duplicate tools fail registration", async () => {
  await assert.rejects(
    composeGlobalExtensions(
      [async () => ({ tool: { same: {} } }), async () => ({ tool: { same: {} } })],
      {},
    ),
    /Duplicate global extension tool: same/,
  )
})
