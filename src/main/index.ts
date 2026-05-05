import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } from 'electron'
import { createServer, type Server } from 'node:http'
import { cp, mkdir, readFile, readdir } from 'node:fs/promises'
import { electronApp, is } from '@electron-toolkit/utils'
import { dirname, extname, join, normalize, resolve } from 'path'
import { pathToFileURL } from 'url'
import { deviceService } from './services/deviceService'
import { dependencyService } from './services/dependencyService'
import { metaStoreService } from './services/metaStoreService'
import { releaseService } from './services/releaseService'
import { savegameService } from './services/savegameService'
import { settingsService } from './services/settingsService'
import { vrSrcService } from './services/vrSrcService'
import { headsetActionLogService } from './services/headsetActionLogService'

const APP_DISPLAY_NAME = 'QuestVault'
const LEGACY_USER_DATA_DIR_NAME = 'quest-archive-manager'
const PRODUCTION_RENDERER_SCHEME = 'http://127.0.0.1'

let productionRendererServer: Server | null = null
let productionRendererServerUrl: string | null = null

app.setName(APP_DISPLAY_NAME)

async function directoryEntryCount(path: string): Promise<number> {
  try {
    const entries = await readdir(path)
    return entries.length
  } catch {
    return 0
  }
}

async function migrateLegacyUserDataIfNeeded(): Promise<void> {
  const appDataPath = app.getPath('appData')
  const preferredUserDataPath = join(appDataPath, APP_DISPLAY_NAME)
  const legacyUserDataPath = join(appDataPath, LEGACY_USER_DATA_DIR_NAME)

  app.setPath('userData', preferredUserDataPath)

  const currentEntryCount = await directoryEntryCount(preferredUserDataPath)
  if (currentEntryCount > 0) {
    return
  }

  const legacyEntryCount = await directoryEntryCount(legacyUserDataPath)
  if (legacyEntryCount === 0) {
    return
  }

  await mkdir(dirname(preferredUserDataPath), { recursive: true })
  await cp(legacyUserDataPath, preferredUserDataPath, { recursive: true, force: false })
}

function getRendererMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

async function ensureProductionRendererServer(): Promise<string> {
  if (productionRendererServerUrl) {
    return productionRendererServerUrl
  }

  const rendererRoot = resolve(app.getAppPath(), 'out/renderer')

  productionRendererServer = createServer(async (request, response) => {
    try {
      const requestPath = request.url ? new URL(request.url, PRODUCTION_RENDERER_SCHEME).pathname : '/'
      const normalizedRequestPath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '')
      const relativeRequestPath =
        normalizedRequestPath === '/' || normalizedRequestPath === '.'
          ? 'index.html'
          : normalizedRequestPath.replace(/^[/\\]+/, '')
      const filePath = resolve(rendererRoot, relativeRequestPath)

      if (!filePath.startsWith(rendererRoot)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }

      let payload: Buffer
      let servedPath = filePath

      try {
        payload = await readFile(filePath)
      } catch {
        servedPath = resolve(rendererRoot, 'index.html')
        payload = await readFile(servedPath)
      }

      response.writeHead(200, {
        'Content-Type': getRendererMimeType(servedPath),
        'Cache-Control': 'no-cache'
      })
      response.end(payload)
    } catch {
      response.writeHead(500)
      response.end('Renderer load failed')
    }
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    productionRendererServer?.once('error', rejectPromise)
    productionRendererServer?.listen(0, '127.0.0.1', () => {
      productionRendererServer?.off('error', rejectPromise)
      resolvePromise()
    })
  })

  const address = productionRendererServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine production renderer server address')
  }

  productionRendererServerUrl = `${PRODUCTION_RENDERER_SCHEME}:${address.port}`
  return productionRendererServerUrl
}

function createWindow(): void {
  const preferredWidth = 1320
  const preferredHeight = 925
  const preferredMinWidth = 1320
  const preferredMinHeight = 925
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize

  const mainWindow = new BrowserWindow({
    width: Math.min(preferredWidth, workAreaWidth),
    height: Math.min(preferredHeight, workAreaHeight),
    minWidth: Math.min(preferredMinWidth, workAreaWidth),
    minHeight: Math.min(preferredMinHeight, workAreaHeight),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }

  void ensureProductionRendererServer()
    .then((serverUrl) => mainWindow.loadURL(serverUrl))
    .catch(() => mainWindow.loadFile(join(__dirname, '../renderer/index.html')))
}

app.whenReady().then(async () => {
  await migrateLegacyUserDataIfNeeded()

  electronApp.setAppUserModelId('com.questvault')

  protocol.handle('qam-asset', (request) => {
    const requestUrl = new URL(request.url)
    const encodedPath = `${requestUrl.host}${requestUrl.pathname}`.replace(/^\/+/, '')
    const filePath = decodeURIComponent(encodedPath)
    return net.fetch(pathToFileURL(filePath).toString())
  })

  settingsService.onIndexUpdated((update) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send('settings:index-updated', update)
    }
  })

  vrSrcService.onTransferProgress((update) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send('vrsrc:transfer-progress', update)
    }
  })

  await vrSrcService.resumeQueuedRequests()

  dependencyService.onBootstrapProgress((update) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send('dependencies:bootstrap-progress', update)
    }
  })

  ipcMain.handle('devices:list', async () => deviceService.listDevices())
  ipcMain.handle('dependencies:get-status', async () => dependencyService.ensureStartupDependencies())
  ipcMain.handle('dependencies:ensure-ready', async () => dependencyService.ensureStartupDependencies())
  ipcMain.handle('app:check-for-updates', async () => {
    try {
      return await releaseService.checkForUpdates(app.getVersion())
    } catch (error) {
      return {
        success: false,
        currentVersion: app.getVersion(),
        latestVersion: null,
        latestTag: null,
        releaseUrl: null,
        publishedAt: null,
        updateAvailable: false,
        message: 'Unable to check for updates.',
        details: error instanceof Error ? error.message : 'Unknown error.'
      }
    }
  })
  ipcMain.handle('devices:connect', async (_event, address: string) => deviceService.connect(address))
  ipcMain.handle('devices:disconnect', async (_event, serial: string) => deviceService.disconnect(serial))
  ipcMain.handle('devices:get-user-name', async (_event, serial: string) => deviceService.getUserName(serial))
  ipcMain.handle('devices:set-user-name', async (_event, serial: string, userName: string) =>
    deviceService.setUserName(serial, userName)
  )
  ipcMain.handle('devices:list-installed-apps', async (_event, serial: string) => deviceService.listInstalledApps(serial))
  ipcMain.handle('devices:scan-leftover-data', async (_event, serial: string) => deviceService.scanLeftoverData(serial))
  ipcMain.handle('devices:delete-leftover-data', async (_event, serial: string, itemId: string) =>
    deviceService.deleteLeftoverData(serial, itemId)
  )
  ipcMain.handle('devices:uninstall-installed-app', async (_event, serial: string, packageId: string) =>
    deviceService.uninstallInstalledApp(serial, packageId)
  )
  ipcMain.handle('devices:reboot', async (_event, serial: string) => deviceService.rebootDevice(serial))
  ipcMain.handle('devices:backup-installed-app', async (_event, serial: string, packageId: string, backupPath: string) =>
    deviceService.backupInstalledApp(serial, packageId, backupPath)
  )
  ipcMain.handle('devices:choose-manual-install-apk', async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, {
          properties: ['openFile'],
          title: 'Select APK file to install',
          filters: [
            { name: 'APK Files', extensions: ['apk'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          title: 'Select APK file to install',
          filters: [
            { name: 'APK Files', extensions: ['apk'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  ipcMain.handle('devices:choose-manual-install-folder', async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, {
          properties: ['openDirectory'],
          title: 'Select folder to install'
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Select folder to install'
        })

    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  ipcMain.handle('devices:install-manual-path', async (_event, serial: string, sourcePath: string) =>
    deviceService.installManualPath(serial, sourcePath)
  )
  ipcMain.handle(
    'savegames:list-backups',
    async () => savegameService.listBackups()
  )
  ipcMain.handle(
    'savegames:scan-packages',
    async (
      _event,
      serial: string,
      packages: Array<{ packageId: string; appName: string | null }>
    ) => savegameService.scanPackages(serial, packages)
  )
  ipcMain.handle(
    'savegames:backup-package',
    async (_event, serial: string, packageId: string, appName: string | null) =>
      savegameService.backupPackage(serial, packageId, appName)
  )
  ipcMain.handle(
    'savegames:restore-backup',
    async (_event, serial: string, packageId: string, backupId: string) =>
      savegameService.restoreBackup(serial, packageId, backupId)
  )
  ipcMain.handle(
    'savegames:delete-backup',
    async (_event, backupId: string) => savegameService.deleteBackup(backupId)
  )
  ipcMain.handle('meta-store:get-status', async () => metaStoreService.getStatus())
  ipcMain.handle('meta-store:search', async (_event, query: string) => metaStoreService.search(query))
  ipcMain.handle('meta-store:get-details', async (_event, storeId: string) => metaStoreService.getDetails(storeId))
  ipcMain.handle('meta-store:get-cached-matches-by-package-ids', async (_event, packageIds: string[]) =>
    metaStoreService.getCachedMatchesByPackageIds(packageIds)
  )
  ipcMain.handle('meta-store:peek-cached-matches-by-package-ids', async (_event, packageIds: string[]) =>
    metaStoreService.peekCachedMatchesByPackageIds(packageIds)
  )
  ipcMain.handle('meta-store:peek-cached-details', async (_event, storeId: string) =>
    metaStoreService.peekCachedDetails(storeId)
  )
  ipcMain.handle('meta-store:get-installed-package-index', async () => metaStoreService.getInstalledPackageIndex())
  ipcMain.handle('meta-store:refresh-installed-package-index', async (_event, packageIds: string[]) =>
    metaStoreService.refreshInstalledPackageIndex(packageIds)
  )
  ipcMain.handle(
    'meta-store:replace-installed-package-index',
    async (_event, matchesByPackageId: Record<string, import('@shared/types/ipc').MetaStoreGameSummary>) =>
      metaStoreService.replaceInstalledPackageIndex(matchesByPackageId)
  )
  ipcMain.handle('vrsrc:get-status', async () => vrSrcService.getStatus())
  ipcMain.handle('vrsrc:get-catalog', async () => vrSrcService.getCatalog())
  ipcMain.handle('vrsrc:get-item-details', async (_event, releaseName: string, gameName: string) =>
    vrSrcService.getItemDetails(releaseName, gameName)
  )
  ipcMain.handle('vrsrc:sync-catalog', async () => vrSrcService.syncCatalog())
  ipcMain.handle('vrsrc:clear-cache', async () => vrSrcService.clearCache())
  ipcMain.handle('vrsrc:download-to-library', async (_event, releaseName: string) =>
    vrSrcService.downloadToLibrary(releaseName)
  )
  ipcMain.handle('vrsrc:download-to-library-and-install', async (_event, serial: string, releaseName: string) =>
    vrSrcService.downloadToLibraryAndInstall(serial, releaseName)
  )
  ipcMain.handle('vrsrc:install-now', async (_event, serial: string, releaseName: string) =>
    vrSrcService.installNow(serial, releaseName)
  )
  ipcMain.handle('vrsrc:pause-transfer', async (_event, releaseName: string, operation: string) =>
    vrSrcService.pauseTransfer(releaseName, operation as 'download-to-library' | 'install-now')
  )
  ipcMain.handle('vrsrc:resume-transfer', async (_event, releaseName: string, operation: string) =>
    vrSrcService.resumeTransfer(releaseName, operation as 'download-to-library' | 'install-now')
  )
  ipcMain.handle('vrsrc:cancel-transfer', async (_event, releaseName: string, operation: string) =>
    vrSrcService.cancelTransfer(releaseName, operation as 'download-to-library' | 'install-now')
  )
  ipcMain.handle('devices:install-local-library-item', async (_event, serial: string, itemId: string) => {
    const item = await settingsService.getIndexedLocalLibraryItem(itemId)

    if (!item) {
      const runtime = await deviceService.listDevices()
      return {
        runtime: runtime.runtime,
        serial,
        itemId,
        success: false,
        message: 'That library item is no longer available in the current index.',
        details: null,
        packageName: null
      }
    }

    return deviceService.installLocalLibraryItem(serial, item)
  })
  ipcMain.handle('headset-actions:get-recent', async () => headsetActionLogService.readRecent())
  ipcMain.handle('settings:get', async () => settingsService.getSettings())
  ipcMain.handle('settings:get-local-library-index', async () => settingsService.getLocalLibraryIndex())
  ipcMain.handle('settings:get-backup-storage-index', async () => settingsService.getBackupStorageIndex())
  ipcMain.handle('settings:get-path-stats', async (_event, key) => settingsService.getPathStats(key))
  ipcMain.handle('settings:choose-path', async (event, key) =>
    settingsService.choosePath(key, BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle('settings:import-manual-metadata-image', async (event) =>
    settingsService.importManualMetadataImage(BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle('settings:extract-indexed-item-artwork', async (_event, source: 'library' | 'backup', itemId: string, target: 'hero' | 'cover') =>
    settingsService.extractIndexedItemArtwork(source, itemId, target)
  )
  ipcMain.handle('settings:clear-path', async (_event, key) => settingsService.clearPath(key))
  ipcMain.handle('settings:set-display-mode', async (_event, key, mode) => settingsService.setDisplayMode(key, mode))
  ipcMain.handle('settings:rescan-local-library', async () => settingsService.rescanLocalLibrary())
  ipcMain.handle('settings:rescan-backup-storage', async () => settingsService.rescanBackupStorage())
  ipcMain.handle('settings:move-backup-storage-item-to-library', async (_event, itemId: string) =>
    settingsService.moveBackupStorageItemToLibrary(itemId)
  )
  ipcMain.handle('settings:delete-backup-storage-item', async (_event, itemId: string) =>
    settingsService.deleteBackupStorageItem(itemId)
  )
  ipcMain.handle('settings:remove-missing-library-item', async (_event, itemId: string) =>
    settingsService.removeMissingLocalLibraryItem(itemId)
  )
  ipcMain.handle('settings:purge-library-item', async (_event, itemId: string) => settingsService.purgeLocalLibraryItem(itemId))
  ipcMain.handle('settings:set-local-library-item-manual-store-id', async (_event, itemId: string, storeId: string) =>
    settingsService.setLocalLibraryItemManualStoreId(itemId, storeId)
  )
  ipcMain.handle(
    'settings:set-indexed-item-manual-metadata',
    async (_event, source: 'library' | 'backup', itemId: string, metadata) =>
      settingsService.setIndexedItemManualMetadata(source, itemId, metadata)
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  productionRendererServer?.close()
  productionRendererServer = null
  productionRendererServerUrl = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
