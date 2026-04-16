import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  BackupStorageDeleteItemResponse,
  BackupStorageMoveItemResponse,
  DependencyBootstrapProgressUpdate,
  DependencyStatusResponse,
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
  IndexedItemManualMetadataResponse,
  IndexedItemArtworkExtractionResponse,
  LocalLibraryPurgeItemResponse,
  LocalLibraryManualStoreIdResponse,
  LocalLibraryRemoveMissingItemResponse,
  LocalLibraryScanResponse,
  ManualGameMetadataOverride,
  MetaStoreDetailsResponse,
  InstalledMetaStoreIndexResponse,
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
  VrSrcDownloadToLibraryResponse,
  VrSrcItemDetailsResponse,
  VrSrcInstallNowResponse,
  VrSrcStatusResponse,
  VrSrcSyncResponse,
  VrSrcTransferProgressUpdate,
  ViewDisplayMode
} from '@shared/types/ipc'

const api = {
  version: '0.4.2',
  ping: (): string => 'pong',
  dependencies: {
    getStatus: (): Promise<DependencyStatusResponse> => ipcRenderer.invoke('dependencies:get-status'),
    ensureReady: (): Promise<DependencyStatusResponse> => ipcRenderer.invoke('dependencies:ensure-ready'),
    onBootstrapProgress: (callback: (update: DependencyBootstrapProgressUpdate) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, update: DependencyBootstrapProgressUpdate) => {
        callback(update)
      }
      ipcRenderer.on('dependencies:bootstrap-progress', listener)
      return () => {
        ipcRenderer.removeListener('dependencies:bootstrap-progress', listener)
      }
    }
  },
  devices: {
    list: (): Promise<DeviceListResponse> => ipcRenderer.invoke('devices:list'),
    connect: (address: string): Promise<DeviceConnectResponse> => ipcRenderer.invoke('devices:connect', address),
    disconnect: (serial: string): Promise<DeviceConnectResponse> => ipcRenderer.invoke('devices:disconnect', serial),
    getUserName: (serial: string): Promise<DeviceUserNameResponse> => ipcRenderer.invoke('devices:get-user-name', serial),
    setUserName: (serial: string, userName: string): Promise<DeviceUserNameResponse> =>
      ipcRenderer.invoke('devices:set-user-name', serial, userName),
    listInstalledApps: (serial: string): Promise<DeviceAppsResponse> => ipcRenderer.invoke('devices:list-installed-apps', serial),
    scanLeftoverData: (serial: string): Promise<DeviceLeftoverScanResponse> =>
      ipcRenderer.invoke('devices:scan-leftover-data', serial),
    deleteLeftoverData: (serial: string, itemId: string): Promise<DeviceLeftoverDeleteResponse> =>
      ipcRenderer.invoke('devices:delete-leftover-data', serial, itemId),
    uninstallInstalledApp: (serial: string, packageId: string): Promise<DeviceInstalledAppActionResponse> =>
      ipcRenderer.invoke('devices:uninstall-installed-app', serial, packageId),
    backupInstalledApp: (
      serial: string,
      packageId: string,
      backupPath: string
    ): Promise<DeviceInstalledAppBackupResponse> =>
      ipcRenderer.invoke('devices:backup-installed-app', serial, packageId, backupPath),
    installLocalLibraryItem: (serial: string, itemId: string): Promise<DeviceLibraryInstallResponse> =>
      ipcRenderer.invoke('devices:install-local-library-item', serial, itemId),
    chooseManualInstallApk: (): Promise<string | null> => ipcRenderer.invoke('devices:choose-manual-install-apk'),
    chooseManualInstallFolder: (): Promise<string | null> => ipcRenderer.invoke('devices:choose-manual-install-folder'),
    installManualPath: (serial: string, sourcePath: string): Promise<DeviceManualInstallResponse> =>
      ipcRenderer.invoke('devices:install-manual-path', serial, sourcePath)
  },
  savegames: {
    listBackups: (): Promise<SaveBackupsResponse> => ipcRenderer.invoke('savegames:list-backups'),
    scanPackages: (
      serial: string,
      packages: Array<{ packageId: string; appName: string | null }>
    ): Promise<SavePackagesScanResponse> => ipcRenderer.invoke('savegames:scan-packages', serial, packages),
    backupPackage: (
      serial: string,
      packageId: string,
      appName: string | null
    ): Promise<SaveBackupPackageResponse> =>
      ipcRenderer.invoke('savegames:backup-package', serial, packageId, appName),
    restoreBackup: (
      serial: string,
      packageId: string,
      backupId: string
    ): Promise<SaveRestoreBackupResponse> =>
      ipcRenderer.invoke('savegames:restore-backup', serial, packageId, backupId),
    deleteBackup: (backupId: string): Promise<SaveDeleteBackupResponse> =>
      ipcRenderer.invoke('savegames:delete-backup', backupId)
  },
  metaStore: {
    getStatus: (): Promise<MetaStoreStatusResponse> => ipcRenderer.invoke('meta-store:get-status'),
    search: (query: string): Promise<MetaStoreSearchResponse> => ipcRenderer.invoke('meta-store:search', query),
    getDetails: (storeId: string): Promise<MetaStoreDetailsResponse> =>
      ipcRenderer.invoke('meta-store:get-details', storeId),
    getCachedMatchesByPackageIds: (packageIds: string[]): Promise<MetaStorePackageMatchResponse> =>
      ipcRenderer.invoke('meta-store:get-cached-matches-by-package-ids', packageIds),
    peekCachedMatchesByPackageIds: (packageIds: string[]): Promise<MetaStorePackageMatchResponse> =>
      ipcRenderer.invoke('meta-store:peek-cached-matches-by-package-ids', packageIds),
    peekCachedDetails: (storeId: string): Promise<MetaStoreDetailsResponse> =>
      ipcRenderer.invoke('meta-store:peek-cached-details', storeId),
    getInstalledPackageIndex: (): Promise<InstalledMetaStoreIndexResponse> =>
      ipcRenderer.invoke('meta-store:get-installed-package-index'),
    refreshInstalledPackageIndex: (packageIds: string[]): Promise<InstalledMetaStoreIndexResponse> =>
      ipcRenderer.invoke('meta-store:refresh-installed-package-index', packageIds)
  },
  vrsrc: {
    getStatus: (): Promise<VrSrcStatusResponse> => ipcRenderer.invoke('vrsrc:get-status'),
    getCatalog: (): Promise<VrSrcCatalogResponse> => ipcRenderer.invoke('vrsrc:get-catalog'),
    getItemDetails: (releaseName: string, gameName: string): Promise<VrSrcItemDetailsResponse> =>
      ipcRenderer.invoke('vrsrc:get-item-details', releaseName, gameName),
    syncCatalog: (): Promise<VrSrcSyncResponse> => ipcRenderer.invoke('vrsrc:sync-catalog'),
    downloadToLibrary: (releaseName: string): Promise<VrSrcDownloadToLibraryResponse> =>
      ipcRenderer.invoke('vrsrc:download-to-library', releaseName),
    installNow: (serial: string, releaseName: string): Promise<VrSrcInstallNowResponse> =>
      ipcRenderer.invoke('vrsrc:install-now', serial, releaseName),
    onTransferProgress: (callback: (update: VrSrcTransferProgressUpdate) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, update: VrSrcTransferProgressUpdate) => {
        callback(update)
      }
      ipcRenderer.on('vrsrc:transfer-progress', listener)
      return () => {
        ipcRenderer.removeListener('vrsrc:transfer-progress', listener)
      }
    }
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    getLocalLibraryIndex: (): Promise<LocalLibraryScanResponse> => ipcRenderer.invoke('settings:get-local-library-index'),
    getBackupStorageIndex: (): Promise<LocalLibraryScanResponse> => ipcRenderer.invoke('settings:get-backup-storage-index'),
    getPathStats: (key: SettingsPathKey): Promise<SettingsPathStatsResponse> => ipcRenderer.invoke('settings:get-path-stats', key),
    choosePath: (key: SettingsPathKey): Promise<SettingsSelectPathResponse> => ipcRenderer.invoke('settings:choose-path', key),
    importManualMetadataImage: (): Promise<string | null> => ipcRenderer.invoke('settings:import-manual-metadata-image'),
    extractIndexedItemArtwork: (
      source: 'library' | 'backup',
      itemId: string,
      target: 'hero' | 'cover'
    ): Promise<IndexedItemArtworkExtractionResponse> =>
      ipcRenderer.invoke('settings:extract-indexed-item-artwork', source, itemId, target),
    clearPath: (key: SettingsPathKey): Promise<AppSettings> => ipcRenderer.invoke('settings:clear-path', key),
    setDisplayMode: (key: SettingsDisplayModeKey, mode: ViewDisplayMode): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set-display-mode', key, mode),
    rescanLocalLibrary: (): Promise<LocalLibraryScanResponse> => ipcRenderer.invoke('settings:rescan-local-library'),
    rescanBackupStorage: (): Promise<LocalLibraryScanResponse> => ipcRenderer.invoke('settings:rescan-backup-storage'),
    moveBackupStorageItemToLibrary: (itemId: string): Promise<BackupStorageMoveItemResponse> =>
      ipcRenderer.invoke('settings:move-backup-storage-item-to-library', itemId),
    deleteBackupStorageItem: (itemId: string): Promise<BackupStorageDeleteItemResponse> =>
      ipcRenderer.invoke('settings:delete-backup-storage-item', itemId),
    removeMissingLibraryItem: (itemId: string): Promise<LocalLibraryRemoveMissingItemResponse> =>
      ipcRenderer.invoke('settings:remove-missing-library-item', itemId),
    purgeLibraryItem: (itemId: string): Promise<LocalLibraryPurgeItemResponse> =>
      ipcRenderer.invoke('settings:purge-library-item', itemId),
    setLocalLibraryItemManualStoreId: (itemId: string, storeId: string): Promise<LocalLibraryManualStoreIdResponse> =>
      ipcRenderer.invoke('settings:set-local-library-item-manual-store-id', itemId, storeId),
    setIndexedItemManualMetadata: (
      source: 'library' | 'backup',
      itemId: string,
      metadata: ManualGameMetadataOverride
    ): Promise<IndexedItemManualMetadataResponse> =>
      ipcRenderer.invoke('settings:set-indexed-item-manual-metadata', source, itemId, metadata),
    onIndexUpdated: (callback: (update: SettingsIndexedPathUpdate) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, update: SettingsIndexedPathUpdate) => {
        callback(update)
      }
      ipcRenderer.on('settings:index-updated', listener)
      return () => {
        ipcRenderer.removeListener('settings:index-updated', listener)
      }
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}
