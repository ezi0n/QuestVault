import { app, BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import type {
  AppSettings,
  BackupStorageDeleteItemResponse,
  BackupStorageMoveItemResponse,
  IndexedItemArtworkExtractionResponse,
  IndexedItemManualMetadataResponse,
  LocalLibraryIndexedItem,
  LocalLibraryManualStoreIdResponse,
  LocalLibraryItemKind,
  ManualGameMetadataOverride,
  LocalLibraryPurgeItemResponse,
  LocalLibraryRemoveMissingItemResponse,
  LocalLibraryScanResponse,
  SettingsIndexedPathUpdate,
  SettingsDisplayModeKey,
  SettingsPathStatsResponse,
  SettingsPathKey,
  SettingsSelectPathResponse,
  ViewDisplayMode
} from '@shared/types/ipc'
import { metaStoreService } from './metaStoreService'

type ApkReaderModule = {
  open(file: string): Promise<{
    readManifest(): Promise<{
      package?: string
      versionName?: string | number
      versionCode?: string | number
    }>
    readContent(path: string): Promise<Buffer>
  }>
}

type ApkMetadata = {
  packageId: string | null
  version: string | null
  versionCode: string | null
}

const ApkReader: ApkReaderModule = require('@devicefarmer/adbkit-apkreader')
const Zip = require('yauzl')

type ZipEntry = {
  fileName: string
}

type ApkArtworkCandidate = {
  entryPath: string
  extension: string
  width: number | null
  height: number | null
  score: number
}

const DEFAULT_SETTINGS: AppSettings = {
  localLibraryPath: null,
  backupPath: null,
  gameSavesPath: null,
  gamesDisplayMode: 'gallery',
  inventoryDisplayMode: 'gallery'
}

const PATH_METADATA: Record<SettingsPathKey, { title: string; defaultPath: () => string }> = {
  localLibraryPath: {
    title: 'Choose Local Library Folder',
    defaultPath: () => app.getPath('downloads')
  },
  backupPath: {
    title: 'Choose Backup Folder',
    defaultPath: () => app.getPath('documents')
  },
  gameSavesPath: {
    title: 'Choose Game Saves Folder',
    defaultPath: () => app.getPath('documents')
  }
}

class SettingsService {
  private cachedSettings: AppSettings | null = null
  private localLibraryWatcher: FSWatcher | null = null
  private localLibraryWatchPath: string | null = null
  private localLibraryRescanTimeout: ReturnType<typeof setTimeout> | null = null
  private backupStorageWatcher: FSWatcher | null = null
  private backupStorageWatchPath: string | null = null
  private backupStorageRescanTimeout: ReturnType<typeof setTimeout> | null = null
  private apkMetadataParserUnavailable = false
  private pendingJsonRecoveryMessages = new Map<string, string>()
  private indexUpdateListeners = new Set<(update: SettingsIndexedPathUpdate) => void>()
  private pendingJsonWrites = new Map<string, Promise<void>>()

  private getSettingsPath(): string {
    return join(app.getPath('userData'), 'settings.json')
  }

  private getLocalLibraryIndexPath(): string {
    return join(app.getPath('userData'), 'local-library-index.json')
  }

  private getBackupStorageIndexPath(): string {
    return join(app.getPath('userData'), 'backup-storage-index.json')
  }

  private getManualMetadataAssetPath(): string {
    return join(app.getPath('userData'), 'manual-metadata-assets')
  }

  private isIgnorableFsRaceError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    )
  }

  private toLocalAssetUri(absolutePath: string): string {
    return `qam-asset://${encodeURIComponent(absolutePath)}`
  }

  private async pathStillExists(absolutePath: string): Promise<boolean> {
    try {
      await stat(absolutePath)
      return true
    } catch (error) {
      if (this.isIgnorableFsRaceError(error)) {
        return false
      }

      throw error
    }
  }

  private async getIndexedItemForSource(
    source: 'library' | 'backup',
    itemId: string
  ): Promise<{
    item: LocalLibraryIndexedItem | null
    sourcePath: string | null
  }> {
    if (source === 'library') {
      const currentSettings = await this.ensureSettingsLoaded()
      const sourcePath = currentSettings.localLibraryPath
      const item = await this.getIndexedLocalLibraryItem(itemId)
      return {
        item,
        sourcePath: sourcePath ? this.normalizePath(sourcePath) : null
      }
    }

    const { item, backupPath } = await this.getIndexedBackupStorageItem(itemId)
    return {
      item,
      sourcePath: backupPath
    }
  }

  private async listApkFilesRecursively(basePath: string): Promise<Array<{ absolutePath: string; sizeBytes: number }>> {
    const entries = await readdir(basePath, { withFileTypes: true })
    const results: Array<{ absolutePath: string; sizeBytes: number }> = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      const entryPath = join(basePath, entry.name)
      if (entry.isDirectory()) {
        const nested = await this.listApkFilesRecursively(entryPath)
        results.push(...nested)
        continue
      }

      if (extname(entry.name).toLowerCase() !== '.apk') {
        continue
      }

      try {
        const entryStats = await stat(entryPath)
        results.push({
          absolutePath: entryPath,
          sizeBytes: entryStats.size
        })
      } catch {
        // Ignore files that disappear during traversal.
      }
    }

    return results
  }

  private scoreApkCandidate(item: LocalLibraryIndexedItem, apkPath: string, sizeBytes: number): number {
    const fileName = basename(apkPath).toLowerCase()
    const relativeApkPath = relative(item.absolutePath, apkPath).toLowerCase()
    const primaryPackageId = item.packageIds[0]?.toLowerCase() ?? null

    let score = 0

    if (fileName === 'base.apk') {
      score += 200
    }

    if (primaryPackageId && fileName.includes(primaryPackageId)) {
      score += 160
    }

    if (!/split|config\./i.test(fileName)) {
      score += 80
    } else {
      score -= 120
    }

    if (relativeApkPath.includes(`${primaryPackageId ?? ''}.apk`)) {
      score += 60
    }

    score += Math.min(200, Math.floor(sizeBytes / (1024 * 1024)))

    return score
  }

  private async resolvePrimaryApkPath(item: LocalLibraryIndexedItem): Promise<string | null> {
    if (item.kind === 'apk') {
      return item.absolutePath
    }

    if (item.apkCount <= 0) {
      return null
    }

    try {
      const apkFiles = await this.listApkFilesRecursively(item.absolutePath)
      if (!apkFiles.length) {
        return null
      }

      const sorted = apkFiles.sort((left, right) => {
        const scoreDelta =
          this.scoreApkCandidate(item, right.absolutePath, right.sizeBytes) -
          this.scoreApkCandidate(item, left.absolutePath, left.sizeBytes)

        if (scoreDelta !== 0) {
          return scoreDelta
        }

        return right.sizeBytes - left.sizeBytes
      })

      return sorted[0]?.absolutePath ?? null
    } catch {
      return null
    }
  }

  private async listApkEntries(apkPath: string): Promise<ZipEntry[]> {
    return new Promise((resolve, reject) => {
      Zip.open(apkPath, { lazyEntries: true }, (error: Error | null, zipfile: any) => {
        if (error || !zipfile) {
          reject(error ?? new Error('Unable to open APK archive.'))
          return
        }

        const entries: ZipEntry[] = []

        zipfile.on('entry', (entry: any) => {
          entries.push({
            fileName: entry.fileName
          })
          zipfile.readEntry()
        })

        zipfile.on('end', () => {
          zipfile.close()
          resolve(entries)
        })

        zipfile.on('error', (zipError: Error) => {
          zipfile.close()
          reject(zipError)
        })

        zipfile.readEntry()
      })
    })
  }

  private parsePngDimensions(buffer: Buffer): { width: number; height: number } | null {
    if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
      return null
    }

    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    }
  }

  private parseJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return null
    }

    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }

      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)

      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker) &&
        offset + 8 < buffer.length
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        }
      }

      if (length < 2) {
        break
      }

      offset += 2 + length
    }

    return null
  }

  private parseWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
    if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
      return null
    }

    const chunkType = buffer.toString('ascii', 12, 16)

    if (chunkType === 'VP8X' && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3)
      const height = 1 + buffer.readUIntLE(27, 3)
      return { width, height }
    }

    if (chunkType === 'VP8 ' && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      }
    }

    if (chunkType === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      }
    }

    return null
  }

  private getImageDimensions(buffer: Buffer, extension: string): { width: number; height: number } | null {
    const normalized = extension.toLowerCase()

    if (normalized === '.png') {
      return this.parsePngDimensions(buffer)
    }

    if (normalized === '.jpg' || normalized === '.jpeg') {
      return this.parseJpegDimensions(buffer)
    }

    if (normalized === '.webp') {
      return this.parseWebpDimensions(buffer)
    }

    return null
  }

  private scoreCoverCandidate(entryPath: string, dimensions: { width: number; height: number } | null): number {
    const normalizedPath = entryPath.toLowerCase()
    const fileName = basename(normalizedPath)
    let score = 0

    if (!normalizedPath.startsWith('res/') && !normalizedPath.startsWith('assets/')) {
      score -= 80
    }

    if (normalizedPath.includes('/mipmap')) {
      score += 220
    }

    if (normalizedPath.includes('/drawable')) {
      score += 120
    }

    if (/(app_?icon|ic_?launcher|launcher|roundicon|round_?icon|icon)/i.test(fileName)) {
      score += 260
    }

    if (/(foreground|background|monochrome|notification|common_google|googleg|abc_|btn_|splash|unity_static)/i.test(fileName)) {
      score -= 260
    }

    if (dimensions) {
      const ratio = dimensions.width / Math.max(1, dimensions.height)
      const squareDelta = Math.abs(ratio - 1)
      score += Math.max(0, 120 - Math.round(squareDelta * 220))
      score += Math.min(180, Math.round((dimensions.width + dimensions.height) / 6))
    }

    return score
  }

  private scoreHeroCandidate(entryPath: string, dimensions: { width: number; height: number } | null): number {
    const normalizedPath = entryPath.toLowerCase()
    const fileName = basename(normalizedPath)
    let score = 0

    if (!normalizedPath.startsWith('res/') && !normalizedPath.startsWith('assets/')) {
      score -= 80
    }

    if (/(hero|banner|cover|landscape|feature|downloadimageh|header)/i.test(fileName)) {
      score += 320
    }

    if (/(icon|launcher|foreground|background|round|notification|common_google|googleg)/i.test(fileName)) {
      score -= 240
    }

    if (dimensions) {
      const ratio = dimensions.width / Math.max(1, dimensions.height)
      const landscapeBonus = Math.max(0, 180 - Math.round(Math.abs(ratio - 16 / 9) * 160))
      score += landscapeBonus

      if (dimensions.width >= 1000) {
        score += 140
      } else if (dimensions.width >= 600) {
        score += 80
      }

      if (dimensions.width <= dimensions.height) {
        score -= 160
      }
    }

    return score
  }

  private async pickApkArtworkCandidate(
    apkPath: string,
    target: 'hero' | 'cover'
  ): Promise<ApkArtworkCandidate | null> {
    const entries = await this.listApkEntries(apkPath)
    const supportedEntries = entries.filter((entry) => {
      const extension = extname(entry.fileName).toLowerCase()
      return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension)
    })

    const candidates: ApkArtworkCandidate[] = []

    const reader = await ApkReader.open(apkPath)
    for (const entry of supportedEntries) {
      try {
        const content = await reader.readContent(entry.fileName)
        const extension = extname(entry.fileName).toLowerCase()
        const dimensions = this.getImageDimensions(content, extension)
        const score =
          target === 'cover'
            ? this.scoreCoverCandidate(entry.fileName, dimensions)
            : this.scoreHeroCandidate(entry.fileName, dimensions)

        if (score <= 0) {
          continue
        }

        candidates.push({
          entryPath: entry.fileName,
          extension,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
          score
        })
      } catch {
        // Ignore unreadable or malformed files and continue scoring the rest.
      }
    }

    const filtered = candidates.filter((candidate) => {
      if (target === 'hero') {
        return (candidate.width ?? 0) >= 480 || /hero|banner|cover|downloadimageh/i.test(candidate.entryPath)
      }

      return true
    })

    const sorted = filtered.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const rightArea = (right.width ?? 0) * (right.height ?? 0)
      const leftArea = (left.width ?? 0) * (left.height ?? 0)
      return rightArea - leftArea
    })

    return sorted[0] ?? null
  }

  private async persistApkArtworkAsset(
    apkPath: string,
    entryPath: string,
    item: LocalLibraryIndexedItem,
    target: 'hero' | 'cover'
  ): Promise<string> {
    const reader = await ApkReader.open(apkPath)
    const content = await reader.readContent(entryPath)
    const extension = extname(entryPath).toLowerCase() || '.img'
    const fileName = `apk-${target}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${basename(
      item.name,
      extname(item.name)
    )
      .replace(/[^a-z0-9._-]+/gi, '.')
      .slice(0, 48)}${extension}`
    const assetDirectory = this.getManualMetadataAssetPath()
    const targetPath = join(assetDirectory, fileName)

    await mkdir(assetDirectory, { recursive: true })
    await writeFile(targetPath, content)

    return this.toLocalAssetUri(targetPath)
  }

  private createEmptyLibraryIndex(path: string | null, message: string): LocalLibraryScanResponse {
    return {
      path,
      itemCount: 0,
      newCount: 0,
      missingCount: 0,
      totalBytes: 0,
      scannedAt: null,
      message,
      items: []
    }
  }

  private async saveLocalLibraryIndex(
    index: LocalLibraryScanResponse,
    trigger: SettingsIndexedPathUpdate['trigger'] = 'manual'
  ): Promise<LocalLibraryScanResponse> {
    const previousIndex = await this.readStoredLocalLibraryIndex()
    const indexPath = this.getLocalLibraryIndexPath()
    await this.writeJsonFile(indexPath, index)
    await metaStoreService.primeFromLocalLibraryIndex(index)
    this.notifyIndexUpdated({
      source: 'library',
      trigger,
      index,
      changedItemIds: this.collectChangedIndexedItemIds(previousIndex, index)
    })
    return index
  }

  private async saveBackupStorageIndex(
    index: LocalLibraryScanResponse,
    trigger: SettingsIndexedPathUpdate['trigger'] = 'manual'
  ): Promise<LocalLibraryScanResponse> {
    const previousIndex = await this.readStoredBackupStorageIndex()
    const indexPath = this.getBackupStorageIndexPath()
    await this.writeJsonFile(indexPath, index)
    await metaStoreService.primeFromLocalLibraryIndex(index)
    this.notifyIndexUpdated({
      source: 'backup',
      trigger,
      index,
      changedItemIds: this.collectChangedIndexedItemIds(previousIndex, index)
    })
    return index
  }

  onIndexUpdated(listener: (update: SettingsIndexedPathUpdate) => void): () => void {
    this.indexUpdateListeners.add(listener)
    return () => {
      this.indexUpdateListeners.delete(listener)
    }
  }

  private notifyIndexUpdated(update: SettingsIndexedPathUpdate): void {
    for (const listener of this.indexUpdateListeners) {
      listener(update)
    }
  }

  private collectChangedIndexedItemIds(
    previousIndex: LocalLibraryScanResponse | null,
    nextIndex: LocalLibraryScanResponse
  ): string[] {
    const previousItems = previousIndex?.items ?? []
    const previousItemsById = new Map(previousItems.map((item) => [item.id, item]))
    const nextItemsById = new Map(nextIndex.items.map((item) => [item.id, item]))
    const changedIds = new Set<string>()

    for (const item of nextIndex.items) {
      const previousItem = previousItemsById.get(item.id)
      if (!previousItem || !this.areIndexedItemsEquivalent(previousItem, item)) {
        changedIds.add(item.id)
      }
    }

    for (const item of previousItems) {
      if (!nextItemsById.has(item.id)) {
        changedIds.add(item.id)
      }
    }

    return Array.from(changedIds)
  }

  private areIndexedItemsEquivalent(left: LocalLibraryIndexedItem, right: LocalLibraryIndexedItem): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  private shouldClearMissingEntryAfterPurge(
    targetItem: LocalLibraryIndexedItem,
    candidateItem: LocalLibraryIndexedItem
  ): boolean {
    if (candidateItem.availability !== 'missing') {
      return false
    }

    if (candidateItem.id === targetItem.id) {
      return true
    }

    if (candidateItem.absolutePath === targetItem.absolutePath || candidateItem.relativePath === targetItem.relativePath) {
      return true
    }

    const targetPackageIds = new Set(targetItem.packageIds.map((packageId) => packageId.trim()).filter(Boolean))
    if (!targetPackageIds.size) {
      return false
    }

    return candidateItem.packageIds.some((packageId) => targetPackageIds.has(packageId.trim()))
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

  private extractLeadingJsonDocument(contents: string): string | null {
    const trimmed = contents.trimStart()

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return null
    }

    let depth = 0
    let inString = false
    let escaping = false

    for (let index = 0; index < trimmed.length; index += 1) {
      const character = trimmed[index]

      if (inString) {
        if (escaping) {
          escaping = false
          continue
        }

        if (character === '\\') {
          escaping = true
          continue
        }

        if (character === '"') {
          inString = false
        }

        continue
      }

      if (character === '"') {
        inString = true
        continue
      }

      if (character === '{' || character === '[') {
        depth += 1
        continue
      }

      if (character === '}' || character === ']') {
        depth -= 1

        if (depth === 0) {
          return trimmed.slice(0, index + 1)
        }
      }
    }

    return null
  }

  private consumeJsonRecoveryMessage(targetPath: string): string | null {
    const message = this.pendingJsonRecoveryMessages.get(targetPath) ?? null

    if (message) {
      this.pendingJsonRecoveryMessages.delete(targetPath)
    }

    return message
  }

  private prependJsonRecoveryMessage(targetPath: string, message: string): string {
    const recoveryMessage = this.consumeJsonRecoveryMessage(targetPath)
    return recoveryMessage ? `${recoveryMessage} ${message}` : message
  }

  private async readJsonFileWithRecovery<T>(targetPath: string, recoveryMessage: string): Promise<T | null> {
    try {
      const contents = await readFile(targetPath, 'utf8')

      try {
        return JSON.parse(contents) as T
      } catch {
        const recoveredDocument = this.extractLeadingJsonDocument(contents)

        if (!recoveredDocument) {
          return null
        }

        const parsed = JSON.parse(recoveredDocument) as T
        await this.writeJsonFile(targetPath, parsed)
        this.pendingJsonRecoveryMessages.set(targetPath, recoveryMessage)
        return parsed
      }
    } catch {
      return null
    }
  }

  private isWithinBasePath(basePath: string, targetPath: string): boolean {
    const relativePath = relative(basePath, targetPath)

    return relativePath === '' || (!relativePath.startsWith('..') && relativePath !== '.' && !relativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`))
  }

  private async readStoredLocalLibraryIndex(): Promise<LocalLibraryScanResponse | null> {
    const indexPath = this.getLocalLibraryIndexPath()
    return this.readJsonFileWithRecovery<LocalLibraryScanResponse>(
      indexPath,
      'Recovered a corrupted local library cache.'
    )
  }

  private async readStoredBackupStorageIndex(): Promise<LocalLibraryScanResponse | null> {
    const indexPath = this.getBackupStorageIndexPath()
    return this.readJsonFileWithRecovery<LocalLibraryScanResponse>(
      indexPath,
      'Recovered a corrupted backup storage cache.'
    )
  }

  private async getIndexedBackupStorageItem(itemId: string): Promise<{
    item: LocalLibraryIndexedItem | null
    backupPath: string | null
    storedIndex: LocalLibraryScanResponse | null
  }> {
    const currentSettings = await this.ensureSettingsLoaded()
    const backupPath = currentSettings.backupPath
    const storedIndex = await this.readStoredBackupStorageIndex()

    if (!storedIndex || !backupPath || storedIndex.path !== this.normalizePath(backupPath)) {
      return {
        item: null,
        backupPath: backupPath ? this.normalizePath(backupPath) : null,
        storedIndex
      }
    }

    const item = storedIndex.items.find((entry) => entry.id === itemId) ?? null
    if (!item || !this.isWithinBasePath(this.normalizePath(backupPath), item.absolutePath)) {
      return {
        item: null,
        backupPath: this.normalizePath(backupPath),
        storedIndex
      }
    }

    return {
      item,
      backupPath: this.normalizePath(backupPath),
      storedIndex
    }
  }

  private classifyFileKind(absolutePath: string): LocalLibraryItemKind {
    const extension = extname(absolutePath).toLowerCase()

    if (extension === '.apk') {
      return 'apk'
    }

    if (extension === '.obb') {
      return 'obb'
    }

    if (['.zip', '.7z', '.rar'].includes(extension)) {
      return 'archive'
    }

    return 'file'
  }

  private buildFileNote(kind: LocalLibraryItemKind): string {
    if (kind === 'apk') {
      return 'Standalone APK payload.'
    }

    if (kind === 'obb') {
      return 'Expansion or support data file.'
    }

    if (kind === 'archive') {
      return 'Archived payload bundle.'
    }

    return 'Visible library file.'
  }

  private shouldIndexDirectoryEntryName(kind: LocalLibraryItemKind): boolean {
    return kind === 'apk' || kind === 'obb' || kind === 'archive'
  }

  private formatDirectoryNote(summary: {
    childCount: number
    apkCount: number
    obbCount: number
    archiveCount: number
  }): string {
    const parts: string[] = []

    if (summary.apkCount) {
      parts.push(summary.apkCount === 1 ? '1 APK' : `${summary.apkCount} APKs`)
    }

    if (summary.obbCount) {
      parts.push(summary.obbCount === 1 ? '1 OBB' : `${summary.obbCount} OBB files`)
    }

    if (summary.archiveCount) {
      parts.push(summary.archiveCount === 1 ? '1 archive' : `${summary.archiveCount} archives`)
    }

    if (!parts.length) {
      return summary.childCount === 1 ? 'Contains 1 visible item.' : `Contains ${summary.childCount} visible items.`
    }

    return `Contains ${parts.join(', ')}.`
  }

  private async readApkMetadata(absolutePath: string): Promise<ApkMetadata> {
    if (this.apkMetadataParserUnavailable) {
      return {
        packageId: null,
        version: null,
        versionCode: null
      }
    }

    try {
      const reader = await ApkReader.open(absolutePath)
      const manifest = await reader.readManifest()

      return {
        packageId: typeof manifest.package === 'string' ? manifest.package : null,
        version:
          manifest.versionName !== undefined && manifest.versionName !== null
            ? String(manifest.versionName)
            : null,
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
        packageId: null,
        version: null,
        versionCode: null
      }
    }
  }

  private async summarizeDirectory(absolutePath: string): Promise<{
    sizeBytes: number
    childCount: number
    apkCount: number
    obbCount: number
    archiveCount: number
    primaryApkName: string | null
    primaryApkVersion: string | null
    primaryApkVersionCode: string | null
    searchTerms: string[]
    packageIds: string[]
  }> {
    let sizeBytes = 0
    let childCount = 0
    let apkCount = 0
    let obbCount = 0
    let archiveCount = 0
    let primaryApkName: string | null = null
    let primaryApkVersion: string | null = null
    let primaryApkVersionCode: string | null = null
    let primaryApkScore = Number.NEGATIVE_INFINITY
    const searchTerms = new Set<string>()
    const packageIds = new Set<string>()
    const folderTokens = basename(absolutePath)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 3)

    const considerPrimaryApkCandidate = (
      candidateName: string | null,
      candidateVersion: string | null,
      candidateVersionCode: string | null,
      candidatePackageId: string | null,
      candidateSizeBytes: number
    ) => {
      if (!candidateName) {
        return
      }

      const fileName = candidateName.toLowerCase()
      let score = 0

      if (fileName === 'base.apk') {
        score += 260
      }

      if (candidatePackageId && fileName.includes(candidatePackageId.toLowerCase())) {
        score += 240
      }

      if (!/split|config\./i.test(fileName)) {
        score += 80
      } else {
        score -= 140
      }

      if (fileName.includes('shortcut')) {
        score -= 180
      }

      const matchedFolderTokens = folderTokens.filter((token) => fileName.includes(token)).length
      score += matchedFolderTokens * 35
      score += Math.min(160, Math.floor(candidateSizeBytes / (1024 * 1024)))

      if (candidateVersionCode?.trim()) {
        score += 20
      }

      if (score > primaryApkScore) {
        primaryApkScore = score
        primaryApkName = candidateName
        primaryApkVersion = candidateVersion
        primaryApkVersionCode = candidateVersionCode
      }
    }

    const entries = await readdir(absolutePath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      const entryPath = join(absolutePath, entry.name)
      let entryStats

      try {
        entryStats = await stat(entryPath)
      } catch (error) {
        if (this.isIgnorableFsRaceError(error)) {
          continue
        }

        throw error
      }
      const inferredPackageId = this.inferPackageIdFromFileName(entry.name)
      if (inferredPackageId) {
        packageIds.add(inferredPackageId)
        searchTerms.add(inferredPackageId)
      }

      if (entry.isFile() && entry.name.toLowerCase() === 'install.txt') {
        const installScriptHints = await this.readInstallScriptHints(entryPath)
        installScriptHints.searchTerms.forEach((term) => searchTerms.add(term))
        installScriptHints.packageIds.forEach((packageId) => packageIds.add(packageId))
      }

      childCount += 1

      if (entry.isDirectory()) {
        const nested = await this.summarizeDirectory(entryPath)
        sizeBytes += nested.sizeBytes
        childCount += nested.childCount
        apkCount += nested.apkCount
        obbCount += nested.obbCount
        archiveCount += nested.archiveCount
        nested.searchTerms.forEach((term) => searchTerms.add(term))
        nested.packageIds.forEach((packageId) => packageIds.add(packageId))
        considerPrimaryApkCandidate(
          nested.primaryApkName,
          nested.primaryApkVersion,
          nested.primaryApkVersionCode,
          nested.packageIds[0] ?? null,
          nested.sizeBytes
        )
        continue
      }

      sizeBytes += entryStats.size

      const kind = this.classifyFileKind(entryPath)
      if (this.shouldIndexDirectoryEntryName(kind)) {
        searchTerms.add(entry.name)
      }

      if (kind === 'apk') {
        const apkMetadata = await this.readApkMetadata(entryPath)
        apkCount += 1
        if (apkMetadata.packageId) {
          packageIds.add(apkMetadata.packageId)
          searchTerms.add(apkMetadata.packageId)
        }

        if (apkMetadata.version) {
          searchTerms.add(apkMetadata.version)
        }

        considerPrimaryApkCandidate(
          entry.name,
          apkMetadata.version,
          apkMetadata.versionCode,
          apkMetadata.packageId,
          entryStats.size
        )
      } else if (kind === 'obb') {
        obbCount += 1
      } else if (kind === 'archive') {
        archiveCount += 1
      }
    }

    return {
      sizeBytes,
      childCount,
      apkCount,
      obbCount,
      archiveCount,
      primaryApkName,
      primaryApkVersion,
      primaryApkVersionCode,
      searchTerms: [...searchTerms],
      packageIds: [...packageIds]
    }
  }

  private async readInstallScriptHints(absolutePath: string): Promise<{
    searchTerms: string[]
    packageIds: string[]
  }> {
    try {
      const script = await readFile(absolutePath, 'utf8')
      const packageIds = Array.from(this.parsePackageIdsFromText(script))
      return {
        searchTerms: packageIds,
        packageIds
      }
    } catch {
      return {
        searchTerms: [],
        packageIds: []
      }
    }
  }

  private async buildIndexedItem(basePath: string, absolutePath: string): Promise<LocalLibraryIndexedItem | null> {
    let itemStats

    try {
      itemStats = await stat(absolutePath)
    } catch (error) {
      if (this.isIgnorableFsRaceError(error)) {
        return null
      }

      throw error
    }
    const fallbackName = basename(absolutePath)
    const relativePath = relative(basePath, absolutePath) || fallbackName

    if (itemStats.isDirectory()) {
      const summary = await this.summarizeDirectory(absolutePath)
      const name = fallbackName
      return {
        id: relativePath,
        name,
        relativePath,
        absolutePath,
        searchTerms: [name, fallbackName, relativePath, ...summary.searchTerms],
        packageIds: summary.packageIds,
        kind: 'folder',
        availability: 'present',
        discoveryState: 'new',
        installReady: summary.apkCount > 0,
        sizeBytes: summary.sizeBytes,
        modifiedAt: itemStats.mtime.toISOString(),
        childCount: summary.childCount,
        apkCount: summary.apkCount,
        obbCount: summary.obbCount,
        archiveCount: summary.archiveCount,
        libraryVersion: summary.primaryApkVersion,
        libraryVersionCode: summary.primaryApkVersionCode,
        note: this.formatDirectoryNote(summary),
        manualStoreId: null,
        manualStoreIdEdited: false,
        manualMetadata: null
      }
    }

    const name = fallbackName
    const kind = this.classifyFileKind(absolutePath)
    const apkMetadata = kind === 'apk' ? await this.readApkMetadata(absolutePath) : null
    const packageId = apkMetadata?.packageId ?? this.inferPackageIdFromFileName(name)
    return {
      id: relativePath,
      name,
      relativePath,
      absolutePath,
      searchTerms: [name, relativePath, apkMetadata?.version ?? '', packageId ?? ''].filter(Boolean),
      packageIds: packageId ? [packageId] : [],
      kind,
      availability: 'present',
      discoveryState: 'new',
      installReady: kind === 'apk',
      sizeBytes: itemStats.size,
      modifiedAt: itemStats.mtime.toISOString(),
      childCount: 0,
      apkCount: kind === 'apk' ? 1 : 0,
      obbCount: kind === 'obb' ? 1 : 0,
      archiveCount: kind === 'archive' ? 1 : 0,
      libraryVersion: apkMetadata?.version ?? null,
      libraryVersionCode: apkMetadata?.versionCode ?? null,
      note: this.buildFileNote(kind),
      manualStoreId: null,
      manualStoreIdEdited: false,
      manualMetadata: null
    }
  }

  private hasIndexedItemChanged(currentItem: LocalLibraryIndexedItem, previousItem: LocalLibraryIndexedItem | undefined): boolean {
    if (!previousItem || previousItem.availability !== 'present') {
      return false
    }

    const currentPackageIds = [...currentItem.packageIds].sort()
    const previousPackageIds = [...previousItem.packageIds].sort()

    if (currentPackageIds.length !== previousPackageIds.length) {
      return true
    }

    if (currentPackageIds.some((packageId, index) => packageId !== previousPackageIds[index])) {
      return true
    }

    return (
      currentItem.name !== previousItem.name ||
      currentItem.kind !== previousItem.kind ||
      currentItem.installReady !== previousItem.installReady ||
      currentItem.sizeBytes !== previousItem.sizeBytes ||
      currentItem.modifiedAt !== previousItem.modifiedAt ||
      currentItem.apkCount !== previousItem.apkCount ||
      currentItem.obbCount !== previousItem.obbCount ||
      currentItem.archiveCount !== previousItem.archiveCount ||
      currentItem.libraryVersion !== previousItem.libraryVersion ||
      currentItem.libraryVersionCode !== previousItem.libraryVersionCode ||
      currentItem.note !== previousItem.note
    )
  }

  private async buildIndexedPathIndex(
    basePath: string,
    previousItems: LocalLibraryIndexedItem[],
    options?: {
      excludeEntryNames?: string[]
      excludeAbsolutePaths?: string[]
    }
  ): Promise<LocalLibraryScanResponse> {
    const entries = await readdir(basePath, { withFileTypes: true })
    const excludedNames = new Set((options?.excludeEntryNames ?? []).map((value) => value.toLowerCase()))
    const excludedPaths = new Set(
      (options?.excludeAbsolutePaths ?? []).map((value) => this.normalizePath(value).toLowerCase())
    )
    const visibleEntries = entries.filter((entry) => {
      if (entry.name.startsWith('.')) {
        return false
      }

      if (excludedNames.has(entry.name.toLowerCase())) {
        return false
      }

      if (!excludedPaths.size) {
        return true
      }

      const entryPath = this.normalizePath(join(basePath, entry.name)).toLowerCase()
      return !excludedPaths.has(entryPath)
    })
    const itemResults = await Promise.all(visibleEntries.map((entry) => this.buildIndexedItem(basePath, join(basePath, entry.name))))
    const items = itemResults.filter((item): item is LocalLibraryIndexedItem => item !== null)
    const existingFlags = await Promise.all(items.map((item) => this.pathStillExists(item.absolutePath)))
    const stableItems = items.filter((_, index) => existingFlags[index])
    const previousItemMap = new Map(previousItems.map((item) => [item.id, item]))
    const currentItems = stableItems.map((item) => {
      const previousItem = previousItemMap.get(item.id)
      const discoveryState =
        previousItem && previousItem.availability === 'present'
          ? this.hasIndexedItemChanged(item, previousItem)
            ? ('changed' as const)
            : ('existing' as const)
          : ('new' as const)

      return {
        ...item,
        discoveryState,
        manualStoreId: previousItem?.manualStoreId ?? null,
        manualStoreIdEdited: previousItem?.manualStoreIdEdited ?? false,
        manualMetadata: previousItem?.manualMetadata ?? null
      }
    })
    const currentIds = new Set(currentItems.map((item) => item.id))
    const missingItems = previousItems
      .filter((item) => !currentIds.has(item.id))
      .map((item) => {
        const normalizedNote = item.note.replace(/^(Missing on disk\.\s*)+/i, '').trim()

        return {
          ...item,
          availability: 'missing' as const,
          discoveryState: 'missing' as const,
          note: normalizedNote ? `Missing on disk. ${normalizedNote}` : 'Missing on disk.'
        }
      })
    const allItems = [...currentItems, ...missingItems]
    const sortedItems = allItems.sort((left, right) => {
      if (left.availability !== right.availability) {
        return left.availability === 'present' ? -1 : 1
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    })
    const totalBytes = currentItems.reduce((sum, item) => sum + item.sizeBytes, 0)
    const installReadyCount = currentItems.filter((item) => item.installReady).length
    const archivedCount = currentItems.filter((item) => item.kind === 'archive').length
    const newCount = currentItems.filter((item) => item.discoveryState === 'new').length
    const changedCount = currentItems.filter((item) => item.discoveryState === 'changed').length
    const missingCount = missingItems.length

    return {
      path: basePath,
      itemCount: currentItems.length,
      newCount,
      missingCount,
      totalBytes,
      scannedAt: new Date().toISOString(),
      message:
        currentItems.length === 0 && missingCount === 0
          ? 'Library scan found no visible items.'
          : `Library scan indexed ${currentItems.length} current entries, with ${newCount} new, ${changedCount} changed, ${installReadyCount} install-ready items, ${archivedCount} archives, and ${missingCount} missing entries.`,
      items: sortedItems
    }
  }

  private async buildLocalLibraryIndex(
    libraryPath: string,
    previousItems: LocalLibraryIndexedItem[]
  ): Promise<LocalLibraryScanResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const excludedPaths = [currentSettings.backupPath, currentSettings.gameSavesPath].filter(
      (value): value is string => Boolean(value)
    )

    return this.buildIndexedPathIndex(libraryPath, previousItems, {
      excludeEntryNames: ['SaveBackups'],
      excludeAbsolutePaths: excludedPaths
    })
  }

  private hasIndexedVersionMetadata(index: LocalLibraryScanResponse | null): boolean {
    if (!index) {
      return false
    }

    const hasVersionFields = index.items.every(
      (item) =>
        Object.prototype.hasOwnProperty.call(item, 'libraryVersion') &&
        Object.prototype.hasOwnProperty.call(item, 'libraryVersionCode')
    )

    if (!hasVersionFields) {
      return false
    }

    const apkBackedItems = index.items.filter((item) => item.kind === 'apk' || item.apkCount > 0)
    if (!apkBackedItems.length) {
      return true
    }

    return apkBackedItems.some((item) => item.libraryVersion !== null || item.libraryVersionCode !== null)
  }

  private normalizePath(value: string): string {
    return value.trim().replace(/[\\/]+$/, '')
  }

  private clearLocalLibraryWatch(): void {
    if (this.localLibraryRescanTimeout) {
      clearTimeout(this.localLibraryRescanTimeout)
      this.localLibraryRescanTimeout = null
    }

    if (this.localLibraryWatcher) {
      this.localLibraryWatcher.close()
      this.localLibraryWatcher = null
      this.localLibraryWatchPath = null
    }
  }

  private scheduleLocalLibraryRescan(): void {
    if (this.localLibraryRescanTimeout) {
      clearTimeout(this.localLibraryRescanTimeout)
    }

    this.localLibraryRescanTimeout = setTimeout(() => {
      this.localLibraryRescanTimeout = null
      void this.rescanLocalLibrary('watch').catch(() => {
        // Ignore watcher-triggered refresh failures until the next manual read.
      })
    }, 1200)
  }

  private async syncLocalLibraryWatcher(settings: AppSettings): Promise<void> {
    const libraryPath = settings.localLibraryPath ? this.normalizePath(settings.localLibraryPath) : null

    if (!libraryPath) {
      this.clearLocalLibraryWatch()
      return
    }

    try {
      const libraryStats = await stat(libraryPath)
      if (!libraryStats.isDirectory()) {
        this.clearLocalLibraryWatch()
        return
      }
    } catch {
      this.clearLocalLibraryWatch()
      return
    }

    if (this.localLibraryWatcher && this.localLibraryWatchPath === libraryPath) {
      return
    }

    this.clearLocalLibraryWatch()

    try {
      const supportsRecursiveWatch = process.platform === 'darwin' || process.platform === 'win32'
      this.localLibraryWatcher = watch(
        libraryPath,
        { recursive: supportsRecursiveWatch },
        () => {
          this.scheduleLocalLibraryRescan()
        }
      )
      this.localLibraryWatchPath = libraryPath
    } catch {
      this.localLibraryWatcher = watch(libraryPath, () => {
        this.scheduleLocalLibraryRescan()
      })
      this.localLibraryWatchPath = libraryPath
    }

    this.localLibraryWatcher.on('error', () => {
      this.clearLocalLibraryWatch()
    })
  }

  private clearBackupStorageWatch(): void {
    if (this.backupStorageRescanTimeout) {
      clearTimeout(this.backupStorageRescanTimeout)
      this.backupStorageRescanTimeout = null
    }

    if (this.backupStorageWatcher) {
      this.backupStorageWatcher.close()
      this.backupStorageWatcher = null
      this.backupStorageWatchPath = null
    }
  }

  private scheduleBackupStorageRescan(): void {
    if (this.backupStorageRescanTimeout) {
      clearTimeout(this.backupStorageRescanTimeout)
    }

    this.backupStorageRescanTimeout = setTimeout(() => {
      this.backupStorageRescanTimeout = null
      void this.rescanBackupStorage('watch').catch(() => {
        // Ignore watcher-triggered refresh failures until the next manual read.
      })
    }, 1200)
  }

  private async syncBackupStorageWatcher(settings: AppSettings): Promise<void> {
    const backupPath = settings.backupPath ? this.normalizePath(settings.backupPath) : null

    if (!backupPath) {
      this.clearBackupStorageWatch()
      return
    }

    try {
      const backupStats = await stat(backupPath)
      if (!backupStats.isDirectory()) {
        this.clearBackupStorageWatch()
        return
      }
    } catch {
      this.clearBackupStorageWatch()
      return
    }

    if (this.backupStorageWatcher && this.backupStorageWatchPath === backupPath) {
      return
    }

    this.clearBackupStorageWatch()

    try {
      const supportsRecursiveWatch = process.platform === 'darwin' || process.platform === 'win32'
      this.backupStorageWatcher = watch(
        backupPath,
        { recursive: supportsRecursiveWatch },
        () => {
          this.scheduleBackupStorageRescan()
        }
      )
      this.backupStorageWatchPath = backupPath
    } catch {
      this.backupStorageWatcher = watch(backupPath, () => {
        this.scheduleBackupStorageRescan()
      })
      this.backupStorageWatchPath = backupPath
    }

    this.backupStorageWatcher.on('error', () => {
      this.clearBackupStorageWatch()
    })
  }

  private inferPackageIdFromFileName(fileName: string): string | null {
    const obbMatch = fileName.match(/^(?:main|patch)\.\d+\.([^.]+\.[^.]+(?:\.[^.]+)+)\.obb$/i)
    if (obbMatch?.[1]) {
      return obbMatch[1]
    }

    const apkBaseName = fileName.replace(/\.(apk|xapk|apks)$/i, '')
    if (
      apkBaseName.includes('.') &&
      apkBaseName.split('.').length >= 3 &&
      /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/i.test(apkBaseName)
    ) {
      return apkBaseName
    }

    return null
  }

  private parsePackageIdsFromText(rawText: string): Set<string> {
    const packageIds = new Set<string>()
    const matches = rawText.match(/[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){2,}/g) ?? []

    for (const match of matches) {
      const normalized = match.trim()
      if (
        !normalized ||
        /\.(apk|apks|xapk|obb|txt|zip|rar|7z)$/i.test(normalized) ||
        normalized.toLowerCase().startsWith('http.')
      ) {
        continue
      }

      packageIds.add(normalized)
    }

    return packageIds
  }

  private async ensureSettingsLoaded(): Promise<AppSettings> {
    if (this.cachedSettings) {
      return this.cachedSettings
    }

    const settingsPath = this.getSettingsPath()

    try {
      const parsed = await this.readJsonFileWithRecovery<Partial<AppSettings>>(
        settingsPath,
        'Recovered a corrupted settings file.'
      )

      if (!parsed) {
        throw new Error('Settings file is unavailable.')
      }

      this.cachedSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed
      }
    } catch {
      this.cachedSettings = { ...DEFAULT_SETTINGS }
    }

    await Promise.all([
      this.syncLocalLibraryWatcher(this.cachedSettings),
      this.syncBackupStorageWatcher(this.cachedSettings)
    ])

    return this.cachedSettings
  }

  private async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const settingsPath = this.getSettingsPath()
    await this.writeJsonFile(settingsPath, settings)
    this.cachedSettings = settings
    await Promise.all([
      this.syncLocalLibraryWatcher(settings),
      this.syncBackupStorageWatcher(settings)
    ])
    return settings
  }

  async getSettings(): Promise<AppSettings> {
    return this.ensureSettingsLoaded()
  }

  async getLocalLibraryIndex(): Promise<LocalLibraryScanResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const libraryPath = currentSettings.localLibraryPath

    if (!libraryPath) {
      return this.createEmptyLibraryIndex(null, 'Choose a local library folder to build the index.')
    }

    try {
      const parsed = await this.readStoredLocalLibraryIndex()

      if (parsed?.path === libraryPath) {
        if (!this.hasIndexedVersionMetadata(parsed)) {
          return this.rescanLocalLibrary()
        }
        return {
          ...parsed,
          message: this.prependJsonRecoveryMessage(this.getLocalLibraryIndexPath(), parsed.message)
        }
      }
    } catch {
      // Ignore cache misses and fall back to an empty index state.
    }

    return this.createEmptyLibraryIndex(libraryPath, 'Scan the local library to build the index.')
  }

  async getIndexedLocalLibraryItem(itemId: string): Promise<LocalLibraryIndexedItem | null> {
    const currentSettings = await this.ensureSettingsLoaded()
    const libraryPath = currentSettings.localLibraryPath
    const storedIndex = await this.readStoredLocalLibraryIndex()

    if (!storedIndex || !libraryPath || storedIndex.path !== libraryPath) {
      return null
    }

    const item = storedIndex.items.find((entry) => entry.id === itemId) ?? null
    if (!item || !this.isWithinBasePath(libraryPath, item.absolutePath)) {
      return null
    }

    return item
  }

  async getBackupStorageIndex(): Promise<LocalLibraryScanResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const backupPath = currentSettings.backupPath

    if (!backupPath) {
      return this.createEmptyLibraryIndex(null, 'Choose a backup folder to build the backup storage index.')
    }

    try {
      const parsed = await this.readStoredBackupStorageIndex()

      if (parsed?.path === backupPath) {
        if (!this.hasIndexedVersionMetadata(parsed)) {
          return this.rescanBackupStorage()
        }
        return {
          ...parsed,
          message: this.prependJsonRecoveryMessage(this.getBackupStorageIndexPath(), parsed.message)
        }
      }
    } catch {
      // Ignore cache misses and build a fresh index below.
    }

    return this.rescanBackupStorage()
  }

  async removeMissingLocalLibraryItem(itemId: string): Promise<LocalLibraryRemoveMissingItemResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const libraryPath = currentSettings.localLibraryPath
    const storedIndex = await this.readStoredLocalLibraryIndex()

    if (!storedIndex || !libraryPath || storedIndex.path !== libraryPath) {
      const emptyIndex = this.createEmptyLibraryIndex(libraryPath, 'Scan the local library to build the index.')
      return {
        removed: false,
        itemId,
        index: emptyIndex,
        message: 'No matching library index is available yet.'
      }
    }

    const targetItem = storedIndex.items.find((item) => item.id === itemId)

    if (!targetItem || targetItem.availability !== 'missing') {
      return {
        removed: false,
        itemId,
        index: storedIndex,
        message: 'Only missing library entries can be removed.'
      }
    }

    const nextItems = storedIndex.items.filter((item) => item.id !== itemId)
    const nextMissingCount = nextItems.filter((item) => item.availability === 'missing').length
    const nextIndex: LocalLibraryScanResponse = {
      ...storedIndex,
      missingCount: nextMissingCount,
      message: this.prependJsonRecoveryMessage(
        this.getLocalLibraryIndexPath(),
        `Removed missing entry ${targetItem.name} from the library index.`
      ),
      items: nextItems
    }

    await this.saveLocalLibraryIndex(nextIndex)

    return {
      removed: true,
      itemId,
      index: nextIndex,
      message: nextIndex.message
    }
  }

  async setLocalLibraryItemManualStoreId(itemId: string, storeId: string): Promise<LocalLibraryManualStoreIdResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const libraryPath = currentSettings.localLibraryPath
    const storedIndex = await this.readStoredLocalLibraryIndex()
    const normalizedStoreId = storeId.trim()

    if (!storedIndex || !libraryPath || storedIndex.path !== libraryPath) {
      const emptyIndex = this.createEmptyLibraryIndex(libraryPath, 'Scan the local library to build the index.')
      return {
        updated: false,
        itemId,
        index: emptyIndex,
        message: 'No matching library index is available yet.'
      }
    }

    if (!normalizedStoreId) {
      return {
        updated: false,
        itemId,
        index: storedIndex,
        message: 'Enter a Meta store ID before saving.'
      }
    }

    const targetItem = storedIndex.items.find((item) => item.id === itemId)

    if (!targetItem) {
      return {
        updated: false,
        itemId,
        index: storedIndex,
        message: 'That library entry is no longer available in the current index.'
      }
    }

    const nextItems = storedIndex.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            manualStoreId: normalizedStoreId,
            manualStoreIdEdited: true
          }
        : item
    )

    const nextIndex: LocalLibraryScanResponse = {
      ...storedIndex,
      items: nextItems,
      message: `Saved manual store ID ${normalizedStoreId} for ${targetItem.name}.`
    }

    await this.saveLocalLibraryIndex(nextIndex)
    await metaStoreService.getDetails(normalizedStoreId)

    return {
      updated: true,
      itemId,
      index: nextIndex,
      message: nextIndex.message
    }
  }

  private normalizeManualMetadataOverride(
    metadata: ManualGameMetadataOverride
  ): ManualGameMetadataOverride | null {
    const normalize = (value: string | null | undefined): string | null => {
      const trimmed = value?.trim()
      return trimmed ? trimmed : null
    }

    const normalized: ManualGameMetadataOverride = {
      title: normalize(metadata.title),
      publisherName: normalize(metadata.publisherName),
      category: normalize(metadata.category),
      version: normalize(metadata.version),
      releaseDateLabel: normalize(metadata.releaseDateLabel),
      shortDescription: normalize(metadata.shortDescription),
      longDescription: normalize(metadata.longDescription),
      heroImageUri: normalize(metadata.heroImageUri),
      thumbnailUri: normalize(metadata.thumbnailUri)
    }

    return Object.values(normalized).some((value) => value !== null) ? normalized : null
  }

  async setIndexedItemManualMetadata(
    source: 'library' | 'backup',
    itemId: string,
    metadata: ManualGameMetadataOverride
  ): Promise<IndexedItemManualMetadataResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const normalizedMetadata = this.normalizeManualMetadataOverride(metadata)

    const isLibrarySource = source === 'library'
    const configuredPath = isLibrarySource ? currentSettings.localLibraryPath : currentSettings.backupPath
    const storedIndex = isLibrarySource
      ? await this.readStoredLocalLibraryIndex()
      : await this.readStoredBackupStorageIndex()

    if (!storedIndex || !configuredPath || storedIndex.path !== this.normalizePath(configuredPath)) {
      const emptyIndex = this.createEmptyLibraryIndex(configuredPath, `Scan the ${isLibrarySource ? 'local library' : 'backup storage'} to build the index.`)
      return {
        updated: false,
        source,
        itemId,
        index: emptyIndex,
        message: `No matching ${isLibrarySource ? 'library' : 'backup'} index is available yet.`
      }
    }

    const targetItem = storedIndex.items.find((item) => item.id === itemId)

    if (!targetItem) {
      return {
        updated: false,
        source,
        itemId,
        index: storedIndex,
        message: 'That indexed entry is no longer available in the current index.'
      }
    }

    const nextItems = storedIndex.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            manualMetadata: normalizedMetadata
          }
        : item
    )

    const nextIndex: LocalLibraryScanResponse = {
      ...storedIndex,
      items: nextItems,
      message: normalizedMetadata
        ? `Saved manual metadata for ${targetItem.name}.`
        : `Cleared manual metadata for ${targetItem.name}.`
    }

    if (isLibrarySource) {
      await this.saveLocalLibraryIndex(nextIndex)
    } else {
      await this.saveBackupStorageIndex(nextIndex)
    }

    return {
      updated: true,
      source,
      itemId,
      index: nextIndex,
      message: nextIndex.message
    }
  }

  async purgeLocalLibraryItem(itemId: string): Promise<LocalLibraryPurgeItemResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const libraryPath = currentSettings.localLibraryPath
    const storedIndex = await this.readStoredLocalLibraryIndex()

    if (!storedIndex || !libraryPath || storedIndex.path !== libraryPath) {
      const emptyIndex = this.createEmptyLibraryIndex(libraryPath, 'Scan the local library to build the index.')
      return {
        purged: false,
        itemId,
        index: emptyIndex,
        message: 'No matching library index is available yet.'
      }
    }

    const targetItem = storedIndex.items.find((item) => item.id === itemId)

    if (!targetItem || targetItem.availability !== 'present') {
      return {
        purged: false,
        itemId,
        index: storedIndex,
        message: 'Only present library entries can be purged.'
      }
    }

    if (!this.isWithinBasePath(libraryPath, targetItem.absolutePath)) {
      return {
        purged: false,
        itemId,
        index: storedIndex,
        message: 'Refusing to purge a path outside the selected library folder.'
      }
    }

    await rm(targetItem.absolutePath, { recursive: true, force: true })

    const clearedMissingItems = storedIndex.items.filter((item) => this.shouldClearMissingEntryAfterPurge(targetItem, item))
    const previousItems = storedIndex.items.filter(
      (item) => item.id !== itemId && !this.shouldClearMissingEntryAfterPurge(targetItem, item)
    )
    const nextIndex = await this.buildLocalLibraryIndex(libraryPath, previousItems)
    nextIndex.message = this.prependJsonRecoveryMessage(
      this.getLocalLibraryIndexPath(),
      clearedMissingItems.length
        ? `Purged ${targetItem.name} from the local library and cleared ${clearedMissingItems.length} matching missing entr${clearedMissingItems.length === 1 ? 'y' : 'ies'}.`
        : `Purged ${targetItem.name} from the local library.`
    )

    await this.saveLocalLibraryIndex(nextIndex)

    return {
      purged: true,
      itemId,
      index: nextIndex,
      message: nextIndex.message
    }
  }

  async choosePath(key: SettingsPathKey, browserWindow: BrowserWindow | null): Promise<SettingsSelectPathResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const metadata = PATH_METADATA[key]
    const options: OpenDialogOptions = {
      title: metadata.title,
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: currentSettings[key] ?? metadata.defaultPath(),
      buttonLabel: 'Use Folder'
    }
    const result = browserWindow ? await dialog.showOpenDialog(browserWindow, options) : await dialog.showOpenDialog(options)

    if (result.canceled || !result.filePaths.length) {
      return {
        canceled: true,
        settings: currentSettings
      }
    }

    const nextSettings = await this.saveSettings({
      ...currentSettings,
      [key]: result.filePaths[0]
    })

    return {
      canceled: false,
      settings: nextSettings
    }
  }

  async importManualMetadataImage(browserWindow: BrowserWindow | null): Promise<string | null> {
    const options: OpenDialogOptions = {
      title: 'Choose image for manual metadata override',
      properties: ['openFile'],
      buttonLabel: 'Use Image',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const targetWindow = browserWindow ?? BrowserWindow.getFocusedWindow() ?? null
    const result = targetWindow ? await dialog.showOpenDialog(targetWindow, options) : await dialog.showOpenDialog(options)

    if (result.canceled || !result.filePaths.length) {
      return null
    }

    const sourcePath = result.filePaths[0]
    const extension = extname(sourcePath).toLowerCase() || '.img'
    const fileName = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`
    const assetDirectory = this.getManualMetadataAssetPath()
    const targetPath = join(assetDirectory, fileName)

    await mkdir(assetDirectory, { recursive: true })
    await copyFile(sourcePath, targetPath)

    return this.toLocalAssetUri(targetPath)
  }

  async extractIndexedItemArtwork(
    source: 'library' | 'backup',
    itemId: string,
    target: 'hero' | 'cover'
  ): Promise<IndexedItemArtworkExtractionResponse> {
    const { item } = await this.getIndexedItemForSource(source, itemId)

    if (!item) {
      return {
        extracted: false,
        source,
        itemId,
        target,
        imageUri: null,
        message: 'That indexed item is no longer available.'
      }
    }

    const apkPath = await this.resolvePrimaryApkPath(item)
    if (!apkPath) {
      return {
        extracted: false,
        source,
        itemId,
        target,
        imageUri: null,
        message: `No APK payload is available to extract a ${target} image from.`
      }
    }

    try {
      const candidate = await this.pickApkArtworkCandidate(apkPath, target)

      if (!candidate) {
        return {
          extracted: false,
          source,
          itemId,
          target,
          imageUri: null,
          message:
            target === 'cover'
              ? 'No suitable cover image was found inside that APK.'
              : 'No suitable hero image was found inside that APK.'
        }
      }

      const imageUri = await this.persistApkArtworkAsset(apkPath, candidate.entryPath, item, target)

      return {
        extracted: true,
        source,
        itemId,
        target,
        imageUri,
        message:
          target === 'cover'
            ? `Extracted cover from ${basename(candidate.entryPath)}.`
            : `Extracted hero from ${basename(candidate.entryPath)}.`
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown extraction error.'
      return {
        extracted: false,
        source,
        itemId,
        target,
        imageUri: null,
        message: `Unable to extract ${target} artwork from that APK: ${details}`
      }
    }
  }

  async clearPath(key: SettingsPathKey): Promise<AppSettings> {
    const currentSettings = await this.ensureSettingsLoaded()
    const nextSettings = await this.saveSettings({
      ...currentSettings,
      [key]: null
    })

    if (key === 'localLibraryPath') {
      await this.saveLocalLibraryIndex(this.createEmptyLibraryIndex(null, 'Choose a local library folder to build the index.'))
    }

    if (key === 'backupPath') {
      await this.saveBackupStorageIndex(this.createEmptyLibraryIndex(null, 'Choose a backup folder to build the backup storage index.'))
    }

    return nextSettings
  }

  async setDisplayMode(key: SettingsDisplayModeKey, mode: ViewDisplayMode): Promise<AppSettings> {
    const currentSettings = await this.ensureSettingsLoaded()
    return this.saveSettings({
      ...currentSettings,
      [key]: mode
    })
  }

  async getPathStats(key: SettingsPathKey): Promise<SettingsPathStatsResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const configuredPath = currentSettings[key]

    if (!configuredPath) {
      return {
        key,
        path: null,
        exists: false,
        itemCount: 0,
        totalBytes: 0,
        message: 'No folder selected.'
      }
    }

    const normalizedPath = this.normalizePath(configuredPath)

    try {
      const targetStats = await stat(normalizedPath)

      if (!targetStats.isDirectory()) {
        return {
          key,
          path: normalizedPath,
          exists: false,
          itemCount: 0,
          totalBytes: 0,
          message: 'The selected path is not a folder.'
        }
      }

      const entries = await readdir(normalizedPath, { withFileTypes: true })
      const visibleEntries = entries.filter((entry) => !entry.name.startsWith('.'))

      let totalBytes = 0
      for (const entry of visibleEntries) {
        const entryPath = join(normalizedPath, entry.name)
        let entryStats

        try {
          entryStats = await stat(entryPath)
        } catch (error) {
          if (this.isIgnorableFsRaceError(error)) {
            continue
          }

          throw error
        }
        if (entry.isDirectory()) {
          const summary = await this.summarizeDirectory(entryPath)
          totalBytes += summary.sizeBytes
        } else {
          totalBytes += entryStats.size
        }
      }

      return {
        key,
        path: normalizedPath,
        exists: true,
        itemCount: visibleEntries.length,
        totalBytes,
        message: `${visibleEntries.length} visible entries.`
      }
    } catch {
      return {
        key,
        path: normalizedPath,
        exists: false,
        itemCount: 0,
        totalBytes: 0,
        message: 'Unable to read the selected folder.'
      }
    }
  }

  async rescanLocalLibrary(trigger: SettingsIndexedPathUpdate['trigger'] = 'manual'): Promise<LocalLibraryScanResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const libraryPath = currentSettings.localLibraryPath

    if (!libraryPath) {
      return this.createEmptyLibraryIndex(null, 'Choose a local library folder before rescanning.')
    }

    const libraryStats = await stat(libraryPath)
    if (!libraryStats.isDirectory()) {
      const emptyIndex = this.createEmptyLibraryIndex(libraryPath, 'The selected local library path is not a folder.')
      await this.saveLocalLibraryIndex(emptyIndex, trigger)
      return emptyIndex
    }

    const previousIndex = await this.readStoredLocalLibraryIndex()
    const previousItems =
      previousIndex?.path === libraryPath ? previousIndex.items : []
    const index = await this.buildLocalLibraryIndex(libraryPath, previousItems)
    index.message = this.prependJsonRecoveryMessage(this.getLocalLibraryIndexPath(), index.message)

    return this.saveLocalLibraryIndex(index, trigger)
  }

  async rescanBackupStorage(trigger: SettingsIndexedPathUpdate['trigger'] = 'manual'): Promise<LocalLibraryScanResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const backupPath = currentSettings.backupPath

    if (!backupPath) {
      return this.createEmptyLibraryIndex(null, 'Choose a backup folder before rescanning backup storage.')
    }

    const normalizedBackupPath = this.normalizePath(backupPath)
    const backupStats = await stat(normalizedBackupPath)

    if (!backupStats.isDirectory()) {
      const emptyIndex = this.createEmptyLibraryIndex(normalizedBackupPath, 'The selected backup path is not a folder.')
      await this.saveBackupStorageIndex(emptyIndex, trigger)
      return emptyIndex
    }

    const previousIndex = await this.readStoredBackupStorageIndex()
    const previousItems = previousIndex?.path === normalizedBackupPath ? previousIndex.items : []
    const index = await this.buildIndexedPathIndex(normalizedBackupPath, previousItems)
    index.message =
      index.itemCount === 0 && index.missingCount === 0
        ? 'Backup storage scan found no visible items.'
        : `Backup storage indexed ${index.itemCount} current entries, with ${index.newCount} new, ${index.items.filter((item) => item.availability === 'present' && item.installReady).length} install-ready items, ${index.items.filter((item) => item.availability === 'present' && item.kind === 'archive').length} archives, and ${index.missingCount} missing entries.`
    index.message = this.prependJsonRecoveryMessage(this.getBackupStorageIndexPath(), index.message)

    return this.saveBackupStorageIndex(index, trigger)
  }

  async deleteBackupStorageItem(itemId: string): Promise<BackupStorageDeleteItemResponse> {
    const { item, backupPath, storedIndex } = await this.getIndexedBackupStorageItem(itemId)

    if (!backupPath || !storedIndex) {
      const emptyIndex = this.createEmptyLibraryIndex(backupPath, 'Choose a backup folder to build the backup storage index.')
      return {
        deleted: false,
        itemId,
        backupIndex: emptyIndex,
        message: 'No matching backup storage index is available yet.'
      }
    }

    if (!item || item.availability !== 'present') {
      return {
        deleted: false,
        itemId,
        backupIndex: storedIndex,
        message: 'Only present backup entries can be deleted.'
      }
    }

    if (!this.isWithinBasePath(backupPath, item.absolutePath)) {
      return {
        deleted: false,
        itemId,
        backupIndex: storedIndex,
        message: 'Refusing to delete a path outside the selected backup folder.'
      }
    }

    await rm(item.absolutePath, { recursive: true, force: true })

    const nextBackupIndex = await this.rescanBackupStorage()
    nextBackupIndex.message = `Deleted backup ${item.name}.`
    await this.saveBackupStorageIndex(nextBackupIndex)

    return {
      deleted: true,
      itemId,
      backupIndex: nextBackupIndex,
      message: nextBackupIndex.message
    }
  }

  async moveBackupStorageItemToLibrary(itemId: string): Promise<BackupStorageMoveItemResponse> {
    const currentSettings = await this.ensureSettingsLoaded()
    const libraryPath = currentSettings.localLibraryPath ? this.normalizePath(currentSettings.localLibraryPath) : null
    const { item, backupPath, storedIndex } = await this.getIndexedBackupStorageItem(itemId)

    if (!backupPath || !storedIndex) {
      const emptyBackupIndex = this.createEmptyLibraryIndex(backupPath, 'Choose a backup folder to build the backup storage index.')
      const emptyLibraryIndex = this.createEmptyLibraryIndex(libraryPath, 'Choose a local library folder to build the index.')
      return {
        moved: false,
        itemId,
        backupIndex: emptyBackupIndex,
        libraryIndex: emptyLibraryIndex,
        message: 'No matching backup storage index is available yet.'
      }
    }

    if (!libraryPath) {
      return {
        moved: false,
        itemId,
        backupIndex: storedIndex,
        libraryIndex: this.createEmptyLibraryIndex(null, 'Choose a local library folder to build the index.'),
        message: 'Choose a local library folder before moving backup content into the library.'
      }
    }

    if (!item || item.availability !== 'present') {
      return {
        moved: false,
        itemId,
        backupIndex: storedIndex,
        libraryIndex: await this.getLocalLibraryIndex(),
        message: 'Only present backup entries can be moved into the library.'
      }
    }

    if (!this.isWithinBasePath(backupPath, item.absolutePath)) {
      return {
        moved: false,
        itemId,
        backupIndex: storedIndex,
        libraryIndex: await this.getLocalLibraryIndex(),
        message: 'Refusing to move a path outside the selected backup folder.'
      }
    }

    const destinationPath = join(libraryPath, basename(item.absolutePath))

    try {
      await stat(destinationPath)
      return {
        moved: false,
        itemId,
        backupIndex: storedIndex,
        libraryIndex: await this.getLocalLibraryIndex(),
        message: `A library item named ${basename(item.absolutePath)} already exists.`
      }
    } catch {
      // Destination does not exist yet, continue.
    }

    await rename(item.absolutePath, destinationPath)

    const [nextLibraryIndex, nextBackupIndex] = await Promise.all([
      this.rescanLocalLibrary(),
      this.rescanBackupStorage()
    ])

    const message = `Moved ${item.name} from backup storage into the local library.`
    nextLibraryIndex.message = message
    nextBackupIndex.message = message
    await Promise.all([this.saveLocalLibraryIndex(nextLibraryIndex), this.saveBackupStorageIndex(nextBackupIndex)])

    return {
      moved: true,
      itemId,
      backupIndex: nextBackupIndex,
      libraryIndex: nextLibraryIndex,
      message
    }
  }
}

export const settingsService = new SettingsService()
