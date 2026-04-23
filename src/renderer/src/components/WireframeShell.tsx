import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getFallbackArtworkUri, type FallbackArtworkVariant } from '../fallbackArtwork'
import metaQuestIcon from '../assets/device-icons/meta-quest.png'
import metaQuest2Icon from '../assets/device-icons/meta-quest-2.png'
import metaQuest3Icon from '../assets/device-icons/meta-quest-3.png'
import metaQuest3sIcon from '../assets/device-icons/meta-quest-3s.png'
import metaQuestProIcon from '../assets/device-icons/meta-quest-pro.png'
import type {
  AppSettings,
  DependencyStatusResponse,
  DeviceAppsResponse,
  DeviceLeftoverScanResponse,
  DeviceListResponse,
  ManualGameMetadataOverride,
  LiveQueueItem,
  LocalLibraryIndexedItem,
  LocalLibraryScanResponse,
  MetaStoreGameDetails,
  MetaStoreGameSummary,
  PrimaryTab,
  SaveBackupEntry,
  SaveBackupsResponse,
  SaveDataRoot,
  SavePackagesScanResponse,
  SettingsPathStatsResponse,
  SettingsPathKey,
  VrSrcCatalogResponse,
  VrSrcItemDetailsResponse,
  VrSrcStatusResponse,
  VrSrcTransferOperation,
  ViewDisplayMode
} from '@shared/types/ipc'

interface UiNotice {
  text: string
  details: string | null
  tone: 'info' | 'success' | 'danger'
}

interface WireframeShellProps {
  activeTab: PrimaryTab
  onTabChange: (tab: PrimaryTab) => void
  deviceStatus: string
  deviceStatusTone: 'ready' | 'pending' | 'danger'
  deviceStatusTransport: 'usb' | 'wifi' | 'mixed' | null
  deviceStatusUsbTooltip: string | null
  deviceStatusWifiTooltip: string | null
  deviceStatusWifiDisconnectTargetId: string | null
  subtitle: string
  liveQueueItems: LiveQueueItem[]
  queueAutoOpenSignal: number
  onPauseVrSrcTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<void>
  onResumeVrSrcTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<void>
  onCancelVrSrcTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<void>
  settings: AppSettings | null
  settingsBusy: boolean
  libraryRescanBusy: boolean
  removeMissingLibraryItemBusyId: string | null
  purgeLibraryItemBusyId: string | null
  settingsMessage: string | null
  dependencyStatus: DependencyStatusResponse | null
  libraryMessage: UiNotice | null
  localLibraryIndex: LocalLibraryScanResponse | null
  backupStorageIndex: LocalLibraryScanResponse | null
  gameSavesPathStats: SettingsPathStatsResponse | null
  saveBackupsResponse: SaveBackupsResponse | null
  saveScanResponse: SavePackagesScanResponse | null
  metaStoreMatchesByItemId: Record<string, MetaStoreGameSummary>
  installedMetaStoreMatchesByPackageId: Record<string, MetaStoreGameSummary>
  metaStoreSyncProgress: { completed: number; total: number } | null
  isLibraryScanDialogOpen: boolean
  deviceResponse: DeviceListResponse | null
  deviceBusy: boolean
  deviceMessage: string | null
  selectedDeviceId: string | null
  deviceAppsResponse: DeviceAppsResponse | null
  deviceUserName: string | null
  deviceUserNameBusy: boolean
  deviceAppsBusy: boolean
  deviceAppsMessage: string | null
  deviceLeftoverResponse: DeviceLeftoverScanResponse | null
  deviceLeftoverBusy: boolean
  deviceLeftoverBusyItemId: string | null
  deviceLeftoverMessage: string | null
  inventoryMessage: UiNotice | null
  inventoryActionBusyPackageId: string | null
  gamesInstallBusyIds: string[]
  manualInstallBusyKind: 'apk' | 'folder' | null
  backupStorageActionBusyItemId: string | null
  gamesMessage: UiNotice | null
  vrSrcStatus: VrSrcStatusResponse | null
  vrSrcCatalog: VrSrcCatalogResponse | null
  isVrSrcPanelOpen: boolean
  vrSrcSyncBusy: boolean
  vrSrcMaintenanceBusy: boolean
  vrSrcActionBusyReleaseNames: string[]
  vrSrcMessage: UiNotice | null
  saveGamesBusy: boolean
  saveGamesBatchBusy: boolean
  saveGamesActionBusyPackageId: string | null
  saveGamesRestoreBusyBackupId: string | null
  saveGamesDeleteBusyBackupId: string | null
  saveGamesMessage: UiNotice | null
  gamesDisplayMode: ViewDisplayMode
  inventoryDisplayMode: ViewDisplayMode
  onSelectDevice: (serial: string | null) => void
  onRefreshDevices: () => Promise<void>
  onChooseSettingsPath: (key: SettingsPathKey) => Promise<void>
  onClearSettingsPath: (key: SettingsPathKey) => Promise<void>
  onClearVrSrcCache: () => Promise<void>
  onRescanLocalLibrary: () => Promise<void>
  onInstallManualLibrarySource: (kind: 'apk' | 'folder') => Promise<void>
  onRemoveMissingLibraryItem: (itemId: string) => Promise<void>
  onPurgeLibraryItem: (itemId: string) => Promise<void>
  onSaveLocalLibraryItemManualStoreId: (itemId: string, storeId: string) => Promise<void>
  onSaveIndexedItemManualMetadata: (source: 'library' | 'backup', itemId: string, metadata: ManualGameMetadataOverride) => Promise<void>
  onImportManualMetadataImage: (target: 'hero' | 'cover') => Promise<string | null>
  onExtractIndexedItemArtwork: (source: 'library' | 'backup', itemId: string, target: 'hero' | 'cover') => Promise<string | null>
  onDismissLibraryScanDialog: () => void
  onConnectDevice: (address: string) => Promise<void>
  onDisconnectDevice: (serial: string) => Promise<void>
  onRefreshLeftoverData: (serial: string) => Promise<void>
  onDeleteLeftoverData: (itemId: string) => Promise<void>
  onRefreshInstalledApps: (serial: string) => Promise<void>
  onSaveDeviceUserName: (userName: string) => Promise<void>
  onSetGamesDisplayMode: (mode: ViewDisplayMode) => Promise<void>
  onSetInventoryDisplayMode: (mode: ViewDisplayMode) => Promise<void>
  onUninstallInstalledApp: (packageId: string) => Promise<void>
  onBackupInstalledApp: (packageId: string) => Promise<void>
  onInstallLocalLibraryItem: (itemId: string) => Promise<void>
  onMoveBackupStorageItemToLibrary: (itemId: string) => Promise<void>
  onDeleteBackupStorageItem: (itemId: string) => Promise<void>
  onRefreshAllMetadata: () => Promise<void>
  onToggleVrSrcPanel: () => void
  onSyncVrSrcCatalog: () => Promise<void>
  onDownloadVrSrcToLibrary: (releaseName: string) => Promise<void>
  onDownloadVrSrcToLibraryAndInstall: (releaseName: string) => Promise<void>
  onInstallVrSrcNow: (releaseName: string) => Promise<void>
  onRefreshSaveBackups: () => Promise<void>
  onScanSavePackages: () => Promise<void>
  onScanSavePackage: (packageId: string, appName: string | null) => Promise<void>
  onBackupAllSavePackages: () => Promise<void>
  onBackupSavePackage: (packageId: string, appName: string | null) => Promise<void>
  onRestoreSaveBackup: (packageId: string, backupId: string, appName: string | null) => Promise<void>
  onDeleteSaveBackup: (backupId: string) => Promise<void>
}

const primaryTabs: { id: PrimaryTab; label: string; note: string }[] = [
  { id: 'games', label: 'Apps & Games', note: 'Manager your Library' },
  { id: 'saves', label: 'Game Saves', note: 'Create, restore and manage your saves' },
  { id: 'manager', label: 'ADB Manager', note: 'ADB, ADB-over-WiFi, and Live Devices' },
  { id: 'settings', label: 'Settings', note: 'Paths & Maintenance' }
]

const heroContent: Record<
  PrimaryTab,
  {
    eyebrow: string
    title: string
  }
> = {
  manager: {
    eyebrow: '',
    title: 'All things ADB'
  },
  games: {
    eyebrow: '',
    title: 'Apps & Games'
  },
  saves: {
    eyebrow: '',
    title: 'Game Saves'
  },
  inventory: {
    eyebrow: '',
    title: 'What is on my headset?'
  },
  settings: {
    eyebrow: '',
    title: 'Settings, and maintenance'
  }
}

const gameFilters = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'updates', label: 'Updates' },
  { id: 'ready', label: 'In Library' },
  { id: 'offline', label: 'Backup Storage' },
  { id: 'unidentified', label: 'Review' }
] as const

type GamesFilterId = (typeof gameFilters)[number]['id']
type GamesSortKey = 'title' | 'date' | 'size'
type GamesSortDirection = 'asc' | 'desc'
type GamesDisplayMode = ViewDisplayMode

type LibraryGameRow = {
  id: string
  source: 'library' | 'backup'
  itemId: string
  title: string
  metaStoreMatch: MetaStoreGameSummary | null
  hasResolvedMetaStoreMatch: boolean
  version: string
  primaryVersionValue: string | null
  storeVersion: string | null
  libraryVersion: string | null
  libraryVersionCode: string | null
  installedVersion: string | null
  status: string
  size: string
  sizeBytes: number | null
  action: string
  note: string
  release: string
  cta: string
  fallback: string
  searchTerms: string[]
  packageIds: string[]
  manualStoreId: string | null | undefined
  manualStoreIdEdited: boolean | undefined
  manualMetadata: ManualGameMetadataOverride | null
  isInstalled: boolean
  hasLibraryUpdate: boolean
  filterTags: GamesFilterId[]
  heroImageUri: string | null
  thumbnailUri: string | null
  installReady: boolean
  sourceLastUpdatedAt: string | null
  modifiedAt: string | null
  kind: LocalLibraryIndexedItem['kind']
  relativePath: string
  duplicateGroupKey: string
  hiddenVersionCount: number
  lowerLibraryVersions: LibraryGameVersionSummary[]
}

type LibraryGameVersionSummary = {
  id: string
  itemId: string
  version: string | null
  versionLabel: string
  relativePath: string
  title: string
  size: string
}

function scoreLibraryGameRow(row: LibraryGameRow): number {
  let score = 0
  const normalizedPath = row.relativePath.toLowerCase()
  const normalizedPackageIds = row.packageIds.map((packageId) => packageId.toLowerCase())

  if (row.isInstalled) {
    score += 120
  }

  if (row.hasLibraryUpdate) {
    score += 70
  }

  if (row.source === 'backup') {
    score -= 120
  }

  if (row.installReady) {
    score += 50
  }

  if (row.kind === 'apk') {
    score += 35
  } else if (row.kind === 'folder') {
    score += 25
  } else if (row.kind === 'archive') {
    score -= 10
  }

  if (row.hasResolvedMetaStoreMatch) {
    score += 10
  }

  if (normalizedPackageIds.some((packageId) => packageId.includes('.mrf.'))) {
    score -= 15
  }

  if (normalizedPath.includes('mr-fix') || normalizedPath.includes('(mr-fix)')) {
    score -= 15
  }

  if (normalizedPath.includes('backup') || normalizedPath.includes('savebackup') || normalizedPath.includes('savebackups')) {
    score -= 80
  }

  return score
}

function resolveMetaStoreArtworkUri(summary: MetaStoreGameSummary | null): string | null {
  return (
    summary?.heroImage?.uri ??
    summary?.portraitImage?.uri ??
    summary?.thumbnail?.uri ??
    summary?.iconImage?.uri ??
    summary?.logoImage?.uri ??
    null
  )
}

function normalizeLibraryGameIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function collapseSearchText(value: string | null | undefined): string {
  return normalizeSearchText(value).replace(/\s+/g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesSearchText(values: Array<string | null | undefined>, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) {
    return true
  }

  const collapsedQuery = collapseSearchText(query)
  const queryPattern = new RegExp(`(?:^| )${escapeRegExp(normalizedQuery)}(?:$| )`)

  if (!collapsedQuery) {
    return false
  }

  return values.some((value) => {
    const normalizedValue = normalizeSearchText(value)

    if (!normalizedValue) {
      return false
    }

    if (normalizedValue === normalizedQuery || queryPattern.test(normalizedValue)) {
      return true
    }

    const collapsedValue = collapseSearchText(value)

    if (!collapsedValue) {
      return false
    }

    if (collapsedValue === collapsedQuery) {
      return true
    }

    const queryTokens = normalizedQuery.split(' ').filter(Boolean)
    const valueTokens = normalizedValue.split(' ').filter(Boolean)

    if (queryTokens.length === 1 && valueTokens.some((token) => token.startsWith(normalizedQuery))) {
      return true
    }

    if (
      queryTokens.length > 1 &&
      valueTokens.some((_, startIndex) =>
        queryTokens.every((token, tokenIndex) => valueTokens[startIndex + tokenIndex]?.startsWith(token))
      )
    ) {
      return true
    }

    return collapsedValue.includes(collapsedQuery)
  })
}

function getRelativePathBaseName(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const segments = value.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? null
}

function getPlaceholderInitial(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, 1).toLocaleUpperCase() : '?'
}

function buildFallbackArtworkStyle(uri: string): CSSProperties {
  return {
    backgroundImage: `url(${uri})`
  }
}

function renderFallbackArtworkSurface(
  label: string | null | undefined,
  artworkKey: string | null | undefined,
  variant: FallbackArtworkVariant,
  className: string
): ReactNode {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={buildFallbackArtworkStyle(getFallbackArtworkUri(artworkKey, variant))}
    >
      <span>{getPlaceholderInitial(label)}</span>
    </div>
  )
}

function ResilientArtworkImage({
  src,
  alt = '',
  className,
  label,
  artworkKey,
  variant,
  fallbackClassName
}: {
  src: string | null | undefined
  alt?: string
  className: string
  label: string | null | undefined
  artworkKey: string | null | undefined
  variant: FallbackArtworkVariant
  fallbackClassName: string
}): ReactNode {
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setLoadFailed(false)
  }, [src])

  if (!src || loadFailed) {
    return renderFallbackArtworkSurface(label, artworkKey, variant, fallbackClassName)
  }

  return <img alt={alt} className={className} onError={() => setLoadFailed(true)} src={src} />
}

function formatGameActionLabel(action: string): string {
  if (action === 'Install') {
    return 'Install Now'
  }

  if (action === 'Update') {
    return 'Install Local Upgrade'
  }

  return action
}

function normalizeVersionIdentity(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^v/i, '').toLowerCase()
}

function tokenizeVersionIdentity(value: string | null | undefined): Array<number | string> {
  return normalizeVersionIdentity(value)
    .split(/[^a-z0-9]+/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number.parseInt(segment, 10) : segment))
}

function compareVersionValues(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = tokenizeVersionIdentity(left)
  const rightTokens = tokenizeVersionIdentity(right)

  if (!leftTokens.length && !rightTokens.length) {
    return 0
  }

  if (!leftTokens.length) {
    return -1
  }

  if (!rightTokens.length) {
    return 1
  }

  const maxLength = Math.max(leftTokens.length, rightTokens.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = leftTokens[index]
    const rightToken = rightTokens[index]

    if (leftToken === undefined) {
      return -1
    }

    if (rightToken === undefined) {
      return 1
    }

    if (typeof leftToken === 'number' && typeof rightToken === 'number') {
      if (leftToken !== rightToken) {
        return leftToken > rightToken ? 1 : -1
      }
      continue
    }

    const leftText = String(leftToken)
    const rightText = String(rightToken)
    if (leftText !== rightText) {
      return leftText.localeCompare(rightText, undefined, { sensitivity: 'base' })
    }
  }

  return 0
}

function formatVersionLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim()

  if (!normalized) {
    return null
  }

  if (/^v/i.test(normalized) || !/^\d/.test(normalized)) {
    return normalized
  }

  return `v${normalized}`
}

function buildImageAssetFromUri(uri: string | null | undefined) {
  const trimmed = uri?.trim()
  return trimmed
    ? {
        uri: trimmed,
        width: null,
        height: null
      }
    : null
}

function applyManualMetadataOverride(
  details: MetaStoreGameDetails | null,
  override: ManualGameMetadataOverride | null,
  fallback: {
    title: string
    release: string
    note: string
    version: string | null
  }
): MetaStoreGameDetails | null {
  if (!override) {
    return details
  }

  const overriddenGenres = (override.category ?? '')
    .split(/[,|]/)
    .map((value) => value.trim())
    .filter(Boolean)
  const baseStoreId = details?.storeId ?? `manual:${fallback.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const baseFetchedAt = details?.fetchedAt ?? new Date(0).toISOString()
  const basePackageId = details?.packageId ?? null
  const nextThumbnail = override.thumbnailUri ? buildImageAssetFromUri(override.thumbnailUri) : details?.thumbnail ?? null
  const nextHeroImage = override.heroImageUri ? buildImageAssetFromUri(override.heroImageUri) : details?.heroImage ?? null

  return {
    storeId: baseStoreId,
    storeItemId: details?.storeItemId ?? null,
    packageId: basePackageId,
    title: override.title ?? details?.title ?? fallback.title,
    subtitle: override.publisherName ?? details?.subtitle ?? fallback.release,
    category: override.category ?? details?.category ?? null,
    publisherName: override.publisherName ?? details?.publisherName ?? null,
    genreNames: overriddenGenres.length ? overriddenGenres : details?.genreNames ?? [],
    releaseDateLabel: override.releaseDateLabel ?? details?.releaseDateLabel ?? null,
    canonicalName: details?.canonicalName ?? null,
    thumbnail: nextThumbnail,
    heroImage: nextHeroImage,
    portraitImage: details?.portraitImage ?? nextThumbnail,
    iconImage: details?.iconImage ?? nextThumbnail,
    logoImage: details?.logoImage ?? null,
    version: override.version ?? details?.version ?? fallback.version,
    versionCode: details?.versionCode ?? null,
    sizeBytes: details?.sizeBytes ?? null,
    ratingAverage: details?.ratingAverage ?? null,
    priceLabel: details?.priceLabel ?? null,
    source: details?.source ?? 'cache',
    fetchedAt: baseFetchedAt,
    shortDescription: override.shortDescription ?? details?.shortDescription ?? null,
    longDescription: override.longDescription ?? details?.longDescription ?? null,
    languageNames: details?.languageNames ?? [],
    interactionModeNames: details?.interactionModeNames ?? [],
    internetConnectionName: details?.internetConnectionName ?? null,
    gamepadRequired: details?.gamepadRequired ?? null,
    websiteUrl: details?.websiteUrl ?? null,
    ratingHistogram: details?.ratingHistogram ?? []
  }
}

function buildLibraryGameRowDisplay(
  fallbackTitle: string,
  item: Pick<
    LocalLibraryIndexedItem,
    'kind' | 'note' | 'relativePath' | 'manualMetadata' | 'libraryVersion' | 'searchTerms'
  >,
  metaStoreMatch: MetaStoreGameSummary | null
) {
  const manualMetadata = item.manualMetadata ?? null
  const title = manualMetadata?.title ?? metaStoreMatch?.title ?? fallbackTitle
  const publisherName = manualMetadata?.publisherName ?? metaStoreMatch?.publisherName ?? null
  const category = manualMetadata?.category ?? metaStoreMatch?.category ?? null
  const note =
    [publisherName, category].filter((value): value is string => Boolean(value)).join(' • ') || item.note
  const release =
    manualMetadata?.releaseDateLabel ??
    metaStoreMatch?.subtitle ??
    `Indexed from ${item.relativePath}.`
  const version = manualMetadata?.version ?? metaStoreMatch?.version ?? item.libraryVersion ?? null
  const thumbnailUri =
    manualMetadata?.thumbnailUri ??
    manualMetadata?.heroImageUri ??
    metaStoreMatch?.thumbnail?.uri ??
    metaStoreMatch?.iconImage?.uri ??
    metaStoreMatch?.portraitImage?.uri ??
    metaStoreMatch?.heroImage?.uri ??
    metaStoreMatch?.logoImage?.uri ??
    null
  const heroImageUri =
    manualMetadata?.heroImageUri ??
    metaStoreMatch?.heroImage?.uri ??
    metaStoreMatch?.portraitImage?.uri ??
    thumbnailUri

  return {
    title,
    note,
    release,
    version,
    thumbnailUri,
    heroImageUri,
    searchTerms: [
      title,
      publisherName ?? '',
      category ?? '',
      manualMetadata?.shortDescription ?? '',
      manualMetadata?.longDescription ?? '',
      ...(item.searchTerms ?? [])
    ]
  }
}

function getLibraryGameVersionLines(row: LibraryGameRow): string[] {
  const primaryVersionIdentity = normalizeVersionIdentity(row.primaryVersionValue)
  const installedVersionIdentity = normalizeVersionIdentity(row.installedVersion)
  const storeVersionIdentity = normalizeVersionIdentity(row.storeVersion)
  const lines: string[] = []

  if (row.installedVersion && installedVersionIdentity !== primaryVersionIdentity) {
    lines.push(`Installed ${formatVersionLabel(row.installedVersion) ?? row.installedVersion}`)
  }

  if (
    row.storeVersion &&
    storeVersionIdentity !== primaryVersionIdentity &&
    storeVersionIdentity !== installedVersionIdentity
  ) {
    lines.push(`Latest ${formatVersionLabel(row.storeVersion) ?? row.storeVersion}`)
  }

  return lines
}

function getLibraryGameDedupeKey(row: LibraryGameRow): string {
  const normalizedPackageIds = row.packageIds
    .map((packageId) => packageId.trim().toLowerCase())
    .filter(Boolean)
    .sort()

  if (normalizedPackageIds.length) {
    return `package:${normalizedPackageIds.join('|')}`
  }

  const manualStoreId = row.manualStoreId?.trim()

  if (manualStoreId) {
    return `manual:${manualStoreId.toLowerCase()}`
  }

  if (row.kind === 'folder') {
    return `folder:${row.source}:${normalizeLibraryGameIdentity(row.relativePath)}`
  }

  const normalizedTitle = normalizeLibraryGameIdentity(row.title)
  const normalizedPublisher = normalizeLibraryGameIdentity(row.note)

  if (normalizedTitle) {
    return `title:${normalizedTitle}|publisher:${normalizedPublisher}`
  }

  if (row.metaStoreMatch?.storeItemId) {
    return `store:${row.metaStoreMatch.storeItemId}`
  }

  return `package:${row.packageIds[0]?.toLowerCase() ?? row.id}`
}

function compareLibraryGameRowsForDisplay(left: LibraryGameRow, right: LibraryGameRow): number {
  const versionComparison = compareVersionValues(right.primaryVersionValue, left.primaryVersionValue)
  if (versionComparison !== 0) {
    return versionComparison
  }

  const scoreComparison = scoreLibraryGameRow(right) - scoreLibraryGameRow(left)
  if (scoreComparison !== 0) {
    return scoreComparison
  }

  const sizeComparison = (right.sizeBytes ?? 0) - (left.sizeBytes ?? 0)
  if (sizeComparison !== 0) {
    return sizeComparison
  }

  return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
}

function collapseLibraryGameRows(rows: LibraryGameRow[]): LibraryGameRow[] {
  const grouped = new Map<string, LibraryGameRow[]>()

  for (const row of rows) {
    const dedupeKey = getLibraryGameDedupeKey(row)
    const currentGroup = grouped.get(dedupeKey)

    if (currentGroup) {
      currentGroup.push(row)
    } else {
      grouped.set(dedupeKey, [row])
    }
  }

  return Array.from(grouped.entries()).flatMap(([dedupeKey, siblings]) => {
    const sortedSiblings = [...siblings].sort(compareLibraryGameRowsForDisplay)
    const displayRow = sortedSiblings[0]
    const aggregatedSearchTerms = Array.from(
      new Set(
        siblings
          .flatMap((row) => [
            ...row.searchTerms,
            ...row.packageIds,
            row.relativePath,
            row.version,
            row.primaryVersionValue,
            row.libraryVersion,
            row.storeVersion,
            row.installedVersion
          ])
          .filter((value): value is string => Boolean(value))
      )
    )
    const aggregatedPackageIds = Array.from(
      new Set(siblings.flatMap((row) => row.packageIds.map((packageId) => packageId.trim()).filter(Boolean)))
    )
    const lowerLibraryVersions = sortedSiblings
      .filter(
        (row) =>
          row.source === 'library' &&
          row.itemId &&
          row.id !== displayRow.id &&
          compareVersionValues(row.primaryVersionValue, displayRow.primaryVersionValue) < 0
      )
      .map((row) => ({
        id: row.id,
        itemId: row.itemId,
        version: row.libraryVersion ?? row.primaryVersionValue,
        versionLabel: formatVersionLabel(row.libraryVersion ?? row.primaryVersionValue) ?? 'Unknown version',
        relativePath: row.relativePath,
        title: row.title,
        size: row.size
      }))

    return siblings.map((row) => ({
      ...row,
      duplicateGroupKey: dedupeKey,
      searchTerms: aggregatedSearchTerms,
      packageIds: aggregatedPackageIds,
      hiddenVersionCount: row.id === displayRow.id ? Math.max(0, siblings.length - 1) : 0,
      lowerLibraryVersions: row.id === displayRow.id ? lowerLibraryVersions : []
    }))
  })
}

function selectLatestLibraryGameRows(rows: LibraryGameRow[]): LibraryGameRow[] {
  const grouped = new Map<string, LibraryGameRow[]>()

  for (const row of rows) {
    const currentGroup = grouped.get(row.duplicateGroupKey)

    if (currentGroup) {
      currentGroup.push(row)
    } else {
      grouped.set(row.duplicateGroupKey, [row])
    }
  }

  return Array.from(grouped.values()).map((siblings) => [...siblings].sort(compareLibraryGameRowsForDisplay)[0])
}

function buildGameMetaMatchKey(source: LibraryGameRow['source'], itemId: string): string {
  return `${source}:${itemId}`
}

function selectLatestVrSrcTimestamp(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current
  }

  if (!current) {
    return candidate
  }

  const currentTime = Date.parse(current)
  const candidateTime = Date.parse(candidate)

  if (Number.isNaN(candidateTime)) {
    return current
  }

  if (Number.isNaN(currentTime) || candidateTime > currentTime) {
    return candidate
  }

  return current
}

const settingsPathFields: {
  key: SettingsPathKey
  title: string
  description: string
  icon: 'archive' | 'save' | 'folder'
  tone: 'warm' | 'cool' | 'teal'
}[] = [
  {
    key: 'backupPath',
    title: 'Backups',
    description: 'Device backups, exports, and recovery packages.',
    icon: 'archive',
    tone: 'warm'
  },
  {
    key: 'gameSavesPath',
    title: 'Game Saves',
    description: 'Savegame files, exports, and restore-ready packages.',
    icon: 'save',
    tone: 'cool'
  },
  {
    key: 'localLibraryPath',
    title: 'Local Library',
    description: 'Install-ready archives, mirrored payloads, and manually imported packages.',
    icon: 'folder',
    tone: 'teal'
  }
]

function renderDeviceStatusTransport(props: {
  transport: 'usb' | 'wifi' | 'mixed' | null
  usbTooltip: string | null
  wifiTooltip: string | null
  wifiDisconnectTargetId: string | null
  onDisconnectDevice: (serial: string) => Promise<void>
}) {
  const { transport, usbTooltip, wifiTooltip, wifiDisconnectTargetId, onDisconnectDevice } = props

  if (!transport) {
    return null
  }

  if (transport === 'mixed') {
    return (
      <>
        <span className="transport-indicator" title={usbTooltip ?? 'USB ADB is active.'}>
          <span aria-hidden="true" className="transport-icon transport-usb" />
        </span>
        {wifiDisconnectTargetId ? (
          <button
            aria-label="Disconnect Wi-Fi ADB connection"
            className="transport-button"
            onClick={() => void onDisconnectDevice(wifiDisconnectTargetId)}
            title={wifiTooltip ?? 'Press to disconnect this Wi-Fi ADB connection.'}
            type="button"
          >
            <span aria-hidden="true" className="transport-icon transport-wifi" />
          </button>
        ) : (
          <span className="transport-indicator" title={wifiTooltip ?? 'Wi-Fi ADB is active.'}>
            <span aria-hidden="true" className="transport-icon transport-wifi" />
          </span>
        )}
      </>
    )
  }

  const iconClass = transport === 'wifi' ? 'transport-icon transport-wifi' : 'transport-icon transport-usb'

  if (transport === 'wifi' && wifiDisconnectTargetId) {
    return (
      <button
        aria-label="Disconnect Wi-Fi ADB connection"
        className="transport-button"
        onClick={() => void onDisconnectDevice(wifiDisconnectTargetId)}
        title={wifiTooltip ?? 'Press to disconnect this Wi-Fi ADB connection.'}
        type="button"
      >
        <span aria-hidden="true" className={iconClass} />
      </button>
    )
  }

  return (
    <span className="transport-indicator" title={usbTooltip ?? 'USB ADB is active.'}>
      <span aria-hidden="true" className={iconClass} />
    </span>
  )
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return 'Unavailable'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let currentValue = value
  let unitIndex = 0

  while (currentValue >= 1024 && unitIndex < units.length - 1) {
    currentValue /= 1024
    unitIndex += 1
  }

  const rounded = currentValue >= 100 || unitIndex === 0 ? Math.round(currentValue) : Number(currentValue.toFixed(1))
  return `${rounded} ${units[unitIndex]}`
}

interface RichTextSegment {
  type: 'text' | 'strong' | 'em' | 'code' | 'link'
  text: string
  href?: string
}

interface GameDescriptionBlock {
  type: 'paragraph' | 'list'
  items: RichTextSegment[][]
}

interface GameDescriptionSection {
  title: string
  blocks: GameDescriptionBlock[]
}

interface GameDescriptionContent {
  overview: GameDescriptionBlock[]
  sections: GameDescriptionSection[]
  links: string[]
}

function parseInlineMarkdown(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = []
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_/g
  let lastIndex = 0

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, index) })
    }

    if (match[1] && match[2]) {
      segments.push({ type: 'link', text: match[1], href: match[2] })
    } else if (match[3] || match[4]) {
      segments.push({ type: 'strong', text: match[3] ?? match[4] ?? '' })
    } else if (match[5]) {
      segments.push({ type: 'code', text: match[5] })
    } else if (match[6] || match[7]) {
      segments.push({ type: 'em', text: match[6] ?? match[7] ?? '' })
    }

    lastIndex = index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return segments.filter((segment) => segment.text.length > 0)
}

function parseMarkdownBlocks(raw: string | null | undefined): GameDescriptionBlock[] {
  if (!raw) {
    return []
  }

  const blocks: GameDescriptionBlock[] = []
  const lines = raw.split('\n')
  let paragraphLines: string[] = []
  let listItems: string[] = []

  const pushParagraph = () => {
    const text = paragraphLines.join(' ').replace(/\s+/g, ' ').trim()
    if (text) {
      blocks.push({ type: 'paragraph', items: [parseInlineMarkdown(text)] })
    }
    paragraphLines = []
  }

  const pushList = () => {
    const items = listItems
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => parseInlineMarkdown(item))
    if (items.length) {
      blocks.push({ type: 'list', items })
    }
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      pushParagraph()
      pushList()
      continue
    }

    const listMatch = line.match(/^[-*+]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/)
    if (listMatch) {
      pushParagraph()
      listItems.push(listMatch[1])
      continue
    }

    pushList()
    paragraphLines.push(line)
  }

  pushParagraph()
  pushList()

  return blocks
}

function renderInlineMarkdown(segments: RichTextSegment[], keyPrefix: string): ReactNode[] {
  return segments.map((segment, index) => {
    const key = `${keyPrefix}-${index}`
    switch (segment.type) {
      case 'strong':
        return <strong key={key}>{segment.text}</strong>
      case 'em':
        return <em key={key}>{segment.text}</em>
      case 'code':
        return (
          <code className="games-drawer-inline-code" key={key}>
            {segment.text}
          </code>
        )
      case 'link':
        return (
          <a className="games-drawer-inline-link" href={segment.href} key={key} rel="noreferrer" target="_blank">
            {segment.text}
          </a>
        )
      default:
        return <span key={key}>{segment.text}</span>
    }
  })
}

function renderDescriptionBlocks(
  blocks: GameDescriptionBlock[],
  keyPrefix: string,
  paragraphClassName = 'section-copy compact games-drawer-long-copy'
): ReactNode[] {
  return blocks.map((block, blockIndex) => {
    const blockKey = `${keyPrefix}-${blockIndex}`
    if (block.type === 'list') {
      return (
        <ul className="games-drawer-list" key={blockKey}>
          {block.items.map((item, itemIndex) => (
            <li key={`${blockKey}-item-${itemIndex}`}>{renderInlineMarkdown(item, `${blockKey}-item-${itemIndex}`)}</li>
          ))}
        </ul>
      )
    }

    return (
      <p className={paragraphClassName} key={blockKey}>
        {renderInlineMarkdown(block.items[0] ?? [], `${blockKey}-paragraph`)}
      </p>
    )
  })
}

function formatGameDescription(raw: string | null | undefined): GameDescriptionContent {
  if (!raw) {
    return { overview: [], sections: [], links: [] }
  }

  const sanitized = raw
    .replace(/\r/g, '')
    .replace(/\[media\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const lines = sanitized.split('\n')
  const overview: GameDescriptionBlock[] = []
  const sections: GameDescriptionSection[] = []
  const links = Array.from(new Set(sanitized.match(/https?:\/\/[^\s)]+/g) ?? []))

  let currentTitle: string | null = null
  let currentBody: string[] = []

  const pushCurrent = () => {
    const body = currentBody.join('\n').trim()
    if (!body) {
      currentTitle = null
      currentBody = []
      return
    }

    const blocks = parseMarkdownBlocks(body)
    if (!blocks.length) {
      currentTitle = null
      currentBody = []
      return
    }

    if (currentTitle) {
      sections.push({ title: currentTitle, blocks })
    } else {
      overview.push(...blocks)
    }

    currentTitle = null
    currentBody = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      pushCurrent()
      continue
    }

    if (line.startsWith('#')) {
      pushCurrent()
      currentTitle = line.replace(/^#+\s*/, '').replace(/^[^A-Za-z0-9]+/, '').trim()
      continue
    }

    currentBody.push(line)
  }

  pushCurrent()

  return { overview, sections, links }
}

function computeStorageUsage(totalBytes: number | null, freeBytes: number | null): number | null {
  if (
    totalBytes === null ||
    freeBytes === null ||
    !Number.isFinite(totalBytes) ||
    !Number.isFinite(freeBytes) ||
    totalBytes <= 0
  ) {
    return null
  }

  const usedBytes = Math.max(totalBytes - freeBytes, 0)
  return Math.min(Math.max((usedBytes / totalBytes) * 100, 0), 100)
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'Unavailable'
  }

  return `${Math.round(value)}% used`
}

const QUEST_DEVICE_CATALOG = [
  {
    family: 'Quest',
    aliases: ['meta quest', 'quest', 'oculus quest'],
    storageOptionsGb: [64, 128],
    imageUrl: metaQuestIcon
  },
  {
    family: 'Quest 2',
    aliases: ['meta quest 2', 'quest 2', 'oculus quest 2'],
    storageOptionsGb: [64, 128, 256],
    imageUrl: metaQuest2Icon
  },
  {
    family: 'Quest Pro',
    aliases: ['meta quest pro', 'quest pro'],
    storageOptionsGb: [256],
    imageUrl: metaQuestProIcon
  },
  {
    family: 'Quest 3',
    aliases: ['meta quest 3', 'quest 3'],
    storageOptionsGb: [128, 512],
    imageUrl: metaQuest3Icon
  },
  {
    family: 'Quest 3S',
    aliases: ['meta quest 3s', 'quest 3s'],
    storageOptionsGb: [128, 256],
    imageUrl: metaQuest3sIcon
  }
] as const

type QuestDeviceCatalogEntry = (typeof QUEST_DEVICE_CATALOG)[number]

function normalizeQuestModelName(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/[_-]+/g, ' ')
    .replace(/^oculus\s+/i, 'Meta ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function resolveQuestStorageIndicator(
  modelCandidates: Array<string | null | undefined>,
  totalBytes: number | null
): {
  family: QuestDeviceCatalogEntry['family']
  storageLabel: string
  imageUrl: string
} | null {
  const normalizedCandidates = modelCandidates
    .map((value) => normalizeQuestModelName(value))
    .filter(Boolean)
  const deviceEntry = QUEST_DEVICE_CATALOG.find((entry) =>
    normalizedCandidates.some((candidate) => entry.aliases.some((alias) => alias === candidate))
  )

  if (!deviceEntry) {
    const fallbackTotalGb = totalBytes && totalBytes > 0 ? totalBytes / 1_000_000_000 : 128
    const fallbackStorageOption = [64, 128, 256, 512].reduce((best, current) =>
      Math.abs(current - fallbackTotalGb) < Math.abs(best - fallbackTotalGb) ? current : best
    )
    return {
      family: 'Quest',
      storageLabel: `${fallbackStorageOption}GB`,
      imageUrl: metaQuestIcon
    }
  }

  const storageOption =
    !totalBytes || totalBytes <= 0
      ? deviceEntry.storageOptionsGb[0]
      : deviceEntry.storageOptionsGb.reduce((best, current) => {
          const totalGb = totalBytes / 1_000_000_000
          return Math.abs(current - totalGb) < Math.abs(best - totalGb) ? current : best
        }, deviceEntry.storageOptionsGb[0])

  return {
    family: deviceEntry.family,
    storageLabel: `${storageOption}GB`,
    imageUrl: deviceEntry.imageUrl
  }
}

function formatTimeLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) {
    return 'Pending'
  }

  return new Date(value).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatSortDateLabel(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

function renderBreakablePackageId(value: string): ReactNode[] {
  const parts: ReactNode[] = []
  let buffer = ''

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]
    const previous = index > 0 ? value[index - 1] : ''
    const next = index + 1 < value.length ? value[index + 1] : ''

    const shouldBreakBeforeCurrent =
      index > 0 &&
      /[A-Z]/.test(current) &&
      /[a-z0-9]/.test(previous) &&
      next !== ''

    if (shouldBreakBeforeCurrent && buffer) {
      parts.push(buffer)
      parts.push(<wbr key={`pkg-break-camel-${index}`} />)
      buffer = ''
    }

    buffer += current

    if (current === '.' || current === '_' || current === '-') {
      parts.push(buffer)
      parts.push(<wbr key={`pkg-break-delim-${index}`} />)
      buffer = ''
    }
  }

  if (buffer) {
    parts.push(buffer)
  }

  return parts
}

function isWithinLastDays(value: string | null | undefined, days: number): boolean {
  if (!value) {
    return false
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return false
  }

  const now = Date.now()
  return parsed >= now - days * 24 * 60 * 60 * 1000
}

function describeLibraryItemKind(item: LocalLibraryIndexedItem): string {
  if (item.kind === 'apk') {
    return 'APK'
  }

  if (item.kind === 'obb') {
    return 'OBB'
  }

  if (item.kind === 'archive') {
    return 'Archive'
  }

  if (item.kind === 'folder' && item.installReady) {
    return 'Install Folder'
  }

  if (item.kind === 'folder') {
    return 'Folder'
  }

  return 'File'
}

function buildPackageSummaryLookup(
  localLibraryIndex: LocalLibraryScanResponse | null,
  backupStorageIndex: LocalLibraryScanResponse | null,
  metaStoreMatchesByItemId: Record<string, MetaStoreGameSummary>,
  installedMetaStoreMatchesByPackageId: Record<string, MetaStoreGameSummary> = {}
): Map<string, MetaStoreGameSummary> {
  const packageSummaryByPackageId = new Map<string, MetaStoreGameSummary>()

  for (const [source, index] of [
    ['library', localLibraryIndex],
    ['backup', backupStorageIndex]
  ] as const) {
    for (const item of index?.items ?? []) {
      if (item.availability !== 'present') {
        continue
      }

      const summary = metaStoreMatchesByItemId[buildGameMetaMatchKey(source, item.id)] ?? null
      if (!summary) {
        continue
      }

      for (const packageId of item.packageIds ?? []) {
        const normalizedPackageId = packageId.toLowerCase()
        if (!packageSummaryByPackageId.has(normalizedPackageId)) {
          packageSummaryByPackageId.set(normalizedPackageId, summary)
        }
      }
    }
  }

  for (const [packageId, summary] of Object.entries(installedMetaStoreMatchesByPackageId)) {
    const normalizedPackageId = packageId.toLowerCase()
    if (!packageSummaryByPackageId.has(normalizedPackageId)) {
      packageSummaryByPackageId.set(normalizedPackageId, summary)
    }
  }

  return packageSummaryByPackageId
}

function resolveInstalledPackageSummary(
  packageId: string,
  packageSummaryByPackageId: Map<string, MetaStoreGameSummary>,
  installedMetaStoreMatchesByPackageId: Record<string, MetaStoreGameSummary>
): MetaStoreGameSummary | null {
  const normalizedPackageId = packageId.trim().toLowerCase()

  return (
    installedMetaStoreMatchesByPackageId[normalizedPackageId] ??
    packageSummaryByPackageId.get(normalizedPackageId) ??
    null
  )
}

function NoticeBanner(props: { notice: UiNotice; className?: string }) {
  const { notice, className } = props
  const [detailsOpen, setDetailsOpen] = useState(false)
  const toneClass =
    notice.tone === 'danger'
      ? 'runtime-banner runtime-banner-danger'
      : notice.tone === 'success'
        ? 'runtime-banner runtime-banner-success'
        : 'runtime-banner'

  return (
    <div className={className ? `${toneClass} ${className}` : toneClass}>
      <div className="notice-banner-top">
        <span>{notice.text}</span>
        {notice.details ? (
          <button className="notice-banner-toggle" onClick={() => setDetailsOpen((current) => !current)} type="button">
            {detailsOpen ? 'Hide details' : 'Show details'}
          </button>
        ) : null}
      </div>
      {notice.details && detailsOpen ? <pre className="notice-banner-details">{notice.details}</pre> : null}
    </div>
  )
}

function QueueRail(props: {
  items: LiveQueueItem[]
  isOpen: boolean
  onClose: () => void
  onPauseVrSrcTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<void>
  onResumeVrSrcTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<void>
  onCancelVrSrcTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<void>
}) {
  const { items, isOpen, onClose, onPauseVrSrcTransfer, onResumeVrSrcTransfer, onCancelVrSrcTransfer } = props

  function formatQueueKind(kind: LiveQueueItem['kind']): string {
    if (kind === 'update') {
      return 'Update'
    }

    if (kind === 'restore') {
      return 'Restore'
    }

    if (kind === 'cleanup') {
      return 'Cleanup'
    }

    if (kind === 'scan') {
      return 'Scan'
    }

    if (kind === 'backup') {
      return 'Backup'
    }

    if (kind === 'download') {
      return 'Download'
    }

    if (kind === 'uninstall') {
      return 'Uninstall'
    }

    return 'Install'
  }

  function formatQueuePhase(phase: LiveQueueItem['phase']): string {
    if (phase === 'restoring') {
      return 'restoring'
    }

    if (phase === 'cleaning-up') {
      return 'cleaning up'
    }

    if (phase === 'scanning') {
      return 'scanning'
    }

    if (phase === 'backing-up') {
      return 'backing up'
    }

    if (phase === 'downloading') {
      return 'downloading'
    }

    if (phase === 'paused') {
      return 'paused'
    }

    if (phase === 'cancelled') {
      return 'cancelled'
    }

    if (phase === 'extracting') {
      return 'extracting'
    }

    if (phase === 'uninstalling') {
      return 'uninstalling'
    }

    return phase
  }

  function getQueuePhaseTone(phase: LiveQueueItem['phase']): 'ready' | 'danger' | 'pending' {
    if (phase === 'completed') {
      return 'ready'
    }

    if (phase === 'failed' || phase === 'cancelled') {
      return 'danger'
    }

    return 'pending'
  }

  function getQueueKindPillClass(item: LiveQueueItem): string {
    if (item.kind === 'update') {
      if (item.phase === 'failed') {
        return 'queue-kind-pill queue-kind-pill-danger'
      }

      return item.phase === 'completed' ? 'queue-kind-pill queue-kind-pill-ready' : 'queue-kind-pill queue-kind-pill-warm'
    }

    if (item.kind === 'restore') {
      if (item.phase === 'completed') {
        return 'queue-kind-pill queue-kind-pill-ready'
      }

      return item.phase === 'failed' ? 'queue-kind-pill queue-kind-pill-danger' : 'queue-kind-pill queue-kind-pill-warm'
    }

    if (item.kind === 'cleanup') {
      return item.phase === 'completed' ? 'queue-kind-pill queue-kind-pill-ready' : 'queue-kind-pill queue-kind-pill-danger'
    }

    if (item.kind === 'uninstall') {
      return 'queue-kind-pill queue-kind-pill-danger'
    }

    if (item.kind === 'scan') {
      return item.phase === 'completed' ? 'queue-kind-pill queue-kind-pill-ready' : 'queue-kind-pill queue-kind-pill-warm'
    }

    if (item.kind === 'backup') {
      return item.phase === 'completed' ? 'queue-kind-pill queue-kind-pill-ready' : 'queue-kind-pill queue-kind-pill-warm'
    }

    if (item.phase === 'completed') {
      return 'queue-kind-pill queue-kind-pill-ready'
    }

    if (item.phase === 'failed') {
      return 'queue-kind-pill queue-kind-pill-danger'
    }

    return 'queue-kind-pill queue-kind-pill-warm'
  }

  function getQueueProgress(item: LiveQueueItem): number {
    if (item.phase === 'completed' || item.phase === 'failed' || item.phase === 'cancelled') {
      return 100
    }

    return item.progress
  }

  return (
    <aside className={isOpen ? 'queue-drawer surface-panel open' : 'queue-drawer surface-panel'} aria-hidden={!isOpen}>
      <div className="rail-heading">
        <div>
          <p className="eyebrow">Live Queue</p>
          <h2>Active Operations</h2>
        </div>
        <div className="queue-drawer-controls">
          <button className="close-pill" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>

      <div className="queue-stack">
        {items.length ? (
          items.map((item, index) => (
            <article
              className={[
                'queue-card',
                index === 0 ? 'active' : '',
                item.phase === 'failed' ? 'failed' : '',
                item.phase === 'completed' ? 'completed' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              key={item.id}
            >
              <div className="queue-card-top">
                <div className="queue-card-heading">
                  {item.artworkUrl ? (
                    <span aria-hidden="true" className="queue-card-art">
                      <img alt="" src={item.artworkUrl} />
                    </span>
                  ) : null}
                  <div className="queue-card-heading-copy">
                    <strong>{item.title}</strong>
                    {item.subtitle ? <p>{item.subtitle}</p> : null}
                  </div>
                </div>
                <span className={getQueueKindPillClass(item)}>{formatQueueKind(item.kind)}</span>
              </div>
              <span
                className={[
                  'queue-phase-chip',
                  getQueuePhaseTone(item.phase) === 'ready'
                    ? 'status-ready'
                    : getQueuePhaseTone(item.phase) === 'danger'
                      ? 'status-danger'
                      : 'status-pending'
                ].join(' ')}
              >
                {formatQueuePhase(item.phase)}
              </span>
              {item.details ? <p className="queue-card-details">{item.details}</p> : null}
              {item.actionLabel && item.actionUrl ? (
                <div className="queue-card-actions">
                  <a
                    className="queue-card-action"
                    href={item.actionUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {item.actionLabel}
                  </a>
                </div>
              ) : null}
              {item.transferControl?.kind === 'vrsrc' ? (
                <div className="queue-card-actions">
                  {item.transferControl.canPause ? (
                    <button
                      className="queue-card-action"
                      onClick={() => void onPauseVrSrcTransfer(item.transferControl!.releaseName, item.transferControl!.operation)}
                      type="button"
                    >
                      Pause
                    </button>
                  ) : null}
                  {item.transferControl.canResume ? (
                    <button
                      className="queue-card-action"
                      onClick={() => void onResumeVrSrcTransfer(item.transferControl!.releaseName, item.transferControl!.operation)}
                      type="button"
                    >
                      Resume
                    </button>
                  ) : null}
                  {item.transferControl.canCancel ? (
                    <button
                      className="queue-card-action queue-card-action-danger"
                      onClick={() => void onCancelVrSrcTransfer(item.transferControl!.releaseName, item.transferControl!.operation)}
                      type="button"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${getQueueProgress(item)}%` }} />
              </div>
            </article>
          ))
        ) : (
          <div className="surface-subcard queue-empty">
            <strong>Queue is quiet.</strong>
            <p>Installs, backups, and uninstalls will appear here as soon as an action starts.</p>
          </div>
        )}
      </div>
    </aside>
  )
}

function GamesView(props: {
  settings: AppSettings | null
  localLibraryIndex: LocalLibraryScanResponse | null
  backupStorageIndex: LocalLibraryScanResponse | null
  metaStoreMatchesByItemId: Record<string, MetaStoreGameSummary>
  metaStoreSyncProgress: { completed: number; total: number } | null
  deviceAppsResponse: DeviceAppsResponse | null
  deviceUserName: string | null
  deviceUserNameBusy: boolean
  selectedDeviceId: string | null
  gamesInstallBusyIds: string[]
  purgeLibraryItemBusyId: string | null
  backupStorageActionBusyItemId: string | null
  inventoryActionBusyPackageId: string | null
  gamesMessage: UiNotice | null
  vrSrcStatus: VrSrcStatusResponse | null
  vrSrcCatalog: VrSrcCatalogResponse | null
  isVrSrcPanelOpen: boolean
  vrSrcSyncBusy: boolean
  vrSrcActionBusyReleaseNames: string[]
  vrSrcMessage: UiNotice | null
  displayMode: GamesDisplayMode
  onToggleDisplayMode: () => void
  onChooseSettingsPath: (key: SettingsPathKey) => Promise<void>
  onRescanLocalLibrary: () => Promise<void>
  onInstallManualLibrarySource: (kind: 'apk' | 'folder') => Promise<void>
  onInstallLocalLibraryItem: (itemId: string) => Promise<void>
  onPurgeLibraryItem: (itemId: string) => Promise<void>
  onMoveBackupStorageItemToLibrary: (itemId: string) => Promise<void>
  onDeleteBackupStorageItem: (itemId: string) => Promise<void>
  onRefreshAllMetadata: () => Promise<void>
  onToggleVrSrcPanel: () => void
  onSyncVrSrcCatalog: () => Promise<void>
  onDownloadVrSrcToLibrary: (releaseName: string) => Promise<void>
  onDownloadVrSrcToLibraryAndInstall: (releaseName: string) => Promise<void>
  onInstallVrSrcNow: (releaseName: string) => Promise<void>
  onSaveDeviceUserName: (userName: string) => Promise<void>
  onUninstallInstalledApp: (packageId: string) => Promise<void>
  onSaveLocalLibraryItemManualStoreId: (itemId: string, storeId: string) => Promise<void>
  onSaveIndexedItemManualMetadata: (source: 'library' | 'backup', itemId: string, metadata: ManualGameMetadataOverride) => Promise<void>
  onImportManualMetadataImage: (target: 'hero' | 'cover') => Promise<string | null>
  onExtractIndexedItemArtwork: (source: 'library' | 'backup', itemId: string, target: 'hero' | 'cover') => Promise<string | null>
}) {
  const {
    settings,
    localLibraryIndex,
    backupStorageIndex,
    metaStoreMatchesByItemId,
    metaStoreSyncProgress,
    deviceAppsResponse,
    deviceUserName,
    deviceUserNameBusy,
    selectedDeviceId,
    gamesInstallBusyIds,
    purgeLibraryItemBusyId,
    backupStorageActionBusyItemId,
    inventoryActionBusyPackageId,
    gamesMessage,
    vrSrcStatus,
    vrSrcCatalog,
    isVrSrcPanelOpen,
    vrSrcSyncBusy,
    vrSrcActionBusyReleaseNames,
    vrSrcMessage,
    displayMode,
    onToggleDisplayMode,
    onChooseSettingsPath,
    onRescanLocalLibrary,
    onInstallManualLibrarySource,
    onInstallLocalLibraryItem,
    onPurgeLibraryItem,
    onMoveBackupStorageItemToLibrary,
    onDeleteBackupStorageItem,
    onRefreshAllMetadata,
    onToggleVrSrcPanel,
    onSyncVrSrcCatalog,
    onDownloadVrSrcToLibrary,
    onDownloadVrSrcToLibraryAndInstall,
    onInstallVrSrcNow,
    onSaveDeviceUserName,
    onUninstallInstalledApp,
    onSaveLocalLibraryItemManualStoreId,
    onSaveIndexedItemManualMetadata,
    onImportManualMetadataImage,
    onExtractIndexedItemArtwork
  } = props
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [selectedVrSrcReleaseName, setSelectedVrSrcReleaseName] = useState<string | null>(null)
  const [selectedVrSrcDetails, setSelectedVrSrcDetails] = useState<VrSrcItemDetailsResponse | null>(null)
  const [selectedVrSrcDetailsBusy, setSelectedVrSrcDetailsBusy] = useState(false)
  const [gamesFilter, setGamesFilter] = useState<GamesFilterId>('all')
  const [gamesSearch, setGamesSearch] = useState('')
  const [vrSrcFilter, setVrSrcFilter] = useState<'all' | 'new' | 'updates'>('all')
  const [vrSrcSortMode, setVrSrcSortMode] = useState<'title' | 'latest'>('title')
  const [gamesUserNameEditing, setGamesUserNameEditing] = useState(false)
  const [gamesUserNameDraft, setGamesUserNameDraft] = useState('')
  const [galleryScalePercent, setGalleryScalePercent] = useState(100)
  const [gamesSortKey, setGamesSortKey] = useState<GamesSortKey>('title')
  const [gamesSortDirection, setGamesSortDirection] = useState<GamesSortDirection>('asc')
  const controlsPanelRef = useRef<HTMLElement | null>(null)
  const gamesScrollFrameRef = useRef<HTMLDivElement | null>(null)
  const [gamesControlsHeight, setGamesControlsHeight] = useState(0)
  const [gamesScrollAvailableHeight, setGamesScrollAvailableHeight] = useState(0)
  const galleryVisualScale = 0.85
  const scaledGalleryCardHeight = Math.round(154 * galleryVisualScale)
  const clampedGalleryScalePercent = Math.min(Math.max(galleryScalePercent, 100), 150)
  const galleryColumnCount =
    clampedGalleryScalePercent >= 150 ? 6 : clampedGalleryScalePercent >= 125 ? 5 : 4
  const galleryScaleLabel =
    clampedGalleryScalePercent >= 150 ? '1.5x' : clampedGalleryScalePercent >= 125 ? '1.25x' : '1.0x'
  const gamesResultsViewportHeight = 84 * 5 + 8 * 4
  const gamesGalleryViewportHeight = scaledGalleryCardHeight * 3 + 12 * 2
  const [selectedGameDetails, setSelectedGameDetails] = useState<MetaStoreGameDetails | null>(null)
  const [selectedGameDetailsBusy, setSelectedGameDetailsBusy] = useState(false)
  const [manualStoreIdDraft, setManualStoreIdDraft] = useState('')
  const [manualStorePreview, setManualStorePreview] = useState<MetaStoreGameDetails | null>(null)
  const [manualStoreResolveBusy, setManualStoreResolveBusy] = useState(false)
  const [manualStoreSaveBusy, setManualStoreSaveBusy] = useState(false)
  const [manualStoreMessage, setManualStoreMessage] = useState<UiNotice | null>(null)
  const [purgeLowerVersionsBusy, setPurgeLowerVersionsBusy] = useState(false)
  const [selectedLowerLibraryVersionId, setSelectedLowerLibraryVersionId] = useState<string | null>(null)
  const [manualMetadataEditorTarget, setManualMetadataEditorTarget] = useState<
    null | 'hero' | 'art' | 'title' | 'meta' | 'description'
  >(null)
  const [manualMetadataDraft, setManualMetadataDraft] = useState<ManualGameMetadataOverride>({
    title: null,
    publisherName: null,
    category: null,
    version: null,
    releaseDateLabel: null,
    shortDescription: null,
    longDescription: null,
    heroImageUri: null,
    thumbnailUri: null
  })
  const [manualMetadataBusy, setManualMetadataBusy] = useState(false)
  const [manualMetadataMessage, setManualMetadataMessage] = useState<UiNotice | null>(null)
  const installedPackageIds = new Set((deviceAppsResponse?.apps ?? []).map((app) => app.packageId.toLowerCase()))
  const installedVersionsByPackageId = new Map(
    (deviceAppsResponse?.apps ?? []).map((app) => [app.packageId.toLowerCase(), app.version ?? null])
  )
  const vrSrcLastUpdatedByPackageId = (vrSrcCatalog?.items ?? []).reduce((timestamps, item) => {
    const packageId = item.packageName.trim().toLowerCase()
    if (!packageId) {
      return timestamps
    }

    timestamps.set(packageId, selectLatestVrSrcTimestamp(timestamps.get(packageId) ?? null, item.lastUpdated))
    return timestamps
  }, new Map<string, string | null>())
  const libraryGameRows = collapseLibraryGameRows(
    (localLibraryIndex?.items ?? [])
    .filter((item) => item.availability === 'present')
      .map((item) => {
        const fallbackTitle = item.name.replace(/\.(apk|obb|zip|7z|rar)$/i, '')
        const packageIds = item.packageIds ?? []
        const metaStoreMatch = metaStoreMatchesByItemId[buildGameMetaMatchKey('library', item.id)] ?? null
        const hasResolvedMetaStoreMatch = metaStoreMatch?.source === 'remote'
        const display = buildLibraryGameRowDisplay(fallbackTitle, item, metaStoreMatch)
        const isInstalled = packageIds.some((packageId) => installedPackageIds.has(packageId.toLowerCase()))
        const installedVersion =
          packageIds
            .map((packageId) => installedVersionsByPackageId.get(packageId.toLowerCase()) ?? null)
            .find((value): value is string => Boolean(value)) ?? null
        const inferredVrSrcLastUpdatedAt =
          packageIds
            .map((packageId) => vrSrcLastUpdatedByPackageId.get(packageId.toLowerCase()) ?? null)
            .find((value): value is string => Boolean(value)) ?? null
        const resolvedSourceLastUpdatedAt = item.sourceLastUpdatedAt ?? inferredVrSrcLastUpdatedAt ?? null
        const storeVersion = display.version
        const libraryVersion = item.libraryVersion
        const primaryVersionValue = libraryVersion ?? storeVersion
      const hasLibraryUpdate =
        isInstalled &&
        item.installReady &&
        compareVersionValues(libraryVersion, installedVersion) > 0
      const filterTags: GamesFilterId[] = ['all']

      if (isInstalled) {
        filterTags.push('installed')
      }

      if (hasLibraryUpdate) {
        filterTags.push('updates')
      }

      if (item.sourceLastUpdatedAt || item.installReady || item.kind === 'archive' || item.kind === 'folder' || item.kind === 'apk') {
        filterTags.push('ready')
      }

      if (!hasResolvedMetaStoreMatch) {
        filterTags.push('unidentified')
      }

        return {
          id: `library-${item.id}`,
          source: 'library' as const,
          itemId: item.id,
          title: display.title,
          metaStoreMatch,
        hasResolvedMetaStoreMatch,
        version:
          formatVersionLabel(primaryVersionValue) ??
          (item.kind === 'apk' ? 'Local APK' : item.kind === 'archive' ? 'Archive' : 'Local Payload'),
        primaryVersionValue,
        storeVersion,
        libraryVersion,
        libraryVersionCode: item.libraryVersionCode,
        installedVersion,
        status: hasLibraryUpdate
          ? 'Update Available'
          : isInstalled
            ? 'Installed'
            : item.kind === 'archive'
              ? 'Offline Cache'
              : item.installReady
                ? 'Ready to Install'
                : 'Stored Locally',
        size: formatBytes(metaStoreMatch?.sizeBytes ?? item.sizeBytes),
        sizeBytes: metaStoreMatch?.sizeBytes ?? item.sizeBytes,
        action: hasLibraryUpdate ? 'Update' : isInstalled ? 'Installed' : item.installReady ? 'Install' : 'Inspect',
        note: display.note,
        release: display.release,
        cta: hasLibraryUpdate
          ? 'Upgrade Installed Version from Local Library'
          : isInstalled
            ? 'Already Installed on Headset'
            : item.installReady
              ? 'Install from Local Library'
              : 'Inspect Local Payload',
        fallback: isInstalled ? 'Review Installed Inventory' : item.kind === 'archive' ? 'Review Archive Contents' : 'Review Indexed Entry',
        searchTerms: [
          item.name,
          fallbackTitle,
          item.relativePath,
          item.note,
          display.title,
          display.note,
          item.libraryVersion ?? '',
          installedVersion ?? '',
          storeVersion ?? '',
          item.manualStoreId ?? '',
          ...(metaStoreMatch?.genreNames ?? []),
          ...display.searchTerms
        ],
        packageIds,
        manualStoreId: item.manualStoreId,
        manualStoreIdEdited: item.manualStoreIdEdited,
        manualMetadata: item.manualMetadata ?? null,
        isInstalled,
        hasLibraryUpdate,
        filterTags,
        heroImageUri: display.heroImageUri,
        installReady: item.installReady,
        sourceLastUpdatedAt: resolvedSourceLastUpdatedAt,
        modifiedAt: item.modifiedAt ?? null,
        kind: item.kind,
        relativePath: item.relativePath,
        thumbnailUri: display.thumbnailUri,
        duplicateGroupKey: '',
        hiddenVersionCount: 0,
        lowerLibraryVersions: []
      }
    })
  )
  const backupGameRows = collapseLibraryGameRows(
    (backupStorageIndex?.items ?? [])
      .filter((item) => item.availability === 'present')
      .map((item) => {
        const fallbackTitle = item.name.replace(/\.(apk|obb|zip|7z|rar)$/i, '')
        const packageIds = item.packageIds ?? []
        const metaStoreMatch = metaStoreMatchesByItemId[buildGameMetaMatchKey('backup', item.id)] ?? null
        const hasResolvedMetaStoreMatch = metaStoreMatch?.source === 'remote'
        const display = buildLibraryGameRowDisplay(fallbackTitle, item, metaStoreMatch)
        const isInstalled = packageIds.some((packageId) => installedPackageIds.has(packageId.toLowerCase()))
        const installedVersion =
          packageIds
            .map((packageId) => installedVersionsByPackageId.get(packageId.toLowerCase()) ?? null)
            .find((value): value is string => Boolean(value)) ?? null
        const inferredVrSrcLastUpdatedAt =
          packageIds
            .map((packageId) => vrSrcLastUpdatedByPackageId.get(packageId.toLowerCase()) ?? null)
            .find((value): value is string => Boolean(value)) ?? null
        const resolvedSourceLastUpdatedAt = item.sourceLastUpdatedAt ?? inferredVrSrcLastUpdatedAt ?? null
        const storeVersion = display.version
        const libraryVersion = item.libraryVersion
        const primaryVersionValue = libraryVersion ?? storeVersion
        const filterTags: GamesFilterId[] = ['offline']

        return {
          id: `backup-${item.id}`,
          source: 'backup' as const,
          itemId: item.id,
          title: display.title,
          metaStoreMatch,
          hasResolvedMetaStoreMatch,
          version:
            formatVersionLabel(primaryVersionValue) ??
            (item.kind === 'apk' ? 'Backup APK' : item.kind === 'archive' ? 'Backup Archive' : 'Backup Payload'),
          primaryVersionValue,
          storeVersion,
          libraryVersion,
          libraryVersionCode: item.libraryVersionCode,
          installedVersion,
          status: isInstalled ? 'Installed' : 'Backup Storage',
          size: formatBytes(metaStoreMatch?.sizeBytes ?? item.sizeBytes),
          sizeBytes: metaStoreMatch?.sizeBytes ?? item.sizeBytes,
          action: isInstalled ? 'Installed' : 'Inspect',
          note: display.note,
          release: display.release.replace(/^Indexed from /, 'Indexed from backup storage at '),
          cta: isInstalled ? 'Already Installed on Headset' : 'Review Backup Payload',
          fallback: 'Review Backup Storage Entry',
          searchTerms: [
            item.name,
            fallbackTitle,
            item.relativePath,
            item.note,
            display.title,
            display.note,
            item.libraryVersion ?? '',
            installedVersion ?? '',
            storeVersion ?? '',
            ...(metaStoreMatch?.genreNames ?? []),
            ...display.searchTerms
          ],
          packageIds,
          manualStoreId: item.manualStoreId,
          manualStoreIdEdited: item.manualStoreIdEdited,
          manualMetadata: item.manualMetadata ?? null,
          isInstalled,
          hasLibraryUpdate: false,
          filterTags,
          heroImageUri: display.heroImageUri,
          installReady: false,
          sourceLastUpdatedAt: resolvedSourceLastUpdatedAt,
          modifiedAt: item.modifiedAt ?? null,
          kind: item.kind,
          relativePath: item.relativePath,
          thumbnailUri: display.thumbnailUri,
          duplicateGroupKey: '',
          hiddenVersionCount: 0,
          lowerLibraryVersions: []
        }
      })
  )

  const combinedGameRows = [...libraryGameRows, ...backupGameRows]
  const latestLibraryGameRows = selectLatestLibraryGameRows(libraryGameRows)
  const latestGameRows = selectLatestLibraryGameRows(combinedGameRows)
  const hasGamesSearchQuery = Boolean(gamesSearch.trim())
  const visibleGameRows = hasGamesSearchQuery ? combinedGameRows : latestGameRows
  const filteredGameRows = visibleGameRows.filter((game) => {
    if (!game.filterTags.includes(gamesFilter)) {
      return false
    }

    return matchesSearchText(game.searchTerms, gamesSearch)
  })
  const sortedGameRows = [...filteredGameRows].sort((left, right) => {
    if (gamesSortKey === 'date') {
      const leftDate = left.sourceLastUpdatedAt ? Date.parse(left.sourceLastUpdatedAt) : Number.NEGATIVE_INFINITY
      const rightDate = right.sourceLastUpdatedAt ? Date.parse(right.sourceLastUpdatedAt) : Number.NEGATIVE_INFINITY
      const safeLeftDate = Number.isNaN(leftDate) ? Number.NEGATIVE_INFINITY : leftDate
      const safeRightDate = Number.isNaN(rightDate) ? Number.NEGATIVE_INFINITY : rightDate

      if (safeLeftDate !== safeRightDate) {
        return gamesSortDirection === 'asc' ? safeLeftDate - safeRightDate : safeRightDate - safeLeftDate
      }
    }

    if (gamesSortKey === 'size') {
      const leftSize = left.sizeBytes ?? 0
      const rightSize = right.sizeBytes ?? 0
      return gamesSortDirection === 'asc' ? leftSize - rightSize : rightSize - leftSize
    }

    const comparison = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    return gamesSortDirection === 'asc' ? comparison : -comparison
  })
  const localLibraryAvailable = Boolean(settings?.localLibraryPath && localLibraryIndex?.path && localLibraryIndex?.scannedAt)
  const localLibrarySummary = {
    catalogCount: latestLibraryGameRows.length,
    newCount: latestLibraryGameRows.filter((item) => isWithinLastDays(item.modifiedAt, 7)).length,
    updateCount: latestLibraryGameRows.filter((item) => item.hasLibraryUpdate).length
  }
  const libraryHighestVersionCodeByPackageId = (localLibraryIndex?.items ?? [])
    .filter((item) => item.availability === 'present')
    .reduce((versions, item) => {
      for (const packageId of item.packageIds ?? []) {
        const normalizedPackageId = packageId.toLowerCase()
        const previous = versions.get(normalizedPackageId) ?? null
        const nextVersion = item.libraryVersionCode ?? null
        if (!previous || compareVersionValues(nextVersion, previous) > 0) {
          versions.set(normalizedPackageId, nextVersion)
        }
      }

      return versions
    }, new Map<string, string | null>())
  const parseVrSrcLastUpdated = (value: string) => {
    const normalized = value.trim()
    if (!normalized) {
      return 0
    }

    const parsed = Date.parse(normalized.replace(' UTC', 'Z'))
    return Number.isNaN(parsed) ? 0 : parsed
  }
  const vrSrcItems = [...(vrSrcCatalog?.items ?? [])].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  )
  const vrSrcItemStatusByReleaseName = vrSrcItems.reduce((statuses, item) => {
    const packageId = item.packageName.toLowerCase()
    const highestLibraryVersionCode = libraryHighestVersionCodeByPackageId.get(packageId) ?? null
    const isUpdate = Boolean(highestLibraryVersionCode && compareVersionValues(item.versionCode, highestLibraryVersionCode) > 0)
    const isInLibrary = Boolean(highestLibraryVersionCode)

    statuses.set(item.releaseName, {
      highestLibraryVersionCode,
      isUpdate,
      isInLibrary
    })
    return statuses
  }, new Map<string, { highestLibraryVersionCode: string | null; isUpdate: boolean; isInLibrary: boolean }>())
  const filteredVrSrcItems = vrSrcItems.filter((item) => {
    const matchesSearch = matchesSearchText(
      [item.name, item.releaseName, item.packageName, item.versionCode, item.versionName ?? ''],
      gamesSearch
    )

    if (!matchesSearch) {
      return false
    }

    const itemStatus = vrSrcItemStatusByReleaseName.get(item.releaseName)

    if (gamesFilter === 'installed') {
      if (!installedPackageIds.has(item.packageName.toLowerCase())) {
        return false
      }
    } else if (gamesFilter === 'updates') {
      if (!(itemStatus?.isUpdate ?? false)) {
        return false
      }
    } else if (gamesFilter === 'ready') {
      if (!(itemStatus?.isInLibrary ?? false)) {
        return false
      }
    } else if (gamesFilter === 'offline' || gamesFilter === 'unidentified') {
      return false
    }

    if (vrSrcFilter === 'updates') {
      return itemStatus?.isUpdate ?? false
    }

    if (vrSrcFilter === 'new') {
      return !(itemStatus?.isInLibrary ?? false)
    }

    return true
  }).sort((left, right) => {
    if (vrSrcSortMode === 'latest') {
      const difference = parseVrSrcLastUpdated(right.lastUpdated) - parseVrSrcLastUpdated(left.lastUpdated)
      if (difference !== 0) {
        return difference
      }
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
  const vrSrcSummary = vrSrcItems.reduce(
    (summary, item) => {
      const itemStatus = vrSrcItemStatusByReleaseName.get(item.releaseName)
      const highestLibraryVersionCode = itemStatus?.highestLibraryVersionCode ?? null

      if (highestLibraryVersionCode) {
        summary.inLibraryCount += 1
        if (itemStatus?.isUpdate) {
          summary.updateCount += 1
        }
      } else {
        summary.newCount += 1
      }

      return summary
    },
    { newCount: 0, updateCount: 0, inLibraryCount: 0 }
  )
  const getMatchingVrSrcLibraryItem = (item: VrSrcCatalogResponse['items'][number]) =>
    (localLibraryIndex?.items ?? [])
      .filter(
        (libraryItem) =>
          libraryItem.availability === 'present' &&
          libraryItem.packageIds.some((packageId) => packageId.toLowerCase() === item.packageName.toLowerCase())
      )
      .sort((left, right) => compareVersionValues(right.libraryVersionCode, left.libraryVersionCode))[0] ?? null
  const filteredVrSrcEntries = filteredVrSrcItems.map((item) => {
    const itemStatus = vrSrcItemStatusByReleaseName.get(item.releaseName)
    const matchingLibraryItem = getMatchingVrSrcLibraryItem(item)
    const highestLibraryVersion = matchingLibraryItem?.libraryVersion ?? matchingLibraryItem?.libraryVersionCode ?? null
    const isUpdate = itemStatus?.isUpdate ?? false
    const isInLibrary = itemStatus?.isInLibrary ?? false
    const actionBusy = vrSrcActionBusyReleaseNames.includes(item.releaseName)
    const statusLabel = isUpdate ? 'Update' : isInLibrary ? 'In Library' : 'New'
    const statusClassName = isUpdate
      ? 'status-pill status-pending'
      : isInLibrary
        ? 'status-pill status-ready'
        : 'status-pill status-neutral'
    const displayRemoteVersion = item.versionName?.trim() ? `v${item.versionName.trim()}` : `Code ${item.versionCode}`
    return {
      item,
      highestLibraryVersion,
      isUpdate,
      isInLibrary,
      actionBusy,
      statusLabel,
      statusClassName,
      displayRemoteVersion
    }
  })
  const selectedVrSrcItem =
    filteredVrSrcItems.find((item) => item.releaseName === selectedVrSrcReleaseName) ??
    vrSrcItems.find((item) => item.releaseName === selectedVrSrcReleaseName) ??
    null
  const selectedVrSrcStatus = selectedVrSrcItem ? vrSrcItemStatusByReleaseName.get(selectedVrSrcItem.releaseName) : null
  const selectedVrSrcMatchingLibraryItem = selectedVrSrcItem ? getMatchingVrSrcLibraryItem(selectedVrSrcItem) : null
  const selectedVrSrcHighestLibraryVersion =
    selectedVrSrcMatchingLibraryItem?.libraryVersion ?? selectedVrSrcMatchingLibraryItem?.libraryVersionCode ?? null
  const selectedVrSrcLibraryCoversRemote = Boolean(
    selectedVrSrcItem &&
      selectedVrSrcMatchingLibraryItem &&
      compareVersionValues(selectedVrSrcMatchingLibraryItem.libraryVersionCode, selectedVrSrcItem.versionCode) >= 0
  )
  const selectedVrSrcDisplayRemoteVersion = selectedVrSrcItem
    ? selectedVrSrcItem.versionName?.trim()
      ? `v${selectedVrSrcItem.versionName.trim()}`
      : `Code ${selectedVrSrcItem.versionCode}`
    : null
  const selectedVrSrcStatusLabel = selectedVrSrcStatus?.isUpdate
    ? 'Update'
    : selectedVrSrcStatus?.isInLibrary
      ? 'In Library'
      : 'New'
  const selectedVrSrcStatusClassName = selectedVrSrcStatus?.isUpdate
    ? 'status-pill status-pending'
    : selectedVrSrcStatus?.isInLibrary
      ? 'status-pill status-ready'
      : 'status-pill status-neutral'
  const selectedVrSrcFactClassName = selectedVrSrcStatus?.isUpdate
    ? 'signal-chip signal-chip-warm'
    : selectedVrSrcStatus?.isInLibrary
      ? 'signal-chip signal-chip-ready'
      : 'signal-chip'
  const selectedVrSrcNote = selectedVrSrcDetails?.note ?? selectedVrSrcItem?.note ?? null
  const selectedVrSrcTrailerVideoId = selectedVrSrcDetails?.trailerVideoId ?? null
  const trailerEmbedOrigin =
    typeof window !== 'undefined' && window.location.origin ? encodeURIComponent(window.location.origin) : null
  const selectedGame = filteredGameRows.find((game) => game.id === selectedGameId) ?? combinedGameRows.find((game) => game.id === selectedGameId) ?? null
  const effectiveSelectedGameDetails = applyManualMetadataOverride(
    manualStorePreview ?? selectedGameDetails,
    manualMetadataDraft,
    {
      title: selectedGame?.title ?? 'Untitled',
      release: selectedGame?.release ?? '',
      note: selectedGame?.note ?? '',
      version: selectedGame?.libraryVersion ?? selectedGame?.storeVersion ?? null
    }
  )
  const showManualStoreMatch = selectedGame?.source === 'library'
  const selectedGameHasResolvedMetaStoreMatch = Boolean(selectedGame?.hasResolvedMetaStoreMatch)
  const selectedGameDescription = formatGameDescription(effectiveSelectedGameDetails?.longDescription)
  const selectedGamePrimaryPackageId = selectedGame?.packageIds[0] ?? null
  const selectedGameInstallBusy = selectedGame?.itemId ? gamesInstallBusyIds.includes(selectedGame.itemId) : false
  const selectedLibraryPurgeBusy = selectedGame?.itemId ? purgeLibraryItemBusyId === selectedGame.itemId : false
  const selectedBackupStorageActionBusy = selectedGame?.itemId ? backupStorageActionBusyItemId === selectedGame.itemId : false
  const selectedGameHasHiddenVersions = (selectedGame?.hiddenVersionCount ?? 0) > 0
  const selectedGameLowerLibraryVersions = selectedGame?.lowerLibraryVersions ?? []
  const selectedGameHasLowerLibraryVersions = selectedGameLowerLibraryVersions.length > 0
  const selectedLowerLibraryVersion =
    selectedGameLowerLibraryVersions.find((entry) => entry.id === selectedLowerLibraryVersionId) ?? selectedGameLowerLibraryVersions[0] ?? null
  const selectedGameLowerVersionPurgeBusy =
    purgeLowerVersionsBusy ||
    selectedGameLowerLibraryVersions.some((entry) => purgeLibraryItemBusyId === entry.itemId)
  const selectedGameUninstallBusy =
    selectedGamePrimaryPackageId !== null && inventoryActionBusyPackageId === selectedGamePrimaryPackageId
  const selectedGameHeroUri =
    effectiveSelectedGameDetails?.heroImage?.uri ??
    effectiveSelectedGameDetails?.portraitImage?.uri ??
    effectiveSelectedGameDetails?.thumbnail?.uri ??
    effectiveSelectedGameDetails?.iconImage?.uri ??
    effectiveSelectedGameDetails?.logoImage?.uri ??
    null
  const selectedGameCardArtUri =
    effectiveSelectedGameDetails?.thumbnail?.uri ??
    effectiveSelectedGameDetails?.portraitImage?.uri ??
    selectedGameHeroUri ??
    null
  const selectedGameHeaderArtUri = selectedGameCardArtUri
  const selectedGameStoreVersion = effectiveSelectedGameDetails?.version ?? selectedGame?.storeVersion ?? null
  const selectedGameLibraryVersion = selectedGame?.libraryVersion ?? null
  const selectedGameInstalledVersion = selectedGame?.installedVersion ?? null
  const selectedGameMetaChipVersion = selectedGameLibraryVersion ?? effectiveSelectedGameDetails?.version ?? null
  const selectedGameHasNewerAvailableVersion =
    compareVersionValues(selectedGameStoreVersion, selectedGameLibraryVersion) > 0
  const selectedGameHeroUpdateBannerLabel = selectedGameStoreVersion
    ? `Update available: ${formatVersionLabel(selectedGameStoreVersion) ?? selectedGameStoreVersion}`
    : 'Update available'
  const selectedGameFolderName = selectedGame?.kind === 'folder' ? getRelativePathBaseName(selectedGame.relativePath) : null
  const selectedGameCategoryChips = effectiveSelectedGameDetails?.genreNames?.length
    ? effectiveSelectedGameDetails.genreNames
    : effectiveSelectedGameDetails?.category
      ? effectiveSelectedGameDetails.category
          .split(/[,|]/)
          .map((value) => value.trim())
          .filter(Boolean)
      : []

  useEffect(() => {
    if (!gamesUserNameEditing) {
      setGamesUserNameDraft(deviceUserName ?? '')
    }
  }, [deviceUserName, gamesUserNameEditing])

  useEffect(() => {
    setGamesUserNameEditing(false)
    setGamesUserNameDraft(deviceUserName ?? '')
  }, [selectedDeviceId, deviceUserName])

  useEffect(() => {
    if (!isVrSrcPanelOpen) {
      setSelectedVrSrcReleaseName(null)
    }
  }, [isVrSrcPanelOpen])

  useEffect(() => {
    const controlsNode = controlsPanelRef.current

    if (!controlsNode || typeof ResizeObserver === 'undefined') {
      return
    }

    const updateControlsHeight = () => {
      setGamesControlsHeight(controlsNode.getBoundingClientRect().height)
    }

    updateControlsHeight()

    const observer = new ResizeObserver(() => {
      updateControlsHeight()
    })

    observer.observe(controlsNode)

    return () => {
      observer.disconnect()
    }
  }, [displayMode, gamesSearch, gamesFilter, gamesUserNameEditing, vrSrcMessage, gamesMessage, selectedDeviceId, deviceUserName, deviceUserNameBusy])

  useEffect(() => {
    const scrollFrameNode = gamesScrollFrameRef.current

    if (!scrollFrameNode || typeof window === 'undefined') {
      return
    }

    const updateGamesScrollHeight = () => {
      const availableHeight = Math.max(180, window.innerHeight - scrollFrameNode.getBoundingClientRect().top - 14)
      setGamesScrollAvailableHeight(availableHeight)
    }

    updateGamesScrollHeight()

    const handleResize = () => {
      updateGamesScrollHeight()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [
    displayMode,
    gamesSearch,
    gamesFilter,
    gamesUserNameEditing,
    vrSrcMessage,
    gamesMessage,
    isVrSrcPanelOpen,
    galleryScalePercent,
    gamesControlsHeight
  ])

  useEffect(() => {
    let cancelled = false

    if (!selectedVrSrcItem) {
      setSelectedVrSrcDetails(null)
      setSelectedVrSrcDetailsBusy(false)
      return
    }

    setSelectedVrSrcDetails({
      releaseName: selectedVrSrcItem.releaseName,
      note: selectedVrSrcItem.note,
      trailerVideoId: null
    })
    setSelectedVrSrcDetailsBusy(true)

    void window.api.vrsrc
      .getItemDetails(selectedVrSrcItem.releaseName, selectedVrSrcItem.name)
      .then((details) => {
        if (!cancelled) {
          setSelectedVrSrcDetails(details)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedVrSrcDetails({
            releaseName: selectedVrSrcItem.releaseName,
            note: selectedVrSrcItem.note,
            trailerVideoId: null
          })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedVrSrcDetailsBusy(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedVrSrcItem])

  const toggleGamesSort = (key: GamesSortKey) => {
    if (gamesSortKey === key) {
      setGamesSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setGamesSortKey(key)
    setGamesSortDirection(key === 'title' ? 'asc' : 'desc')
  }
  const toggleLocalLibrarySortMode = () => {
    if (gamesSortKey === 'date') {
      setGamesSortKey('title')
      setGamesSortDirection('asc')
      return
    }

    setGamesSortKey('date')
    setGamesSortDirection('desc')
  }

  useEffect(() => {
    setManualStoreIdDraft(selectedGame?.manualStoreId ?? '')
    setManualStorePreview(null)
    setManualStoreResolveBusy(false)
    setManualStoreSaveBusy(false)
    setManualStoreMessage(null)
    setPurgeLowerVersionsBusy(false)
    setSelectedLowerLibraryVersionId(null)
  }, [selectedGame?.id, selectedGame?.manualStoreId])

  useEffect(() => {
    if (!selectedGameLowerLibraryVersions.length) {
      setSelectedLowerLibraryVersionId(null)
      return
    }

    setSelectedLowerLibraryVersionId((current) =>
      current && selectedGameLowerLibraryVersions.some((entry) => entry.id === current)
        ? current
        : selectedGameLowerLibraryVersions[0]?.id ?? null
    )
  }, [selectedGameLowerLibraryVersions])

  useEffect(() => {
    setManualMetadataDraft({
      title: selectedGame?.manualMetadata?.title ?? null,
      publisherName: selectedGame?.manualMetadata?.publisherName ?? null,
      category: selectedGame?.manualMetadata?.category ?? null,
      version: selectedGame?.manualMetadata?.version ?? null,
      releaseDateLabel: selectedGame?.manualMetadata?.releaseDateLabel ?? null,
      shortDescription: selectedGame?.manualMetadata?.shortDescription ?? null,
      longDescription: selectedGame?.manualMetadata?.longDescription ?? null,
      heroImageUri: selectedGame?.manualMetadata?.heroImageUri ?? null,
      thumbnailUri: selectedGame?.manualMetadata?.thumbnailUri ?? null
    })
    setManualMetadataBusy(false)
    setManualMetadataMessage(null)
    setManualMetadataEditorTarget(null)
  }, [selectedGame?.id, selectedGame?.manualMetadata])

  useEffect(() => {
    let cancelled = false

    async function loadDetails() {
      if (!selectedGame?.metaStoreMatch) {
        setSelectedGameDetails(null)
        setSelectedGameDetailsBusy(false)
        return
      }

      setSelectedGameDetailsBusy(true)
      try {
        const response = await window.api.metaStore.getDetails(selectedGame.metaStoreMatch.storeId)
        if (!cancelled) {
          setSelectedGameDetails(response.details)
        }
      } catch {
        if (!cancelled) {
          setSelectedGameDetails(null)
        }
      } finally {
        if (!cancelled) {
          setSelectedGameDetailsBusy(false)
        }
      }
    }

    void loadDetails()

    return () => {
      cancelled = true
    }
  }, [selectedGame?.id, selectedGame?.metaStoreMatch?.storeId])

  async function resolveManualStoreIdPreview() {
    if (!manualStoreIdDraft.trim()) {
      setManualStoreMessage({
        text: 'Enter a store ID before fetching metadata.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setManualStoreResolveBusy(true)
    setManualStoreMessage(null)

    try {
      const response = await window.api.metaStore.getDetails(manualStoreIdDraft.trim())
      if (response.details) {
        setManualStorePreview(response.details)
        setManualStoreMessage({
          text: 'Store metadata preview loaded.',
          details: 'Review the retrieved information, then save or dismiss it.',
          tone: 'success'
        })
      } else {
        setManualStorePreview(null)
        setManualStoreMessage({
          text: 'No metadata was found for that store ID.',
          details: response.message,
          tone: 'danger'
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to fetch metadata for that store ID.'
      setManualStorePreview(null)
      setManualStoreMessage({
        text: 'Unable to fetch metadata for that store ID.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setManualStoreResolveBusy(false)
    }
  }

  async function saveManualStoreIdPreview() {
    if (!selectedGame?.itemId || !manualStoreIdDraft.trim()) {
      return
    }

    setManualStoreSaveBusy(true)

    try {
      await onSaveLocalLibraryItemManualStoreId(selectedGame.itemId, manualStoreIdDraft.trim())
      setManualStorePreview(null)
      setManualStoreMessage({
        text: 'Manual store ID saved.',
        details: 'This library item will now prefer the retrieved store metadata.',
        tone: 'success'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the manual store ID.'
      setManualStoreMessage({
        text: 'Unable to save the manual store ID.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setManualStoreSaveBusy(false)
    }
  }

  async function purgeSelectedLowerLibraryVersion() {
    if (!selectedLowerLibraryVersion) {
      return
    }

    const confirmed = window.confirm(
      `Delete the older local version "${selectedLowerLibraryVersion.versionLabel}" from the library?\n\nThis removes only the selected older payload and keeps the current visible version.`
    )

    if (!confirmed) {
      return
    }

    setSelectedGameId(null)
    setPurgeLowerVersionsBusy(true)

    try {
      await onPurgeLibraryItem(selectedLowerLibraryVersion.itemId)
    } finally {
      setPurgeLowerVersionsBusy(false)
    }
  }

  async function installSelectedLocalLibraryItem() {
    if (!selectedGame?.itemId) {
      return
    }

    setSelectedGameId(null)
    await onInstallLocalLibraryItem(selectedGame.itemId)
  }

  async function uninstallSelectedInstalledGame() {
    if (!selectedGamePrimaryPackageId) {
      return
    }

    setSelectedGameId(null)
    await onUninstallInstalledApp(selectedGamePrimaryPackageId)
  }

  async function deleteSelectedLibraryItem() {
    if (!selectedGame?.itemId) {
      return
    }

    setSelectedGameId(null)
    await onPurgeLibraryItem(selectedGame.itemId)
  }

  async function downloadSelectedVrSrcToLibrary() {
    if (!selectedVrSrcItem) {
      return
    }

    setSelectedVrSrcReleaseName(null)
    await onDownloadVrSrcToLibrary(selectedVrSrcItem.releaseName)
  }

  async function downloadSelectedVrSrcToLibraryAndInstall() {
    if (!selectedVrSrcItem) {
      return
    }

    if (selectedVrSrcLibraryCoversRemote && selectedVrSrcMatchingLibraryItem?.id) {
      setSelectedVrSrcReleaseName(null)
      await onInstallLocalLibraryItem(selectedVrSrcMatchingLibraryItem.id)
      return
    }

    setSelectedVrSrcReleaseName(null)
    await onDownloadVrSrcToLibraryAndInstall(selectedVrSrcItem.releaseName)
  }

  function updateManualMetadataField(field: keyof ManualGameMetadataOverride, value: string) {
    setManualMetadataDraft((current) => ({
      ...current,
      [field]: value.trim() ? value : null
    }))
  }

  function resetManualMetadataDraft() {
    setManualMetadataDraft({
      title: selectedGame?.manualMetadata?.title ?? null,
      publisherName: selectedGame?.manualMetadata?.publisherName ?? null,
      category: selectedGame?.manualMetadata?.category ?? null,
      version: selectedGame?.manualMetadata?.version ?? null,
      releaseDateLabel: selectedGame?.manualMetadata?.releaseDateLabel ?? null,
      shortDescription: selectedGame?.manualMetadata?.shortDescription ?? null,
      longDescription: selectedGame?.manualMetadata?.longDescription ?? null,
      heroImageUri: selectedGame?.manualMetadata?.heroImageUri ?? null,
      thumbnailUri: selectedGame?.manualMetadata?.thumbnailUri ?? null
    })
  }

  function clearManualMetadataDraft() {
    setManualMetadataDraft({
      title: null,
      publisherName: null,
      category: null,
      version: null,
      releaseDateLabel: null,
      shortDescription: null,
      longDescription: null,
      heroImageUri: null,
      thumbnailUri: null
    })
  }

  function beginManualMetadataEdit(target: NonNullable<typeof manualMetadataEditorTarget>) {
    setManualMetadataMessage(null)
    setManualMetadataEditorTarget(target)
  }

  function cancelManualMetadataEdit() {
    resetManualMetadataDraft()
    setManualMetadataMessage(null)
    setManualMetadataEditorTarget(null)
  }

  async function saveManualMetadata() {
    if (!selectedGame?.itemId) {
      return
    }

    setManualMetadataBusy(true)
    setManualMetadataMessage(null)

    try {
      await onSaveIndexedItemManualMetadata(selectedGame.source, selectedGame.itemId, manualMetadataDraft)
      setManualMetadataMessage({
        text: 'Manual metadata saved.',
        details: 'This title will now use your local metadata overrides immediately.',
        tone: 'success'
      })
      setManualMetadataEditorTarget(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the manual metadata.'
      setManualMetadataMessage({
        text: 'Unable to save the manual metadata.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setManualMetadataBusy(false)
    }
  }

  async function importManualMetadataImage(field: 'heroImageUri' | 'thumbnailUri', target: 'hero' | 'cover') {
    const importedUri = await onImportManualMetadataImage(target)
    if (!importedUri) {
      return
    }

    setManualMetadataMessage(null)
    setManualMetadataDraft((current) => ({
      ...current,
      [field]: importedUri
    }))
  }

  async function extractIndexedItemArtwork(field: 'heroImageUri' | 'thumbnailUri', target: 'hero' | 'cover') {
    if (!selectedGame || !selectedGame.itemId || (selectedGame.source !== 'library' && selectedGame.source !== 'backup')) {
      return
    }

    const extractedUri = await onExtractIndexedItemArtwork(selectedGame.source, selectedGame.itemId, target)
    if (!extractedUri) {
      return
    }

    setManualMetadataMessage(null)
    setManualMetadataDraft((current) => ({
      ...current,
      [field]: extractedUri
    }))
  }

  const manualStoreMatchEditor =
    showManualStoreMatch && selectedGame ? (
      <div className="games-manual-store-shell">
        <div className="games-manual-store-copy">
          <strong>Store Match</strong>
          <span>
            {selectedGame.manualStoreIdEdited
              ? 'Manual override saved for this library item.'
              : selectedGameHasResolvedMetaStoreMatch
                ? 'Auto-matched metadata is available. You can override it with a manual store ID.'
                : 'No automatic match yet. Enter a store ID to fetch a preview.'}
          </span>
        </div>
        <div className="games-manual-store-row">
          <input
            aria-label="Meta store ID"
            className="search-shell games-manual-store-input"
            onChange={(event) => setManualStoreIdDraft(event.target.value)}
            placeholder="Enter Meta store ID"
            type="text"
            value={manualStoreIdDraft}
          />
          <button
            className="status-pill status-pill-button"
            disabled={!manualStoreIdDraft.trim() || manualStoreResolveBusy || manualStoreSaveBusy}
            onClick={() => void resolveManualStoreIdPreview()}
            type="button"
          >
            {manualStoreResolveBusy ? 'Fetching…' : 'Fetch Details'}
          </button>
          {manualStorePreview ? (
            <>
              <button
                className="status-pill status-pill-button"
                disabled={manualStoreSaveBusy}
                onClick={() => void saveManualStoreIdPreview()}
                type="button"
              >
                {manualStoreSaveBusy ? 'Saving…' : 'Save'}
              </button>
              <button
                className="status-pill status-pill-button"
                disabled={manualStoreSaveBusy}
                onClick={() => {
                  setManualStorePreview(null)
                  setManualStoreMessage(null)
                  setManualStoreIdDraft(selectedGame.manualStoreId ?? '')
                }}
                type="button"
              >
                Dismiss
              </button>
            </>
          ) : null}
        </div>
        {manualStoreMessage ? <NoticeBanner className="games-banner" notice={manualStoreMessage} /> : null}
      </div>
    ) : null

  const drawerPortalTarget = typeof document !== 'undefined' ? document.body : null

  return (
    <section
      className="view-stack games-view-stack"
      style={
        {
          '--games-controls-height': `${gamesControlsHeight}px`,
          '--gallery-scale': `${galleryVisualScale}`,
          '--game-gallery-columns': `${galleryColumnCount}`,
          '--games-scroll-height': gamesScrollAvailableHeight ? `${gamesScrollAvailableHeight}px` : undefined
        } as CSSProperties
      }
    >
      <div className="games-content-frame">
      <section ref={controlsPanelRef} className="surface-panel games-controls-panel">
        <div className="games-search-shell">
          <input
            aria-label="Search games"
            className="search-shell games-search-input"
            onChange={(event) => setGamesSearch(event.target.value)}
            placeholder="Search title, package ID, release name, or tag"
            type="text"
            value={gamesSearch}
          />
          {gamesSearch ? (
            <button
              aria-label="Clear search"
              className="status-pill status-pill-button games-search-clear"
              onClick={() => setGamesSearch('')}
              type="button"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="games-filter-toolbar">
          <div className="filter-row">
            {gameFilters.map((filter) => (
              <button
                aria-pressed={gamesFilter === filter.id}
                className={gamesFilter === filter.id ? 'filter-chip filter-chip-button active' : 'filter-chip filter-chip-button'}
                key={filter.id}
                onClick={() => setGamesFilter(filter.id)}
                title={
                  filter.id === 'all'
                    ? 'Show every title across vrSrc, the Local Library, and backup storage'
                    : filter.id === 'installed'
                      ? 'Show vrSrc and Local Library titles already installed on the selected headset'
                      : filter.id === 'updates'
                        ? 'Show vrSrc and Local Library titles where a newer version is available'
                        : filter.id === 'ready'
                          ? 'Show titles already present in the Local Library'
                          : filter.id === 'offline'
                            ? 'Show titles found in the Backups path only'
                            : 'Show titles that still need metadata identification'
                }
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="games-filter-controls">
            {displayMode === 'gallery' ? (
              <label
                className="gallery-scale-control"
                title="Temporarily change gallery density in Apps & Games and vrSrc. 1.0x = 4 cards, 1.25x = 5 cards, 1.5x = 6 cards."
              >
                <span>Scale</span>
                <input
                  aria-label="Gallery scale"
                  className="gallery-scale-slider"
                  max="150"
                  min="100"
                  onChange={(event) => setGalleryScalePercent(Number(event.target.value))}
                  step="25"
                  type="range"
                  value={galleryScalePercent}
                />
                <strong>{galleryScaleLabel}</strong>
              </label>
            ) : null}
            <div className="games-toolbar-actions">
              <button
                aria-pressed={displayMode === 'gallery'}
                className={displayMode === 'gallery' ? 'filter-chip filter-chip-button active games-view-toggle' : 'filter-chip filter-chip-button games-view-toggle'}
                onClick={onToggleDisplayMode}
                title={displayMode === 'gallery' ? 'Switch to list view' : 'Switch to grid view'}
                type="button"
              >
                {displayMode === 'gallery' ? 'List View' : 'Grid View'}
              </button>
              <button
                className="status-pill status-pill-button games-metadata-refresh-button"
                disabled={!localLibraryIndex?.items.length || Boolean(metaStoreSyncProgress)}
                onClick={() => void onRefreshAllMetadata()}
                title="Refresh metadata and artwork for titles in Apps & Games"
                type="button"
              >
                {metaStoreSyncProgress ? 'Updating Metadata…' : 'Update Metadata'}
              </button>
            </div>
            <div className="games-username-shell">
            {gamesUserNameEditing ? (
              <div className="games-username-editor">
                <input
                  aria-label="Multiplayer username"
                  autoFocus
                  className="search-shell games-username-input"
                  onChange={(event) => setGamesUserNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && gamesUserNameDraft.trim() && !deviceUserNameBusy) {
                      void onSaveDeviceUserName(gamesUserNameDraft)
                      setGamesUserNameEditing(false)
                    } else if (event.key === 'Escape' && !deviceUserNameBusy) {
                      setGamesUserNameEditing(false)
                      setGamesUserNameDraft(deviceUserName ?? '')
                    }
                  }}
                  placeholder="Enter your VR gaming name"
                  type="text"
                  value={gamesUserNameDraft}
                />
                <button
                  className="status-pill status-pill-button"
                  disabled={!selectedDeviceId || deviceUserNameBusy || !gamesUserNameDraft.trim()}
                  onClick={() => {
                    void onSaveDeviceUserName(gamesUserNameDraft)
                    setGamesUserNameEditing(false)
                  }}
                  type="button"
                >
                  {deviceUserNameBusy ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="status-pill status-pill-button"
                  disabled={deviceUserNameBusy}
                  onClick={() => {
                    setGamesUserNameEditing(false)
                    setGamesUserNameDraft(deviceUserName ?? '')
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="games-username-pill"
                disabled={!selectedDeviceId || deviceUserNameBusy}
                onClick={() => setGamesUserNameEditing(true)}
                title={
                  selectedDeviceId
                    ? 'Edit the multiplayer username stored on the selected headset'
                    : 'Select a headset first to edit the multiplayer username'
                }
                type="button"
              >
                <span className="games-username-pill-label">
                  {selectedDeviceId ? deviceUserName ?? 'Click to set' : 'Select a headset'}
                </span>
                <span className="games-username-pill-edit">{deviceUserNameBusy ? 'Loading…' : 'Edit'}</span>
              </button>
            )}
            </div>
          </div>
        </div>
        {gamesMessage && gamesMessage.tone !== 'success' ? <NoticeBanner className="games-banner" notice={gamesMessage} /> : null}
        {vrSrcMessage ? <NoticeBanner className="games-banner" notice={vrSrcMessage} /> : null}
      </section>

      <div className="games-scroll-frame" ref={gamesScrollFrameRef}>
      {isVrSrcPanelOpen ? (
        <section className="surface-panel vrsrc-panel">
          <div className="vrsrc-header">
            <div className="vrsrc-heading-row">
              <div className="vrsrc-heading-copy">
                <div className="vrsrc-title-lockup">
                  <p className="eyebrow">Remote Source</p>
                  <h2>vrSrc</h2>
                </div>
              </div>
              <div className="vrsrc-heading-actions">
                <div
                  className="vrsrc-summary-pill"
                  title={vrSrcStatus?.message ?? 'vrSrc has not been loaded yet.'}
                >
                  <span className="eyebrow">Status</span>
                  <strong className="vrsrc-status-indicator-wrap">
                    <span
                      aria-label={vrSrcStatus?.configured ? 'Ready' : 'Unavailable'}
                      className={
                        vrSrcStatus?.configured
                          ? 'runtime-state-dot runtime-state-dot-ready'
                          : 'runtime-state-dot runtime-state-dot-danger'
                      }
                      role="img"
                    />
                  </strong>
                </div>
                <div
                  className="vrsrc-summary-pill"
                  title={vrSrcStatus?.baseUriHost ?? 'No source host resolved yet.'}
                >
                  <span className="eyebrow">Catalog</span>
                  <strong>{vrSrcStatus?.itemCount ?? vrSrcItems.length}</strong>
                </div>
                <button
                  aria-pressed={vrSrcFilter === 'new'}
                  className={vrSrcFilter === 'new' ? 'vrsrc-summary-pill active' : 'vrsrc-summary-pill'}
                  title="Remote packages not currently found in the Local Library."
                  onClick={() => setVrSrcFilter((current) => (current === 'new' ? 'all' : 'new'))}
                  type="button"
                >
                  <span className="eyebrow">New</span>
                  <strong>{vrSrcSummary.newCount}</strong>
                </button>
                <button
                  aria-pressed={vrSrcFilter === 'updates'}
                  className={vrSrcFilter === 'updates' ? 'vrsrc-summary-pill active' : 'vrsrc-summary-pill'}
                  title="Remote versions newer than the strongest library match for the same package."
                  onClick={() => setVrSrcFilter((current) => (current === 'updates' ? 'all' : 'updates'))}
                  type="button"
                >
                  <span className="eyebrow">Updates</span>
                  <strong>{vrSrcSummary.updateCount}</strong>
                </button>
                <button
                  aria-pressed={vrSrcSortMode === 'latest'}
                  className={vrSrcSortMode === 'latest' ? 'vrsrc-summary-pill active' : 'vrsrc-summary-pill'}
                  title="Sort remote items by the most recently updated releases first."
                  onClick={() => setVrSrcSortMode((current) => (current === 'latest' ? 'title' : 'latest'))}
                  type="button"
                >
                  <span className="eyebrow">Sort</span>
                  <strong>{vrSrcSortMode === 'latest' ? 'Latest' : 'Title'}</strong>
                </button>
                <button
                  className="vrsrc-summary-pill vrsrc-summary-pill-button"
                  disabled={vrSrcSyncBusy}
                  onClick={() => void onSyncVrSrcCatalog()}
                  title="Refresh the vrSrc remote catalog and latest source statistics"
                  type="button"
                >
                  <strong>{vrSrcSyncBusy ? 'Syncing…' : 'Sync Source'}</strong>
                </button>
                <button
                  className="vrsrc-summary-pill vrsrc-summary-pill-button"
                  onClick={onToggleVrSrcPanel}
                  title="Close the vrSrc remote source panel"
                  type="button"
                >
                  <strong>Close</strong>
                </button>
              </div>
            </div>
            <p
              className="section-copy compact vrsrc-subtitle"
              title="Sync the protected remote catalog, then add items to the Local Library or install them directly to the headset."
            >
              <span>Sync the protected remote catalog, then add items to</span>
              <span>the Local Library or install them directly to the headset.</span>
            </p>
          </div>

          <div className="vrsrc-list-shell">
            {filteredVrSrcEntries.length ? (
              displayMode === 'gallery' ? (
                <section className="vrsrc-gallery-surface">
                  <div
                    className="vrsrc-gallery-scroll"
                    style={
                      {
                        '--game-gallery-card-height': `${scaledGalleryCardHeight}px`,
                        minHeight: `${gamesGalleryViewportHeight}px`,
                        maxHeight: `${gamesGalleryViewportHeight}px`
                      } as CSSProperties
                    }
                  >
                    {filteredVrSrcEntries.map(({ item, isUpdate, isInLibrary, statusLabel, statusClassName, displayRemoteVersion }) => (
                      <article
                        className={
                          selectedVrSrcReleaseName === item.releaseName
                            ? 'game-gallery-card vrsrc-gallery-card active'
                            : 'game-gallery-card vrsrc-gallery-card'
                        }
                        key={item.releaseName}
                        onClick={() => {
                          setSelectedGameId(null)
                          setSelectedVrSrcReleaseName(item.releaseName)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedGameId(null)
                            setSelectedVrSrcReleaseName(item.releaseName)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="game-gallery-hero-shell">
                          <ResilientArtworkImage
                            alt=""
                            artworkKey={item.releaseName}
                            className="game-gallery-hero-image"
                            fallbackClassName="game-gallery-hero-placeholder fallback-art-surface"
                            label={item.name}
                            src={item.artworkUrl}
                            variant="gallery"
                          />
                          <div className="game-gallery-title-banner">
                            <strong>{item.name}</strong>
                          </div>
                          <div className="vrsrc-gallery-overlay">
                            <div className="vrsrc-gallery-meta-stack">
                              <span className="game-gallery-size">{item.sizeLabel}</span>
                              <span className="vrsrc-gallery-version-chip">{displayRemoteVersion}</span>
                            </div>
                            <span
                              className={
                                isUpdate
                                  ? `${statusClassName} game-gallery-state vrsrc-gallery-status-pill is-update`
                                  : isInLibrary
                                    ? `${statusClassName} game-gallery-state vrsrc-gallery-status-pill is-library`
                                    : `${statusClassName} game-gallery-state vrsrc-gallery-status-pill is-new`
                              }
                            >
                              {statusLabel}
                            </span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : (
                <section className="vrsrc-table-surface">
                  <div className="table-header vrsrc-list-grid">
                    <span>Title</span>
                    <span>Version</span>
                    <span>Size</span>
                    <span>Status</span>
                    <span>Action</span>
                  </div>
                  <div className="table-stack vrsrc-results-scroll">
                  {filteredVrSrcEntries.map(({ item, highestLibraryVersion, actionBusy, statusLabel, statusClassName, displayRemoteVersion }) => (
                      <article
                        className={
                          selectedVrSrcReleaseName === item.releaseName
                            ? 'table-row-card vrsrc-list-grid vrsrc-row-card active'
                            : 'table-row-card vrsrc-list-grid vrsrc-row-card'
                        }
                        key={item.releaseName}
                        onClick={() => {
                          setSelectedGameId(null)
                          setSelectedVrSrcReleaseName(item.releaseName)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedGameId(null)
                            setSelectedVrSrcReleaseName(item.releaseName)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="vrsrc-row-primary">
                          {item.artworkUrl ? (
                            <div className="vrsrc-thumb">
                              <ResilientArtworkImage
                                alt=""
                                artworkKey={item.releaseName}
                                className="vrsrc-thumb-image"
                                fallbackClassName="vrsrc-thumb-placeholder fallback-art-surface"
                                label={item.name}
                                src={item.artworkUrl}
                                variant="cover"
                              />
                            </div>
                          ) : (
                            renderFallbackArtworkSurface(
                              item.name,
                              item.releaseName,
                              'cover',
                              'vrsrc-thumb-placeholder fallback-art-surface'
                            )
                          )}
                          <div className="row-title vrsrc-row-title">
                            <strong>{item.name}</strong>
                            <p>{item.packageName}</p>
                          </div>
                        </div>
                        <div className="games-version-stack vrsrc-version-stack">
                          <strong>{displayRemoteVersion}</strong>
                          {highestLibraryVersion ? (
                            <span>Library {formatVersionLabel(highestLibraryVersion) ?? highestLibraryVersion}</span>
                          ) : (
                            <span>No library match yet</span>
                          )}
                        </div>
                        <span className="vrsrc-size-cell">{item.sizeLabel}</span>
                        <div className="vrsrc-status-cell">
                          <span className={statusClassName}>{statusLabel}</span>
                        </div>
                        <div className="vrsrc-item-actions">
                          <button
                            className="action-pill action-pill-ghost"
                            disabled={actionBusy}
                            onClick={(event) => {
                              event.stopPropagation()
                              void onDownloadVrSrcToLibrary(item.releaseName)
                            }}
                            type="button"
                          >
                            {actionBusy ? 'Working…' : 'Add to Library'}
                          </button>
                          <button
                            className="action-pill action-pill-ghost"
                            disabled={actionBusy || !selectedDeviceId}
                            onClick={(event) => {
                              event.stopPropagation()
                              void onInstallVrSrcNow(item.releaseName)
                            }}
                            title={
                              selectedDeviceId
                                ? 'Download this vrSrc payload and install it to the selected headset'
                                : 'Select a headset first to install directly from vrSrc'
                            }
                            type="button"
                          >
                            Install Now
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )
            ) : (
              <div className="empty-state">
                <strong>No vrSrc items match the current search yet.</strong>
                <p>Sync the source or broaden the search query to surface more remote entries.</p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="surface-panel games-workspace-shell">
        <div className="vrsrc-header">
          <div className="vrsrc-heading-row">
            <div className="vrsrc-heading-copy">
              <p className="eyebrow games-workspace-eyebrow">Local Library</p>
            </div>
            <div className="vrsrc-heading-actions">
              <div
                className="vrsrc-summary-pill"
                title={localLibraryAvailable ? 'The Local Library path is configured and readable.' : 'The Local Library path is unavailable or has not been scanned yet.'}
              >
                <span className="eyebrow">Status</span>
                <strong className="vrsrc-status-indicator-wrap">
                  <span
                    aria-label={localLibraryAvailable ? 'Accessible' : 'Unavailable'}
                    className={
                      localLibraryAvailable
                        ? 'runtime-state-dot runtime-state-dot-ready'
                        : 'runtime-state-dot runtime-state-dot-danger'
                    }
                    role="img"
                  />
                </strong>
              </div>
              <div className="vrsrc-summary-pill" title="Current count of titles present in the Local Library.">
                <span className="eyebrow">Catalog</span>
                <strong>{localLibrarySummary.catalogCount}</strong>
              </div>
              <div className="vrsrc-summary-pill" title="Titles whose Local Library file or folder timestamp falls within the last 7 days.">
                <span className="eyebrow">New</span>
                <strong>{localLibrarySummary.newCount}</strong>
              </div>
              <div className="vrsrc-summary-pill" title="Installed titles where the Local Library has a newer version ready to use.">
                <span className="eyebrow">Updates</span>
                <strong>{localLibrarySummary.updateCount}</strong>
              </div>
              <button
                className="vrsrc-summary-pill"
                onClick={toggleLocalLibrarySortMode}
                title="Toggle Local Library sorting between title order and remote/source date order."
                type="button"
              >
                <span className="eyebrow">Sort</span>
                <strong>{gamesSortKey === 'date' ? 'Date' : 'Title'}</strong>
              </button>
            </div>
          </div>
          <p className="vrsrc-subtitle">
          <span>Browse what is already in your Local Library, then decide what to</span>
          <span>install, review, update, or clean up.</span>
          </p>
        </div>
        {displayMode === 'gallery' ? (
          <section className="games-gallery-surface">
            <div
              className="games-gallery-scroll"
              style={
                {
                  '--game-gallery-card-height': `${scaledGalleryCardHeight}px`,
                  minHeight: `${gamesGalleryViewportHeight}px`,
                  maxHeight: `${gamesGalleryViewportHeight}px`
                } as CSSProperties
              }
            >
              {sortedGameRows.map((game) => (
                <article
                  className={selectedGameId === game.id ? 'game-gallery-card active' : 'game-gallery-card'}
                  key={game.id}
                  onClick={() => {
                    setSelectedVrSrcReleaseName(null)
                    setSelectedGameId(game.id)
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedVrSrcReleaseName(null)
                      setSelectedGameId(game.id)
                    }
                  }}
                >
                  <div className="game-gallery-hero-shell">
                    <ResilientArtworkImage
                      alt=""
                      artworkKey={game.itemId ?? game.id}
                      className="game-gallery-hero-image"
                      fallbackClassName="game-gallery-hero-placeholder fallback-art-surface"
                      label={game.title}
                      src={game.heroImageUri ?? game.thumbnailUri ?? undefined}
                      variant="gallery"
                    />
                    <div className="game-gallery-title-banner">
                      <strong>{game.title}</strong>
                    </div>
                    <div className="game-gallery-overlay">
                      <span className="game-gallery-size">{game.size}</span>
                      {game.action === 'Installed' ? (
                        <span className="status-pill status-ready game-action-indicator game-gallery-state">
                          <span aria-hidden="true" className="game-action-indicator-check" />
                          <span>Installed</span>
                        </span>
                      ) : game.action === 'Install' || game.action === 'Update' ? (
                        <span className="action-pill game-gallery-state">{formatGameActionLabel(game.action)}</span>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              {!sortedGameRows.length ? (
                <div className="empty-state games-empty-state" style={{ minHeight: `${gamesGalleryViewportHeight}px` }}>
                  <strong>No matches for this view yet.</strong>
                  <p>Try another filter, adjust the search, or rescan the local library to surface more items here.</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="games-table-surface">
            <div className="table-header five-col games-table-header-five-col">
              <button
                className={gamesSortKey === 'title' ? 'table-sort-button active' : 'table-sort-button'}
                onClick={() => toggleGamesSort('title')}
                type="button"
              >
                <span>Title</span>
                <strong>{gamesSortKey === 'title' ? (gamesSortDirection === 'asc' ? '↑' : '↓') : '↕'}</strong>
              </button>
              <span>Version</span>
              <button
                className={gamesSortKey === 'date' ? 'table-sort-button active' : 'table-sort-button'}
                onClick={() => toggleGamesSort('date')}
                type="button"
              >
                <span>Date</span>
                <strong>{gamesSortKey === 'date' ? (gamesSortDirection === 'asc' ? '↑' : '↓') : '↕'}</strong>
              </button>
              <button
                className={gamesSortKey === 'size' ? 'table-sort-button active' : 'table-sort-button'}
                onClick={() => toggleGamesSort('size')}
                type="button"
              >
                <span>Size</span>
                <strong>{gamesSortKey === 'size' ? (gamesSortDirection === 'asc' ? '↑' : '↓') : '↕'}</strong>
              </button>
              <span>Action</span>
            </div>

            <div
              className="table-stack games-results-scroll"
              style={{ minHeight: `${gamesResultsViewportHeight}px`, maxHeight: `${gamesResultsViewportHeight}px` }}
            >
              {sortedGameRows.map((game) => (
                <article
                  className={selectedGameId === game.id ? 'table-row-card five-col games-table-row-five-col game-row-card active' : 'table-row-card five-col games-table-row-five-col game-row-card'}
                  key={game.id}
                  onClick={() => {
                    setSelectedVrSrcReleaseName(null)
                    setSelectedGameId(game.id)
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedVrSrcReleaseName(null)
                      setSelectedGameId(game.id)
                    }
                  }}
                >
                  <div className="game-row-primary">
                    <div className="game-thumb">
                      <ResilientArtworkImage
                        alt=""
                        artworkKey={game.itemId ?? game.id}
                        className="game-thumb-image"
                        fallbackClassName="game-thumb-placeholder fallback-art-surface"
                        label={game.title}
                        src={game.thumbnailUri}
                        variant="cover"
                      />
                    </div>
                    <div className="row-title">
                      <strong>{game.title}</strong>
                      <p>{game.note}</p>
                    </div>
                  </div>
                  <div className="games-version-stack">
                    <strong>{game.version}</strong>
                    {getLibraryGameVersionLines(game).map((line) => (
                      <span key={`${game.id}-${line}`}>{line}</span>
                    ))}
                  </div>
                  <span className="games-date-cell">{formatSortDateLabel(game.sourceLastUpdatedAt)}</span>
                  <span className="games-size-cell">{game.size}</span>
                  {game.action === 'Installed' ? (
                    <span className="status-pill status-ready game-action-indicator">
                      <span aria-hidden="true" className="game-action-indicator-check" />
                      <span>Installed</span>
                    </span>
                  ) : (
                    <button
                      className="action-pill"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (
                          game.source === 'library' &&
                          game.itemId &&
                          (game.action === 'Install' || game.action === 'Update') &&
                          selectedDeviceId
                        ) {
                          void onInstallLocalLibraryItem(game.itemId)
                          return
                        }

                        setSelectedVrSrcReleaseName(null)
                        setSelectedGameId(game.id)
                      }}
                      disabled={
                        game.source === 'library' &&
                        (game.action === 'Install' || game.action === 'Update') &&
                        (!selectedDeviceId || gamesInstallBusyIds.includes(game.itemId))
                      }
                      type="button"
                    >
                      {game.source === 'library' &&
                      (game.action === 'Install' || game.action === 'Update') &&
                      gamesInstallBusyIds.includes(game.itemId)
                        ? 'Installing…'
                        : formatGameActionLabel(game.action)}
                    </button>
                  )}
                </article>
              ))}
              {!sortedGameRows.length ? (
                <div className="empty-state games-empty-state" style={{ minHeight: `${gamesResultsViewportHeight}px` }}>
                  <strong>No matches for this view yet.</strong>
                  <p>Try another filter, adjust the search, or rescan the local library to surface more items here.</p>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </section>
      </div>
      </div>
      {drawerPortalTarget
        ? createPortal(
            <>
      <div
        className={selectedGame || selectedVrSrcItem ? 'games-drawer-backdrop visible' : 'games-drawer-backdrop'}
        onClick={() => {
          setSelectedGameId(null)
          setSelectedVrSrcReleaseName(null)
        }}
      />
      <aside className={selectedVrSrcItem ? 'surface-panel detail-panel games-drawer open vrsrc-drawer' : 'surface-panel detail-panel games-drawer vrsrc-drawer'}>
        <div className="games-drawer-header">
          <p className="eyebrow">Remote Source</p>
          <button className="close-pill" onClick={() => setSelectedVrSrcReleaseName(null)} type="button">
            Close
          </button>
        </div>
        {selectedVrSrcItem ? (
          <>
            <div className="games-drawer-artwork-stack">
              <div className="games-drawer-hero">
                <ResilientArtworkImage
                  alt=""
                  artworkKey={selectedVrSrcItem.releaseName}
                  className="games-drawer-hero-image"
                  fallbackClassName="games-drawer-image-placeholder fallback-art-surface"
                  label={selectedVrSrcItem.name}
                  src={selectedVrSrcItem.artworkUrl}
                  variant="hero"
                />
              </div>
              <div className="games-drawer-title-row">
                <div className="games-drawer-art">
                  <ResilientArtworkImage
                    alt=""
                    artworkKey={selectedVrSrcItem.releaseName}
                    className="games-drawer-art-image"
                    fallbackClassName="games-drawer-image-placeholder compact fallback-art-surface"
                    label={selectedVrSrcItem.name}
                    src={selectedVrSrcItem.artworkUrl}
                    variant="cover"
                  />
                </div>
                <div className="games-drawer-title-block">
                  <h3>{selectedVrSrcItem.name}</h3>
                  <p>{selectedVrSrcItem.packageName}</p>
                </div>
              </div>
              {selectedVrSrcNote || selectedVrSrcTrailerVideoId || selectedVrSrcDetailsBusy ? (
                <div className="games-drawer-sections">
                  {selectedVrSrcTrailerVideoId || selectedVrSrcDetailsBusy ? (
                    <section className="games-drawer-section-card">
                      <div className="games-drawer-media-header">
                        <span>Trailer</span>
                        {selectedVrSrcTrailerVideoId ? (
                          <a
                            className="games-drawer-inline-link"
                            href={`https://www.youtube.com/watch?v=${selectedVrSrcTrailerVideoId}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open on YouTube
                          </a>
                        ) : null}
                      </div>
                      {selectedVrSrcTrailerVideoId ? (
                        <div className="games-drawer-video-shell">
                          <iframe
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            referrerPolicy="strict-origin-when-cross-origin"
                            src={`https://www.youtube-nocookie.com/embed/${selectedVrSrcTrailerVideoId}?rel=0${trailerEmbedOrigin ? `&origin=${trailerEmbedOrigin}` : ''}`}
                            title={`${selectedVrSrcItem.name} trailer`}
                          />
                        </div>
                      ) : (
                        <p className="games-drawer-section-paragraph">
                          {selectedVrSrcDetailsBusy ? 'Searching for trailer…' : 'No trailer available for this title.'}
                        </p>
                      )}
                    </section>
                  ) : null}
                  {selectedVrSrcNote || selectedVrSrcDetailsBusy ? (
                    <section className="games-drawer-section-card">
                      <span>Notes</span>
                      <div className="games-drawer-section-card-content">
                        {selectedVrSrcNote ? (
                          <p className="games-drawer-section-paragraph">{selectedVrSrcNote}</p>
                        ) : (
                          <p className="games-drawer-section-paragraph">
                            {selectedVrSrcDetailsBusy ? 'Loading note…' : 'No note available for this release.'}
                          </p>
                        )}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}
              <div className="games-drawer-facts">
                <div className="signal-chip signal-chip-latest">
                  <span>Remote Version</span>
                  <strong>{selectedVrSrcDisplayRemoteVersion ?? 'Unavailable'}</strong>
                </div>
                <div className={selectedVrSrcHighestLibraryVersion ? 'signal-chip signal-chip-ready' : 'signal-chip'}>
                  <span>Library Version</span>
                  <strong>{selectedVrSrcHighestLibraryVersion ? (formatVersionLabel(selectedVrSrcHighestLibraryVersion) ?? selectedVrSrcHighestLibraryVersion) : 'Not Indexed'}</strong>
                </div>
                <div className={selectedVrSrcFactClassName}>
                  <span>Status</span>
                  <strong>{selectedVrSrcStatusLabel}</strong>
                </div>
                <div className="signal-chip games-drawer-fact-wide">
                  <span>Release</span>
                  <strong>{selectedVrSrcItem.releaseName}</strong>
                </div>
                <div className="signal-chip games-drawer-fact-wide">
                  <span>Package</span>
                  <strong>{selectedVrSrcItem.packageName}</strong>
                </div>
                <div className="signal-chip">
                  <span>Footprint</span>
                  <strong>{selectedVrSrcItem.sizeLabel}</strong>
                </div>
                <div className="signal-chip">
                  <span>Version Code</span>
                  <strong>{selectedVrSrcItem.versionCode}</strong>
                </div>
                <div className="signal-chip">
                  <span>Updated</span>
                  <strong>{formatDateLabel(selectedVrSrcItem.lastUpdated)}</strong>
                </div>
              </div>
            </div>
            <div className="stack-sm">
              <button
                className="action-pill"
                disabled={vrSrcActionBusyReleaseNames.includes(selectedVrSrcItem.releaseName) || selectedVrSrcLibraryCoversRemote}
                onClick={() => void downloadSelectedVrSrcToLibrary()}
                type="button"
              >
                {vrSrcActionBusyReleaseNames.includes(selectedVrSrcItem.releaseName)
                  ? 'Working…'
                  : selectedVrSrcStatus?.isUpdate
                    ? 'Update Library'
                    : selectedVrSrcLibraryCoversRemote
                      ? 'Already in Library'
                      : 'Download Only'}
              </button>
              <button
                className="action-pill"
                disabled={vrSrcActionBusyReleaseNames.includes(selectedVrSrcItem.releaseName) || !selectedDeviceId}
                onClick={() => void downloadSelectedVrSrcToLibraryAndInstall()}
                title={
                  selectedDeviceId
                    ? selectedVrSrcLibraryCoversRemote
                      ? 'Install the strongest matching Local Library version to the selected headset'
                      : 'Download this vrSrc payload into the Local Library, then install it to the selected headset'
                    : 'Select a headset first to install from vrSrc or the Local Library'
                }
                type="button"
              >
                {selectedVrSrcLibraryCoversRemote ? 'Install Local Upgrade' : 'Download & Install'}
              </button>
            </div>
          </>
        ) : null}
      </aside>
      <aside className={selectedGame ? 'surface-panel detail-panel games-drawer open' : 'surface-panel detail-panel games-drawer'}>
        <div className="games-drawer-header">
          <p className="eyebrow">Details</p>
          <button className="close-pill" onClick={() => setSelectedGameId(null)} type="button">
            Close
          </button>
        </div>
        {selectedGame ? (
          <>
            <div className="games-drawer-artwork-stack">
              <div
                className={
                  manualMetadataEditorTarget === 'hero'
                    ? 'games-drawer-hero games-inline-edit-surface editing'
                    : 'games-drawer-hero games-inline-edit-surface'
                }
              >
                <ResilientArtworkImage
                  alt=""
                  artworkKey={selectedGame.itemId ?? selectedGame.id}
                  className="games-drawer-hero-image"
                  fallbackClassName="games-drawer-image-placeholder fallback-art-surface"
                  label={effectiveSelectedGameDetails?.title ?? selectedGame.title}
                  src={selectedGameHeroUri}
                  variant="hero"
                />
                {selectedGameHasNewerAvailableVersion ? (
                  <div className="games-drawer-hero-banner">
                    <strong>{selectedGameHeroUpdateBannerLabel}</strong>
                  </div>
                ) : null}
                <div className="games-inline-edit-controls">
                  {manualMetadataEditorTarget === 'hero' ? (
                    <>
                        <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => void importManualMetadataImage('heroImageUri', 'hero')} type="button">
                        Load Hero
                      </button>
                      {selectedGame.source === 'library' || selectedGame.source === 'backup' ? (
                        <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy || !selectedGame.itemId} onClick={() => void extractIndexedItemArtwork('heroImageUri', 'hero')} type="button">
                          Extract Hero
                        </button>
                      ) : null}
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => updateManualMetadataField('heroImageUri', '')} type="button">
                        Clear
                      </button>
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => void saveManualMetadata()} type="button">
                        {manualMetadataBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={cancelManualMetadataEdit} type="button">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="status-pill status-pill-button games-inline-edit-pill" onClick={() => beginManualMetadataEdit('hero')} type="button">
                      Edit Hero
                    </button>
                  )}
                </div>
              </div>
              <div className="games-drawer-title-row">
                <div
                  className={
                    manualMetadataEditorTarget === 'art'
                      ? 'games-drawer-art games-inline-edit-surface editing'
                      : 'games-drawer-art games-inline-edit-surface'
                  }
                >
                  <ResilientArtworkImage
                    alt=""
                    artworkKey={selectedGame.itemId ?? selectedGame.id}
                    className="games-drawer-art-image"
                    fallbackClassName="games-drawer-image-placeholder compact fallback-art-surface"
                    label={effectiveSelectedGameDetails?.title ?? selectedGame.title}
                    src={selectedGameHeaderArtUri}
                    variant="cover"
                  />
                  <div
                    className={
                      manualMetadataEditorTarget === 'art'
                        ? 'games-inline-edit-controls compact editing'
                        : 'games-inline-edit-controls compact'
                    }
                  >
                    {manualMetadataEditorTarget === 'art' ? (
                      <>
                          <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => void importManualMetadataImage('thumbnailUri', 'cover')} type="button">
                          Load
                        </button>
                        {selectedGame.source === 'library' || selectedGame.source === 'backup' ? (
                          <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy || !selectedGame.itemId} onClick={() => void extractIndexedItemArtwork('thumbnailUri', 'cover')} type="button">
                            Extract
                          </button>
                        ) : null}
                        <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => updateManualMetadataField('thumbnailUri', '')} type="button">
                          Clear
                        </button>
                        <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => void saveManualMetadata()} type="button">
                          {manualMetadataBusy ? 'Saving…' : 'Save'}
                        </button>
                        <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={cancelManualMetadataEdit} type="button">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="status-pill status-pill-button games-inline-edit-pill" onClick={() => beginManualMetadataEdit('art')} type="button">
                        Edit Cover
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={
                    manualMetadataEditorTarget === 'title'
                      ? 'games-drawer-title-block games-inline-edit-surface editing'
                      : 'games-drawer-title-block games-inline-edit-surface'
                  }
                >
                  {manualMetadataEditorTarget === 'title' ? (
                    <div className="games-inline-edit-form">
                      <input
                        aria-label="Manual title"
                        className="search-shell games-manual-store-input"
                        onChange={(event) => updateManualMetadataField('title', event.target.value)}
                        placeholder="Title"
                        type="text"
                        value={manualMetadataDraft.title ?? ''}
                      />
                      <input
                        aria-label="Manual publisher"
                        className="search-shell games-manual-store-input"
                        onChange={(event) => updateManualMetadataField('publisherName', event.target.value)}
                        placeholder="Publisher"
                        type="text"
                        value={manualMetadataDraft.publisherName ?? ''}
                      />
                      <div className="games-inline-edit-controls">
                        <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => void saveManualMetadata()} type="button">
                          {manualMetadataBusy ? 'Saving…' : 'Save'}
                        </button>
                        <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={cancelManualMetadataEdit} type="button">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3>{effectiveSelectedGameDetails?.title ?? selectedGame.title}</h3>
                      <p>{effectiveSelectedGameDetails?.publisherName ?? effectiveSelectedGameDetails?.subtitle ?? selectedGame.release}</p>
                      <div className="games-inline-edit-controls">
                        <button className="status-pill status-pill-button games-inline-edit-pill" onClick={() => beginManualMetadataEdit('title')} type="button">
                          Edit Text
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {selectedGame.source === 'library' && selectedGame.itemId ? (
              !selectedGame.isInstalled && !selectedDeviceId ? (
                <p className="section-copy compact">Select a ready headset in Manager before using install actions for local payloads.</p>
              ) : null
            ) : null}

            {selectedGameDetailsBusy && !manualStorePreview ? <p className="section-copy compact">Loading store metadata…</p> : null}

            <>
              <div
                className={
                  manualMetadataEditorTarget === 'meta'
                    ? 'games-drawer-meta-stack games-inline-edit-surface editing'
                    : 'games-drawer-meta-stack games-inline-edit-surface'
                }
              >
                {manualMetadataEditorTarget === 'meta' ? (
                  <div className="games-inline-edit-form">
                    <div className="games-manual-metadata-grid">
                      <input
                        aria-label="Manual release label"
                        className="search-shell games-manual-store-input"
                        onChange={(event) => updateManualMetadataField('releaseDateLabel', event.target.value)}
                        placeholder="Release label"
                        type="text"
                        value={manualMetadataDraft.releaseDateLabel ?? ''}
                      />
                      <input
                        aria-label="Manual version"
                        className="search-shell games-manual-store-input"
                        onChange={(event) => updateManualMetadataField('version', event.target.value)}
                        placeholder="Version"
                        type="text"
                        value={manualMetadataDraft.version ?? ''}
                      />
                      <input
                        aria-label="Manual categories"
                        className="search-shell games-manual-store-input games-manual-metadata-span"
                        onChange={(event) => updateManualMetadataField('category', event.target.value)}
                        placeholder="Categories, comma-separated"
                        type="text"
                        value={manualMetadataDraft.category ?? ''}
                      />
                    </div>
                    <div className="games-inline-edit-controls">
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => void saveManualMetadata()} type="button">
                        {manualMetadataBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={cancelManualMetadataEdit} type="button">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="games-drawer-meta">
                      {effectiveSelectedGameDetails?.releaseDateLabel ? <span className="meta-chip">{effectiveSelectedGameDetails.releaseDateLabel}</span> : null}
                      {selectedGameMetaChipVersion ? <span className="meta-chip">v{selectedGameMetaChipVersion}</span> : null}
                    </div>
                    {selectedGameCategoryChips.length ? (
                      <div className="games-drawer-meta">
                        {selectedGameCategoryChips.map((genre) => (
                          <span className="meta-chip" key={genre}>
                            {genre}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="games-inline-edit-controls">
                      <button className="status-pill status-pill-button games-inline-edit-pill" onClick={() => beginManualMetadataEdit('meta')} type="button">
                        Edit Chips
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div
                className={
                  manualMetadataEditorTarget === 'description'
                    ? 'games-drawer-copy-editor games-inline-edit-surface editing'
                    : 'games-drawer-copy-editor games-inline-edit-surface'
                }
              >
                {manualMetadataEditorTarget === 'description' ? (
                  <div className="games-inline-edit-form">
                    <textarea
                      aria-label="Manual short description"
                      className="search-shell games-manual-metadata-textarea"
                      onChange={(event) => updateManualMetadataField('shortDescription', event.target.value)}
                      placeholder="Short description"
                      rows={3}
                      value={manualMetadataDraft.shortDescription ?? ''}
                    />
                    <textarea
                      aria-label="Manual long description"
                      className="search-shell games-manual-metadata-textarea"
                      onChange={(event) => updateManualMetadataField('longDescription', event.target.value)}
                      placeholder="Long description"
                      rows={8}
                      value={manualMetadataDraft.longDescription ?? ''}
                    />
                    <div className="games-inline-edit-controls">
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => void saveManualMetadata()} type="button">
                        {manualMetadataBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={cancelManualMetadataEdit} type="button">
                        Cancel
                      </button>
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => updateManualMetadataField('shortDescription', '')} type="button">
                        Clear Short
                      </button>
                      <button className="status-pill status-pill-button games-inline-edit-pill" disabled={manualMetadataBusy} onClick={() => updateManualMetadataField('longDescription', '')} type="button">
                        Clear Long
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {effectiveSelectedGameDetails?.shortDescription ? (
                      <div className="games-drawer-copy-stack">
                        {renderDescriptionBlocks(
                          parseMarkdownBlocks(effectiveSelectedGameDetails.shortDescription),
                          'games-short-description',
                          'section-copy compact'
                        )}
                      </div>
                    ) : null}
                    {selectedGameDescription.overview.length ? (
                      <div className="games-drawer-copy-stack">{renderDescriptionBlocks(selectedGameDescription.overview, 'games-overview')}</div>
                    ) : null}
                    {selectedGameDescription.sections.length ? (
                      <div className="games-drawer-sections">
                        {selectedGameDescription.sections.map((section) => (
                          <section className="games-drawer-section-card" key={section.title}>
                            <span>{section.title}</span>
                            <div className="games-drawer-section-card-content">{renderDescriptionBlocks(section.blocks, `games-section-${section.title}`, 'games-drawer-section-paragraph')}</div>
                          </section>
                        ))}
                      </div>
                    ) : null}
                    {selectedGameDescription.links.length ? (
                      <div className="games-drawer-facts">
                        {selectedGameDescription.links.map((link) => (
                          <div className="signal-chip" key={link}>
                            <span>Link</span>
                            <strong>{link.replace(/^https?:\/\//, '')}</strong>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="games-inline-edit-controls">
                      <button className="status-pill status-pill-button games-inline-edit-pill" onClick={() => beginManualMetadataEdit('description')} type="button">
                        Edit Description
                      </button>
                    </div>
                  </>
                )}
              </div>
                <div className="games-drawer-facts">
                  {selectedGame.source === 'backup' ? (
                    <div className={selectedGame.isInstalled ? 'signal-chip signal-chip-ready games-drawer-fact-wide' : 'signal-chip games-drawer-fact-wide'}>
                      <span>Headset Status</span>
                      <strong>{selectedGame.isInstalled ? 'Installed on headset' : 'Not installed on headset'}</strong>
                    </div>
                  ) : null}
                  {selectedGamePrimaryPackageId ? (
                    <div className="signal-chip games-drawer-fact-wide">
                      <span>Package</span>
                      <strong>{selectedGamePrimaryPackageId}</strong>
                    </div>
                  ) : null}
                  {selectedGameStoreVersion || selectedGameLibraryVersion || selectedGameInstalledVersion ? (
                    <>
                      <div className="signal-chip signal-chip-latest">
                        <span>Latest Available</span>
                        <strong>{formatVersionLabel(selectedGameStoreVersion) ?? 'Unavailable'}</strong>
                      </div>
                      <div className="signal-chip">
                        <span>{selectedGame.source === 'backup' ? 'In Backup' : 'Version'}</span>
                        <strong>{formatVersionLabel(selectedGameLibraryVersion) ?? 'Unavailable'}</strong>
                      </div>
                      <div className={selectedGameInstalledVersion ? 'signal-chip signal-chip-ready' : 'signal-chip'}>
                        <span>Installed</span>
                        <strong>{formatVersionLabel(selectedGameInstalledVersion) ?? 'Unavailable'}</strong>
                      </div>
                    </>
                  ) : null}
                  {(selectedGame.manualStoreIdEdited ? selectedGame.manualStoreId : effectiveSelectedGameDetails?.storeItemId) ? (
                    <div className={selectedGame.manualStoreIdEdited ? 'signal-chip signal-chip-warm' : 'signal-chip'}>
                      <span>{selectedGame.manualStoreIdEdited ? 'Store ID (Manual)' : 'Store ID'}</span>
                      <strong>{selectedGame.manualStoreIdEdited ? selectedGame.manualStoreId : effectiveSelectedGameDetails?.storeItemId}</strong>
                    </div>
                  ) : null}
                  {selectedGameFolderName ? (
                    <div className="signal-chip games-drawer-fact-wide">
                      <span>Folder</span>
                      <strong>{selectedGameFolderName}</strong>
                    </div>
                  ) : null}
                  {selectedGameHasHiddenVersions ? (
                    <div className={selectedGameHasLowerLibraryVersions ? 'signal-chip signal-chip-warm games-drawer-fact-wide' : 'signal-chip games-drawer-fact-wide'}>
                      <span>Hidden Versions</span>
                      <strong>
                        {selectedGameHasLowerLibraryVersions
                          ? `${selectedGameLowerLibraryVersions.length} older local ${selectedGameLowerLibraryVersions.length === 1 ? 'copy' : 'copies'}`
                          : `${selectedGame.hiddenVersionCount} additional ${selectedGame.hiddenVersionCount === 1 ? 'entry' : 'entries'}`}
                      </strong>
                    </div>
                  ) : null}
                  {effectiveSelectedGameDetails?.sizeBytes ? (
                    <div className="signal-chip">
                      <span>Footprint</span>
                      <strong>{formatBytes(effectiveSelectedGameDetails.sizeBytes)}</strong>
                    </div>
                  ) : null}
                </div>
                {selectedGameHasLowerLibraryVersions ? (
                  <div className="games-version-maintenance">
                    <div className="games-version-maintenance-copy">
                      <strong>Older local versions are hidden in Apps &amp; Games.</strong>
                      <span>The newest version stays visible here. Pick one older payload below if you want to remove it.</span>
                    </div>
                    <div className="games-drawer-meta">
                      {selectedGameLowerLibraryVersions.map((entry) => (
                        <button
                          aria-pressed={selectedLowerLibraryVersion?.id === entry.id}
                          className={
                            selectedLowerLibraryVersion?.id === entry.id
                              ? 'meta-chip meta-chip-warm filter-chip-button active games-version-option'
                              : 'meta-chip meta-chip-warm filter-chip-button games-version-option'
                          }
                          key={entry.id}
                          onClick={() => setSelectedLowerLibraryVersionId(entry.id)}
                          title={entry.relativePath}
                          type="button"
                        >
                          {entry.versionLabel}
                        </button>
                      ))}
                    </div>
                    {selectedLowerLibraryVersion ? (
                      <span className="games-version-maintenance-selection">
                        Selected: {selectedLowerLibraryVersion.versionLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {manualStoreMatchEditor}
                {manualMetadataMessage ? <NoticeBanner className="games-banner" notice={manualMetadataMessage} /> : null}
            </>

            {selectedGame.source === 'library' && selectedGame.itemId ? (
              <div className="stack-sm">
                {!selectedGame.isInstalled || selectedGame.hasLibraryUpdate ? (
                  <button
                    className="action-pill"
                    disabled={!selectedDeviceId || selectedGameInstallBusy}
                    onClick={() => void installSelectedLocalLibraryItem()}
                    type="button"
                  >
                    <span className="action-pill-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path
                          d="M8 2.25v7M5.25 6.75 8 9.5l2.75-2.75M3 11.5h10"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.4"
                        />
                      </svg>
                    </span>
                    {selectedGameInstallBusy ? 'Installing…' : selectedGame.hasLibraryUpdate ? 'Install Local Upgrade' : 'Install Now'}
                  </button>
                ) : null}
                {selectedGame.isInstalled && selectedGamePrimaryPackageId ? (
                  <button
                    className="action-pill action-pill-danger"
                    disabled={selectedGameUninstallBusy}
                    onClick={() => void uninstallSelectedInstalledGame()}
                    type="button"
                  >
                    <span className="action-pill-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path
                          d="M5.5 3.25h5M6.25 1.75h3.5M4.5 3.25l.65 9.25h5.7l.65-9.25M6.5 6v4.25M9.5 6v4.25"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.35"
                        />
                      </svg>
                    </span>
                    {selectedGameUninstallBusy ? 'Removing…' : 'Uninstall'}
                  </button>
                ) : null}
                <button
                  className="action-pill action-pill-danger action-pill-hazard action-pill-hazard-white"
                  disabled={selectedLibraryPurgeBusy}
                  onClick={() => void deleteSelectedLibraryItem()}
                  type="button"
                >
                  <span className="action-pill-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path
                        d="M5.5 3.25h5M6.25 1.75h3.5M4.5 3.25l.65 9.25h5.7l.65-9.25M6.5 6v4.25M9.5 6v4.25"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.35"
                      />
                    </svg>
                  </span>
                  {selectedLibraryPurgeBusy ? 'Deleting…' : 'Delete from Library'}
                </button>
                {selectedGameHasLowerLibraryVersions ? (
                  <button
                    className="action-pill action-pill-danger action-pill-hazard"
                    disabled={selectedGameLowerVersionPurgeBusy || !selectedLowerLibraryVersion}
                    onClick={() => void purgeSelectedLowerLibraryVersion()}
                    type="button"
                  >
                    <span className="action-pill-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path
                          d="M5.5 3.25h5M6.25 1.75h3.5M4.5 3.25l.65 9.25h5.7l.65-9.25M6.5 6v4.25M9.5 6v4.25"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.35"
                        />
                      </svg>
                    </span>
                    {selectedGameLowerVersionPurgeBusy
                      ? 'Deleting Older Version…'
                      : 'Delete Older Version'}
                  </button>
                ) : null}
              </div>
            ) : selectedGame.source === 'backup' && selectedGame.itemId ? (
              <div className="stack-sm">
                <button
                  className={selectedGame.isInstalled ? 'status-pill status-ready game-action-indicator' : 'status-pill status-neutral'}
                  disabled
                  type="button"
                >
                  {selectedGame.isInstalled ? (
                    <>
                      <span aria-hidden="true" className="game-action-indicator-check" />
                      <span>Installed</span>
                    </>
                  ) : (
                    'Not Installed'
                  )}
                </button>
                <button
                  className="action-pill"
                  disabled={selectedBackupStorageActionBusy || !settings?.localLibraryPath}
                  onClick={() => void onMoveBackupStorageItemToLibrary(selectedGame.itemId!)}
                  type="button"
                >
                  <span className="action-pill-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path
                        d="M3 12.25h10M8 3.25v6.5M5.25 7 8 9.75 10.75 7"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.4"
                      />
                    </svg>
                  </span>
                  {selectedBackupStorageActionBusy ? 'Moving…' : 'Move to Library'}
                </button>
                <button
                  className="action-pill action-pill-danger action-pill-hazard action-pill-hazard-white"
                  disabled={selectedBackupStorageActionBusy}
                  onClick={() => void onDeleteBackupStorageItem(selectedGame.itemId!)}
                  type="button"
                >
                  <span className="action-pill-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path
                        d="M5.5 3.25h5M6.25 1.75h3.5M4.5 3.25l.65 9.25h5.7l.65-9.25M6.5 6v4.25M9.5 6v4.25"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.35"
                      />
                    </svg>
                  </span>
                  {selectedBackupStorageActionBusy ? 'Deleting…' : 'Delete Backup'}
                </button>
              </div>
            ) : (
              <div className="stack-sm">
                <div className="metric-card">
                  <span>Primary CTA</span>
                  <strong>{selectedGame.cta}</strong>
                </div>
                <div className="metric-card">
                  <span>Fallback CTA</span>
                  <strong>{selectedGame.fallback}</strong>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="eyebrow">Details</p>
            <h3>Game Detail Panel</h3>
            <p>
              Trailer, release notes, install safety, local payload status, and context-aware actions will live here in
              the full app.
            </p>

            <div className="stack-sm">
              <div className="metric-card">
                <span>Primary CTA</span>
                <strong>Download and Install</strong>
              </div>
              <div className="metric-card">
                <span>Fallback CTA</span>
                <strong>Install from Local Library</strong>
              </div>
            </div>
          </>
        )}
      </aside>
            </>,
            drawerPortalTarget
          )
        : null}
    </section>
  )
}

function ManagerView(props: {
  deviceResponse: DeviceListResponse | null
  deviceBusy: boolean
  deviceMessage: string | null
  selectedDeviceId: string | null
  onSelectDevice: (serial: string | null) => void
  onRefreshDevices: () => Promise<void>
  onConnectDevice: (address: string) => Promise<void>
  onDisconnectDevice: (serial: string) => Promise<void>
}) {
  const {
    deviceResponse,
    deviceBusy,
    deviceMessage,
    selectedDeviceId,
    onSelectDevice,
    onRefreshDevices,
    onConnectDevice,
    onDisconnectDevice
  } = props
  const [connectAddress, setConnectAddress] = useState('')

  const readyDevices = deviceResponse?.devices.filter((device) => device.state === 'device') ?? []
  const wifiDevices = deviceResponse?.devices.filter((device) => device.transport === 'tcp') ?? []
  const scannedAt = formatTimeLabel(deviceResponse?.scannedAt)
  const runtimeReady = deviceResponse?.runtime.status === 'ready'

  async function handleConnect() {
    await onConnectDevice(connectAddress)
    setConnectAddress('')
  }

  return (
    <section className="view-stack settings-view-stack">
      <div className="content-split">
        <div className="manager-primary-stack">
          <section className="surface-panel">
            <div className="section-heading">
              <div className="network-heading">
                <p className="eyebrow">Network Pairing</p>
                <h2>ADB Over Wi-Fi</h2>
              </div>
              <span aria-hidden="true" className="network-heading-icon transport-icon transport-wifi" />
            </div>

            <p className="section-copy">
              Connect the headset over USB first and approve ADB access, then enter the headset IP address here. The app
              will try to enable wireless ADB on port 5555 and connect for you. Once the TCP device appears, you can
              unplug USB and continue over Wi-Fi.
            </p>

            <div className="connect-row connect-row-spaced">
              <input
                className="connect-input"
                onChange={(event) => setConnectAddress(event.target.value)}
                placeholder="192.168.1.25 or IP:5555"
                value={connectAddress}
              />
              <button className="action-pill" disabled={deviceBusy || !connectAddress.trim()} onClick={() => void handleConnect()}>
                Connect
              </button>
            </div>
          </section>

          <section className="surface-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Live Devices</p>
                <h2>Connected Headsets</h2>
              </div>
            </div>

            {deviceResponse?.devices.length ? (
              <div className="device-grid">
                {deviceResponse.devices.map((device) => {
                  const deviceStorageIndicator = resolveQuestStorageIndicator(
                    [device.model, device.product, device.label],
                    device.storageTotalBytes
                  )
                  const deviceTitle = deviceStorageIndicator
                    ? `Meta ${deviceStorageIndicator.family} | ${deviceStorageIndicator.storageLabel}`
                    : `Meta ${device.model ?? device.label}`

                  return (
                    <article className={selectedDeviceId === device.id ? 'device-card selected' : 'device-card'} key={device.id}>
                      <div className="device-card-top">
                        <div className="row-title">
                          <div className="device-title-row">
                            <strong>{deviceTitle}</strong>
                            <span className="meta-chip">Serial: {device.id}</span>
                          </div>
                        </div>
                        <span className={device.state === 'device' ? 'status-pill status-ready' : 'status-pill status-pending'}>
                          {device.state}
                        </span>
                      </div>

                      <div className="device-tag-row">
                        <span className="meta-chip">HorizonOS: {device.horizonOsDisplayName ?? 'Unavailable'}</span>
                        <span className="meta-chip">Transport: {device.transport}</span>
                        <span className="meta-chip">Battery: {device.batteryLevel !== null ? `${device.batteryLevel}%` : 'Unavailable'}</span>
                        <span className="meta-chip">IP: {device.ipAddress ?? 'Unavailable'}</span>
                      </div>

                      <p className="device-note">{device.note}</p>

                      <div className="inline-actions">
                        <button
                          className={selectedDeviceId === device.id ? 'action-pill action-pill-ghost active' : 'action-pill action-pill-ghost'}
                          disabled={device.state !== 'device'}
                          onClick={() => onSelectDevice(device.id)}
                        >
                          {selectedDeviceId === device.id ? 'Selected Device' : 'Use for App Inventory'}
                        </button>
                        {device.transport === 'tcp' ? (
                          <button
                            className="action-pill action-pill-ghost"
                            disabled={deviceBusy}
                            onClick={() => void onDisconnectDevice(device.id)}
                          >
                            Disconnect
                          </button>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No devices visible yet.</strong>
                <p>Connect a Quest headset over USB or enter a Wi-Fi target above, then refresh the list.</p>
              </div>
            )}
          </section>

        </div>

        <section className="surface-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Managed Runtime</p>
              <h2>ADB Control</h2>
            </div>
            <button className="status-pill status-pill-button" disabled={deviceBusy} onClick={() => void onRefreshDevices()}>
              {deviceBusy ? 'Refreshing...' : 'Refresh Devices'}
            </button>
          </div>

          <div className="runtime-stack">
            <p className="section-copy">{deviceResponse?.runtime.message ?? 'Preparing the managed ADB runtime for the first scan.'}</p>

            {deviceResponse?.runtime.adbPath ? <code className="inline-code runtime-path-code">{deviceResponse.runtime.adbPath}</code> : null}
            {deviceMessage && deviceMessage !== deviceResponse?.runtime.message ? <div className="runtime-banner">{deviceMessage}</div> : null}

            <div className="runtime-meta-grid runtime-meta-grid-compact">
              <div className="signal-chip">
                <span>Status</span>
                <strong>{runtimeReady ? 'Ready' : 'Setup'}</strong>
              </div>
              <div className="signal-chip">
                <span>Last Scan</span>
                <strong>{scannedAt ?? 'Pending'}</strong>
              </div>
              <div className="signal-chip runtime-tracking-chip">
                <span>Tracking</span>
                <strong>Every 5 seconds</strong>
              </div>
              <div className="signal-chip runtime-full-width-chip">
                <span>Managed Runtime</span>
                <strong>Managed ADB Bootstrap</strong>
              </div>
              <div className="signal-chip runtime-full-width-chip">
                <span>Live Monitoring</span>
                <strong>Live ADB Polling</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

function InventoryView(props: {
  selectedDeviceId: string | null
  selectedDevice: DeviceListResponse['devices'][number] | null
  deviceAppsResponse: DeviceAppsResponse | null
  deviceLeftoverResponse: DeviceLeftoverScanResponse | null
  localLibraryIndex: LocalLibraryScanResponse | null
  backupStorageIndex: LocalLibraryScanResponse | null
  metaStoreMatchesByItemId: Record<string, MetaStoreGameSummary>
  installedMetaStoreMatchesByPackageId: Record<string, MetaStoreGameSummary>
  deviceAppsBusy: boolean
  deviceAppsMessage: string | null
  inventoryMessage: UiNotice | null
  inventoryActionBusyPackageId: string | null
  runtimeStatus: DeviceListResponse['runtime']['status'] | null
  runtimeMessage: string | null
  displayMode: GamesDisplayMode
  onToggleDisplayMode: () => void
  onOpenOrphanedDataDiscovery: () => void
  onRefreshInstalledApps: (serial: string) => Promise<void>
  onUninstallInstalledApp: (packageId: string) => Promise<void>
  onBackupInstalledApp: (packageId: string) => Promise<void>
}) {
  const {
    selectedDeviceId,
    selectedDevice,
    deviceAppsResponse,
    deviceLeftoverResponse,
    localLibraryIndex,
    backupStorageIndex,
    metaStoreMatchesByItemId,
    installedMetaStoreMatchesByPackageId,
    deviceAppsBusy,
    deviceAppsMessage,
    inventoryMessage,
    inventoryActionBusyPackageId,
    runtimeStatus,
    runtimeMessage,
    displayMode,
    onToggleDisplayMode,
    onOpenOrphanedDataDiscovery,
    onRefreshInstalledApps,
    onUninstallInstalledApp,
    onBackupInstalledApp
  } = props
  const [sortMode, setSortMode] = useState<'name' | 'size'>('name')
  const [selectedInventoryPackageId, setSelectedInventoryPackageId] = useState<string | null>(null)
  const adbReady = runtimeStatus === 'ready'
  const showAppsBanner = Boolean(deviceAppsMessage && deviceAppsMessage !== runtimeMessage)
  const activeLeftoverResponse =
    selectedDeviceId && deviceLeftoverResponse?.serial === selectedDeviceId ? deviceLeftoverResponse : null
  const userInstalledAppCount = deviceAppsResponse?.apps.length ?? 0
  const systemAppCount = deviceAppsResponse?.systemAppCount ?? 0
  const leftoverTotalBytes = (activeLeftoverResponse?.items ?? []).reduce(
    (total, item) => total + (item.sizeBytes ?? 0),
    0
  )
  const leftoverItemCount = activeLeftoverResponse?.items.length ?? 0
  const packageSummaryByPackageId = buildPackageSummaryLookup(
    localLibraryIndex,
    backupStorageIndex,
    metaStoreMatchesByItemId,
    installedMetaStoreMatchesByPackageId
  )
  const visibleApps = (deviceAppsResponse?.apps ?? [])
    .slice()
    .sort((left, right) => {
      if (sortMode === 'size') {
        const leftSize = left.totalFootprintBytes ?? -1
        const rightSize = right.totalFootprintBytes ?? -1
        if (leftSize !== rightSize) {
          return rightSize - leftSize
        }
      }

      return (left.label ?? left.inferredLabel).localeCompare(right.label ?? right.inferredLabel)
    })
  const selectedInventoryApp =
    selectedInventoryPackageId !== null
      ? visibleApps.find((app) => app.packageId === selectedInventoryPackageId) ?? null
      : null
  const selectedInventorySummary = selectedInventoryApp
    ? resolveInstalledPackageSummary(
        selectedInventoryApp.packageId,
        packageSummaryByPackageId,
        installedMetaStoreMatchesByPackageId
      )
    : null
  const selectedInventoryArtworkUri = resolveMetaStoreArtworkUri(selectedInventorySummary)
  const selectedInventoryDisplayLabel =
    selectedInventoryApp?.label ?? selectedInventoryApp?.inferredLabel ?? 'Installed app'

  useEffect(() => {
    if (!selectedInventoryPackageId) {
      return
    }

    if (!selectedDeviceId || !visibleApps.some((app) => app.packageId === selectedInventoryPackageId)) {
      setSelectedInventoryPackageId(null)
    }
  }, [selectedDeviceId, selectedInventoryPackageId, visibleApps])

  const drawerPortalTarget = typeof document !== 'undefined' ? document.body : null
  const inventoryResultsViewportHeight = 84 * 5 + 8 * 4

  return (
    <section className="view-stack inventory-view-stack">
      <section className="settings-stats-grid inventory-stats-grid">
        <article
          className="settings-stat-card"
          title="Counts user-installed apps currently indexed from the connected headset. Use Refresh installed apps to update it."
        >
          <div className="settings-stat-card-top">
            <span>User Installed Apps</span>
            <p>Quest apps</p>
          </div>
          <strong>{userInstalledAppCount}</strong>
        </article>
        <article
          className="settings-stat-card"
          title="Counts system packages reported by Android with `pm list packages -s` on the selected headset."
        >
          <div className="settings-stat-card-top">
            <span>System Apps</span>
            <p>Android packages</p>
          </div>
          <strong>{systemAppCount}</strong>
        </article>
        <article
          className="settings-stat-card"
          title="Total headset storage capacity reported by the selected device."
        >
          <div className="settings-stat-card-top">
            <span>Total Storage</span>
            <p>Headset capacity</p>
          </div>
          <strong>{formatBytes(selectedDevice?.storageTotalBytes ?? null)}</strong>
        </article>
        <article
          className="settings-stat-card"
          title="Free storage remaining on the selected headset."
        >
          <div className="settings-stat-card-top">
            <span>Storage Free</span>
            <p>Available now</p>
          </div>
          <strong>{formatBytes(selectedDevice?.storageFreeBytes ?? null)}</strong>
        </article>
        <button
          className="settings-stat-card settings-stat-card-button"
          onClick={onOpenOrphanedDataDiscovery}
          title="Open Orphaned Data to scan, review, and remove leftover Android/obb and Android/data folders from the selected headset."
          type="button"
        >
          <div className="settings-stat-card-top">
            <span>Orphaned Data</span>
            <p>{leftoverItemCount ? `${leftoverItemCount} leftover item${leftoverItemCount === 1 ? '' : 's'}` : 'Scan to review'}</p>
          </div>
          <strong>{leftoverItemCount ? formatBytes(leftoverTotalBytes) : 'Open'}</strong>
        </button>
      </section>

      <div className="inventory-content-frame">
      <section className="surface-panel settings-paths-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Installed Inventory</p>
            <h2>Installed Apps &amp; Games</h2>
            <p className="section-copy compact">
              {selectedDeviceId ? `Selected device: ${selectedDeviceId}` : 'Select a connected device in Manager to load installed apps.'}
            </p>
          </div>
          <div className="hero-pill-row inventory-toolbar">
            <span
              className={
                adbReady
                  ? 'status-pill status-ready runtime-state-pill inventory-toolbar-pill'
                  : 'status-pill status-danger runtime-state-pill inventory-toolbar-pill'
              }
            >
              <span className={adbReady ? 'runtime-state-dot runtime-state-dot-ready' : 'runtime-state-dot runtime-state-dot-danger'} />
              <span>ADB</span>
            </span>
            <button
              aria-pressed={displayMode === 'gallery'}
              className={displayMode === 'gallery' ? 'filter-chip filter-chip-button active inventory-view-toggle' : 'filter-chip filter-chip-button inventory-view-toggle'}
              onClick={onToggleDisplayMode}
              title={displayMode === 'gallery' ? 'Switch to the list-based installed inventory view.' : 'Switch to the gallery-based installed inventory view.'}
              type="button"
            >
              {displayMode === 'gallery' ? 'List View' : 'Grid View'}
            </button>
            <button
              className={sortMode === 'size' ? 'filter-chip filter-chip-button active inventory-view-toggle' : 'filter-chip filter-chip-button inventory-view-toggle'}
              onClick={() => setSortMode((current) => (current === 'name' ? 'size' : 'name'))}
              title={sortMode === 'size' ? 'Currently sorted by total size, largest first. Click to switch back to name order.' : 'Sort installed apps by total size instead of alphabetical order.'}
              type="button"
            >
              {sortMode === 'size' ? 'Sort: Size' : 'Sort: Name'}
            </button>
            <button
              className="status-pill status-pill-button inventory-toolbar-pill"
              disabled={deviceAppsBusy || !selectedDeviceId}
              onClick={() => (selectedDeviceId ? void onRefreshInstalledApps(selectedDeviceId) : undefined)}
              title="Refresh installed apps, versions, and footprints from the selected headset."
            >
              {deviceAppsBusy ? 'Loading apps...' : 'Refresh installed apps'}
            </button>
          </div>
        </div>

        {inventoryMessage ? <NoticeBanner className="apps-banner" notice={inventoryMessage} /> : null}
        {showAppsBanner ? <div className="runtime-banner apps-banner">{deviceAppsMessage}</div> : null}

        {selectedDeviceId && visibleApps.length ? (
          <>
            {displayMode === 'gallery' ? (
              <div className="inventory-gallery-scroll">
                {visibleApps.map((app) => {
                  const summary = resolveInstalledPackageSummary(
                    app.packageId,
                    packageSummaryByPackageId,
                    installedMetaStoreMatchesByPackageId
                  )
                  const artworkUri = resolveMetaStoreArtworkUri(summary)
                  const displayLabel = app.label ?? app.inferredLabel

                  return (
                    <article
                      className={
                        selectedInventoryPackageId === app.packageId
                          ? 'inventory-gallery-card active'
                          : 'inventory-gallery-card'
                      }
                      key={app.packageId}
                      onClick={() => setSelectedInventoryPackageId(app.packageId)}
                    >
                      <div className="inventory-gallery-hero-shell">
                        <div className="game-gallery-title-banner">
                          <strong>{displayLabel}</strong>
                        </div>
                        <ResilientArtworkImage
                          alt=""
                          artworkKey={app.packageId}
                          className="inventory-gallery-hero-image"
                          fallbackClassName="inventory-gallery-hero-placeholder fallback-art-surface"
                          label={displayLabel}
                          src={artworkUri}
                          variant="gallery"
                        />
                        <div className="inventory-gallery-overlay">
                          <span className="inventory-gallery-meta">{formatBytes(app.totalFootprintBytes)}</span>
                          <div className="inventory-gallery-action-group">
                            {inventoryActionBusyPackageId === app.packageId ? (
                              <span className="status-pill status-pending inventory-operation-pill inventory-gallery-operation-pill" title="Operation in progress. Open Live Queue to follow the detailed status.">
                                Operation In Progress
                              </span>
                            ) : (
                              <>
                                <button
                                  className="action-pill action-pill-ghost inventory-gallery-action-pill"
                                  disabled={deviceAppsBusy}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void onBackupInstalledApp(app.packageId)
                                  }}
                                  title="Back up this installed app to the configured local backup folder."
                                  type="button"
                                >
                                  Backup
                                </button>
                                <button
                                  className="action-pill action-pill-danger inventory-gallery-action-pill"
                                  disabled={deviceAppsBusy}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void onUninstallInstalledApp(app.packageId)
                                  }}
                                  title="Uninstall this app from the selected headset."
                                  type="button"
                                >
                                  Uninstall
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <>
                <div className="table-header installed-app-list-grid">
                  <span>App</span>
                  <span>Version</span>
                  <span>Total Size</span>
                  <span>Action</span>
                </div>

                <div
                  className="table-stack inventory-results-scroll"
                  style={{ minHeight: `${inventoryResultsViewportHeight}px`, maxHeight: `${inventoryResultsViewportHeight}px` }}
                >
                  {visibleApps.map((app) => {
                    const summary = resolveInstalledPackageSummary(
                      app.packageId,
                      packageSummaryByPackageId,
                      installedMetaStoreMatchesByPackageId
                    )
                    const artworkUri = resolveMetaStoreArtworkUri(summary)
                    const displayLabel = app.label ?? app.inferredLabel

                    return (
                    <article
                      className={
                        selectedInventoryPackageId === app.packageId
                          ? 'table-row-card installed-app-list-grid inventory-row-card active'
                          : 'table-row-card installed-app-list-grid inventory-row-card'
                      }
                      key={app.packageId}
                      onClick={() => setSelectedInventoryPackageId(app.packageId)}
                    >
                      <div className="game-row-primary">
                        <div className="game-thumb">
                          <ResilientArtworkImage
                            alt=""
                            artworkKey={app.packageId}
                            className="game-thumb-image"
                            fallbackClassName="game-thumb-placeholder fallback-art-surface"
                            label={displayLabel}
                            src={artworkUri}
                            variant="cover"
                          />
                        </div>
                        <div className="row-title inventory-row-title">
                          <strong>{displayLabel}</strong>
                          <p title={app.packageId}>{app.packageId}</p>
                        </div>
                      </div>
                      <div className="games-version-stack inventory-version-stack" title={app.version ?? 'Unavailable'}>
                        <strong>{app.version ?? 'Unavailable'}</strong>
                        <span>Installed on headset</span>
                      </div>
                      <span className="inventory-size-cell">{formatBytes(app.totalFootprintBytes)}</span>
                      <div className="inventory-action-cell">
                        <div className="inventory-action-stack">
                          {inventoryActionBusyPackageId === app.packageId ? (
                            <span className="status-pill status-pending inventory-operation-pill" title="Operation in progress. Open Live Queue to follow the detailed status.">
                              Operation In Progress
                            </span>
                          ) : (
                            <>
                              <button
                                className="status-pill status-pill-button"
                                disabled={deviceAppsBusy}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void onBackupInstalledApp(app.packageId)
                                }}
                                title="Back up this installed app to the configured local backup folder."
                                type="button"
                              >
                                <span className="action-pill-icon" aria-hidden="true">
                                  <svg viewBox="0 0 16 16" focusable="false">
                                    <path
                                      d="M3.5 4h9v8.5h-9zM5.5 2.25h5v1.75h-5zM8 6.25v4.25M6.25 8.5 8 10.25 9.75 8.5"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="1.35"
                                    />
                                  </svg>
                                </span>
                                Backup
                              </button>
                              <button
                                className="status-pill status-danger status-pill-button status-pill-button-danger"
                                disabled={deviceAppsBusy}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void onUninstallInstalledApp(app.packageId)
                                }}
                                title="Uninstall this app from the selected headset."
                                type="button"
                              >
                                <span className="action-pill-icon" aria-hidden="true">
                                  <svg viewBox="0 0 16 16" focusable="false">
                                    <path
                                      d="M5.5 3.25h5M6.25 1.75h3.5M4.5 3.25l.65 9.25h5.7l.65-9.25M6.5 6v4.25M9.5 6v4.25"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="1.35"
                                    />
                                  </svg>
                                </span>
                                Uninstall
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  )})}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="empty-state">
            <strong>{selectedDeviceId ? 'No installed apps match the current filters.' : 'No device selected.'}</strong>
            <p>
              {selectedDeviceId
                ? 'If the headset is connected and authorized, refresh installed apps to populate this inventory.'
                : 'Choose one ready device in Manager to inspect its installed packages.'}
            </p>
          </div>
        )}
      </section>
      </div>
      {drawerPortalTarget
        ? createPortal(
            <>
              <div
                className={selectedInventoryApp ? 'games-drawer-backdrop visible' : 'games-drawer-backdrop'}
                onClick={() => setSelectedInventoryPackageId(null)}
              />
              <aside className={selectedInventoryApp ? 'surface-panel detail-panel games-drawer open inventory-drawer' : 'surface-panel detail-panel games-drawer inventory-drawer'}>
                <div className="games-drawer-header">
                  <p className="eyebrow">Installed App</p>
                  <button className="close-pill" onClick={() => setSelectedInventoryPackageId(null)} type="button">
                    Close
                  </button>
                </div>
                {selectedInventoryApp ? (
                  <>
                    <div className="games-drawer-artwork-stack">
                      <div className="games-drawer-hero">
                        <ResilientArtworkImage
                          alt=""
                          artworkKey={selectedInventoryApp.packageId}
                          className="games-drawer-hero-image"
                          fallbackClassName="games-drawer-image-placeholder fallback-art-surface"
                          label={selectedInventoryDisplayLabel}
                          src={selectedInventoryArtworkUri}
                          variant="hero"
                        />
                      </div>
                      <div className="games-drawer-title-row">
                        <div className="games-drawer-art">
                          <ResilientArtworkImage
                            alt=""
                            artworkKey={selectedInventoryApp.packageId}
                            className="games-drawer-art-image"
                            fallbackClassName="games-drawer-image-placeholder compact fallback-art-surface"
                            label={selectedInventoryDisplayLabel}
                            src={selectedInventoryArtworkUri}
                            variant="cover"
                          />
                        </div>
                        <div className="games-drawer-title-block">
                          <h3>{selectedInventoryDisplayLabel}</h3>
                          <p>
                            {selectedInventorySummary?.publisherName ??
                              selectedInventorySummary?.subtitle ??
                              selectedInventoryApp.packageId}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="games-drawer-facts">
                      <div className="signal-chip games-drawer-fact-wide">
                        <span>Package</span>
                        <strong>{selectedInventoryApp.packageId}</strong>
                      </div>
                      <div className={selectedInventoryApp.version ? 'signal-chip signal-chip-ready' : 'signal-chip'}>
                        <span>Installed Version</span>
                        <strong>{selectedInventoryApp.version ?? 'Unavailable'}</strong>
                      </div>
                      {selectedInventorySummary?.version ? (
                        <div className="signal-chip signal-chip-latest">
                          <span>Store Version</span>
                          <strong>{selectedInventorySummary.version}</strong>
                        </div>
                      ) : null}
                      <div className="signal-chip">
                        <span>Footprint</span>
                        <strong>{formatBytes(selectedInventoryApp.totalFootprintBytes)}</strong>
                      </div>
                      <div className="signal-chip signal-chip-ready games-drawer-fact-wide">
                        <span>Headset Status</span>
                        <strong>Installed on headset</strong>
                      </div>
                      {selectedInventorySummary?.category ? (
                        <div className="signal-chip games-drawer-fact-wide">
                          <span>Category</span>
                          <strong>{selectedInventorySummary.category}</strong>
                        </div>
                      ) : null}
                    </div>

                    <div className="games-drawer-meta-stack">
                      {selectedInventorySummary?.releaseDateLabel || selectedInventorySummary?.version ? (
                        <div className="games-drawer-meta">
                          {selectedInventorySummary.releaseDateLabel ? (
                            <span className="meta-chip">{selectedInventorySummary.releaseDateLabel}</span>
                          ) : null}
                          {selectedInventorySummary.version ? (
                            <span className="meta-chip">v{selectedInventorySummary.version}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {selectedInventorySummary?.genreNames.length ? (
                        <div className="games-drawer-meta">
                          {selectedInventorySummary.genreNames.map((genre) => (
                            <span className="meta-chip" key={genre}>
                              {genre}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="games-drawer-copy-stack">
                      <p className="section-copy compact">
                        {selectedInventorySummary
                          ? `Review this installed headset app, compare its currently installed version against the matched store metadata, then back it up or uninstall it if needed.`
                          : 'This installed app does not currently have a matched store metadata card, but you can still back it up or uninstall it from here.'}
                      </p>
                    </div>

                    <div className="inventory-drawer-actions">
                      {inventoryActionBusyPackageId === selectedInventoryApp.packageId ? (
                        <span className="status-pill status-pending inventory-operation-pill" title="Operation in progress. Open Live Queue to follow the detailed status.">
                          Operation In Progress
                        </span>
                      ) : (
                        <>
                          <button
                            className="action-pill action-pill-ghost"
                            disabled={deviceAppsBusy}
                            onClick={() => void onBackupInstalledApp(selectedInventoryApp.packageId)}
                            title="Back up this installed app to the configured local backup folder."
                            type="button"
                          >
                            Backup
                          </button>
                          <button
                            className="action-pill action-pill-danger"
                            disabled={deviceAppsBusy}
                            onClick={() => void onUninstallInstalledApp(selectedInventoryApp.packageId)}
                            title="Uninstall this app from the selected headset."
                            type="button"
                          >
                            Uninstall
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </aside>
            </>,
            drawerPortalTarget
          )
        : null}
    </section>
  )
}

const saveGamesFilters = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live Save Data' },
  { id: 'backed-up', label: 'Backed Up' },
  { id: 'backup-only', label: 'Backups Only' },
  { id: 'blocked', label: 'Blocked' }
] as const

type SaveGamesFilterId = (typeof saveGamesFilters)[number]['id']

type SaveGamesCard = {
  packageId: string
  title: string
  artworkUri: string | null
  isInstalled: boolean
  installedLabel: string | null
  liveStatus: 'available' | 'blocked' | 'none' | 'error' | null
  liveRoots: SaveDataRoot[]
  liveMessage: string | null
  backups: SaveBackupEntry[]
  latestBackup: SaveBackupEntry | null
  backupCount: number
  totalBackupBytes: number
  filterTags: SaveGamesFilterId[]
  searchTerms: string[]
}

function GameSavesView(props: {
  selectedDeviceId: string | null
  settings: AppSettings | null
  deviceAppsResponse: DeviceAppsResponse | null
  localLibraryIndex: LocalLibraryScanResponse | null
  backupStorageIndex: LocalLibraryScanResponse | null
  metaStoreMatchesByItemId: Record<string, MetaStoreGameSummary>
  installedMetaStoreMatchesByPackageId: Record<string, MetaStoreGameSummary>
  saveBackupsResponse: SaveBackupsResponse | null
  saveScanResponse: SavePackagesScanResponse | null
  saveGamesBusy: boolean
  saveGamesBatchBusy: boolean
  saveGamesActionBusyPackageId: string | null
  saveGamesRestoreBusyBackupId: string | null
  saveGamesDeleteBusyBackupId: string | null
  saveGamesMessage: UiNotice | null
  onRefreshSaveBackups: () => Promise<void>
  onScanSavePackages: () => Promise<void>
  onScanSavePackage: (packageId: string, appName: string | null) => Promise<void>
  onBackupAllSavePackages: () => Promise<void>
  onBackupSavePackage: (packageId: string, appName: string | null) => Promise<void>
  onRestoreSaveBackup: (packageId: string, backupId: string, appName: string | null) => Promise<void>
  onDeleteSaveBackup: (backupId: string) => Promise<void>
}) {
  const {
    selectedDeviceId,
    settings,
    deviceAppsResponse,
    localLibraryIndex,
    backupStorageIndex,
    metaStoreMatchesByItemId,
    installedMetaStoreMatchesByPackageId,
    saveBackupsResponse,
    saveScanResponse,
    saveGamesBusy,
    saveGamesBatchBusy,
    saveGamesActionBusyPackageId,
    saveGamesRestoreBusyBackupId,
    saveGamesDeleteBusyBackupId,
    saveGamesMessage,
    onRefreshSaveBackups,
    onScanSavePackages,
    onScanSavePackage,
    onBackupAllSavePackages,
    onBackupSavePackage,
    onRestoreSaveBackup,
    onDeleteSaveBackup
  } = props
  const [filter, setFilter] = useState<SaveGamesFilterId>('all')
  const [search, setSearch] = useState('')
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null)
  const packageSummaryByPackageId = buildPackageSummaryLookup(
    localLibraryIndex,
    backupStorageIndex,
    metaStoreMatchesByItemId,
    installedMetaStoreMatchesByPackageId
  )
  const installedAppsByPackageId = new Map((deviceAppsResponse?.apps ?? []).map((app) => [app.packageId.toLowerCase(), app]))
  const saveScanByPackageId = new Map((saveScanResponse?.results ?? []).map((result) => [result.packageId.toLowerCase(), result]))
  const backupsByPackageId = new Map<string, SaveBackupEntry[]>()

  for (const entry of saveBackupsResponse?.entries ?? []) {
    const key = entry.packageId.toLowerCase()
    const current = backupsByPackageId.get(key) ?? []
    current.push(entry)
    backupsByPackageId.set(key, current)
  }

  const packageIds = new Set<string>([
    ...Array.from(installedAppsByPackageId.keys()),
    ...Array.from(saveScanByPackageId.keys()),
    ...Array.from(backupsByPackageId.keys())
  ])

  const saveCards = Array.from(packageIds)
    .map((normalizedPackageId) => {
      const installedApp = installedAppsByPackageId.get(normalizedPackageId) ?? null
      const saveScan = saveScanByPackageId.get(normalizedPackageId) ?? null
      const backups = (backupsByPackageId.get(normalizedPackageId) ?? []).sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      )
      const latestBackup = backups[0] ?? null
      const summary = packageSummaryByPackageId.get(normalizedPackageId) ?? null
      const title =
        installedApp?.label ??
        latestBackup?.appName ??
        saveScan?.appName ??
        summary?.title ??
        installedApp?.inferredLabel ??
        normalizedPackageId
      const totalBackupBytes = backups.reduce((sum, entry) => sum + entry.sizeBytes, 0)
      const filterTags: SaveGamesFilterId[] = []
      const isInstalled = Boolean(installedApp)

      if (saveScan?.status === 'blocked') {
        filterTags.push('blocked')
      }

      if (saveScan?.status !== 'blocked') {
        filterTags.push('all')
      }

      if (saveScan?.status === 'available') {
        filterTags.push('live')
      }

      if (backups.length > 0) {
        filterTags.push('backed-up')
      }

      if (backups.length > 0 && !isInstalled) {
        filterTags.push('backup-only')
      }

      return {
        packageId: installedApp?.packageId ?? latestBackup?.packageId ?? saveScan?.packageId ?? normalizedPackageId,
        title,
        artworkUri: resolveMetaStoreArtworkUri(summary),
        isInstalled,
        installedLabel: installedApp?.label ?? installedApp?.inferredLabel ?? latestBackup?.appName ?? null,
        liveStatus: saveScan?.status ?? null,
        liveRoots: saveScan?.roots ?? [],
        liveMessage: saveScan?.message ?? null,
        backups,
        latestBackup,
        backupCount: backups.length,
        totalBackupBytes,
        filterTags,
        searchTerms: [title, installedApp?.packageId, latestBackup?.appName, summary?.publisherName].filter(Boolean) as string[]
      } satisfies SaveGamesCard
    })
    .sort((left, right) => {
      if (left.isInstalled !== right.isInstalled) {
        return left.isInstalled ? -1 : 1
      }

      if (left.backupCount !== right.backupCount) {
        return right.backupCount - left.backupCount
      }

      const leftLatest = left.latestBackup ? new Date(left.latestBackup.createdAt).getTime() : 0
      const rightLatest = right.latestBackup ? new Date(right.latestBackup.createdAt).getTime() : 0
      if (leftLatest !== rightLatest) {
        return rightLatest - leftLatest
      }

      return left.title.localeCompare(right.title)
    })

  const filteredCards = saveCards.filter((card) => {
    if (!card.filterTags.includes(filter)) {
      return false
    }

    return matchesSearchText([card.packageId, ...card.searchTerms], search)
  })

  const selectedCard =
    filteredCards.find((card) => card.packageId === selectedPackageId) ??
    saveCards.find((card) => card.packageId === selectedPackageId) ??
    null
  const selectedCardRootsBytes = selectedCard?.liveRoots.reduce((sum, root) => sum + root.sizeBytes, 0) ?? 0
  const drawerPortalTarget = typeof document !== 'undefined' ? document.body : null
  const saveGamesEmptyState =
    filter === 'blocked'
      ? {
          title: 'No blocked save entries were found.',
          body: saveScanResponse
            ? 'Scan the headset again after opening a title once if you want to re-check for Android/data folders that exist but ADB cannot read.'
            : 'Scan the headset to detect titles whose save data exists but Android permissions block ADB access.'
        }
      : {
          title: 'No save entries match this view yet.',
          body: 'Scan the headset for live save data or refresh snapshots from the configured Game Saves folder.'
        }

  useEffect(() => {
    if (selectedCard) {
      return
    }

    setSelectedPackageId(null)
  }, [selectedCard])

  async function scanSelectedSavePackage() {
    if (!selectedCard) {
      return
    }

    setSelectedPackageId(null)
    await onScanSavePackage(selectedCard.packageId, selectedCard.installedLabel)
  }

  async function backupSelectedSavePackage() {
    if (!selectedCard) {
      return
    }

    setSelectedPackageId(null)
    await onBackupSavePackage(selectedCard.packageId, selectedCard.installedLabel)
  }

  return (
    <section className="view-stack">
      <section className="surface-panel games-controls-panel">
        <div className="games-search-shell">
          <input
            aria-label="Search save snapshots"
            className="search-shell games-search-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, package ID, or saved state"
            type="text"
            value={search}
          />
          {search ? (
            <button
              aria-label="Clear save search"
              className="status-pill status-pill-button games-search-clear"
              onClick={() => setSearch('')}
              type="button"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="games-filter-toolbar save-games-filter-toolbar">
          <div className="filter-row">
            {saveGamesFilters.map((entry) => (
              <button
                aria-pressed={filter === entry.id}
                className={filter === entry.id ? 'filter-chip filter-chip-button active' : 'filter-chip filter-chip-button'}
                key={entry.id}
                onClick={() => setFilter(entry.id)}
                title={
                  entry.id === 'all'
                    ? 'Show every title tracked by Game Saves'
                    : entry.id === 'live'
                        ? 'Show titles where live save data is currently present on the headset'
                        : entry.id === 'backed-up'
                          ? 'Show titles that already have one or more save snapshots in the Game Saves folder'
                          : entry.id === 'backup-only'
                            ? 'Show titles that are not installed but still have retained save snapshots'
                            : 'Show titles where save data exists on the headset but Android permissions blocked ADB access'
                }
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="games-filter-actions">
            <button
              className="filter-chip filter-chip-button"
              disabled={saveGamesBusy || saveGamesBatchBusy || !settings?.gameSavesPath}
              onClick={() => void onRefreshSaveBackups()}
              title="Refresh the local list of saved snapshots from the configured Game Saves folder"
              type="button"
            >
              Refresh snapshots
            </button>
            <button
              className={saveGamesBatchBusy ? 'filter-chip filter-chip-button active' : 'filter-chip filter-chip-button'}
              disabled={saveGamesBusy || saveGamesBatchBusy || !selectedDeviceId || !settings?.gameSavesPath}
              onClick={() => void onBackupAllSavePackages()}
              title="Back up every installed title that currently has live save data on the selected headset, one game at a time."
              type="button"
            >
              {saveGamesBatchBusy ? 'Backing up all saves...' : 'Back up all saves'}
            </button>
            <button
              className={saveGamesBusy ? 'filter-chip filter-chip-button active' : 'filter-chip filter-chip-button'}
              disabled={saveGamesBusy || saveGamesBatchBusy || !selectedDeviceId}
              onClick={() => void onScanSavePackages()}
              title="Scan the selected headset for live save data that can be backed up"
              type="button"
            >
              {saveGamesBusy ? 'Scanning saves...' : 'Scan headset saves'}
            </button>
          </div>
        </div>
      </section>

      {saveGamesMessage ? <NoticeBanner className="apps-banner" notice={saveGamesMessage} /> : null}

      <section className="surface-panel games-workspace-shell">
        <p className="eyebrow games-workspace-eyebrow">Saved States</p>
        <p className="games-workspace-copy">
          <span>Browse the save snapshots already stored in Game Saves, then decide what to</span>
          <span>restore, back up, review, or clean up.</span>
        </p>
        <section className="games-gallery-surface">
          {filteredCards.length ? (
            <div className="save-games-gallery-scroll inventory-gallery-scroll">
              {filteredCards.map((card) => (
                <article
                  className={selectedPackageId === card.packageId ? 'inventory-gallery-card active save-games-gallery-card' : 'inventory-gallery-card save-games-gallery-card'}
                  key={card.packageId}
                  onClick={() => setSelectedPackageId(card.packageId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedPackageId(card.packageId)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="inventory-gallery-hero-shell">
                    <div className="game-gallery-title-banner">
                      <strong>{card.title}</strong>
                    </div>
                    <ResilientArtworkImage
                      alt=""
                      artworkKey={card.packageId}
                      className="inventory-gallery-hero-image"
                      fallbackClassName="inventory-gallery-hero-placeholder fallback-art-surface"
                      label={card.title}
                      src={card.artworkUri}
                      variant="gallery"
                    />
                    <div className="inventory-gallery-overlay save-games-gallery-overlay">
                      <span className="game-gallery-size save-games-gallery-meta">
                        {card.backupCount > 0 ? `${card.backupCount} ${card.backupCount === 1 ? 'Backup' : 'Backups'}` : 'No Backups'}
                      </span>
                      {card.liveStatus === 'blocked' ? (
                        <span className="status-pill status-danger game-gallery-state save-games-gallery-state save-games-gallery-status-pill is-blocked">
                          Blocked
                        </span>
                      ) : card.isInstalled ? (
                        <span className="status-pill status-ready game-action-indicator game-gallery-state save-games-gallery-state">
                          <span aria-hidden="true" className="game-action-indicator-check" />
                          <span>Installed</span>
                        </span>
                      ) : card.backupCount > 0 ? (
                        <span className="action-pill game-gallery-state save-games-gallery-state save-games-gallery-status-pill is-backup-only">
                          Backups Only
                        </span>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="save-games-empty-shell">
              <div className="empty-state games-empty-state save-games-empty-state">
                <strong>{saveGamesEmptyState.title}</strong>
                <p>{saveGamesEmptyState.body}</p>
              </div>
            </div>
          )}
        </section>
      </section>

      {drawerPortalTarget
        ? createPortal(
            <>
      <div className={selectedCard ? 'games-drawer-backdrop visible' : 'games-drawer-backdrop'} onClick={() => setSelectedPackageId(null)} />
      <aside className={selectedCard ? 'surface-panel detail-panel games-drawer open save-games-drawer' : 'surface-panel detail-panel games-drawer save-games-drawer'}>
        <div className="games-drawer-header">
          <p className="eyebrow">Details</p>
          <button className="close-pill" onClick={() => setSelectedPackageId(null)} type="button">
            Close
          </button>
        </div>
        {selectedCard ? (
          <>
            <div className="games-drawer-artwork-stack">
              <div className="games-drawer-hero">
                <ResilientArtworkImage
                  alt=""
                  artworkKey={selectedCard.packageId}
                  className="games-drawer-hero-image"
                  fallbackClassName="games-drawer-image-placeholder fallback-art-surface"
                  label={selectedCard.title}
                  src={selectedCard.artworkUri}
                  variant="hero"
                />
              </div>
              <div className="games-drawer-title-row">
                <div className="games-drawer-art">
                  <ResilientArtworkImage
                    alt=""
                    artworkKey={selectedCard.packageId}
                    className="games-drawer-art-image"
                    fallbackClassName="games-drawer-image-placeholder compact fallback-art-surface"
                    label={selectedCard.title}
                    src={selectedCard.artworkUri}
                    variant="cover"
                  />
                </div>
                <div className="games-drawer-title-block">
                  <h3>{selectedCard.title}</h3>
                  <p className="save-games-package-line">{renderBreakablePackageId(selectedCard.packageId)}</p>
                </div>
              </div>
            </div>

            <div className="games-drawer-facts">
              <div className="signal-chip games-drawer-fact-wide">
                <span>Package</span>
                <strong className="save-games-package-value">{renderBreakablePackageId(selectedCard.packageId)}</strong>
              </div>
              <div className={selectedCard.isInstalled ? 'signal-chip signal-chip-ready' : 'signal-chip'}>
                <span>Headset Status</span>
                <strong>{selectedCard.isInstalled ? 'Installed' : 'Not installed'}</strong>
              </div>
              <div
                className={
                  selectedCard.liveStatus === 'available'
                    ? 'signal-chip signal-chip-ready'
                    : selectedCard.liveStatus === 'blocked'
                      ? 'signal-chip signal-chip-danger'
                    : selectedCard.liveStatus === 'error'
                      ? 'signal-chip signal-chip-danger'
                      : 'signal-chip'
                }
              >
                <span>Live Save Data</span>
                <strong>
                  {selectedCard.liveStatus === 'available'
                    ? 'Found'
                    : selectedCard.liveStatus === 'blocked'
                      ? 'Blocked'
                    : selectedCard.liveStatus === 'error'
                      ? 'Scan error'
                      : 'None found'}
                </strong>
              </div>
              <div className="signal-chip">
                <span>Backups</span>
                <strong>{selectedCard.backupCount}</strong>
              </div>
              <div className="signal-chip">
                <span>Backup Footprint</span>
                <strong>{formatBytes(selectedCard.totalBackupBytes || null)}</strong>
              </div>
              <div className="signal-chip">
                <span>Live Footprint</span>
                <strong>{formatBytes(selectedCardRootsBytes || null)}</strong>
              </div>
            </div>

            {selectedCard.liveMessage ? <p className="section-copy compact">{selectedCard.liveMessage}</p> : null}

            <div className="stack-sm">
              <button
                className="action-pill action-pill-ghost"
                disabled={saveGamesBusy || saveGamesBatchBusy || !selectedDeviceId}
                onClick={() => void scanSelectedSavePackage()}
                type="button"
              >
                {saveGamesBusy ? 'Scanning saves…' : 'Scan headset saves'}
              </button>
              <button
                className="action-pill"
                disabled={
                  !selectedCard.isInstalled ||
                  selectedCard.liveStatus !== 'available' ||
                  saveGamesBatchBusy ||
                  saveGamesActionBusyPackageId === selectedCard.packageId
                }
                onClick={() => void backupSelectedSavePackage()}
                type="button"
              >
                {saveGamesActionBusyPackageId === selectedCard.packageId ? 'Backing up saves…' : 'Back Up Current Save'}
              </button>
            </div>

            <section className="save-snapshot-list">
              <div className="section-heading save-snapshot-heading">
                <div>
                  <p className="eyebrow">Snapshots</p>
                  <h3>Saved States</h3>
                </div>
              </div>
              {selectedCard.backups.length ? (
                <div className="save-snapshot-stack">
                  {selectedCard.backups.map((entry) => (
                    <article className="save-snapshot-card" key={entry.id}>
                      <div className="save-snapshot-card-copy">
                        <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                        <p>{formatBytes(entry.sizeBytes)}</p>
                      </div>
                      <div className="save-snapshot-card-actions">
                        <button
                          className="action-pill action-pill-ghost"
                          disabled={!selectedDeviceId || !selectedCard.isInstalled || saveGamesRestoreBusyBackupId === entry.id}
                          onClick={() => void onRestoreSaveBackup(selectedCard.packageId, entry.id, selectedCard.installedLabel)}
                          type="button"
                        >
                          {saveGamesRestoreBusyBackupId === entry.id ? 'Restoring…' : 'Restore'}
                        </button>
                        <button
                          className="action-pill action-pill-danger action-pill-hazard action-pill-hazard-white"
                          disabled={saveGamesDeleteBusyBackupId === entry.id}
                          onClick={() => void onDeleteSaveBackup(entry.id)}
                          type="button"
                        >
                          {saveGamesDeleteBusyBackupId === entry.id ? 'Deleting…' : 'Delete Snapshot'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>No save snapshots yet.</strong>
                  <p>Back up the current headset save data for this title to create the first snapshot.</p>
                </div>
              )}
            </section>
            {!selectedCard.isInstalled && selectedCard.backups.length ? (
              <p className="section-copy compact">Install this title on the selected headset before restoring a saved state back to it.</p>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <strong>Select a title to manage its save states.</strong>
            <p>This view keeps installed titles, backed-up save states, and backup-only save history in one place.</p>
          </div>
        )}
      </aside>
            </>,
            drawerPortalTarget
          )
        : null}
    </section>
  )
}

function SettingsView(props: {
  settings: AppSettings | null
  settingsBusy: boolean
  libraryRescanBusy: boolean
  settingsMessage: string | null
  dependencyIndicatorTone: 'ready' | 'warning' | 'error'
  localLibraryIndex: LocalLibraryScanResponse | null
  backupStorageIndex: LocalLibraryScanResponse | null
  gameSavesPathStats: SettingsPathStatsResponse | null
  deviceAppsResponse: DeviceAppsResponse | null
  selectedDeviceId: string | null
  deviceLeftoverResponse: DeviceLeftoverScanResponse | null
  deviceLeftoverBusy: boolean
  deviceLeftoverBusyItemId: string | null
  deviceLeftoverMessage: string | null
  onOpenManagedDependencies: () => void
  onOpenLibraryDiagnostics: (filter?: 'all' | 'installReady' | 'missing') => void
  onOpenOrphanedDataDiscovery: () => void
  onChooseSettingsPath: (key: SettingsPathKey) => Promise<void>
  onClearSettingsPath: (key: SettingsPathKey) => Promise<void>
  onRescanLocalLibrary: () => Promise<void>
  onRefreshLeftoverData: (serial: string) => Promise<void>
  onDeleteLeftoverData: (itemId: string) => Promise<void>
}) {
  const {
    settings,
    settingsBusy,
    libraryRescanBusy,
    settingsMessage,
    dependencyIndicatorTone,
    localLibraryIndex,
    backupStorageIndex,
    gameSavesPathStats,
    deviceAppsResponse,
    selectedDeviceId,
    deviceLeftoverResponse,
    deviceLeftoverBusy,
    deviceLeftoverBusyItemId,
    deviceLeftoverMessage,
    onOpenManagedDependencies,
    onOpenLibraryDiagnostics,
    onOpenOrphanedDataDiscovery,
    onChooseSettingsPath,
    onClearSettingsPath,
    onRescanLocalLibrary,
    onRefreshLeftoverData,
    onDeleteLeftoverData
  } = props
  const installedAppHistory =
    selectedDeviceId && deviceAppsResponse?.serial === selectedDeviceId ? deviceAppsResponse.history : null
  const installedAppHistoryDays = (installedAppHistory?.days ?? []).slice(-7)
  const maxHistoryValue = installedAppHistoryDays.reduce(
    (highest, day) => Math.max(highest, day.appCount, day.removedCount),
    1
  )
  const historyScaleMax = Math.max(1, Math.ceil(maxHistoryValue * 1.08))
  const settingsHistoryChartWidth = 320
  const settingsHistoryChartHeight = 72
  const settingsHistoryChartPaddingX = 14
  const settingsHistoryChartPaddingTop = 8
  const settingsHistoryChartPaddingBottom = 16
  const settingsHistoryPlotWidth = settingsHistoryChartWidth - settingsHistoryChartPaddingX * 2
  const settingsHistoryPlotHeight =
    settingsHistoryChartHeight - settingsHistoryChartPaddingTop - settingsHistoryChartPaddingBottom
  const settingsHistoryStepX =
    installedAppHistoryDays.length > 1 ? settingsHistoryPlotWidth / (installedAppHistoryDays.length - 1) : 0
  const settingsHistoryPoints = installedAppHistoryDays.map((day, index) => {
    const x = settingsHistoryChartPaddingX + settingsHistoryStepX * index
    const presentY =
      settingsHistoryChartPaddingTop +
      settingsHistoryPlotHeight -
      (day.appCount / historyScaleMax) * settingsHistoryPlotHeight
    const removedY =
      settingsHistoryChartPaddingTop +
      settingsHistoryPlotHeight -
      (day.removedCount / historyScaleMax) * settingsHistoryPlotHeight

    const scannedAtDate = new Date(day.scannedAt)
    const allScansSameDate = installedAppHistoryDays.every((entry) => entry.date === day.date)
    const label = allScansSameDate
      ? scannedAtDate.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        })
      : scannedAtDate.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        })

    return {
      day,
      x,
      presentY,
      removedY,
      label,
      scannedAtLabel: scannedAtDate.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  })
  const settingsHistoryAddedLine = settingsHistoryPoints.map((point) => `${point.x},${point.presentY}`).join(' ')
  const settingsHistoryRemovedLine = settingsHistoryPoints.map((point) => `${point.x},${point.removedY}`).join(' ')

  const settingsStats = [
    {
      label: 'Library Size',
      value: formatBytes(localLibraryIndex?.totalBytes ?? null),
      note: `${localLibraryIndex?.itemCount ?? 0} entries`
    },
    {
      label: 'Index Entries',
      value: String(localLibraryIndex?.itemCount ?? 0),
      note: `${localLibraryIndex?.items.filter((item) => item.availability === 'present' && item.installReady).length ?? 0} ready`
    },
    {
      label: 'Missing',
      value: String(localLibraryIndex?.missingCount ?? 0),
      note: 'Need review'
    },
    {
      label: 'Backups',
      value: formatBytes(backupStorageIndex?.totalBytes ?? null),
      note: `${backupStorageIndex?.itemCount ?? 0} items`
    },
    {
      label: 'Save Games',
      value: formatBytes(gameSavesPathStats?.totalBytes ?? null),
      note: `${gameSavesPathStats?.itemCount ?? 0} items`
    }
  ]

  return (
    <section className="view-stack">
      <section className="settings-stats-grid">
        {settingsStats.map((stat, index) => {
          const isMissingStat = stat.label === 'Missing'

          if (isMissingStat) {
            return (
              <button
                className={index === 0 ? 'settings-stat-card settings-stat-card-button emphasized' : 'settings-stat-card settings-stat-card-button'}
                key={stat.label}
                onClick={() => onOpenLibraryDiagnostics('missing')}
                title="Open Library Diagnostics filtered to missing entries"
                type="button"
              >
                <div className="settings-stat-card-top">
                  <span>{stat.label}</span>
                  <p>{stat.note}</p>
                </div>
                <strong>{stat.value}</strong>
              </button>
            )
          }

          return (
            <article className={index === 0 ? 'settings-stat-card emphasized' : 'settings-stat-card'} key={stat.label}>
              <div className="settings-stat-card-top">
                <span>{stat.label}</span>
                <p>{stat.note}</p>
              </div>
              <strong>{stat.value}</strong>
            </article>
          )
        })}
      </section>

      <section className="surface-panel">
        <div className="section-heading settings-section-heading">
          <p className="eyebrow">Library &amp; Storage Paths</p>
        </div>

        <p className="section-copy settings-section-copy">
          Choose where archive content, backups, and save data should live.
        </p>

        {settingsMessage ? <div className="runtime-banner settings-banner">{settingsMessage}</div> : null}

        <div className="settings-path-grid">
          {settingsPathFields.map((field) => {
            const value = settings?.[field.key] ?? null

            return (
              <article className="settings-path-card" key={field.key}>
                <div className="settings-path-top">
                  <div className="settings-path-heading">
                    <span className={`settings-path-icon-pill settings-path-icon-pill-${field.tone}`} aria-hidden="true">
                      <span className={`settings-path-icon settings-path-icon-${field.icon}`} />
                    </span>
                    <span className="settings-path-label" title={field.description}>
                      {field.title}
                    </span>
                  </div>

                  {value ? (
                    <code className="inline-code settings-path-code settings-path-code-inline">{value}</code>
                  ) : (
                    <div className="settings-path-empty settings-path-empty-inline">No folder selected yet.</div>
                  )}

                  <div className="settings-path-actions">
                    <button
                      className="action-pill action-pill-ghost"
                      disabled={settingsBusy}
                      onClick={() => void onChooseSettingsPath(field.key)}
                    >
                      {settingsBusy ? 'Opening…' : value ? 'Change Folder' : 'Choose Folder'}
                    </button>
                    <button
                      className="action-pill action-pill-ghost action-pill-destructive"
                      disabled={settingsBusy || !value}
                      onClick={() => void onClearSettingsPath(field.key)}
                    >
                      Clear
                    </button>
                    {field.key === 'localLibraryPath' ? (
                      <button
                        className="action-pill action-pill-ghost settings-path-action-end"
                        disabled={libraryRescanBusy || !value}
                        onClick={() => void onRescanLocalLibrary()}
                      >
                        {libraryRescanBusy ? 'Rescanning…' : 'Re-Scan Library'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="surface-panel settings-maintenance-panel">
        <div className="section-heading settings-maintenance-heading">
          <div>
            <p className="eyebrow">Maintenance</p>
          </div>
        </div>

        <div className="settings-maintenance-toolbar">
          <div className="settings-maintenance-content">
            <p className="section-copy settings-section-copy settings-maintenance-copy">
              Open runtime tooling, inspect library diagnostics, review orphaned data left
              <br />
              on the headset, and compare apps present versus removed across recent scans.
            </p>

            <div className="settings-maintenance-actions">
              <button
                className="status-pill status-pill-button"
                onClick={onOpenManagedDependencies}
                title="Open Managed Dependencies to review ADB and 7-Zip runtime readiness"
                type="button"
              >
                <span className={`settings-maintenance-indicator is-${dependencyIndicatorTone}`} aria-hidden="true" />
                <span>Managed Dependencies</span>
              </button>
              <button className="status-pill status-pill-button" onClick={() => onOpenLibraryDiagnostics('all')} type="button">
                Library Diagnostics
              </button>
              <button
                className="status-pill status-pill-button"
                onClick={onOpenOrphanedDataDiscovery}
                title="Open Orphaned Data Discovery to scan and remove leftover Android/obb and Android/data folders from the selected headset"
                type="button"
              >
                Orphaned Data Discovery
              </button>
            </div>
          </div>
          <div className="settings-maintenance-history">
            <div className="settings-maintenance-history-heading">
              <strong>Headset App Scan History</strong>
              <span>Last 7 scans</span>
            </div>
            {selectedDeviceId ? (
              installedAppHistoryDays.length ? (
                <div className="settings-maintenance-history-chart">
                  <div
                    className="settings-maintenance-history-plot"
                    role="img"
                    aria-label="Apps present on the headset versus removed from the headset over the last 7 scans"
                  >
                    <svg
                      className="settings-maintenance-history-svg"
                      viewBox={`0 0 ${settingsHistoryChartWidth} ${settingsHistoryChartHeight}`}
                      preserveAspectRatio="none"
                    >
                      {[0.25, 0.5, 0.75].map((ratio) => (
                        <line
                          key={ratio}
                          className="settings-maintenance-history-gridline"
                          x1={settingsHistoryChartPaddingX}
                          x2={settingsHistoryChartWidth - settingsHistoryChartPaddingX}
                          y1={settingsHistoryChartPaddingTop + settingsHistoryPlotHeight * ratio}
                          y2={settingsHistoryChartPaddingTop + settingsHistoryPlotHeight * ratio}
                        />
                      ))}
                      {settingsHistoryPoints.length > 1 ? (
                        <>
                          <polyline className="settings-maintenance-history-line is-added" points={settingsHistoryAddedLine} />
                          <polyline className="settings-maintenance-history-line is-removed" points={settingsHistoryRemovedLine} />
                        </>
                      ) : null}
                      {settingsHistoryPoints.map((point) => (
                        <g key={point.day.scannedAt}>
                          <circle className="settings-maintenance-history-hit" cx={point.x} cy={point.presentY} r="9">
                            <title>{`${point.scannedAtLabel}: ${point.day.appCount}`}</title>
                          </circle>
                          <circle className="settings-maintenance-history-dot is-added" cx={point.x} cy={point.presentY} r="3" />
                          <circle className="settings-maintenance-history-hit" cx={point.x} cy={point.removedY} r="9" />
                          <circle className="settings-maintenance-history-dot is-removed" cx={point.x} cy={point.removedY} r="3" />
                        </g>
                      ))}
                    </svg>
                    <div className="settings-maintenance-history-axis">
                      {settingsHistoryPoints.map((point) => (
                        <div className="settings-maintenance-history-axis-label" key={point.day.date}>
                          {point.label}
                        </div>
                      ))}
                    </div>
                    <div
                      className="settings-maintenance-history-hover-grid"
                      style={{
                        gridTemplateColumns: `repeat(${settingsHistoryPoints.length}, minmax(0, 1fr))`
                      }}
                    >
                      {settingsHistoryPoints.map((point) => (
                        <div
                          className="settings-maintenance-history-hover-band"
                          key={`hover-${point.day.scannedAt}`}
                          title={`${point.scannedAtLabel}: ${point.day.appCount}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="settings-maintenance-history-legend">
                    <span className="settings-maintenance-history-legend-item">
                      <span className="settings-maintenance-history-legend-swatch is-added" aria-hidden="true" />
                      Present on headset
                    </span>
                    <span className="settings-maintenance-history-legend-item">
                      <span className="settings-maintenance-history-legend-swatch is-removed" aria-hidden="true" />
                      Removed from headset
                    </span>
                  </div>
                </div>
              ) : (
                <div className="empty-state inventory-history-empty-state settings-maintenance-history-empty-state">
                  <strong>No installed-app history yet.</strong>
                  <p>Refresh installed apps to begin tracking added and removed titles across recent scans.</p>
                </div>
              )
            ) : (
              <div className="empty-state inventory-history-empty-state settings-maintenance-history-empty-state">
                <strong>No device selected.</strong>
                <p>Select a connected headset in Manager to load installed-app history.</p>
              </div>
            )}
          </div>
        </div>
      </section>

    </section>
  )
}

function OrphanedDataContent(props: {
  selectedDeviceId: string | null
  deviceLeftoverResponse: DeviceLeftoverScanResponse | null
  deviceLeftoverBusy: boolean
  deviceLeftoverBusyItemId: string | null
  deviceLeftoverMessage: string | null
  onRefreshLeftoverData: (serial: string) => Promise<void>
  onDeleteLeftoverData: (itemId: string) => Promise<void>
}) {
  const {
    selectedDeviceId,
    deviceLeftoverResponse,
    deviceLeftoverBusy,
    deviceLeftoverBusyItemId,
    deviceLeftoverMessage,
    onRefreshLeftoverData,
    onDeleteLeftoverData
  } = props

  return (
    <>
      <div className="section-heading orphaned-data-toolbar">
        <div />
        <button
          className="status-pill status-pill-button"
          disabled={deviceLeftoverBusy || !selectedDeviceId}
          onClick={() => {
            if (selectedDeviceId) {
              void onRefreshLeftoverData(selectedDeviceId)
            }
          }}
          type="button"
        >
          {deviceLeftoverBusy ? 'Scanning...' : 'Scan leftovers'}
        </button>
      </div>

      {!selectedDeviceId ? (
        <div className="empty-state">
          <strong>Select a headset first.</strong>
          <p>Choose a ready device in ADB Manager to scan `/sdcard/Android/obb` and `/sdcard/Android/data` for leftover folders.</p>
        </div>
      ) : deviceLeftoverResponse?.items.length ? (
        <div className="leftover-grid">
          {deviceLeftoverResponse.items.map((item) => (
            <article className="leftover-card" key={item.id}>
              <div className="leftover-card-top">
                <div className="row-title">
                  <strong>{item.packageId}</strong>
                  <p>{item.absolutePath}</p>
                  {item.deleteBlockedReason ? <p className="leftover-card-note">{item.deleteBlockedReason}</p> : null}
                </div>
                <div className="inline-actions">
                  <span className="meta-chip">{item.location.toUpperCase()}</span>
                  <span className="meta-chip">{formatBytes(item.sizeBytes)}</span>
                  {item.deleteBlocked ? <span className="meta-chip leftover-protected-chip">Protected</span> : null}
                  <button
                    className="action-pill action-pill-danger"
                    disabled={item.deleteBlocked || deviceLeftoverBusyItemId === item.id}
                    onClick={() => void onDeleteLeftoverData(item.id)}
                    title={
                      item.deleteBlocked
                        ? 'Quest is blocking deletion of this leftover path through standard ADB.'
                        : 'Delete this orphaned Android/data or Android/obb entry from the headset.'
                    }
                  >
                    {item.deleteBlocked ? 'Protected' : deviceLeftoverBusyItemId === item.id ? 'Deleting...' : 'Delete leftover'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <strong>No leftover app data found.</strong>
          <p>
            {deviceLeftoverMessage ?? 'No orphaned Android/data or Android/obb folders were found for apps that are no longer installed.'}
          </p>
        </div>
      )}
    </>
  )
}

function ManagedDependenciesContent(props: { dependencyStatus: DependencyStatusResponse | null }) {
  const { dependencyStatus } = props

  return (
    <>
      <p className="section-copy settings-section-copy settings-section-copy-nowrap">
        QuestVault prepares the required runtime tools here so ADB and vrSrc features can work across platforms.
      </p>

      <div className="settings-dependency-grid">
        {(dependencyStatus?.statuses ?? []).map((status) => (
          <article className="settings-dependency-card" key={status.id}>
            <div className="settings-dependency-top">
              <strong>{status.title}</strong>
              <span className="settings-dependency-status">
                <span
                  aria-hidden="true"
                  className={
                    status.status === 'ready'
                      ? 'settings-dependency-indicator is-ready'
                      : 'settings-dependency-indicator is-error'
                  }
                />
                <span>{status.status === 'ready' ? 'Ready' : 'Unavailable'}</span>
              </span>
            </div>
            <p>
              Source: <strong>{status.source === 'managed' ? 'Managed' : status.source === 'system' ? 'System' : 'Missing'}</strong>
            </p>
            <p title={status.path ?? 'No path available'}>{status.path ?? 'No binary path available yet.'}</p>
            <p>{status.message}</p>
          </article>
        ))}
        {!dependencyStatus?.statuses.length ? (
          <div className="empty-state">
            <strong>Dependency status is not loaded yet.</strong>
            <p>Restart the app or wait for startup bootstrap to complete to inspect managed runtime readiness here.</p>
          </div>
        ) : null}
      </div>
    </>
  )
}

function ManagedDependenciesDialog(props: {
  isOpen: boolean
  onClose: () => void
  dependencyStatus: DependencyStatusResponse | null
}) {
  const { isOpen, onClose, dependencyStatus } = props

  if (!isOpen) {
    return null
  }

  return (
    <>
      <div className="library-scan-backdrop" onClick={onClose} />
      <section className="library-support-dialog surface-panel" role="dialog" aria-modal="true" aria-label="Managed dependencies">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Managed Dependencies</p>
            <h2>Runtime Tooling</h2>
          </div>
          <button className="close-pill" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <ManagedDependenciesContent dependencyStatus={dependencyStatus} />
      </section>
    </>
  )
}

function OrphanedDataDialog(props: {
  isOpen: boolean
  onClose: () => void
  selectedDeviceId: string | null
  deviceLeftoverResponse: DeviceLeftoverScanResponse | null
  deviceLeftoverBusy: boolean
  deviceLeftoverBusyItemId: string | null
  deviceLeftoverMessage: string | null
  onRefreshLeftoverData: (serial: string) => Promise<void>
  onDeleteLeftoverData: (itemId: string) => Promise<void>
}) {
  const { isOpen, onClose, ...orphanedDataProps } = props

  if (!isOpen) {
    return null
  }

  return (
    <>
      <div className="library-scan-backdrop" onClick={onClose} />
      <section className="library-support-dialog surface-panel" role="dialog" aria-modal="true" aria-label="Orphaned data">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Support</p>
            <h2>Orphaned OBB / Data</h2>
            <p className="section-copy compact settings-section-copy-nowrap">
              Scan Android/obb and Android/data for leftover folders from apps that are no longer installed.
            </p>
          </div>
          <button className="close-pill" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <OrphanedDataContent {...orphanedDataProps} />
      </section>
    </>
  )
}

function LibraryDiagnosticsDialog(props: {
  isOpen: boolean
  onClose: () => void
  initialFilter?: 'all' | 'installReady' | 'missing'
  settings: AppSettings | null
  localLibraryIndex: LocalLibraryScanResponse | null
  libraryRescanBusy: boolean
  manualInstallBusyKind: 'apk' | 'folder' | null
  libraryMessage: UiNotice | null
  removeMissingLibraryItemBusyId: string | null
  purgeLibraryItemBusyId: string | null
  onChooseSettingsPath: (key: SettingsPathKey) => Promise<void>
  onRescanLocalLibrary: () => Promise<void>
  onInstallManualLibrarySource: (kind: 'apk' | 'folder') => Promise<void>
  onRemoveMissingLibraryItem: (itemId: string) => Promise<void>
  onPurgeLibraryItem: (itemId: string) => Promise<void>
}) {
  const { isOpen, onClose, initialFilter, ...libraryProps } = props

  if (!isOpen) {
    return null
  }

  return (
    <>
      <div className="library-scan-backdrop" onClick={onClose} />
      <section className="library-support-dialog surface-panel" role="dialog" aria-modal="true" aria-label="Library diagnostics">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Support</p>
            <h2>Library Diagnostics</h2>
            <p className="section-copy compact">The raw index view still lives here, together with remove and purge actions.</p>
          </div>
          <button className="close-pill" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <LibraryView {...libraryProps} initialFilter={initialFilter} />
      </section>
    </>
  )
}

function LibraryView(props: {
  initialFilter?: 'all' | 'installReady' | 'missing'
  settings: AppSettings | null
  localLibraryIndex: LocalLibraryScanResponse | null
  libraryRescanBusy: boolean
  manualInstallBusyKind: 'apk' | 'folder' | null
  libraryMessage: UiNotice | null
  removeMissingLibraryItemBusyId: string | null
  purgeLibraryItemBusyId: string | null
  onChooseSettingsPath: (key: SettingsPathKey) => Promise<void>
  onRescanLocalLibrary: () => Promise<void>
  onInstallManualLibrarySource: (kind: 'apk' | 'folder') => Promise<void>
  onRemoveMissingLibraryItem: (itemId: string) => Promise<void>
  onPurgeLibraryItem: (itemId: string) => Promise<void>
}) {
  const {
    initialFilter = 'all',
    settings,
    localLibraryIndex,
    libraryRescanBusy,
    manualInstallBusyKind,
    libraryMessage,
    removeMissingLibraryItemBusyId,
    purgeLibraryItemBusyId,
    onChooseSettingsPath,
    onRescanLocalLibrary,
    onInstallManualLibrarySource,
    onRemoveMissingLibraryItem,
    onPurgeLibraryItem
  } = props
  const hasLibraryPath = Boolean(settings?.localLibraryPath)
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'installReady' | 'missing'>(initialFilter)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryResultsMaxHeight, setLibraryResultsMaxHeight] = useState<number | null>(null)
  const libraryResultsScrollRef = useRef<HTMLDivElement | null>(null)
  const items = localLibraryIndex?.items ?? []
  const indexedCount = items.length
  const currentItems = items.filter((item) => item.availability === 'present')
  const installReadyCount = currentItems.filter((item) => item.installReady).length
  const archiveCount = currentItems.filter((item) => item.kind === 'archive').length
  const missingCount = localLibraryIndex?.missingCount ?? 0
  const filteredItems = items.filter((item) => {
    if (libraryFilter === 'installReady') {
      if (!(item.availability === 'present' && item.installReady)) {
        return false
      }
    } else if (libraryFilter === 'missing') {
      if (item.availability !== 'missing') {
        return false
      }
    }

    return matchesSearchText([item.name, item.relativePath, item.note, ...(item.searchTerms ?? [])], librarySearch)
  })
  useEffect(() => {
    setLibraryFilter(initialFilter)
  }, [initialFilter])
  useEffect(() => {
    const updateMaxHeight = () => {
      const element = libraryResultsScrollRef.current

      if (!element) {
        setLibraryResultsMaxHeight(null)
        return
      }

      const viewportBottomInset = 10
      const rowElements = Array.from(element.children).slice(0, 5) as HTMLElement[]
      const styles = window.getComputedStyle(element)
      const rowGap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0
      const preferredMaxHeight = rowElements.length
        ? rowElements.reduce((total, row, index) => total + row.getBoundingClientRect().height + (index > 0 ? rowGap : 0), 0)
        : 0
      const availableHeight = Math.floor(window.innerHeight - element.getBoundingClientRect().top - viewportBottomInset)

      if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
        setLibraryResultsMaxHeight(null)
        return
      }

      if (!preferredMaxHeight) {
        setLibraryResultsMaxHeight(Math.max(availableHeight, 0))
        return
      }

      setLibraryResultsMaxHeight(Math.min(preferredMaxHeight, availableHeight))
    }

    updateMaxHeight()
    window.addEventListener('resize', updateMaxHeight)

    return () => window.removeEventListener('resize', updateMaxHeight)
  }, [filteredItems.length, libraryFilter, librarySearch, hasLibraryPath])

  return (
    <section className="view-stack">
      {!hasLibraryPath ? (
        <div className="empty-state">
          <strong>No local library folder selected yet.</strong>
          <p>Choose a library folder in Settings or from this view to build the local archive index.</p>
        </div>
      ) : (
        <>
          {libraryMessage ? (
            <div
              className={
                libraryMessage.tone === 'danger'
                  ? 'runtime-banner runtime-banner-danger'
                  : libraryMessage.tone === 'success'
                    ? 'runtime-banner runtime-banner-success'
                    : 'runtime-banner'
              }
            >
              <strong>{libraryMessage.text}</strong>
              {libraryMessage.details ? <p>{libraryMessage.details}</p> : null}
            </div>
          ) : null}
          <div className="library-summary-grid">
            <label
              className="library-summary-search"
              title="Search the raw diagnostics index by title, package ID, path, or note to narrow the results."
            >
              <span className="sr-only">Filter indexed library entries</span>
              <input
                aria-label="Filter indexed library entries"
                className="library-summary-search-input"
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search"
                type="text"
                value={librarySearch}
              />
              {librarySearch ? (
                <button
                  aria-label="Clear library search"
                  className="library-summary-search-clear"
                  onClick={() => setLibrarySearch('')}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
            </label>
            <button
              aria-pressed={libraryFilter === 'all'}
              className={libraryFilter === 'all' ? 'signal-chip signal-chip-button signal-chip-active' : 'signal-chip signal-chip-button'}
              onClick={() => setLibraryFilter('all')}
              title="Show every indexed library entry in the diagnostics view."
              type="button"
            >
              <span>Indexed Entries</span>
              <strong>{indexedCount}</strong>
            </button>
            <button
              aria-pressed={libraryFilter === 'installReady'}
              className={libraryFilter === 'installReady' ? 'signal-chip signal-chip-button signal-chip-active' : 'signal-chip signal-chip-button'}
              onClick={() => setLibraryFilter('installReady')}
              title="Show only entries that are present on disk and ready to install."
              type="button"
            >
              <span>Install-Ready</span>
              <strong>{installReadyCount}</strong>
            </button>
            <button
              aria-pressed={libraryFilter === 'missing'}
              className={
                libraryFilter === 'missing'
                  ? 'signal-chip signal-chip-button signal-chip-active signal-chip-danger'
                  : missingCount > 0
                    ? 'signal-chip signal-chip-button signal-chip-danger'
                    : 'signal-chip signal-chip-button'
              }
              onClick={() => setLibraryFilter('missing')}
              title="Show stale index entries whose files are missing on disk so you can review or remove them."
              type="button"
            >
              <span>Missing</span>
              <strong>{missingCount}</strong>
            </button>
            <div
              className="signal-chip"
              title="Total on-disk footprint of the currently indexed local library."
            >
              <span>Footprint</span>
              <strong>{formatBytes(localLibraryIndex?.totalBytes ?? null)}</strong>
            </div>
          </div>

          <section className="surface-panel">
            <div className="section-heading library-results-heading">
              <div className="library-results-title">
                <p className="eyebrow">Indexed Results</p>
              </div>
            </div>

            {filteredItems.length ? (
              <>
                <div className="table-header library-index-grid">
                  <span>Name</span>
                  <span>Kind</span>
                  <span>Status</span>
                  <span>Relative Path</span>
                  <span>Size</span>
                  <span>Updated</span>
                  <span>Action</span>
                </div>

                <div
                  className="table-stack library-results-scroll"
                  ref={libraryResultsScrollRef}
                  style={libraryResultsMaxHeight ? { maxHeight: `${libraryResultsMaxHeight}px` } : undefined}
                >
                  {filteredItems.map((item) => (
                    <article className="table-row-card library-index-grid" key={item.id}>
                      <div className="row-title">
                        <strong>{item.name}</strong>
                        <p>{item.note}</p>
                      </div>
                      <span>{describeLibraryItemKind(item)}</span>
                      <span className={item.availability === 'missing' ? 'status-pill status-danger library-status-pill' : 'status-pill status-ready library-status-pill'}>
                        {item.availability}
                      </span>
                      <span className="library-path-chip">{item.relativePath}</span>
                      <span>{formatBytes(item.sizeBytes)}</span>
                      <span>{formatDateLabel(item.modifiedAt)}</span>
                      <div className="library-action-cell">
                        {item.availability === 'missing' ? (
                          <button
                            className="status-pill status-pill-button"
                            disabled={removeMissingLibraryItemBusyId === item.id}
                            onClick={() => void onRemoveMissingLibraryItem(item.id)}
                            type="button"
                          >
                            {removeMissingLibraryItemBusyId === item.id ? 'Removing...' : 'Remove'}
                          </button>
                        ) : item.availability === 'present' ? (
                          <button
                            className="status-pill status-danger status-pill-button status-pill-button-danger"
                            disabled={purgeLibraryItemBusyId === item.id}
                            onClick={() => void onPurgeLibraryItem(item.id)}
                            type="button"
                          >
                            <span className="action-pill-icon" aria-hidden="true">
                              <svg viewBox="0 0 16 16" focusable="false">
                                <path
                                  d="M5.5 3.25h5M6.25 1.75h3.5M4.5 3.25l.65 9.25h5.7l.65-9.25M6.5 6v4.25M9.5 6v4.25"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="1.35"
                                />
                              </svg>
                            </span>
                            {purgeLibraryItemBusyId === item.id ? 'Purging...' : 'Purge'}
                          </button>
                        ) : (
                          <span className="library-action-placeholder">-</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <strong>{libraryFilter === 'all' ? 'No indexed library entries yet.' : 'No entries match this filter.'}</strong>
                <p>
                  {libraryFilter === 'all'
                    ? 'Run a rescan to inspect the chosen library folder and classify the visible top-level payloads.'
                    : 'Choose another library filter or rescan the library to refresh the indexed results.'}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

function LibraryScanDialog(props: {
  scan: LocalLibraryScanResponse | null
  isOpen: boolean
  removeMissingLibraryItemBusyId: string | null
  purgeLibraryItemBusyId: string | null
  onClose: () => void
  onRemoveMissingLibraryItem: (itemId: string) => Promise<void>
  onPurgeLibraryItem: (itemId: string) => Promise<void>
}) {
  const { scan, isOpen, removeMissingLibraryItemBusyId, purgeLibraryItemBusyId, onClose, onRemoveMissingLibraryItem, onPurgeLibraryItem } =
    props
  const newItems = scan?.items.filter((item) => item.discoveryState === 'new') ?? []
  const missingItems = scan?.items.filter((item) => item.availability === 'missing') ?? []
  const hasChanges = newItems.length > 0 || missingItems.length > 0

  if (!isOpen || !scan) {
    return null
  }

  return (
    <>
      <div className="library-scan-backdrop" onClick={onClose} />
      <section className="library-scan-dialog surface-panel" role="dialog" aria-modal="true" aria-label="Library scan results">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Library Scan</p>
            <h2>Found and Identified</h2>
            <p className="section-copy compact">{scan.message}</p>
          </div>
          <button className="status-pill status-pill-button" onClick={onClose} type="button">
            Dismiss
          </button>
        </div>

        <div className="library-scan-signal-grid">
          <div className={scan.newCount > 0 ? 'signal-chip signal-chip-warm' : 'signal-chip'}>
            <span>New</span>
            <strong>{scan.newCount}</strong>
          </div>
          <div className={scan.missingCount > 0 ? 'signal-chip signal-chip-danger' : 'signal-chip'}>
            <span>Missing</span>
            <strong>{scan.missingCount}</strong>
          </div>
          <div className="signal-chip">
            <span>Current</span>
            <strong>{scan.itemCount}</strong>
          </div>
          <div className="signal-chip">
            <span>Footprint</span>
            <strong>{formatBytes(scan.totalBytes)}</strong>
          </div>
        </div>

        {hasChanges ? (
          <div className="library-scan-line-list">
            {newItems.length ? (
              <section className="library-scan-section">
                <div className="library-scan-section-heading">
                  <p className="eyebrow">New</p>
                  <h3>Newly Identified</h3>
                </div>
                {newItems.map((item) => (
                  <article className="library-scan-line" key={item.id}>
                    <div className="row-title">
                      <strong>{item.name}</strong>
                      <p>{item.note}</p>
                    </div>
                    <div className="library-scan-line-meta">
                      <span className="status-pill status-ready library-status-pill">new</span>
                      <span className="package-chip">{describeLibraryItemKind(item)}</span>
                      <span className="package-chip">{formatBytes(item.sizeBytes)}</span>
                      <button
                        className="status-pill status-danger status-pill-button status-pill-button-danger"
                        disabled={purgeLibraryItemBusyId === item.id}
                        onClick={() => void onPurgeLibraryItem(item.id)}
                        type="button"
                      >
                        <span className="action-pill-icon" aria-hidden="true">
                          <svg viewBox="0 0 16 16" focusable="false">
                            <path
                              d="M5.5 3.25h5M6.25 1.75h3.5M4.5 3.25l.65 9.25h5.7l.65-9.25M6.5 6v4.25M9.5 6v4.25"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.35"
                            />
                          </svg>
                        </span>
                        {purgeLibraryItemBusyId === item.id ? 'Purging...' : 'Purge'}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            ) : null}

            {missingItems.length ? (
              <section className="library-scan-section">
                <div className="library-scan-section-heading">
                  <p className="eyebrow">Missing</p>
                  <h3>Missing on Disk</h3>
                </div>
                {missingItems.map((item) => (
                  <article className="library-scan-line" key={item.id}>
                    <div className="row-title">
                      <strong>{item.name}</strong>
                      <p>{item.note}</p>
                    </div>
                    <div className="library-scan-line-meta">
                      <span className="status-pill status-danger library-status-pill">missing</span>
                      <span className="package-chip">{describeLibraryItemKind(item)}</span>
                      <span className="package-chip">{formatBytes(item.sizeBytes)}</span>
                      <button
                        className="status-pill status-pill-button"
                        disabled={removeMissingLibraryItemBusyId === item.id}
                        onClick={() => void onRemoveMissingLibraryItem(item.id)}
                        type="button"
                      >
                        {removeMissingLibraryItemBusyId === item.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">
            <strong>No new or missing items this pass.</strong>
            <p>The scan completed successfully, but nothing newly identified or missing changed in this pass.</p>
          </div>
        )}
      </section>
    </>
  )
}

export function WireframeShell(props: WireframeShellProps) {
  const {
    activeTab,
    onTabChange,
    deviceStatus,
    deviceStatusTone,
    deviceStatusTransport,
    deviceStatusUsbTooltip,
    deviceStatusWifiTooltip,
    deviceStatusWifiDisconnectTargetId,
    subtitle,
    liveQueueItems,
    queueAutoOpenSignal,
    onPauseVrSrcTransfer,
    onResumeVrSrcTransfer,
    onCancelVrSrcTransfer,
    settings,
    settingsBusy,
    libraryRescanBusy,
    removeMissingLibraryItemBusyId,
    purgeLibraryItemBusyId,
    settingsMessage,
    dependencyStatus,
    libraryMessage,
    localLibraryIndex,
    backupStorageIndex,
    gameSavesPathStats,
    saveBackupsResponse,
    saveScanResponse,
    metaStoreMatchesByItemId,
    installedMetaStoreMatchesByPackageId,
    metaStoreSyncProgress,
    isLibraryScanDialogOpen,
    deviceResponse,
    deviceBusy,
    deviceMessage,
    selectedDeviceId,
    deviceAppsResponse,
    deviceUserName,
    deviceUserNameBusy,
    deviceAppsBusy,
    deviceAppsMessage,
    deviceLeftoverResponse,
    deviceLeftoverBusy,
    deviceLeftoverBusyItemId,
    deviceLeftoverMessage,
    inventoryMessage,
    inventoryActionBusyPackageId,
    gamesInstallBusyIds,
    manualInstallBusyKind,
    backupStorageActionBusyItemId,
    gamesMessage,
    vrSrcStatus,
    vrSrcCatalog,
    isVrSrcPanelOpen,
    vrSrcSyncBusy,
    vrSrcMaintenanceBusy,
    vrSrcActionBusyReleaseNames,
    vrSrcMessage,
    saveGamesBusy,
    saveGamesBatchBusy,
    saveGamesActionBusyPackageId,
    saveGamesRestoreBusyBackupId,
    saveGamesDeleteBusyBackupId,
    saveGamesMessage,
    gamesDisplayMode,
    inventoryDisplayMode,
    onSelectDevice,
    onRefreshDevices,
    onChooseSettingsPath,
    onClearSettingsPath,
    onClearVrSrcCache,
    onRescanLocalLibrary,
    onInstallManualLibrarySource,
    onRemoveMissingLibraryItem,
    onPurgeLibraryItem,
    onSaveLocalLibraryItemManualStoreId,
    onSaveIndexedItemManualMetadata,
    onImportManualMetadataImage,
    onExtractIndexedItemArtwork,
    onDismissLibraryScanDialog,
    onConnectDevice,
    onDisconnectDevice,
    onRefreshLeftoverData,
    onDeleteLeftoverData,
    onRefreshInstalledApps,
    onSaveDeviceUserName,
    onSetGamesDisplayMode,
    onSetInventoryDisplayMode,
    onUninstallInstalledApp,
    onBackupInstalledApp,
    onInstallLocalLibraryItem,
    onMoveBackupStorageItemToLibrary,
    onDeleteBackupStorageItem,
    onRefreshAllMetadata,
    onToggleVrSrcPanel,
    onSyncVrSrcCatalog,
    onDownloadVrSrcToLibrary,
    onDownloadVrSrcToLibraryAndInstall,
    onInstallVrSrcNow,
    onRefreshSaveBackups,
    onScanSavePackages,
    onScanSavePackage,
    onBackupAllSavePackages,
    onBackupSavePackage,
    onRestoreSaveBackup,
    onDeleteSaveBackup
  } = props

  const activeHero = heroContent[activeTab]
  const readyDevices = deviceResponse?.devices.filter((device) => device.state === 'device').length ?? 0
  const selectedDevice = deviceResponse?.devices.find((device) => device.id === selectedDeviceId) ?? null
  const hasLibraryPath = Boolean(settings?.localLibraryPath)
  const selectedAppCount =
    selectedDeviceId && deviceAppsResponse?.serial === selectedDeviceId ? deviceAppsResponse.apps.length : 0
  const railStorageUsagePercent = computeStorageUsage(selectedDevice?.storageTotalBytes ?? null, selectedDevice?.storageFreeBytes ?? null)
  const railDeviceIndicator = resolveQuestStorageIndicator(
    [selectedDevice?.model, selectedDevice?.label, selectedDevice?.product],
    selectedDevice?.storageTotalBytes ?? null
  )
  const railDeviceTransport =
    selectedDevice?.transport === 'tcp' ? 'wifi' : selectedDevice?.transport ? 'usb' : null
  const railHasStorageData =
    selectedDevice !== null &&
    selectedDevice.storageFreeBytes !== null &&
    railStorageUsagePercent !== null
  const dependencyReadyCount = dependencyStatus?.statuses.filter((status) => status.status === 'ready').length ?? 0
  const dependencyStatusCount = dependencyStatus?.statuses.length ?? 0
  const dependencyIndicatorTone =
    dependencyStatusCount > 0 && dependencyReadyCount === dependencyStatusCount
      ? 'ready'
      : dependencyReadyCount > 0
        ? 'warning'
        : 'error'
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [isManagedDependenciesOpen, setIsManagedDependenciesOpen] = useState(false)
  const [isLibraryDiagnosticsOpen, setIsLibraryDiagnosticsOpen] = useState(false)
  const [isOrphanedDataOpen, setIsOrphanedDataOpen] = useState(false)
  const [libraryDiagnosticsInitialFilter, setLibraryDiagnosticsInitialFilter] = useState<'all' | 'installReady' | 'missing'>('all')
  const heroShellRef = useRef<HTMLElement | null>(null)
  const [heroShellHeight, setHeroShellHeight] = useState(0)
  const queueItemCount = liveQueueItems.filter((item) => item.phase !== 'completed' && item.phase !== 'failed').length

  useEffect(() => {
    if (!queueAutoOpenSignal) {
      return
    }

    setIsQueueOpen(true)
  }, [queueAutoOpenSignal])

  useEffect(() => {
    const heroNode = heroShellRef.current

    if (!heroNode || typeof ResizeObserver === 'undefined') {
      return
    }

    const updateHeroShellHeight = () => {
      setHeroShellHeight(heroNode.getBoundingClientRect().height)
    }

    updateHeroShellHeight()

    const observer = new ResizeObserver(() => {
      updateHeroShellHeight()
    })

    observer.observe(heroNode)

    return () => {
      observer.disconnect()
    }
  }, [activeTab, isVrSrcPanelOpen, isQueueOpen])

  return (
    <div className="app-shell">
      <div className="backdrop-orb orb-left" />
      <div className="backdrop-orb orb-right" />

      <div className="workspace-shell">
        <aside className="left-rail surface-panel">
          <div className="rail-brand-header">
            <p className="rail-brand-eyebrow">Quest</p>
            <strong className="rail-brand-title">
              VAULT
              <span className="rail-brand-title-mark">QV</span>
            </strong>
          </div>

          <div className="nav-stack">
            {primaryTabs.map((tab) => (
              <button
                aria-pressed={activeTab === tab.id}
                className={activeTab === tab.id ? 'nav-button active' : 'nav-button'}
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
              >
                <strong>{tab.label}</strong>
                <span>{tab.note}</span>
              </button>
            ))}
          </div>

          <section className="rail-session-section">
            {selectedDevice ? (
              <>
                <div className="rail-session-card">
                  <div className="rail-session-header">
                    <strong className="rail-session-title">Device Status</strong>
                    {railDeviceTransport ? (
                      <span
                        className="transport-indicator rail-transport-indicator"
                        title={railDeviceTransport === 'wifi' ? 'Wi-Fi ADB is active.' : 'USB ADB is active.'}
                      >
                        <span
                          aria-hidden="true"
                          className={railDeviceTransport === 'wifi' ? 'transport-icon transport-wifi' : 'transport-icon transport-usb'}
                        />
                      </span>
                    ) : null}
                  </div>
                  {railDeviceIndicator ? (
                    <div className="rail-device-hero">
                      <div className="rail-device-indicator-art">
                        <img alt={`${railDeviceIndicator.family} ${railDeviceIndicator.storageLabel} model`} src={railDeviceIndicator.imageUrl} />
                      </div>
                      <div className="rail-device-indicator-copy">
                        <strong>
                          {railDeviceIndicator.family} <span>|</span> {railDeviceIndicator.storageLabel}
                        </strong>
                      </div>
                    </div>
                  ) : null}
                  <span className="rail-session-kicker rail-session-kicker-stacked">
                    <span>Installed</span>
                    <span>Apps &amp; Games</span>
                  </span>
                  <strong className="rail-session-count">{selectedAppCount}</strong>
                  {railHasStorageData ? (
                    <div className="rail-storage-block">
                      <span className="rail-storage-kicker">Storage</span>
                      <div className="rail-storage-copy">
                        <span>{formatPercent(railStorageUsagePercent)}</span>
                        <span>{formatBytes(selectedDevice.storageFreeBytes)} free</span>
                      </div>
                      <div className="rail-storage-track" aria-label="Sidebar device storage usage">
                        <div className="rail-storage-fill" style={{ width: `${railStorageUsagePercent ?? 0}%` }} />
                      </div>
                    </div>
                  ) : null}
                  <button className="status-pill status-pill-button rail-manage-pill" onClick={() => onTabChange('inventory')} type="button">
                    View
                  </button>
                </div>
              </>
            ) : (
              <div className="rail-session-card">
                <div className="rail-session-header">
                  <strong className="rail-session-title">Device Status</strong>
                </div>
                <div className="rail-status-list">
                  <div className="signal-chip">
                    <span>Devices</span>
                    <strong>{readyDevices} ready</strong>
                  </div>
                  <div className="signal-chip">
                    <span>Runtime</span>
                    <strong>{deviceStatus}</strong>
                  </div>
                </div>
              </div>
            )}
          </section>

        </aside>

        <main
          className="main-stage"
          style={
            {
              '--hero-shell-height': `${heroShellHeight}px`
            } as CSSProperties
          }
        >
          <header
            ref={heroShellRef}
            className="hero-shell surface-panel"
          >
            <div className={activeTab === 'manager' ? 'hero-topbar hero-topbar-manager' : 'hero-topbar'}>
              <div className="hero-pill-row">
                <button
                  aria-expanded={isQueueOpen}
                  className={isQueueOpen ? 'live-toggle-button active' : 'live-toggle-button'}
                  onClick={() => setIsQueueOpen((current) => !current)}
                  title={isQueueOpen ? 'Hide Live Queue' : 'Open Live Queue to review active and recent operations'}
                  type="button"
                >
                  <span>Live</span>
                  <strong>{queueItemCount}</strong>
                </button>
              </div>
            </div>

            <div
              className={
                activeTab === 'games' || activeTab === 'settings'
                  ? 'hero-headline hero-headline-with-actions hero-headline-library'
                  : 'hero-headline'
              }
            >
              <div className="hero-headline-copy">
                {activeHero.eyebrow ? <p className="eyebrow">{activeHero.eyebrow}</p> : null}
                <h2>{activeHero.title}</h2>
                <p className="hero-copy">{subtitle}</p>
              </div>
              {activeTab === 'games' ? (
                <div className="hero-pill-row games-hero-toolbar hero-inline-toolbar">
                  <button
                    aria-pressed={isVrSrcPanelOpen}
                    className={
                      isVrSrcPanelOpen
                        ? 'filter-chip filter-chip-button games-toolbar-chip games-toolbar-chip-vrsrc active'
                        : 'filter-chip filter-chip-button games-toolbar-chip games-toolbar-chip-vrsrc'
                    }
                    onClick={onToggleVrSrcPanel}
                    title={isVrSrcPanelOpen ? 'Hide the vrSrc remote source module' : 'Open the vrSrc remote source module'}
                    type="button"
                  >
                    vrSrc {vrSrcStatus?.itemCount ? <strong>{vrSrcStatus.itemCount}</strong> : null}
                  </button>
                  <button
                    className="filter-chip filter-chip-button games-toolbar-chip"
                    disabled={manualInstallBusyKind !== null}
                    onClick={() => void onInstallManualLibrarySource('apk')}
                    title="Choose a standalone APK file and install it directly to the selected headset"
                    type="button"
                  >
                    {manualInstallBusyKind === 'apk' ? 'Installing APK...' : 'Install APK File'}
                  </button>
                  <button
                    className="filter-chip filter-chip-button games-toolbar-chip"
                    disabled={manualInstallBusyKind !== null}
                    onClick={() => void onInstallManualLibrarySource('folder')}
                    title="Choose a folder payload and install its APK, OBB, and scripted steps to the selected headset"
                    type="button"
                  >
                    {manualInstallBusyKind === 'folder' ? 'Installing Folder...' : 'Install Folder'}
                  </button>
                  <button
                    className="filter-chip filter-chip-button games-toolbar-chip"
                    disabled={libraryRescanBusy || !hasLibraryPath}
                    onClick={() => void onRescanLocalLibrary()}
                    title="Rescan the Local Library path and refresh indexed titles and payload availability"
                    type="button"
                  >
                    {libraryRescanBusy ? 'Rescanning...' : 'Re-Scan Library'}
                  </button>
                </div>
              ) : null}
            </div>
          </header>

          {activeTab === 'games' && (
            <GamesView
              settings={settings}
              localLibraryIndex={localLibraryIndex}
              backupStorageIndex={backupStorageIndex}
              metaStoreMatchesByItemId={metaStoreMatchesByItemId}
              metaStoreSyncProgress={metaStoreSyncProgress}
              deviceAppsResponse={deviceAppsResponse}
              deviceUserName={deviceUserName}
              deviceUserNameBusy={deviceUserNameBusy}
              selectedDeviceId={selectedDeviceId}
              gamesInstallBusyIds={gamesInstallBusyIds}
              purgeLibraryItemBusyId={purgeLibraryItemBusyId}
              backupStorageActionBusyItemId={backupStorageActionBusyItemId}
              inventoryActionBusyPackageId={inventoryActionBusyPackageId}
              gamesMessage={gamesMessage}
              vrSrcStatus={vrSrcStatus}
              vrSrcCatalog={vrSrcCatalog}
              isVrSrcPanelOpen={isVrSrcPanelOpen}
              vrSrcSyncBusy={vrSrcSyncBusy}
              vrSrcActionBusyReleaseNames={vrSrcActionBusyReleaseNames}
              vrSrcMessage={vrSrcMessage}
              displayMode={gamesDisplayMode}
              onToggleDisplayMode={() => void onSetGamesDisplayMode(gamesDisplayMode === 'list' ? 'gallery' : 'list')}
              onChooseSettingsPath={onChooseSettingsPath}
              onRescanLocalLibrary={onRescanLocalLibrary}
              onInstallManualLibrarySource={onInstallManualLibrarySource}
              onInstallLocalLibraryItem={onInstallLocalLibraryItem}
              onPurgeLibraryItem={onPurgeLibraryItem}
              onMoveBackupStorageItemToLibrary={onMoveBackupStorageItemToLibrary}
              onDeleteBackupStorageItem={onDeleteBackupStorageItem}
              onRefreshAllMetadata={onRefreshAllMetadata}
              onToggleVrSrcPanel={onToggleVrSrcPanel}
              onSyncVrSrcCatalog={onSyncVrSrcCatalog}
              onDownloadVrSrcToLibrary={onDownloadVrSrcToLibrary}
              onDownloadVrSrcToLibraryAndInstall={onDownloadVrSrcToLibraryAndInstall}
              onInstallVrSrcNow={onInstallVrSrcNow}
              onSaveDeviceUserName={onSaveDeviceUserName}
              onUninstallInstalledApp={onUninstallInstalledApp}
              onSaveLocalLibraryItemManualStoreId={onSaveLocalLibraryItemManualStoreId}
              onSaveIndexedItemManualMetadata={onSaveIndexedItemManualMetadata}
              onImportManualMetadataImage={onImportManualMetadataImage}
              onExtractIndexedItemArtwork={onExtractIndexedItemArtwork}
            />
          )}
          {activeTab === 'saves' && (
            <GameSavesView
              selectedDeviceId={selectedDeviceId}
              settings={settings}
              deviceAppsResponse={deviceAppsResponse}
              localLibraryIndex={localLibraryIndex}
              backupStorageIndex={backupStorageIndex}
              metaStoreMatchesByItemId={metaStoreMatchesByItemId}
              installedMetaStoreMatchesByPackageId={installedMetaStoreMatchesByPackageId}
              saveBackupsResponse={saveBackupsResponse}
              saveScanResponse={saveScanResponse}
              saveGamesBusy={saveGamesBusy}
              saveGamesBatchBusy={saveGamesBatchBusy}
              saveGamesActionBusyPackageId={saveGamesActionBusyPackageId}
              saveGamesRestoreBusyBackupId={saveGamesRestoreBusyBackupId}
              saveGamesDeleteBusyBackupId={saveGamesDeleteBusyBackupId}
              saveGamesMessage={saveGamesMessage}
              onRefreshSaveBackups={onRefreshSaveBackups}
              onScanSavePackages={onScanSavePackages}
              onScanSavePackage={onScanSavePackage}
              onBackupAllSavePackages={onBackupAllSavePackages}
              onBackupSavePackage={onBackupSavePackage}
              onRestoreSaveBackup={onRestoreSaveBackup}
              onDeleteSaveBackup={onDeleteSaveBackup}
            />
          )}
          {activeTab === 'inventory' && (
            <InventoryView
              selectedDeviceId={selectedDeviceId}
              selectedDevice={selectedDevice}
              deviceAppsResponse={deviceAppsResponse}
              deviceLeftoverResponse={deviceLeftoverResponse}
              localLibraryIndex={localLibraryIndex}
              backupStorageIndex={backupStorageIndex}
              metaStoreMatchesByItemId={metaStoreMatchesByItemId}
              installedMetaStoreMatchesByPackageId={installedMetaStoreMatchesByPackageId}
              deviceAppsBusy={deviceAppsBusy}
              deviceAppsMessage={deviceAppsMessage}
              inventoryMessage={inventoryMessage}
              inventoryActionBusyPackageId={inventoryActionBusyPackageId}
              runtimeStatus={deviceResponse?.runtime.status ?? null}
              runtimeMessage={deviceResponse?.runtime.message ?? null}
              displayMode={inventoryDisplayMode}
              onToggleDisplayMode={() =>
                void onSetInventoryDisplayMode(inventoryDisplayMode === 'list' ? 'gallery' : 'list')
              }
              onOpenOrphanedDataDiscovery={() => setIsOrphanedDataOpen(true)}
              onRefreshInstalledApps={onRefreshInstalledApps}
              onUninstallInstalledApp={onUninstallInstalledApp}
              onBackupInstalledApp={onBackupInstalledApp}
            />
          )}
          {activeTab === 'manager' && (
            <ManagerView
              deviceBusy={deviceBusy}
              deviceMessage={deviceMessage}
              deviceResponse={deviceResponse}
              onConnectDevice={onConnectDevice}
              onDisconnectDevice={onDisconnectDevice}
              onRefreshDevices={onRefreshDevices}
              onSelectDevice={onSelectDevice}
              selectedDeviceId={selectedDeviceId}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              settingsBusy={settingsBusy}
              libraryRescanBusy={libraryRescanBusy}
              settingsMessage={settingsMessage}
              dependencyIndicatorTone={dependencyIndicatorTone}
              localLibraryIndex={localLibraryIndex}
              backupStorageIndex={backupStorageIndex}
              gameSavesPathStats={gameSavesPathStats}
              deviceAppsResponse={deviceAppsResponse}
              selectedDeviceId={selectedDeviceId}
              deviceLeftoverResponse={deviceLeftoverResponse}
              deviceLeftoverBusy={deviceLeftoverBusy}
              deviceLeftoverBusyItemId={deviceLeftoverBusyItemId}
              deviceLeftoverMessage={deviceLeftoverMessage}
              onOpenManagedDependencies={() => setIsManagedDependenciesOpen(true)}
              onOpenLibraryDiagnostics={(filter) => {
                setLibraryDiagnosticsInitialFilter(filter ?? 'all')
                setIsLibraryDiagnosticsOpen(true)
              }}
              onOpenOrphanedDataDiscovery={() => setIsOrphanedDataOpen(true)}
              onChooseSettingsPath={onChooseSettingsPath}
              onClearSettingsPath={onClearSettingsPath}
              onRescanLocalLibrary={onRescanLocalLibrary}
              onRefreshLeftoverData={onRefreshLeftoverData}
              onDeleteLeftoverData={onDeleteLeftoverData}
            />
          )}
        </main>

      </div>

      <div
        aria-hidden={!isQueueOpen}
        className={isQueueOpen ? 'queue-drawer-backdrop visible' : 'queue-drawer-backdrop'}
        onClick={() => setIsQueueOpen(false)}
      />
      <QueueRail
        isOpen={isQueueOpen}
        items={liveQueueItems}
        onClose={() => setIsQueueOpen(false)}
        onPauseVrSrcTransfer={onPauseVrSrcTransfer}
        onResumeVrSrcTransfer={onResumeVrSrcTransfer}
        onCancelVrSrcTransfer={onCancelVrSrcTransfer}
      />
      <LibraryScanDialog
        scan={localLibraryIndex}
        isOpen={isLibraryScanDialogOpen}
        removeMissingLibraryItemBusyId={removeMissingLibraryItemBusyId}
        purgeLibraryItemBusyId={purgeLibraryItemBusyId}
        onClose={onDismissLibraryScanDialog}
        onRemoveMissingLibraryItem={onRemoveMissingLibraryItem}
        onPurgeLibraryItem={onPurgeLibraryItem}
      />
      <ManagedDependenciesDialog
        isOpen={isManagedDependenciesOpen}
        onClose={() => setIsManagedDependenciesOpen(false)}
        dependencyStatus={dependencyStatus}
      />
      <OrphanedDataDialog
        isOpen={isOrphanedDataOpen}
        onClose={() => setIsOrphanedDataOpen(false)}
        selectedDeviceId={selectedDeviceId}
        deviceLeftoverResponse={deviceLeftoverResponse}
        deviceLeftoverBusy={deviceLeftoverBusy}
        deviceLeftoverBusyItemId={deviceLeftoverBusyItemId}
        deviceLeftoverMessage={deviceLeftoverMessage}
        onRefreshLeftoverData={onRefreshLeftoverData}
        onDeleteLeftoverData={onDeleteLeftoverData}
      />
      <LibraryDiagnosticsDialog
        isOpen={isLibraryDiagnosticsOpen}
        onClose={() => setIsLibraryDiagnosticsOpen(false)}
        initialFilter={libraryDiagnosticsInitialFilter}
        settings={settings}
        localLibraryIndex={localLibraryIndex}
        libraryRescanBusy={libraryRescanBusy}
        manualInstallBusyKind={manualInstallBusyKind}
        libraryMessage={libraryMessage}
        removeMissingLibraryItemBusyId={removeMissingLibraryItemBusyId}
        purgeLibraryItemBusyId={purgeLibraryItemBusyId}
        onChooseSettingsPath={onChooseSettingsPath}
        onRescanLocalLibrary={onRescanLocalLibrary}
        onInstallManualLibrarySource={onInstallManualLibrarySource}
        onRemoveMissingLibraryItem={onRemoveMissingLibraryItem}
        onPurgeLibraryItem={onPurgeLibraryItem}
      />
    </div>
  )
}
