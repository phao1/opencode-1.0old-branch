export const sources = {
  claudeCode: "anthropics/claude-code",
  codex: "openai/codex",
} as const

export type Source = keyof typeof sources
export type State = Partial<Record<Source, string>>

type Release = {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
}

type Fetcher = typeof fetch

export async function scanReleases(state: State, fetcher: Fetcher = fetch, token?: string) {
  const next: State = { ...state }
  const results = await Promise.all(
    (Object.entries(sources) as [Source, string][]).map(async ([source, repo]) => {
      try {
        const response = await fetcher(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "codeagent-capability-watch",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
        if (!response.ok) throw new Error(`GitHub releases request failed: HTTP ${response.status}`)
        const data: unknown = await response.json()
        if (!Array.isArray(data)) throw new Error("GitHub releases response is not an array")
        const releases = (data as Release[]).filter((release) =>
          typeof release.tag_name === "string" &&
          typeof release.html_url === "string" &&
          !release.draft &&
          !release.prerelease,
        )
        const current = releases[0]?.tag_name
        if (!current) return { source, repo, current: null, newReleases: [], gap: false }

        const previous = state[source]
        const found = releases.findIndex((release) => release.tag_name === previous)
        const changed = previous ? releases.slice(0, found < 0 ? releases.length : found) : []
        next[source] = current
        return {
          source,
          repo,
          current,
          baseline: !previous,
          gap: Boolean(previous && found < 0),
          newReleases: changed.reverse().map((release) => ({
            tag: release.tag_name,
            title: release.name || release.tag_name,
            url: release.html_url,
            publishedAt: release.published_at,
            notes: (release.body || "").slice(0, 6000),
          })),
        }
      } catch (error) {
        return { source, repo, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  return { state: next, results }
}
