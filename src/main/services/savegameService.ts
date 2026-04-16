import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  DeviceRuntimeInfo,
  SaveBackupEntry,
  SaveBackupPackageResponse,
  SaveBackupsResponse,
  SaveDataRoot,
  SaveDeleteBackupResponse,
  SavePackageScanResult,
  SavePackagesScanResponse,
  SaveRestoreBackupResponse
} from '@shared/types/ipc'
import { dependencyService } from './dependencyService'
import { settingsService } from './settingsService'

const execFileAsync = promisify(execFile)

interface SaveBackupManifest {
  format: 'qam-save-snapshot'
  version: 1
  packageId: string
  appName: string | null
  deviceSerial: string
  createdAt: string
  roots: SaveDataRoot[]
  skippedFiles?: Array<{
    remotePath: string
    reason: string
  }>
}

class SavegameService {
  private readonly manifestFileName = 'savegame-manifest.json'

  private async resolveRuntime(): Promise<DeviceRuntimeInfo> {
    return dependencyService.ensureManagedAdb()
  }

  private async getBasePath(): Promise<string | null> {
    const settings = await settingsService.getSettings()
    const configuredPath = settings.gameSavesPath?.trim() || null
    return configuredPath ? resolve(configuredPath) : null
  }

  private sanitizeSegment(value: string): string {
    const cleaned = value
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '.')
      .trim()

    return cleaned || 'snapshot'
  }

  private async runShellCommand(adbPath: string, serial: string, command: string): Promise<string> {
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', command], {
      maxBuffer: 10 * 1024 * 1024
    })
    return stdout.trim()
  }

  private getSaveRoots(packageId: string): string[] {
    return [`/sdcard/Android/data/${packageId}`]
  }

  private async getRootStats(adbPath: string, serial: string, remotePath: string): Promise<SaveDataRoot | null> {
    const existsOutput = await this.runShellCommand(
      adbPath,
      serial,
      `[ -d "${remotePath}" ] && echo EXISTS || echo MISSING`
    )

    if (!existsOutput.includes('EXISTS')) {
      return null
    }

    const fileCountOutput = await this.runShellCommand(
      adbPath,
      serial,
      `find "${remotePath}" -type f 2>/dev/null | wc -l`
    )
    const sizeKbOutput = await this.runShellCommand(
      adbPath,
      serial,
      `du -sk "${remotePath}" 2>/dev/null | awk '{print $1}'`
    )

    const fileCount = Number.parseInt(fileCountOutput.trim(), 10)
    const sizeKb = Number.parseInt(sizeKbOutput.trim(), 10)

    return {
      id: this.sanitizeSegment(basename(remotePath) || remotePath.replace(/\//g, '_')),
      remotePath,
      fileCount: Number.isFinite(fileCount) ? fileCount : 0,
      sizeBytes: Number.isFinite(sizeKb) ? sizeKb * 1024 : 0
    }
  }

  private async collectLocalFiles(rootPath: string): Promise<string[]> {
    const entries = await readdir(rootPath, { withFileTypes: true })
    const collected: string[] = []

    for (const entry of entries) {
      const entryPath = join(rootPath, entry.name)
      if (entry.isDirectory()) {
        collected.push(...(await this.collectLocalFiles(entryPath)))
      } else if (entry.isFile()) {
        collected.push(entryPath)
      }
    }

    return collected
  }

  private async calculateDirectorySize(rootPath: string): Promise<number> {
    const files = await this.collectLocalFiles(rootPath)
    let total = 0

    for (const filePath of files) {
      const fileStats = await stat(filePath)
      total += fileStats.size
    }

    return total
  }

  private async readSnapshotEntry(snapshotPath: string): Promise<SaveBackupEntry | null> {
    const manifestPath = join(snapshotPath, this.manifestFileName)
    if (!existsSync(manifestPath)) {
      return null
    }

    try {
      const manifestRaw = await readFile(manifestPath, 'utf8')
      const manifest = JSON.parse(manifestRaw) as SaveBackupManifest
      if (manifest.format !== 'qam-save-snapshot' || manifest.version !== 1) {
        return null
      }

      const sizeBytes = await this.calculateDirectorySize(snapshotPath)
      return {
        id: resolve(snapshotPath),
        packageId: manifest.packageId,
        appName: manifest.appName,
        createdAt: manifest.createdAt,
        sizeBytes,
        absolutePath: resolve(snapshotPath),
        roots: manifest.roots
      }
    } catch {
      return null
    }
  }

  private async listPackageBackups(packageId: string): Promise<SaveBackupEntry[]> {
    const basePath = await this.getBasePath()
    if (!basePath) {
      return []
    }

    const packagePath = join(basePath, packageId)
    if (!existsSync(packagePath)) {
      return []
    }

    const entries = await readdir(packagePath, { withFileTypes: true })
    const snapshots = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.readSnapshotEntry(join(packagePath, entry.name)))
      )
    ).filter(Boolean) as SaveBackupEntry[]

    return snapshots.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  }

  async listBackups(): Promise<SaveBackupsResponse> {
    const basePath = await this.getBasePath()
    if (!basePath) {
      return {
        path: null,
        entries: [],
        scannedAt: null,
        message: 'Choose a Game Saves folder in Settings to manage save snapshots.'
      }
    }

    if (!existsSync(basePath)) {
      return {
        path: basePath,
        entries: [],
        scannedAt: null,
        message: 'The configured Game Saves folder does not exist yet.'
      }
    }

    const packageEntries = await readdir(basePath, { withFileTypes: true })
    const snapshots = (
      await Promise.all(
        packageEntries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => this.listPackageBackups(entry.name))
      )
    )
      .flat()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

    return {
      path: basePath,
      entries: snapshots,
      scannedAt: new Date().toISOString(),
      message: snapshots.length
        ? `Loaded ${snapshots.length} save snapshot${snapshots.length === 1 ? '' : 's'}.`
        : 'No save snapshots were found yet.'
    }
  }

  private async scanPackageWithRuntime(
    runtime: DeviceRuntimeInfo,
    serial: string,
    packageId: string,
    appName: string | null
  ): Promise<SavePackageScanResult> {
    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        packageId,
        appName,
        status: 'error',
        roots: [],
        backupCount: 0,
        latestBackupId: null,
        message: runtime.message
      }
    }

    try {
      const roots: SaveDataRoot[] = []
      for (const remotePath of this.getSaveRoots(packageId)) {
        const stats = await this.getRootStats(runtime.adbPath, serial, remotePath)
        if (stats) {
          roots.push(stats)
        }
      }

      const backups = await this.listPackageBackups(packageId)
      return {
        packageId,
        appName,
        status: roots.length > 0 ? 'available' : 'none',
        roots,
        backupCount: backups.length,
        latestBackupId: backups[0]?.id ?? null,
        message: roots.length > 0 ? null : 'No accessible save data found in Android/data.'
      }
    } catch (error) {
      return {
        packageId,
        appName,
        status: 'error',
        roots: [],
        backupCount: 0,
        latestBackupId: null,
        message: error instanceof Error ? error.message : 'Unable to scan save data.'
      }
    }
  }

  async scanPackages(
    serial: string,
    packages: Array<{ packageId: string; appName: string | null }>
  ): Promise<SavePackagesScanResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()

    if (!normalizedSerial) {
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: 'No device selected for save scan.'
        },
        serial: normalizedSerial,
        scannedAt: new Date().toISOString(),
        results: [],
        message: 'No device selected for save scan.'
      }
    }

    const uniquePackages = Array.from(
      new Map(
        packages
          .filter((entry) => entry.packageId.trim().length > 0)
          .map((entry) => [entry.packageId.trim(), { packageId: entry.packageId.trim(), appName: entry.appName }])
      ).values()
    )

    const results: SavePackageScanResult[] = []
    for (const entry of uniquePackages) {
      results.push(await this.scanPackageWithRuntime(runtime, normalizedSerial, entry.packageId, entry.appName))
    }

    return {
      runtime,
      serial: normalizedSerial,
      scannedAt: new Date().toISOString(),
      results,
      message: results.length
        ? `Scanned save data for ${results.length} package${results.length === 1 ? '' : 's'}.`
        : 'No packages were provided for save scanning.'
    }
  }

  async backupPackage(serial: string, packageId: string, appName: string | null): Promise<SaveBackupPackageResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const normalizedPackageId = packageId.trim()
    const basePath = await this.getBasePath()

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message: runtime.message,
        details: null,
        backup: null
      }
    }

    if (!normalizedSerial) {
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message: 'No device selected for save backup.' },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message: 'No device selected for save backup.',
        details: null,
        backup: null
      }
    }

    if (!normalizedPackageId) {
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message: 'No package selected for save backup.' },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message: 'No package selected for save backup.',
        details: null,
        backup: null
      }
    }

    if (!basePath) {
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message: 'Choose a Game Saves folder in Settings before backing up save data.' },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message: 'Choose a Game Saves folder in Settings before backing up save data.',
        details: null,
        backup: null
      }
    }

    let snapshotPath: string | null = null

    try {
      const activeRoots: SaveDataRoot[] = []
      const skippedFiles: Array<{ remotePath: string; reason: string }> = []
      for (const remotePath of this.getSaveRoots(normalizedPackageId)) {
        const stats = await this.getRootStats(runtime.adbPath, normalizedSerial, remotePath)
        if (stats && stats.fileCount > 0) {
          activeRoots.push(stats)
        }
      }

      if (!activeRoots.length) {
        return {
          runtime,
          serial: normalizedSerial,
          packageId: normalizedPackageId,
          success: false,
          message: 'No accessible save files were found to back up.',
          details: null,
          backup: null
        }
      }

      const packagePath = join(basePath, normalizedPackageId)
      const timestamp = new Date().toISOString().replace(/[.:]/g, '-')
      const safeName = this.sanitizeSegment(appName || normalizedPackageId)
      snapshotPath = join(packagePath, `${timestamp}__${safeName}`)
      await mkdir(join(snapshotPath, 'payload'), { recursive: true })

      for (let index = 0; index < activeRoots.length; index += 1) {
        const root = activeRoots[index]
        const rootId = `root-${index}`
        const localRootPath = join(snapshotPath, 'payload', rootId)
        await mkdir(localRootPath, { recursive: true })

        const filesOutput = await this.runShellCommand(
          runtime.adbPath,
          normalizedSerial,
          `find "${root.remotePath}" -type f 2>/dev/null | while read -r file; do if [ -r "$file" ]; then echo "R|$file"; else echo "U|$file"; fi; done`
        )
        const remoteFiles = filesOutput
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        let copiedFiles = 0

        for (const entry of remoteFiles) {
          const [readability, remoteFile] = entry.split('|')
          if (!remoteFile) {
            continue
          }

          if (readability === 'U') {
            skippedFiles.push({
              remotePath: remoteFile,
              reason: 'ADB could not read this file from the headset.'
            })
            continue
          }

          const relativePath = remoteFile.startsWith(`${root.remotePath}/`)
            ? remoteFile.slice(root.remotePath.length + 1)
            : basename(remoteFile)
          const localFilePath = join(localRootPath, relativePath)
          await mkdir(dirname(localFilePath), { recursive: true })
          try {
            await execFileAsync(runtime.adbPath, ['-s', normalizedSerial, 'pull', remoteFile, localFilePath], {
              maxBuffer: 10 * 1024 * 1024
            })
            copiedFiles += 1
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown pull error.'
            if (message.includes('Permission denied')) {
              skippedFiles.push({
                remotePath: remoteFile,
                reason: 'ADB reported this file as unreadable.'
              })
              continue
            }

            throw error
          }
        }

        if (!copiedFiles) {
          await rm(localRootPath, { recursive: true, force: true }).catch(() => undefined)
        }
      }

      const payloadFiles = await this.collectLocalFiles(join(snapshotPath, 'payload'))
      if (!payloadFiles.length) {
        await rm(snapshotPath, { recursive: true, force: true }).catch(() => undefined)
        return {
          runtime,
          serial: normalizedSerial,
          packageId: normalizedPackageId,
          success: false,
          message: 'No readable save files were available to back up.',
          details: skippedFiles.length
            ? `Skipped ${skippedFiles.length} unreadable file${skippedFiles.length === 1 ? '' : 's'} on the headset.`
            : null,
          backup: null
        }
      }

      const manifest: SaveBackupManifest = {
        format: 'qam-save-snapshot',
        version: 1,
        packageId: normalizedPackageId,
        appName: appName?.trim() || null,
        deviceSerial: normalizedSerial,
        createdAt: new Date().toISOString(),
        roots: activeRoots.map((root, index) => ({ ...root, id: `root-${index}` })),
        skippedFiles: skippedFiles.length ? skippedFiles : undefined
      }
      await writeFile(join(snapshotPath, this.manifestFileName), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

      const backup = await this.readSnapshotEntry(snapshotPath)
      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: true,
        message: `Save snapshot created for ${appName || normalizedPackageId}.`,
        details: skippedFiles.length
          ? `${backup?.absolutePath ?? ''}${backup?.absolutePath ? '\n' : ''}Skipped ${skippedFiles.length} unreadable file${skippedFiles.length === 1 ? '' : 's'} on the headset.`
          : backup?.absolutePath ?? null,
        backup
      }
    } catch (error) {
      if (snapshotPath) {
        await rm(snapshotPath, { recursive: true, force: true }).catch(() => undefined)
      }

      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: `Unable to back up save data for ${normalizedPackageId}.`
        },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        success: false,
        message: `Unable to back up save data for ${normalizedPackageId}.`,
        details: error instanceof Error ? error.message : 'Unknown error.',
        backup: null
      }
    }
  }

  async restoreBackup(serial: string, packageId: string, backupId: string): Promise<SaveRestoreBackupResponse> {
    const runtime = await this.resolveRuntime()
    const normalizedSerial = serial.trim()
    const normalizedPackageId = packageId.trim()
    const normalizedBackupId = resolve(backupId.trim())

    if (runtime.status !== 'ready' || !runtime.adbPath) {
      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        backupId: normalizedBackupId,
        success: false,
        message: runtime.message,
        details: null
      }
    }

    if (!normalizedSerial) {
      return {
        runtime: { status: 'error', adbPath: runtime.adbPath, message: 'No device selected for save restore.' },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        backupId: normalizedBackupId,
        success: false,
        message: 'No device selected for save restore.',
        details: null
      }
    }

    try {
      const entry = await this.readSnapshotEntry(normalizedBackupId)
      if (!entry) {
        throw new Error('That save snapshot is no longer available.')
      }

      if (entry.packageId !== normalizedPackageId) {
        throw new Error(`Snapshot package mismatch. Expected ${normalizedPackageId}, found ${entry.packageId}.`)
      }

      for (const root of entry.roots) {
        const localRootPath = join(normalizedBackupId, 'payload', root.id)
        if (!existsSync(localRootPath)) {
          continue
        }

        await this.runShellCommand(runtime.adbPath, normalizedSerial, `rm -rf "${root.remotePath}"`)
        await this.runShellCommand(runtime.adbPath, normalizedSerial, `mkdir -p "${root.remotePath}"`)

        const localFiles = await this.collectLocalFiles(localRootPath)
        for (const localFile of localFiles) {
          const relativePath = relative(localRootPath, localFile)
          const remoteFilePath = `${root.remotePath}/${relativePath.replace(/\\/g, '/')}`
          const remoteDir = dirname(remoteFilePath).replace(/\\/g, '/')
          await this.runShellCommand(runtime.adbPath, normalizedSerial, `mkdir -p "${remoteDir}"`)
          await execFileAsync(runtime.adbPath, ['-s', normalizedSerial, 'push', localFile, remoteFilePath], {
            maxBuffer: 10 * 1024 * 1024
          })
        }
      }

      return {
        runtime,
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        backupId: normalizedBackupId,
        success: true,
        message: `Restored save snapshot for ${entry.appName || normalizedPackageId}.`,
        details: entry.absolutePath
      }
    } catch (error) {
      return {
        runtime: {
          status: 'error',
          adbPath: runtime.adbPath,
          message: `Unable to restore save data for ${normalizedPackageId}.`
        },
        serial: normalizedSerial,
        packageId: normalizedPackageId,
        backupId: normalizedBackupId,
        success: false,
        message: `Unable to restore save data for ${normalizedPackageId}.`,
        details: error instanceof Error ? error.message : 'Unknown error.'
      }
    }
  }

  async deleteBackup(backupId: string): Promise<SaveDeleteBackupResponse> {
    const basePath = await this.getBasePath()
    const normalizedBackupId = resolve(backupId.trim())

    try {
      const entry = await this.readSnapshotEntry(normalizedBackupId)
      if (!entry) {
        return {
          path: basePath,
          backupId: normalizedBackupId,
          packageId: '',
          deleted: false,
          message: 'That save snapshot is no longer available.',
          details: null
        }
      }

      await rm(normalizedBackupId, { recursive: true, force: true })
      const packagePath = dirname(normalizedBackupId)
      const remainingEntries = existsSync(packagePath) ? await readdir(packagePath) : []
      if (!remainingEntries.length) {
        await rm(packagePath, { recursive: true, force: true }).catch(() => undefined)
      }

      return {
        path: basePath,
        backupId: normalizedBackupId,
        packageId: entry.packageId,
        deleted: true,
        message: `Deleted save snapshot for ${entry.appName || entry.packageId}.`,
        details: null
      }
    } catch (error) {
      return {
        path: basePath,
        backupId: normalizedBackupId,
        packageId: '',
        deleted: false,
        message: 'Unable to delete that save snapshot.',
        details: error instanceof Error ? error.message : 'Unknown error.'
      }
    }
  }
}

export const savegameService = new SavegameService()
