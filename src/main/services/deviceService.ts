import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
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
  DeviceRebootResponse,
  DeviceRuntimeInfo,
  DeviceSummary,
  DeviceUserNameResponse,
  InstalledAppSummary,
  InstalledAppHistoryDay,
  InstalledAppHistoryResponse,
  InstalledAppScanDelta,
  LocalLibraryIndexedItem
} from '@shared/types/ipc'
import { dependencyService } from './dependencyService'
import { headsetActionLogService, type HeadsetActionContext } from './headsetActionLogService'
import { metaStoreService } from './metaStoreService'

const execFileAsync = promisify(execFile)
type ApkReaderModule = {
  open(path: string): Promise<{
    readManifest(): Promise<{
      package?: string
      versionCode?: string | number
    }>
  }>
}

const ApkReader: ApkReaderModule = require('@devicefarmer/adbkit-apkreader')
const PLATFORM_PACKAGE_PREFIXES = ['com.android.', 'com.oculus.', 'com.meta.', 'com.facebook.']
const HIDDEN_INSTALLED_COMPANION_PACKAGE_PREFIXES = ['com.mrf.', 'com.meta.', 'com.oculus.']
const INSTALLED_APP_LIST_TIMEOUT_MS = 15_000
const INSTALLED_APP_VERSION_LOOKUP_TIMEOUT_MS = 4_000
const INSTALLED_APP_SIZE_SCAN_TIMEOUT_MS = 20_000
const INSTALLED_APP_SYSTEM_COUNT_TIMEOUT_MS = 8_000
const INSTALLED_APP_VERSION_LOOKUP_CONCURRENCY = 6

interface ParsedDeviceRow {
  id: string
  state: string
  product: string | null
  model: string | null
  transportId: string | null
}

interface InstallQueueHooks {
  onQueued?: () => void | Promise<void>
  onStarted?: () => void | Promise<void>
}

interface InstalledAppScanSnapshot {
  serial: string
  scannedAt: string
  appCount: number
  systemAppCount: number
  packageIds: string[]
  packageDisplayNamesById: Record<string, string>
}

interface InstalledAppScanHistoryStore {
  version: 2
  snapshots: InstalledAppScanSnapshot[]
}

interface StoredInstalledAppScanSnapshot {
  serial: string
  scannedAt: string
  appCount: number
  systemAppCount: number
  packageIds: unknown[]
  packageDisplayNamesById?: unknown
}

interface VersionedObbFile {
  fileName: string
  absolutePath: string
  canonicalPath: string
  packageId: string
  kind: 'main' | 'patch'
  versionCode: number
  sizeBytes: number | null
}

interface ApkInstallMetadata {
  packageName: string | null
  versionCode: string | null
}

interface ApkInstallResult {
  success: boolean
  details: string | null
  packageName: string | null
  usedPreservedDataRetry: boolean
  preflightDetails: string | null
}

interface UpgradeSpaceEstimate {
  packageName: string
  incomingBytes: number
  installedFootprintBytes: number
  effectiveRequiredBytes: number
  freeBytes: number | null
  warning: boolean
  message: string
}

const INSTALLED_APP_SCAN_HISTORY_VERSION = 2
const INSTALLED_APP_SCAN_HISTORY_LIMIT_PER_SERIAL = 90

class DeviceService {
  private catalogNameMapPromise: Promise<Map<string, string>> | null = null
  private apkMetadataParserUnavailable = false
  private blockedLeftoverDeletes = new Map<string, string>()
  private installQueue: Promise<void> = Promise.resolve()
  private installQueueDepth = 0
  private installVerificationBarrier: Promise<void> = Promise.resolve()
  private installVerificationResolvers = new Map<string, () => void>()
  private pendingJsonWrites = new Map<string, Promise<void>>()

  private async runQueuedDeviceTask<T>(task: () => Promise<T>, hooks?: InstallQueueHooks): Promise<T> {
    const queuedBehindAnotherInstall = this.installQueueDepth > 0
    if (queuedBehindAnotherInstall) {
      await hooks?.onQueued?.()
    }

    this.installQueueDepth += 1

    const run = this.installQueue.then(async () => {
      await hooks?.onStarted?.()
      return task()
    })

    this.installQueue = run
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.installQueueDepth = Math.max(0, this.installQueueDepth - 1)
      })

    return run
  }

  private async runQueuedInstall<T>(task: () => Promise<T>, hooks?: InstallQueueHooks): Promise<T> {
    const queuedBehindAnotherInstall = this.installQueueDepth > 0
    if (queuedBehindAnotherInstall) {
      await hooks?.onQueued?.()
    }

    this.installQueueDepth += 1

    const run = this.installQueue.then(async () => {
      await this.installVerificationBarrier
      await hooks?.onStarted?.()
      return task()
    })

    this.installQueue = run
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.installQueueDepth = Math.max(0, this.installQueueDepth - 1)
      })

    return run
  }

  private issueInstallVerificationToken(): string {
    const token = randomUUID()
    this.installVerificationBarrier = new Promise((resolve) => {
      this.installVerificationResolvers.set(token, () => {
        this.installVerificationResolvers.delete(token)
        resolve()
      })
    })
    return token
  }

  async completeInstallVerification(token: string): Promise<boolean> {
    const normalizedToken = token.trim()
    if (!normalizedToken) {
      return false
    }

    const resolver = this.installVerificationResolvers.get(normalizedToken)
    if (!resolver) {
      return false
    }

    resolver()
    return true
  }

  private getInstalledAppScanHistoryPath(): string {
    return join(app.getPath('userData'), 'installed-app-scan-history.json')
  }

  private formatLocalDateKey(timestamp: string): string {
    const value = new Date(timestamp)
    if (Number.isNaN(value.getTime())) {
      return timestamp.slice(0, 10)
    }

    const year = value.getFullYear()
    const month = `${value.getMonth() + 1}`.padStart(2, '0')
    const day = `${value.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private normalizePackageDisplayName(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) {
        return trimmed
      }
    }

    return fallback
  }

  private normalizePackageDisplayNameMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    const candidate = value as Record<string, unknown>
    const normalized: Record<string, string> = {}

    for (const [packageId, displayName] of Object.entries(candidate)) {
      const normalizedPackageId = packageId.trim().toLowerCase()
      if (!normalizedPackageId) {
        continue
      }

      normalized[normalizedPackageId] = this.normalizePackageDisplayName(displayName, packageId.trim())
    }

    return normalized
  }

  private async resolvePackageDisplayNames(packageIds: string[]): Promise<Record<string, string>> {
    const normalizedPackageIds = Array.from(new Set(packageIds.map((packageId) => packageId.trim()).filter(Boolean)))
    const resolved: Record<string, string> = {}
    const chunkSize = 48

    for (let offset = 0; offset < normalizedPackageIds.length; offset += chunkSize) {
      const chunk = normalizedPackageIds.slice(offset, offset + chunkSize)
      const response = await metaStoreService.peekCachedMatchesByPackageIds(chunk)

      for (const [packageId, summary] of Object.entries(response.matches)) {
        const normalizedPackageId = packageId.trim().toLowerCase()
        if (!normalizedPackageId) {
          continue
        }

        resolved[normalizedPackageId] = this.normalizePackageDisplayName(summary.title, packageId.trim())
      }
    }

    return resolved
  }

  private async backfillInstalledAppScanSnapshots(
    snapshots: Array<{
      serial: string
      scannedAt: string
      appCount: number
      systemAppCount: number
      packageIds: string[]
      packageDisplayNamesById?: Record<string, string> | null
    }>
  ): Promise<InstalledAppScanSnapshot[]> {
    const baseSnapshots = snapshots.map((snapshot) => {
      const packageIds = Array.from(
        new Set(snapshot.packageIds.map((packageId) => packageId.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right)))
      )
      const packageDisplayNamesById = this.normalizePackageDisplayNameMap(snapshot.packageDisplayNamesById)

      return {
        serial: snapshot.serial,
        scannedAt: snapshot.scannedAt,
        appCount: snapshot.appCount,
        systemAppCount: snapshot.systemAppCount,
        packageIds,
        packageDisplayNamesById
      }
    })

    const knownDisplayNamesByPackageId = new Map<string, string>()
    for (const snapshot of baseSnapshots) {
      for (const [packageId, displayName] of Object.entries(snapshot.packageDisplayNamesById)) {
        if (displayName.trim()) {
          knownDisplayNamesByPackageId.set(packageId, displayName.trim())
        }
      }
    }

    const packageIdsNeedingLookup = Array.from(
      new Set(
        baseSnapshots.flatMap((snapshot) =>
          snapshot.packageIds
            .map((packageId) => packageId.trim().toLowerCase())
            .filter((packageId) => !knownDisplayNamesByPackageId.has(packageId))
        )
      )
    )
    const cachedDisplayNames = packageIdsNeedingLookup.length
      ? await this.resolvePackageDisplayNames(packageIdsNeedingLookup)
      : {}

    return baseSnapshots.map((snapshot) => {
      const packageDisplayNamesById: Record<string, string> = { ...snapshot.packageDisplayNamesById }

      for (const packageId of snapshot.packageIds) {
        const normalizedPackageId = packageId.trim().toLowerCase()
        if (!normalizedPackageId) {
          continue
        }

        packageDisplayNamesById[normalizedPackageId] =
          packageDisplayNamesById[normalizedPackageId] ??
          knownDisplayNamesByPackageId.get(normalizedPackageId) ??
          cachedDisplayNames[normalizedPackageId] ??
          packageId.trim()
      }

      return {
        ...snapshot,
        packageDisplayNamesById
      }
    })
  }

  private async writeJsonFile(targetPath: string, value: unknown): Promise<void> {
    const previousWrite = this.pendingJsonWrites.get(targetPath) ?? Promise.resolve()
    const nextWrite = previousWrite
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(targetPath), { recursive: true })
        const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
        await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
        await rename(tempPath, targetPath)
      })

    this.pendingJsonWrites.set(targetPath, nextWrite)

    try {
      await nextWrite
    } finally {
      if (this.pendingJsonWrites.get(targetPath) === nextWrite) {
        this.pendingJsonWrites.delete(targetPath)
      }
    }
  }

  private async readInstalledAppScanHistoryStore(): Promise<InstalledAppScanHistoryStore> {
    const historyPath = this.getInstalledAppScanHistoryPath()

    try {
      const raw = await readFile(historyPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<InstalledAppScanHistoryStore> & {
        snapshots?: StoredInstalledAppScanSnapshot[]
      }
      const rawSnapshots = Array.isArray(parsed.snapshots) ? parsed.snapshots : []
      const snapshots = rawSnapshots.filter(
        (entry) =>
          Boolean(entry) &&
          typeof entry.serial === 'string' &&
          typeof entry.scannedAt === 'string' &&
          typeof entry.appCount === 'number' &&
          typeof entry.systemAppCount === 'number' &&
          Array.isArray(entry.packageIds)
      )
      const normalizedSnapshots = await this.backfillInstalledAppScanSnapshots(
        snapshots.map((entry) => ({
          serial: entry.serial,
          scannedAt: entry.scannedAt,
          appCount: entry.appCount,
          systemAppCount: entry.systemAppCount,
          packageIds: entry.packageIds.filter((packageId): packageId is string => typeof packageId === 'string'),
          packageDisplayNamesById: entry.packageDisplayNamesById ?? null
        }))
      )
      const store: InstalledAppScanHistoryStore = {
        version: INSTALLED_APP_SCAN_HISTORY_VERSION,
        snapshots: normalizedSnapshots
      }

      if (parsed.version !== INSTALLED_APP_SCAN_HISTORY_VERSION) {
        await this.writeJsonFile(historyPath, store)
      }

      return store
    } catch {
      return {
        version: INSTALLED_APP_SCAN_HISTORY_VERSION,
        snapshots: []
      }
    }
  }

  private buildInstalledAppScanDelta(
    previousSnapshot: InstalledAppScanSnapshot | null,
    nextSnapshot: InstalledAppScanSnapshot
  ): InstalledAppScanDelta | null {
    if (!previousSnapshot) {
      return null
    }

    const previousPackages = new Set(previousSnapshot.packageIds.map((packageId) => packageId.toLowerCase()))
    const currentPackages = new Set(nextSnapshot.packageIds.map((packageId) => packageId.toLowerCase()))

    const addedPackages = nextSnapshot.packageIds.filter((packageId) => !previousPackages.has(packageId.toLowerCase()))
    const removedPackages = previousSnapshot.packageIds.filter(
      (packageId) => !currentPackages.has(packageId.toLowerCase())
    )

    return {
      comparedToScannedAt: previousSnapshot.scannedAt,
      previousAppCount: previousSnapshot.appCount,
      currentAppCount: nextSnapshot.appCount,
      addedCount: addedPackages.length,
      removedCount: removedPackages.length,
      addedPackages,
      removedPackages,
      addedApps: addedPackages.map((packageId) => ({
        packageId,
        displayName: this.normalizePackageDisplayName(
          nextSnapshot.packageDisplayNamesById[packageId.trim().toLowerCase()],
          packageId
        )
      })),
      removedApps: removedPackages.map((packageId) => ({
        packageId,
        displayName: this.normalizePackageDisplayName(
          previousSnapshot.packageDisplayNamesById[packageId.trim().toLowerCase()],
          packageId
        )
      }))
    }
  }

  private buildInstalledAppHistory(
    serial: string,
    snapshots: InstalledAppScanSnapshot[]
  ): InstalledAppHistoryResponse {
    const serialSnapshots = snapshots
      .filter((snapshot) => snapshot.serial === serial)
      .slice()
      .sort((left, right) => new Date(left.scannedAt).getTime() - new Date(right.scannedAt).getTime())

    if (!serialSnapshots.length) {
      return {
        serial,
        days: [],
        latestScanAt: null,
        message: 'No installed app scan history has been recorded yet.'
      }
    }

    const scans = serialSnapshots.map((snapshot, index): InstalledAppHistoryDay => {
      const previousSnapshot = index > 0 ? serialSnapshots[index - 1] ?? null : null
      const delta = this.buildInstalledAppScanDelta(previousSnapshot, snapshot)
      const hiddenPackageCount = snapshot.packageIds.filter((packageId) =>
        HIDDEN_INSTALLED_COMPANION_PACKAGE_PREFIXES.some((prefix) => packageId.startsWith(prefix))
      ).length

      return {
        date: this.formatLocalDateKey(snapshot.scannedAt),
        scannedAt: snapshot.scannedAt,
        appCount: snapshot.appCount,
        visibleAppCount: Math.max(0, snapshot.appCount - hiddenPackageCount),
        hiddenPackageCount,
        systemAppCount: snapshot.systemAppCount,
        addedCount: delta?.addedCount ?? 0,
        removedCount: delta?.removedCount ?? 0,
        addedApps: delta?.addedApps ?? [],
        removedApps: delta?.removedApps ?? []
      }
    })

    const recentDays = scans.slice(-30)

    return {
      serial,
      days: recentDays,
      latestScanAt: serialSnapshots[serialSnapshots.length - 1]?.scannedAt ?? null,
      message:
        recentDays.length >= 2
          ? 'Showing apps present on the headset and removals across the latest installed-app scans.'
          : 'Refresh installed apps again to build headset app scan history.'
    }
  }

  private async recordInstalledAppScanSnapshot(
    serial: string,
    apps: InstalledAppSummary[],
    systemAppCount: number,
    scannedAt: string
  ): Promise<{ change: InstalledAppScanDelta | null; history: InstalledAppHistoryResponse }> {
    const historyPath = this.getInstalledAppScanHistoryPath()
    const store = await this.readInstalledAppScanHistoryStore()
    const normalizedPackageIds = Array.from(
      new Set(apps.map((app) => app.packageId.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right)))
    )
    const packageDisplayNamesById = Object.fromEntries(
      apps.map((app) => {
        const packageId = app.packageId.trim()
        return [
          packageId.toLowerCase(),
          this.normalizePackageDisplayName(app.label ?? app.inferredLabel, packageId)
        ] as const
      })
    )
    const snapshot: InstalledAppScanSnapshot = {
      serial,
      scannedAt,
      appCount: apps.length,
      systemAppCount,
      packageIds: normalizedPackageIds,
      packageDisplayNamesById
    }

    const previousSnapshot =
      store.snapshots
        .filter((entry) => entry.serial === serial)
        .sort((left, right) => new Date(right.scannedAt).getTime() - new Date(left.scannedAt).getTime())[0] ?? null

    const change = this.buildInstalledAppScanDelta(previousSnapshot, snapshot)
    const nextSnapshots = [...store.snapshots.filter((entry) => entry.serial !== serial)]
    const serialSnapshots = [...store.snapshots.filter((entry) => entry.serial === serial), snapshot]
      .sort((left, right) => new Date(left.scannedAt).getTime() - new Date(right.scannedAt).getTime())
      .slice(-INSTALLED_APP_SCAN_HISTORY_LIMIT_PER_SERIAL)

    nextSnapshots.push(...serialSnapshots)

    const nextStore: InstalledAppScanHistoryStore = {
      version: INSTALLED_APP_SCAN_HISTORY_VERSION,
      snapshots: nextSnapshots
    }

    await this.writeJsonFile(historyPath, nextStore)

    return {
      change,
      history: this.buildInstalledAppHistory(serial, nextStore.snapshots)
    }
  }

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
    const scannedAt = new Date().toISOString()
    const emptyHistory = this.buildInstalledAppHistory(normalizedSerial, [])

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        serial: normalizedSerial,
        apps: [],
        systemAppCount: 0,
        change: null,
        history: emptyHistory,
        scannedAt
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
        change: null,
        history: emptyHistory,
        scannedAt
      }
    }

    try {
      const [apps, systemAppCount] = await Promise.all([
        this.readInstalledApps(runtime.adbPath, normalizedSerial),
        this.readSystemAppCount(runtime.adbPath, normalizedSerial)
      ])
      const { change, history } = await this.recordInstalledAppScanSnapshot(
        normalizedSerial,
        apps,
        systemAppCount,
        scannedAt
      )

      return {
        runtime,
        serial: normalizedSerial,
        apps,
        systemAppCount,
        change,
        history,
        scannedAt
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
        change: null,
        history: emptyHistory,
        scannedAt
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
      const [obbDirs, dataDirs, supersededObbFiles] = await Promise.all([
        this.readPackageDirectories(runtime.adbPath, normalizedSerial, 'obb', '/sdcard/Android/obb'),
        this.readPackageDirectories(runtime.adbPath, normalizedSerial, 'data', '/sdcard/Android/data'),
        this.readSupersededVersionedObbFiles(runtime.adbPath, normalizedSerial, installedPackages)
      ])
      const items = [...obbDirs, ...dataDirs]
        .filter((item) => {
          const packageId = item.packageId.toLowerCase()
          return !installedPackages.has(packageId) && this.isPotentialThirdPartyPackage(packageId)
        })
        .concat(supersededObbFiles)
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
            ? `Found ${items.length} cleanup ${items.length === 1 ? 'entry' : 'entries'} on the headset. Some orphaned Android/data folders are visible but protected by Quest storage permissions; ${blockedCount} ${blockedCount === 1 ? 'entry is' : 'entries are'} not removable through standard ADB cleanup.`
            : `Found ${items.length} cleanup ${items.length === 1 ? 'entry' : 'entries'} on the headset.`
          : 'No orphaned Android/data or Android/obb folders, or superseded versioned OBB files, were found.'
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
      const deletedLabel = target.location === 'superseded-obb' ? 'superseded OBB' : `leftover ${target.location.toUpperCase()} data`
      return {
        runtime,
        serial: normalizedSerial,
        itemId: normalizedItemId,
        success: true,
        message: `Deleted ${deletedLabel} for ${target.packageId}.`,
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
            ? `Android blocked deletion of ${target.location === 'superseded-obb' ? 'a superseded OBB' : 'leftover data'} for ${target.packageId}.`
            : `Unable to delete ${target.location === 'superseded-obb' ? 'the superseded OBB' : 'leftover data'} for ${target.packageId}.`
        },
        serial: normalizedSerial,
        itemId: normalizedItemId,
        success: false,
        message: isPermissionBlocked
          ? `Android blocked deletion of ${target.location === 'superseded-obb' ? 'a superseded OBB' : 'leftover data'} for ${target.packageId}.`
          : `Unable to delete ${target.location === 'superseded-obb' ? 'the superseded OBB' : 'leftover data'} for ${target.packageId}.`,
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

  async uninstallInstalledApp(
    serial: string,
    packageId: string,
    options?: { keepData?: boolean }
  ): Promise<DeviceInstalledAppActionResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const normalizedPackageId = packageId.trim()
    const keepData = Boolean(options?.keepData)
    const action = await this.startHeadsetAction('uninstall', {
      serial: normalizedSerial || null,
      packageName: normalizedPackageId || null,
      message: normalizedPackageId
        ? keepData
          ? `Starting repair removal for ${normalizedPackageId} while keeping app data.`
          : `Starting uninstall for ${normalizedPackageId}.`
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
      await this.logHeadsetActionStep(action, keepData ? `Running keep-data uninstall for ${normalizedPackageId}.` : `Running uninstall for ${normalizedPackageId}.`, {
        packageName: normalizedPackageId
      })
      const uninstallArgs = keepData
        ? ['-s', normalizedSerial, 'uninstall', '-k', normalizedPackageId]
        : ['-s', normalizedSerial, 'uninstall', normalizedPackageId]
      const { stdout, stderr } = await execFileAsync(runtime.adbPath, uninstallArgs, {
        maxBuffer: 10 * 1024 * 1024
      })
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      const message = keepData
        ? `Removed ${normalizedPackageId} while keeping app data.`
        : `Uninstalled ${normalizedPackageId}.`
      await this.completeHeadsetAction(action, output || message, {
        packageName: normalizedPackageId,
        keepData
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

  async rebootDevice(serial: string): Promise<DeviceRebootResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const action = await this.startHeadsetAction('reboot', {
      serial: normalizedSerial || null,
      message: normalizedSerial
        ? `Starting reboot for ${normalizedSerial}.`
        : 'Starting reboot without a selected device.'
    })

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      await this.failHeadsetAction(action, runtime.message, { runtimeStatus: runtime.status })
      return {
        runtime,
        serial: normalizedSerial,
        success: false,
        message: runtime.message,
        details: null
      }
    }

    if (!normalizedSerial) {
      const message = 'No device selected for reboot.'
      await this.failHeadsetAction(action, message)
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message
        },
        serial: normalizedSerial,
        success: false,
        message,
        details: null
      }
    }

    try {
      return await this.runQueuedDeviceTask(
        async () => {
          await this.logHeadsetActionStep(action, `Sending reboot command to ${normalizedSerial}.`, {
            serial: normalizedSerial
          })

          const { stdout, stderr } = await execFileAsync(runtime.adbPath as string, ['-s', normalizedSerial, 'reboot'], {
            maxBuffer: 10 * 1024 * 1024
          })
          const output = [stdout, stderr].filter(Boolean).join('\n').trim()
          const message = `Reboot command sent to ${normalizedSerial}.`

          await this.completeHeadsetAction(action, output || message, {
            serial: normalizedSerial
          })

          return {
            runtime,
            serial: normalizedSerial,
            success: true,
            message,
            details: output || null
          }
        },
        {
          onQueued: async () => {
            await this.logHeadsetActionStep(
              action,
              'Queued for reboot because another headset operation is already in progress.'
            )
          }
        }
      )
    } catch (error) {
      const details = this.readErrorMessage(error)
      const message = `Unable to reboot ${normalizedSerial}.`
      await this.failHeadsetAction(action, details, { serial: normalizedSerial })
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message
        },
        serial: normalizedSerial,
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
        packageName: null,
        verificationToken: null
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
        packageName: null,
        verificationToken: null
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
        packageName: null,
        verificationToken: null
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
        packageName: null,
        verificationToken: null
      }
    }

    try {
      return await this.runQueuedInstall(
        async () => {
          const adbPath = runtime.adbPath as string
          await this.logHeadsetActionStep(action, `Resolved managed ADB runtime at ${adbPath}.`)
          const installResult =
            item.kind === 'apk'
              ? await this.installSingleApk(adbPath, normalizedSerial, item.absolutePath, action)
              : await this.installFolderPayload(adbPath, normalizedSerial, item, action)

          if (installResult.success) {
            await this.completeHeadsetAction(action, installResult.message, {
              packageName: installResult.packageName ?? item.packageIds[0] ?? null
            })
          } else {
            await this.failHeadsetAction(action, installResult.message, {
              packageName: installResult.packageName ?? item.packageIds[0] ?? null
            })
          }

          const verificationToken = installResult.success ? this.issueInstallVerificationToken() : null
          return {
            runtime,
            serial: normalizedSerial,
            itemId: item.id,
            success: installResult.success,
            message: installResult.message,
            details: installResult.details,
            packageName: installResult.packageName,
            verificationToken
          }
        },
        {
          onQueued: async () => {
            await this.logHeadsetActionStep(
              action,
              'Queued for install because another headset installation is already in progress.'
            )
          }
        }
      )
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
        packageName: null,
        verificationToken: null
      }
    }
  }

  async installManualPath(
    serial: string,
    sourcePath: string,
    options?: InstallQueueHooks
  ): Promise<DeviceManualInstallResponse> {
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
        packageName: null,
        verificationToken: null
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
        packageName: null,
        verificationToken: null
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
        packageName: null,
        verificationToken: null
      }
    }

    try {
      const sourceStats = await stat(normalizedSourcePath)

      return await this.runQueuedInstall(
        async () => {
          const adbPath = runtime.adbPath as string
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
                packageName: null,
                verificationToken: null
              }
            }

            installResult = await this.installSingleApk(adbPath, normalizedSerial, normalizedSourcePath, action)
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
              indexedAt: new Date().toISOString(),
              modifiedAt: new Date().toISOString(),
              childCount: 0,
              apkCount: 0,
              obbCount: 0,
              archiveCount: 0,
              libraryVersion: null,
              libraryVersionCode: null,
              sourceLastUpdatedAt: null,
              manualStoreId: null,
              manualStoreIdEdited: false,
              manualMetadata: null,
              note: 'Manual install source.'
            }

            installResult = await this.installFolderPayload(adbPath, normalizedSerial, tempItem, action)
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
              packageName: null,
              verificationToken: null
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

          const verificationToken = installResult.success ? this.issueInstallVerificationToken() : null
          return {
            runtime,
            serial: normalizedSerial,
            sourcePath: normalizedSourcePath,
            success: installResult.success,
            message: installResult.message,
            details: installResult.details,
            packageName: installResult.packageName,
            verificationToken
          }
        },
        {
          onQueued: async () => {
            await this.logHeadsetActionStep(
              action,
              'Queued for install because another headset installation is already in progress.'
            )
            await options?.onQueued?.()
          },
          onStarted: async () => {
            await options?.onStarted?.()
          }
        }
      )
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
        packageName: null,
        verificationToken: null
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
        versionCode: row.versionCode ?? null,
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
          deleteBlockedReason: null,
          details: null
        } satisfies DeviceLeftoverItem
      })
      .filter((item) => Boolean(item.packageId) && Boolean(item.absolutePath))
  }

  private normalizeAndroidStoragePath(path: string): string {
    const normalizedPath = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
    return normalizedPath.replace(/^\/storage\/emulated\/0(?=\/|$)/i, '/sdcard').toLowerCase()
  }

  private async readSupersededVersionedObbFiles(
    adbPath: string,
    serial: string,
    installedPackages: Set<string>
  ): Promise<DeviceLeftoverItem[]> {
    const shellScript =
      'for root in /sdcard/Android/obb /storage/emulated/0/Android/obb; do ' +
      '[ -d "$root" ] || continue; ' +
      'for dir in "$root"/*; do ' +
      '[ -d "$dir" ] || continue; ' +
      'pkg=${dir##*/}; ' +
      'for file in "$dir"/*.obb; do ' +
      '[ -f "$file" ] || continue; ' +
      'name=${file##*/}; ' +
      'case "$name" in ' +
      'main.[0-9]*.$pkg.obb|patch.[0-9]*.$pkg.obb) ' +
      'size=$(du -sk "$file" 2>/dev/null | cut -f1); ' +
      'echo "$pkg|$file|$name|${size:-}";; ' +
      'esac; ' +
      'done; ' +
      'done; done'

    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', shellScript], {
      maxBuffer: 10 * 1024 * 1024
    })

    const parsedFiles = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [packageId, absolutePath, fileName, sizeInKb] = line.split('|')
        const match = fileName.match(/^(main|patch)\.(\d+)\.(.+)\.obb$/i)
        if (!packageId || !absolutePath || !fileName || !match?.[1] || !match[2]) {
          return null
        }
        const parsedKb = sizeInKb ? Number.parseInt(sizeInKb, 10) : Number.NaN
        return {
          fileName,
          absolutePath,
          canonicalPath: this.normalizeAndroidStoragePath(absolutePath),
          packageId,
          kind: match[1].toLowerCase() === 'patch' ? 'patch' : 'main',
          versionCode: Number.parseInt(match[2], 10),
          sizeBytes: Number.isFinite(parsedKb) ? parsedKb * 1024 : null
        } satisfies VersionedObbFile
      })
      .filter((item): item is VersionedObbFile => Boolean(item))

    const filesByPackage = new Map<string, VersionedObbFile[]>()
    const seenFileKeys = new Set<string>()
    for (const file of parsedFiles) {
      const normalizedPackageId = file.packageId.trim().toLowerCase()
      if (!installedPackages.has(normalizedPackageId)) {
        continue
      }

      const fileKey = [
        normalizedPackageId,
        file.kind,
        String(file.versionCode),
        file.fileName.trim().toLowerCase(),
        file.canonicalPath
      ].join('::')
      if (seenFileKeys.has(fileKey)) {
        continue
      }
      seenFileKeys.add(fileKey)

      const existing = filesByPackage.get(normalizedPackageId) ?? []
      existing.push(file)
      filesByPackage.set(normalizedPackageId, existing)
    }

    const items: DeviceLeftoverItem[] = []
    for (const [, files] of filesByPackage) {
      const byKind = new Map<'main' | 'patch', VersionedObbFile[]>()
      for (const file of files) {
        const existing = byKind.get(file.kind) ?? []
        existing.push(file)
        byKind.set(file.kind, existing)
      }

      for (const [kind, kindFiles] of byKind) {
        if (kindFiles.length < 2) {
          continue
        }
        const currentVersionCode = Math.max(...kindFiles.map((file) => file.versionCode))
        const currentFiles = kindFiles.filter((file) => file.versionCode === currentVersionCode)
        const retainedFileNames = Array.from(new Set(currentFiles.map((file) => file.fileName))).sort((left, right) =>
          left.localeCompare(right, undefined, { sensitivity: 'base' })
        )
        for (const stale of kindFiles.filter((file) => file.versionCode < currentVersionCode)) {
          items.push({
            id: `superseded-obb:${stale.packageId}:${stale.fileName}`,
            packageId: stale.packageId,
            location: 'superseded-obb',
            absolutePath: stale.absolutePath,
            sizeBytes: stale.sizeBytes,
            deleteBlocked: false,
            deleteBlockedReason: null,
            details: `Superseded ${kind.toUpperCase()} OBB ${stale.fileName}. Current retained ${retainedFileNames.length === 1 ? 'file' : 'files'}: ${retainedFileNames.join(', ')}.`
          })
        }
      }
    }

    return items.sort((left, right) => left.packageId.localeCompare(right.packageId, undefined, { sensitivity: 'base' }))
  }

  private async cleanupSupersededVersionedObbFiles(
    adbPath: string,
    serial: string,
    packageName: string,
    keepFileNames: string[],
    action?: HeadsetActionContext | null
  ): Promise<number> {
    const normalizedPackageName = packageName.trim()
    if (!normalizedPackageName || !keepFileNames.length) {
      return 0
    }

    const keepByKind = new Map<'main' | 'patch', Set<string>>()
    for (const fileName of keepFileNames) {
      const match = fileName.match(/^(main|patch)\.(\d+)\..+\.obb$/i)
      if (!match?.[1]) {
        continue
      }
      const kind = match[1].toLowerCase() === 'patch' ? 'patch' : 'main'
      const existing = keepByKind.get(kind) ?? new Set<string>()
      existing.add(fileName)
      keepByKind.set(kind, existing)
    }

    if (!keepByKind.size) {
      return 0
    }

    const existingFiles = await this.readSupersededVersionedObbFiles(adbPath, serial, new Set([normalizedPackageName.toLowerCase()]))
    const staleFiles = existingFiles.filter((item) => {
      const fileName = basename(item.absolutePath)
      const match = fileName.match(/^(main|patch)\.(\d+)\..+\.obb$/i)
      if (!match?.[1]) {
        return false
      }
      const kind = match[1].toLowerCase() === 'patch' ? 'patch' : 'main'
      return keepByKind.has(kind) && !keepByKind.get(kind)?.has(fileName)
    })

    let deletedCount = 0
    for (const staleFile of staleFiles) {
      await this.logHeadsetActionStep(action, `Removing superseded OBB ${basename(staleFile.absolutePath)}.`, {
        packageName: normalizedPackageName,
        obbPath: staleFile.absolutePath
      })
      await this.runShellCommand(adbPath, serial, `rm -f "${staleFile.absolutePath}"`)
      deletedCount += 1
    }

    return deletedCount
  }

  private buildLeftoverDeleteBlockKey(serial: string, absolutePath: string): string {
    return `${serial.trim().toLowerCase()}::${absolutePath.trim().toLowerCase()}`
  }

  private async readApkInstallMetadata(apkPath: string): Promise<ApkInstallMetadata> {
    if (this.apkMetadataParserUnavailable) {
      return {
        packageName: null,
        versionCode: null
      }
    }

    try {
      const reader = await ApkReader.open(apkPath)
      const manifest = await reader.readManifest()

      return {
        packageName: typeof manifest.package === 'string' && manifest.package.trim() ? manifest.package.trim() : null,
        versionCode:
          manifest.versionCode !== undefined && manifest.versionCode !== null
            ? String(manifest.versionCode)
            : null
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /Cannot find module|ERR_REQUIRE_ESM|not a function/i.test(error.message)
      ) {
        this.apkMetadataParserUnavailable = true
      }

      return {
        packageName: null,
        versionCode: null
      }
    }
  }

  private isInsufficientStorageInstallFailure(details: string): boolean {
    return /INSTALL_FAILED_INSUFFICIENT_STORAGE|insufficient storage|not enough (?:free )?space|no space left/i.test(details)
  }

  private async runReplaceInstall(adbPath: string, serial: string, apkPath: string): Promise<string | null> {
    const { stdout, stderr } = await execFileAsync(adbPath, ['-s', serial, 'install', '-r', '-g', apkPath], {
      maxBuffer: 10 * 1024 * 1024
    })
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()

    return output || null
  }

  private async uninstallPackageKeepingData(
    adbPath: string,
    serial: string,
    packageName: string
  ): Promise<string | null> {
    const { stdout, stderr } = await execFileAsync(adbPath, ['-s', serial, 'uninstall', '-k', packageName], {
      maxBuffer: 10 * 1024 * 1024
    })
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()

    return output || null
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
  }

  private formatByteCount(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B'
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = value
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex += 1
    }

    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
  }

  private async readRemoteFileSizeBytes(
    adbPath: string,
    serial: string,
    remotePath: string
  ): Promise<number | null> {
    const output = await this.runShellCommand(
      adbPath,
      serial,
      `stat -c %s ${this.shellQuote(remotePath)} 2>/dev/null || wc -c < ${this.shellQuote(remotePath)} 2>/dev/null || true`
    )
    const parsed = Number.parseInt(output.trim().split(/\s+/)[0] ?? '', 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  private async readInstalledPackageFootprintBytes(
    adbPath: string,
    serial: string,
    packageName: string
  ): Promise<number> {
    const quotedPackage = this.shellQuote(packageName)
    const shellScript =
      `pkg=${quotedPackage}; ` +
      'total=0; ' +
      'pm_path=$(pm path "$pkg" 2>/dev/null | head -n 1 | sed "s/^package://"); ' +
      'code_dir=${pm_path%/base.apk}; ' +
      'for path in "$code_dir" "/sdcard/Android/obb/$pkg" "/sdcard/Android/data/$pkg"; do ' +
      '[ -n "$path" ] || continue; ' +
      'size=$(du -sk "$path" 2>/dev/null | cut -f1); ' +
      'if [ -n "$size" ]; then total=$((total + size)); fi; ' +
      'done; ' +
      'echo "$total"'
    const output = await this.runShellCommand(adbPath, serial, shellScript)
    const parsedKilobytes = Number.parseInt(output.trim().split(/\s+/)[0] ?? '', 10)
    return Number.isFinite(parsedKilobytes) ? parsedKilobytes * 1024 : 0
  }

  private async logUpgradeSpaceEstimate(
    adbPath: string,
    serial: string,
    packageName: string | null,
    incomingBytes: number | null,
    action?: HeadsetActionContext | null
  ): Promise<UpgradeSpaceEstimate | null> {
    if (!packageName || !incomingBytes || incomingBytes <= 0) {
      return null
    }

    const installedPackages = await this.readInstalledPackageIds(adbPath, serial)
    if (!installedPackages.has(packageName.toLowerCase())) {
      return null
    }

    const [storageInfo, installedFootprintBytes] = await Promise.all([
      this.readStorageInfo(adbPath, serial).catch(() => null),
      this.readInstalledPackageFootprintBytes(adbPath, serial, packageName).catch(() => 0)
    ])
    const effectiveRequiredBytes = Math.max(0, incomingBytes - installedFootprintBytes)
    const freeBytes = storageInfo?.freeBytes ?? null
    const warning = freeBytes !== null && effectiveRequiredBytes > freeBytes
    const message = warning
      ? `Upgrade may need ${this.formatByteCount(effectiveRequiredBytes)} but the headset reports ${this.formatByteCount(freeBytes)} free.`
      : `Upgrade space estimate: ${this.formatByteCount(effectiveRequiredBytes)} additional space needed.`
    const estimate: UpgradeSpaceEstimate = {
      packageName,
      incomingBytes,
      installedFootprintBytes,
      effectiveRequiredBytes,
      freeBytes,
      warning,
      message
    }

    await this.logHeadsetActionStep(
      action,
      warning ? 'Headset space looks tight for this upgrade.' : 'Checked headset upgrade space.',
      {
        packageName,
        incomingBytes,
        installedFootprintBytes,
        effectiveRequiredBytes,
        freeBytes,
        warning
      }
    )

    return estimate
  }

  private async pushObbWithVerification(
    adbPath: string,
    serial: string,
    obbPath: string,
    remotePath: string,
    packageName: string,
    action?: HeadsetActionContext | null
  ): Promise<string | null> {
    const localSizeBytes = (await stat(obbPath)).size
    let lastOutput: string | null = null

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (attempt > 1) {
        await this.logHeadsetActionStep(action, `Retrying OBB transfer for ${basename(obbPath)} after size verification failed.`, {
          obbPath,
          packageName,
          localSizeBytes,
          remotePath
        })
        await this.runShellCommand(adbPath, serial, `rm -f ${this.shellQuote(remotePath)}`)
      }

      const { stdout, stderr } = await execFileAsync(
        adbPath,
        ['-s', serial, 'push', obbPath, remotePath],
        {
          maxBuffer: 10 * 1024 * 1024
        }
      )
      lastOutput = [stdout, stderr].filter(Boolean).join('\n').trim() || null
      const remoteSizeBytes = await this.readRemoteFileSizeBytes(adbPath, serial, remotePath)
      if (remoteSizeBytes === localSizeBytes) {
        await this.logHeadsetActionStep(action, 'OBB transfer verified.', {
          obbPath,
          packageName,
          remotePath,
          localSizeBytes,
          remoteSizeBytes,
          attempt
        })
        return lastOutput
      }

      await this.logHeadsetActionStep(action, 'OBB transfer size verification failed.', {
        obbPath,
        packageName,
        remotePath,
        localSizeBytes,
        remoteSizeBytes,
        attempt
      })
    }

    const finalRemoteSizeBytes = await this.readRemoteFileSizeBytes(adbPath, serial, remotePath)
    throw new Error(
      `OBB transfer verification failed for ${basename(obbPath)}. Local size ${this.formatByteCount(localSizeBytes)}, remote size ${finalRemoteSizeBytes === null ? 'unknown' : this.formatByteCount(finalRemoteSizeBytes)}.`
    )
  }

  private async prepareObbDestinationDirectory(
    adbPath: string,
    serial: string,
    packageName: string,
    action?: HeadsetActionContext | null
  ): Promise<string> {
    const candidates = [
      `/sdcard/Android/obb/${packageName}`,
      `/storage/emulated/0/Android/obb/${packageName}`
    ]
    const shellScript = [
      `for dir in ${candidates.map((candidate) => this.shellQuote(candidate)).join(' ')}; do`,
      'mkdir -p "$dir" 2>/dev/null && printf "%s" "$dir" && exit 0;',
      'done;',
      'exit 1'
    ].join(' ')
    const destinationDirectory = await this.runShellCommand(adbPath, serial, shellScript)
    const normalizedDirectory = destinationDirectory.trim()

    if (!normalizedDirectory) {
      throw new Error(`Unable to create OBB destination for ${packageName}.`)
    }

    await this.logHeadsetActionStep(action, 'Prepared OBB destination directory.', {
      packageName,
      destinationDirectory
    })

    return normalizedDirectory
  }

  private async installApkWithLowSpaceRetry(
    adbPath: string,
    serial: string,
    apkPath: string,
    options: {
      action?: HeadsetActionContext | null
      packageNameHint?: string | null
      installLabel: string
      successLabel: string
      failureLabel: string
      preflightPayloadBytes?: number | null
    }
  ): Promise<ApkInstallResult> {
    const metadata = await this.readApkInstallMetadata(apkPath)
    const packageNameHint = options.packageNameHint?.trim() || null
    const packageName = metadata.packageName ?? packageNameHint
    const apkStats = await stat(apkPath).catch(() => null)
    const preflightEstimate = await this.logUpgradeSpaceEstimate(
      adbPath,
      serial,
      packageName,
      options.preflightPayloadBytes ?? apkStats?.size ?? null,
      options.action
    )

    await this.logHeadsetActionStep(options.action, `${options.installLabel} ${basename(apkPath)}.`, {
      apkPath,
      packageName,
      versionCode: metadata.versionCode,
      apkSizeBytes: apkStats?.size ?? null,
      upgradeSpaceEstimateMessage: preflightEstimate?.message ?? null,
      upgradeEffectiveRequiredBytes: preflightEstimate?.effectiveRequiredBytes ?? null,
      upgradeFreeBytes: preflightEstimate?.freeBytes ?? null
    })

    try {
      const output = await this.runReplaceInstall(adbPath, serial, apkPath)
      if (output) {
        await this.logHeadsetActionStep(options.action, options.successLabel, {
          apkPath,
          packageName,
          outputLines: output.split('\n').length,
          installMode: 'replace'
        })
      }

      return {
        success: true,
        details: output,
        packageName,
        usedPreservedDataRetry: false,
        preflightDetails: preflightEstimate?.message ?? null
      }
    } catch (error) {
      const details = this.readErrorMessage(error)
      const shouldRetryWithKeptData = metadata.packageName && this.isInsufficientStorageInstallFailure(details)

      await this.logHeadsetActionStep(options.action, options.failureLabel, {
        apkPath,
        packageName,
        error: details,
        retryEligible: Boolean(shouldRetryWithKeptData)
      })

      if (!shouldRetryWithKeptData || !metadata.packageName) {
        return {
          success: false,
          details,
          packageName,
          usedPreservedDataRetry: false,
          preflightDetails: preflightEstimate?.message ?? null
        }
      }

      const retryPackageName = metadata.packageName
      const installedPackages = await this.readInstalledPackageIds(adbPath, serial)
      if (!installedPackages.has(retryPackageName.toLowerCase())) {
        await this.logHeadsetActionStep(
          options.action,
          'Low-space preserved-data reinstall was skipped because the APK package is not installed on the headset.',
          { apkPath, packageName: retryPackageName }
        )
        return {
          success: false,
          details,
          packageName,
          usedPreservedDataRetry: false,
          preflightDetails: preflightEstimate?.message ?? null
        }
      }

      await this.logHeadsetActionStep(
        options.action,
        'Replace install ran out of space; removing the installed package while keeping app data before retrying.',
        { apkPath, packageName: retryPackageName }
      )

      let uninstallOutput: string | null = null
      try {
        uninstallOutput = await this.uninstallPackageKeepingData(adbPath, serial, retryPackageName)
        await this.logHeadsetActionStep(options.action, 'Removed installed package while keeping app data.', {
          packageName: retryPackageName,
          outputLines: uninstallOutput ? uninstallOutput.split('\n').length : 0
        })
      } catch (uninstallError) {
        const uninstallDetails = this.readErrorMessage(uninstallError)
        await this.logHeadsetActionStep(options.action, 'Unable to remove installed package while keeping app data.', {
          packageName: retryPackageName,
          error: uninstallDetails
        })
        return {
          success: false,
          details: `${details}\n\nPreserved-data retry failed before reinstall:\n${uninstallDetails}`,
          packageName: retryPackageName,
          usedPreservedDataRetry: true,
          preflightDetails: preflightEstimate?.message ?? null
        }
      }

      try {
        const reinstallOutput = await this.runReplaceInstall(adbPath, serial, apkPath)
        await this.logHeadsetActionStep(options.action, 'APK install finished after preserved-data retry.', {
          apkPath,
          packageName: retryPackageName,
          outputLines: reinstallOutput ? reinstallOutput.split('\n').length : 0,
          installMode: 'preserved-data-reinstall'
        })

        return {
          success: true,
          details: [uninstallOutput, reinstallOutput].filter(Boolean).join('\n') || null,
          packageName: retryPackageName,
          usedPreservedDataRetry: true,
          preflightDetails: preflightEstimate?.message ?? null
        }
      } catch (reinstallError) {
        const reinstallDetails = this.readErrorMessage(reinstallError)
        await this.logHeadsetActionStep(options.action, 'APK reinstall failed after keeping app data.', {
          apkPath,
          packageName: retryPackageName,
          error: reinstallDetails
        })
        return {
          success: false,
          details: `${details}\n\nRemoved ${retryPackageName} with app data kept, but reinstall failed:\n${reinstallDetails}`,
          packageName: retryPackageName,
          usedPreservedDataRetry: true,
          preflightDetails: preflightEstimate?.message ?? null
        }
      }
    }
  }

  private async installSingleApk(
    adbPath: string,
    serial: string,
    apkPath: string,
    action?: HeadsetActionContext | null
  ): Promise<{ success: boolean; message: string; details: string | null; packageName: string | null }> {
    const installResult = await this.installApkWithLowSpaceRetry(adbPath, serial, apkPath, {
      action,
      installLabel: 'Installing standalone APK',
      successLabel: 'Standalone APK install finished.',
      failureLabel: 'Standalone APK install failed.'
    })

    if (installResult.success) {
      return {
        success: true,
        message: installResult.usedPreservedDataRetry
          ? `Installed ${basename(apkPath)} on ${serial} after freeing the previous package while keeping app data.`
          : `Installed ${basename(apkPath)} on ${serial}.`,
        details: [installResult.preflightDetails, installResult.details].filter(Boolean).join('\n') || null,
        packageName: installResult.packageName
      }
    }

    return {
      success: false,
      message: installResult.usedPreservedDataRetry
        ? `Unable to reinstall ${basename(apkPath)} after freeing the previous package. App data was kept.`
        : `Unable to install ${basename(apkPath)}.`,
      details: [installResult.preflightDetails, installResult.details].filter(Boolean).join('\n') || null,
      packageName: installResult.packageName
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
    let packageName = item.packageIds[0] ?? this.inferPackageNameFromObbFiles(obbPaths)
    const payloadSizeBytes = await files.reduce<Promise<number>>(async (totalPromise, filePath) => {
      const total = await totalPromise
      const fileStats = await stat(filePath).catch(() => null)
      return total + (fileStats?.size ?? 0)
    }, Promise.resolve(0))
    let preflightDetails: string | null = null

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
      const installResult = await this.installApkWithLowSpaceRetry(adbPath, serial, apkPath, {
        action,
        packageNameHint: packageName ?? item.packageIds[0] ?? null,
        installLabel: 'Installing folder APK',
        successLabel: 'Folder APK install finished.',
        failureLabel: `Folder APK install failed for ${basename(apkPath)}.`,
        preflightPayloadBytes: preflightDetails ? null : payloadSizeBytes
      })
      preflightDetails = preflightDetails ?? installResult.preflightDetails

      if (installResult.packageName && (!packageName || !item.packageIds.length)) {
        packageName = installResult.packageName
      }

      if (!installResult.success) {
        await this.failHeadsetAction(action, `Folder APK install failed for ${basename(apkPath)}.`, {
          apkPath,
          packageName: installResult.packageName ?? packageName ?? item.packageIds[0] ?? null,
          error: installResult.details
        })
        return {
          success: false,
          message: installResult.usedPreservedDataRetry
            ? `Unable to reinstall ${basename(apkPath)} after freeing the previous package. App data was kept.`
            : `Unable to install ${basename(apkPath)}.`,
          details: [installResult.preflightDetails, installResult.details].filter(Boolean).join('\n') || null,
          packageName: installResult.packageName ?? packageName ?? item.packageIds[0] ?? null
        }
      }
    }

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
      const remoteObbDirectory = await this.prepareObbDestinationDirectory(adbPath, serial, packageName, action)
      const pushedObbFileNames: string[] = []
      for (const obbPath of obbPaths) {
        await this.logHeadsetActionStep(action, `Pushing OBB ${basename(obbPath)}.`, {
          obbPath,
          packageName,
          remoteObbDirectory
        })
        try {
          const remoteObbPath = `${remoteObbDirectory}/${basename(obbPath)}`
          const output = await this.pushObbWithVerification(
            adbPath,
            serial,
            obbPath,
            remoteObbPath,
            packageName,
            action
          )
          if (output) {
            await this.logHeadsetActionStep(action, 'OBB transfer finished.', {
              obbPath,
              packageName,
              outputLines: output.split('\n').length
            })
          }
          pushedObbFileNames.push(basename(obbPath))
        } catch (error) {
          const details = this.readErrorMessage(error)
          await this.failHeadsetAction(action, `OBB transfer failed for ${basename(obbPath)}.`, {
            obbPath,
            packageName,
            error: details
          })
          return {
            success: false,
            message: `Unable to transfer ${basename(obbPath)}.`,
            details,
            packageName
          }
        }
      }

      const deletedSupersededObbCount = await this.cleanupSupersededVersionedObbFiles(
        adbPath,
        serial,
        packageName,
        pushedObbFileNames,
        action
      )
      if (deletedSupersededObbCount > 0) {
        await this.logHeadsetActionStep(
          action,
          `Removed ${deletedSupersededObbCount} superseded versioned OBB ${deletedSupersededObbCount === 1 ? 'file' : 'files'}.`,
          { packageName, deletedSupersededObbCount }
        )
      }
    }

    const appliedShellSteps = await this.applyInstallScripts(adbPath, serial, installScriptPaths, action)

    return {
      success: true,
      message: obbPaths.length
        ? `Installed ${apkPaths.length} APK${apkPaths.length === 1 ? '' : 's'}, pushed ${obbPaths.length} OBB file${obbPaths.length === 1 ? '' : 's'}${appliedShellSteps ? `, and applied ${appliedShellSteps} install script step${appliedShellSteps === 1 ? '' : 's'}` : ''}.`
        : `Installed ${apkPaths.length} APK${apkPaths.length === 1 ? '' : 's'} from the local library${appliedShellSteps ? ` and applied ${appliedShellSteps} install script step${appliedShellSteps === 1 ? '' : 's'}` : ''}.`,
      details: preflightDetails,
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
    action: 'connect' | 'disconnect' | 'install' | 'uninstall' | 'reboot',
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
