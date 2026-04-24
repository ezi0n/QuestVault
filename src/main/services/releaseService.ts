import type { ReleaseCheckResponse } from '@shared/types/ipc'

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/ezi0n/QuestVault/releases/latest'
const RELEASE_CHECK_TIMEOUT_MS = 8000

interface GitHubLatestReleasePayload {
  tag_name?: unknown
  html_url?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
}

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  return value.trim().replace(/^v/i, '') || null
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0

    if (leftValue > rightValue) {
      return 1
    }

    if (leftValue < rightValue) {
      return -1
    }
  }

  return 0
}

class ReleaseService {
  async checkForUpdates(currentVersion: string): Promise<ReleaseCheckResponse> {
    try {
      const response = await Promise.race([
        fetch(GITHUB_LATEST_RELEASE_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'QuestVault'
          }
        }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Update check timed out.')), RELEASE_CHECK_TIMEOUT_MS)
        })
      ])

      if (!response.ok) {
        return {
          success: false,
          currentVersion,
          latestVersion: null,
          latestTag: null,
          releaseUrl: null,
          publishedAt: null,
          updateAvailable: false,
          message: 'Unable to check for updates.',
          details: `GitHub returned ${response.status} ${response.statusText}.`
        }
      }

      const raw = await response.text()
      let payload: GitHubLatestReleasePayload
      try {
        payload = JSON.parse(raw) as GitHubLatestReleasePayload
      } catch {
        return {
          success: false,
          currentVersion,
          latestVersion: null,
          latestTag: null,
          releaseUrl: null,
          publishedAt: null,
          updateAvailable: false,
          message: 'Unable to check for updates.',
          details: 'GitHub returned an unexpected response.'
        }
      }
      const latestTag = typeof payload.tag_name === 'string' ? payload.tag_name : null
      const latestVersion = normalizeVersion(latestTag)
      const releaseUrl = typeof payload.html_url === 'string' ? payload.html_url : null
      const publishedAt = typeof payload.published_at === 'string' ? payload.published_at : null
      const draft = Boolean(payload.draft)
      const prerelease = Boolean(payload.prerelease)

      if (!latestVersion || draft || prerelease) {
        return {
          success: true,
          currentVersion,
          latestVersion,
          latestTag,
          releaseUrl,
          publishedAt,
          updateAvailable: false,
          message: 'No stable GitHub release is available to compare against.',
          details: draft || prerelease ? 'Latest GitHub release is a draft or prerelease.' : null
        }
      }

      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0

      return {
        success: true,
        currentVersion,
        latestVersion,
        latestTag,
        releaseUrl,
        publishedAt,
        updateAvailable,
        message: updateAvailable
          ? `QuestVault ${latestVersion} is available on GitHub.`
          : `QuestVault ${currentVersion} is up to date.`,
        details: releaseUrl
          ? publishedAt
            ? `Latest release: ${latestTag} • Published: ${publishedAt} • ${releaseUrl}`
            : `Latest release: ${latestTag} • ${releaseUrl}`
          : latestTag
            ? `Latest release: ${latestTag}`
            : null
      }
    } catch (error) {
      return {
        success: false,
        currentVersion,
        latestVersion: null,
        latestTag: null,
        releaseUrl: null,
        publishedAt: null,
        updateAvailable: false,
        message: 'Unable to check for updates.',
        details: error instanceof Error ? error.message : 'Unknown error.'
      }
    }
  }
}

export const releaseService = new ReleaseService()
