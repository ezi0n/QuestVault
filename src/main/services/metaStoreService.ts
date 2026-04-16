import { app } from 'electron'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import type {
  InstalledMetaStoreIndexResponse,
  LocalLibraryIndexedItem,
  LocalLibraryScanResponse,
  MetaStoreDetailsResponse,
  MetaStoreGameDetails,
  MetaStoreGameSummary,
  MetaStorePackageMatchResponse,
  MetaStoreSearchResponse,
  MetaStoreStatusResponse
} from '@shared/types/ipc'

interface MetaStoreCache {
  summariesByStoreId: Record<string, MetaStoreGameSummary>
  detailsByStoreId: Record<string, MetaStoreGameDetails>
  lastUpdatedAt: string | null
}

interface InstalledMetaStoreIndex {
  matchesByPackageId: Record<string, MetaStoreGameSummary>
  lastUpdatedAt: string | null
}

type MetaStoreImageAsset = NonNullable<MetaStoreGameSummary['thumbnail']>

const EMPTY_CACHE: MetaStoreCache = {
  summariesByStoreId: {},
  detailsByStoreId: {},
  lastUpdatedAt: null
}

const EMPTY_INSTALLED_INDEX: InstalledMetaStoreIndex = {
  matchesByPackageId: {},
  lastUpdatedAt: null
}

class MetaStoreService {
  private cachedStore: MetaStoreCache | null = null
  private cachedInstalledIndex: InstalledMetaStoreIndex | null = null
  private pendingHydrations = new Map<string, Promise<MetaStoreGameDetails | null>>()
  private pendingCacheWrite: Promise<void> = Promise.resolve()
  private pendingInstalledIndexWrite: Promise<void> = Promise.resolve()

  private readonly metaMetadataBaseUrl = 'https://raw.githubusercontent.com/threethan/MetaMetadata/main'

  private getCachePath(): string {
    return join(app.getPath('userData'), 'meta-store-cache.json')
  }

  private getInstalledIndexPath(): string {
    return join(app.getPath('userData'), 'installed-meta-store-index.json')
  }

  private getImageCacheDir(): string {
    return join(app.getPath('userData'), 'meta-store-assets')
  }

  private toLocalAssetUri(absolutePath: string): string {
    return `qam-asset://${encodeURIComponent(absolutePath)}`
  }

  private async ensureCacheLoaded(): Promise<MetaStoreCache> {
    if (this.cachedStore) {
      return this.cachedStore
    }

    try {
      const contents = await readFile(this.getCachePath(), 'utf8')
      const parsed = JSON.parse(contents) as Partial<MetaStoreCache>
      this.cachedStore = {
        summariesByStoreId: parsed.summariesByStoreId ?? {},
        detailsByStoreId: parsed.detailsByStoreId ?? {},
        lastUpdatedAt: parsed.lastUpdatedAt ?? null
      }
    } catch {
      this.cachedStore = { ...EMPTY_CACHE }
      await this.saveCache(this.cachedStore)
    }

    return this.cachedStore
  }

  private async saveCache(cache: MetaStoreCache): Promise<void> {
    const cacheSnapshot: MetaStoreCache = {
      summariesByStoreId: { ...cache.summariesByStoreId },
      detailsByStoreId: { ...cache.detailsByStoreId },
      lastUpdatedAt: cache.lastUpdatedAt
    }

    this.pendingCacheWrite = this.pendingCacheWrite.then(async () => {
      const cachePath = this.getCachePath()
      const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`
      await mkdir(dirname(cachePath), { recursive: true })
      await writeFile(tempPath, `${JSON.stringify(cacheSnapshot, null, 2)}\n`, 'utf8')
      await rename(tempPath, cachePath)
      this.cachedStore = cacheSnapshot
    })

    await this.pendingCacheWrite
  }

  private async ensureInstalledIndexLoaded(): Promise<InstalledMetaStoreIndex> {
    if (this.cachedInstalledIndex) {
      return this.cachedInstalledIndex
    }

    try {
      const contents = await readFile(this.getInstalledIndexPath(), 'utf8')
      const parsed = JSON.parse(contents) as Partial<InstalledMetaStoreIndex>
      this.cachedInstalledIndex = {
        matchesByPackageId: parsed.matchesByPackageId ?? {},
        lastUpdatedAt: parsed.lastUpdatedAt ?? null
      }
    } catch {
      this.cachedInstalledIndex = { ...EMPTY_INSTALLED_INDEX }
      await this.saveInstalledIndex(this.cachedInstalledIndex)
    }

    return this.cachedInstalledIndex
  }

  private async saveInstalledIndex(index: InstalledMetaStoreIndex): Promise<void> {
    const indexSnapshot: InstalledMetaStoreIndex = {
      matchesByPackageId: { ...index.matchesByPackageId },
      lastUpdatedAt: index.lastUpdatedAt
    }

    this.pendingInstalledIndexWrite = this.pendingInstalledIndexWrite.then(async () => {
      const indexPath = this.getInstalledIndexPath()
      const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`
      await mkdir(dirname(indexPath), { recursive: true })
      await writeFile(tempPath, `${JSON.stringify(indexSnapshot, null, 2)}\n`, 'utf8')
      await rename(tempPath, indexPath)
      this.cachedInstalledIndex = indexSnapshot
    })

    await this.pendingInstalledIndexWrite
  }

  private normalizeSearchTerm(value: string): string {
    return value.trim().toLowerCase()
  }

  private buildStoreIdFromPackageId(packageId: string): string {
    return `package:${packageId}`
  }

  private buildStoreIdFromRemote(storeItemId: string | null, packageId: string): string {
    return storeItemId ? `meta:${storeItemId}` : this.buildStoreIdFromPackageId(packageId)
  }

  private buildImageAsset(value: unknown): MetaStoreGameSummary['thumbnail'] {
    if (!value) {
      return null
    }

    if (typeof value === 'string') {
      return {
        uri: value,
        width: null,
        height: null
      }
    }

    if (typeof value === 'object' && value !== null) {
      const candidate = value as Record<string, unknown>
      if (typeof candidate.uri === 'string') {
        return {
          uri: candidate.uri,
          width: typeof candidate.width === 'number' ? candidate.width : null,
          height: typeof candidate.height === 'number' ? candidate.height : null
        }
      }
    }

    return null
  }

  private getImageExtensionFromContentType(contentType: string | null): string {
    const normalized = contentType?.toLowerCase().split(';')[0].trim() ?? ''
    switch (normalized) {
      case 'image/jpeg':
        return '.jpg'
      case 'image/png':
        return '.png'
      case 'image/webp':
        return '.webp'
      case 'image/gif':
        return '.gif'
      case 'image/svg+xml':
        return '.svg'
      case 'image/avif':
        return '.avif'
      default:
        return '.img'
    }
  }

  private async cacheImageAsset(asset: MetaStoreGameSummary['thumbnail']): Promise<MetaStoreGameSummary['thumbnail']> {
    if (!asset?.uri) {
      return asset
    }

    const trimmedUri = asset.uri.trim()
    if (!/^https?:\/\//i.test(trimmedUri)) {
      return asset
    }

    try {
      const parsedUrl = new URL(trimmedUri)
      const hashedName = createHash('sha1').update(trimmedUri).digest('hex')
      const pathExtension = extname(parsedUrl.pathname).toLowerCase()
      const fallbackExtension = pathExtension && pathExtension.length <= 6 ? pathExtension : ''
      const cacheDir = this.getImageCacheDir()
      let targetPath = join(cacheDir, `${hashedName}${fallbackExtension || '.img'}`)

      if (!fallbackExtension) {
        try {
          const existingEntries = await readFile(join(cacheDir, `${hashedName}.meta`), 'utf8')
          const existingPath = existingEntries.trim()
          if (existingPath) {
            await access(existingPath)
            return {
              ...asset,
              uri: this.toLocalAssetUri(existingPath)
            }
          }
        } catch {
          // Continue and fetch a fresh copy to determine the extension.
        }
      } else {
        try {
          await access(targetPath)
          return {
            ...asset,
            uri: this.toLocalAssetUri(targetPath)
          }
        } catch {
          // Continue and fetch a fresh copy.
        }
      }

      const response = await fetch(trimmedUri)
      if (!response.ok) {
        return asset
      }

      const arrayBuffer = await response.arrayBuffer()
      const fileExtension = fallbackExtension || this.getImageExtensionFromContentType(response.headers.get('content-type'))
      targetPath = join(cacheDir, `${hashedName}${fileExtension}`)
      await mkdir(cacheDir, { recursive: true })
      await writeFile(targetPath, Buffer.from(arrayBuffer))
      await writeFile(join(cacheDir, `${hashedName}.meta`), `${targetPath}\n`, 'utf8')

      return {
        ...asset,
        uri: this.toLocalAssetUri(targetPath)
      }
    } catch {
      return asset
    }
  }

  private async cacheDetailsImages(details: MetaStoreGameDetails): Promise<MetaStoreGameDetails> {
    const [thumbnail, heroImage, portraitImage, iconImage, logoImage] = await Promise.all([
      this.cacheImageAsset(details.thumbnail),
      this.cacheImageAsset(details.heroImage),
      this.cacheImageAsset(details.portraitImage),
      this.cacheImageAsset(details.iconImage),
      this.cacheImageAsset(details.logoImage)
    ])

    return {
      ...details,
      thumbnail,
      heroImage,
      portraitImage,
      iconImage,
      logoImage
    }
  }

  private normalizePackageId(packageId: string): string {
    return packageId.trim()
  }

  private normalizeStoreLookupId(storeId: string): string {
    const trimmed = storeId.trim()
    if (!trimmed) {
      return trimmed
    }

    if (/^\d+$/.test(trimmed)) {
      return `meta:${trimmed}`
    }

    return trimmed
  }

  private buildCandidatePackageIds(packageId: string): string[] {
    const normalized = this.normalizePackageId(packageId)
    const lowerCase = normalized.toLowerCase()
    const candidates = new Set<string>([normalized, lowerCase].filter(Boolean))

    const addCandidate = (value: string) => {
      const trimmed = value.trim()
      if (trimmed) {
        candidates.add(trimmed)
        candidates.add(trimmed.toLowerCase())
      }
    }

    if (lowerCase.startsWith('mr.com.')) {
      addCandidate(normalized.replace(/^mr\./i, ''))
    }

    if (lowerCase.startsWith('mrf.')) {
      addCandidate(normalized.replace(/^mrf\./i, ''))
    }

    if (lowerCase.startsWith('com.mrf.')) {
      addCandidate(normalized.replace(/^com\.mrf\./i, 'com.'))
    }

    if (lowerCase.includes('.mrf.')) {
      addCandidate(normalized.replace(/\.mrf\./i, '.'))
    }

    return Array.from(candidates)
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        return null
      }

      return (await response.json()) as T
    } catch {
      return null
    }
  }

  private async fetchOculusDbRecordByStoreItemId(storeItemId: string): Promise<Record<string, unknown> | null> {
    return this.fetchJson<Record<string, unknown>>(`https://oculusdb.rui2015.me/api/v1/id/${storeItemId}`)
  }

  private extractVersionCode(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }

    if (typeof value === 'string' && value.trim()) {
      return value
    }

    return null
  }

  private extractRatingAverage(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }

    return null
  }

  private extractSizeBytes(...values: unknown[]): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value
      }

      if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed
        }
      }
    }

    return null
  }

  private normalizeReleaseDateLabel(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null
    }

    if (value.startsWith('1970-01-01') || value.startsWith('0001-01-01')) {
      return null
    }

    return value
  }

  private findSummaryByPackageId(cache: MetaStoreCache, packageId: string): MetaStoreGameSummary | null {
    const normalizedPackageId = packageId.toLowerCase()
    const matches = Object.values(cache.summariesByStoreId).filter(
      (summary) => summary.packageId?.toLowerCase() === normalizedPackageId
    )

    if (!matches.length) {
      return null
    }

    return (
      matches.find((summary) => summary.source === 'remote') ??
      matches.find((summary) => Boolean(summary.thumbnail || summary.iconImage || summary.heroImage)) ??
      matches[0]
    )
  }

  private findDetailsByPackageId(cache: MetaStoreCache, packageId: string): MetaStoreGameDetails | null {
    const normalizedPackageId = packageId.toLowerCase()
    const matches = Object.values(cache.detailsByStoreId).filter(
      (details) => details.packageId?.toLowerCase() === normalizedPackageId
    )

    if (!matches.length) {
      return null
    }

    return (
      matches.find((details) => details.source === 'remote') ??
      matches.find((details) => Boolean(details.thumbnail || details.iconImage || details.heroImage)) ??
      matches[0]
    )
  }

  private async fetchRemoteMetadataByPackageId(packageId: string): Promise<MetaStoreGameDetails | null> {
    const candidatePackageIds = this.buildCandidatePackageIds(packageId)

    for (const candidatePackageId of candidatePackageIds) {
      const commonUrl = `${this.metaMetadataBaseUrl}/data/common/${candidatePackageId}.json`
      const publicUrl = `${this.metaMetadataBaseUrl}/data/oculus_public/${candidatePackageId}.json`
      const oculusDbUrl = `${this.metaMetadataBaseUrl}/data/oculusdb/${candidatePackageId}.json`

      const [commonRecord, publicRecord, oculusDbRecord] = await Promise.all([
        this.fetchJson<Record<string, unknown>>(commonUrl),
        this.fetchJson<Record<string, unknown>>(publicUrl),
        this.fetchJson<Record<string, unknown>>(oculusDbUrl)
      ])

      if (!commonRecord && !publicRecord && !oculusDbRecord) {
        continue
      }

      const resolvedPackageId =
        (typeof oculusDbRecord?.packageName === 'string' && oculusDbRecord.packageName) || candidatePackageId
      const storeItemId =
        (typeof publicRecord?.id === 'string' && publicRecord.id) ||
        (typeof oculusDbRecord?.id === 'string' && oculusDbRecord.id) ||
        null
      const title =
        (typeof publicRecord?.display_name === 'string' && publicRecord.display_name) ||
        (typeof oculusDbRecord?.displayName === 'string' && oculusDbRecord.displayName) ||
        (typeof oculusDbRecord?.appName === 'string' && oculusDbRecord.appName) ||
        (typeof commonRecord?.name === 'string' && commonRecord.name) ||
        candidatePackageId
      const publisherName =
        (typeof oculusDbRecord?.publisher_name === 'string' && oculusDbRecord.publisher_name) || null
      const genreNames =
        (Array.isArray(publicRecord?.genre_names) ? publicRecord.genre_names : Array.isArray(oculusDbRecord?.genre_names) ? oculusDbRecord.genre_names : [])
          .filter((genre): genre is string => typeof genre === 'string' && genre.trim().length > 0)
      const category =
        (typeof publicRecord?.category_name === 'string' && publicRecord.category_name) ||
        (genreNames.length ? genreNames[0] : null)
      const releaseDateLabel =
        this.normalizeReleaseDateLabel(publicRecord?.release_info && typeof publicRecord.release_info === 'object' ? (publicRecord.release_info as Record<string, unknown>).display_date : null) ||
        this.normalizeReleaseDateLabel(oculusDbRecord?.releaseDate)
      const priceLabel =
        (publicRecord?.current_offer &&
        typeof publicRecord.current_offer === 'object' &&
        (publicRecord.current_offer as Record<string, unknown>).price &&
        typeof (publicRecord.current_offer as Record<string, unknown>).price === 'object'
          ? (((publicRecord.current_offer as Record<string, unknown>).price as Record<string, unknown>).formatted as string | undefined)
          : undefined) ||
        (typeof oculusDbRecord?.priceFormatted === 'string' && oculusDbRecord.priceFormatted) ||
        null
      const ratingAverage =
        this.extractRatingAverage(publicRecord?.quality_rating_aggregate) ??
        this.extractRatingAverage(oculusDbRecord?.quality_rating_aggregate)
      const shortDescription =
        (typeof oculusDbRecord?.display_short_description === 'string' && oculusDbRecord.display_short_description) ||
        (typeof commonRecord?.name === 'string' && commonRecord.name !== title ? commonRecord.name : null)
      const longDescription =
        (typeof oculusDbRecord?.display_long_description === 'string' && oculusDbRecord.display_long_description) || null
      const websiteUrl =
        (typeof oculusDbRecord?.website_url === 'string' && oculusDbRecord.website_url) || null
      const canonicalName =
        (typeof publicRecord?.canonical_name === 'string' && publicRecord.canonical_name) ||
        (typeof oculusDbRecord?.canonicalName === 'string' && oculusDbRecord.canonicalName) ||
        null
      const version =
        (typeof commonRecord?.version === 'string' && commonRecord.version) || null
      const versionCode =
        this.extractVersionCode(commonRecord?.versioncode) ||
        this.extractVersionCode(oculusDbRecord?.versionCode)
      const sizeBytes = this.extractSizeBytes(
        oculusDbRecord?.total_installed_space,
        oculusDbRecord?.required_space_adjusted,
        oculusDbRecord?.required_space_adjusted_numerical,
        oculusDbRecord?.totalInstalledSpaceFormatted
      )
      const fetchedAt = new Date().toISOString()

      return {
        storeId: this.buildStoreIdFromRemote(storeItemId, resolvedPackageId),
        storeItemId,
        packageId: resolvedPackageId,
        title,
        subtitle: publisherName || category || null,
        category,
        publisherName,
        genreNames,
        releaseDateLabel,
        canonicalName,
        thumbnail:
          this.buildImageAsset(commonRecord?.square) ||
          this.buildImageAsset(publicRecord?.cover_square_image) ||
          this.buildImageAsset(oculusDbRecord?.img),
        heroImage:
          this.buildImageAsset(commonRecord?.hero) ||
          this.buildImageAsset(publicRecord?.cover_landscape_image) ||
          this.buildImageAsset(commonRecord?.landscape),
        portraitImage:
          this.buildImageAsset(commonRecord?.portrait) ||
          this.buildImageAsset(publicRecord?.cover_portrait_image),
        iconImage:
          this.buildImageAsset(commonRecord?.icon) ||
          this.buildImageAsset(publicRecord?.icon_image),
        logoImage: this.buildImageAsset(commonRecord?.logo),
        version,
        versionCode,
        sizeBytes,
        ratingAverage,
        priceLabel,
        source: 'remote',
        fetchedAt,
        shortDescription,
        longDescription,
        languageNames: [],
        interactionModeNames: genreNames,
        internetConnectionName: null,
        gamepadRequired: null,
        websiteUrl,
        ratingHistogram: []
      }
    }

    return null
  }

  private async fetchRemoteMetadataByStoreItemId(storeItemId: string): Promise<MetaStoreGameDetails | null> {
    const oculusDbRecord = await this.fetchOculusDbRecordByStoreItemId(storeItemId)

    if (!oculusDbRecord) {
      return null
    }

    const packageName =
      (typeof oculusDbRecord.packageName === 'string' && oculusDbRecord.packageName.trim()) ||
      null

    if (packageName) {
      const enrichedByPackageId = await this.fetchRemoteMetadataByPackageId(packageName)
      if (enrichedByPackageId) {
        return {
          ...enrichedByPackageId,
          storeId: `meta:${storeItemId}`,
          storeItemId
        }
      }
    }

    const title =
      (typeof oculusDbRecord.displayName === 'string' && oculusDbRecord.displayName) ||
      (typeof oculusDbRecord.appName === 'string' && oculusDbRecord.appName) ||
      packageName ||
      storeItemId
    const publisherName =
      (typeof oculusDbRecord.publisher_name === 'string' && oculusDbRecord.publisher_name) || null
    const genreNames = (Array.isArray(oculusDbRecord.genre_names) ? oculusDbRecord.genre_names : [])
      .filter((genre): genre is string => typeof genre === 'string' && genre.trim().length > 0)
    const category = genreNames.length ? genreNames[0] : null
    const fetchedAt = new Date().toISOString()

    return {
      storeId: `meta:${storeItemId}`,
      storeItemId,
      packageId: packageName,
      title,
      subtitle: publisherName || category,
      category,
      publisherName,
      genreNames,
      releaseDateLabel: this.normalizeReleaseDateLabel(oculusDbRecord.releaseDate),
      canonicalName: (typeof oculusDbRecord.canonicalName === 'string' && oculusDbRecord.canonicalName) || null,
      thumbnail: this.buildImageAsset(oculusDbRecord.img),
      heroImage: null,
      portraitImage: null,
      iconImage: null,
      logoImage: null,
      version:
        (typeof oculusDbRecord.version === 'string' && oculusDbRecord.version) ||
        null,
      versionCode: this.extractVersionCode(oculusDbRecord.versionCode),
      sizeBytes: this.extractSizeBytes(
        oculusDbRecord.total_installed_space,
        oculusDbRecord.required_space_adjusted,
        oculusDbRecord.required_space_adjusted_numerical,
        oculusDbRecord.totalInstalledSpaceFormatted
      ),
      ratingAverage: this.extractRatingAverage(oculusDbRecord.quality_rating_aggregate),
      priceLabel:
        (typeof oculusDbRecord.priceFormatted === 'string' && oculusDbRecord.priceFormatted) ||
        null,
      source: 'remote',
      fetchedAt,
      shortDescription:
        (typeof oculusDbRecord.display_short_description === 'string' && oculusDbRecord.display_short_description) || null,
      longDescription:
        (typeof oculusDbRecord.display_long_description === 'string' && oculusDbRecord.display_long_description) || null,
      languageNames: [],
      interactionModeNames: genreNames,
      internetConnectionName: null,
      gamepadRequired: null,
      websiteUrl:
        (typeof oculusDbRecord.website_url === 'string' && oculusDbRecord.website_url) || null,
      ratingHistogram: []
    }
  }

  private async hydratePackageId(packageId: string): Promise<MetaStoreGameDetails | null> {
    const normalizedPackageId = this.normalizePackageId(packageId)
    if (!normalizedPackageId) {
      return null
    }

    const existingPending = this.pendingHydrations.get(normalizedPackageId)
    if (existingPending) {
      return existingPending
    }

    const hydrationPromise = (async () => {
      const cache = await this.ensureCacheLoaded()
      const existingDetails = this.findDetailsByPackageId(cache, normalizedPackageId)
      if (existingDetails?.source === 'remote') {
        return existingDetails
      }

      const remoteDetails = await this.fetchRemoteMetadataByPackageId(normalizedPackageId)
      if (!remoteDetails) {
        return existingDetails ?? null
      }
      const cachedRemoteDetails = await this.cacheDetailsImages(remoteDetails)

      const latestCache = await this.ensureCacheLoaded()
      const nextSummaries = { ...latestCache.summariesByStoreId }
      const nextDetails = { ...latestCache.detailsByStoreId }
      const packageStoreId = this.buildStoreIdFromPackageId(normalizedPackageId)

      const summary: MetaStoreGameSummary = {
        storeId: cachedRemoteDetails.storeId,
        storeItemId: cachedRemoteDetails.storeItemId,
        packageId: cachedRemoteDetails.packageId,
        title: cachedRemoteDetails.title,
        subtitle: cachedRemoteDetails.subtitle,
        category: cachedRemoteDetails.category,
        publisherName: cachedRemoteDetails.publisherName,
        genreNames: cachedRemoteDetails.genreNames,
        releaseDateLabel: cachedRemoteDetails.releaseDateLabel,
        canonicalName: cachedRemoteDetails.canonicalName,
        thumbnail: cachedRemoteDetails.thumbnail,
        heroImage: cachedRemoteDetails.heroImage,
        portraitImage: cachedRemoteDetails.portraitImage,
        iconImage: cachedRemoteDetails.iconImage,
        logoImage: cachedRemoteDetails.logoImage,
        version: cachedRemoteDetails.version,
        versionCode: cachedRemoteDetails.versionCode,
        sizeBytes: cachedRemoteDetails.sizeBytes,
        ratingAverage: cachedRemoteDetails.ratingAverage,
        priceLabel: cachedRemoteDetails.priceLabel,
        source: cachedRemoteDetails.source,
        fetchedAt: cachedRemoteDetails.fetchedAt
      }

      delete nextSummaries[packageStoreId]
      delete nextDetails[packageStoreId]
      nextSummaries[cachedRemoteDetails.storeId] = summary
      nextDetails[cachedRemoteDetails.storeId] = cachedRemoteDetails

      await this.saveCache({
        summariesByStoreId: nextSummaries,
        detailsByStoreId: nextDetails,
        lastUpdatedAt: cachedRemoteDetails.fetchedAt
      })

      return cachedRemoteDetails
    })()

    this.pendingHydrations.set(normalizedPackageId, hydrationPromise)

    try {
      return await hydrationPromise
    } finally {
      this.pendingHydrations.delete(normalizedPackageId)
    }
  }

  private buildDisplayTitleFromLibraryItem(item: LocalLibraryIndexedItem): string {
    if (item.kind === 'apk') {
      return basename(item.name, extname(item.name)) || item.name
    }

    return item.name
  }

  private buildLocalSummaryFromLibraryItem(
    item: LocalLibraryIndexedItem,
    packageId: string,
    fetchedAt: string
  ): MetaStoreGameSummary {
    return {
      storeId: this.buildStoreIdFromPackageId(packageId),
      storeItemId: null,
      packageId,
      title: this.buildDisplayTitleFromLibraryItem(item),
      subtitle: item.note,
      category: 'Local Library',
      publisherName: null,
      genreNames: [],
      releaseDateLabel: null,
      canonicalName: null,
      thumbnail: null,
      heroImage: null,
      portraitImage: null,
      iconImage: null,
      logoImage: null,
      version: null,
      versionCode: null,
      sizeBytes: item.sizeBytes,
      ratingAverage: null,
      priceLabel: null,
      source: 'cache',
      fetchedAt
    }
  }

  private buildLocalDetailsFromLibraryItem(
    item: LocalLibraryIndexedItem,
    packageId: string,
    fetchedAt: string
  ): MetaStoreGameDetails {
    const summary = this.buildLocalSummaryFromLibraryItem(item, packageId, fetchedAt)

    return {
      ...summary,
      shortDescription: item.note,
      longDescription: `Indexed from local library path ${item.relativePath}.`,
      languageNames: [],
      interactionModeNames: [],
      internetConnectionName: null,
      gamepadRequired: null,
      websiteUrl: null,
      ratingHistogram: []
    }
  }

  private summarizeCounts(cache: MetaStoreCache): Pick<
    MetaStoreStatusResponse,
    'cachedSummaryCount' | 'cachedDetailCount' | 'lastUpdatedAt'
  > {
    return {
      cachedSummaryCount: Object.keys(cache.summariesByStoreId).length,
      cachedDetailCount: Object.keys(cache.detailsByStoreId).length,
      lastUpdatedAt: cache.lastUpdatedAt
    }
  }

  private filterCachedSummaries(cache: MetaStoreCache, query: string): MetaStoreGameSummary[] {
    const normalizedQuery = this.normalizeSearchTerm(query)
    if (!normalizedQuery) {
      return Object.values(cache.summariesByStoreId)
    }

    return Object.values(cache.summariesByStoreId).filter((summary) => {
      const haystacks = [
        summary.title,
        summary.subtitle,
        summary.category,
        summary.packageId,
        summary.version,
        summary.versionCode
      ]

      return haystacks.some((value) => value?.toLowerCase().includes(normalizedQuery))
    })
  }

  async getStatus(): Promise<MetaStoreStatusResponse> {
    const cache = await this.ensureCacheLoaded()
    return {
      status: 'cache-only',
      message: 'Meta store enrichment is available through the local cache and on-demand package matching.',
      ...this.summarizeCounts(cache)
    }
  }

  async search(query: string): Promise<MetaStoreSearchResponse> {
    const cache = await this.ensureCacheLoaded()
    const trimmedQuery = query.trim()
    const results = this.filterCachedSummaries(cache, trimmedQuery)

    return {
      status: 'cache-only',
      query: trimmedQuery,
      message: trimmedQuery
        ? results.length
          ? `Found ${results.length} cached Meta store match${results.length === 1 ? '' : 'es'}.`
          : 'No cached Meta store matches were found for that search yet.'
        : 'Search the currently cached Meta store matches by title, publisher, package, or version.',
      results
    }
  }

  async getDetails(storeId: string): Promise<MetaStoreDetailsResponse> {
    const normalizedStoreId = this.normalizeStoreLookupId(storeId)
    let cache = await this.ensureCacheLoaded()
    let details = cache.detailsByStoreId[normalizedStoreId] ?? null

    if (!details || details.source !== 'remote') {
      const packageId =
        details?.packageId ||
        cache.summariesByStoreId[normalizedStoreId]?.packageId ||
        (normalizedStoreId.startsWith('package:') ? normalizedStoreId.slice('package:'.length) : null)

      if (packageId) {
        await this.hydratePackageId(packageId)
        cache = await this.ensureCacheLoaded()
        details = cache.detailsByStoreId[normalizedStoreId] ?? this.findDetailsByPackageId(cache, packageId)
      } else if (normalizedStoreId.startsWith('meta:')) {
        const storeItemId = normalizedStoreId.slice('meta:'.length)
        const remoteDetails = await this.fetchRemoteMetadataByStoreItemId(storeItemId)

        if (remoteDetails) {
          const cachedRemoteDetails = await this.cacheDetailsImages(remoteDetails)
          const nextSummary: MetaStoreGameSummary = {
            storeId: cachedRemoteDetails.storeId,
            storeItemId: cachedRemoteDetails.storeItemId,
            packageId: cachedRemoteDetails.packageId,
            title: cachedRemoteDetails.title,
            subtitle: cachedRemoteDetails.subtitle,
            category: cachedRemoteDetails.category,
            publisherName: cachedRemoteDetails.publisherName,
            genreNames: cachedRemoteDetails.genreNames,
            releaseDateLabel: cachedRemoteDetails.releaseDateLabel,
            canonicalName: cachedRemoteDetails.canonicalName,
            thumbnail: cachedRemoteDetails.thumbnail,
            heroImage: cachedRemoteDetails.heroImage,
            portraitImage: cachedRemoteDetails.portraitImage,
            iconImage: cachedRemoteDetails.iconImage,
            logoImage: cachedRemoteDetails.logoImage,
            version: cachedRemoteDetails.version,
            versionCode: cachedRemoteDetails.versionCode,
            sizeBytes: cachedRemoteDetails.sizeBytes,
            ratingAverage: cachedRemoteDetails.ratingAverage,
            priceLabel: cachedRemoteDetails.priceLabel,
            source: cachedRemoteDetails.source,
            fetchedAt: cachedRemoteDetails.fetchedAt
          }

          cache = {
            summariesByStoreId: {
              ...cache.summariesByStoreId,
              [cachedRemoteDetails.storeId]: nextSummary
            },
            detailsByStoreId: {
              ...cache.detailsByStoreId,
              [cachedRemoteDetails.storeId]: cachedRemoteDetails
            },
            lastUpdatedAt: cachedRemoteDetails.fetchedAt
          }
          await this.saveCache(cache)
          details = cachedRemoteDetails
        }
      }
    }

    return {
      status: details?.source === 'remote' ? 'ready' : 'cache-only',
      storeId: normalizedStoreId,
      message: details
        ? details.source === 'remote'
          ? 'Loaded Meta store details.'
          : 'Loaded cached Meta store details.'
        : 'No Meta store details are available for that item yet. Refresh installed apps, update metadata, or add the title to library or backup storage to enrich it.',
      details
    }
  }

  async getCachedMatchesByPackageIds(packageIds: string[]): Promise<MetaStorePackageMatchResponse> {
    const uniquePackageIds = Array.from(new Set(packageIds.map((packageId) => packageId.trim()).filter(Boolean)))
    for (const packageId of uniquePackageIds) {
      await this.hydratePackageId(packageId)
    }
    const cache = await this.ensureCacheLoaded()
    const matches: Record<string, MetaStoreGameSummary> = {}

    for (const packageId of uniquePackageIds) {
      const summary = this.findSummaryByPackageId(cache, packageId)
      if (summary) {
        matches[packageId] = summary
      }
    }

    return {
      status: Object.values(matches).some((match) => match.source === 'remote') ? 'ready' : 'cache-only',
      packageIds: uniquePackageIds,
      message: uniquePackageIds.length
        ? `Resolved ${Object.keys(matches).length} cached Meta store package match${Object.keys(matches).length === 1 ? '' : 'es'}.`
        : 'No package IDs were provided for Meta store matching.',
      matches
    }
  }

  async peekCachedMatchesByPackageIds(packageIds: string[]): Promise<MetaStorePackageMatchResponse> {
    const uniquePackageIds = Array.from(new Set(packageIds.map((packageId) => packageId.trim()).filter(Boolean)))
    const cache = await this.ensureCacheLoaded()
    const matches: Record<string, MetaStoreGameSummary> = {}

    for (const packageId of uniquePackageIds) {
      const summary = this.findSummaryByPackageId(cache, packageId)
      if (summary) {
        matches[packageId] = summary
      }
    }

    return {
      status: Object.values(matches).some((match) => match.source === 'remote') ? 'ready' : 'cache-only',
      packageIds: uniquePackageIds,
      message: uniquePackageIds.length
        ? `Loaded ${Object.keys(matches).length} cached Meta store package match${Object.keys(matches).length === 1 ? '' : 'es'}.`
        : 'No package IDs were provided for Meta store matching.',
      matches
    }
  }

  async peekCachedDetails(storeId: string): Promise<MetaStoreDetailsResponse> {
    const normalizedStoreId = this.normalizeStoreLookupId(storeId)
    const cache = await this.ensureCacheLoaded()
    const details = cache.detailsByStoreId[normalizedStoreId] ?? null

    return {
      status: details?.source === 'remote' ? 'ready' : 'cache-only',
      storeId: normalizedStoreId,
      message: details ? 'Loaded cached Meta store details.' : 'No cached Meta store details are available for that item yet.',
      details
    }
  }

  async getInstalledPackageIndex(): Promise<InstalledMetaStoreIndexResponse> {
    const index = await this.ensureInstalledIndexLoaded()
    const packageIds = Object.keys(index.matchesByPackageId)

    return {
      status: Object.values(index.matchesByPackageId).some((match) => match.source === 'remote') ? 'ready' : 'cache-only',
      packageIds,
      message: packageIds.length
        ? `Loaded installed metadata for ${packageIds.length} package${packageIds.length === 1 ? '' : 's'}.`
        : 'No installed package metadata has been indexed yet.',
      matches: index.matchesByPackageId,
      lastUpdatedAt: index.lastUpdatedAt
    }
  }

  async refreshInstalledPackageIndex(packageIds: string[]): Promise<InstalledMetaStoreIndexResponse> {
    const uniquePackageIds = Array.from(new Set(packageIds.map((packageId) => packageId.trim()).filter(Boolean)))
    const matches: Record<string, MetaStoreGameSummary> = {}

    for (const packageId of uniquePackageIds) {
      await this.hydratePackageId(packageId)
      const cache = await this.ensureCacheLoaded()
      const summary = this.findSummaryByPackageId(cache, packageId)
      if (summary) {
        matches[packageId.toLowerCase()] = summary
      }
    }

    const lastUpdatedAt = new Date().toISOString()
    await this.saveInstalledIndex({
      matchesByPackageId: matches,
      lastUpdatedAt
    })

    return {
      status: Object.values(matches).some((match) => match.source === 'remote') ? 'ready' : 'cache-only',
      packageIds: uniquePackageIds,
      message: uniquePackageIds.length
        ? `Indexed installed metadata for ${Object.keys(matches).length} of ${uniquePackageIds.length} package${uniquePackageIds.length === 1 ? '' : 's'}.`
        : 'No installed package IDs were provided for metadata indexing.',
      matches,
      lastUpdatedAt
    }
  }

  async hydrateCacheEntry(summary: MetaStoreGameSummary, details?: MetaStoreGameDetails | null): Promise<void> {
    const cache = await this.ensureCacheLoaded()
    const nextCache: MetaStoreCache = {
      summariesByStoreId: {
        ...cache.summariesByStoreId,
        [summary.storeId]: summary
      },
      detailsByStoreId: details
        ? {
            ...cache.detailsByStoreId,
            [details.storeId]: details
          }
        : cache.detailsByStoreId,
      lastUpdatedAt: new Date().toISOString()
    }

    await this.saveCache(nextCache)
  }

  async primeFromLocalLibraryIndex(index: LocalLibraryScanResponse): Promise<void> {
    if (!index.path) {
      return
    }

    const cache = await this.ensureCacheLoaded()
    const fetchedAt = new Date().toISOString()
    const nextSummaries = { ...cache.summariesByStoreId }
    const nextDetails = { ...cache.detailsByStoreId }

    for (const item of index.items) {
      if (item.availability !== 'present' || !item.packageIds.length) {
        continue
      }

      for (const packageId of item.packageIds) {
        const storeId = this.buildStoreIdFromPackageId(packageId)
        const existingSummary = nextSummaries[storeId]
        if (!existingSummary || existingSummary.source !== 'remote') {
          nextSummaries[storeId] = this.buildLocalSummaryFromLibraryItem(item, packageId, fetchedAt)
        }

        const existingDetails = nextDetails[storeId]
        if (!existingDetails || existingDetails.source !== 'remote') {
          nextDetails[storeId] = this.buildLocalDetailsFromLibraryItem(item, packageId, fetchedAt)
        }
      }
    }

    await this.saveCache({
      summariesByStoreId: nextSummaries,
      detailsByStoreId: nextDetails,
      lastUpdatedAt: fetchedAt
    })
  }
}

export const metaStoreService = new MetaStoreService()
