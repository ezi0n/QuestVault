export type PrimaryTab = 'manager' | 'games' | 'saves' | 'inventory' | 'settings'

export type DeviceRuntimeStatus = 'ready' | 'missing' | 'error'
export type DeviceTransport = 'usb' | 'tcp' | 'emulator' | 'unknown'
export type DeviceConnectionState = 'device' | 'offline' | 'unauthorized' | 'disconnected'

export interface DeviceRuntimeInfo {
  status: DeviceRuntimeStatus
  adbPath: string | null
  message: string
}

export type ManagedDependencyId = 'adb' | 'sevenZip'
export type ManagedDependencyStatus = 'ready' | 'missing' | 'error'
export type ManagedDependencySource = 'managed' | 'system' | 'missing'
export type DependencyBootstrapPhase = 'checking' | 'downloading' | 'extracting' | 'ready' | 'failed'

export interface ManagedDependencySummary {
  id: ManagedDependencyId
  title: string
  status: ManagedDependencyStatus
  source: ManagedDependencySource
  path: string | null
  message: string
}

export interface DependencyStatusResponse {
  statuses: ManagedDependencySummary[]
  checkedAt: string
  message: string
}

export interface DependencyBootstrapProgressUpdate {
  dependencyId: ManagedDependencyId
  title: string
  phase: DependencyBootstrapPhase
  progress: number
  details: string | null
  path: string | null
}

export interface ReleaseCheckResponse {
  success: boolean
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  releaseUrl: string | null
  publishedAt: string | null
  updateAvailable: boolean
  message: string
  details: string | null
}

export interface DeviceSummary {
  id: string
  label: string
  transport: DeviceTransport
  state: DeviceConnectionState
  model: string | null
  product: string | null
  horizonOsDisplayName: string | null
  batteryLevel: number | null
  storageTotalBytes: number | null
  storageFreeBytes: number | null
  ipAddress: string | null
  note: string
}

export interface DeviceListResponse {
  runtime: DeviceRuntimeInfo
  devices: DeviceSummary[]
  scannedAt: string
}

export interface DeviceConnectResponse {
  runtime: DeviceRuntimeInfo
  success: boolean
  message: string
  serial: string | null
}

export interface InstalledAppSummary {
  packageId: string
  label: string | null
  inferredLabel: string
  version: string | null
  totalFootprintBytes: number | null
}

export interface InstalledAppScanDelta {
  comparedToScannedAt: string
  previousAppCount: number
  currentAppCount: number
  addedCount: number
  removedCount: number
  addedPackages: string[]
  removedPackages: string[]
}

export interface InstalledAppHistoryDay {
  date: string
  scannedAt: string
  appCount: number
  visibleAppCount: number
  hiddenPackageCount: number
  systemAppCount: number
  addedCount: number
  removedCount: number
}

export interface InstalledAppHistoryResponse {
  serial: string
  days: InstalledAppHistoryDay[]
  latestScanAt: string | null
  message: string
}

export interface DeviceAppsResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  apps: InstalledAppSummary[]
  systemAppCount: number
  change: InstalledAppScanDelta | null
  history: InstalledAppHistoryResponse
  scannedAt: string
}

export type DeviceLeftoverLocation = 'obb' | 'data'

export interface DeviceLeftoverItem {
  id: string
  packageId: string
  location: DeviceLeftoverLocation
  absolutePath: string
  sizeBytes: number | null
  deleteBlocked: boolean
  deleteBlockedReason: string | null
}

export interface DeviceLeftoverScanResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  items: DeviceLeftoverItem[]
  scannedAt: string
  message: string
}

export interface DeviceLeftoverDeleteResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  itemId: string
  success: boolean
  message: string
  details: string | null
  scan: DeviceLeftoverScanResponse
}

export interface DeviceUserNameResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  success: boolean
  userName: string | null
  message: string
}

export interface DeviceLibraryInstallResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  itemId: string
  success: boolean
  message: string
  details: string | null
  packageName: string | null
}

export interface DeviceManualInstallResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  sourcePath: string
  success: boolean
  message: string
  details: string | null
  packageName: string | null
}

export interface DeviceInstalledAppActionResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  packageId: string
  success: boolean
  message: string
  details: string | null
}

export interface DeviceInstalledAppBackupResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  packageId: string
  success: boolean
  message: string
  details: string | null
  backupPath: string | null
}

export interface DeviceRebootResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  success: boolean
  message: string
  details: string | null
}

export type HeadsetActionLogStatus = 'started' | 'step' | 'succeeded' | 'failed'
export type HeadsetActionLogKind = 'connect' | 'disconnect' | 'install' | 'uninstall' | 'reboot'

export interface HeadsetActionLogRecord {
  id: string
  action: HeadsetActionLogKind
  status: HeadsetActionLogStatus
  timestamp: string
  serial: string | null
  itemId?: string | null
  itemName?: string | null
  packageName?: string | null
  message: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface HeadsetActionLogResponse {
  records: HeadsetActionLogRecord[]
  logPath: string
}

export type SaveDataStatus = 'available' | 'blocked' | 'none' | 'error'

export interface SaveDataRoot {
  id: string
  remotePath: string
  fileCount: number
  sizeBytes: number
}

export interface SaveBackupEntry {
  id: string
  packageId: string
  appName: string | null
  createdAt: string
  sizeBytes: number
  absolutePath: string
  roots: SaveDataRoot[]
}

export interface SaveBackupsResponse {
  path: string | null
  entries: SaveBackupEntry[]
  scannedAt: string | null
  message: string
}

export interface SavePackageScanResult {
  packageId: string
  appName: string | null
  status: SaveDataStatus
  roots: SaveDataRoot[]
  backupCount: number
  latestBackupId: string | null
  message: string | null
}

export interface SavePackagesScanResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  scannedAt: string
  results: SavePackageScanResult[]
  message: string
}

export interface SaveBackupPackageResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  packageId: string
  success: boolean
  message: string
  details: string | null
  backup: SaveBackupEntry | null
}

export interface SaveRestoreBackupResponse {
  runtime: DeviceRuntimeInfo
  serial: string
  packageId: string
  backupId: string
  success: boolean
  message: string
  details: string | null
}

export interface SaveDeleteBackupResponse {
  path: string | null
  backupId: string
  packageId: string
  deleted: boolean
  message: string
  details: string | null
}

export type MetaStoreLookupStatus = 'unsupported' | 'cache-only' | 'ready' | 'error'

export interface MetaStoreImageAsset {
  uri: string
  width: number | null
  height: number | null
}

export interface MetaStoreGameSummary {
  storeId: string
  packageId: string | null
  title: string
  subtitle: string | null
  category: string | null
  publisherName: string | null
  genreNames: string[]
  gameModes: string[]
  supportedPlayerModes: string[]
  comfortLevel: string | null
  releaseDateLabel: string | null
  canonicalName: string | null
  storeItemId: string | null
  thumbnail: MetaStoreImageAsset | null
  heroImage: MetaStoreImageAsset | null
  portraitImage: MetaStoreImageAsset | null
  iconImage: MetaStoreImageAsset | null
  logoImage: MetaStoreImageAsset | null
  youtubeTrailerVideoId: string | null
  version: string | null
  versionCode: string | null
  supportedDevices: string[]
  sizeBytes: number | null
  ratingAverage: number | null
  priceLabel: string | null
  source: 'cache' | 'remote'
  fetchedAt: string
}

export interface MetaStoreGameDetails extends MetaStoreGameSummary {
  shortDescription: string | null
  longDescription: string | null
  languageNames: string[]
  interactionModeNames: string[]
  internetConnectionName: string | null
  gamepadRequired: boolean | null
  websiteUrl: string | null
  ratingHistogram: number[]
}

export interface MetaStoreStatusResponse {
  status: MetaStoreLookupStatus
  message: string
  cachedSummaryCount: number
  cachedDetailCount: number
  lastUpdatedAt: string | null
}

export interface MetaStoreSearchResponse {
  status: MetaStoreLookupStatus
  query: string
  message: string
  results: MetaStoreGameSummary[]
}

export interface MetaStoreDetailsResponse {
  status: MetaStoreLookupStatus
  storeId: string
  message: string
  details: MetaStoreGameDetails | null
}

export interface MetaStorePackageMatchResponse {
  status: MetaStoreLookupStatus
  packageIds: string[]
  message: string
  matches: Record<string, MetaStoreGameSummary>
}

export interface InstalledMetaStoreIndexResponse {
  status: MetaStoreLookupStatus
  packageIds: string[]
  message: string
  matches: Record<string, MetaStoreGameSummary>
  lastUpdatedAt: string | null
}

export interface ManualGameMetadataOverride {
  title: string | null
  publisherName: string | null
  category: string | null
  version: string | null
  releaseDateLabel: string | null
  shortDescription: string | null
  longDescription: string | null
  heroImageUri: string | null
  thumbnailUri: string | null
}

export type LiveQueueKind = 'install' | 'backup' | 'uninstall' | 'scan' | 'cleanup' | 'restore' | 'download' | 'update' | 'reboot'
export type LiveQueuePhase =
  | 'queued'
  | 'paused'
  | 'cancelled'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'verifying'
  | 'backing-up'
  | 'uninstalling'
  | 'scanning'
  | 'cleaning-up'
  | 'rebooting'
  | 'reconnecting'
  | 'restoring'
  | 'completed'
  | 'failed'

export interface LiveQueueItem {
  id: string
  title: string
  subtitle: string | null
  kind: LiveQueueKind
  phase: LiveQueuePhase
  progress: number
  details: string | null
  artworkUrl: string | null
  updatedAt: string
  actionLabel?: string | null
  actionUrl?: string | null
  transferControl: LiveQueueTransferControl | null
}

export interface LiveQueueTransferControl {
  kind: 'vrsrc'
  operation: VrSrcTransferOperation
  releaseName: string
  canPause: boolean
  canResume: boolean
  canCancel: boolean
}

export interface DownloadQueueItem {
  id: string
  title: string
  phase: 'queued' | 'downloading' | 'extracting' | 'installing' | 'completed' | 'failed'
  progress: number
}

export interface UploadQueueItem {
  id: string
  title: string
  phase: 'queued' | 'uploading' | 'completed' | 'failed'
  progress: number
}

export type ViewDisplayMode = 'list' | 'gallery'

export interface AppSettings {
  localLibraryPath: string | null
  backupPath: string | null
  gameSavesPath: string | null
  gamesDisplayMode: ViewDisplayMode
  inventoryDisplayMode: ViewDisplayMode
}

export interface VrSrcStatusResponse {
  configured: boolean
  baseUriHost: string | null
  lastResolvedAt: string | null
  lastSyncAt: string | null
  itemCount: number
  message: string
}

export interface VrSrcCatalogItem {
  id: string
  name: string
  releaseName: string
  packageName: string
  versionCode: string
  versionName: string | null
  lastUpdated: string
  sizeLabel: string
  sizeBytes: number
  downloads: number
  rating: number
  ratingCount: number
  artworkUrl: string | null
  note: string | null
}

export interface VrSrcCatalogResponse {
  syncedAt: string | null
  items: VrSrcCatalogItem[]
}

export interface VrSrcItemDetailsResponse {
  releaseName: string
  note: string | null
  trailerVideoId: string | null
}

export interface VrSrcSyncResponse {
  success: boolean
  message: string
  details: string | null
  usedCachedCatalog: boolean
  status: VrSrcStatusResponse
  catalog: VrSrcCatalogResponse
}

export interface VrSrcClearCacheResponse {
  success: boolean
  message: string
  details: string | null
  status: VrSrcStatusResponse
  catalog: VrSrcCatalogResponse
}

export interface VrSrcDownloadToLibraryResponse {
  success: boolean
  cancelled: boolean
  releaseName: string
  sourcePath: string | null
  targetPath: string | null
  packageName: string | null
  message: string
  details: string | null
}

export interface VrSrcInstallNowResponse {
  success: boolean
  cancelled: boolean
  releaseName: string
  serial: string
  sourcePath: string | null
  packageName: string | null
  message: string
  details: string | null
}

export interface VrSrcDownloadAndInstallResponse {
  success: boolean
  cancelled: boolean
  releaseName: string
  serial: string
  sourcePath: string | null
  targetPath: string | null
  packageName: string | null
  message: string
  details: string | null
}

export type VrSrcTransferOperation = 'download-to-library' | 'download-to-library-and-install' | 'install-now'
export type VrSrcTransferPhase = 'queued' | 'paused' | 'cancelled' | 'preparing' | 'downloading' | 'extracting' | 'installing'

export interface VrSrcTransferProgressUpdate {
  operation: VrSrcTransferOperation
  releaseName: string
  phase: VrSrcTransferPhase
  progress: number
  fileName: string | null
  transferredBytes: number
  totalBytes: number | null
  speedBytesPerSecond: number | null
  etaSeconds: number | null
  canPause: boolean
  canResume: boolean
  canCancel: boolean
}

export interface VrSrcTransferControlResponse {
  success: boolean
  releaseName: string
  operation: VrSrcTransferOperation
  message: string
  details: string | null
}

export type SettingsPathKey = 'localLibraryPath' | 'backupPath' | 'gameSavesPath'
export type SettingsDisplayModeKey = 'gamesDisplayMode' | 'inventoryDisplayMode'

export type LocalLibraryItemKind = 'folder' | 'archive' | 'apk' | 'obb' | 'file'

export interface LocalLibraryIndexedItem {
  id: string
  name: string
  relativePath: string
  absolutePath: string
  searchTerms: string[]
  packageIds: string[]
  kind: LocalLibraryItemKind
  availability: 'present' | 'missing'
  discoveryState: 'new' | 'changed' | 'existing' | 'missing'
  installReady: boolean
  sizeBytes: number
  modifiedAt: string
  childCount: number
  apkCount: number
  obbCount: number
  archiveCount: number
  libraryVersion: string | null
  libraryVersionCode: string | null
  sourceLastUpdatedAt: string | null
  note: string
  manualStoreId: string | null
  manualStoreIdEdited: boolean
  manualMetadata: ManualGameMetadataOverride | null
}

export type IndexedItemSource = 'library' | 'backup'

export interface IndexedItemManualMetadataResponse {
  updated: boolean
  source: IndexedItemSource
  itemId: string
  index: LocalLibraryScanResponse
  message: string
}

export interface IndexedItemArtworkExtractionResponse {
  extracted: boolean
  source: IndexedItemSource
  itemId: string
  target: 'hero' | 'cover'
  imageUri: string | null
  message: string
}

export interface SettingsSelectPathResponse {
  canceled: boolean
  settings: AppSettings
}

export interface SettingsPathStatsResponse {
  key: SettingsPathKey
  path: string | null
  exists: boolean
  itemCount: number
  totalBytes: number
  message: string
}

export interface SettingsIndexedPathUpdate {
  source: 'library' | 'backup'
  trigger: 'manual' | 'watch' | 'system'
  index: LocalLibraryScanResponse
  changedItemIds: string[]
}

export interface LocalLibraryScanResponse {
  path: string | null
  itemCount: number
  newCount: number
  missingCount: number
  totalBytes: number
  scannedAt: string | null
  message: string
  items: LocalLibraryIndexedItem[]
}

export interface LocalLibraryRemoveMissingItemResponse {
  removed: boolean
  itemId: string
  index: LocalLibraryScanResponse
  message: string
}

export interface LocalLibraryPurgeItemResponse {
  purged: boolean
  itemId: string
  index: LocalLibraryScanResponse
  message: string
}

export interface LocalLibraryManualStoreIdResponse {
  updated: boolean
  itemId: string
  index: LocalLibraryScanResponse
  message: string
}

export interface BackupStorageDeleteItemResponse {
  deleted: boolean
  itemId: string
  backupIndex: LocalLibraryScanResponse
  message: string
}

export interface BackupStorageMoveItemResponse {
  moved: boolean
  itemId: string
  backupIndex: LocalLibraryScanResponse
  libraryIndex: LocalLibraryScanResponse
  message: string
}
