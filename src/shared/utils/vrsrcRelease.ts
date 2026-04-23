export type ParsedVrSrcRelease = {
  title: string
  versionCode: string
  versionName: string
}

const VR_SRC_RELEASE_PATTERN = /^(?<title>.+?)\sv(?<versionCode>\d+)\+(?<versionName>.+?)(?:\s-\S.*|$)/i

export function parseVrSrcReleaseName(value: string | null | undefined): ParsedVrSrcRelease | null {
  const normalized = value?.trim()

  if (!normalized) {
    return null
  }

  const match = normalized.match(VR_SRC_RELEASE_PATTERN)
  const title = match?.groups?.title?.trim() ?? null
  const versionCode = match?.groups?.versionCode?.trim() ?? null
  const versionName = match?.groups?.versionName?.trim() ?? null

  if (!title || !versionCode || !versionName) {
    return null
  }

  return {
    title,
    versionCode,
    versionName
  }
}
