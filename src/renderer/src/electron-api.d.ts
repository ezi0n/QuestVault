import type {
  AppSettings,
  BackupStorageDeleteItemResponse,
  BackupStorageMoveItemResponse,
  DependencyBootstrapProgressUpdate,
  DependencyStatusResponse,
  ReleaseCheckResponse,
  DeviceInstalledAppBackupResponse,
  DeviceInstalledAppActionResponse,
  DeviceAppsResponse,
  DeviceConnectResponse,
  DeviceLeftoverDeleteResponse,
  DeviceLeftoverScanResponse,
  DeviceLibraryInstallResponse,
  DeviceManualInstallResponse,
  DeviceListResponse,
  DeviceUserNameResponse,
  HeadsetActionLogResponse,
  IndexedItemManualMetadataResponse,
  IndexedItemArtworkExtractionResponse,
  LocalLibraryPurgeItemResponse,
  LocalLibraryManualStoreIdResponse,
  LocalLibraryRemoveMissingItemResponse,
  LocalLibraryScanResponse,
  InstalledMetaStoreIndexResponse,
  ManualGameMetadataOverride,
  MetaStoreDetailsResponse,
  MetaStoreGameSummary,
  MetaStorePackageMatchResponse,
  MetaStoreSearchResponse,
  MetaStoreStatusResponse,
  SaveBackupPackageResponse,
  SaveBackupsResponse,
  SaveDeleteBackupResponse,
  SavePackagesScanResponse,
  SaveRestoreBackupResponse,
  SettingsIndexedPathUpdate,
  SettingsDisplayModeKey,
  SettingsPathStatsResponse,
  SettingsPathKey,
  SettingsSelectPathResponse,
  VrSrcCatalogResponse,
  VrSrcClearCacheResponse,
  VrSrcDownloadToLibraryResponse,
  VrSrcItemDetailsResponse,
  VrSrcInstallNowResponse,
  VrSrcStatusResponse,
  VrSrcSyncResponse,
  VrSrcTransferControlResponse,
  VrSrcTransferOperation,
  VrSrcTransferProgressUpdate,
  ViewDisplayMode
} from '@shared/types/ipc'

interface ElectronApi {
  version: string
  ping: () => string
  app: {
    checkForUpdates: () => Promise<ReleaseCheckResponse>
  }
  dependencies: {
    getStatus: () => Promise<DependencyStatusResponse>
    ensureReady: () => Promise<DependencyStatusResponse>
    onBootstrapProgress: (callback: (update: DependencyBootstrapProgressUpdate) => void) => () => void
  }
  devices: {
    list: () => Promise<DeviceListResponse>
    connect: (address: string) => Promise<DeviceConnectResponse>
    disconnect: (serial: string) => Promise<DeviceConnectResponse>
    getUserName: (serial: string) => Promise<DeviceUserNameResponse>
    setUserName: (serial: string, userName: string) => Promise<DeviceUserNameResponse>
    listInstalledApps: (serial: string) => Promise<DeviceAppsResponse>
    scanLeftoverData: (serial: string) => Promise<DeviceLeftoverScanResponse>
    deleteLeftoverData: (serial: string, itemId: string) => Promise<DeviceLeftoverDeleteResponse>
    uninstallInstalledApp: (serial: string, packageId: string) => Promise<DeviceInstalledAppActionResponse>
    backupInstalledApp: (serial: string, packageId: string, backupPath: string) => Promise<DeviceInstalledAppBackupResponse>
    installLocalLibraryItem: (serial: string, itemId: string) => Promise<DeviceLibraryInstallResponse>
    chooseManualInstallApk: () => Promise<string | null>
    chooseManualInstallFolder: () => Promise<string | null>
    installManualPath: (serial: string, sourcePath: string) => Promise<DeviceManualInstallResponse>
  }
  headsetActions: {
    getRecent: () => Promise<HeadsetActionLogResponse>
  }
  savegames: {
    listBackups: () => Promise<SaveBackupsResponse>
    scanPackages: (
      serial: string,
      packages: Array<{ packageId: string; appName: string | null }>
    ) => Promise<SavePackagesScanResponse>
    backupPackage: (
      serial: string,
      packageId: string,
      appName: string | null
    ) => Promise<SaveBackupPackageResponse>
    restoreBackup: (
      serial: string,
      packageId: string,
      backupId: string
    ) => Promise<SaveRestoreBackupResponse>
    deleteBackup: (backupId: string) => Promise<SaveDeleteBackupResponse>
  }
  metaStore: {
    getStatus: () => Promise<MetaStoreStatusResponse>
    search: (query: string) => Promise<MetaStoreSearchResponse>
    getDetails: (storeId: string) => Promise<MetaStoreDetailsResponse>
    getCachedMatchesByPackageIds: (packageIds: string[]) => Promise<MetaStorePackageMatchResponse>
    peekCachedMatchesByPackageIds: (packageIds: string[]) => Promise<MetaStorePackageMatchResponse>
    peekCachedDetails: (storeId: string) => Promise<MetaStoreDetailsResponse>
    getInstalledPackageIndex: () => Promise<InstalledMetaStoreIndexResponse>
    refreshInstalledPackageIndex: (packageIds: string[]) => Promise<InstalledMetaStoreIndexResponse>
    replaceInstalledPackageIndex: (
      matchesByPackageId: Record<string, MetaStoreGameSummary>
    ) => Promise<InstalledMetaStoreIndexResponse>
  }
  vrsrc: {
    getStatus: () => Promise<VrSrcStatusResponse>
    getCatalog: () => Promise<VrSrcCatalogResponse>
    getItemDetails: (releaseName: string, gameName: string) => Promise<VrSrcItemDetailsResponse>
    syncCatalog: () => Promise<VrSrcSyncResponse>
    clearCache: () => Promise<VrSrcClearCacheResponse>
    downloadToLibrary: (releaseName: string) => Promise<VrSrcDownloadToLibraryResponse>
    downloadToLibraryAndInstall: (serial: string, releaseName: string) => Promise<VrSrcDownloadAndInstallResponse>
    installNow: (serial: string, releaseName: string) => Promise<VrSrcInstallNowResponse>
    pauseTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<VrSrcTransferControlResponse>
    resumeTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<VrSrcTransferControlResponse>
    cancelTransfer: (releaseName: string, operation: VrSrcTransferOperation) => Promise<VrSrcTransferControlResponse>
    onTransferProgress: (callback: (update: VrSrcTransferProgressUpdate) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    getLocalLibraryIndex: () => Promise<LocalLibraryScanResponse>
    getBackupStorageIndex: () => Promise<LocalLibraryScanResponse>
    getPathStats: (key: SettingsPathKey) => Promise<SettingsPathStatsResponse>
    choosePath: (key: SettingsPathKey) => Promise<SettingsSelectPathResponse>
    importManualMetadataImage: () => Promise<string | null>
    extractIndexedItemArtwork: (
      source: 'library' | 'backup',
      itemId: string,
      target: 'hero' | 'cover'
    ) => Promise<IndexedItemArtworkExtractionResponse>
    clearPath: (key: SettingsPathKey) => Promise<AppSettings>
    setDisplayMode: (key: SettingsDisplayModeKey, mode: ViewDisplayMode) => Promise<AppSettings>
    rescanLocalLibrary: () => Promise<LocalLibraryScanResponse>
    rescanBackupStorage: () => Promise<LocalLibraryScanResponse>
    moveBackupStorageItemToLibrary: (itemId: string) => Promise<BackupStorageMoveItemResponse>
    deleteBackupStorageItem: (itemId: string) => Promise<BackupStorageDeleteItemResponse>
    removeMissingLibraryItem: (itemId: string) => Promise<LocalLibraryRemoveMissingItemResponse>
    purgeLibraryItem: (itemId: string) => Promise<LocalLibraryPurgeItemResponse>
    setLocalLibraryItemManualStoreId: (itemId: string, storeId: string) => Promise<LocalLibraryManualStoreIdResponse>
    setIndexedItemManualMetadata: (
      source: 'library' | 'backup',
      itemId: string,
      metadata: ManualGameMetadataOverride
    ) => Promise<IndexedItemManualMetadataResponse>
    onIndexUpdated: (callback: (update: SettingsIndexedPathUpdate) => void) => () => void
  }
}

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
