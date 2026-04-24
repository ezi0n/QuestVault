import { app } from 'electron'
import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import extractZip from 'extract-zip'
import type {
  DependencyBootstrapPhase,
  DependencyBootstrapProgressUpdate,
  DependencyStatusResponse,
  DeviceRuntimeInfo,
  ManagedDependencyId,
  ManagedDependencySource,
  ManagedDependencyStatus,
  ManagedDependencySummary
} from '@shared/types/ipc'

const execFileAsync = promisify(execFile)

class DependencyService {
  private adbInstallPromise: Promise<ManagedDependencySummary> | null = null
  private sevenZipInstallPromise: Promise<ManagedDependencySummary> | null = null
  private rcloneInstallPromise: Promise<string> | null = null
  private bootstrapProgressListeners = new Set<(update: DependencyBootstrapProgressUpdate) => void>()
  private readonly minimumRcloneVersion = '1.73.5'

  onBootstrapProgress(listener: (update: DependencyBootstrapProgressUpdate) => void): () => void {
    this.bootstrapProgressListeners.add(listener)
    return () => {
      this.bootstrapProgressListeners.delete(listener)
    }
  }

  async ensureStartupDependencies(): Promise<DependencyStatusResponse> {
    const [adb, sevenZip] = await Promise.all([this.ensureAdbDependency(), this.ensureSevenZipDependency()])
    const statuses = [adb, sevenZip]
    const failed = statuses.filter((entry) => entry.status !== 'ready')

    return {
      statuses,
      checkedAt: new Date().toISOString(),
      message: failed.length ? `${failed.length} managed dependenc${failed.length === 1 ? 'y is' : 'ies are'} unavailable.` : 'Managed dependencies are ready.'
    }
  }

  getManagedAdbPath(): string {
    const binaryName = process.platform === 'win32' ? 'adb.exe' : 'adb'
    return join(this.getPlatformToolsDir(), binaryName)
  }

  getManagedSevenZipPath(): string {
    const binaryName = process.platform === 'win32' ? '7zr.exe' : '7zz'
    return join(this.getSevenZipDir(), binaryName)
  }

  async ensureManagedAdb(): Promise<DeviceRuntimeInfo> {
    const status = await this.ensureAdbDependency()
    return this.toDeviceRuntime(status)
  }

  async ensureSevenZip(): Promise<ManagedDependencySummary> {
    return this.ensureSevenZipDependency()
  }

  async ensureRclonePath(): Promise<string> {
    if (this.rcloneInstallPromise) {
      return this.rcloneInstallPromise
    }

    this.rcloneInstallPromise = this.ensureRclonePathInternal()

    try {
      return await this.rcloneInstallPromise
    } finally {
      this.rcloneInstallPromise = null
    }
  }

  private emitBootstrapProgress(
    dependencyId: ManagedDependencyId,
    title: string,
    phase: DependencyBootstrapPhase,
    progress: number,
    details: string | null,
    path: string | null
  ): void {
    const update: DependencyBootstrapProgressUpdate = {
      dependencyId,
      title,
      phase,
      progress,
      details,
      path
    }

    for (const listener of this.bootstrapProgressListeners) {
      listener(update)
    }
  }

  private async ensureAdbDependency(): Promise<ManagedDependencySummary> {
    if (this.adbInstallPromise) {
      return this.adbInstallPromise
    }

    this.adbInstallPromise = this.ensureAdbDependencyInternal()

    try {
      return await this.adbInstallPromise
    } finally {
      this.adbInstallPromise = null
    }
  }

  private async ensureAdbDependencyInternal(): Promise<ManagedDependencySummary> {
    const managedAdbPath = this.getManagedAdbPath()
    if (await this.isExecutablePresent(managedAdbPath)) {
      return this.buildDependencySummary(
        'adb',
        'Managed ADB',
        'ready',
        'managed',
        managedAdbPath,
        'Managed ADB is installed and ready.'
      )
    }

    this.emitBootstrapProgress('adb', 'Managed ADB', 'downloading', 12, 'Downloading Android platform-tools…', managedAdbPath)

    try {
      await mkdir(this.getBinRoot(), { recursive: true })
      await this.downloadAndInstallPlatformTools()
      await this.ensureExecutablePermissions(managedAdbPath)
      this.emitBootstrapProgress('adb', 'Managed ADB', 'extracting', 84, 'Extracting platform-tools…', managedAdbPath)
      this.emitBootstrapProgress('adb', 'Managed ADB', 'ready', 100, 'Managed ADB installed successfully.', managedAdbPath)

      return this.buildDependencySummary(
        'adb',
        'Managed ADB',
        'ready',
        'managed',
        managedAdbPath,
        'Managed ADB installed successfully.'
      )
    } catch (error) {
      const fallbackAdbPath = await this.findExecutableOnPath(process.platform === 'win32' ? ['adb.exe', 'adb'] : ['adb'])
      if (fallbackAdbPath) {
        const message = `Managed ADB install failed, so the app is temporarily using system adb at ${fallbackAdbPath}.`
        this.emitBootstrapProgress('adb', 'Managed ADB', 'ready', 100, message, fallbackAdbPath)
        return this.buildDependencySummary('adb', 'Managed ADB', 'ready', 'system', fallbackAdbPath, message)
      }

      const message = this.readErrorMessage(error, 'Unable to prepare managed ADB.')
      this.emitBootstrapProgress('adb', 'Managed ADB', 'failed', 100, message, null)
      return this.buildDependencySummary('adb', 'Managed ADB', 'error', 'missing', null, message)
    }
  }

  private async ensureSevenZipDependency(): Promise<ManagedDependencySummary> {
    if (this.sevenZipInstallPromise) {
      return this.sevenZipInstallPromise
    }

    this.sevenZipInstallPromise = this.ensureSevenZipDependencyInternal()

    try {
      return await this.sevenZipInstallPromise
    } finally {
      this.sevenZipInstallPromise = null
    }
  }

  private async ensureSevenZipDependencyInternal(): Promise<ManagedDependencySummary> {
    const managedSevenZipPath = this.getManagedSevenZipPath()
    if (await this.isExecutablePresent(managedSevenZipPath)) {
      return this.buildDependencySummary(
        'sevenZip',
        '7-Zip',
        'ready',
        'managed',
        managedSevenZipPath,
        'Managed 7-Zip is installed and ready.'
      )
    }

    const systemSevenZipPath = await this.findExecutableOnPath(
      process.platform === 'win32' ? ['7zr.exe', '7zz.exe', '7z.exe'] : ['7zz', '7z']
    )
    if (systemSevenZipPath) {
      return this.buildDependencySummary(
        'sevenZip',
        '7-Zip',
        'ready',
        'system',
        systemSevenZipPath,
        `Using system 7-Zip at ${systemSevenZipPath}.`
      )
    }

    this.emitBootstrapProgress('sevenZip', '7-Zip', 'downloading', 12, 'Downloading 7-Zip for vrSrc extraction…', managedSevenZipPath)

    try {
      await mkdir(this.getSevenZipDir(), { recursive: true })
      await this.downloadAndInstallSevenZip()
      await this.ensureExecutablePermissions(managedSevenZipPath)
      this.emitBootstrapProgress('sevenZip', '7-Zip', 'ready', 100, 'Managed 7-Zip installed successfully.', managedSevenZipPath)

      return this.buildDependencySummary(
        'sevenZip',
        '7-Zip',
        'ready',
        'managed',
        managedSevenZipPath,
        'Managed 7-Zip installed successfully.'
      )
    } catch (error) {
      const message = this.readErrorMessage(
        error,
        'Unable to prepare 7-Zip. vrSrc extraction requires 7-Zip or 7zr.'
      )
      this.emitBootstrapProgress('sevenZip', '7-Zip', 'failed', 100, message, null)
      return this.buildDependencySummary('sevenZip', '7-Zip', 'error', 'missing', null, message)
    }
  }

  private async ensureRclonePathInternal(): Promise<string> {
    const managedRclonePath = this.getManagedRclonePath()
    if (await this.isExecutablePresent(managedRclonePath)) {
      const managedVersion = await this.readRcloneVersion(managedRclonePath)
      if (managedVersion && this.isVersionAtLeast(managedVersion, this.minimumRcloneVersion)) {
        return managedRclonePath
      }

      await rm(managedRclonePath, { force: true }).catch(() => undefined)
    }

    const systemRclonePath = await this.findExecutableOnPath(process.platform === 'win32' ? ['rclone.exe', 'rclone'] : ['rclone'])
    if (systemRclonePath) {
      const systemVersion = await this.readRcloneVersion(systemRclonePath)
      if (systemVersion && this.isVersionAtLeast(systemVersion, this.minimumRcloneVersion)) {
        return systemRclonePath
      }
    }

    await mkdir(this.getRcloneDir(), { recursive: true })
    await this.downloadAndInstallRclone()
    await this.ensureExecutablePermissions(managedRclonePath)

    if (await this.isExecutablePresent(managedRclonePath)) {
      return managedRclonePath
    }

    throw new Error('Unable to prepare rclone for vrSrc downloads.')
  }

  private async readRcloneVersion(binaryPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(binaryPath, ['version'], {
        maxBuffer: 256 * 1024
      })
      const match = stdout.match(/rclone v(\d+\.\d+\.\d+)/i)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }

  private isVersionAtLeast(candidate: string, minimum: string): boolean {
    const candidateParts = candidate.split('.').map((part) => Number.parseInt(part, 10) || 0)
    const minimumParts = minimum.split('.').map((part) => Number.parseInt(part, 10) || 0)
    const length = Math.max(candidateParts.length, minimumParts.length)

    for (let index = 0; index < length; index += 1) {
      const candidateValue = candidateParts[index] ?? 0
      const minimumValue = minimumParts[index] ?? 0
      if (candidateValue > minimumValue) {
        return true
      }
      if (candidateValue < minimumValue) {
        return false
      }
    }

    return true
  }

  private async downloadAndInstallPlatformTools(): Promise<void> {
    const archivePath = join(tmpdir(), `questvault-platform-tools-${Date.now()}.zip`)
    const extractDir = join(tmpdir(), `questvault-platform-tools-${Date.now()}`)

    try {
      await this.downloadUrlToFile(this.getPlatformToolsUrl(), archivePath)
      this.emitBootstrapProgress('adb', 'Managed ADB', 'extracting', 74, 'Extracting platform-tools…', this.getManagedAdbPath())
      await mkdir(extractDir, { recursive: true })
      await extractZip(archivePath, { dir: extractDir })

      const extractedDir = join(extractDir, 'platform-tools')
      if (!existsSync(extractedDir)) {
        throw new Error('Downloaded platform-tools archive did not contain the expected directory.')
      }

      await rm(this.getPlatformToolsDir(), { recursive: true, force: true })
      await cp(extractedDir, this.getPlatformToolsDir(), { recursive: true, force: true })
    } finally {
      await rm(archivePath, { force: true }).catch(() => undefined)
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async downloadAndInstallSevenZip(): Promise<void> {
    if (process.platform === 'win32') {
      const destinationPath = this.getManagedSevenZipPath()
      await this.downloadUrlToFile(this.getSevenZipUrl(), destinationPath)
      return
    }

    const archivePath = join(tmpdir(), `questvault-sevenzip-${Date.now()}.tar.xz`)
    const extractDir = join(tmpdir(), `questvault-sevenzip-${Date.now()}`)

    try {
      await this.downloadUrlToFile(this.getSevenZipUrl(), archivePath)
      this.emitBootstrapProgress('sevenZip', '7-Zip', 'extracting', 74, 'Extracting 7-Zip…', this.getManagedSevenZipPath())
      await mkdir(extractDir, { recursive: true })
      await execFileAsync('tar', ['-xJf', archivePath, '-C', extractDir])

      const extractedBinaryPath = await this.findExtractedSevenZipBinary(extractDir)
      if (!extractedBinaryPath) {
        throw new Error('Downloaded 7-Zip archive did not contain the expected executable.')
      }

      await rm(this.getSevenZipDir(), { recursive: true, force: true })
      await mkdir(this.getSevenZipDir(), { recursive: true })
      await cp(extractedBinaryPath, this.getManagedSevenZipPath(), { force: true })
    } finally {
      await rm(archivePath, { force: true }).catch(() => undefined)
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async downloadAndInstallRclone(): Promise<void> {
    const archivePath = join(tmpdir(), `questvault-rclone-${Date.now()}.zip`)
    const extractDir = join(tmpdir(), `questvault-rclone-${Date.now()}`)

    try {
      await this.downloadUrlToFile(await this.getRcloneUrl(), archivePath)
      await mkdir(extractDir, { recursive: true })
      await extractZip(archivePath, { dir: extractDir })

      const extractedBinaryPath = await this.findExtractedRcloneBinary(extractDir)
      if (!extractedBinaryPath) {
        throw new Error('Downloaded rclone archive did not contain the expected executable.')
      }

      await rm(this.getRcloneDir(), { recursive: true, force: true })
      await mkdir(this.getRcloneDir(), { recursive: true })
      await cp(extractedBinaryPath, this.getManagedRclonePath(), { force: true })
    } finally {
      await rm(archivePath, { force: true }).catch(() => undefined)
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async findExtractedSevenZipBinary(rootPath: string): Promise<string | null> {
    const candidateNames = ['7zz', '7z']
    const queue: string[] = [rootPath]

    while (queue.length) {
      const currentPath = queue.shift()
      if (!currentPath) {
        continue
      }

      const entries = await readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = join(currentPath, entry.name)
        if (entry.isDirectory()) {
          queue.push(entryPath)
          continue
        }

        if (candidateNames.includes(entry.name)) {
          return entryPath
        }
      }
    }

    return null
  }

  private async findExtractedRcloneBinary(rootPath: string): Promise<string | null> {
    const candidateNames = process.platform === 'win32' ? ['rclone.exe'] : ['rclone']
    const queue: string[] = [rootPath]

    while (queue.length) {
      const currentPath = queue.shift()
      if (!currentPath) {
        continue
      }

      const entries = await readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = join(currentPath, entry.name)
        if (entry.isDirectory()) {
          queue.push(entryPath)
          continue
        }

        if (candidateNames.includes(entry.name)) {
          return entryPath
        }
      }
    }

    return null
  }

  private async downloadUrlToFile(url: string, destinationPath: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download dependency: ${response.status} ${response.statusText}`)
    }

    const bytes = await response.arrayBuffer()
    await writeFile(destinationPath, Buffer.from(bytes))
  }

  private async ensureExecutablePermissions(filePath: string): Promise<void> {
    if (process.platform !== 'win32') {
      await chmod(filePath, 0o755)
    }
  }

  private async isExecutablePresent(filePath: string): Promise<boolean> {
    try {
      const fileStat = await stat(filePath)
      return fileStat.isFile()
    } catch {
      return false
    }
  }

  private async findExecutableOnPath(commandNames: string[]): Promise<string | null> {
    const commands =
      process.platform === 'win32'
        ? commandNames.flatMap((commandName) => [
            ['where', commandName],
            ['where', commandName.replace(/\.exe$/i, '')]
          ])
        : commandNames.map((commandName) => ['which', commandName])

    for (const [command, ...args] of commands) {
      try {
        const { stdout } = await execFileAsync(command, args)
        const candidate = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0)

        if (candidate) {
          return candidate
        }
      } catch {
        // Try the next candidate.
      }
    }

    return null
  }

  private getPlatformToolsUrl(): string {
    if (process.platform === 'win32') {
      return 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
    }

    if (process.platform === 'darwin') {
      return 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip'
    }

    return 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip'
  }

  private getSevenZipUrl(): string {
    if (process.platform === 'win32') {
      return 'https://www.7-zip.org/a/7zr.exe'
    }

    if (process.platform === 'darwin') {
      return 'https://github.com/ip7z/7zip/releases/download/26.00/7z2600-mac.tar.xz'
    }

    return process.arch === 'arm64'
      ? 'https://github.com/ip7z/7zip/releases/download/26.00/7z2600-linux-arm64.tar.xz'
      : 'https://github.com/ip7z/7zip/releases/download/26.00/7z2600-linux-x64.tar.xz'
  }

  private async getRcloneUrl(): Promise<string> {
    const fallbackVersion = 'v1.73.5'

    try {
      const response = await fetch('https://api.github.com/repos/rclone/rclone/releases/latest', {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'QuestVault'
        }
      })

      if (response.ok) {
        const payload = (await response.json()) as {
          tag_name?: string
          assets?: Array<{
            name?: string
            browser_download_url?: string
          }>
        }
        const version = typeof payload.tag_name === 'string' && payload.tag_name ? payload.tag_name : fallbackVersion
        const assetName = this.getRcloneAssetName(version)
        const asset = payload.assets?.find((entry) => entry?.name === assetName)
        if (asset?.browser_download_url) {
          return asset.browser_download_url
        }
      }
    } catch {
      // Fall back to the pinned URL below.
    }

    return this.getPinnedRcloneUrl(fallbackVersion)
  }

  private getPinnedRcloneUrl(version: string): string {
    return `https://downloads.rclone.org/${version}/${this.getRcloneAssetName(version)}`
  }

  private getRcloneAssetName(version: string): string {
    if (process.platform === 'win32') {
      return process.arch === 'arm64'
        ? `rclone-${version}-windows-arm64.zip`
        : `rclone-${version}-windows-amd64.zip`
    }

    if (process.platform === 'darwin') {
      return process.arch === 'arm64'
        ? `rclone-${version}-osx-arm64.zip`
        : `rclone-${version}-osx-amd64.zip`
    }

    return process.arch === 'arm64'
      ? `rclone-${version}-linux-arm64.zip`
      : `rclone-${version}-linux-amd64.zip`
  }

  private getBinRoot(): string {
    return join(app.getPath('userData'), 'bin')
  }

  private getPlatformToolsDir(): string {
    return join(this.getBinRoot(), 'platform-tools')
  }

  private getSevenZipDir(): string {
    return join(this.getBinRoot(), '7zip')
  }

  private getRcloneDir(): string {
    return join(this.getBinRoot(), 'rclone')
  }

  private getManagedRclonePath(): string {
    const binaryName = process.platform === 'win32' ? 'rclone.exe' : 'rclone'
    return join(this.getRcloneDir(), binaryName)
  }

  private buildDependencySummary(
    id: ManagedDependencyId,
    title: string,
    status: ManagedDependencyStatus,
    source: ManagedDependencySource,
    path: string | null,
    message: string
  ): ManagedDependencySummary {
    return {
      id,
      title,
      status,
      source,
      path,
      message
    }
  }

  private toDeviceRuntime(status: ManagedDependencySummary): DeviceRuntimeInfo {
    if (status.status === 'ready') {
      return {
        status: 'ready',
        adbPath: status.path,
        message: status.message
      }
    }

    return {
      status: status.status === 'missing' ? 'missing' : 'error',
      adbPath: status.path,
      message: status.message
    }
  }

  private readErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message
    }

    return fallback
  }
}

export const dependencyService = new DependencyService()
