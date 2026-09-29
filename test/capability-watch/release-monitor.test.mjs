import assert from "node:assert/strict"
import { test } from "node:test"
import { scanReleases } from "../../agent-kernel-extension/src/codeagent/capability-watch/release-monitor.ts"

const release = (tag) => ({
  tag_name: tag,
  name: tag,
  body: `notes for ${tag}`,
  html_url: `https://github.com/example/releases/tag/${tag}`,
  published_at: "2026-09-29T00:00:00Z",
  draft: false,
  prerelease: false,
})

test("first scan establishes a cursor and a later scan reports only new stable releases", async () => {
  const first = await scanReleases({}, async () => ({ ok: true, json: async () => [release("v2"), release("v1")] }))
  assert.deepEqual(first.state, { claudeCode: "v2", codex: "v2" })
  assert.ok(first.results.every((result) => result.newReleases.length === 0))

  const second = await scanReleases(first.state, async () => ({
    ok: true,
    json: async () => [release("v3"), { ...release("v2-preview"), prerelease: true }, release("v2")],
  }))
  assert.ok(second.results.every((result) => result.newReleases.length === 1))
  assert.equal(second.results[0].newReleases[0].tag, "v3")
  assert.deepEqual(second.state, { claudeCode: "v3", codex: "v3" })
})

test("failed source does not advance its cursor", async () => {
  const result = await scanReleases({ claudeCode: "v1", codex: "v1" }, async (url) => {
    if (url.includes("anthropics")) return { ok: false, status: 503 }
    return { ok: true, json: async () => [release("v2"), release("v1")] }
  })
  assert.equal(result.state.claudeCode, "v1")
  assert.equal(result.results[0].error, "GitHub releases request failed: HTTP 503")
})
