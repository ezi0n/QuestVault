import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  DeviceInstalledAppBackupResponse,
  DeviceInstalledAppActionResponse,
  DeviceAppsResponse,
  DeviceConnectResponse,
  DeviceLeftoverDeleteResponse,
  DeviceLeftoverItem,
  DeviceLeftoverLocation,
  DeviceLeftoverScanResponse,
  DeviceLibraryInstallResponse,
  DeviceListResponse,
  DeviceManualInstallResponse,
  DeviceRuntimeInfo,
  DeviceSummary,
  DeviceUserNameResponse,
  InstalledAppSummary,
  LocalLibraryIndexedItem
} from '@shared/types/ipc'
import { dependencyService } from './dependencyService'
import { headsetActionLogService, type HeadsetActionContext } from './headsetActionLogService'

const execFileAsync = promisify(execFile)
const PLATFORM_PACKAGE_PREFIXES = ['com.android.', 'com.oculus.', 'com.meta.', 'com.facebook.']

interface ParsedDeviceRow {
  id: string
  state: string
  product: string | null
  model: string | null
  transportId: string | null
}

class DeviceService {
  private catalogNameMapPromise: Promise<Map<string, string>> | null = null
  private blockedLeftoverDeletes = new Map<string, string>()

  async listDevices(): Promise<DeviceListResponse> {
    const runtime = await this.resolveRuntime()
    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        devices: [],
        scannedAt: new Date().toISOString()
      }
    }

    try {
      const { stdout } = await execFileAsync(runtime.adbPath, ['devices', '-l'])
      const parsedRows = this.parseDeviceRows(stdout)
      const devices = await Promise.all(parsedRows.map((row) => this.enrichDevice(runtime.adbPath as string, row)))

      return {
        runtime,
        devices,
        scannedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: this.readErrorMessage(error)
        },
        devices: [],
        scannedAt: new Date().toISOString()
      }
    }
  }

  async connect(address: string): Promise<DeviceConnectResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedAddress = address.trim()
    const action = await this.startHeadsetAction('connect', {
      serial: normalizedAddress || null,
      message: normalizedAddress
        ? `Starting headset connection to ${normalizedAddress}.`
        : 'Starting headset connection without a target address.'
    })

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      await this.failHeadsetAction(action, runtime.message, { runtimeStatus: runtime.status })
      return {
        runtime,
        success: false,
        message: runtime.message,
        serial: null
      }
    }

    if (!normalizedAddress) {
      await this.failHeadsetAction(action, 'Enter an IP address or host:port value.')
      return {
        runtime,
        success: false,
        message: 'Enter an IP address or host:port value.',
        serial: null
      }
    }

    const target = normalizedAddress.includes(':') ? normalizedAddress : `${normalizedAddress}:5555`
    const [targetHost, targetPortText] = target.split(':')
    const targetPort = Number.parseInt(targetPortText ?? '5555', 10) || 5555

    try {
      const preparationMessage = await this.prepareWirelessAdb(runtime.adbPath, targetHost, targetPort)
      if (preparationMessage) {
        await this.logHeadsetActionStep(action, preparationMessage)
      }
      const { stdout, stderr } = await execFileAsync(runtime.adbPath, ['connect', target])
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      const success = /connected to|already connected to/i.test(output)
      const message = [preparationMessage, output || (success ? `Connected to ${target}.` : `Unable to connect to ${target}.`)]
        .filter(Boolean)
        .join('\n')

      if (success) {
        await this.completeHeadsetAction(action, message, { target })
      } else {
        await this.failHeadsetAction(action, message, { target })
      }

      return {
        runtime,
        success,
        message,
        serial: success ? target : null
      }
    } catch (error) {
      const message = this.readErrorMessage(error)
      await this.failHeadsetAction(action, message, { target })
      return {
        runtime,
        success: false,
        message,
        serial: null
      }
    }
  }

  async disconnect(serial: string): Promise<DeviceConnectResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const action = await this.startHeadsetAction('disconnect', {
      serial: normalizedSerial || null,
      message: normalizedSerial
        ? `Starting headset disconnect for ${normalizedSerial}.`
        : 'Starting headset disconnect without a target serial.'
    })

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      await this.failHeadsetAction(action, runtime.message, { runtimeStatus: runtime.status })
      return {
        runtime,
        success: false,
        message: runtime.message,
        serial: null
      }
    }

    if (!normalizedSerial) {
      await this.failHeadsetAction(action, 'No device serial provided.')
      return {
        runtime,
        success: false,
        message: 'No device serial provided.',
        serial: null
      }
    }

    try {
      const { stdout, stderr } = await execFileAsync(runtime.adbPath, ['disconnect', normalizedSerial])
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      await this.completeHeadsetAction(action, output || `Disconnected ${normalizedSerial}.`, {
        serial: normalizedSerial
      })

      return {
        runtime,
        success: true,
        message: output || `Disconnected ${normalizedSerial}.`,
        serial: normalizedSerial
      }
    } catch (error) {
      const message = this.readErrorMessage(error)
      await this.failHeadsetAction(action, message, { serial: normalizedSerial })
      return {
        runtime,
        success: false,
        message,
        serial: null
      }
    }
  }

  async listInstalledApps(serial: string): Promise<DeviceAppsResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        serial: normalizedSerial,
        apps: [],
        systemAppCount: 0,
        scannedAt: new Date().toISOString()
      }
    }

    if (!normalizedSerial) {
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: 'No device selected for installed app inventory.'
        },
        serial: normalizedSerial,
        apps: [],
        systemAppCount: 0,
        scannedAt: new Date().toISOString()
      }
    }

    try {
      const [apps, systemAppCount] = await Promise.all([
        this.readInstalledApps(runtime.adbPath, normalizedSerial),
        this.readSystemAppCount(runtime.adbPath, normalizedSerial)
      ])

      return {
        runtime,
        serial: normalizedSerial,
        apps,
        systemAppCount,
        scannedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: this.readErrorMessage(error)
        },
        serial: normalizedSerial,
        apps: [],
        systemAppCount: 0,
        scannedAt: new Date().toISOString()
      }
    }
  }

  async scanLeftoverData(serial: string): Promise<DeviceLeftoverScanResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        serial: normalizedSerial,
        items: [],
        scannedAt: new Date().toISOString(),
        message: runtime.message
      }
    }

    if (!normalizedSerial) {
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: 'No device selected for leftover data scan.'
        },
        serial: normalizedSerial,
        items: [],
        scannedAt: new Date().toISOString(),
        message: 'No device selected for leftover data scan.'
      }
    }

    try {
      const installedPackages = await this.readInstalledPackageIds(runtime.adbPath, normalizedSerial)
      const [obbDirs, dataDirs] = await Promise.all([
        this.readPackageDirectories(runtime.adbPath, normalizedSerial, 'obb', '/sdcard/Android/obb'),
        this.readPackageDirectories(runtime.adbPath, normalizedSerial, 'data', '/sdcard/Android/data')
      ])
      const items = [...obbDirs, ...dataDirs]
        .filter((item) => {
          const packageId = item.packageId.toLowerCase()
          return !installedPackages.has(packageId) && this.isPotentialThirdPartyPackage(packageId)
        })
        .map((item) => {
          const blockedReason = this.blockedLeftoverDeletes.get(this.buildLeftoverDeleteBlockKey(normalizedSerial, item.absolutePath)) ?? null
          return {
            ...item,
            deleteBlocked: Boolean(blockedReason),
            deleteBlockedReason: blockedReason
          }
        })
        .sort((left, right) => left.packageId.localeCompare(right.packageId, undefined, { sensitivity: 'base' }))
      const blockedCount = items.filter((item) => item.deleteBlocked).length

      return {
        runtime,
        serial: normalizedSerial,
        items,
        scannedAt: new Date().toISOString(),
        message: items.length
          ? blockedCount
            ? `Found ${items.length} leftover ${items.length === 1 ? 'entry' : 'entries'} on the headset. Some orphaned Android/data folders are visible but protected by Quest storage permissions; ${blockedCount} ${blockedCount === 1 ? 'entry is' : 'entries are'} not removable through standard ADB cleanup.`
            : `Found ${items.length} leftover ${items.length === 1 ? 'entry' : 'entries'} on the headset.`
          : 'No leftover Android/data or Android/obb folders were found.'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to scan headset leftover data.'
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message
        },
        serial: normalizedSerial,
        items: [],
        scannedAt: new Date().toISOString(),
        message
      }
    }
  }

  async deleteLeftoverData(serial: string, itemId: string): Promise<DeviceLeftoverDeleteResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const normalizedItemId = itemId.trim()

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      const scan = await this.scanLeftoverData(normalizedSerial)
      return {
        runtime,
        serial: normalizedSerial,
        itemId: normalizedItemId,
        success: false,
        message: runtime.message,
        details: null,
        scan
      }
    }

    if (!normalizedSerial) {
      const scan = await this.scanLeftoverData(normalizedSerial)
      const message = 'No device selected for leftover data cleanup.'
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        itemId: normalizedItemId,
        success: false,
        message,
        details: null,
        scan
      }
    }

    const scanBefore = await this.scanLeftoverData(normalizedSerial)
    const target = scanBefore.items.find((item) => item.id === normalizedItemId) ?? null
    if (!target) {
      return {
        runtime,
        serial: normalizedSerial,
        itemId: normalizedItemId,
        success: false,
        message: 'That leftover entry is no longer present in the latest scan.',
        details: null,
        scan: scanBefore
      }
    }

    try {
      await this.runShellCommand(runtime.adbPath, normalizedSerial, `rm -rf "${target.absolutePath}"`)
      this.blockedLeftoverDeletes.delete(this.buildLeftoverDeleteBlockKey(normalizedSerial, target.absolutePath))
      const scan = await this.scanLeftoverData(normalizedSerial)
      return {
        runtime,
        serial: normalizedSerial,
        itemId: normalizedItemId,
        success: true,
        message: `Deleted leftover ${target.location.toUpperCase()} data for ${target.packageId}.`,
        details: null,
        scan
      }
    } catch (error) {
      const details = this.readErrorMessage(error)
      const isPermissionBlocked = /permission denied/i.test(details)
      if (isPermissionBlocked) {
        this.blockedLeftoverDeletes.set(
          this.buildLeftoverDeleteBlockKey(normalizedSerial, target.absolutePath),
          'Protected by Android/Quest storage permissions. Standard ADB can see this leftover path but cannot remove it.'
        )
      }
      const scan = await this.scanLeftoverData(normalizedSerial)
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: isPermissionBlocked
            ? `Android blocked deletion of leftover data for ${target.packageId}.`
            : `Unable to delete leftover data for ${target.packageId}.`
        },
        serial: normalizedSerial,
        itemId: normalizedItemId,
        success: false,
        message: isPermissionBlocked
          ? `Android blocked deletion of leftover data for ${target.packageId}.`
          : `Unable to delete leftover data for ${target.packageId}.`,
        details: isPermissionBlocked
          ? `${details}\n\nThis leftover path is readable enough to appear in the scan, but Quest is denying delete access through standard ADB.`
          : details,
        scan
      }
    }
  }

  async getUserName(serial: string): Promise<DeviceUserNameResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        serial: normalizedSerial,
        success: false,
        userName: null,
        message: runtime.message
      }
    }

    if (!normalizedSerial) {
      const message = 'No device selected for username lookup.'
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        success: false,
        userName: null,
        message
      }
    }

    try {
      const rawUserName = await this.runShellCommand(runtime.adbPath, normalizedSerial, 'settings get global username')
      const trimmedUserName = rawUserName.trim()

      return {
        runtime,
        serial: normalizedSerial,
        success: true,
        userName: !trimmedUserName || trimmedUserName === 'null' ? null : trimmedUserName,
        message: 'Loaded multiplayer username.'
      }
    } catch (error) {
      const message = this.readErrorMessage(error)
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        success: false,
        userName: null,
        message
      }
    }
  }

  async setUserName(serial: string, userName: string): Promise<DeviceUserNameResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const trimmedUserName = userName.trim()

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        serial: normalizedSerial,
        success: false,
        userName: null,
        message: runtime.message
      }
    }

    if (!normalizedSerial) {
      const message = 'No device selected for username update.'
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        success: false,
        userName: null,
        message
      }
    }

    if (!trimmedUserName) {
      const message = 'Enter a multiplayer username before saving.'
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        success: false,
        userName: null,
        message
      }
    }

    try {
      await execFileAsync(
        runtime.adbPath,
        ['-s', normalizedSerial, 'shell', 'settings', 'put', 'global', 'username', trimmedUserName],
        {
          maxBuffer: 10 * 1024 * 1024
        }
      )

      return {
        runtime,
        serial: normalizedSerial,
        success: true,
        userName: trimmedUserName,
        message: 'Multiplayer username updated.'
      }
    } catch (error) {
      const message = this.readErrorMessage(error)
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        success: false,
        userName: null,
        message
      }
    }
  }

  async uninstallInstalledApp(serial: string, packageId: string): Promise<DeviceInstalledAppActionResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const normalizedPackageId = packageId.trim()
    const action = await this.startHeadsetAction('uninstall', {
      serial: normalizedSerial || null,
      packageName: normalizedPackageId || null,
      message: normalizedPackageId
        ? `Starting uninstall for ${normalizedPackageId}.`
        : 'Starting uninstall without a package name.'
    })

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      await this.failHeadsetAction(action, runtime.message, { runtimeStatus: runtime.status })
      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message: runtime.message,
        details: null
      }
    }

    if (!normalizedSerial) {
      const message = 'No device selected for uninstall.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message
        },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message,
        details: null
      }
    }

    if (!normalizedPackageId) {
      const message = 'No package selected for uninstall.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message
        },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message,
        details: null
      }
    }

    try {
      await this.logHeadsetActionStep(action, `Running uninstall for ${normalizedPackageId}.`, {
        packageName: normalizedPackageId
      })
      const { stdout, stderr } = await execFileAsync(runtime.adbPath, ['-s', normalizedSerial, 'uninstall', normalizedPackageId], {
        maxBuffer: 10 * 1024 * 1024
      })
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      const message = `Uninstalled ${normalizedPackageId}.`
      await this.completeHeadsetAction(action, output || message, {
        packageName: normalizedPackageId
      })

      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: true,
        message,
        details: output && output !== 'Success' ? output : null
      }
    } catch (error) {
      const details = this.readErrorMessage(error)
      const message = `Unable to uninstall ${normalizedPackageId}.`
      await this.failHeadsetAction(action, details, { packageName: normalizedPackageId })
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message
        },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message,
        details
      }
    }
  }

  async backupInstalledApp(serial: string, packageId: string, backupPath: string): Promise<DeviceInstalledAppBackupResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const normalizedPackageId = packageId.trim()
    const normalizedBackupPath = backupPath.trim()
    const action = await this.startHeadsetAction('install', {
      serial: normalizedSerial || null,
      packageName: normalizedPackageId || null,
      message: normalizedPackageId
        ? `Starting backup for ${normalizedPackageId}.`
        : 'Starting backup without a package name.',
      metadata: {
        backupPath: normalizedBackupPath || null
      }
    })

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      await this.failHeadsetAction(action, runtime.message, { runtimeStatus: runtime.status })
      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message: runtime.message,
        details: null,
        backupPath: null
      }
    }

    if (!normalizedSerial) {
      const message = 'No device selected for backup.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message,
        details: null,
        backupPath: null
      }
    }

    if (!normalizedPackageId) {
      const message = 'No package selected for backup.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message,
        details: null,
        backupPath: null
      }
    }

    if (!normalizedBackupPath) {
      const message = 'Choose a backup folder in Settings before creating app backups.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message,
        details: null,
        backupPath: null
      }
    }

    try {
      await this.logHeadsetActionStep(action, `Resolving installed APK paths for ${normalizedPackageId}.`, {
        packageName: normalizedPackageId
      })
      const packageRows = await this.readInstalledPackageRows(runtime.adbPath, normalizedSerial)
      const packageRow = packageRows.find((row) => row.packageId === normalizedPackageId) ?? null
      const catalogNameMap = await this.readCatalogNameMap()
      const backupDisplayName =
        catalogNameMap.get(normalizedPackageId) ??
        this.inferLabel(normalizedPackageId)
      const sanitizedBackupDisplayName = this.sanitizeBackupFolderSegment(backupDisplayName)
      const versionNameSuffix = this.sanitizeBackupFolderSegment(
        packageRow?.version?.trim() || packageRow?.versionCode?.trim() || 'unknown'
      )
      const { stdout: pathStdout } = await execFileAsync(runtime.adbPath, ['-s', normalizedSerial, 'shell', 'pm', 'path', normalizedPackageId], {
        maxBuffer: 10 * 1024 * 1024
      })
      const apkPaths = pathStdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('package:'))
        .map((line) => line.replace(/^package:/, ''))

      if (!apkPaths.length) {
        const message = `No installed APK paths were found for ${normalizedPackageId}.`
        await this.failHeadsetAction(action, message, { packageName: normalizedPackageId })
        return {
          runtime: { status: 'error', adbPath: runtime.adbPath, message },
          serial: normalizedSerial,
          packageId: normalizedPackageId,
          success: false,
          message,
          details: null,
          backupPath: null
        }
      }

      const destinationRoot = join(
        normalizedBackupPath,
        `${sanitizedBackupDisplayName}_-_${versionNameSuffix}`
      )
      await mkdir(destinationRoot, { recursive: true })

      for (const [index, apkPath] of apkPaths.entries()) {
        const destinationFileName =
          index === 0
            ? `${normalizedPackageId}.apk`
            : `${normalizedPackageId}-${basename(apkPath)}`
        await this.logHeadsetActionStep(action, `Pulling APK ${basename(apkPath)}.`, {
          apkPath,
          destination: join(destinationRoot, destinationFileName)
        })
        await execFileAsync(runtime.adbPath, ['-s', normalizedSerial, 'pull', apkPath, join(destinationRoot, destinationFileName)], {
          maxBuffer: 10 * 1024 * 1024
        })
      }

      const obbCheck = await this.runShellCommand(
        runtime.adbPath,
        normalizedSerial,
        `[ -d "/sdcard/Android/obb/${normalizedPackageId}" ] && echo present || true`
      )
      if (obbCheck.includes('present')) {
        const obbDestination = join(destinationRoot, normalizedPackageId)
        await this.logHeadsetActionStep(action, `Pulling OBB payloads for ${normalizedPackageId}.`, {
          destination: obbDestination
        })
        await execFileAsync(
          runtime.adbPath,
          ['-s', normalizedSerial, 'pull', `/sdcard/Android/obb/${normalizedPackageId}`, obbDestination],
          { maxBuffer: 10 * 1024 * 1024 }
        )
      }

      const message = `Backed up ${normalizedPackageId} to ${destinationRoot}.`
      await this.completeHeadsetAction(action, message, {
        packageName: normalizedPackageId,
        backupPath: destinationRoot
      })
      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: true,
        message,
        details: null,
        backupPath: destinationRoot
      }
    } catch (error) {
      const details = this.readErrorMessage(error)
      const message = `Unable to back up ${normalizedPackageId}.`
      await this.failHeadsetAction(action, details, { packageName: normalizedPackageId, backupPath: normalizedBackupPath })
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message,
        details,
        backupPath: null
      }
    }
  }

  async installLocalLibraryItem(serial: string, item: LocalLibraryIndexedItem): Promise<DeviceLibraryInstallResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const action = await this.startHeadsetAction('install', {
      serial: normalizedSerial || null,
      itemId: item.id,
      itemName: item.name,
      packageName: item.packageIds[0] ?? null,
      message: `Starting install for local library item ${item.name}.`,
      metadata: {
        kind: item.kind,
        installReady: item.installReady,
        packageHintCount: item.packageIds.length
      }
    })

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      await this.failHeadsetAction(action, runtime.message, { runtimeStatus: runtime.status })
      return {
        runtime,
        serial: normalizedSerial,
        itemId: item.id,
        success: false,
        message: runtime.message,
        details: null,
        packageName: null
      }
    }

    if (!normalizedSerial) {
      await this.failHeadsetAction(action, 'No device selected for installation.')
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: 'No device selected for installation.'
        },
        serial: normalizedSerial,
        itemId: item.id,
        success: false,
        message: 'No device selected for installation.',
        details: null,
        packageName: null
      }
    }

    if (item.availability !== 'present') {
      await this.failHeadsetAction(action, 'Only present library items can be installed.')
      return {
        runtime,
        serial: normalizedSerial,
        itemId: item.id,
        success: false,
        message: 'Only present library items can be installed.',
        details: null,
        packageName: null
      }
    }

    if (!item.installReady && item.kind !== 'apk') {
      await this.failHeadsetAction(action, 'This library item is not install-ready yet.')
      return {
        runtime,
        serial: normalizedSerial,
        itemId: item.id,
        success: false,
        message: 'This library item is not install-ready yet.',
        details: null,
        packageName: null
      }
    }

    try {
      await this.logHeadsetActionStep(action, `Resolved managed ADB runtime at ${runtime.adbPath}.`)
      const installResult =
        item.kind === 'apk'
          ? await this.installSingleApk(runtime.adbPath, normalizedSerial, item.absolutePath, action)
          : await this.installFolderPayload(runtime.adbPath, normalizedSerial, item, action)

      if (installResult.success) {
        await this.completeHeadsetAction(action, installResult.message, {
          packageName: installResult.packageName ?? item.packageIds[0] ?? null
        })
      } else {
        await this.failHeadsetAction(action, installResult.message, {
          packageName: installResult.packageName ?? item.packageIds[0] ?? null
        })
      }

      return {
        runtime,
        serial: normalizedSerial,
        itemId: item.id,
        success: installResult.success,
        message: installResult.message,
        details: installResult.details,
        packageName: installResult.packageName
      }
    } catch (error) {
      const details = this.readErrorMessage(error)
      const message = `Unable to install ${item.name}.`
      await this.failHeadsetAction(action, details, {
        packageName: item.packageIds[0] ?? null
      })
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message
        },
        serial: normalizedSerial,
        itemId: item.id,
        success: false,
        message,
        details,
        packageName: null
      }
    }
  }

  async installManualPath(serial: string, sourcePath: string): Promise<DeviceManualInstallResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const normalizedSourcePath = sourcePath.trim()
    const sourceName = basename(normalizedSourcePath) || normalizedSourcePath
    const action = await this.startHeadsetAction('install', {
      serial: normalizedSerial || null,
      itemName: sourceName,
      message: normalizedSourcePath
        ? `Starting manual install for ${sourceName}.`
        : 'Starting manual install without a source path.'
    })

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      await this.failHeadsetAction(action, runtime.message, { runtimeStatus: runtime.status })
      return {
        runtime,
        serial: normalizedSerial,
        sourcePath: normalizedSourcePath,
        success: false,
        message: runtime.message,
        details: null,
        packageName: null
      }
    }

    if (!normalizedSerial) {
      const message = 'No device selected for installation.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        sourcePath: normalizedSourcePath,
        success: false,
        message,
        details: null,
        packageName: null
      }
    }

    if (!normalizedSourcePath) {
      const message = 'No APK file or folder was selected.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        sourcePath: normalizedSourcePath,
        success: false,
        message,
        details: null,
        packageName: null
      }
    }

    try {
      const sourceStats = await stat(normalizedSourcePath)
      let installResult: { success: boolean; message: string; details: string | null; packageName: string | null }

      await this.logHeadsetActionStep(action, `Resolved manual install source ${normalizedSourcePath}.`)

      if (sourceStats.isFile()) {
        if (!normalizedSourcePath.toLowerCase().endsWith('.apk')) {
          const message = 'Only standalone APK files can be installed from manual file selection.'
          await this.failHeadsetAction(action, message, { sourcePath: normalizedSourcePath })
          return {
            runtime: { status: 'error', adbPath: runtime.adbPath, message },
            serial: normalizedSerial,
            sourcePath: normalizedSourcePath,
            success: false,
            message,
            details: null,
            packageName: null
          }
        }

        installResult = await this.installSingleApk(runtime.adbPath, normalizedSerial, normalizedSourcePath, action)
      } else if (sourceStats.isDirectory()) {
        const tempItem: LocalLibraryIndexedItem = {
          id: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          name: sourceName,
          relativePath: sourceName,
          absolutePath: normalizedSourcePath,
          searchTerms: [sourceName],
          packageIds: [],
          kind: 'folder',
          availability: 'present',
          discoveryState: 'existing',
          installReady: true,
          sizeBytes: 0,
          modifiedAt: new Date().toISOString(),
          childCount: 0,
          apkCount: 0,
          obbCount: 0,
          archiveCount: 0,
          libraryVersion: null,
          libraryVersionCode: null,
          manualStoreId: null,
          manualStoreIdEdited: false,
          manualMetadata: null,
          note: 'Manual install source.'
        }

        installResult = await this.installFolderPayload(runtime.adbPath, normalizedSerial, tempItem, action)
      } else {
        const message = 'The selected manual install source is not a file or folder.'
        await this.failHeadsetAction(action, message, { sourcePath: normalizedSourcePath })
        return {
          runtime: { status: 'error', adbPath: runtime.adbPath, message },
          serial: normalizedSerial,
          sourcePath: normalizedSourcePath,
          success: false,
          message,
          details: null,
          packageName: null
        }
      }

      if (installResult.success) {
        await this.completeHeadsetAction(action, installResult.message, {
          sourcePath: normalizedSourcePath,
          packageName: installResult.packageName
        })
      } else {
        await this.failHeadsetAction(action, installResult.message, {
          sourcePath: normalizedSourcePath,
          packageName: installResult.packageName
        })
      }

      return {
        runtime,
        serial: normalizedSerial,
        sourcePath: normalizedSourcePath,
        success: installResult.success,
        message: installResult.message,
        details: installResult.details,
        packageName: installResult.packageName
      }
    } catch (error) {
      const details = this.readErrorMessage(error)
      const message = `Unable to install ${sourceName}.`
      await this.failHeadsetAction(action, details, { sourcePath: normalizedSourcePath })
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message },
        serial: normalizedSerial,
        sourcePath: normalizedSourcePath,
        success: false,
        message,
        details,
        packageName: null
      }
    }
  }

  private async resolveRuntime(): Promise<DeviceRuntimeInfo> {
    return dependencyService.ensureManagedAdb()
  }

  private async prepareWirelessAdb(adbPath: string, targetHost: string, port: number): Promise<string | null> {
    const candidates = await this.listWirelessPreparationCandidates(adbPath)
    if (!candidates.length) {
      return null
    }

    const matchedCandidate =
      candidates.find((candidate) => candidate.ipAddress === targetHost) ??
      (candidates.length === 1 ? candidates[0] : null)

    if (!matchedCandidate) {
      return null
    }

    try {
      const { stdout, stderr } = await execFileAsync(adbPath, ['-s', matchedCandidate.id, 'tcpip', String(port)])
      await this.delay(1200)
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      return output || `Prepared ${matchedCandidate.label} for wireless ADB on port ${port}.`
    } catch (error) {
      return `Could not auto-enable wireless ADB on ${matchedCandidate.label}: ${this.readErrorMessage(error)}`
    }
  }

  private parseDeviceRows(rawOutput: string): ParsedDeviceRow[] {
    return rawOutput
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const segments = line.split(/\s+/)
        const id = segments[0] ?? ''
        const state = segments[1] ?? 'disconnected'
        const details = segments.slice(2)

        return {
          id,
          state,
          product: this.readToken(details, 'product'),
          model: this.readToken(details, 'model'),
          transportId: this.readToken(details, 'transport_id')
        }
      })
      .filter((row) => row.id.length > 0)
  }

  private readToken(parts: string[], token: string): string | null {
    const prefix = `${token}:`
    const match = parts.find((part) => part.startsWith(prefix))
    return match ? match.slice(prefix.length) : null
  }

  private async enrichDevice(adbPath: string, row: ParsedDeviceRow): Promise<DeviceSummary> {
    const transport = this.readTransport(row.id)
    const state = this.readState(row.state)

    if (state !== 'device') {
      const label = row.model ?? row.product ?? row.id
      return {
        id: row.id,
        label,
        transport,
        state,
        model: row.model,
        product: row.product,
        horizonOsDisplayName: null,
        batteryLevel: null,
        storageTotalBytes: null,
        storageFreeBytes: null,
        ipAddress: transport === 'tcp' ? row.id.split(':')[0] : null,
        note: this.describeDevice(row, state)
      }
    }

    const [batteryLevel, ipAddress, storageInfo, systemModel, horizonOsDisplayName] = await Promise.all([
      this.readBatteryLevel(adbPath, row.id).catch(() => null),
      this.readIpAddress(adbPath, row.id).catch(() => null),
      this.readStorageInfo(adbPath, row.id).catch(() => null),
      this.readSystemModel(adbPath, row.id).catch(() => null),
      this.readHorizonOsDisplayName(adbPath, row.id).catch(() => null)
    ])
    const normalizedModel = systemModel ?? row.model
    const label = normalizedModel ?? row.product ?? row.id

    return {
      id: row.id,
      label,
      transport,
      state,
      model: normalizedModel,
      product: row.product,
      horizonOsDisplayName,
      batteryLevel,
      storageTotalBytes: storageInfo?.totalBytes ?? null,
      storageFreeBytes: storageInfo?.freeBytes ?? null,
      ipAddress,
      note: this.describeDevice(row, state)
    }
  }

  private async readSystemModel(adbPath: string, serial: string): Promise<string | null> {
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', 'getprop', 'ro.product.system.model'])
    const normalized = stdout.trim().replace(/^\[(.*)\]$/, '$1').trim()
    return normalized || null
  }

  private async readHorizonOsDisplayName(adbPath: string, serial: string): Promise<string | null> {
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', 'getprop'])
    const match = stdout.match(/^\[ro\.hzos\.build\.display_name\]:\s*\[(.*?)\]\s*$/m)
    const normalized = match?.[1]?.trim() ?? ''
    return normalized || null
  }

  private async listWirelessPreparationCandidates(adbPath: string): Promise<DeviceSummary[]> {
    const { stdout } = await execFileAsync(adbPath, ['devices', '-l'])
    const parsedRows = this.parseDeviceRows(stdout)
    const usbRows = parsedRows.filter((row) => {
      const transport = this.readTransport(row.id)
      return row.state === 'device' && transport !== 'tcp'
    })

    return Promise.all(usbRows.map((row) => this.enrichDevice(adbPath, row)))
  }

  private async readBatteryLevel(adbPath: string, serial: string): Promise<number | null> {
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', 'dumpsys', 'battery'])
    const match = stdout.match(/level:\s*(\d+)/i)
    return match ? Number.parseInt(match[1], 10) : null
  }

  private async readIpAddress(adbPath: string, serial: string): Promise<string | null> {
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', 'ip', 'route'])
    const match = stdout.match(/src\s+(\d+\.\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  }

  private async readStorageInfo(
    adbPath: string,
    serial: string
  ): Promise<{ totalBytes: number; freeBytes: number } | null> {
    const targets = ['/data', '/storage/emulated/0', '/storage/emulated', '/sdcard']

    for (const target of targets) {
      try {
        const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', 'df', '-k', target])
        const lines = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)

        const dataLine = lines.find((line, index) => index > 0) ?? lines[1]
        if (!dataLine) {
          continue
        }

        const columns = dataLine.split(/\s+/)
        if (columns.length < 4) {
          continue
        }

        const filesystem = columns[0]?.toLowerCase() ?? ''
        const totalKilobytes = Number.parseInt(columns[1] ?? '', 10)
        const freeKilobytes = Number.parseInt(columns[3] ?? '', 10)

        if (!Number.isFinite(totalKilobytes) || !Number.isFinite(freeKilobytes) || totalKilobytes <= 0) {
          continue
        }

        // Ignore synthetic mounts that don't represent the headset's real storage capacity.
        if (filesystem === 'tmpfs') {
          continue
        }

        return {
          totalBytes: totalKilobytes * 1024,
          freeBytes: freeKilobytes * 1024
        }
      } catch {
        continue
      }
    }

    return null
  }

  private async readInstalledApps(adbPath: string, serial: string): Promise<InstalledAppSummary[]> {
    const [packageRows, packageSizes] = await Promise.all([
      this.readInstalledPackageRows(adbPath, serial),
      this.readInstalledPackageSizes(adbPath, serial)
    ])
    const catalogNameMap = await this.readCatalogNameMap()

    return packageRows
      .map((row) => ({
        packageId: row.packageId,
        label: catalogNameMap.get(row.packageId) ?? null,
        inferredLabel: this.inferLabel(row.packageId),
        version: row.version ?? row.versionCode,
        totalFootprintBytes: packageSizes.get(row.packageId) ?? null
      }))
      .sort((left, right) => (left.label ?? left.inferredLabel).localeCompare(right.label ?? right.inferredLabel))
  }

  private async readPackageDirectories(
    adbPath: string,
    serial: string,
    location: DeviceLeftoverLocation,
    basePath: string
  ): Promise<DeviceLeftoverItem[]> {
    const shellScript =
      `if [ -d "${basePath}" ]; then ` +
      `for path in "${basePath}"/*; do ` +
      `[ -d "$path" ] || continue; ` +
      `name=\${path##*/}; ` +
      `size=$(du -sk "$path" 2>/dev/null | cut -f1); ` +
      `echo "$name|$path|\${size:-}"; ` +
      `done; fi`

    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', shellScript], {
      maxBuffer: 10 * 1024 * 1024
    })

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [packageId, absolutePath, sizeInKb] = line.split('|')
        const parsedKb = sizeInKb ? Number.parseInt(sizeInKb, 10) : Number.NaN
        return {
          id: `${location}:${packageId}`,
          packageId,
          location,
          absolutePath,
          sizeBytes: Number.isFinite(parsedKb) ? parsedKb * 1024 : null,
          deleteBlocked: false,
          deleteBlockedReason: null
        } satisfies DeviceLeftoverItem
      })
      .filter((item) => Boolean(item.packageId) && Boolean(item.absolutePath))
  }

  private buildLeftoverDeleteBlockKey(serial: string, absolutePath: string): string {
    return `${serial.trim().toLowerCase()}::${absolutePath.trim().toLowerCase()}`
  }

  private async installSingleApk(
    adbPath: string,
    serial: string,
    apkPath: string,
    action?: HeadsetActionContext | null
  ): Promise<{ success: boolean; message: string; details: string | null; packageName: string | null }> {
    await this.logHeadsetActionStep(action, `Installing standalone APK ${basename(apkPath)}.`, {
      apkPath
    })
    await execFileAsync(adbPath, ['-s', serial, 'install', '-r', '-g', apkPath], { maxBuffer: 10 * 1024 * 1024 })
    return {
      success: true,
      message: `Installed ${basename(apkPath)} on ${serial}.`,
      details: null,
      packageName: null
    }
  }

  private async installFolderPayload(
    adbPath: string,
    serial: string,
    item: LocalLibraryIndexedItem,
    action?: HeadsetActionContext | null
  ): Promise<{ success: boolean; message: string; details: string | null; packageName: string | null }> {
    const files = await this.collectPayloadFiles(item.absolutePath)
    const apkPaths = files.filter((filePath) => filePath.toLowerCase().endsWith('.apk'))
    const obbPaths = files.filter((filePath) => filePath.toLowerCase().endsWith('.obb'))
    const installScriptPaths = files.filter((filePath) => basename(filePath).toLowerCase() === 'install.txt')

    if (!apkPaths.length) {
      await this.failHeadsetAction(action, 'No APK files were found in this library item.')
      return {
        success: false,
        message: 'No APK files were found in this library item.',
        details: null,
        packageName: null
      }
    }

    for (const apkPath of apkPaths) {
      await this.logHeadsetActionStep(action, `Installing folder APK ${basename(apkPath)}.`, {
        apkPath
      })
      await execFileAsync(adbPath, ['-s', serial, 'install', '-r', '-g', apkPath], { maxBuffer: 10 * 1024 * 1024 })
    }

    let packageName = this.inferPackageNameFromObbFiles(obbPaths)

    if (obbPaths.length && !packageName) {
      await this.failHeadsetAction(
        action,
        'Installed APKs, but could not determine the package name required for OBB transfer.'
      )
      return {
        success: false,
        message: 'Installed APKs, but could not determine the package name required for OBB transfer.',
        details: null,
        packageName: null
      }
    }

    if (obbPaths.length && packageName) {
      await this.logHeadsetActionStep(action, `Preparing OBB destination for ${packageName}.`, {
        packageName,
        obbCount: obbPaths.length
      })
      await this.runShellCommand(adbPath, serial, `mkdir -p "/sdcard/Android/obb/${packageName}"`)
      for (const obbPath of obbPaths) {
        await this.logHeadsetActionStep(action, `Pushing OBB ${basename(obbPath)}.`, {
          obbPath,
          packageName
        })
        await execFileAsync(adbPath, ['-s', serial, 'push', obbPath, `/sdcard/Android/obb/${packageName}/${basename(obbPath)}`], {
          maxBuffer: 10 * 1024 * 1024
        })
      }
    }

    const appliedShellSteps = await this.applyInstallScripts(adbPath, serial, installScriptPaths, action)

    return {
      success: true,
      message: obbPaths.length
        ? `Installed ${apkPaths.length} APK${apkPaths.length === 1 ? '' : 's'}, pushed ${obbPaths.length} OBB file${obbPaths.length === 1 ? '' : 's'}${appliedShellSteps ? `, and applied ${appliedShellSteps} install script step${appliedShellSteps === 1 ? '' : 's'}` : ''}.`
        : `Installed ${apkPaths.length} APK${apkPaths.length === 1 ? '' : 's'} from the local library${appliedShellSteps ? ` and applied ${appliedShellSteps} install script step${appliedShellSteps === 1 ? '' : 's'}` : ''}.`,
      details: null,
      packageName: packageName ?? item.packageIds[0] ?? null
    }
  }

  private async collectPayloadFiles(rootPath: string): Promise<string[]> {
    const entries = await readdir(rootPath, { withFileTypes: true })
    const collected: string[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      const entryPath = resolve(rootPath, entry.name)
      if (entry.isDirectory()) {
        collected.push(...(await this.collectPayloadFiles(entryPath)))
      } else {
        collected.push(entryPath)
      }
    }

    return collected
  }

  private inferPackageNameFromObbFiles(obbPaths: string[]): string | null {
    for (const obbPath of obbPaths) {
      const fileName = basename(obbPath)
      const match = fileName.match(/^(?:main|patch)\.\d+\.([^.]+\.[^.]+(?:\.[^.]+)+)\.obb$/i)
      if (match?.[1]) {
        return match[1]
      }
    }

    return null
  }

  private async applyInstallScripts(
    adbPath: string,
    serial: string,
    installScriptPaths: string[],
    action?: HeadsetActionContext | null
  ): Promise<number> {
    let appliedSteps = 0

    for (const installScriptPath of installScriptPaths) {
      const script = await readFile(installScriptPath, 'utf8')
      const lines = script
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))

      for (const line of lines) {
        if (/^adb\s+install\b/i.test(line)) {
          continue
        }

        const shellMatch = line.match(/^adb\s+shell\s+(.+)$/i)
        if (!shellMatch?.[1]) {
          continue
        }

        await this.logHeadsetActionStep(action, `Applying install script shell step: ${shellMatch[1]}`, {
          installScriptPath
        })
        await this.runShellCommand(adbPath, serial, shellMatch[1])
        appliedSteps += 1
      }
    }

    return appliedSteps
  }

  private async runShellCommand(adbPath: string, serial: string, command: string): Promise<string> {
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', command], { maxBuffer: 10 * 1024 * 1024 })
    return stdout.trim()
  }

  private async readInstalledPackageRows(
    adbPath: string,
    serial: string
  ): Promise<Array<{ packageId: string; versionCode: string | null; version: string | null }>> {
    const shellScript = `
pm list packages -3 --show-versioncode 2>/dev/null || pm list packages -3
`.trim()

    try {
      const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', shellScript], { maxBuffer: 10 * 1024 * 1024 })
      const packageRows = this.parseInstalledPackageRows(stdout)

      await Promise.all(
        packageRows.map(async (row) => {
          try {
            const { stdout } = await execFileAsync(
              adbPath,
              ['-s', serial, 'shell', 'dumpsys', 'package', row.packageId],
              { maxBuffer: 10 * 1024 * 1024 }
            )
            const versionLine = stdout
              .split('\n')
              .map((line) => line.trim())
              .find((line) => line.includes('versionName='))
            const versionMatch = versionLine?.match(/versionName=(.+)$/)
            row.version = versionMatch?.[1]?.trim() || null
          } catch {
            row.version = null
          }
        })
      )

      return packageRows
    } catch {
      return []
    }
  }

  private parseInstalledPackageRows(rawOutput: string): Array<{ packageId: string; versionCode: string | null; version: string | null }> {
    return rawOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('package:'))
      .map((line) => {
        const packageMatch = line.match(/^package:([^\s]+)(?:\s+versionCode:(\d+))?/)
        return {
          packageId: packageMatch?.[1] ?? '',
          versionCode: packageMatch?.[2] ?? null,
          version: null
        }
      })
      .filter((row) => row.packageId.length > 0)
  }

  private async readInstalledPackageIds(adbPath: string, serial: string): Promise<Set<string>> {
    try {
      const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', 'pm', 'list', 'packages'], {
        maxBuffer: 10 * 1024 * 1024
      })

      return new Set(
        stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('package:'))
          .map((line) => line.replace(/^package:/, '').trim().toLowerCase())
          .filter(Boolean)
      )
    } catch {
      return new Set()
    }
  }

  private isPotentialThirdPartyPackage(packageId: string): boolean {
    return !PLATFORM_PACKAGE_PREFIXES.some((prefix) => packageId.startsWith(prefix))
  }

  private async readInstalledPackageSizes(adbPath: string, serial: string): Promise<Map<string, number>> {
    const shellScript =
      'pm list packages -3 -f | while read -r line; do entry=${line#package:}; pkg=${entry##*=}; apk=${entry%=*}; code_dir=${apk%/base.apk}; total=0; for path in "$code_dir" "/sdcard/Android/obb/$pkg" "/sdcard/Android/data/$pkg"; do size=$(du -sk "$path" 2>/dev/null | cut -f1); if [ -n "$size" ]; then total=$((total + size)); fi; done; echo "$pkg|$total"; done'
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', shellScript], {
      maxBuffer: 10 * 1024 * 1024
    })

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((sizes, line) => {
        const [packageId, sizeInKb] = line.split('|')
        if (!packageId) {
          return sizes
        }

        const parsedKb = sizeInKb ? Number.parseInt(sizeInKb, 10) : Number.NaN
        sizes.set(packageId, Number.isFinite(parsedKb) ? parsedKb * 1024 : 0)
        return sizes
      }, new Map<string, number>())
  }

  private async readSystemAppCount(adbPath: string, serial: string): Promise<number> {
    try {
      const shellScript = 'pm list packages -s 2>/dev/null || cmd package list packages -s 2>/dev/null'
      const { stdout, stderr } = await execFileAsync(adbPath, ['-s', serial, 'shell', shellScript], {
        maxBuffer: 10 * 1024 * 1024
      })
      const output = [stdout, stderr].filter(Boolean).join('\n')

      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('package:')).length
    } catch {
      return 0
    }
  }


  private inferLabel(packageId: string): string {
    const lastSegment = packageId.split('.').pop() ?? packageId
    const withSpaces = lastSegment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    const collapsed = withSpaces.trim().replace(/\s+/g, ' ')

    if (!collapsed) {
      return packageId
    }

    return collapsed.replace(/\b\w/g, (character) => character.toUpperCase())
  }

  private sanitizeFilesystemName(value: string): string {
    const sanitized = value
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return sanitized || 'Unknown App'
  }

  private sanitizeBackupFolderSegment(value: string): string {
    return this.sanitizeFilesystemName(value).replace(/\s+/g, '.')
  }

  private async readCatalogNameMap(): Promise<Map<string, string>> {
    if (!this.catalogNameMapPromise) {
      this.catalogNameMapPromise = this.loadCatalogNameMap()
    }

    return this.catalogNameMapPromise
  }

  private async loadCatalogNameMap(): Promise<Map<string, string>> {
    const candidates = [
      resolve(process.cwd(), '..', 'VRP-GameList.txt'),
      resolve(process.cwd(), 'VRP-GameList.txt')
    ]

    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, 'utf8')
        return this.parseCatalogNameMap(raw)
      } catch {
        continue
      }
    }

    return new Map<string, string>()
  }

  private parseCatalogNameMap(rawCatalog: string): Map<string, string> {
    return rawCatalog
      .split('\n')
      .slice(1)
      .map((line) => line.trim().replace(/^\uFEFF/, ''))
      .filter(Boolean)
      .reduce((catalog, line) => {
        const [gameName, _releaseName, packageName] = line.split(';')
        if (gameName && packageName && !catalog.has(packageName)) {
          catalog.set(packageName, gameName)
        }
        return catalog
      }, new Map<string, string>())
  }

  private readTransport(serial: string): DeviceSummary['transport'] {
    if (serial.startsWith('emulator-')) {
      return 'emulator'
    }

    if (serial.includes(':')) {
      return 'tcp'
    }

    return 'usb'
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, milliseconds)
    })
  }

  private readState(state: string): DeviceSummary['state'] {
    if (state === 'device') {
      return 'device'
    }

    if (state === 'offline') {
      return 'offline'
    }

    if (state === 'unauthorized') {
      return 'unauthorized'
    }

    return 'disconnected'
  }

  private describeDevice(row: ParsedDeviceRow, state: DeviceSummary['state']): string {
    if (state === 'unauthorized') {
      return 'Approve the USB debugging prompt in the headset to continue.'
    }

    if (state === 'offline') {
      return 'The device is visible to ADB but not responding to commands yet.'
    }

    if (row.transportId) {
      return `ADB transport ${row.transportId} is active.`
    }

    if (row.id.includes(':')) {
      return 'Connected over Wi-Fi using ADB TCP.'
    }

    return 'Connected and ready for future app-management actions.'
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const enrichedError = error as Error & {
        stdout?: string | Buffer
        stderr?: string | Buffer
        code?: number | string
      }
      const stderr =
        typeof enrichedError.stderr === 'string'
          ? enrichedError.stderr.trim()
          : Buffer.isBuffer(enrichedError.stderr)
            ? enrichedError.stderr.toString('utf8').trim()
            : ''
      const stdout =
        typeof enrichedError.stdout === 'string'
          ? enrichedError.stdout.trim()
          : Buffer.isBuffer(enrichedError.stdout)
            ? enrichedError.stdout.toString('utf8').trim()
            : ''
      const detail = stderr || stdout || error.message

      if (detail) {
        return detail
      }
    }

    return 'ADB command failed.'
  }

  private async startHeadsetAction(
    action: 'connect' | 'disconnect' | 'install' | 'uninstall',
    options: {
      serial: string | null
      itemId?: string | null
      itemName?: string | null
      packageName?: string | null
      message: string
      metadata?: Record<string, string | number | boolean | null>
    }
  ): Promise<HeadsetActionContext | null> {
    try {
      return await headsetActionLogService.start(action, options)
    } catch {
      return null
    }
  }

  private async logHeadsetActionStep(
    context: HeadsetActionContext | null | undefined,
    message: string,
    metadata?: Record<string, string | number | boolean | null>
  ): Promise<void> {
    if (!context) {
      return
    }

    try {
      await headsetActionLogService.step(context, message, metadata)
    } catch {
      // Logging must never break the main action flow.
    }
  }

  private async completeHeadsetAction(
    context: HeadsetActionContext | null | undefined,
    message: string,
    metadata?: Record<string, string | number | boolean | null>
  ): Promise<void> {
    if (!context) {
      return
    }

    try {
      await headsetActionLogService.succeed(context, message, metadata)
    } catch {
      // Logging must never break the main action flow.
    }
  }

  private async failHeadsetAction(
    context: HeadsetActionContext | null | undefined,
    message: string,
    metadata?: Record<string, string | number | boolean | null>
  ): Promise<void> {
    if (!context) {
      return
    }

    try {
      await headsetActionLogService.fail(context, message, metadata)
    } catch {
      // Logging must never break the main action flow.
    }
  }
}

export const deviceService = new DeviceService()
