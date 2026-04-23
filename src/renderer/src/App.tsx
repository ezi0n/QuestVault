import { useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  DependencyBootstrapProgressUpdate,
  DependencyStatusResponse,
  SaveBackupsResponse,
  DeviceAppsResponse,
  DeviceLeftoverScanResponse,
  DeviceListResponse,
  IndexedItemSource,
  LiveQueueItem,
  LocalLibraryIndexedItem,
  LocalLibraryScanResponse,
  ManualGameMetadataOverride,
  MetaStoreGameDetails,
  MetaStoreGameSummary,
  PrimaryTab,
  ReleaseCheckResponse,
  SavePackagesScanResponse,
  SettingsDisplayModeKey,
  SettingsIndexedPathUpdate,
  InstalledAppScanDelta,
  SettingsPathStatsResponse,
  SettingsPathKey,
  VrSrcCatalogResponse,
  VrSrcStatusResponse,
  VrSrcTransferOperation,
  VrSrcTransferProgressUpdate,
  ViewDisplayMode
} from '@shared/types/ipc'
import { WireframeShell } from './components/WireframeShell'

type RefreshMode = 'initial' | 'manual' | 'poll'
type DeviceStatusTransport = 'usb' | 'wifi' | 'mixed' | null
type UiNoticeTone = 'info' | 'success' | 'danger'

interface UiNotice {
  text: string
  details: string | null
  tone: UiNoticeTone
}

interface SignatureMismatchDialogState {
  packageName: string
}

const INSTALLED_APPS_REFRESH_IDLE_MS = 10_000

function buildDeviceSnapshot(response: DeviceListResponse | null): Map<string, { label: string; state: string }> {
  return new Map((response?.devices ?? []).map((device) => [device.id, { label: device.label, state: device.state }]))
}

function describeDeviceChanges(previous: DeviceListResponse | null, next: DeviceListResponse): string | null {
  const previousSnapshot = buildDeviceSnapshot(previous)
  const nextSnapshot = buildDeviceSnapshot(next)
  const changes: string[] = []

  for (const [id, nextDevice] of nextSnapshot.entries()) {
    const previousDevice = previousSnapshot.get(id)

    if (!previousDevice) {
      changes.push(nextDevice.state === 'device' ? `${nextDevice.label} connected.` : `${nextDevice.label} detected as ${nextDevice.state}.`)
      continue
    }

    if (previousDevice.state === nextDevice.state) {
      continue
    }

    if (nextDevice.state === 'device') {
      changes.push(`${nextDevice.label} reconnected.`)
      continue
    }

    changes.push(`${nextDevice.label} is now ${nextDevice.state}.`)
  }

  for (const [id, previousDevice] of previousSnapshot.entries()) {
    if (!nextSnapshot.has(id)) {
      changes.push(`${previousDevice.label} disconnected.`)
    }
  }

  return changes.length ? changes.slice(0, 3).join(' ') : null
}

function isObsoleteDeviceBanner(message: string | null | undefined): boolean {
  if (!message) {
    return false
  }

  return /\b(?:connected|reconnected|disconnected)\.\s*$/i.test(message.trim()) || /\binstalled successfully\.\s*$/i.test(message.trim())
}

function areCorePathsConfigured(settings: AppSettings | null | undefined): boolean {
  return Boolean(settings?.localLibraryPath && settings?.backupPath && settings?.gameSavesPath)
}

function deriveDeviceStatusTransport(response: DeviceListResponse | null): DeviceStatusTransport {
  const readyDevices = response?.devices.filter((device) => device.state === 'device') ?? []
  if (!readyDevices.length) {
    return null
  }

  const transports = new Set(
    readyDevices.map((device) => {
      if (device.transport === 'tcp') {
        return 'wifi'
      }

      if (device.transport === 'usb' || device.transport === 'emulator') {
        return 'usb'
      }

      return 'usb'
    })
  )

  if (transports.size === 1) {
    return Array.from(transports)[0] as DeviceStatusTransport
  }

  return 'mixed'
}

type IndexedSourceKind = 'library' | 'backup'

function buildIndexedItemMatchKey(source: IndexedSourceKind, itemId: string): string {
  return `${source}:${itemId}`
}

function formatIndexedSourceLabel(source: IndexedSourceKind): string {
  return source === 'library' ? 'Library' : 'Backup Storage'
}

function buildIndexSignature(index: LocalLibraryScanResponse | null): string {
  if (!index) {
    return 'null'
  }

  return `${index.path ?? 'none'}|${index.scannedAt ?? 'none'}|${index.itemCount}|${index.missingCount}|${index.totalBytes}`
}

const REMOTE_METADATA_REFRESH_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

function hasRemoteArtwork(summary: MetaStoreGameSummary | null): boolean {
  if (!summary) {
    return false
  }

  return Boolean(
    summary.thumbnail?.uri ??
      summary.heroImage?.uri ??
      summary.portraitImage?.uri ??
      summary.iconImage?.uri ??
      summary.logoImage?.uri
  )
}

function isRemoteMetadataStale(summary: MetaStoreGameSummary | null): boolean {
  if (!summary || summary.source !== 'remote') {
    return false
  }

  if (!hasRemoteArtwork(summary)) {
    return false
  }

  const fetchedAt = summary.fetchedAt ? Date.parse(summary.fetchedAt) : Number.NaN
  if (!Number.isFinite(fetchedAt)) {
    return true
  }

  return Date.now() - fetchedAt > REMOTE_METADATA_REFRESH_MAX_AGE_MS
}

function shouldIncrementallyRefreshMetadata(
  item: LocalLibraryIndexedItem,
  existingMatch: MetaStoreGameSummary | null
): boolean {
  if (item.discoveryState === 'new' || item.discoveryState === 'changed') {
    return true
  }

  if (existingMatch?.source !== 'remote') {
    return true
  }

  return isRemoteMetadataStale(existingMatch)
}

function createLiveQueueId(kind: LiveQueueItem['kind'], subject: string): string {
  return `${kind}-${subject}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildLiveQueueDetails(message: string, details: string | null | undefined): string {
  return details ? `${message} ${details}` : message
}

function buildVrSrcSyncLiveQueueDetails(response: {
  message: string
  details: string | null
  usedCachedCatalog: boolean
  catalog: VrSrcCatalogResponse
}): string {
  if (!response.usedCachedCatalog) {
    return buildLiveQueueDetails(response.message, response.details)
  }

  const cachedCount = response.catalog.items.length
  const fallbackMessage =
    cachedCount > 0
      ? `${response.message} Showing cached vrSrc data (${cachedCount} entries).`
      : `${response.message} No cached vrSrc catalog is available.`

  return buildLiveQueueDetails(fallbackMessage, response.details)
}

function buildInstalledAppChangeDetails(change: InstalledAppScanDelta | null): string | null {
  if (!change || (!change.addedCount && !change.removedCount)) {
    return null
  }

  const parts = [
    `Apps present on the headset changed since the previous scan (${change.previousAppCount} -> ${change.currentAppCount}).`,
    `New on headset: ${change.addedCount}, removed from headset: ${change.removedCount}.`
  ]

  if (change.addedPackages.length) {
    const listed = change.addedPackages.slice(0, 4).join(', ')
    parts.push(`Now present on headset: ${listed}${change.addedPackages.length > 4 ? ', …' : '.'}`)
  }

  if (change.removedPackages.length) {
    const listed = change.removedPackages.slice(0, 4).join(', ')
    parts.push(`No longer present on headset: ${listed}${change.removedPackages.length > 4 ? ', …' : '.'}`)
  }

  return parts.join(' ')
}

function buildVrSrcQueueId(operation: VrSrcTransferOperation, releaseName: string): string {
  return `vrsrc-${operation}-${releaseName}`
}

function buildDependencyQueueId(dependencyId: DependencyBootstrapProgressUpdate['dependencyId']): string {
  return `dependency-${dependencyId}`
}

function mapDependencyPhaseToLivePhase(phase: DependencyBootstrapProgressUpdate['phase']): LiveQueueItem['phase'] {
  if (phase === 'extracting') {
    return 'extracting'
  }

  if (phase === 'ready') {
    return 'completed'
  }

  if (phase === 'failed') {
    return 'failed'
  }

  return 'downloading'
}

function describeDependencyBootstrap(update: DependencyBootstrapProgressUpdate): string {
  return update.details ?? `${update.title} ${update.phase}.`
}

function formatTransferBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${bytes} B`
}

function formatTransferRate(bytesPerSecond: number | null | undefined): string | null {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return null
  }

  return `${formatTransferBytes(bytesPerSecond)}/s`
}

function formatEtaSeconds(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return null
  }

  if (value >= 3600) {
    const hours = Math.floor(value / 3600)
    const minutes = Math.round((value % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  if (value >= 60) {
    const minutes = Math.floor(value / 60)
    const seconds = value % 60
    return `${minutes}m ${seconds}s`
  }

  return `${value}s`
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

    const leftValue = String(leftToken)
    const rightValue = String(rightToken)
    if (leftValue !== rightValue) {
      return leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' })
    }
  }

  return 0
}

function isSignatureMismatchFailure(response: {
  success: boolean
  cancelled?: boolean
  message: string
  details: string | null
}): boolean {
  if (response.success || response.cancelled) {
    return false
  }

  const combined = `${response.message}\n${response.details ?? ''}`
  return /INSTALL_FAILED_UPDATE_INCOMPATIBLE/i.test(combined)
}

function describeVrSrcTransfer(update: VrSrcTransferProgressUpdate): string {
  const parts: string[] = []

  if (update.phase === 'queued') {
    return update.operation === 'install-now' || update.operation === 'download-to-library-and-install'
      ? 'Queued behind another headset install...'
      : 'Queued behind other vrSrc downloads...'
  }

  if (update.phase === 'paused') {
    return 'Download paused. Resume when you are ready.'
  }

  if (update.phase === 'cancelled') {
    return 'Download cancelled.'
  }

  if (update.phase === 'preparing') {
    return 'Preparing download...'
  }

  if (update.phase === 'installing') {
    return 'Queued payload is now installing on the headset...'
  }

  if (update.totalBytes) {
    parts.push(`${formatTransferBytes(update.transferredBytes)} of ${formatTransferBytes(update.totalBytes)}`)
  } else {
    parts.push(`${formatTransferBytes(update.transferredBytes)} downloaded`)
  }

  const speedLabel = formatTransferRate(update.speedBytesPerSecond)
  if (speedLabel) {
    parts.push(speedLabel)
  }

  const etaLabel = formatEtaSeconds(update.etaSeconds)
  if (etaLabel) {
    parts.push(`ETA ${etaLabel}`)
  }

  if (update.phase === 'extracting') {
    parts.unshift('Extracting payload...')
  }

  return parts.join(' • ')
}

function isCacheRecoveryMessage(message: string | null | undefined): boolean {
  return message?.startsWith('Recovered a corrupted ') ?? false
}

function buildSummaryFromDetails(details: MetaStoreGameDetails): MetaStoreGameSummary {
  return {
    storeId: details.storeId,
    storeItemId: details.storeItemId,
    packageId: details.packageId,
    title: details.title,
    subtitle: details.subtitle,
    category: details.category,
    publisherName: details.publisherName,
    genreNames: details.genreNames,
    gameModes: details.gameModes ?? [],
    supportedPlayerModes: details.supportedPlayerModes ?? [],
    comfortLevel: details.comfortLevel ?? null,
    releaseDateLabel: details.releaseDateLabel,
    canonicalName: details.canonicalName,
    thumbnail: details.thumbnail,
    heroImage: details.heroImage,
    portraitImage: details.portraitImage,
    iconImage: details.iconImage,
    logoImage: details.logoImage,
    youtubeTrailerVideoId: details.youtubeTrailerVideoId ?? null,
    version: details.version,
    versionCode: details.versionCode,
    supportedDevices: details.supportedDevices ?? [],
    sizeBytes: details.sizeBytes,
    ratingAverage: details.ratingAverage,
    priceLabel: details.priceLabel,
    source: details.source,
    fetchedAt: details.fetchedAt
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<PrimaryTab>('games')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [libraryRescanBusy, setLibraryRescanBusy] = useState(false)
  const [removeMissingLibraryItemBusyId, setRemoveMissingLibraryItemBusyId] = useState<string | null>(null)
  const [purgeLibraryItemBusyId, setPurgeLibraryItemBusyId] = useState<string | null>(null)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [dependencyStatus, setDependencyStatus] = useState<DependencyStatusResponse | null>(null)
  const [libraryMessage, setLibraryMessage] = useState<UiNotice | null>(null)
  const [localLibraryIndex, setLocalLibraryIndex] = useState<LocalLibraryScanResponse | null>(null)
  const [backupStorageIndex, setBackupStorageIndex] = useState<LocalLibraryScanResponse | null>(null)
  const [gameSavesPathStats, setGameSavesPathStats] = useState<SettingsPathStatsResponse | null>(null)
  const [saveBackupsResponse, setSaveBackupsResponse] = useState<SaveBackupsResponse | null>(null)
  const [saveScanResponse, setSaveScanResponse] = useState<SavePackagesScanResponse | null>(null)
  const [metaStoreMatchesByItemId, setMetaStoreMatchesByItemId] = useState<Record<string, MetaStoreGameSummary>>({})
  const [installedMetaStoreMatchesByPackageId, setInstalledMetaStoreMatchesByPackageId] = useState<
    Record<string, MetaStoreGameSummary>
  >({})
  const [metaStoreSyncProgress, setMetaStoreSyncProgress] = useState<{ completed: number; total: number } | null>(null)
  const [isLibraryScanDialogOpen, setIsLibraryScanDialogOpen] = useState(false)
  const [deviceResponse, setDeviceResponse] = useState<DeviceListResponse | null>(null)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [deviceAppsResponse, setDeviceAppsResponse] = useState<DeviceAppsResponse | null>(null)
  const [deviceUserName, setDeviceUserName] = useState<string | null>(null)
  const [deviceUserNameBusy, setDeviceUserNameBusy] = useState(false)
  const [deviceAppsBusy, setDeviceAppsBusy] = useState(false)
  const [deviceAppsMessage, setDeviceAppsMessage] = useState<string | null>(null)
  const [deviceLeftoverResponse, setDeviceLeftoverResponse] = useState<DeviceLeftoverScanResponse | null>(null)
  const [deviceLeftoverBusy, setDeviceLeftoverBusy] = useState(false)
  const [deviceLeftoverBusyItemId, setDeviceLeftoverBusyItemId] = useState<string | null>(null)
  const [deviceLeftoverMessage, setDeviceLeftoverMessage] = useState<string | null>(null)
  const [inventoryMessage, setInventoryMessage] = useState<UiNotice | null>(null)
  const [inventoryActionBusyPackageId, setInventoryActionBusyPackageId] = useState<string | null>(null)
  const [gamesInstallBusyIds, setGamesInstallBusyIds] = useState<string[]>([])
  const [manualInstallBusyKind, setManualInstallBusyKind] = useState<'apk' | 'folder' | null>(null)
  const [backupStorageActionBusyItemId, setBackupStorageActionBusyItemId] = useState<string | null>(null)
  const [gamesMessage, setGamesMessage] = useState<UiNotice | null>(null)
  const [vrSrcStatus, setVrSrcStatus] = useState<VrSrcStatusResponse | null>(null)
  const [vrSrcCatalog, setVrSrcCatalog] = useState<VrSrcCatalogResponse | null>(null)
  const [isVrSrcPanelOpen, setIsVrSrcPanelOpen] = useState(false)
  const [vrSrcSyncBusy, setVrSrcSyncBusy] = useState(false)
  const [vrSrcMaintenanceBusy, setVrSrcMaintenanceBusy] = useState(false)
  const [vrSrcActionBusyReleaseNames, setVrSrcActionBusyReleaseNames] = useState<string[]>([])
  const [vrSrcMessage, setVrSrcMessage] = useState<UiNotice | null>(null)
  const [signatureMismatchDialog, setSignatureMismatchDialog] = useState<SignatureMismatchDialogState | null>(null)
  const [signatureMismatchAcknowledged, setSignatureMismatchAcknowledged] = useState(false)
  const [saveGamesBusy, setSaveGamesBusy] = useState(false)
  const [saveGamesBatchBusy, setSaveGamesBatchBusy] = useState(false)
  const [saveGamesActionBusyPackageId, setSaveGamesActionBusyPackageId] = useState<string | null>(null)
  const [saveGamesRestoreBusyBackupId, setSaveGamesRestoreBusyBackupId] = useState<string | null>(null)
  const [saveGamesDeleteBusyBackupId, setSaveGamesDeleteBusyBackupId] = useState<string | null>(null)
  const [saveGamesMessage, setSaveGamesMessage] = useState<UiNotice | null>(null)
  const [gamesDisplayMode, setGamesDisplayModeState] = useState<ViewDisplayMode>('gallery')
  const [inventoryDisplayMode, setInventoryDisplayModeState] = useState<ViewDisplayMode>('gallery')
  const [liveQueueItems, setLiveQueueItems] = useState<LiveQueueItem[]>([])
  const [queueAutoOpenSignal, setQueueAutoOpenSignal] = useState(0)
  const deviceResponseRef = useRef<DeviceListResponse | null>(null)
  const hasCompletedInitialScanRef = useRef(false)
  const deviceRefreshInFlightRef = useRef(false)
  const metaStoreRefreshRunRef = useRef(0)
  const metaStoreMatchesByItemIdRef = useRef<Record<string, MetaStoreGameSummary>>({})
  const dependencyQueueIdsRef = useRef(new Set<string>())
  const hasAppliedStartupTabRef = useRef(false)
  const hasCheckedForUpdatesRef = useRef(false)
  const vrSrcInitialSyncAttemptedRef = useRef(false)
  const gamesInstallBusyIdsRef = useRef<string[]>([])
  const vrSrcActionBusyReleaseNamesRef = useRef<string[]>([])
  const signatureMismatchConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null)
  const installedAppsMutationDepthRef = useRef(0)
  const pendingInstalledAppsRefreshSerialRef = useRef<string | null>(null)
  const installedAppsRefreshIdleTimerRef = useRef<number | null>(null)
  const subtitle =
    activeTab === 'manager'
      ? 'ADB device operations, live devices and ADB runtime visibility'
      : activeTab === 'inventory'
          ? 'Installed applications, footprints, uninstall, and backup.'
        : activeTab === 'saves'
        ? 'Save and restore your game saves history, and backup saves from your headset.'
        : activeTab === 'settings'
        ? 'View library insights, configure paths and remove leftover data.'
        : 'Search your local library, plugin catalogs, and manage your content.'
  const readyDevices = deviceResponse?.devices.filter((device) => device.state === 'device') ?? []
  const firstVisibleDevice = deviceResponse?.devices[0] ?? null
  const deviceStatus =
    deviceResponse?.runtime.status === 'error'
      ? 'Device Layer Error'
      : readyDevices.length === 1
        ? `${readyDevices[0].label} Connected`
        : readyDevices.length > 1
          ? `${readyDevices.length} Devices Connected`
          : firstVisibleDevice
            ? `${firstVisibleDevice.label} ${firstVisibleDevice.state}`
            : deviceResponse?.runtime.status === 'ready'
              ? 'No Devices Connected'
              : 'Preparing Managed ADB'
  const deviceStatusTone: 'ready' | 'pending' | 'danger' =
    deviceResponse?.runtime.status === 'error'
      ? 'danger'
      : readyDevices.length > 0
        ? 'ready'
        : deviceResponse?.runtime.status === 'ready'
          ? 'danger'
          : 'pending'
  const deviceStatusTransport = deviceStatusTone === 'ready' ? deriveDeviceStatusTransport(deviceResponse) : null
  const readyWifiDevice = readyDevices.find((device) => device.transport === 'tcp') ?? null
  const readyUsbDevice =
    readyDevices.find((device) => device.transport === 'usb' || device.transport === 'emulator') ?? null
  const deviceStatusWifiDisconnectTargetId = readyWifiDevice?.id ?? null

  function resolveSignatureMismatchDialog(confirmed: boolean) {
    signatureMismatchConfirmResolveRef.current?.(confirmed)
    signatureMismatchConfirmResolveRef.current = null
    setSignatureMismatchDialog(null)
    setSignatureMismatchAcknowledged(false)
  }

  function requestSignatureMismatchConfirmation(packageName: string): Promise<boolean> {
    return new Promise((resolve) => {
      signatureMismatchConfirmResolveRef.current = resolve
      setSignatureMismatchDialog({ packageName })
      setSignatureMismatchAcknowledged(false)
    })
  }

  function enqueueLiveQueueItem(
    input: Omit<LiveQueueItem, 'updatedAt' | 'transferControl'> & {
      transferControl?: LiveQueueItem['transferControl']
    }
  ): string {
    const item: LiveQueueItem = {
      ...input,
      transferControl: input.transferControl ?? null,
      actionLabel: input.actionLabel ?? null,
      actionUrl: input.actionUrl ?? null,
      updatedAt: new Date().toISOString()
    }
    setLiveQueueItems((current) => {
      const withoutExisting = current.filter((entry) => entry.id !== item.id)
      return [item, ...withoutExisting].slice(0, 12)
    })
    setQueueAutoOpenSignal((current) => current + 1)
    return item.id
  }

  function updateLiveQueueItem(itemId: string, patch: Partial<Omit<LiveQueueItem, 'id'>>): void {
    setLiveQueueItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item))
    )
  }

  function findInstalledAppDisplayName(packageId: string): string {
    const match = deviceAppsResponse?.apps.find((app) => app.packageId === packageId)
    return match?.label ?? match?.inferredLabel ?? packageId
  }

  function clearInstalledAppsRefreshIdleTimer() {
    if (installedAppsRefreshIdleTimerRef.current !== null) {
      window.clearTimeout(installedAppsRefreshIdleTimerRef.current)
      installedAppsRefreshIdleTimerRef.current = null
    }
  }

  function queueInstalledAppsRefreshAfterIdle(serial: string) {
    pendingInstalledAppsRefreshSerialRef.current = serial
    clearInstalledAppsRefreshIdleTimer()

    if (installedAppsMutationDepthRef.current > 0) {
      return
    }

    installedAppsRefreshIdleTimerRef.current = window.setTimeout(() => {
      const nextSerial = pendingInstalledAppsRefreshSerialRef.current
      installedAppsRefreshIdleTimerRef.current = null
      pendingInstalledAppsRefreshSerialRef.current = null

      if (nextSerial) {
        void refreshInstalledApps(nextSerial)
      }
    }, INSTALLED_APPS_REFRESH_IDLE_MS)
  }

  function beginInstalledAppsMutation(serial: string) {
    pendingInstalledAppsRefreshSerialRef.current = serial
    clearInstalledAppsRefreshIdleTimer()
    installedAppsMutationDepthRef.current += 1
  }

  function endInstalledAppsMutation(serial: string, shouldRefreshInstalledApps: boolean) {
    installedAppsMutationDepthRef.current = Math.max(0, installedAppsMutationDepthRef.current - 1)

    if (shouldRefreshInstalledApps) {
      pendingInstalledAppsRefreshSerialRef.current = serial
    }

    if (installedAppsMutationDepthRef.current === 0 && pendingInstalledAppsRefreshSerialRef.current) {
      queueInstalledAppsRefreshAfterIdle(pendingInstalledAppsRefreshSerialRef.current)
    }
  }

  function findIndexedItem(source: IndexedSourceKind, itemId: string): LocalLibraryIndexedItem | null {
    const index = source === 'library' ? localLibraryIndex : backupStorageIndex
    return index?.items.find((item) => item.id === itemId) ?? null
  }

  function findIndexedItemSummary(source: IndexedSourceKind, itemId: string): MetaStoreGameSummary | null {
    return metaStoreMatchesByItemId[buildIndexedItemMatchKey(source, itemId)] ?? null
  }

  function findIndexedItemDisplayName(source: IndexedSourceKind, itemId: string, fallback: string): string {
    return findIndexedItemSummary(source, itemId)?.title ?? findIndexedItem(source, itemId)?.name ?? fallback
  }

  function findIndexedItemArtwork(source: IndexedSourceKind, itemId: string): string | null {
    return resolveQueueArtworkFromSummary(findIndexedItemSummary(source, itemId))
  }

  function formatSettingsPathLabel(key: SettingsPathKey): string {
    if (key === 'localLibraryPath') {
      return 'Local Library'
    }

    if (key === 'backupPath') {
      return 'Backups'
    }

    return 'Game Saves'
  }

  function resolveQueueArtworkFromSummary(summary: MetaStoreGameSummary | null | undefined): string | null {
    return (
      summary?.thumbnail?.uri ??
      summary?.iconImage?.uri ??
      summary?.portraitImage?.uri ??
      summary?.heroImage?.uri ??
      summary?.logoImage?.uri ??
      null
    )
  }

  function resolveQueueSubtitleFromSummary(summary: MetaStoreGameSummary | null | undefined): string | null {
    if (!summary) {
      return null
    }

    const publisher = summary.publisherName?.trim() || null
    const category = summary.category?.trim() || null

    if (publisher && category) {
      return `${publisher} • ${category}`
    }

    return publisher ?? category ?? null
  }

function findMetaStoreMatchByPackageId(packageId: string): MetaStoreGameSummary | null {
  const packageIdLower = packageId.toLowerCase()
  for (const [source, index] of [
    ['library', localLibraryIndex],
    ['backup', backupStorageIndex]
  ] as const) {
    for (const item of index?.items ?? []) {
      if (!item.packageIds.some((candidate) => candidate.toLowerCase() === packageIdLower)) {
        continue
      }

      const summary = metaStoreMatchesByItemId[buildIndexedItemMatchKey(source, item.id)]
      if (summary) {
        return summary
      }
    }
  }

  return null
}

  async function resolveMetaStoreMatchForItem(item: LocalLibraryIndexedItem): Promise<MetaStoreGameSummary | null> {
    if (item.manualStoreIdEdited && item.manualStoreId) {
      const response = await window.api.metaStore.getDetails(item.manualStoreId)
      return response.details ? buildSummaryFromDetails(response.details) : null
    }

    if (!item.packageIds.length) {
      return null
    }

    const response = await window.api.metaStore.getCachedMatchesByPackageIds(item.packageIds)
    return item.packageIds.map((packageId) => response.matches[packageId]).find(Boolean) ?? null
  }

  function setMetaStoreMatchForItem(source: IndexedSourceKind, itemId: string, match: MetaStoreGameSummary | null) {
    const key = buildIndexedItemMatchKey(source, itemId)
    setMetaStoreMatchesByItemId((current) => {
      const next = { ...current }
      if (match) {
        next[key] = match
      } else {
        delete next[key]
      }
      return next
    })
  }

  async function refreshMetaStoreMatchesForIndexUpdate(
    update: SettingsIndexedPathUpdate,
    options?: {
      announceInQueue?: boolean
      queueTitle?: string
      queueSubtitle?: string | null
      queueDetails?: string | null
    }
  ) {
    if (!update.changedItemIds.length) {
      if (options?.announceInQueue) {
        enqueueLiveQueueItem({
          id: `${update.source}-watch-refresh`,
          title: options.queueTitle ?? `${formatIndexedSourceLabel(update.source)} Watch Refresh`,
          subtitle: options.queueSubtitle ?? update.index.path ?? formatIndexedSourceLabel(update.source),
          kind: 'scan',
          phase: 'completed',
          progress: 100,
          details: options.queueDetails ?? update.index.message,
          artworkUrl: null
        })
      }
      return
    }

    const runId = metaStoreRefreshRunRef.current + 1
    metaStoreRefreshRunRef.current = runId

    const itemsById = new Map(update.index.items.map((item) => [item.id, item]))
    const nextMatchesByItemId = { ...metaStoreMatchesByItemIdRef.current }
    const queueId =
      options?.announceInQueue === true
        ? enqueueLiveQueueItem({
            id: `${update.source}-watch-refresh`,
            title: options.queueTitle ?? `${formatIndexedSourceLabel(update.source)} Watch Refresh`,
            subtitle: options.queueSubtitle ?? update.index.path ?? formatIndexedSourceLabel(update.source),
            kind: 'scan',
            phase: 'scanning',
            progress: 24,
            details:
              options.queueDetails ??
              `${update.index.message} Refreshing metadata for ${update.changedItemIds.length} changed item${update.changedItemIds.length === 1 ? '' : 's'}...`,
            artworkUrl: null
          })
        : null
    let completedSteps = 0

    for (const itemId of update.changedItemIds) {
      if (metaStoreRefreshRunRef.current !== runId) {
        if (queueId) {
          updateLiveQueueItem(queueId, {
            phase: 'completed',
            progress: 100,
            details: `${update.index.message} Superseded by a newer refresh.`
          })
        }
        return
      }

      const item = itemsById.get(itemId)
      const key = buildIndexedItemMatchKey(update.source, itemId)

      if (
        !item ||
        item.availability !== 'present' ||
        (!item.packageIds.length && !item.manualStoreId?.trim())
      ) {
        delete nextMatchesByItemId[key]
        completedSteps += 1
        if (queueId) {
          updateLiveQueueItem(queueId, {
            progress: Math.min(95, Math.round((completedSteps / Math.max(update.changedItemIds.length, 1)) * 75) + 20),
            details: `${update.index.message} Processing changed items (${completedSteps}/${update.changedItemIds.length})...`
          })
        }
        continue
      }

      const nextMatch = await resolveMetaStoreMatchForItem(item)

      if (metaStoreRefreshRunRef.current !== runId) {
        if (queueId) {
          updateLiveQueueItem(queueId, {
            phase: 'completed',
            progress: 100,
            details: `${update.index.message} Superseded by a newer refresh.`
          })
        }
        return
      }

      if (nextMatch) {
        nextMatchesByItemId[key] = nextMatch
      } else {
        delete nextMatchesByItemId[key]
      }

      completedSteps += 1
      if (queueId) {
        updateLiveQueueItem(queueId, {
          progress: Math.min(95, Math.round((completedSteps / Math.max(update.changedItemIds.length, 1)) * 75) + 20),
          details: `${update.index.message} Processing changed items (${completedSteps}/${update.changedItemIds.length})...`
        })
      }
    }

    if (metaStoreRefreshRunRef.current === runId) {
      setMetaStoreMatchesByItemId(nextMatchesByItemId)
      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: 'completed',
          progress: 100,
          details: `${update.index.message} Refreshed metadata for ${update.changedItemIds.length} changed item${update.changedItemIds.length === 1 ? '' : 's'}.`
        })
      }
    }
  }

  useEffect(() => {
    void loadSettings()
    void loadVrSrc()
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.dependencies.onBootstrapProgress((update) => {
      const queueId = buildDependencyQueueId(update.dependencyId)
      const nextPhase = mapDependencyPhaseToLivePhase(update.phase)
      const details = describeDependencyBootstrap(update)

      if (!dependencyQueueIdsRef.current.has(queueId)) {
        dependencyQueueIdsRef.current.add(queueId)
        enqueueLiveQueueItem({
          id: queueId,
          title: `${update.title} Setup`,
          subtitle: 'Managed Dependencies',
          kind: 'download',
          phase: nextPhase,
          progress: update.progress,
          details,
          artworkUrl: null
        })
        return
      }

      updateLiveQueueItem(queueId, {
        phase: nextPhase,
        progress: update.progress,
        details
      })
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    void ensureManagedDependencies()
  }, [])

  useEffect(() => {
    if (hasCheckedForUpdatesRef.current) {
      return
    }

    hasCheckedForUpdatesRef.current = true

    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('update', 'release-check'),
      title: 'Update Check',
      subtitle: 'GitHub Releases',
      kind: 'update',
      phase: 'scanning',
      progress: 16,
      details: 'Checking GitHub for a newer QuestVault release...',
      artworkUrl: null,
      actionLabel: null,
      actionUrl: null
    })

    void (async () => {
      try {
        const response: ReleaseCheckResponse = await window.api.app.checkForUpdates()
        updateLiveQueueItem(queueId, {
          phase: response.success ? 'completed' : 'failed',
          progress: 100,
          details: buildLiveQueueDetails(response.message, response.details),
          actionLabel: response.success && response.updateAvailable && response.releaseUrl ? 'Open Release' : null,
          actionUrl: response.success && response.updateAvailable ? response.releaseUrl : null
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to check for updates.'
        updateLiveQueueItem(queueId, {
          phase: 'failed',
          progress: 100,
          details: message,
          actionLabel: null,
          actionUrl: null
        })
      }
    })()
  }, [])

  useEffect(() => {
    gamesInstallBusyIdsRef.current = gamesInstallBusyIds
  }, [gamesInstallBusyIds])

  useEffect(() => {
    vrSrcActionBusyReleaseNamesRef.current = vrSrcActionBusyReleaseNames
  }, [vrSrcActionBusyReleaseNames])

  useEffect(() => {
    if (vrSrcSyncBusy || vrSrcInitialSyncAttemptedRef.current || !vrSrcStatus || !vrSrcCatalog) {
      return
    }

    if (!vrSrcStatus.configured) {
      return
    }

    const hasExistingCatalog = Boolean(vrSrcStatus.lastSyncAt || vrSrcCatalog.syncedAt || vrSrcCatalog.items.length)
    if (hasExistingCatalog) {
      return
    }

    vrSrcInitialSyncAttemptedRef.current = true
    void syncVrSrcCatalog({ openPanelOnSuccess: false })
  }, [vrSrcCatalog, vrSrcStatus, vrSrcSyncBusy])

  useEffect(() => {
    metaStoreMatchesByItemIdRef.current = metaStoreMatchesByItemId
  }, [metaStoreMatchesByItemId])

  useEffect(() => {
    if (activeTab === 'settings') {
      return
    }

    setSettingsMessage(null)
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'settings') {
      return
    }

    setLibraryMessage(null)
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'games') {
      return
    }

    setGamesMessage(null)
  }, [activeTab])

  useEffect(() => {
    if (!settingsMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSettingsMessage(null)
    }, 3000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [settingsMessage])

  useEffect(() => {
    if (!gamesMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setGamesMessage(null)
    }, 10000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [gamesMessage])

  useEffect(() => {
    if (activeTab === 'inventory') {
      return
    }

    setInventoryMessage(null)
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'saves') {
      return
    }

    setSaveGamesMessage(null)
  }, [activeTab])

  useEffect(() => {
    if (!inventoryMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setInventoryMessage(null)
    }, 10000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [inventoryMessage])

  useEffect(() => {
    if (!saveGamesMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSaveGamesMessage(null)
    }, 10000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [saveGamesMessage])

  useEffect(() => {
    const timeoutId = window.setInterval(() => {
      const cutoff = Date.now() - 30_000
      setLiveQueueItems((current) =>
        current.filter((item) => {
          if (item.phase !== 'completed' && item.phase !== 'failed') {
            return true
          }

          return new Date(item.updatedAt).getTime() > cutoff
        })
      )
    }, 5000)

    return () => {
      window.clearInterval(timeoutId)
    }
  }, [])

  useEffect(() => {
    void refreshDevices('initial')
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return
      }

      void refreshDevices('poll')
    }, 5000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const availableDeviceIds = (deviceResponse?.devices ?? [])
      .filter((device) => device.state === 'device')
      .map((device) => device.id)

    if (!availableDeviceIds.length) {
      setSelectedDeviceId(null)
      setDeviceAppsResponse(null)
      setInstalledMetaStoreMatchesByPackageId({})
      setDeviceUserName(null)
      setDeviceLeftoverResponse(null)
      setDeviceLeftoverMessage(null)
      setSaveScanResponse(null)
      return
    }

    if (!selectedDeviceId || !availableDeviceIds.includes(selectedDeviceId)) {
      setSelectedDeviceId(availableDeviceIds[0])
    }
  }, [deviceResponse, selectedDeviceId])

  useEffect(() => {
    deviceResponseRef.current = deviceResponse
  }, [deviceResponse])

  useEffect(() => () => {
    clearInstalledAppsRefreshIdleTimer()
  }, [])

  useEffect(() => {
    if (!selectedDeviceId) {
      setDeviceAppsResponse(null)
      setInstalledMetaStoreMatchesByPackageId({})
      setDeviceUserName(null)
      setDeviceLeftoverResponse(null)
      setDeviceLeftoverMessage(null)
      setSaveScanResponse(null)
      return
    }

    void refreshInstalledApps(selectedDeviceId)
    void refreshDeviceUserName(selectedDeviceId)
    void refreshLeftoverData(selectedDeviceId, false)
  }, [selectedDeviceId])

  async function refreshDevices(
    mode: RefreshMode = 'manual',
    options?: { announceInQueue?: boolean; queueDetails?: string | null }
  ) {
    if (deviceRefreshInFlightRef.current) {
      return
    }

    deviceRefreshInFlightRef.current = true
    const announceInQueue = options?.announceInQueue ?? mode === 'manual'
    const queueId = announceInQueue
      ? enqueueLiveQueueItem({
          id: createLiveQueueId('scan', `devices-${mode}`),
          title: 'Device Refresh',
          subtitle: 'ADB Manager',
          kind: 'scan',
          phase: 'scanning',
          progress: 24,
          details: options?.queueDetails ?? 'Refreshing connected devices and runtime status...',
          artworkUrl: null
        })
      : null

    if (mode !== 'poll') {
      setDeviceBusy(true)
    }

    try {
      const response = await window.api.devices.list()
      const previousResponse = deviceResponseRef.current
      const changeMessage = hasCompletedInitialScanRef.current ? describeDeviceChanges(previousResponse, response) : null

      setDeviceResponse(response)

      if (mode === 'poll') {
        if (changeMessage) {
          setDeviceMessage(isObsoleteDeviceBanner(changeMessage) ? null : changeMessage)
        } else if (response.runtime.status === 'error') {
          setDeviceMessage(response.runtime.message)
        } else {
          setDeviceMessage(null)
        }
      } else {
        setDeviceMessage(isObsoleteDeviceBanner(response.runtime.message) ? null : response.runtime.message)
      }

      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: response.runtime.status === 'error' ? 'failed' : 'completed',
          progress: 100,
          details: changeMessage ?? response.runtime.message
        })
      }

      hasCompletedInitialScanRef.current = true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load devices.'
      setDeviceMessage(message)
      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: 'failed',
          progress: 100,
          details: message
        })
      }
    } finally {
      if (mode !== 'poll') {
        setDeviceBusy(false)
      }

      deviceRefreshInFlightRef.current = false
    }
  }

  async function ensureManagedDependencies() {
    try {
      const response: DependencyStatusResponse = await window.api.dependencies.ensureReady()
      setDependencyStatus(response)
      const failedStatuses = response.statuses.filter((entry) => entry.status !== 'ready')

      for (const failedStatus of failedStatuses) {
        const queueId = buildDependencyQueueId(failedStatus.id)
        dependencyQueueIdsRef.current.add(queueId)
        enqueueLiveQueueItem({
          id: queueId,
          title: `${failedStatus.title} Setup`,
          subtitle: 'Managed Dependencies',
          kind: 'download',
          phase: 'failed',
          progress: 100,
          details: failedStatus.message,
          artworkUrl: null
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to prepare managed dependencies.'
      setDependencyStatus(null)
      dependencyQueueIdsRef.current.add(buildDependencyQueueId('adb'))
      enqueueLiveQueueItem({
        id: buildDependencyQueueId('adb'),
        title: 'Dependency Bootstrap',
        subtitle: 'Managed Dependencies',
        kind: 'download',
        phase: 'failed',
        progress: 100,
        details: message,
        artworkUrl: null
      })
    }
  }

  async function loadSettings() {
    setSettingsBusy(true)

    try {
      const response = await window.api.settings.get()
      setSettings(response)
      if (!hasAppliedStartupTabRef.current) {
        setActiveTab(areCorePathsConfigured(response) ? 'games' : 'settings')
        hasAppliedStartupTabRef.current = true
      }

      const [
        libraryIndexResult,
        backupIndexResult,
        gameSavesStatsResult,
        saveBackupsResult,
        installedMetadataIndexResult
      ] = await Promise.allSettled([
        window.api.settings.getLocalLibraryIndex(),
        window.api.settings.getBackupStorageIndex(),
        window.api.settings.getPathStats('gameSavesPath'),
        window.api.savegames.listBackups(),
        window.api.metaStore.getInstalledPackageIndex()
      ])

      let nextLibraryIndex: LocalLibraryScanResponse | null = null
      let nextBackupIndex: LocalLibraryScanResponse | null = null
      const loadFailures: string[] = []

      if (libraryIndexResult.status === 'fulfilled') {
        nextLibraryIndex = libraryIndexResult.value
        setLocalLibraryIndex(nextLibraryIndex)
        if (isCacheRecoveryMessage(nextLibraryIndex.message)) {
          enqueueLiveQueueItem({
            id: createLiveQueueId('cleanup', 'library-cache-recovery'),
            title: 'Library Cache Recovery',
            subtitle: response.localLibraryPath ?? 'Local Library',
            kind: 'cleanup',
            phase: 'completed',
            progress: 100,
            details: nextLibraryIndex.message,
            artworkUrl: null
          })
        }
      } else {
        loadFailures.push(
          libraryIndexResult.reason instanceof Error
            ? `Local library: ${libraryIndexResult.reason.message}`
            : 'Local library: Unable to load the current index.'
        )
      }

      if (backupIndexResult.status === 'fulfilled') {
        nextBackupIndex = backupIndexResult.value
        setBackupStorageIndex(nextBackupIndex)
      } else {
        loadFailures.push(
          backupIndexResult.reason instanceof Error
            ? `Backup storage: ${backupIndexResult.reason.message}`
            : 'Backup storage: Unable to load the current index.'
        )
      }

      if (gameSavesStatsResult.status === 'fulfilled') {
        setGameSavesPathStats(gameSavesStatsResult.value)
      } else {
        loadFailures.push(
          gameSavesStatsResult.reason instanceof Error
            ? `Game Saves path: ${gameSavesStatsResult.reason.message}`
            : 'Game Saves path: Unable to inspect the configured folder.'
        )
      }

      if (saveBackupsResult.status === 'fulfilled') {
        setSaveBackupsResponse(saveBackupsResult.value)
      } else {
        loadFailures.push(
          saveBackupsResult.reason instanceof Error
            ? `Save snapshots: ${saveBackupsResult.reason.message}`
            : 'Save snapshots: Unable to load current backups.'
        )
      }

      if (installedMetadataIndexResult.status === 'fulfilled') {
        setInstalledMetaStoreMatchesByPackageId(
          Object.fromEntries(
            Object.entries(installedMetadataIndexResult.value.matches).map(([packageId, summary]) => [
              packageId.toLowerCase(),
              summary
            ])
          )
        )
      } else {
        loadFailures.push(
          installedMetadataIndexResult.reason instanceof Error
            ? `Installed metadata: ${installedMetadataIndexResult.reason.message}`
            : 'Installed metadata: Unable to load cached matches.'
        )
      }

      if (nextLibraryIndex || nextBackupIndex) {
        await refreshMetaStoreMatches(nextLibraryIndex, nextBackupIndex, { mode: 'incremental' })
      }

      if (response.localLibraryPath) {
        void (async () => {
          try {
            const refreshedLibraryIndex = await window.api.settings.rescanLocalLibrary()
            setLocalLibraryIndex(refreshedLibraryIndex)
            await refreshMetaStoreMatches(refreshedLibraryIndex, nextBackupIndex, { mode: 'incremental' })
          } catch (error) {
            enqueueLiveQueueItem({
              id: 'library-background-refresh-startup',
              title: 'Library Background Refresh',
              subtitle: response.localLibraryPath ?? 'Local Library',
              kind: 'scan',
              phase: 'failed',
              progress: 100,
              details: buildLiveQueueDetails(
                'Unable to refresh the local library in the background.',
                error instanceof Error ? error.message : 'Unknown error.'
              ),
              artworkUrl: null
            })
          }
        })()
      }

      if (loadFailures.length) {
        setGamesMessage({
          text: 'Loaded with partial startup errors.',
          details: loadFailures.join(' '),
          tone: 'danger'
        })
      } else {
        setSettingsMessage(null)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load settings.'
      setSettingsMessage(message)
    } finally {
      setSettingsBusy(false)
    }
  }

  async function loadVrSrc() {
    try {
      const [status, catalog] = await Promise.all([
        window.api.vrsrc.getStatus(),
        window.api.vrsrc.getCatalog()
      ])
      setVrSrcStatus(status)
      setVrSrcCatalog(catalog)
    } catch (error) {
      setVrSrcMessage({
        text: 'Unable to load vrSrc source status.',
        details: error instanceof Error ? error.message : 'Unknown error.',
        tone: 'danger'
      })
    }
  }

  async function syncVrSrcCatalog(options?: { openPanelOnSuccess?: boolean }) {
    setVrSrcSyncBusy(true)
    setVrSrcMessage(null)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', 'vrsrc-sync'),
      title: 'vrSrc Sync',
      subtitle: 'Remote Source',
      kind: 'scan',
      phase: 'scanning',
      progress: 18,
      details: 'Resolving credentials and refreshing the vrSrc catalog...',
      artworkUrl: null
    })

    try {
      const response = await window.api.vrsrc.syncCatalog()
      setVrSrcStatus(response.status)
      setVrSrcCatalog(response.catalog)
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: buildVrSrcSyncLiveQueueDetails(response)
      })
      if (response.success) {
        setVrSrcMessage(null)
        if (options?.openPanelOnSuccess !== false) {
          setIsVrSrcPanelOpen(true)
        }
      } else {
        setVrSrcMessage(null)
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details
      })
      setVrSrcMessage(null)
    } finally {
      setVrSrcSyncBusy(false)
    }
  }

  async function queueVrSrcTransferAction(options: {
    releaseName: string
    operation: VrSrcTransferOperation
    title: string
    subtitle: string
    execute: () => Promise<{
      success: boolean
      cancelled: boolean
      message: string
      details: string | null
      packageName?: string | null
    }>
    retryAfterSignatureMismatch?: () => Promise<{
      success: boolean
      cancelled: boolean
      message: string
      details: string | null
      packageName?: string | null
    }>
    serialForRecovery?: string | null
    onInstalledAppsChanged?: () => void
    onSuccess?: () => Promise<void>
    onFailureText: string
  }) {
    if (vrSrcActionBusyReleaseNamesRef.current.includes(options.releaseName)) {
      return
    }

    const queueId = buildVrSrcQueueId(options.operation, options.releaseName)
    vrSrcActionBusyReleaseNamesRef.current = [...vrSrcActionBusyReleaseNamesRef.current, options.releaseName]
    setVrSrcActionBusyReleaseNames((current) => [...current, options.releaseName])

    enqueueLiveQueueItem({
      id: queueId,
      title: options.title,
      subtitle: options.subtitle,
      kind: options.operation === 'install-now' || options.operation === 'download-to-library-and-install' ? 'install' : 'download',
      phase: 'downloading',
      progress: 4,
      details: 'Preparing download...',
      artworkUrl: null,
      transferControl: {
        kind: 'vrsrc',
        operation: options.operation,
        releaseName: options.releaseName,
        canPause: true,
        canResume: false,
        canCancel: true
      }
    })

    try {
      let response = await options.execute()
      if (
        isSignatureMismatchFailure(response) &&
        options.serialForRecovery &&
        response.packageName &&
        options.retryAfterSignatureMismatch
      ) {
        const confirmed = await requestSignatureMismatchConfirmation(response.packageName)

        if (confirmed) {
          updateLiveQueueItem(queueId, {
            phase: 'uninstalling',
            progress: 52,
            details: `Installed copy uses a different signature. Removing ${response.packageName} before retrying...`,
            transferControl: null
          })

          const uninstallResponse = await window.api.devices.uninstallInstalledApp(options.serialForRecovery, response.packageName)
          if (!uninstallResponse.success) {
            updateLiveQueueItem(queueId, {
              phase: 'failed',
              progress: 100,
              details: uninstallResponse.details ?? uninstallResponse.message,
              transferControl: null
            })
            setVrSrcMessage(null)
            return
          }

          options.onInstalledAppsChanged?.()
          updateLiveQueueItem(queueId, {
            phase: 'installing',
            progress: 58,
            details: `Removed ${response.packageName}. Retrying install...`,
            transferControl: null
          })
          response = await options.retryAfterSignatureMismatch()
        }
      }

      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : response.cancelled ? 'cancelled' : 'failed',
        progress: 100,
        details: buildLiveQueueDetails(response.message, response.details),
        transferControl: null
      })
      if (response.success) {
        setVrSrcMessage(null)
        await options.onSuccess?.()
      } else {
        setVrSrcMessage(null)
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details,
        transferControl: null
      })
      setVrSrcMessage(null)
    } finally {
      vrSrcActionBusyReleaseNamesRef.current = vrSrcActionBusyReleaseNamesRef.current.filter(
        (entry) => entry !== options.releaseName
      )
      setVrSrcActionBusyReleaseNames((current) => current.filter((entry) => entry !== options.releaseName))
    }
  }

  async function clearVrSrcCache() {
    setVrSrcMaintenanceBusy(true)
    setVrSrcMessage(null)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', 'vrsrc-cache'),
      title: 'vrSrc Cache',
      subtitle: 'Remote Source',
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 16,
      details: 'Clearing cached vrSrc metadata, downloads, and credentials...',
      artworkUrl: null
    })

    try {
      const response = await window.api.vrsrc.clearCache()
      setVrSrcStatus(response.status)
      setVrSrcCatalog(response.catalog)
      setIsVrSrcPanelOpen(false)
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: buildLiveQueueDetails(response.message, response.details)
      })
      setVrSrcMessage(null)
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details
      })
      setVrSrcMessage(null)
    } finally {
      setVrSrcMaintenanceBusy(false)
    }
  }

  async function downloadVrSrcToLibrary(releaseName: string) {
    setVrSrcMessage(null)
    await queueVrSrcTransferAction({
      releaseName,
      operation: 'download-to-library',
      title: releaseName,
      subtitle: 'vrSrc to Local Library',
      execute: () => window.api.vrsrc.downloadToLibrary(releaseName),
      onFailureText: `Unable to add ${releaseName} from vrSrc.`
    })
  }

  async function installVrSrcNow(releaseName: string) {
    const targetDeviceId = selectedDeviceId
    if (!targetDeviceId) {
      setVrSrcMessage({
        text: 'Select a ready headset before installing from vrSrc.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setVrSrcMessage(null)
    beginInstalledAppsMutation(targetDeviceId)
    let shouldRefreshInstalledApps = false
    await queueVrSrcTransferAction({
      releaseName,
      operation: 'install-now',
      title: releaseName,
      subtitle: 'vrSrc Install Now',
      execute: () => window.api.vrsrc.installNow(targetDeviceId, releaseName),
      retryAfterSignatureMismatch: () => window.api.vrsrc.installNow(targetDeviceId, releaseName),
      serialForRecovery: targetDeviceId,
      onInstalledAppsChanged: () => {
        shouldRefreshInstalledApps = true
      },
      onSuccess: async () => {
        shouldRefreshInstalledApps = true
      },
      onFailureText: `Unable to install ${releaseName} from vrSrc.`
    })
    endInstalledAppsMutation(targetDeviceId, shouldRefreshInstalledApps)
  }

  async function downloadVrSrcToLibraryAndInstall(releaseName: string) {
    const targetDeviceId = selectedDeviceId
    if (!targetDeviceId) {
      setVrSrcMessage({
        text: 'Select a ready headset before downloading and installing from vrSrc.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setVrSrcMessage(null)
    beginInstalledAppsMutation(targetDeviceId)
    let shouldRefreshInstalledApps = false
    await queueVrSrcTransferAction({
      releaseName,
      operation: 'download-to-library-and-install',
      title: releaseName,
      subtitle: 'vrSrc Download & Install',
      execute: () => window.api.vrsrc.downloadToLibraryAndInstall(targetDeviceId, releaseName),
      retryAfterSignatureMismatch: () => window.api.vrsrc.downloadToLibraryAndInstall(targetDeviceId, releaseName),
      serialForRecovery: targetDeviceId,
      onInstalledAppsChanged: () => {
        shouldRefreshInstalledApps = true
      },
      onSuccess: async () => {
        shouldRefreshInstalledApps = true
        const [libraryIndex, backupIndex] = await Promise.all([
          window.api.settings.getLocalLibraryIndex(),
          window.api.settings.getBackupStorageIndex()
        ])
        setLocalLibraryIndex(libraryIndex)
        setBackupStorageIndex(backupIndex)
      },
      onFailureText: `Unable to download and install ${releaseName} from vrSrc.`
    })
    endInstalledAppsMutation(targetDeviceId, shouldRefreshInstalledApps)
  }

  useEffect(() => {
    setGamesDisplayModeState(settings?.gamesDisplayMode ?? 'gallery')
    setInventoryDisplayModeState(settings?.inventoryDisplayMode ?? 'gallery')
  }, [settings?.gamesDisplayMode, settings?.inventoryDisplayMode])

  useEffect(() => {
    const unsubscribe = window.api.settings.onIndexUpdated((update) => {
      if (update.source === 'library') {
        setLocalLibraryIndex(update.index)
        void refreshMetaStoreMatchesForIndexUpdate(update, {
          announceInQueue: update.trigger === 'watch',
          queueTitle: 'Library Watch Refresh',
          queueSubtitle: settings?.localLibraryPath ?? 'Local Library',
          queueDetails: update.index.message
        })
        return
      }

      setBackupStorageIndex(update.index)
      void refreshMetaStoreMatchesForIndexUpdate(update, {
        announceInQueue: update.trigger === 'watch',
        queueTitle: 'Backup Watch Refresh',
        queueSubtitle: settings?.backupPath ?? 'Backup Storage',
        queueDetails: update.index.message
      })
    })

    return () => {
      unsubscribe()
    }
  }, [settings?.backupPath, settings?.localLibraryPath])

  useEffect(() => {
    const unsubscribe = window.api.vrsrc.onTransferProgress((update) => {
      const queueId = buildVrSrcQueueId(update.operation, update.releaseName)
      updateLiveQueueItem(queueId, {
        phase: (() => {
          if (update.phase === 'queued') {
            return 'queued'
          }

          if (update.phase === 'paused') {
            return 'paused'
          }

          if (update.phase === 'cancelled') {
            return 'cancelled'
          }

          if (update.phase === 'extracting') {
            return 'extracting'
          }

          if (update.phase === 'installing') {
            return 'installing'
          }

          return 'downloading'
        })(),
        progress: update.progress,
        details: describeVrSrcTransfer(update),
        transferControl:
          update.phase === 'installing' || update.phase === 'cancelled'
            ? null
            : {
                kind: 'vrsrc',
                operation: update.operation,
                releaseName: update.releaseName,
                canPause: update.canPause,
                canResume: update.canResume,
                canCancel: update.canCancel
              }
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  async function pauseVrSrcTransfer(releaseName: string, operation: VrSrcTransferOperation) {
    await window.api.vrsrc.pauseTransfer(releaseName, operation)
  }

  async function resumeVrSrcTransfer(releaseName: string, operation: VrSrcTransferOperation) {
    await window.api.vrsrc.resumeTransfer(releaseName, operation)
  }

  async function cancelVrSrcTransfer(releaseName: string, operation: VrSrcTransferOperation) {
    await window.api.vrsrc.cancelTransfer(releaseName, operation)
  }

  async function saveDisplayMode(key: SettingsDisplayModeKey, mode: ViewDisplayMode) {
    const previousSettings = settings
    const previousGamesDisplayMode = gamesDisplayMode
    const previousInventoryDisplayMode = inventoryDisplayMode

    if (key === 'gamesDisplayMode') {
      setGamesDisplayModeState(mode)
    } else {
      setInventoryDisplayModeState(mode)
    }

    setSettings((current) => (current ? { ...current, [key]: mode } : current))

    try {
      const nextSettings = await window.api.settings.setDisplayMode(key, mode)
      setSettings(nextSettings)
      setSettingsMessage(null)
    } catch (error) {
      setSettings(previousSettings)
      setGamesDisplayModeState(previousGamesDisplayMode)
      setInventoryDisplayModeState(previousInventoryDisplayMode)
      setSettingsMessage(error instanceof Error ? error.message : 'Unable to save view preference.')
    }
  }

  async function refreshInstalledApps(serial: string) {
    setDeviceAppsBusy(true)
    let handedOffMetadataRefresh = false
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `installed-apps-${serial}`),
      title: 'Installed Apps Refresh',
      subtitle: serial,
      kind: 'scan',
      phase: 'scanning',
      progress: 28,
      details: 'Refreshing installed apps from the headset...',
      artworkUrl: null
    })

    try {
      const response = await window.api.devices.listInstalledApps(serial)
      setDeviceAppsResponse(response)
      setDeviceAppsMessage(response.runtime.message)
      setInventoryMessage(null)
      const installedAppChangeDetails = buildInstalledAppChangeDetails(response.change)

      if (response.runtime.status === 'error') {
        updateLiveQueueItem(queueId, {
          phase: 'failed',
          progress: 100,
          details: response.runtime.message
        })
        return
      }

      handedOffMetadataRefresh = true
      setDeviceAppsBusy(false)
      const installedPackageCount = response.apps.length
      updateLiveQueueItem(queueId, {
        phase: 'scanning',
        progress: 72,
        details: [
          response.runtime.message,
          installedAppChangeDetails,
          'Installed apps loaded. Checking cached metadata before any background refresh...'
        ]
          .filter(Boolean)
          .join(' ')
      })

      void refreshInstalledAppMetadata(response, ({ completed, total, resolvedCount, phase }) => {
        const progressBase = 72
        const progressSpan = 26
        const normalizedTotal = Math.max(total, 1)
        const nextProgress =
          phase === 'persisting'
            ? 99
            : progressBase + Math.round((completed / normalizedTotal) * progressSpan)

        updateLiveQueueItem(queueId, {
          phase: 'scanning',
          progress: Math.min(99, nextProgress),
          details:
            phase === 'persisting'
              ? `Installed apps loaded. Saving refreshed metadata index (${resolvedCount}/${total})...`
              : total > 0
                ? `Installed apps loaded. Refreshing metadata in the background (${completed}/${total}, ${resolvedCount} matched)...`
                : `Installed apps loaded. Installed metadata is already current (${resolvedCount}/${installedPackageCount} matched).`
        })
      })
        .then((metadataMatches) => {
          updateLiveQueueItem(queueId, {
            phase: 'completed',
            progress: 100,
            details: [
              response.runtime.message,
              installedAppChangeDetails,
              `Resolved metadata for ${Object.keys(metadataMatches).length} installed package${Object.keys(metadataMatches).length === 1 ? '' : 's'}.`
            ]
              .filter(Boolean)
              .join(' ')
          })
        })
        .catch((error) => {
          const metadataMessage =
            error instanceof Error ? error.message : 'Installed metadata refresh did not complete.'
          updateLiveQueueItem(queueId, {
            phase: 'completed',
            progress: 100,
            details: [
              response.runtime.message,
              installedAppChangeDetails,
              `Installed apps loaded, but metadata is still pending: ${metadataMessage}`
            ]
              .filter(Boolean)
              .join(' ')
          })
        })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load installed apps.'
      setDeviceAppsMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      if (!handedOffMetadataRefresh) {
        setDeviceAppsBusy(false)
      }
    }
  }

  async function refreshInstalledAppMetadata(
    response: DeviceAppsResponse | null,
    onProgress?: (update: {
      completed: number
      total: number
      resolvedCount: number
      phase: 'hydrating' | 'persisting'
    }) => void
  ): Promise<Record<string, MetaStoreGameSummary>> {
    const packageIds = Array.from(
      new Set((response?.apps ?? []).map((app) => app.packageId.trim()).filter(Boolean))
    )
    const normalizedPackageIds = packageIds.map((packageId) => packageId.toLowerCase())
    const normalizedPackageIdSet = new Set(normalizedPackageIds)

    if (!packageIds.length) {
      setInstalledMetaStoreMatchesByPackageId({})
      void window.api.metaStore.replaceInstalledPackageIndex({})
      return {}
    }

    const installedIndexResponse = await window.api.metaStore.getInstalledPackageIndex()
    const nextMatches: Record<string, MetaStoreGameSummary> = Object.fromEntries(
      Object.entries(installedIndexResponse.matches)
        .map(([packageId, summary]) => [packageId.toLowerCase(), summary] as const)
        .filter(([packageId]) => normalizedPackageIdSet.has(packageId))
    )

    setInstalledMetaStoreMatchesByPackageId(nextMatches)

    const missingPackageIds = packageIds.filter((packageId) => !nextMatches[packageId.toLowerCase()])
    const cachedMissingMatches =
      missingPackageIds.length > 0 ? await window.api.metaStore.peekCachedMatchesByPackageIds(missingPackageIds) : null

    for (const [packageId, summary] of Object.entries(cachedMissingMatches?.matches ?? {})) {
      nextMatches[packageId.toLowerCase()] = summary
    }

    if (cachedMissingMatches?.matches && Object.keys(cachedMissingMatches.matches).length > 0) {
      setInstalledMetaStoreMatchesByPackageId((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(cachedMissingMatches.matches).map(([packageId, summary]) => [packageId.toLowerCase(), summary])
        )
      }))
    }

    const packageIdsNeedingHydration = packageIds.filter((packageId) => !nextMatches[packageId.toLowerCase()])

    onProgress?.({
      completed: 0,
      total: packageIdsNeedingHydration.length,
      resolvedCount: Object.keys(nextMatches).length,
      phase: 'hydrating'
    })

    const chunkSize = 4
    let completed = 0

    for (let offset = 0; offset < packageIdsNeedingHydration.length; offset += chunkSize) {
      const chunk = packageIdsNeedingHydration.slice(offset, offset + chunkSize)
      const matchesResponse = await window.api.metaStore.getCachedMatchesByPackageIds(chunk)

      for (const [packageId, summary] of Object.entries(matchesResponse.matches)) {
        nextMatches[packageId.toLowerCase()] = summary
      }

      completed += chunk.length
      setInstalledMetaStoreMatchesByPackageId((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(matchesResponse.matches).map(([packageId, summary]) => [packageId.toLowerCase(), summary])
        )
      }))
      onProgress?.({
        completed,
        total: packageIdsNeedingHydration.length,
        resolvedCount: Object.keys(nextMatches).length,
        phase: 'hydrating'
      })
    }

    onProgress?.({
      completed: packageIdsNeedingHydration.length,
      total: packageIdsNeedingHydration.length,
      resolvedCount: Object.keys(nextMatches).length,
      phase: 'persisting'
    })

    void window.api.metaStore.replaceInstalledPackageIndex(nextMatches).catch(() => {
      // The UI already has the refreshed matches; persistence can fail independently.
    })

    setInstalledMetaStoreMatchesByPackageId(nextMatches)
    return nextMatches
  }

  async function refreshLeftoverData(serial: string, announceInQueue = true) {
    setDeviceLeftoverBusy(true)
    const queueId = announceInQueue
      ? enqueueLiveQueueItem({
          id: createLiveQueueId('scan', serial),
          title: 'Orphaned OBB / Data',
          subtitle: serial,
          kind: 'scan',
          phase: 'scanning',
          progress: 36,
          details: 'Scanning /sdcard/Android/obb and /sdcard/Android/data for leftover folders...',
          artworkUrl: null
        })
      : null

    try {
      const response = await window.api.devices.scanLeftoverData(serial)
      setDeviceLeftoverResponse(response)
      setDeviceLeftoverMessage(response.message)
      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: response.runtime.status === 'error' ? 'failed' : 'completed',
          progress: 100,
          details: response.message
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to scan leftover headset data.'
      setDeviceLeftoverResponse(null)
      setDeviceLeftoverMessage(message)
      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: 'failed',
          progress: 100,
          details: message
        })
      }
    } finally {
      setDeviceLeftoverBusy(false)
    }
  }

  async function refreshDeviceUserName(serial: string) {
    setDeviceUserNameBusy(true)

    try {
      const response = await window.api.devices.getUserName(serial)
      setDeviceUserName(response.success ? response.userName : null)
    } finally {
      setDeviceUserNameBusy(false)
    }
  }

  async function refreshSaveBackups() {
    try {
      const response = await window.api.savegames.listBackups()
      setSaveBackupsResponse(response)
    } catch (error) {
      setSaveGamesMessage({
        text: 'Unable to load save snapshots.',
        details: error instanceof Error ? error.message : 'Unknown error.',
        tone: 'danger'
      })
    }
  }

  async function scanSavePackages(
    announceInQueue = true,
    packagesOverride?: Array<{ packageId: string; appName: string | null }>,
    options?: {
      queueTitle?: string
      queueSubtitle?: string | null
      queueDetails?: string
      mergeResults?: boolean
    }
  ): Promise<SavePackagesScanResponse | null> {
    if (!selectedDeviceId) {
      setSaveGamesMessage({
        text: 'Select a ready headset in ADB Manager before scanning save data.',
        details: null,
        tone: 'danger'
      })
      return null
    }

    const packages =
      packagesOverride ??
      (deviceAppsResponse?.apps ?? []).map((app) => ({
        packageId: app.packageId,
        appName: app.label ?? app.inferredLabel
      }))

    if (!packages.length) {
      setSaveGamesMessage({
        text: 'Load installed apps before scanning headset save data.',
        details: null,
        tone: 'danger'
      })
      return null
    }

    setSaveGamesBusy(true)
    const queueId = announceInQueue
      ? enqueueLiveQueueItem({
          id: createLiveQueueId('scan', `save-scan-${selectedDeviceId}`),
          title: options?.queueTitle ?? 'Save data scan',
          subtitle: options?.queueSubtitle ?? selectedDeviceId,
          kind: 'scan',
          phase: 'scanning',
          progress: 24,
          details: options?.queueDetails ?? 'Scanning installed packages for external save data...',
          artworkUrl: null
        })
      : null

    try {
      const response = await window.api.savegames.scanPackages(selectedDeviceId, packages)
      setSaveScanResponse((current) => {
        if (!options?.mergeResults) {
          return response
        }

        const mergedResults = new Map<string, SavePackagesScanResponse['results'][number]>()
        for (const entry of current?.results ?? []) {
          mergedResults.set(entry.packageId.toLowerCase(), entry)
        }
        for (const entry of response.results) {
          mergedResults.set(entry.packageId.toLowerCase(), entry)
        }

        return {
          ...response,
          results: Array.from(mergedResults.values())
        }
      })
      setSaveGamesMessage(
        response.runtime.status === 'error'
          ? {
              text: response.message,
              details: null,
              tone: 'danger'
            }
          : null
      )
      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: response.runtime.status === 'error' ? 'failed' : 'completed',
          progress: 100,
          details: response.message
        })
      }
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to scan headset save data.'
      setSaveGamesMessage({
        text: 'Unable to scan headset save data.',
        details: message,
        tone: 'danger'
      })
      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: 'failed',
          progress: 100,
          details: message
        })
      }
      return null
    } finally {
      setSaveGamesBusy(false)
    }
  }

  async function backupSavePackage(
    packageId: string,
    appName: string | null,
    options: { refreshAfter?: boolean; suppressMessage?: boolean } = {}
  ) {
    if (!selectedDeviceId) {
      setSaveGamesMessage({
        text: 'Select a ready headset before backing up save data.',
        details: null,
        tone: 'danger'
      })
      return
    }

    const refreshAfter = options.refreshAfter ?? true
    const suppressMessage = options.suppressMessage ?? false

    setSaveGamesActionBusyPackageId(packageId)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('backup', `save-${packageId}`),
      title: appName ?? packageId,
      subtitle: 'Save snapshot',
      kind: 'backup',
      phase: 'backing-up',
      progress: 28,
      details: `Backing up save data for ${packageId}...`,
      artworkUrl: resolveQueueArtworkFromSummary(findMetaStoreMatchByPackageId(packageId))
    })

    try {
      const response = await window.api.savegames.backupPackage(selectedDeviceId, packageId, appName)
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.message
      })
      if (!suppressMessage) {
        setSaveGamesMessage(
          response.success
            ? null
            : {
                text: response.message,
                details: response.details,
                tone: 'danger'
              }
        )
      }
      if (response.success) {
        if (refreshAfter) {
          await refreshSaveBackups()
          if (saveScanResponse) {
            await scanSavePackages(
              false,
              [{ packageId, appName }],
              {
                mergeResults: true
              }
            )
          }
        }
      }
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to back up save data.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      if (!suppressMessage) {
        setSaveGamesMessage({
          text: 'Unable to back up save data.',
          details: message,
          tone: 'danger'
        })
      }
      return null
    } finally {
      setSaveGamesActionBusyPackageId(null)
    }
  }

  async function backupAllSavePackages() {
    if (!selectedDeviceId) {
      setSaveGamesMessage({
        text: 'Select a ready headset before backing up save data.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setSaveGamesBatchBusy(true)
    const batchQueueId = enqueueLiveQueueItem({
      id: createLiveQueueId('backup', `save-batch-${selectedDeviceId}`),
      title: 'Batch Save Backup',
      subtitle: selectedDeviceId,
      kind: 'backup',
      phase: 'backing-up',
      progress: 12,
      details: 'Scanning the headset for titles with live save data...',
      artworkUrl: null
    })

    try {
      const latestScan = await scanSavePackages(false)

      const availableResults = (latestScan?.results ?? []).filter((result) => result.status === 'available')
      if (!availableResults.length) {
        updateLiveQueueItem(batchQueueId, {
          phase: 'completed',
          progress: 100,
          details: 'No live save data was found to back up.'
        })
        setSaveGamesMessage(null)
        return
      }

      let succeeded = 0
      let failed = 0

      for (let index = 0; index < availableResults.length; index += 1) {
        const entry = availableResults[index]
        updateLiveQueueItem(batchQueueId, {
          progress: Math.round(18 + (index / availableResults.length) * 72),
          details: `Backing up ${entry.appName || entry.packageId} (${index + 1}/${availableResults.length})...`
        })
        const response = await backupSavePackage(entry.packageId, entry.appName, {
          refreshAfter: false,
          suppressMessage: true
        })
        if (response?.success) {
          succeeded += 1
        } else {
          failed += 1
        }
      }

      await refreshSaveBackups()
      await scanSavePackages(false)

      const summary = `Finished backing up ${availableResults.length} title${availableResults.length === 1 ? '' : 's'}: ${succeeded} succeeded, ${failed} failed.`
      updateLiveQueueItem(batchQueueId, {
        phase: failed > 0 ? 'completed' : 'completed',
        progress: 100,
        details: summary
      })
      setSaveGamesMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to batch back up save data.'
      updateLiveQueueItem(batchQueueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setSaveGamesMessage({
        text: 'Unable to batch back up save data.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setSaveGamesBatchBusy(false)
    }
  }

  async function restoreSaveBackup(packageId: string, backupId: string, appName: string | null) {
    if (!selectedDeviceId) {
      setSaveGamesMessage({
        text: 'Select a ready headset before restoring a save snapshot.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setSaveGamesRestoreBusyBackupId(backupId)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('restore', `save-${packageId}`),
      title: appName ?? packageId,
      subtitle: 'Save restore',
      kind: 'restore',
      phase: 'restoring',
      progress: 30,
      details: `Restoring a saved state for ${packageId}...`,
      artworkUrl: resolveQueueArtworkFromSummary(findMetaStoreMatchByPackageId(packageId))
    })

    try {
      const response = await window.api.savegames.restoreBackup(selectedDeviceId, packageId, backupId)
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.message
      })
      setSaveGamesMessage(
        response.success
          ? null
          : {
              text: response.message,
              details: response.details,
              tone: 'danger'
            }
      )
      if (response.success && saveScanResponse) {
        await scanSavePackages(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to restore that save snapshot.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setSaveGamesMessage({
        text: 'Unable to restore that save snapshot.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setSaveGamesRestoreBusyBackupId(null)
    }
  }

  async function deleteSaveBackup(backupId: string) {
    setSaveGamesDeleteBusyBackupId(backupId)
    const existingEntry = saveBackupsResponse?.entries.find((entry) => entry.id === backupId) ?? null
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', `save-${backupId}`),
      title: existingEntry?.appName ?? existingEntry?.packageId ?? 'Save snapshot',
      subtitle: 'Delete snapshot',
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 34,
      details: 'Deleting saved state from the Game Saves folder...',
      artworkUrl: resolveQueueArtworkFromSummary(
        existingEntry ? findMetaStoreMatchByPackageId(existingEntry.packageId) : null
      )
    })

    try {
      const response = await window.api.savegames.deleteBackup(backupId)
      updateLiveQueueItem(queueId, {
        phase: response.deleted ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.message
      })
      setSaveGamesMessage(
        response.deleted
          ? null
          : {
              text: response.message,
              details: response.details,
              tone: 'danger'
            }
      )
      await refreshSaveBackups()
      if (saveScanResponse) {
        await scanSavePackages(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete that save snapshot.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setSaveGamesMessage({
        text: 'Unable to delete that save snapshot.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setSaveGamesDeleteBusyBackupId(null)
    }
  }

  async function saveDeviceUserName(userName: string) {
    if (!selectedDeviceId) {
      setGamesMessage({
        text: 'Connect a headset before updating the multiplayer username.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setDeviceUserNameBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `user-name-${selectedDeviceId}`),
      title: 'Multiplayer Username',
      subtitle: selectedDeviceId,
      kind: 'scan',
      phase: 'scanning',
      progress: 34,
      details: `Saving "${userName}" to the selected headset...`,
      artworkUrl: null
    })

    try {
      const response = await window.api.devices.setUserName(selectedDeviceId, userName)

      if (response.success) {
        updateLiveQueueItem(queueId, {
          phase: 'completed',
          progress: 100,
          details: `Saved "${response.userName}" as the multiplayer username.`
        })
        setDeviceUserName(response.userName)
        setGamesMessage(null)
        return
      }

      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: response.message
      })
      setGamesMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setGamesMessage(null)
    } finally {
      setDeviceUserNameBusy(false)
    }
  }

  async function connectToDevice(address: string) {
    setDeviceBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `connect-${address}`),
      title: 'ADB Connection',
      subtitle: address,
      kind: 'scan',
      phase: 'scanning',
      progress: 26,
      details: `Connecting to ${address}...`,
      artworkUrl: null
    })

    try {
      const response = await window.api.devices.connect(address)
      setDeviceMessage(response.message)
      updateLiveQueueItem(queueId, {
        progress: 68,
        details: response.message
      })
      await refreshDevices('manual', {
        announceInQueue: false,
        queueDetails: null
      })
      const nextSelectedId = response.serial ?? selectedDeviceId
      if (nextSelectedId) {
        setSelectedDeviceId(nextSelectedId)
      }
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to connect to device.'
      setDeviceMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      setDeviceBusy(false)
    }
  }

  async function disconnectDevice(serial: string) {
    setDeviceBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', `disconnect-${serial}`),
      title: 'ADB Disconnect',
      subtitle: serial,
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 26,
      details: `Disconnecting ${serial}...`,
      artworkUrl: null
    })

    try {
      const response = await window.api.devices.disconnect(serial)
      setDeviceMessage(response.message)
      updateLiveQueueItem(queueId, {
        progress: 68,
        details: response.message
      })
      await refreshDevices('manual', {
        announceInQueue: false,
        queueDetails: null
      })
      if (selectedDeviceId === serial) {
        setSelectedDeviceId(null)
        setDeviceAppsResponse(null)
        setDeviceLeftoverResponse(null)
        setDeviceLeftoverMessage(null)
      }
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to disconnect device.'
      setDeviceMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      setDeviceBusy(false)
    }
  }

  async function chooseSettingsPath(key: SettingsPathKey) {
    setSettingsBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `settings-path-${key}`),
      title: formatSettingsPathLabel(key),
      subtitle: 'Change Folder',
      kind: 'scan',
      phase: 'scanning',
      progress: 24,
      details: `Choosing a new folder for ${formatSettingsPathLabel(key)}...`,
      artworkUrl: null
    })

    try {
      const response = await window.api.settings.choosePath(key)
      setSettings(response.settings)
      if (response.canceled) {
        updateLiveQueueItem(queueId, {
          phase: 'completed',
          progress: 100,
          details: `Folder selection for ${formatSettingsPathLabel(key)} was canceled.`
        })
        return
      }
      if (!response.canceled && key === 'localLibraryPath') {
        const [libraryIndex, backupIndex] = await Promise.all([
          window.api.settings.getLocalLibraryIndex(),
          window.api.settings.getBackupStorageIndex()
        ])
        setLocalLibraryIndex(libraryIndex)
        setBackupStorageIndex(backupIndex)
        await refreshMetaStoreMatches(libraryIndex, backupIndex)
      }
      if (!response.canceled && key === 'backupPath') {
        const backupIndex = await window.api.settings.getBackupStorageIndex()
        setBackupStorageIndex(backupIndex)
        await refreshMetaStoreMatches(localLibraryIndex, backupIndex)
      }
      if (!response.canceled && key === 'gameSavesPath') {
        const [gameSavesStats, saveBackups] = await Promise.all([
          window.api.settings.getPathStats('gameSavesPath'),
          window.api.savegames.listBackups()
        ])
        setGameSavesPathStats(gameSavesStats)
        setSaveBackupsResponse(saveBackups)
      }
      setSettingsMessage(response.canceled ? null : 'Folder updated.')
      updateLiveQueueItem(queueId, {
        phase: 'completed',
        progress: 100,
        details: `${formatSettingsPathLabel(key)} folder updated.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to choose a folder.'
      setSettingsMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      setSettingsBusy(false)
    }
  }

  async function clearSettingsPath(key: SettingsPathKey) {
    setSettingsBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', `settings-clear-${key}`),
      title: formatSettingsPathLabel(key),
      subtitle: 'Clear Folder',
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 26,
      details: `Clearing the configured folder for ${formatSettingsPathLabel(key)}...`,
      artworkUrl: null
    })

    try {
      const response = await window.api.settings.clearPath(key)
      setSettings(response)
      if (key === 'localLibraryPath') {
        const [libraryIndex, backupIndex] = await Promise.all([
          window.api.settings.getLocalLibraryIndex(),
          window.api.settings.getBackupStorageIndex()
        ])
        setLocalLibraryIndex(libraryIndex)
        setBackupStorageIndex(backupIndex)
        await refreshMetaStoreMatches(libraryIndex, backupIndex)
      }
      if (key === 'backupPath') {
        const backupIndex = await window.api.settings.getBackupStorageIndex()
        setBackupStorageIndex(backupIndex)
        await refreshMetaStoreMatches(localLibraryIndex, backupIndex)
      }
      if (key === 'gameSavesPath') {
        const [gameSavesStats, saveBackups] = await Promise.all([
          window.api.settings.getPathStats('gameSavesPath'),
          window.api.savegames.listBackups()
        ])
        setGameSavesPathStats(gameSavesStats)
        setSaveBackupsResponse(saveBackups)
        setSaveScanResponse(null)
      }
      setSettingsMessage('Folder cleared.')
      updateLiveQueueItem(queueId, {
        phase: 'completed',
        progress: 100,
        details: `${formatSettingsPathLabel(key)} folder cleared.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to clear the folder.'
      setSettingsMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      setSettingsBusy(false)
    }
  }

  async function rescanLocalLibrary() {
    setLibraryRescanBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', 'library-rescan'),
      title: 'Library Scan',
      subtitle: settings?.localLibraryPath ?? 'Local Library',
      kind: 'scan',
      phase: 'scanning',
      progress: 20,
      details: 'Scanning the local library for package changes...',
      artworkUrl: null
    })

    try {
      const response = await window.api.settings.rescanLocalLibrary()
      setLocalLibraryIndex(response)
      updateLiveQueueItem(queueId, {
        progress: 60,
        details: response.message
      })
      await refreshMetaStoreMatches(response, undefined, {
        announceInQueue: true,
        queueTitle: 'Metadata Refresh',
        queueSubtitle: 'Library Scan',
        mode: 'incremental'
      })
      updateLiveQueueItem(queueId, {
        phase: 'completed',
        progress: 100,
        details: response.message
      })
      setSettingsMessage(response.message)
      setIsLibraryScanDialogOpen(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to rescan the local library.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setSettingsMessage(message)
    } finally {
      setLibraryRescanBusy(false)
    }
  }

  async function removeMissingLibraryItem(itemId: string) {
    setRemoveMissingLibraryItemBusyId(itemId)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', `library-missing-${itemId}`),
      title: findIndexedItemDisplayName('library', itemId, 'Missing library item'),
      subtitle: 'Remove Missing Entry',
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 30,
      details: 'Removing the missing library entry from the index...',
      artworkUrl: findIndexedItemArtwork('library', itemId)
    })

    try {
      const response = await window.api.settings.removeMissingLibraryItem(itemId)
      setLocalLibraryIndex(response.index)
      await refreshMetaStoreMatches(response.index)
      setSettingsMessage(response.message)
      updateLiveQueueItem(queueId, {
        phase: 'completed',
        progress: 100,
        details: response.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove the missing library entry.'
      setSettingsMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      setRemoveMissingLibraryItemBusyId(null)
    }
  }

  async function purgeLibraryItem(itemId: string) {
    setPurgeLibraryItemBusyId(itemId)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', `library-purge-${itemId}`),
      title: findIndexedItemDisplayName('library', itemId, 'Library item'),
      subtitle: 'Purge Entry',
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 32,
      details: 'Purging the selected library entry and its index record...',
      artworkUrl: findIndexedItemArtwork('library', itemId)
    })

    try {
      const response = await window.api.settings.purgeLibraryItem(itemId)
      setLocalLibraryIndex(response.index)
      await refreshMetaStoreMatches(response.index)
      setSettingsMessage(response.message)
      updateLiveQueueItem(queueId, {
        phase: 'completed',
        progress: 100,
        details: response.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to purge the library entry.'
      setSettingsMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      setPurgeLibraryItemBusyId(null)
    }
  }

  async function saveLocalLibraryItemManualStoreId(itemId: string, storeId: string) {
    setSettingsBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `manual-store-id-${itemId}`),
      title: findIndexedItemDisplayName('library', itemId, 'Manual Store ID'),
      subtitle: 'Save Store ID',
      kind: 'scan',
      phase: 'scanning',
      progress: 34,
      details: `Saving manual store ID ${storeId.trim()} and refreshing metadata for this title...`,
      artworkUrl: findIndexedItemArtwork('library', itemId)
    })

    try {
      const response = await window.api.settings.setLocalLibraryItemManualStoreId(itemId, storeId)
      setLocalLibraryIndex(response.index)
      const updatedItem = response.index.items.find((item) => item.id === itemId) ?? null
      const nextMatch = updatedItem ? await resolveMetaStoreMatchForItem(updatedItem) : null
      setMetaStoreMatchForItem('library', itemId, nextMatch)
      updateLiveQueueItem(queueId, {
        phase: response.updated ? 'completed' : 'failed',
        progress: 100,
        details: response.message
      })
      setSettingsMessage(response.message)
      setGamesMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the manual store ID.'
      setSettingsMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setGamesMessage(null)
    } finally {
      setSettingsBusy(false)
    }
  }

  async function saveIndexedItemManualMetadata(
    source: IndexedItemSource,
    itemId: string,
    metadata: ManualGameMetadataOverride
  ) {
    setSettingsBusy(true)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `manual-metadata-${source}-${itemId}`),
      title: findIndexedItemDisplayName(source, itemId, 'Manual Metadata'),
      subtitle: 'Save Metadata',
      kind: 'scan',
      phase: 'scanning',
      progress: 36,
      details: 'Saving manual metadata overrides for this title...',
      artworkUrl: findIndexedItemArtwork(source, itemId)
    })

    try {
      const response = await window.api.settings.setIndexedItemManualMetadata(source, itemId, metadata)
      if (source === 'library') {
        setLocalLibraryIndex(response.index)
      } else {
        setBackupStorageIndex(response.index)
      }

      updateLiveQueueItem(queueId, {
        phase: response.updated ? 'completed' : 'failed',
        progress: 100,
        details: response.message
      })
      setSettingsMessage(response.message)
      setGamesMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the manual metadata.'
      setSettingsMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setGamesMessage(null)
    } finally {
      setSettingsBusy(false)
    }
  }

  async function importManualMetadataImage(target: 'hero' | 'cover'): Promise<string | null> {
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `manual-art-import-${target}-${Date.now()}`),
      title: target === 'hero' ? 'Hero artwork' : 'Cover artwork',
      subtitle: 'Manual import',
      kind: 'scan',
      phase: 'scanning',
      progress: 30,
      details: `Selecting and importing local ${target} artwork...`,
      artworkUrl: null
    })

    try {
      const imageUri = await window.api.settings.importManualMetadataImage()
      updateLiveQueueItem(queueId, {
        phase: imageUri ? 'completed' : 'failed',
        progress: 100,
        details: imageUri
          ? `Imported local ${target} artwork.`
          : `No ${target} artwork was selected.`
      })
      return imageUri
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to import the selected image.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      return null
    }
  }

  async function extractIndexedItemArtwork(
    source: 'library' | 'backup',
    itemId: string,
    target: 'hero' | 'cover'
  ): Promise<string | null> {
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('scan', `manual-art-extract-${target}-${itemId}-${Date.now()}`),
      title: target === 'hero' ? 'Hero artwork' : 'Cover artwork',
      subtitle: 'Extract from APK',
      kind: 'scan',
      phase: 'scanning',
      progress: 34,
      details: `Extracting ${target} artwork from the indexed APK...`,
      artworkUrl: null
    })

    try {
      const response = await window.api.settings.extractIndexedItemArtwork(source, itemId, target)
      updateLiveQueueItem(queueId, {
        phase: response.extracted ? 'completed' : 'failed',
        progress: 100,
        details: response.message
      })
      return response.imageUri
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to extract ${target} artwork from the APK.`
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      return null
    }
  }

  async function moveBackupStorageItemToLibrary(itemId: string) {
    setBackupStorageActionBusyItemId(itemId)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', `backup-move-${itemId}`),
      title: findIndexedItemDisplayName('backup', itemId, 'Backup Storage Item'),
      subtitle: 'Move to Library',
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 34,
      details: 'Moving the selected backup item into the Local Library...',
      artworkUrl: findIndexedItemArtwork('backup', itemId)
    })

    try {
      const response = await window.api.settings.moveBackupStorageItemToLibrary(itemId)
      setLocalLibraryIndex(response.libraryIndex)
      setBackupStorageIndex(response.backupIndex)
      await refreshMetaStoreMatches(response.libraryIndex, response.backupIndex)
      updateLiveQueueItem(queueId, {
        phase: response.moved ? 'completed' : 'failed',
        progress: 100,
        details: response.message
      })
      setGamesMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to move the selected backup item into the library.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setGamesMessage(null)
    } finally {
      setBackupStorageActionBusyItemId(null)
    }
  }

  async function deleteBackupStorageItem(itemId: string) {
    setBackupStorageActionBusyItemId(itemId)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', `backup-delete-${itemId}`),
      title: findIndexedItemDisplayName('backup', itemId, 'Backup Storage Item'),
      subtitle: 'Delete Backup',
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 34,
      details: 'Deleting the selected item from Backup Storage...',
      artworkUrl: findIndexedItemArtwork('backup', itemId)
    })

    try {
      const response = await window.api.settings.deleteBackupStorageItem(itemId)
      setBackupStorageIndex(response.backupIndex)
      await refreshMetaStoreMatches(localLibraryIndex, response.backupIndex)
      updateLiveQueueItem(queueId, {
        phase: response.deleted ? 'completed' : 'failed',
        progress: 100,
        details: response.message
      })
      setGamesMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete the selected backup item.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setGamesMessage(null)
    } finally {
      setBackupStorageActionBusyItemId(null)
    }
  }

  async function installLocalLibraryItem(itemId: string) {
    if (gamesInstallBusyIdsRef.current.includes(itemId)) {
      return
    }

    const indexedItem = localLibraryIndex?.items.find((item) => item.id === itemId) ?? null
    const queueTitle = metaStoreMatchesByItemId[itemId]?.title ?? indexedItem?.name ?? 'Local payload install'
    const queueSubtitle = resolveQueueSubtitleFromSummary(metaStoreMatchesByItemId[itemId])
    const queueArtworkUrl = resolveQueueArtworkFromSummary(metaStoreMatchesByItemId[itemId])

    if (!selectedDeviceId) {
      enqueueLiveQueueItem({
        id: createLiveQueueId('install', `blocked-no-device-${itemId}`),
        title: queueTitle,
        subtitle: queueSubtitle,
        kind: 'install',
        phase: 'failed',
        progress: 100,
        details: 'Select a ready headset in Manager before installing a local payload.',
        artworkUrl: queueArtworkUrl
      })
      setGamesMessage(null)
      return
    }

    let installedAppsSnapshot = deviceAppsResponse

    if (!installedAppsSnapshot || installedAppsSnapshot.serial !== selectedDeviceId) {
      try {
        const response = await window.api.devices.listInstalledApps(selectedDeviceId)
        setDeviceAppsResponse(response)
        setDeviceAppsMessage(response.runtime.message)
        installedAppsSnapshot = response
      } catch {
        installedAppsSnapshot = null
      }
    }

    const installedPackageIds =
      installedAppsSnapshot?.serial === selectedDeviceId
        ? new Set((installedAppsSnapshot.apps ?? []).map((app) => app.packageId.toLowerCase()))
        : null
    const installedVersionsByPackageId =
      installedAppsSnapshot?.serial === selectedDeviceId
        ? new Map((installedAppsSnapshot.apps ?? []).map((app) => [app.packageId.toLowerCase(), app.version ?? null]))
        : null

    const installedVersion =
      indexedItem && installedVersionsByPackageId
        ? indexedItem.packageIds
            .map((packageId) => installedVersionsByPackageId.get(packageId.toLowerCase()) ?? null)
            .find((value): value is string => Boolean(value)) ?? null
        : null
    const hasInstalledMatch =
      indexedItem &&
      installedPackageIds &&
      indexedItem.packageIds.some((packageId) => installedPackageIds.has(packageId.toLowerCase()))
    const hasLocalUpgrade =
      indexedItem &&
      hasInstalledMatch &&
      compareVersionValues(indexedItem.libraryVersion ?? indexedItem.libraryVersionCode, installedVersion) > 0

    if (indexedItem && hasInstalledMatch && !hasLocalUpgrade) {
      enqueueLiveQueueItem({
        id: createLiveQueueId('install', `noop-installed-${itemId}`),
        title: queueTitle,
        subtitle: queueSubtitle,
        kind: 'install',
        phase: 'completed',
        progress: 100,
        details: 'This payload already appears in the installed inventory for the selected headset.',
        artworkUrl: queueArtworkUrl
      })
      setGamesMessage(null)
      return
    }

    const installPhaseMessage =
      indexedItem?.kind === 'apk'
        ? `Installing APK payload ${indexedItem.name}...`
        : indexedItem && indexedItem.obbCount > 0
          ? `Installing APKs and transferring OBB files for ${indexedItem.name}...`
          : indexedItem
            ? `Installing local payload ${indexedItem.name}...`
            : 'Installing local payload...'

    gamesInstallBusyIdsRef.current = [...gamesInstallBusyIdsRef.current, itemId]
    setGamesInstallBusyIds((current) => [...current, itemId])
    setGamesMessage(null)
    beginInstalledAppsMutation(selectedDeviceId)
    let shouldRefreshInstalledApps = false
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('install', itemId),
      title: queueTitle,
      subtitle: queueSubtitle,
      kind: 'install',
      phase: 'installing',
      progress: 34,
      details: installPhaseMessage,
      artworkUrl: queueArtworkUrl
    })

    try {
      let response = await window.api.devices.installLocalLibraryItem(selectedDeviceId, itemId)
      const recoveryPackageName = response.packageName ?? indexedItem?.packageIds[0] ?? null
      if (isSignatureMismatchFailure(response) && recoveryPackageName) {
        const confirmed = await requestSignatureMismatchConfirmation(recoveryPackageName)

        if (confirmed) {
          updateLiveQueueItem(queueId, {
            phase: 'uninstalling',
            progress: 52,
            details: `Installed copy uses a different signature. Removing ${recoveryPackageName} before retrying...`
          })

          const uninstallResponse = await window.api.devices.uninstallInstalledApp(selectedDeviceId, recoveryPackageName)
          if (!uninstallResponse.success) {
            updateLiveQueueItem(queueId, {
              phase: 'failed',
              progress: 100,
              details: uninstallResponse.details ?? uninstallResponse.message
            })
            setGamesMessage(null)
            return
          }

          shouldRefreshInstalledApps = true
          updateLiveQueueItem(queueId, {
            phase: 'installing',
            progress: 58,
            details: `Removed ${recoveryPackageName}. Retrying install...`
          })
          response = await window.api.devices.installLocalLibraryItem(selectedDeviceId, itemId)
        }
      }

      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.message
      })

      if (!response.success) {
        setGamesMessage(null)
      }

      if (response.success) {
        shouldRefreshInstalledApps = true
        const [libraryIndex, backupIndex] = await Promise.all([
          window.api.settings.getLocalLibraryIndex(),
          window.api.settings.getBackupStorageIndex()
        ])
        setLocalLibraryIndex(libraryIndex)
        setBackupStorageIndex(backupIndex)
        await refreshMetaStoreMatches(libraryIndex, backupIndex)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to install the selected local payload.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setGamesMessage(null)
    } finally {
      gamesInstallBusyIdsRef.current = gamesInstallBusyIdsRef.current.filter((entry) => entry !== itemId)
      setGamesInstallBusyIds((current) => current.filter((entry) => entry !== itemId))
      endInstalledAppsMutation(selectedDeviceId, shouldRefreshInstalledApps)
    }
  }

  async function installManualLibrarySource(kind: 'apk' | 'folder') {
    if (!selectedDeviceId) {
      setGamesMessage({
        text: 'Select a ready headset in Manager before starting a manual install.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setManualInstallBusyKind(kind)
    setGamesMessage(null)
    beginInstalledAppsMutation(selectedDeviceId)
    let shouldRefreshInstalledApps = false

    try {
      const sourcePath =
        kind === 'apk'
          ? await window.api.devices.chooseManualInstallApk()
          : await window.api.devices.chooseManualInstallFolder()

      if (!sourcePath) {
        return
      }

      const sourceName = sourcePath.split(/[/\\]/).pop() || sourcePath
      const queueId = enqueueLiveQueueItem({
        id: createLiveQueueId('install', `manual-${kind}`),
        title: sourceName,
        subtitle: kind === 'apk' ? 'Manual APK install' : 'Manual folder install',
        kind: 'install',
        phase: 'installing',
        progress: 34,
        details:
          kind === 'apk'
            ? `Installing APK payload ${sourceName}...`
            : `Installing folder payload ${sourceName}...`,
        artworkUrl: null
      })

      let response = await window.api.devices.installManualPath(selectedDeviceId, sourcePath)
      if (isSignatureMismatchFailure(response) && response.packageName) {
        const confirmed = await requestSignatureMismatchConfirmation(response.packageName)

        if (confirmed) {
          updateLiveQueueItem(queueId, {
            phase: 'uninstalling',
            progress: 52,
            details: `Installed copy uses a different signature. Removing ${response.packageName} before retrying...`
          })

          const uninstallResponse = await window.api.devices.uninstallInstalledApp(selectedDeviceId, response.packageName)
          if (!uninstallResponse.success) {
            updateLiveQueueItem(queueId, {
              phase: 'failed',
              progress: 100,
              details: uninstallResponse.details ?? uninstallResponse.message
            })
            setGamesMessage(null)
            return
          }

          shouldRefreshInstalledApps = true
          updateLiveQueueItem(queueId, {
            phase: 'installing',
            progress: 58,
            details: `Removed ${response.packageName}. Retrying install...`
          })
          response = await window.api.devices.installManualPath(selectedDeviceId, sourcePath)
        }
      }

      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.message
      })

      if (!response.success) {
        setGamesMessage(null)
        return
      }

      shouldRefreshInstalledApps = true
      setGamesMessage(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to complete the manual install.'
      setGamesMessage(null)
    } finally {
      setManualInstallBusyKind(null)
      endInstalledAppsMutation(selectedDeviceId, shouldRefreshInstalledApps)
    }
  }

  async function uninstallInstalledApp(packageId: string) {
    if (!selectedDeviceId) {
      setInventoryMessage({
        text: 'Select a ready headset in Manager before removing an installed app.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setInventoryActionBusyPackageId(packageId)
    setInventoryMessage(null)
    beginInstalledAppsMutation(selectedDeviceId)
    let shouldRefreshInstalledApps = false
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('uninstall', packageId),
      title: findInstalledAppDisplayName(packageId),
      subtitle: resolveQueueSubtitleFromSummary(findMetaStoreMatchByPackageId(packageId)),
      kind: 'uninstall',
      phase: 'uninstalling',
      progress: 28,
      details: `Removing ${packageId} from the selected headset...`,
      artworkUrl: resolveQueueArtworkFromSummary(findMetaStoreMatchByPackageId(packageId))
    })

    try {
      const response = await window.api.devices.uninstallInstalledApp(selectedDeviceId, packageId)
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.message
      })

      if (!response.success) {
        setInventoryMessage({
          text: response.message,
          details: response.details,
          tone: 'danger'
        })
      }

      if (response.success) {
        shouldRefreshInstalledApps = true
      }

      if (response.success) {
        const backupIndex = await window.api.settings.getBackupStorageIndex()
        setBackupStorageIndex(backupIndex)
        await refreshMetaStoreMatches(localLibraryIndex, backupIndex)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to uninstall the selected app.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setInventoryMessage({
        text: 'Unable to uninstall the selected app.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setInventoryActionBusyPackageId(null)
      endInstalledAppsMutation(selectedDeviceId, shouldRefreshInstalledApps)
    }
  }

  async function backupInstalledApp(packageId: string) {
    if (!selectedDeviceId) {
      setInventoryMessage({
        text: 'Select a ready headset in ADB Manager before backing up an installed app.',
        details: null,
        tone: 'danger'
      })
      return
    }

    if (!settings?.backupPath) {
      setInventoryMessage({
        text: 'Choose a backup folder in Settings before creating app backups.',
        details: null,
        tone: 'danger'
      })
      return
    }

    setInventoryActionBusyPackageId(packageId)
    setInventoryMessage(null)
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('backup', packageId),
      title: findInstalledAppDisplayName(packageId),
      subtitle: resolveQueueSubtitleFromSummary(findMetaStoreMatchByPackageId(packageId)),
      kind: 'backup',
      phase: 'backing-up',
      progress: 30,
      details: `Backing up ${packageId} to the configured backup path...`,
      artworkUrl: resolveQueueArtworkFromSummary(findMetaStoreMatchByPackageId(packageId))
    })

    try {
      const response = await window.api.devices.backupInstalledApp(selectedDeviceId, packageId, settings.backupPath)
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.backupPath ?? response.message
      })

      if (!response.success) {
        setInventoryMessage({
          text: response.message,
          details: response.details ?? response.backupPath,
          tone: 'danger'
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to back up the selected app.'
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
      setInventoryMessage({
        text: 'Unable to back up the selected app.',
        details: message,
        tone: 'danger'
      })
    } finally {
      setInventoryActionBusyPackageId(null)
    }
  }

  async function deleteLeftoverData(itemId: string) {
    if (!selectedDeviceId) {
      setDeviceLeftoverMessage('Select a ready headset before deleting leftover data.')
      return
    }

    setDeviceLeftoverBusyItemId(itemId)
    const target = deviceLeftoverResponse?.items.find((item) => item.id === itemId) ?? null
    const queueId = enqueueLiveQueueItem({
      id: createLiveQueueId('cleanup', itemId),
      title: target?.packageId ?? 'Leftover data cleanup',
      subtitle: target ? `/sdcard/Android/${target.location}` : selectedDeviceId,
      kind: 'cleanup',
      phase: 'cleaning-up',
      progress: 34,
      details: target
        ? `Deleting leftover ${target.location.toUpperCase()} data for ${target.packageId}...`
        : 'Deleting leftover headset data...',
      artworkUrl: null
    })

    try {
      const response = await window.api.devices.deleteLeftoverData(selectedDeviceId, itemId)
      setDeviceLeftoverResponse(response.scan)
      setDeviceLeftoverMessage(response.message)
      updateLiveQueueItem(queueId, {
        phase: response.success ? 'completed' : 'failed',
        progress: 100,
        details: response.details ?? response.message
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete the selected leftover entry.'
      setDeviceLeftoverMessage(message)
      updateLiveQueueItem(queueId, {
        phase: 'failed',
        progress: 100,
        details: message
      })
    } finally {
      setDeviceLeftoverBusyItemId(null)
    }
  }

  async function refreshMetaStoreMatches(
    libraryIndex: LocalLibraryScanResponse | null,
    backupIndex: LocalLibraryScanResponse | null = backupStorageIndex,
    options?: {
      announceInQueue?: boolean
      queueTitle?: string
      queueSubtitle?: string | null
      mode?: 'full' | 'incremental'
    }
  ) {
    const indexedSources: Array<{ source: IndexedSourceKind; items: LocalLibraryIndexedItem[] }> = [
      {
        source: 'library',
        items:
          libraryIndex?.items.filter(
            (item) => item.availability === 'present' && (item.packageIds.length > 0 || Boolean(item.manualStoreId?.trim()))
          ) ?? []
      },
      {
        source: 'backup',
        items:
          backupIndex?.items.filter(
            (item) => item.availability === 'present' && (item.packageIds.length > 0 || Boolean(item.manualStoreId?.trim()))
          ) ?? []
      }
    ]
    const items = indexedSources.flatMap((entry) => entry.items)
    const runId = metaStoreRefreshRunRef.current + 1
    metaStoreRefreshRunRef.current = runId
    const refreshMode = options?.mode ?? 'full'
    const queueId =
      options?.announceInQueue === true
        ? enqueueLiveQueueItem({
            id: createLiveQueueId('scan', `metadata-${runId}`),
            title: options.queueTitle ?? 'Metadata Refresh',
            subtitle: options.queueSubtitle ?? null,
            kind: 'scan',
            phase: 'scanning',
            progress: 10,
            details:
              refreshMode === 'incremental'
                ? 'Refreshing metadata for new, changed, or stale items...'
                : 'Refreshing stored metadata matches...',
            artworkUrl: null
          })
        : null

    if (!items.length) {
      setMetaStoreMatchesByItemId({})
      setMetaStoreSyncProgress(null)
      if (queueId) {
        updateLiveQueueItem(queueId, {
          phase: 'completed',
          progress: 100,
          details: 'No library or backup items with package metadata were available to refresh.'
        })
      }
      return
    }

    try {
      const uniquePackageIds = Array.from(new Set(items.flatMap((item) => item.packageIds)))
      const manualStoreItems = indexedSources.flatMap(({ source, items: sourceItems }) =>
        sourceItems
          .filter((item) => item.manualStoreIdEdited && item.manualStoreId)
          .map((item) => ({ source, item }))
      )
      const cachedPackageMatchesResponse = await window.api.metaStore.peekCachedMatchesByPackageIds(uniquePackageIds)

      if (metaStoreRefreshRunRef.current !== runId) {
        return
      }

      const matchesByPackageId: Record<string, MetaStoreGameSummary> = { ...cachedPackageMatchesResponse.matches }
      const matchesByManualStoreId: Record<string, MetaStoreGameSummary> = {}

      for (const manualStoreEntry of manualStoreItems) {
        const manualStoreId = manualStoreEntry.item.manualStoreId
        if (!manualStoreId) {
          continue
        }

        const response = await window.api.metaStore.peekCachedDetails(manualStoreId)

        if (metaStoreRefreshRunRef.current !== runId) {
          return
        }

        if (response.details) {
          matchesByManualStoreId[buildIndexedItemMatchKey(manualStoreEntry.source, manualStoreEntry.item.id)] =
            buildSummaryFromDetails(response.details)
        }
      }

      const buildNextMatchesByItemId = (): Record<string, MetaStoreGameSummary> => {
        const nextMatchesByItemId: Record<string, MetaStoreGameSummary> = {}

        for (const { source, items: sourceItems } of indexedSources) {
          for (const item of sourceItems) {
            const match =
              matchesByManualStoreId[buildIndexedItemMatchKey(source, item.id)] ??
              item.packageIds.map((packageId) => matchesByPackageId[packageId]).find(Boolean)
            if (match) {
              nextMatchesByItemId[buildIndexedItemMatchKey(source, item.id)] = match
            }
          }
        }

        return nextMatchesByItemId
      }

      const nextMatchesByItemId = buildNextMatchesByItemId()
      setMetaStoreMatchesByItemId(nextMatchesByItemId)

      const packagesToRefresh = new Set<string>()
      const manualStoreItemsToRefresh: typeof manualStoreItems = []

      for (const { source, items: sourceItems } of indexedSources) {
        for (const item of sourceItems) {
          const existingMatch =
            nextMatchesByItemId[buildIndexedItemMatchKey(source, item.id)] ?? null
          const needsRefresh =
            refreshMode === 'full' || shouldIncrementallyRefreshMetadata(item, existingMatch)

          if (!needsRefresh) {
            continue
          }

          if (item.manualStoreIdEdited && item.manualStoreId) {
            manualStoreItemsToRefresh.push({ source, item })
            continue
          }

          for (const packageId of item.packageIds) {
            packagesToRefresh.add(packageId)
          }
        }
      }

      const totalSteps = packagesToRefresh.size + manualStoreItemsToRefresh.length
      let completedSteps = 0

      setMetaStoreSyncProgress(totalSteps > 0 ? { completed: 0, total: totalSteps } : null)
      if (queueId) {
        updateLiveQueueItem(queueId, {
          details:
            totalSteps > 0
              ? refreshMode === 'incremental'
                ? `Refreshing metadata for new, changed, or stale items (0/${totalSteps})...`
                : `Refreshing metadata matches (0/${totalSteps})...`
              : refreshMode === 'incremental'
                ? 'Metadata is already current for known library items.'
                : 'No library or backup items required metadata refresh.'
        })
      }

      if (!totalSteps) {
        if (queueId) {
          updateLiveQueueItem(queueId, {
            phase: 'completed',
            progress: 100,
            details:
              refreshMode === 'incremental'
                ? 'Metadata is already current for known library items.'
                : 'No library or backup items required metadata refresh.'
          })
        }
        return
      }

      for (const packageId of packagesToRefresh) {
        const response = await window.api.metaStore.getCachedMatchesByPackageIds([packageId])

        if (metaStoreRefreshRunRef.current !== runId) {
          return
        }

        const match = response.matches[packageId]
        if (match) {
          matchesByPackageId[packageId] = match
        }

        completedSteps += 1
        setMetaStoreSyncProgress({ completed: completedSteps, total: totalSteps })
        if (queueId) {
          updateLiveQueueItem(queueId, {
            progress: Math.min(95, Math.round((completedSteps / Math.max(totalSteps, 1)) * 85) + 10),
            details:
              refreshMode === 'incremental'
                ? `Refreshing metadata for new, changed, or stale items (${completedSteps}/${totalSteps})...`
                : `Refreshing metadata matches (${completedSteps}/${totalSteps})...`
          })
        }
      }

      for (const manualStoreEntry of manualStoreItemsToRefresh) {
        const manualStoreId = manualStoreEntry.item.manualStoreId
        if (!manualStoreId) {
          continue
        }

        const response = await window.api.metaStore.getDetails(manualStoreId)

        if (metaStoreRefreshRunRef.current !== runId) {
          return
        }

        if (response.details) {
          matchesByManualStoreId[buildIndexedItemMatchKey(manualStoreEntry.source, manualStoreEntry.item.id)] =
            buildSummaryFromDetails(response.details)
        }

        completedSteps += 1
        setMetaStoreSyncProgress({ completed: completedSteps, total: totalSteps })
        if (queueId) {
          updateLiveQueueItem(queueId, {
            progress: Math.min(95, Math.round((completedSteps / Math.max(totalSteps, 1)) * 85) + 10),
            details:
              refreshMode === 'incremental'
                ? `Refreshing metadata for new, changed, or stale items (${completedSteps}/${totalSteps})...`
                : `Refreshing metadata matches (${completedSteps}/${totalSteps})...`
          })
        }
      }

      if (metaStoreRefreshRunRef.current === runId) {
        setMetaStoreMatchesByItemId(buildNextMatchesByItemId())
        if (queueId) {
          updateLiveQueueItem(queueId, {
            phase: 'completed',
            progress: 100,
            details:
              refreshMode === 'incremental'
                ? `Metadata refresh completed for ${totalSteps} new, changed, stale, or unresolved lookup${totalSteps === 1 ? '' : 's'}.`
                : `Metadata refresh completed for ${items.length} item${items.length === 1 ? '' : 's'}.`
          })
        }
      }
    } catch (error) {
      if (metaStoreRefreshRunRef.current === runId) {
        if (queueId) {
          updateLiveQueueItem(queueId, {
            phase: 'failed',
            progress: 100,
            details: error instanceof Error ? error.message : 'Unable to refresh stored metadata matches.'
          })
        }
      }
    } finally {
      if (metaStoreRefreshRunRef.current === runId) {
        setMetaStoreSyncProgress(null)
      }
    }
  }

  async function refreshAllMetadata() {
    await refreshMetaStoreMatches(localLibraryIndex, backupStorageIndex, {
      announceInQueue: true,
      queueTitle: 'Metadata Refresh',
      queueSubtitle: 'Apps & Games',
      mode: 'full'
    })
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !settings?.backupPath) {
        return
      }

      void (async () => {
        try {
          const nextBackupIndex = await window.api.settings.getBackupStorageIndex()

          if (buildIndexSignature(nextBackupIndex) === buildIndexSignature(backupStorageIndex)) {
            return
          }

          setBackupStorageIndex(nextBackupIndex)
          await refreshMetaStoreMatches(localLibraryIndex, nextBackupIndex)
        } catch {
          // Ignore background refresh misses and try again on the next tick.
        }
      })()
    }, 5000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [settings?.backupPath, backupStorageIndex, localLibraryIndex])

  return (
    <>
      <WireframeShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      deviceStatus={deviceStatus}
      deviceStatusTone={deviceStatusTone}
      deviceStatusTransport={deviceStatusTransport}
      deviceStatusUsbTooltip={
        readyUsbDevice
          ? readyUsbDevice.transport === 'emulator'
            ? 'Emulator ADB is active.'
            : 'USB ADB is active. Unplug the cable to disconnect.'
          : null
      }
      deviceStatusWifiTooltip={readyWifiDevice ? 'Press to disconnect this Wi-Fi ADB connection.' : null}
      deviceStatusWifiDisconnectTargetId={deviceStatusWifiDisconnectTargetId}
      subtitle={subtitle}
      liveQueueItems={liveQueueItems}
      queueAutoOpenSignal={queueAutoOpenSignal}
      onPauseVrSrcTransfer={pauseVrSrcTransfer}
      onResumeVrSrcTransfer={resumeVrSrcTransfer}
      onCancelVrSrcTransfer={cancelVrSrcTransfer}
      settings={settings}
      settingsBusy={settingsBusy}
      libraryRescanBusy={libraryRescanBusy}
      removeMissingLibraryItemBusyId={removeMissingLibraryItemBusyId}
      purgeLibraryItemBusyId={purgeLibraryItemBusyId}
      settingsMessage={settingsMessage}
      dependencyStatus={dependencyStatus}
      libraryMessage={libraryMessage}
      localLibraryIndex={localLibraryIndex}
      backupStorageIndex={backupStorageIndex}
      gameSavesPathStats={gameSavesPathStats}
      saveBackupsResponse={saveBackupsResponse}
      saveScanResponse={saveScanResponse}
      metaStoreMatchesByItemId={metaStoreMatchesByItemId}
      installedMetaStoreMatchesByPackageId={installedMetaStoreMatchesByPackageId}
      metaStoreSyncProgress={metaStoreSyncProgress}
      isLibraryScanDialogOpen={isLibraryScanDialogOpen}
      deviceResponse={deviceResponse}
      deviceBusy={deviceBusy}
      deviceMessage={deviceMessage}
      selectedDeviceId={selectedDeviceId}
      deviceAppsResponse={deviceAppsResponse}
      deviceUserName={deviceUserName}
      deviceUserNameBusy={deviceUserNameBusy}
      deviceAppsBusy={deviceAppsBusy}
      deviceAppsMessage={deviceAppsMessage}
      deviceLeftoverResponse={deviceLeftoverResponse}
      deviceLeftoverBusy={deviceLeftoverBusy}
      deviceLeftoverBusyItemId={deviceLeftoverBusyItemId}
      deviceLeftoverMessage={deviceLeftoverMessage}
      inventoryMessage={inventoryMessage}
      inventoryActionBusyPackageId={inventoryActionBusyPackageId}
      gamesInstallBusyIds={gamesInstallBusyIds}
      manualInstallBusyKind={manualInstallBusyKind}
      backupStorageActionBusyItemId={backupStorageActionBusyItemId}
      gamesMessage={gamesMessage}
      vrSrcStatus={vrSrcStatus}
      vrSrcCatalog={vrSrcCatalog}
      isVrSrcPanelOpen={isVrSrcPanelOpen}
      vrSrcSyncBusy={vrSrcSyncBusy}
      vrSrcMaintenanceBusy={vrSrcMaintenanceBusy}
      vrSrcActionBusyReleaseNames={vrSrcActionBusyReleaseNames}
      vrSrcMessage={vrSrcMessage}
      saveGamesBusy={saveGamesBusy}
      saveGamesBatchBusy={saveGamesBatchBusy}
      saveGamesActionBusyPackageId={saveGamesActionBusyPackageId}
      saveGamesRestoreBusyBackupId={saveGamesRestoreBusyBackupId}
      saveGamesDeleteBusyBackupId={saveGamesDeleteBusyBackupId}
      saveGamesMessage={saveGamesMessage}
      gamesDisplayMode={gamesDisplayMode}
      inventoryDisplayMode={inventoryDisplayMode}
      onSelectDevice={setSelectedDeviceId}
      onRefreshDevices={() => refreshDevices('manual')}
      onChooseSettingsPath={chooseSettingsPath}
      onClearSettingsPath={clearSettingsPath}
      onClearVrSrcCache={clearVrSrcCache}
      onRescanLocalLibrary={rescanLocalLibrary}
      onInstallManualLibrarySource={installManualLibrarySource}
      onRemoveMissingLibraryItem={removeMissingLibraryItem}
      onPurgeLibraryItem={purgeLibraryItem}
      onSaveLocalLibraryItemManualStoreId={saveLocalLibraryItemManualStoreId}
      onSaveIndexedItemManualMetadata={saveIndexedItemManualMetadata}
      onImportManualMetadataImage={importManualMetadataImage}
      onExtractIndexedItemArtwork={extractIndexedItemArtwork}
      onDismissLibraryScanDialog={() => setIsLibraryScanDialogOpen(false)}
      onConnectDevice={connectToDevice}
      onDisconnectDevice={disconnectDevice}
      onRefreshLeftoverData={(serial) => refreshLeftoverData(serial, true)}
      onDeleteLeftoverData={deleteLeftoverData}
      onRefreshInstalledApps={refreshInstalledApps}
      onSaveDeviceUserName={saveDeviceUserName}
      onSetGamesDisplayMode={(mode) => saveDisplayMode('gamesDisplayMode', mode)}
      onSetInventoryDisplayMode={(mode) => saveDisplayMode('inventoryDisplayMode', mode)}
      onUninstallInstalledApp={uninstallInstalledApp}
      onBackupInstalledApp={backupInstalledApp}
      onInstallLocalLibraryItem={installLocalLibraryItem}
      onMoveBackupStorageItemToLibrary={moveBackupStorageItemToLibrary}
      onDeleteBackupStorageItem={deleteBackupStorageItem}
      onRefreshAllMetadata={refreshAllMetadata}
      onToggleVrSrcPanel={() => setIsVrSrcPanelOpen((current) => !current)}
      onSyncVrSrcCatalog={syncVrSrcCatalog}
      onDownloadVrSrcToLibrary={downloadVrSrcToLibrary}
      onDownloadVrSrcToLibraryAndInstall={downloadVrSrcToLibraryAndInstall}
      onInstallVrSrcNow={installVrSrcNow}
      onRefreshSaveBackups={refreshSaveBackups}
      onScanSavePackages={async () => {
        await scanSavePackages(true)
      }}
      onScanSavePackage={async (packageId, appName) => {
        await scanSavePackages(
          true,
          [{ packageId, appName }],
          {
            queueTitle: appName ?? packageId,
            queueSubtitle: 'Save data scan',
            queueDetails: `Scanning ${packageId} for external save data...`,
            mergeResults: true
          }
        )
      }}
      onBackupAllSavePackages={backupAllSavePackages}
      onBackupSavePackage={async (packageId, appName) => {
        await backupSavePackage(packageId, appName)
      }}
      onRestoreSaveBackup={restoreSaveBackup}
      onDeleteSaveBackup={deleteSaveBackup}
      />
      {signatureMismatchDialog ? (
        <>
          <div className="library-scan-backdrop" onClick={() => resolveSignatureMismatchDialog(false)} />
          <section
            aria-label="Signature mismatch confirmation"
            aria-modal="true"
            className="library-support-dialog signature-mismatch-dialog surface-panel"
            role="dialog"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Warning</p>
                <h2>Uninstall and Retry?</h2>
                <p className="section-copy compact">
                  QuestVault could not update <strong>{signatureMismatchDialog.packageName}</strong> because the
                  installed app on the selected headset uses a different signing key.
                </p>
              </div>
              <button className="close-pill" onClick={() => resolveSignatureMismatchDialog(false)} type="button">
                Close
              </button>
            </div>

            <div className="signature-mismatch-warning-card">
              <strong>Signature mismatch detected</strong>
              <span>
                QuestVault must uninstall the currently installed copy before it can retry the install with the new
                package.
              </span>
            </div>

            <div className="signature-mismatch-warning-card is-danger">
              <strong>Data and save warning</strong>
              <span>
                Uninstalling the existing app may remove its local data and saves if they are not already backed up.
              </span>
            </div>

            <label className="signature-mismatch-acknowledge">
              <input
                checked={signatureMismatchAcknowledged}
                onChange={(event) => setSignatureMismatchAcknowledged(event.target.checked)}
                type="checkbox"
              />
              <span>I understand that uninstalling may remove app data and saves from the headset.</span>
            </label>

            <div className="signature-mismatch-actions">
              <button className="close-pill" onClick={() => resolveSignatureMismatchDialog(false)} type="button">
                Cancel
              </button>
              <button
                className="action-pill action-pill-danger action-pill-hazard action-pill-hazard-white"
                disabled={!signatureMismatchAcknowledged}
                onClick={() => resolveSignatureMismatchDialog(true)}
                type="button"
              >
                Uninstall and Retry
              </button>
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}

export default App
