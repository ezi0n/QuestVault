import { app } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, cp, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, relative } from 'node:path'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type {
  VrSrcCatalogItem,
  VrSrcCatalogResponse,
  VrSrcBrokenDownload,
  VrSrcClearBrokenDownloadResponse,
  VrSrcClearCacheResponse,
  VrSrcDownloadAndInstallResponse,
  VrSrcDownloadToLibraryResponse,
  VrSrcItemDetailsResponse,
  VrSrcInstallNowResponse,
  VrSrcStatusResponse,
  VrSrcSyncDelta,
  VrSrcSyncResponse,
  VrSrcTransferControlResponse,
  VrSrcTransferOperation,
  VrSrcTransferProgressUpdate
} from '@shared/types/ipc'
import { getHeaderLabel } from '@shared/utils/phraseBook'
import { parseVrSrcReleaseName } from '@shared/utils/vrsrcRelease'
import { settingsService } from './settingsService'
import { deviceService } from './deviceService'
import { dependencyService } from './dependencyService'

const execFileAsync = promisify(execFileCallback)

const VR_SRC_TELEGRAM_URL = 'https://t.me/s/the_vrSrc'
const VR_SRC_USER_AGENT = 'rclone/v1.72.1'
const DIRECT_EXTRACTION_SPACE_MARGIN_BYTES = 256 * 1024 * 1024

type VrSrcCredentials = {
  baseUri: string
  password: string
  lastResolvedAt: string
  sourcePublishedAt?: string
}

type VrSrcRemotePayloadFile = {
  fileName: string
  sizeBytes: number | null
}

type VrSrcReleasePayloadResult = {
  payloadPath: string
  libraryTargetPath: string | null
  extractedToLibraryTarget: boolean
}

type VrSrcPayloadValidationResult = {
  ok: boolean
  expectedCount: number
  completeCount: number
  partialFiles: string[]
  missingFiles: string[]
  sizeMismatches: Array<{ fileName: string; expectedBytes: number; actualBytes: number }>
}

type VrSrcTransferCommand = 'none' | 'pause' | 'cancel'
type VrSrcTransferLifecycle = 'running' | 'paused' | 'cancelled'
type VrSrcLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

type VrSrcLogger = {
  logPath: string
  debug: (message: string, details?: unknown) => Promise<void>
  info: (message: string, details?: unknown) => Promise<void>
  warn: (message: string, details?: unknown) => Promise<void>
  error: (message: string, details?: unknown) => Promise<void>
}

type VrSrcTransferControlState = {
  requestKey: string
  releaseName: string
  operation: VrSrcTransferOperation
  serial: string | null
  status: VrSrcTransferLifecycle
  command: VrSrcTransferCommand
  child: ChildProcess | null
  waiters: Array<() => void>
  lastUpdate: VrSrcTransferProgressUpdate | null
}

type VrSrcQueuedRequestState = 'queued' | 'paused' | 'running'

function isVrSrcInstallQueuedOperation(operation: VrSrcTransferOperation): boolean {
  return (
    operation === 'download-to-library' ||
    operation === 'install-now' ||
    operation === 'download-to-library-and-install'
  )
}

type VrSrcQueuedRequestRecord = {
  id: string
  releaseName: string
  operation: VrSrcTransferOperation
  serial: string | null
  requestedAt: string
  state: VrSrcQueuedRequestState
}

type VrSrcQueuedRequestRunner<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
  run: () => Promise<T>
}

class VrSrcTransferPausedError extends Error {
  constructor() {
    super('Transfer paused.')
  }
}

class VrSrcTransferCancelledError extends Error {
  constructor() {
    super('Transfer cancelled.')
  }
}

class VrSrcBrokenDownloadError extends Error {
  readonly details: string

  constructor(releaseName: string, validation: VrSrcPayloadValidationResult) {
    const issueCount = validation.partialFiles.length + validation.missingFiles.length + validation.sizeMismatches.length
    super(
      `Broken vrSrc release detected for ${releaseName}: ${issueCount} incomplete file${issueCount === 1 ? '' : 's'} found. QuestVault did not add it to the Local Library.`
    )
    this.details = VrSrcBrokenDownloadError.formatDetails(validation)
  }

  static formatDetails(validation: VrSrcPayloadValidationResult): string {
    const lines = [
      'Broken vrSrc release detected.',
      `Expected files: ${validation.expectedCount}`,
      `Complete files: ${validation.completeCount}`
    ]

    if (validation.partialFiles.length) {
      lines.push('Partial files:')
      for (const fileName of validation.partialFiles.slice(0, 12)) {
        lines.push(`- ${fileName}`)
      }
      if (validation.partialFiles.length > 12) {
        lines.push(`- ...and ${validation.partialFiles.length - 12} more`)
      }
    }

    if (validation.missingFiles.length) {
      lines.push('Missing files:')
      for (const fileName of validation.missingFiles.slice(0, 12)) {
        lines.push(`- ${fileName}`)
      }
      if (validation.missingFiles.length > 12) {
        lines.push(`- ...and ${validation.missingFiles.length - 12} more`)
      }
    }

    if (validation.sizeMismatches.length) {
      lines.push('Size mismatches:')
      for (const mismatch of validation.sizeMismatches.slice(0, 12)) {
        lines.push(`- ${mismatch.fileName}: expected ${mismatch.expectedBytes} bytes, found ${mismatch.actualBytes} bytes`)
      }
      if (validation.sizeMismatches.length > 12) {
        lines.push(`- ...and ${validation.sizeMismatches.length - 12} more`)
      }
    }

    return lines.join('\n')
  }
}

class VrSrcService {
  private syncInFlight: Promise<VrSrcSyncResponse> | null = null
  private acquireInFlight = new Map<string, Promise<VrSrcReleasePayloadResult>>()
  private queuedRequestRecords: VrSrcQueuedRequestRecord[] = []
  private queuedRequestRunners = new Map<string, VrSrcQueuedRequestRunner<any>>()
  private queuedRequestPromiseByReleaseName = new Map<string, Promise<unknown>>()
  private queuedRequestLoaded = false
  private queuedRequestLoadPromise: Promise<void> | null = null
  private queuedRequestWritePromise: Promise<void> | null = null
  private activeQueuedRequests = 0
  private activeInstallQueuedRequests = 0
  private drainQueuedRequestsScheduled = false
  private transferProgressListeners = new Set<(update: VrSrcTransferProgressUpdate) => void>()
  private trailerVideoIdCache = new Map<string, string | null>()
  private transferControls = new Map<string, VrSrcTransferControlState>()
  private readonly maxConcurrentPayloadDownloads = 3
  private readonly maxConcurrentQueuedRequests = 3
  private readonly maxConcurrentExtractionImports = 1
  private activePayloadDownloads = 0
  private activeExtractionImports = 0
  private payloadDownloadWaiters: Array<() => void> = []
  private extractionImportWaiters: Array<() => void> = []

  onTransferProgress(listener: (update: VrSrcTransferProgressUpdate) => void): () => void {
    this.transferProgressListeners.add(listener)
    return () => {
      this.transferProgressListeners.delete(listener)
    }
  }

  private emitTransferProgress(update: VrSrcTransferProgressUpdate): void {
    for (const listener of this.transferProgressListeners) {
      listener(update)
    }
  }

  private buildRequestKey(operation: VrSrcTransferOperation, releaseName: string, serial: string | null): string {
    return [operation.trim().toLowerCase(), releaseName.trim().toLowerCase(), (serial ?? '').trim().toLowerCase()].join('::')
  }

  private getTransferControlKey(operation: VrSrcTransferOperation, releaseName: string, serial: string | null): string {
    return this.buildRequestKey(operation, releaseName, serial)
  }

  private getOrCreateTransferControl(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null
  ): VrSrcTransferControlState {
    const key = this.getTransferControlKey(operation, releaseName, serial)
    const existing = this.transferControls.get(key)
    if (existing) {
      existing.operation = operation
      existing.serial = serial
      return existing
    }

    const control: VrSrcTransferControlState = {
      requestKey: key,
      releaseName,
      operation,
      serial,
      status: 'running',
      command: 'none',
      child: null,
      waiters: [],
      lastUpdate: null
    }
    this.transferControls.set(key, control)
    return control
  }

  private getTransferControl(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null
  ): VrSrcTransferControlState | null {
    return this.transferControls.get(this.getTransferControlKey(operation, releaseName, serial)) ?? null
  }

  private getQueuedRequestRecord(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null
  ): VrSrcQueuedRequestRecord | null {
    const key = this.getQueuedRequestKey(releaseName, operation, serial)
    return this.queuedRequestRecords.find(
      (entry) => this.getQueuedRequestKey(entry.releaseName, entry.operation, entry.serial) === key
    ) ?? null
  }

  private clearTransferControl(releaseName: string, operation: VrSrcTransferOperation, serial: string | null): void {
    this.transferControls.delete(this.getTransferControlKey(operation, releaseName, serial))
  }

  private buildTransferControlFlags(control: VrSrcTransferControlState, phase: VrSrcTransferProgressUpdate['phase']) {
    if (phase === 'paused' || control.status === 'paused') {
      return {
        canPause: false,
        canResume: true,
        canCancel: true
      }
    }

    if (phase === 'waiting-for-install' || phase === 'importing') {
      return {
        canPause: false,
        canResume: false,
        canCancel: true
      }
    }

    if (
      phase === 'queued' ||
      phase === 'waiting-for-download' ||
      phase === 'waiting-for-extraction' ||
      phase === 'preparing' ||
      phase === 'downloading' ||
      phase === 'extracting'
    ) {
      return {
        canPause: true,
        canResume: false,
        canCancel: true
      }
    }

    return {
      canPause: false,
      canResume: false,
      canCancel: false
    }
  }

  private emitControlledTransferProgress(
    control: VrSrcTransferControlState,
    update: Omit<VrSrcTransferProgressUpdate, 'serial' | 'canPause' | 'canResume' | 'canCancel'>
  ): void {
    const nextUpdate: VrSrcTransferProgressUpdate = {
      serial: control.serial,
      ...update,
      ...this.buildTransferControlFlags(control, update.phase)
    }
    control.lastUpdate = nextUpdate
    this.emitTransferProgress(nextUpdate)
  }

  private async waitForTransferResume(control: VrSrcTransferControlState): Promise<void> {
    while (control.status === 'paused') {
      await new Promise<void>((resolve) => {
        control.waiters.push(resolve)
      })
    }

    if (control.status === 'cancelled' || control.command === 'cancel') {
      throw new VrSrcTransferCancelledError()
    }
  }

  private async checkpointTransferControl(control: VrSrcTransferControlState): Promise<void> {
    if (control.command === 'cancel' || control.status === 'cancelled') {
      control.status = 'cancelled'
      throw new VrSrcTransferCancelledError()
    }

    if (control.command === 'pause' || control.status === 'paused') {
      control.command = 'none'
      control.status = 'paused'
      const lastUpdate = control.lastUpdate
      this.emitControlledTransferProgress(control, {
        operation: control.operation,
        releaseName: control.releaseName,
        phase: 'paused',
        progress: lastUpdate?.progress ?? 0,
        fileName: lastUpdate?.fileName ?? null,
        transferredBytes: lastUpdate?.transferredBytes ?? 0,
        totalBytes: lastUpdate?.totalBytes ?? null,
        speedBytesPerSecond: null,
        etaSeconds: null
      })
      await this.waitForTransferResume(control)
    }
  }

  private getQueuedRequestKey(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null
  ): string {
    return this.buildRequestKey(operation, releaseName, serial)
  }

  private getQueuedRequestsPath(): string {
    return join(this.getRootPath(), 'queued-vrsrc-downloads.json')
  }

  private async persistQueuedRequests(): Promise<void> {
    const payload = JSON.stringify({ requests: this.queuedRequestRecords }, null, 2)
    const write = async () => {
      await this.ensureDirectories()
      await writeFile(this.getQueuedRequestsPath(), payload, 'utf8')
    }

    this.queuedRequestWritePromise = (this.queuedRequestWritePromise ?? Promise.resolve())
      .then(write, write)
      .catch(() => undefined)

    await this.queuedRequestWritePromise
  }

  private async loadQueuedRequests(): Promise<void> {
    if (this.queuedRequestLoaded) {
      return
    }

    if (this.queuedRequestLoadPromise) {
      await this.queuedRequestLoadPromise
      return
    }

    this.queuedRequestLoadPromise = (async () => {
      await this.ensureDirectories()
      try {
        const raw = await readFile(this.getQueuedRequestsPath(), 'utf8')
        const parsed = JSON.parse(raw) as { requests?: VrSrcQueuedRequestRecord[] }
        const requests = Array.isArray(parsed.requests) ? parsed.requests : []
        this.queuedRequestRecords = requests
          .filter((entry): entry is VrSrcQueuedRequestRecord => Boolean(entry?.releaseName && entry?.operation))
          .map((entry) => ({
            id: entry.id ?? randomUUID(),
            releaseName: entry.releaseName,
            operation: entry.operation,
            serial: entry.serial ?? null,
            requestedAt: entry.requestedAt ?? new Date().toISOString(),
            state: 'queued'
          }))
      } catch {
        this.queuedRequestRecords = []
      }

      this.queuedRequestLoaded = true
      await this.persistQueuedRequests()
    })()

    try {
      await this.queuedRequestLoadPromise
    } finally {
      this.queuedRequestLoadPromise = null
    }
  }

  private buildQueuedRequestRunner<T>(
    record: VrSrcQueuedRequestRecord,
    run: () => Promise<T>
  ): VrSrcQueuedRequestRunner<T> {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })

    return {
      promise,
      resolve,
      reject,
      run
    }
  }

  private async registerQueuedRequest<T>(
    recordInput: Omit<VrSrcQueuedRequestRecord, 'id' | 'requestedAt' | 'state'>,
    run: () => Promise<T>,
    options?: { restore?: boolean }
  ): Promise<T> {
    await this.loadQueuedRequests()
    await this.resumeQueuedRequests()

    const key = this.getQueuedRequestKey(recordInput.releaseName, recordInput.operation, recordInput.serial)
    const existingRunner = this.queuedRequestRunners.get(key) as VrSrcQueuedRequestRunner<T> | undefined
    if (existingRunner) {
      return existingRunner.promise
    }

    const existingRecord = this.queuedRequestRecords.find(
      (entry) => this.getQueuedRequestKey(entry.releaseName, entry.operation, entry.serial) === key
    )
    if (existingRecord && !options?.restore) {
      const existing = this.queuedRequestRunners.get(key) as VrSrcQueuedRequestRunner<T> | undefined
      if (existing) {
        return existing.promise
      }
    }

    const record: VrSrcQueuedRequestRecord = {
      id: existingRecord?.id ?? randomUUID(),
      releaseName: recordInput.releaseName,
      operation: recordInput.operation,
      serial: recordInput.serial,
      requestedAt: existingRecord?.requestedAt ?? new Date().toISOString(),
      state: 'queued'
    }

    this.getOrCreateTransferControl(record.releaseName, record.operation, record.serial)

    if (existingRecord) {
      this.queuedRequestRecords = this.queuedRequestRecords.filter(
        (entry) => this.getQueuedRequestKey(entry.releaseName, entry.operation, entry.serial) !== key
      )
    }

    this.queuedRequestRecords.push(record)
    const runner = this.buildQueuedRequestRunner(record, run)
    this.queuedRequestRunners.set(key, runner)
    this.queuedRequestPromiseByReleaseName.set(key, runner.promise as Promise<unknown>)
    await this.persistQueuedRequests()
    this.scheduleQueuedRequestDrain()
    return runner.promise
  }

  private scheduleQueuedRequestDrain(): void {
    if (this.drainQueuedRequestsScheduled) {
      return
    }

    this.drainQueuedRequestsScheduled = true
    queueMicrotask(() => {
      this.drainQueuedRequestsScheduled = false
      void this.drainQueuedRequests()
    })
  }

  private async drainQueuedRequests(): Promise<void> {
    await this.loadQueuedRequests()

    while (this.activeQueuedRequests < this.maxConcurrentQueuedRequests) {
      const nextRecord = this.queuedRequestRecords.find((entry) => {
        if (entry.state !== 'queued') {
          return false
        }

        if (isVrSrcInstallQueuedOperation(entry.operation) && this.activeInstallQueuedRequests > 0) {
          return false
        }

        return true
      })
      if (!nextRecord) {
        return
      }

      const key = this.getQueuedRequestKey(nextRecord.releaseName, nextRecord.operation, nextRecord.serial)
      const runner = this.queuedRequestRunners.get(key)
      if (!runner) {
        return
      }

      nextRecord.state = 'running'
      this.activeQueuedRequests += 1
      if (isVrSrcInstallQueuedOperation(nextRecord.operation)) {
        this.activeInstallQueuedRequests += 1
      }
      await this.persistQueuedRequests()

      void (async () => {
        try {
          const value = await runner.run()
          runner.resolve(value)
        } catch (error) {
          runner.reject(error)
        } finally {
          this.activeQueuedRequests = Math.max(0, this.activeQueuedRequests - 1)
          if (isVrSrcInstallQueuedOperation(nextRecord.operation)) {
            this.activeInstallQueuedRequests = Math.max(0, this.activeInstallQueuedRequests - 1)
          }
          this.queuedRequestRunners.delete(key)
          this.queuedRequestPromiseByReleaseName.delete(key)
          this.queuedRequestRecords = this.queuedRequestRecords.filter(
            (entry) => this.getQueuedRequestKey(entry.releaseName, entry.operation, entry.serial) !== key
          )
          await this.persistQueuedRequests()
          this.scheduleQueuedRequestDrain()
        }
      })()
    }
  }

  async resumeQueuedRequests(): Promise<void> {
    await this.loadQueuedRequests()
    for (const record of this.queuedRequestRecords) {
      const key = this.getQueuedRequestKey(record.releaseName, record.operation, record.serial)
      if (this.queuedRequestRunners.has(key)) {
        continue
      }

      const runner = this.buildQueuedRequestRunner(record, () => this.runQueuedRequest(record))
      this.queuedRequestRunners.set(key, runner)
      this.queuedRequestPromiseByReleaseName.set(key, runner.promise as Promise<unknown>)
    }

    this.scheduleQueuedRequestDrain()
  }

  private async runQueuedRequest(record: VrSrcQueuedRequestRecord): Promise<unknown> {
    if (record.operation === 'download-to-library') {
      return await this.performDownloadToLibrary(record.releaseName)
    }

    if (record.operation === 'download-to-library-and-install') {
      if (!record.serial) {
        throw new Error(`Missing headset serial for queued vrSrc request ${record.releaseName}.`)
      }
      return await this.performDownloadToLibraryAndInstall(record.serial, record.releaseName)
    }

    if (!record.serial) {
      throw new Error(`Missing headset serial for queued vrSrc request ${record.releaseName}.`)
    }

    return await this.performInstallNow(record.serial, record.releaseName)
  }

  private async acquirePayloadDownloadSlot(): Promise<() => void> {
    if (this.activePayloadDownloads < this.maxConcurrentPayloadDownloads) {
      this.activePayloadDownloads += 1
      return () => this.releasePayloadDownloadSlot()
    }

    return await new Promise((resolve) => {
      this.payloadDownloadWaiters.push(() => {
        this.activePayloadDownloads += 1
        resolve(() => this.releasePayloadDownloadSlot())
      })
    })
  }

  private releasePayloadDownloadSlot(): void {
    this.activePayloadDownloads = Math.max(0, this.activePayloadDownloads - 1)
    const next = this.payloadDownloadWaiters.shift()
    next?.()
  }

  private async acquireExtractionImportSlot(): Promise<() => void> {
    if (this.activeExtractionImports < this.maxConcurrentExtractionImports) {
      this.activeExtractionImports += 1
      return () => this.releaseExtractionImportSlot()
    }

    return await new Promise((resolve) => {
      this.extractionImportWaiters.push(() => {
        this.activeExtractionImports += 1
        resolve(() => this.releaseExtractionImportSlot())
      })
    })
  }

  private releaseExtractionImportSlot(): void {
    this.activeExtractionImports = Math.max(0, this.activeExtractionImports - 1)
    const next = this.extractionImportWaiters.shift()
    next?.()
  }

  private getRootPath(): string {
    return join(app.getPath('userData'), 'vrsrc')
  }

  private getCredentialsPath(): string {
    return join(this.getRootPath(), 'credentials.json')
  }

  private getCatalogPath(): string {
    return join(this.getRootPath(), 'catalog.json')
  }

  private getMetaArchivePath(): string {
    return join(this.getRootPath(), 'meta.7z')
  }

  private getStagedMetaArchivePath(): string {
    return join(this.getRootPath(), 'meta.next.7z')
  }

  private getMetaExtractPath(): string {
    return join(this.getRootPath(), 'meta')
  }

  private getStagedMetaExtractPath(): string {
    return join(this.getRootPath(), 'meta.next')
  }

  private getStagedCatalogPath(): string {
    return join(this.getRootPath(), 'catalog.next.json')
  }

  private getDownloadsPath(): string {
    return join(this.getRootPath(), 'downloads')
  }

  private getBrokenDownloadsPath(): string {
    return join(this.getRootPath(), 'broken-downloads')
  }

  private getLogsPath(): string {
    return join(this.getRootPath(), 'logs')
  }

  private toLocalAssetUri(absolutePath: string): string {
    return `qam-asset://${absolutePath.split('/').map(encodeURIComponent).join('/')}`
  }

  private normalizeVrSrcArtworkUrl(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null
    }

    const normalizedValue = value.trim()
    if (!normalizedValue) {
      return null
    }

    const stagedPath = this.getStagedMetaExtractPath()
    const livePath = this.getMetaExtractPath()
    const legacyEncodedStagedPath = encodeURIComponent(`${stagedPath}/`)
    const legacyEncodedLivePath = encodeURIComponent(`${livePath}/`)

    if (normalizedValue.includes(legacyEncodedStagedPath)) {
      return normalizedValue.replace(legacyEncodedStagedPath, legacyEncodedLivePath)
    }

    if (normalizedValue.includes(`${stagedPath}/`)) {
      return normalizedValue.replace(`${stagedPath}/`, `${livePath}/`)
    }

    return normalizedValue
  }

  private sanitizeSegment(value: string): string {
    return value
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'vrSrc Item'
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  private normalizeTrailerSearchKey(value: string): string {
    return value.trim().toLowerCase()
  }

  private formatLogDetails(details: unknown): string {
    if (details === undefined) {
      return ''
    }

    if (details instanceof Error) {
      return ` | ${details.name}: ${details.message}`
    }

    if (typeof details === 'string') {
      return details.trim() ? ` | ${details}` : ''
    }

    try {
      return ` | ${JSON.stringify(details)}`
    } catch {
      return ` | ${String(details)}`
    }
  }

  private async appendLogLine(
    logPath: string,
    level: VrSrcLogLevel,
    message: string,
    details?: unknown
  ): Promise<void> {
    const line = `[${new Date().toISOString()}] [${level}] ${message}${this.formatLogDetails(details)}\n`
    try {
      await appendFile(logPath, line, 'utf8')
    } catch {
      // Logging must never block vrSrc operations.
    }
  }

  private sanitizeLogSuffix(value: string): string {
    return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'sync'
  }

  private async pruneLogs(maxRetained: number): Promise<void> {
    try {
      const entries = await readdir(this.getLogsPath(), { withFileTypes: true })
      const logNames = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.log'))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left))

      await Promise.all(
        logNames.slice(maxRetained).map((name) =>
          rm(join(this.getLogsPath(), name), { force: true }).catch(() => undefined)
        )
      )
    } catch {
      // Log retention must never block vrSrc operations.
    }
  }

  private async createLogger(scope: string): Promise<VrSrcLogger> {
    await mkdir(this.getLogsPath(), { recursive: true })
    const logPath = join(this.getLogsPath(), `${new Date().toISOString().replace(/[:.]/g, '-')}-${this.sanitizeLogSuffix(scope)}.log`)

    await writeFile(logPath, '', 'utf8')
    await this.pruneLogs(4)

    return {
      logPath,
      debug: (message, details) => this.appendLogLine(logPath, 'DEBUG', message, details),
      info: (message, details) => this.appendLogLine(logPath, 'INFO', message, details),
      warn: (message, details) => this.appendLogLine(logPath, 'WARN', message, details),
      error: (message, details) => this.appendLogLine(logPath, 'ERROR', message, details)
    }
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(this.getRootPath(), { recursive: true })
    await mkdir(this.getDownloadsPath(), { recursive: true })
    await mkdir(this.getLogsPath(), { recursive: true })
  }

  private async logCurlOutput(logger: VrSrcLogger | undefined, source: string, output: string): Promise<void> {
    await this.logCommandOutput(logger, source, output)
  }

  private async logCommandOutput(logger: VrSrcLogger | undefined, source: string, output: string): Promise<void> {
    if (!logger) {
      return
    }

    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)

    for (const line of lines) {
      await logger.debug(source, line)
    }
  }

  private getRcloneConfigPath(): string {
    return process.platform === 'win32' ? 'NUL' : '/dev/null'
  }

  private async getRclonePath(): Promise<string> {
    return dependencyService.ensureRclonePath()
  }

  private async getVrSrcRcloneArgs(baseUri: string): Promise<string[]> {
    const { spareValue } = await settingsService.getSettings()
    const args = [
      '--config',
      this.getRcloneConfigPath(),
      '--http-url',
      this.ensureTrailingSlash(baseUri),
      '--user-agent',
      VR_SRC_USER_AGENT,
      '--tpslimit',
      '1.0',
      '--tpslimit-burst',
      '3',
      '--no-check-certificate'
    ]

    if (spareValue) {
      args.push('--header', `${getHeaderLabel()}: ${spareValue}`)
    }

    return args
  }

  private async getVrSrcRcloneTransferArgs(baseUri: string): Promise<string[]> {
    return [
      ...(await this.getVrSrcRcloneArgs(baseUri)),
      '--progress',
      '--stats',
      '750ms',
      '--stats-one-line',
      '--stats-log-level',
      'NOTICE'
    ]
  }

  private stripTerminalControlSequences(output: string): string {
    return output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n')
  }

  private parseHumanByteSize(value: string): number | null {
    const normalized = value.trim().replace(/,/g, '')
    const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)?$/)
    if (!match) {
      return null
    }

    const amount = Number.parseFloat(match[1])
    if (!Number.isFinite(amount)) {
      return null
    }

    const unit = (match[2] ?? 'B').toLowerCase()
    const multipliers: Record<string, number> = {
      b: 1,
      byte: 1,
      bytes: 1,
      k: 1000,
      kb: 1000,
      kbyte: 1000,
      kbytes: 1000,
      ki: 1024,
      mb: 1000 ** 2,
      mbyte: 1000 ** 2,
      mbytes: 1000 ** 2,
      m: 1000 ** 2,
      mi: 1024 ** 2,
      gb: 1000 ** 3,
      gbyte: 1000 ** 3,
      gbytes: 1000 ** 3,
      g: 1000 ** 3,
      gi: 1024 ** 3,
      tb: 1000 ** 4,
      tbyte: 1000 ** 4,
      tbytes: 1000 ** 4,
      t: 1000 ** 4,
      ti: 1024 ** 4,
      pb: 1000 ** 5,
      pbyte: 1000 ** 5,
      pbytes: 1000 ** 5,
      p: 1000 ** 5,
      pi: 1024 ** 5,
      eb: 1000 ** 6,
      ebyte: 1000 ** 6,
      ebytes: 1000 ** 6,
      e: 1000 ** 6,
      ei: 1024 ** 6,
      kib: 1024,
      mib: 1024 ** 2,
      gib: 1024 ** 3,
      tib: 1024 ** 4,
      pib: 1024 ** 5,
      eib: 1024 ** 6
    }

    const multiplier = multipliers[unit] ?? multipliers[unit.replace(/s$/, '')]
    if (!multiplier) {
      return null
    }

    return amount * multiplier
  }

  private parseRcloneTransferStats(output: string): { transferredBytes: number | null; totalBytes: number | null; percent: number | null } | null {
    const normalized = this.stripTerminalControlSequences(output)
    const lines = normalized.split('\n')

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim()
      if (!line.startsWith('Transferred:')) {
        continue
      }

      const match = line.match(/^Transferred:\s+(.+?)\s+\/\s+(.+?),\s+([0-9]+(?:\.[0-9]+)?)%,/i)
      if (!match) {
        continue
      }

      const percent = Number.parseFloat(match[3])
      return {
        transferredBytes: this.parseHumanByteSize(match[1]),
        totalBytes: this.parseHumanByteSize(match[2]),
        percent: Number.isFinite(percent) ? percent : null
      }
    }

    return null
  }

  private getVrSrcCurlNetworkArgs(): string[] {
    // Prefer IPv4 on Windows for vrSrc requests. We have seen Cloudflare reject
    // the Windows schannel + IPv6 path with a 403 while the same endpoint was
    // reachable over IPv4.
    return process.platform === 'win32' ? ['-4'] : []
  }

  private isCloudflareForbidden(message: string): boolean {
    const normalized = message.toLowerCase()
    return normalized.includes('403 forbidden') && normalized.includes('cloudflare')
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  private async fetchText(url: string, logger?: VrSrcLogger): Promise<string> {
    try {
      const args = ['-L', '--fail', ...this.getVrSrcCurlNetworkArgs(), '-A', VR_SRC_USER_AGENT, '-H', 'accept: */*']
      if (logger) {
        args.push('-v')
      }
      args.push(url)
      const { stdout, stderr } = await execFileAsync('curl', args, {
        maxBuffer: 8 * 1024 * 1024
      })

      await this.logCurlOutput(logger, 'fetchText', stderr)
      return stdout
    } catch (error) {
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string'
          ? error.stderr
          : ''
      await this.logCurlOutput(logger, 'fetchText', stderr)
      throw error
    }
  }

  private async getRemoteContentLength(url: string, logger?: VrSrcLogger): Promise<number | null> {
    try {
      const args = ['-L', '--fail', '-I', ...this.getVrSrcCurlNetworkArgs(), '-A', VR_SRC_USER_AGENT, '-H', 'accept: */*']
      if (logger) {
        args.push('-v')
      }
      args.push(url)
      const { stdout, stderr } = await execFileAsync('curl', args, {
        maxBuffer: 256 * 1024
      })
      await this.logCurlOutput(logger, 'content-length', stderr)
      const matches = Array.from(stdout.matchAll(/^content-length:\s*(\d+)\s*$/gim))
      const lastMatch = matches.at(-1)
      if (!lastMatch) {
        return null
      }

      const parsed = Number.parseInt(lastMatch[1], 10)
      return Number.isFinite(parsed) ? parsed : null
    } catch (error) {
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string'
          ? error.stderr
          : ''
      await this.logCurlOutput(logger, 'content-length', stderr)
      return null
    }
  }

  private async calculatePathSize(targetPath: string): Promise<number> {
    try {
      const targetStat = await stat(targetPath)
      if (targetStat.isFile()) {
        return targetStat.size
      }

      if (!targetStat.isDirectory()) {
        return 0
      }
    } catch {
      return 0
    }

    let totalBytes = 0
    const entries = await readdir(targetPath, { withFileTypes: true })
    for (const entry of entries) {
      totalBytes += await this.calculatePathSize(join(targetPath, entry.name))
    }

    return totalBytes
  }

  private async getAvailableBytes(targetPath: string): Promise<number | null> {
    try {
      const stats = await statfs(targetPath)
      return stats.bavail * stats.bsize
    } catch {
      return null
    }
  }

  private formatByteSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return 'unknown'
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }

    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
  }

  private getRequiredExtractionBytes(sizeBytes: number | null): number | null {
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return null
    }

    return Math.ceil(sizeBytes * 1.05) + DIRECT_EXTRACTION_SPACE_MARGIN_BYTES
  }

  private async shouldExtractDirectlyToLibraryTarget(
    payloadPath: string,
    libraryTargetPath: string | null,
    requiredExtractionBytes: number | null
  ): Promise<boolean> {
    if (!libraryTargetPath || requiredExtractionBytes === null) {
      return false
    }

    const cacheAvailableBytes = await this.getAvailableBytes(payloadPath)
    if (cacheAvailableBytes === null || cacheAvailableBytes >= requiredExtractionBytes) {
      return false
    }

    const libraryAvailableBytes = await this.getAvailableBytes(dirname(libraryTargetPath))
    if (libraryAvailableBytes !== null && libraryAvailableBytes < requiredExtractionBytes) {
      throw new Error(
        `Not enough disk space to extract this vrSrc item. Cache has ${this.formatByteSize(cacheAvailableBytes)} free, Local Library has ${this.formatByteSize(libraryAvailableBytes)} free, and about ${this.formatByteSize(requiredExtractionBytes)} is required.`
      )
    }

    return true
  }

  private async collapseSingleDirectoryInPlace(basePath: string): Promise<void> {
    while (true) {
      const entries = (await readdir(basePath, { withFileTypes: true })).filter(
        (entry) => !entry.name.startsWith('.') && !/\.7z(\.\d+)?$/i.test(entry.name)
      )
      const directoryEntries = entries.filter((entry) => entry.isDirectory())
      const fileEntries = entries.filter((entry) => !entry.isDirectory())

      if (directoryEntries.length !== 1 || fileEntries.length !== 0) {
        return
      }

      const nestedPath = join(basePath, directoryEntries[0].name)
      const nestedEntries = await readdir(nestedPath, { withFileTypes: true })
      for (const entry of nestedEntries) {
        await rename(join(nestedPath, entry.name), join(basePath, entry.name))
      }
      await rm(nestedPath, { recursive: true, force: true })
    }
  }

  private readTransferErrorDetails(error: unknown): string {
    if (error instanceof VrSrcBrokenDownloadError) {
      return `${error.message}\n\n${error.details}`
    }

    return error instanceof Error ? error.message : String(error)
  }

  private getPayloadRelativePath(fileName: string): string {
    return fileName
      .split(/[\\/]+/)
      .filter((segment) => segment && segment !== '.' && segment !== '..')
      .join('/')
  }

  private async collectPayloadFiles(
    rootPath: string
  ): Promise<Array<{ absolutePath: string; relativePath: string; sizeBytes: number }>> {
    const files: Array<{ absolutePath: string; relativePath: string; sizeBytes: number }> = []

    const visit = async (currentPath: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(currentPath, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const absolutePath = join(currentPath, entry.name)
        if (entry.isDirectory()) {
          await visit(absolutePath)
          continue
        }

        if (!entry.isFile()) {
          continue
        }

        const entryStats = await stat(absolutePath).catch(() => null)
        if (!entryStats?.isFile()) {
          continue
        }

        files.push({
          absolutePath,
          relativePath: relative(rootPath, absolutePath).split(/[\\/]+/).join('/'),
          sizeBytes: entryStats.size
        })
      }
    }

    await visit(rootPath)
    return files
  }

  private async validateDownloadedPayload(
    payloadPath: string,
    payloadFiles: VrSrcRemotePayloadFile[]
  ): Promise<VrSrcPayloadValidationResult> {
    const localFiles = await this.collectPayloadFiles(payloadPath)
    const localFilesByRelativePath = new Map(localFiles.map((file) => [file.relativePath, file]))
    const partialFiles = localFiles
      .filter((file) => /\.partial$/i.test(file.relativePath))
      .map((file) => file.relativePath)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    const missingFiles: string[] = []
    const sizeMismatches: Array<{ fileName: string; expectedBytes: number; actualBytes: number }> = []
    let completeCount = 0

    for (const remoteFile of payloadFiles) {
      const relativePath = this.getPayloadRelativePath(remoteFile.fileName)
      if (!relativePath) {
        continue
      }

      const localFile = localFilesByRelativePath.get(relativePath)
      if (!localFile) {
        missingFiles.push(relativePath)
        continue
      }

      if (remoteFile.sizeBytes !== null && localFile.sizeBytes !== remoteFile.sizeBytes) {
        sizeMismatches.push({
          fileName: relativePath,
          expectedBytes: remoteFile.sizeBytes,
          actualBytes: localFile.sizeBytes
        })
        continue
      }

      completeCount += 1
    }

    return {
      ok: partialFiles.length === 0 && missingFiles.length === 0 && sizeMismatches.length === 0,
      expectedCount: payloadFiles.length,
      completeCount,
      partialFiles,
      missingFiles: missingFiles.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
      sizeMismatches: sizeMismatches.sort((left, right) =>
        left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' })
      )
    }
  }

  private getBrokenDownloadMarkerPath(releaseName: string): string {
    const safeReleaseName = this.sanitizeSegment(releaseName).slice(0, 80) || 'release'
    const releaseHash = createHash('sha256').update(releaseName).digest('hex').slice(0, 16)
    return join(this.getBrokenDownloadsPath(), `${safeReleaseName}-${releaseHash}.json`)
  }

  private getLegacyBrokenDownloadMarkerPath(payloadPath: string): string {
    return join(payloadPath, '.questvault-vrsrc-broken.json')
  }

  private async writeBrokenDownloadMarker(
    releaseName: string,
    payloadPath: string,
    validation: VrSrcPayloadValidationResult
  ): Promise<void> {
    const marker: VrSrcBrokenDownload = {
      releaseName,
      detectedAt: new Date().toISOString(),
      partialFiles: validation.partialFiles,
      missingFiles: validation.missingFiles,
      sizeMismatches: validation.sizeMismatches,
      details: VrSrcBrokenDownloadError.formatDetails(validation)
    }

    await mkdir(this.getBrokenDownloadsPath(), { recursive: true })
    await writeFile(this.getBrokenDownloadMarkerPath(releaseName), JSON.stringify(marker, null, 2), 'utf8')
    await rm(this.getLegacyBrokenDownloadMarkerPath(payloadPath), { force: true }).catch(() => undefined)
  }

  private async removeBrokenDownloadMarker(releaseName: string, payloadPath: string): Promise<void> {
    await Promise.all([
      rm(this.getBrokenDownloadMarkerPath(releaseName), { force: true }).catch(() => undefined),
      rm(this.getLegacyBrokenDownloadMarkerPath(payloadPath), { force: true }).catch(() => undefined)
    ])
  }

  private async readBrokenDownloadMarker(
    releaseName: string,
    payloadPath: string,
    partialFiles: string[]
  ): Promise<VrSrcBrokenDownload | null> {
    const markerPaths = [
      this.getBrokenDownloadMarkerPath(releaseName),
      this.getLegacyBrokenDownloadMarkerPath(payloadPath)
    ]

    for (const markerPath of markerPaths) {
      try {
        const raw = await readFile(markerPath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<VrSrcBrokenDownload>

        return {
          releaseName,
          detectedAt: typeof parsed.detectedAt === 'string' ? parsed.detectedAt : null,
          partialFiles: Array.isArray(parsed.partialFiles)
            ? parsed.partialFiles.filter((entry) => typeof entry === 'string')
            : partialFiles,
          missingFiles: Array.isArray(parsed.missingFiles)
            ? parsed.missingFiles.filter((entry) => typeof entry === 'string')
            : [],
          sizeMismatches: Array.isArray(parsed.sizeMismatches)
            ? parsed.sizeMismatches.filter(
                (entry): entry is { fileName: string; expectedBytes: number; actualBytes: number } =>
                  typeof entry === 'object' &&
                  entry !== null &&
                  'fileName' in entry &&
                  'expectedBytes' in entry &&
                  'actualBytes' in entry &&
                  typeof entry.fileName === 'string' &&
                  typeof entry.expectedBytes === 'number' &&
                  typeof entry.actualBytes === 'number'
              )
            : [],
          details: typeof parsed.details === 'string' ? parsed.details : null
        }
      } catch {
        continue
      }
    }

    if (!partialFiles.length) {
      return null
    }

    return {
      releaseName,
      detectedAt: null,
      partialFiles,
      missingFiles: [],
      sizeMismatches: [],
      details: null
    }
  }

  private async readBrokenDownloadsForCatalog(items: VrSrcCatalogItem[]): Promise<VrSrcBrokenDownload[]> {
    const brokenDownloads: VrSrcBrokenDownload[] = []

    for (const item of items) {
      const payloadPath = join(this.getDownloadsPath(), this.sanitizeSegment(item.releaseName))
      const localFiles = (await this.fileExists(payloadPath)) ? await this.collectPayloadFiles(payloadPath) : []
      const partialFiles = localFiles
        .filter((file) => /\.partial$/i.test(file.relativePath))
        .map((file) => file.relativePath)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      const brokenDownload = await this.readBrokenDownloadMarker(item.releaseName, payloadPath, partialFiles)
      if (brokenDownload) {
        brokenDownloads.push(brokenDownload)
      }
    }

    return brokenDownloads
  }

  private async buildCopyPlan(
    sourcePath: string,
    targetPath: string
  ): Promise<{
    totalBytes: number
    files: Array<{ sourcePath: string; targetPath: string; label: string; sizeBytes: number }>
  }> {
    const sourceStats = await stat(sourcePath)

    if (sourceStats.isFile()) {
      return {
        totalBytes: sourceStats.size,
        files: [
          {
            sourcePath,
            targetPath,
            label: basename(sourcePath),
            sizeBytes: sourceStats.size
          }
        ]
      }
    }

    const files: Array<{ sourcePath: string; targetPath: string; label: string; sizeBytes: number }> = []
    let totalBytes = 0

    const visit = async (currentSourcePath: string, currentTargetPath: string): Promise<void> => {
      const entries = await readdir(currentSourcePath, { withFileTypes: true })
      await mkdir(currentTargetPath, { recursive: true })

      for (const entry of entries) {
        const nextSourcePath = join(currentSourcePath, entry.name)
        const nextTargetPath = join(currentTargetPath, entry.name)

        if (entry.isDirectory()) {
          await visit(nextSourcePath, nextTargetPath)
          continue
        }

        if (!entry.isFile()) {
          continue
        }

        const entryStats = await stat(nextSourcePath)
        const label = relative(sourcePath, nextSourcePath) || entry.name
        totalBytes += entryStats.size
        files.push({
          sourcePath: nextSourcePath,
          targetPath: nextTargetPath,
          label,
          sizeBytes: entryStats.size
        })
      }
    }

    await visit(sourcePath, targetPath)

    return { totalBytes, files }
  }

  private async copyPathWithProgress(
    sourcePath: string,
    targetPath: string,
    onProgress: (update: { transferredBytes: number; totalBytes: number; fileName: string | null; progress: number }) => void
  ): Promise<void> {
    const plan = await this.buildCopyPlan(sourcePath, targetPath)
    let transferredBytes = 0
    let lastReportedAt = 0

    const reportProgress = (fileName: string | null) => {
      const now = Date.now()
      if (now - lastReportedAt < 80 && transferredBytes < plan.totalBytes) {
        return
      }

      lastReportedAt = now
      onProgress({
        transferredBytes,
        totalBytes: plan.totalBytes,
        fileName,
        progress: plan.totalBytes > 0 ? Math.max(1, Math.min(95, Math.round((transferredBytes / plan.totalBytes) * 95))) : 95
      })
    }

    if (!plan.files.length) {
      await mkdir(targetPath, { recursive: true })
      onProgress({
        transferredBytes: 0,
        totalBytes: 0,
        fileName: null,
        progress: 95
      })
      return
    }

    for (const file of plan.files) {
      await mkdir(dirname(file.targetPath), { recursive: true })
      let copiedForFile = 0

      await pipeline(
        createReadStream(file.sourcePath),
        async function* (source) {
          for await (const chunk of source) {
            const chunkSize = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
            copiedForFile += chunkSize
            transferredBytes += chunkSize
            reportProgress(file.label)
            yield chunk
          }
        },
        createWriteStream(file.targetPath, { flags: 'wx' })
      )

      if (copiedForFile < file.sizeBytes) {
        transferredBytes += file.sizeBytes - copiedForFile
      }
      reportProgress(file.label)
    }

    onProgress({
      transferredBytes: plan.totalBytes,
      totalBytes: plan.totalBytes,
      fileName: plan.files.at(-1)?.label ?? null,
      progress: 95
    })
  }

  private async hashFile(path: string): Promise<string | null> {
    try {
      const contents = await readFile(path)
      return createHash('sha256').update(contents).digest('hex')
    } catch {
      return null
    }
  }

  private async isStagedMetaArchiveNewerOrDifferent(stagedArchivePath: string): Promise<boolean> {
    const liveArchivePath = this.getMetaArchivePath()
    if (!(await this.fileExists(liveArchivePath))) {
      return true
    }

    const [stagedHash, liveHash] = await Promise.all([this.hashFile(stagedArchivePath), this.hashFile(liveArchivePath)])
    if (!stagedHash || !liveHash) {
      return true
    }

    return stagedHash !== liveHash
  }

  private async finalizeStagedCatalog(
    stagedArchivePath: string,
    stagedExtractPath: string,
    stagedCatalogPath: string,
    logger?: VrSrcLogger
  ): Promise<void> {
    await logger?.info('Promoting staged vrSrc metadata into the live cache.', {
      stagedArchivePath,
      stagedExtractPath,
      stagedCatalogPath
    })
    await rm(this.getMetaArchivePath(), { force: true })
    await rm(this.getMetaExtractPath(), { recursive: true, force: true })
    await rm(this.getCatalogPath(), { force: true })
    await rename(stagedArchivePath, this.getMetaArchivePath())
    await rename(stagedExtractPath, this.getMetaExtractPath())
    await rename(stagedCatalogPath, this.getCatalogPath())
  }

  private async syncMetaArchiveWithRclone(baseUri: string, destinationPath: string, logger?: VrSrcLogger): Promise<void> {
    const tempPath = join(this.getRootPath(), 'meta-download')
    await rm(tempPath, { recursive: true, force: true })
    await mkdir(tempPath, { recursive: true })

    try {
      const args = ['sync', ':http:/meta.7z', tempPath, ...(await this.getVrSrcRcloneArgs(baseUri))]
      if (logger) {
        args.push('-vv')
      }

      const { stderr } = await execFileAsync(await this.getRclonePath(), args, {
        maxBuffer: 16 * 1024 * 1024
      })
      await this.logCommandOutput(logger, 'meta-sync', stderr)

      const downloadedArchivePath = join(tempPath, 'meta.7z')
      if (!(await this.fileExists(downloadedArchivePath))) {
        throw new Error('rclone did not produce meta.7z in the expected sync directory.')
      }

      await cp(downloadedArchivePath, destinationPath, { force: true })
    } catch (error) {
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string'
          ? error.stderr
          : ''
      await this.logCommandOutput(logger, 'meta-sync', stderr)
      throw error
    } finally {
      await rm(tempPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async downloadFile(
    url: string,
    destinationPath: string,
    control: VrSrcTransferControlState | null,
    logger?: VrSrcLogger,
    progressContext?: {
      operation: VrSrcTransferOperation
      releaseName: string
      serial: string | null
      bytesCompletedBefore: number
      totalBytes: number | null
    }
  ): Promise<void> {
    await logger?.debug('Preparing download.', {
      url,
      destinationPath,
      operation: progressContext?.operation ?? null,
      releaseName: progressContext?.releaseName ?? null
    })
    const remoteContentLength = await this.getRemoteContentLength(url, logger)
    let existingBytes = 0
    try {
      existingBytes = (await stat(destinationPath)).size
    } catch {
      existingBytes = 0
    }

    if (remoteContentLength !== null && existingBytes > remoteContentLength) {
      await logger?.warn('Existing partial file exceeded remote content length. Resetting local file.', {
        destinationPath,
        existingBytes,
        remoteContentLength
      })
      await rm(destinationPath, { force: true })
      existingBytes = 0
    }

    if (remoteContentLength !== null && existingBytes === remoteContentLength && existingBytes > 0) {
      await logger?.debug('Skipping download because the local file already matches the remote size.', {
        destinationPath,
        bytes: existingBytes
      })
      if (progressContext) {
        const update: Omit<VrSrcTransferProgressUpdate, 'serial' | 'canPause' | 'canResume' | 'canCancel'> = {
          operation: progressContext.operation,
          releaseName: progressContext.releaseName,
          phase: 'downloading',
          progress: progressContext.totalBytes
            ? Math.min(
                94,
                Math.max(
                  1,
                  Math.round(((progressContext.bytesCompletedBefore + existingBytes) / progressContext.totalBytes) * 100)
                )
              )
            : 94,
          fileName: basename(destinationPath),
          transferredBytes: progressContext.bytesCompletedBefore + existingBytes,
          totalBytes: progressContext.totalBytes,
          speedBytesPerSecond: null,
          etaSeconds: 0
        }
        if (control) {
          this.emitControlledTransferProgress(control, update)
        } else {
          this.emitTransferProgress({
            ...update,
            serial: progressContext.serial,
            canPause: false,
            canResume: false,
            canCancel: false
          })
        }
      }
      return
    }

    while (true) {
      if (control) {
        await this.checkpointTransferControl(control)
      }

      try {
        await logger?.info(existingBytes > 0 ? 'Resuming download.' : 'Starting download.', {
          url,
          destinationPath,
          existingBytes,
          remoteContentLength
        })
        await new Promise<void>((resolve, reject) => {
          const curlArgs = [
            '-L',
            '--fail',
            ...this.getVrSrcCurlNetworkArgs(),
            '-A',
            VR_SRC_USER_AGENT,
            '-H',
            'accept: */*'
          ]
          if (logger) {
            curlArgs.push('--verbose')
          }
          curlArgs.push('-o', destinationPath)
          if (existingBytes > 0) {
            curlArgs.push('-C', '-')
          }
          curlArgs.push(url)

          const child = spawn('curl', curlArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
          if (control) {
            control.child = child
            control.status = 'running'
          }
          let stderr = ''
          let lastTransferredBytes = existingBytes
          let lastSampleAt = Date.now()

          const emitProgress = async () => {
            if (!progressContext) {
              return
            }

            let transferredBytes = 0
            try {
              transferredBytes = (await stat(destinationPath)).size
            } catch {
              transferredBytes = 0
            }

            existingBytes = transferredBytes
            const now = Date.now()
            const elapsedSeconds = Math.max((now - lastSampleAt) / 1000, 0.25)
            const speedBytesPerSecond =
              transferredBytes >= lastTransferredBytes ? (transferredBytes - lastTransferredBytes) / elapsedSeconds : null
            lastTransferredBytes = transferredBytes
            lastSampleAt = now

            const overallTransferredBytes = progressContext.bytesCompletedBefore + transferredBytes
            const overallTotalBytes = progressContext.totalBytes
            const progress = overallTotalBytes
              ? Math.min(94, Math.max(1, Math.round((overallTransferredBytes / overallTotalBytes) * 100)))
              : 22
            const etaSeconds =
              overallTotalBytes && speedBytesPerSecond && speedBytesPerSecond > 0
                ? Math.max(0, Math.round((overallTotalBytes - overallTransferredBytes) / speedBytesPerSecond))
                : null

            const update = {
              operation: progressContext.operation,
              releaseName: progressContext.releaseName,
              phase: 'downloading' as const,
              progress,
              fileName: basename(destinationPath),
              transferredBytes: overallTransferredBytes,
              totalBytes: overallTotalBytes,
              speedBytesPerSecond: speedBytesPerSecond && Number.isFinite(speedBytesPerSecond) ? speedBytesPerSecond : null,
              etaSeconds
            }

            if (control) {
              this.emitControlledTransferProgress(control, update)
            } else {
              this.emitTransferProgress({
                ...update,
                serial: progressContext.serial,
                canPause: false,
                canResume: false,
                canCancel: false
              })
            }
          }

          const intervalId = setInterval(() => {
            void emitProgress()
          }, 750)

          child.stderr.on('data', (chunk) => {
            const text = chunk.toString()
            stderr += text
            void this.logCurlOutput(logger, 'download', text)
          })

          child.once('error', (error) => {
            clearInterval(intervalId)
            if (control) {
              control.child = null
            }
            reject(error)
          })

          child.once('close', async (code) => {
            clearInterval(intervalId)
            await emitProgress()
            if (control) {
              control.child = null
            }
            if (code === 0) {
              await logger?.info('Download finished successfully.', {
                url,
                destinationPath
              })
              resolve()
              return
            }

            if (control?.command === 'pause') {
              control.command = 'none'
              control.status = 'paused'
              reject(new VrSrcTransferPausedError())
              return
            }

            if (control?.command === 'cancel' || control?.status === 'cancelled') {
              control.command = 'none'
              control.status = 'cancelled'
              reject(new VrSrcTransferCancelledError())
              return
            }

            reject(new Error(stderr.trim() || `curl exited with code ${code ?? 'unknown'}.`))
          })
        })

        return
      } catch (error) {
        if (!(error instanceof VrSrcTransferPausedError)) {
          await logger?.error('Download failed.', {
            url,
            destinationPath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
        if (error instanceof VrSrcTransferPausedError) {
          if (control) {
            await this.waitForTransferResume(control)
            continue
          }
        }

        throw error
      }
    }
  }

  private async getSevenZipPath(): Promise<string> {
    const status = await dependencyService.ensureSevenZip()
    if (status.status === 'ready' && status.path) {
      return status.path
    }

    throw new Error(status.message || 'Unable to find a working 7-Zip runtime.')
  }

  private async extractArchive(
    archivePath: string,
    destinationPath: string,
    password: string | null,
    logger?: VrSrcLogger,
    options?: {
      clearDestination?: boolean
    }
  ): Promise<void> {
    await logger?.info('Extracting archive.', {
      archivePath,
      destinationPath,
      clearDestination: options?.clearDestination !== false
    })
    if (options?.clearDestination !== false) {
      await rm(destinationPath, { recursive: true, force: true })
    }
    await mkdir(destinationPath, { recursive: true })

    const args = ['x', '-y', `-o${destinationPath}`]
    if (password) {
      args.push(`-p${password}`)
    }
    args.push(archivePath)

    await execFileAsync(await this.getSevenZipPath(), args, {
      maxBuffer: 20 * 1024 * 1024
    })
    await logger?.info('Archive extraction completed.', {
      archivePath,
      destinationPath
    })
  }

  private async extractNestedArchives(basePath: string): Promise<void> {
    const entries = await readdir(basePath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await this.extractNestedArchives(join(basePath, entry.name))
        continue
      }

      const filePath = join(basePath, entry.name)
      if (extname(entry.name).toLowerCase() !== '.7z' || /\.7z\.\d+$/i.test(entry.name)) {
        continue
      }

      await execFileAsync(
        await this.getSevenZipPath(),
        ['x', '-y', `-o${basePath}`, filePath],
        { maxBuffer: 20 * 1024 * 1024 }
      )
    }
  }

  private async cleanupMultipartArchives(basePath: string): Promise<void> {
    const entries = await readdir(basePath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await this.cleanupMultipartArchives(join(basePath, entry.name))
        continue
      }

      if (/\.7z(\.\d+)?$/i.test(entry.name)) {
        await rm(join(basePath, entry.name), { force: true })
      }
    }
  }

  private async findFirstMatchingFile(basePath: string, fileNames: string[]): Promise<string | null> {
    const normalizedNames = new Set(fileNames.map((name) => name.toLowerCase()))

    const visit = async (currentPath: string): Promise<string | null> => {
      const entries = await readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = join(currentPath, entry.name)

        if (entry.isDirectory()) {
          const nestedMatch = await visit(entryPath)
          if (nestedMatch) {
            return nestedMatch
          }
          continue
        }

        if (normalizedNames.has(entry.name.toLowerCase())) {
          return entryPath
        }
      }

      return null
    }

    return visit(basePath)
  }

  private async readNoteForRelease(releaseName: string): Promise<string | null> {
    const directPath = join(this.getMetaExtractPath(), '.meta', 'notes', `${releaseName}.txt`)
    const fallbackPath = await this.findFirstMatchingFile(this.getMetaExtractPath(), [`${releaseName}.txt`])
    const notePath = (await this.fileExists(directPath)) ? directPath : fallbackPath

    if (!notePath) {
      return null
    }

    try {
      const note = (await readFile(notePath, 'utf8')).trim()
      return note || null
    } catch {
      return null
    }
  }

  private extractTrailerVideoIdFromHtml(html: string): string | null {
    const matches = Array.from(html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g))
    const firstMatch = matches[0]
    return firstMatch?.[1] ?? null
  }

  private async getTrailerVideoId(gameName: string): Promise<string | null> {
    const cacheKey = this.normalizeTrailerSearchKey(gameName)
    if (this.trailerVideoIdCache.has(cacheKey)) {
      return this.trailerVideoIdCache.get(cacheKey) ?? null
    }

    try {
      const query = encodeURIComponent(`${gameName} quest vr trailer`)
      const html = await this.fetchText(`https://www.youtube.com/results?search_query=${query}&hl=en`)
      const videoId = this.extractTrailerVideoIdFromHtml(html)
      this.trailerVideoIdCache.set(cacheKey, videoId ?? null)
      return videoId ?? null
    } catch {
      this.trailerVideoIdCache.set(cacheKey, null)
      return null
    }
  }

  private parseServerInfoFromTelegram(html: string): VrSrcCredentials | null {
    const resolvedAt = new Date().toISOString()
    const candidates: VrSrcCredentials[] = []
    const messageBlocks = html.split(/(?=<div class="tgme_widget_message_wrap\b)/gi)

    for (const messageBlock of messageBlocks) {
      const publishedAtMatch = messageBlock.match(/<time\b[^>]*\bdatetime=(['"])(.*?)\1/i)
      const publishedAtValue = publishedAtMatch?.[2]
      const publishedAtTimestamp = publishedAtValue ? Date.parse(this.decodeHtml(publishedAtValue)) : Number.NaN
      const sourcePublishedAt = Number.isFinite(publishedAtTimestamp)
        ? new Date(publishedAtTimestamp).toISOString()
        : undefined
      const codeBlocks = Array.from(messageBlock.matchAll(/<code>([\s\S]*?)<\/code>/gi))

      for (const match of codeBlocks) {
        const decoded = this.decodeHtml(match[1]).replace(/<[^>]+>/g, '').trim()

        try {
          const parsed = JSON.parse(decoded) as { baseUri?: string; password?: string }
          if (parsed.baseUri?.trim() && parsed.password?.trim()) {
            const baseUri = this.ensureTrailingSlash(parsed.baseUri.trim())
            const parsedBaseUri = new URL(baseUri)
            if (parsedBaseUri.protocol !== 'http:' && parsedBaseUri.protocol !== 'https:') {
              continue
            }

            candidates.push({
              baseUri,
              password: parsed.password.trim(),
              lastResolvedAt: resolvedAt,
              ...(sourcePublishedAt ? { sourcePublishedAt } : {})
            })
          }
        } catch {
          continue
        }
      }
    }

    return candidates.reduce<VrSrcCredentials | null>((newest, candidate) => {
      if (!newest) {
        return candidate
      }

      const newestTimestamp = newest.sourcePublishedAt ? Date.parse(newest.sourcePublishedAt) : Number.NEGATIVE_INFINITY
      const candidateTimestamp = candidate.sourcePublishedAt
        ? Date.parse(candidate.sourcePublishedAt)
        : Number.NEGATIVE_INFINITY
      return candidateTimestamp > newestTimestamp ? candidate : newest
    }, null)
  }

  private async readCachedCredentials(): Promise<VrSrcCredentials | null> {
    try {
      const raw = await readFile(this.getCredentialsPath(), 'utf8')
      const parsed = JSON.parse(raw) as VrSrcCredentials
      if (!parsed.baseUri || !parsed.password) {
        return null
      }
      return {
        ...parsed,
        baseUri: this.ensureTrailingSlash(parsed.baseUri)
      }
    } catch {
      return null
    }
  }

  private async resolveCredentials(logger?: VrSrcLogger): Promise<VrSrcCredentials> {
    await this.ensureDirectories()
    const cached = await this.readCachedCredentials()

    try {
      await logger?.debug('Resolving vrSrc credentials from Telegram.')
      const html = await this.fetchText(VR_SRC_TELEGRAM_URL, logger)
      const resolved = this.parseServerInfoFromTelegram(html)
      if (resolved) {
        if (!cached) {
          await writeFile(this.getCredentialsPath(), JSON.stringify(resolved, null, 2), 'utf8')
          await logger?.info('Resolved initial vrSrc credentials from Telegram.', {
            baseUriHost: new URL(resolved.baseUri).host,
            sourcePublishedAt: resolved.sourcePublishedAt ?? null
          })
          return resolved
        }

        const credentialsMatch = resolved.baseUri === cached.baseUri && resolved.password === cached.password
        const resolvedTimestamp = resolved.sourcePublishedAt ? Date.parse(resolved.sourcePublishedAt) : Number.NaN
        const cachedTimestamp = Date.parse(cached.sourcePublishedAt ?? cached.lastResolvedAt)
        const resolvedIsNewer =
          Number.isFinite(resolvedTimestamp) &&
          (!Number.isFinite(cachedTimestamp) || resolvedTimestamp > cachedTimestamp)

        if (!credentialsMatch && resolvedIsNewer) {
          await writeFile(this.getCredentialsPath(), JSON.stringify(resolved, null, 2), 'utf8')
          await logger?.info('Replaced cached vrSrc credentials with a newer Telegram post.', {
            baseUriHost: new URL(resolved.baseUri).host,
            sourcePublishedAt: resolved.sourcePublishedAt
          })
          return resolved
        }

        await logger?.info('Keeping sticky cached vrSrc credentials.', {
          baseUriHost: new URL(cached.baseUri).host,
          lastResolvedAt: cached.lastResolvedAt,
          sourcePublishedAt: cached.sourcePublishedAt ?? null,
          resolvedCredentialsMatch: credentialsMatch,
          resolvedSourcePublishedAt: resolved.sourcePublishedAt ?? null
        })
        return cached
      }
      await logger?.warn('Telegram did not contain valid vrSrc credentials. Keeping cached credentials if available.')
    } catch (error) {
      await logger?.warn('Unable to resolve vrSrc credentials from Telegram. Keeping cached credentials if available.', error)
    }

    if (cached) {
      await logger?.info('Using sticky cached vrSrc credentials.', {
        baseUriHost: new URL(cached.baseUri).host,
        lastResolvedAt: cached.lastResolvedAt,
        sourcePublishedAt: cached.sourcePublishedAt ?? null
      })
      return cached
    }

    await logger?.error('vrSrc credentials could not be resolved and no cached credentials were available.')
    throw new Error('Unable to resolve vrSrc credentials from Telegram and no cached credentials are available.')
  }

  private async resetCachedState(
    options?: {
      includeCatalog?: boolean
      includeDownloads?: boolean
      includeCredentials?: boolean
      logger?: VrSrcLogger
      reason?: string
    }
  ): Promise<void> {
    const includeCatalog = options?.includeCatalog ?? true
    const includeDownloads = options?.includeDownloads ?? false
    const includeCredentials = options?.includeCredentials ?? false
    const logger = options?.logger

    this.trailerVideoIdCache.clear()
    await logger?.info('Resetting cached vrSrc state.', {
      includeCatalog,
      includeDownloads,
      includeCredentials,
      reason: options?.reason ?? null
    })
    if (includeCatalog) {
      await rm(this.getCatalogPath(), { force: true })
    }
    await rm(this.getMetaArchivePath(), { force: true })
    await rm(this.getMetaExtractPath(), { recursive: true, force: true })
    if (includeDownloads) {
      await rm(this.getDownloadsPath(), { recursive: true, force: true })
      await rm(this.getBrokenDownloadsPath(), { recursive: true, force: true })
      await mkdir(this.getDownloadsPath(), { recursive: true })
    }
    if (includeCredentials) {
      await rm(this.getCredentialsPath(), { force: true })
    }
  }

  private readCatalogHeaderIndexes(headerLine: string): Record<string, number> {
    const columns = headerLine.split(';').map((column) => column.trim())
    return {
      gameName: columns.indexOf('Game Name'),
      releaseName: columns.indexOf('Release Name'),
      packageName: columns.indexOf('Package Name'),
      versionCode: columns.indexOf('Version Code'),
      lastUpdated: columns.indexOf('Last Updated'),
      sizeMb: columns.indexOf('Size (MB)'),
      downloads: columns.indexOf('Downloads'),
      rating: columns.indexOf('Rating'),
      ratingCount: columns.indexOf('Rating Count')
    }
  }

  private extractVersionNameFromReleaseName(releaseName: string): string | null {
    return parseVrSrcReleaseName(releaseName)?.versionName ?? null
  }

  private shouldIncludeCatalogItem(sizeBytes: number): boolean {
    return Number.isFinite(sizeBytes) && sizeBytes > 0
  }

  private async buildCatalog(
    logger?: VrSrcLogger,
    options?: {
      rootPath?: string
      catalogPath?: string
      assetRootPath?: string
    }
  ): Promise<VrSrcCatalogResponse> {
    const rootPath = options?.rootPath ?? this.getMetaExtractPath()
    const catalogPath = options?.catalogPath ?? this.getCatalogPath()
    const assetRootPath = options?.assetRootPath ?? rootPath
    const gameListPath =
      (await this.findFirstMatchingFile(rootPath, ['VRP-GameList.txt', 'GameList.txt'])) ??
      join(rootPath, 'VRP-GameList.txt')
    const thumbnailsPath = join(rootPath, '.meta', 'thumbnails')
    const assetThumbnailsPath = join(assetRootPath, '.meta', 'thumbnails')
    await logger?.debug('Building vrSrc catalog from extracted metadata.', {
      gameListPath,
      thumbnailsPath
    })
    const raw = await readFile(gameListPath, 'utf8')
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)

    if (!lines.length) {
      return { syncedAt: new Date().toISOString(), items: [] }
    }

    const indexes = this.readCatalogHeaderIndexes(lines[0])
    const items: VrSrcCatalogItem[] = []
    let artworkCount = 0
    let excludedZeroSizeCount = 0

    for (const line of lines.slice(1)) {
      const parts = line.split(';')
      const name = parts[indexes.gameName]?.trim()
      const releaseName = parts[indexes.releaseName]?.trim()
      const packageName = parts[indexes.packageName]?.trim()

      if (!name || !releaseName || !packageName) {
        continue
      }

      const sizeMbRaw = parts[indexes.sizeMb]?.trim() ?? '0'
      const sizeMb = Number.parseFloat(sizeMbRaw)
      const sizeBytes = Number.isFinite(sizeMb) ? Math.max(0, Math.round(sizeMb * 1024 * 1024)) : 0
      if (!this.shouldIncludeCatalogItem(sizeBytes)) {
        excludedZeroSizeCount += 1
        continue
      }

      const artworkPath = join(thumbnailsPath, `${packageName}.jpg`)
      const artworkAssetPath = join(assetThumbnailsPath, `${packageName}.jpg`)
      const artworkUrl = (await this.fileExists(artworkPath)) ? this.toLocalAssetUri(artworkAssetPath) : null
      if (artworkUrl) {
        artworkCount += 1
      }

      items.push({
        id: packageName,
        name,
        releaseName,
        packageName,
        versionCode: parts[indexes.versionCode]?.trim() ?? '',
        versionName: this.extractVersionNameFromReleaseName(releaseName),
        lastUpdated: parts[indexes.lastUpdated]?.trim() ?? '',
        sizeLabel: `${sizeMbRaw} MB`,
        sizeBytes,
        downloads: Number.parseFloat(parts[indexes.downloads]?.trim() ?? '0') || 0,
        rating: Number.parseFloat(parts[indexes.rating]?.trim() ?? '0') || 0,
        ratingCount: Number.parseFloat(parts[indexes.ratingCount]?.trim() ?? '0') || 0,
        artworkUrl,
        note: null
      })
    }

    const catalog = {
      syncedAt: new Date().toISOString(),
      items,
      brokenDownloads: []
    }

    await writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf8')
    await logger?.info('vrSrc catalog rebuilt successfully.', {
      itemCount: items.length,
      excludedZeroSizeCount,
      artworkCount,
      missingArtworkCount: items.length - artworkCount,
      syncedAt: catalog.syncedAt,
      catalogPath
    })
    return catalog
  }

  private async readCatalog(): Promise<VrSrcCatalogResponse> {
    try {
      const raw = await readFile(this.getCatalogPath(), 'utf8')
      const parsed = JSON.parse(raw) as VrSrcCatalogResponse
      const items = Array.isArray(parsed.items)
        ? parsed.items
            .map((item) => ({
              ...item,
              artworkUrl: this.normalizeVrSrcArtworkUrl(item?.artworkUrl),
              versionName:
                typeof item?.versionName === 'string'
                  ? item.versionName
                  : typeof item?.releaseName === 'string'
                    ? this.extractVersionNameFromReleaseName(item.releaseName)
                    : null
            }))
            .filter((item) => this.shouldIncludeCatalogItem(item.sizeBytes))
        : []
      return {
        syncedAt: parsed.syncedAt ?? null,
        items,
        brokenDownloads: await this.readBrokenDownloadsForCatalog(items)
      }
    } catch {
      return {
        syncedAt: null,
        items: [],
        brokenDownloads: []
      }
    }
  }

  private buildSyncDelta(previousCatalog: VrSrcCatalogResponse, nextCatalog: VrSrcCatalogResponse): VrSrcSyncDelta {
    const previousItemsByPackageName = previousCatalog.items.reduce((itemsByPackageName, item) => {
      const packageName = item.packageName.trim().toLowerCase()
      if (packageName) {
        itemsByPackageName.set(packageName, item)
      }
      return itemsByPackageName
    }, new Map<string, VrSrcCatalogItem>())
    const hasBaseline = Boolean(previousCatalog.syncedAt && previousItemsByPackageName.size)

    if (!hasBaseline) {
      return {
        hasBaseline: false,
        baselineSyncedAt: previousCatalog.syncedAt,
        syncedAt: nextCatalog.syncedAt,
        newItems: [],
        knownCount: 0,
        versionChangeCount: 0
      }
    }

    let knownCount = 0
    let versionChangeCount = 0
    const newItems: VrSrcCatalogItem[] = []

    for (const item of nextCatalog.items) {
      const previousItem = previousItemsByPackageName.get(item.packageName.trim().toLowerCase())
      if (!previousItem) {
        newItems.push(item)
        continue
      }

      knownCount += 1
      if (previousItem.versionCode.trim() !== item.versionCode.trim()) {
        versionChangeCount += 1
      }
    }

    return {
      hasBaseline: true,
      baselineSyncedAt: previousCatalog.syncedAt,
      syncedAt: nextCatalog.syncedAt,
      newItems,
      knownCount,
      versionChangeCount
    }
  }

  private async buildStatus(): Promise<VrSrcStatusResponse> {
    const { spareValue } = await settingsService.getSettings()
    if (!spareValue?.trim()) {
      return {
        configured: false,
        baseUriHost: null,
        lastResolvedAt: null,
        lastSyncAt: null,
        itemCount: 0,
        message: 'vrSrc is not configured yet.'
      }
    }

    const catalog = await this.readCatalog()
    const credentials = await this.readCachedCredentials()

    return {
      configured: Boolean(credentials?.baseUri && credentials?.password),
      baseUriHost: credentials?.baseUri ? new URL(credentials.baseUri).host : null,
      lastResolvedAt: credentials?.lastResolvedAt ?? null,
      lastSyncAt: catalog.syncedAt,
      itemCount: catalog.items.length,
      message: credentials
        ? catalog.syncedAt
          ? `vrSrc is ready and last synced ${new Date(catalog.syncedAt).toLocaleString()}.`
          : 'vrSrc credentials are ready. Sync the source to build the remote catalog.'
        : 'vrSrc is not configured yet.'
    }
  }

  private async listRemotePayloadFiles(
    baseUri: string,
    releaseName: string,
    logger?: VrSrcLogger
  ): Promise<VrSrcRemotePayloadFile[]> {
    const hash = createHash('md5').update(`${releaseName}\n`).digest('hex')
    try {
      const args = ['lsjson', `:http:/${hash}/`, ...(await this.getVrSrcRcloneArgs(baseUri))]
      if (logger) {
        args.push('-vv')
      }
      const { stdout, stderr } = await execFileAsync(await this.getRclonePath(), args, {
        maxBuffer: 8 * 1024 * 1024
      })
      await this.logCommandOutput(logger, 'payload-list', stderr)
      const parsed = JSON.parse(stdout) as Array<{
        Path?: string
        Name?: string
        Size?: number
        IsDir?: boolean
      }>
      return parsed
        .filter((entry) => !entry?.IsDir)
        .map((entry) => ({
          fileName: entry.Path ?? entry.Name ?? '',
          sizeBytes: typeof entry.Size === 'number' && Number.isFinite(entry.Size) ? entry.Size : null
        }))
        .filter((entry) => Boolean(entry.fileName))
    } catch (error) {
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string'
          ? error.stderr
          : ''
      await this.logCommandOutput(logger, 'payload-list', stderr)
      throw error
    }
  }

  private async downloadReleasePayloadWithRclone(
    baseUri: string,
    releaseName: string,
    destinationPath: string,
    control: VrSrcTransferControlState,
    totalBytes: number | null,
    logger?: VrSrcLogger
  ): Promise<void> {
    const hash = createHash('md5').update(`${releaseName}\n`).digest('hex')

    while (true) {
      if (control) {
        await this.checkpointTransferControl(control)
      }

      try {
        await new Promise<void>(async (resolve, reject) => {
          const args = ['copy', `:http:/${hash}/`, destinationPath, ...(await this.getVrSrcRcloneTransferArgs(baseUri))]
          if (logger) {
            args.push('-vv')
          }
          const startingTransferredBytes = await this.calculatePathSize(destinationPath)
          const child = spawn(await this.getRclonePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
          control.child = child
          control.status = 'running'
          let stderr = ''
          let progressBuffer = ''
          let lastTransferredBytes = startingTransferredBytes
          let lastSampleAt = Date.now()
          let lastStatsAt = 0
          let latestKnownTotalBytes = totalBytes
          let lastEmittedSignature = ''

          const emitProgress = async (transferredBytes: number, progressTotalBytes: number | null, percent: number | null) => {
            const effectiveTotalBytes = progressTotalBytes ?? latestKnownTotalBytes ?? totalBytes
            if (effectiveTotalBytes !== null) {
              latestKnownTotalBytes = effectiveTotalBytes
            }

            const normalizedTransferredBytes =
              effectiveTotalBytes !== null
                ? Math.min(effectiveTotalBytes, transferredBytes)
                : transferredBytes
            const monotonicTransferredBytes = Math.max(lastTransferredBytes, normalizedTransferredBytes)

            const now = Date.now()
            const elapsedSeconds = Math.max((now - lastSampleAt) / 1000, 0.25)
            const speedBytesPerSecond =
              monotonicTransferredBytes >= lastTransferredBytes
                ? (monotonicTransferredBytes - lastTransferredBytes) / elapsedSeconds
                : null

            lastTransferredBytes = monotonicTransferredBytes
            lastSampleAt = now
            lastStatsAt = now

            const derivedProgress = effectiveTotalBytes
              ? (monotonicTransferredBytes / effectiveTotalBytes) * 100
              : percent
            const progress =
              derivedProgress !== null && Number.isFinite(derivedProgress)
                ? Math.min(94, Math.max(1, Math.round(derivedProgress)))
                : 22
            const etaSeconds =
              effectiveTotalBytes && speedBytesPerSecond && speedBytesPerSecond > 0
                ? Math.max(0, Math.round((effectiveTotalBytes - monotonicTransferredBytes) / speedBytesPerSecond))
                : null

            const signature = `${progress}:${monotonicTransferredBytes}:${effectiveTotalBytes ?? 'null'}`
            if (signature === lastEmittedSignature) {
              return
            }
            lastEmittedSignature = signature

            this.emitControlledTransferProgress(control, {
              operation: control.operation,
              releaseName,
              phase: 'downloading',
              progress,
              fileName: null,
              transferredBytes: monotonicTransferredBytes,
              totalBytes: effectiveTotalBytes,
              speedBytesPerSecond: speedBytesPerSecond && Number.isFinite(speedBytesPerSecond) ? speedBytesPerSecond : null,
              etaSeconds
            })
          }

          const intervalId = setInterval(() => {
            void (async () => {
              if (Date.now() - lastStatsAt < 2000) {
                return
              }

              const transferredBytes = await this.calculatePathSize(destinationPath)
              if (transferredBytes <= lastTransferredBytes) {
                return
              }

              await emitProgress(transferredBytes, latestKnownTotalBytes, null)
            })()
          }, 1000)

          child.stderr.on('data', (chunk) => {
            const text = chunk.toString()
            stderr += text
            progressBuffer = `${progressBuffer}${text}`.slice(-8192)
            const stats = this.parseRcloneTransferStats(progressBuffer)
            if (stats && stats.percent !== null) {
              const effectiveStatsTotalBytes = stats.totalBytes ?? latestKnownTotalBytes ?? totalBytes
              const transferredBytes =
                stats.transferredBytes ??
                (effectiveStatsTotalBytes !== null ? Math.round((stats.percent / 100) * effectiveStatsTotalBytes) : null)
              if (transferredBytes !== null) {
                void emitProgress(startingTransferredBytes + transferredBytes, effectiveStatsTotalBytes, stats.percent)
              }
            }
            void this.logCommandOutput(logger, 'payload-download', text)
          })

          child.once('error', (error) => {
            clearInterval(intervalId)
            control.child = null
            reject(error)
          })

          child.once('close', async (code) => {
            clearInterval(intervalId)
            await emitProgress(lastTransferredBytes, latestKnownTotalBytes, null)
            control.child = null
            if (code === 0) {
              resolve()
              return
            }

            if (control.command === 'pause') {
              control.command = 'none'
              control.status = 'paused'
              reject(new VrSrcTransferPausedError())
              return
            }

            if (control.command === 'cancel' || control.status === 'cancelled') {
              control.command = 'none'
              control.status = 'cancelled'
              reject(new VrSrcTransferCancelledError())
              return
            }

            reject(new Error(stderr.trim() || `rclone exited with code ${code ?? 'unknown'}.`))
          })
        })

        return
      } catch (error) {
        if (!(error instanceof VrSrcTransferPausedError)) {
          await logger?.error('Payload download failed.', {
            releaseName,
            destinationPath,
            error: error instanceof Error ? error.message : String(error)
          })
        }

        if (error instanceof VrSrcTransferPausedError) {
          await this.waitForTransferResume(control)
          continue
        }

        throw error
      }
    }
  }

  private async ensureReleasePayload(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null,
    options?: {
      libraryTargetPath?: string | null
      requiredExtractionBytes?: number | null
    }
  ): Promise<VrSrcReleasePayloadResult> {
    const acquireKey = options?.libraryTargetPath ? `${releaseName}::${options.libraryTargetPath}` : releaseName
    const cachedPromise = this.acquireInFlight.get(acquireKey)
    if (cachedPromise) {
      return cachedPromise
    }

    const acquirePromise = (async () => {
      const control = this.getOrCreateTransferControl(releaseName, operation, serial)
      const credentials = await this.resolveCredentials()
      const decodedPassword = Buffer.from(credentials.password, 'base64').toString('utf8')
      const folderName = this.sanitizeSegment(releaseName)
      const payloadPath = join(this.getDownloadsPath(), folderName)
      const extractedMarkerPath = join(payloadPath, '.questvault-vrsrc-ready')

      if (await this.fileExists(extractedMarkerPath)) {
        return {
          payloadPath,
          libraryTargetPath: null,
          extractedToLibraryTarget: false
        }
      }

      await mkdir(payloadPath, { recursive: true })
      const payloadFiles = await this.listRemotePayloadFiles(credentials.baseUri, releaseName)
      if (!payloadFiles.length) {
        throw new Error(`vrSrc did not return any payload files for ${releaseName}.`)
      }

      const payloadSizes = payloadFiles.map((file) => file.sizeBytes)
      const hasKnownTotalBytes = payloadSizes.every((size) => typeof size === 'number')
      const totalBytes = hasKnownTotalBytes
        ? payloadSizes.reduce((sum, size) => sum + (size ?? 0), 0)
        : null

      if (this.activePayloadDownloads >= this.maxConcurrentPayloadDownloads) {
        this.emitControlledTransferProgress(control, {
          operation,
          releaseName,
          phase: 'waiting-for-download',
          progress: 0,
          fileName: null,
          transferredBytes: 0,
          totalBytes,
          speedBytesPerSecond: null,
          etaSeconds: null
        })
      }

      await this.checkpointTransferControl(control)
      const releaseDownloadSlot = await this.acquirePayloadDownloadSlot()
      try {
        await this.checkpointTransferControl(control)
        this.emitControlledTransferProgress(control, {
          operation,
          releaseName,
          phase: 'preparing',
          progress: 6,
          fileName: null,
          transferredBytes: 0,
          totalBytes,
          speedBytesPerSecond: null,
          etaSeconds: null
        })

        let validation: VrSrcPayloadValidationResult | null = null
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          await this.downloadReleasePayloadWithRclone(
            credentials.baseUri,
            releaseName,
            payloadPath,
            control,
            totalBytes,
            undefined
          )

          validation = await this.validateDownloadedPayload(payloadPath, payloadFiles)
          if (validation.ok) {
            await this.removeBrokenDownloadMarker(releaseName, payloadPath)
            break
          }

          if (attempt === 1) {
            this.emitControlledTransferProgress(control, {
              operation,
              releaseName,
              phase: 'downloading',
              progress: 94,
              fileName: 'Retrying incomplete download...',
              transferredBytes: await this.calculatePathSize(payloadPath),
              totalBytes,
              speedBytesPerSecond: null,
              etaSeconds: null
            })
          }
        }

        if (!validation?.ok) {
          if (validation) {
            await this.writeBrokenDownloadMarker(releaseName, payloadPath, validation)
          }
          throw new VrSrcBrokenDownloadError(releaseName, validation ?? {
            ok: false,
            expectedCount: payloadFiles.length,
            completeCount: 0,
            partialFiles: [],
            missingFiles: payloadFiles.map((file) => this.getPayloadRelativePath(file.fileName)).filter(Boolean),
            sizeMismatches: []
          })
        }
      } finally {
        releaseDownloadSlot()
      }

      const archivePart = payloadFiles.find((file) => /\.7z\.001$/i.test(file.fileName))
      let extractedToLibraryTarget = false
      const libraryTargetPath = options?.libraryTargetPath?.trim() || null
      if (archivePart) {
        if (this.activeExtractionImports >= this.maxConcurrentExtractionImports) {
          this.emitControlledTransferProgress(control, {
            operation,
            releaseName,
            phase: 'waiting-for-extraction',
            progress: 94,
            fileName: basename(archivePart.fileName),
            transferredBytes: totalBytes ?? (await this.calculatePathSize(payloadPath)),
            totalBytes,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        }

        await this.checkpointTransferControl(control)
        const releaseExtractionSlot = await this.acquireExtractionImportSlot()
        try {
          await this.checkpointTransferControl(control)
          extractedToLibraryTarget = await this.shouldExtractDirectlyToLibraryTarget(
            payloadPath,
            libraryTargetPath,
            options?.requiredExtractionBytes ?? null
          )
          const extractionDestinationPath = extractedToLibraryTarget && libraryTargetPath ? libraryTargetPath : payloadPath
          this.emitControlledTransferProgress(control, {
            operation,
            releaseName,
            phase: 'extracting',
            progress: 96,
            fileName: basename(archivePart.fileName),
            transferredBytes: totalBytes ?? (await this.calculatePathSize(payloadPath)),
            totalBytes,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
          await this.extractArchive(
            join(payloadPath, basename(archivePart.fileName)),
            extractionDestinationPath,
            decodedPassword,
            undefined,
            {
              clearDestination: extractedToLibraryTarget
            }
          )
          await this.checkpointTransferControl(control)
          await this.extractNestedArchives(extractionDestinationPath)
          await this.checkpointTransferControl(control)
          await this.cleanupMultipartArchives(extractionDestinationPath)
          if (extractedToLibraryTarget) {
            await this.collapseSingleDirectoryInPlace(extractionDestinationPath)
          }
        } finally {
          releaseExtractionSlot()
        }
      }

      if (!extractedToLibraryTarget) {
        await writeFile(extractedMarkerPath, new Date().toISOString(), 'utf8')
      }
      return {
        payloadPath,
        libraryTargetPath: extractedToLibraryTarget ? libraryTargetPath : null,
        extractedToLibraryTarget
      }
    })()

    this.acquireInFlight.set(acquireKey, acquirePromise)

    try {
      return await acquirePromise
    } finally {
      this.acquireInFlight.delete(acquireKey)
    }
  }

  private async findCatalogItem(releaseName: string): Promise<VrSrcCatalogItem | null> {
    const catalog = await this.readCatalog()
    return catalog.items.find((item) => item.releaseName === releaseName) ?? null
  }

  private async createUniqueLibraryTarget(baseLibraryPath: string, releaseName: string): Promise<string> {
    const safeBaseName = this.sanitizeSegment(releaseName)
    let candidate = join(baseLibraryPath, safeBaseName)
    let suffix = 2

    while (await this.fileExists(candidate)) {
      candidate = join(baseLibraryPath, `${safeBaseName} (${suffix})`)
      suffix += 1
    }

    return candidate
  }

  private async cleanupReleasePayload(payloadPath: string | null): Promise<void> {
    if (!payloadPath) {
      return
    }

    await rm(payloadPath, { recursive: true, force: true })
  }

  private async resolveLibraryImportSource(payloadPath: string): Promise<string> {
    let currentPath = payloadPath

    while (true) {
      const entries = (await readdir(currentPath, { withFileTypes: true })).filter(
        (entry) => !entry.name.startsWith('.') && !/\.7z(\.\d+)?$/i.test(entry.name)
      )
      const directoryEntries = entries.filter((entry) => entry.isDirectory())
      const fileEntries = entries.filter((entry) => !entry.isDirectory())

      if (directoryEntries.length === 1 && fileEntries.length === 0) {
        currentPath = join(currentPath, directoryEntries[0].name)
        continue
      }

      return currentPath
    }
  }

  async getStatus(): Promise<VrSrcStatusResponse> {
    return this.buildStatus()
  }

  async getCatalog(): Promise<VrSrcCatalogResponse> {
    return this.readCatalog()
  }

  async getItemDetails(releaseName: string, gameName: string): Promise<VrSrcItemDetailsResponse> {
    const [note, trailerVideoId] = await Promise.all([
      this.readNoteForRelease(releaseName),
      this.getTrailerVideoId(gameName)
    ])

    return {
      releaseName,
      note,
      trailerVideoId
    }
  }

  async syncCatalog(): Promise<VrSrcSyncResponse> {
    const { spareValue } = await settingsService.getSettings()
    if (!spareValue?.trim()) {
      return {
        success: false,
        message: 'vrSrc is not configured yet.',
        details: 'Add the hidden remote-source key before syncing.',
        usedCachedCatalog: false,
        delta: null,
        status: await this.buildStatus(),
        catalog: {
          syncedAt: null,
          items: []
        }
      }
    }

    if (this.syncInFlight) {
      return this.syncInFlight
    }

    this.syncInFlight = (async () => {
      const logger = await this.createLogger('sync-catalog')
      try {
        await logger.info('vrSrc sync started.')
        await this.ensureDirectories()
        const baselineCatalog = await this.readCatalog()
        const credentials = await this.resolveCredentials(logger)
        const decodedPassword = Buffer.from(credentials.password, 'base64').toString('utf8')
        const stagedArchivePath = this.getStagedMetaArchivePath()
        const stagedExtractPath = this.getStagedMetaExtractPath()
        const stagedCatalogPath = this.getStagedCatalogPath()
        await rm(stagedArchivePath, { force: true })
        await rm(stagedExtractPath, { recursive: true, force: true })
        await rm(stagedCatalogPath, { force: true })
        await logger.debug('Resolved vrSrc sync target.', {
          baseUriHost: new URL(credentials.baseUri).host,
          credentialsPath: this.getCredentialsPath(),
          archivePath: stagedArchivePath,
          extractPath: stagedExtractPath,
          catalogPath: stagedCatalogPath
        })
        await this.syncMetaArchiveWithRclone(credentials.baseUri, stagedArchivePath, logger)
        const shouldPromoteStagedArchive =
          (await this.isStagedMetaArchiveNewerOrDifferent(stagedArchivePath)) ||
          !(await this.fileExists(this.getMetaExtractPath())) ||
          !(await this.fileExists(this.getCatalogPath()))

        if (!shouldPromoteStagedArchive) {
          await logger.info('Downloaded vrSrc metadata matches the current archive. Keeping the existing cache intact.')
          await rm(stagedArchivePath, { force: true })
          const catalog = await this.readCatalog()
          const status = await this.buildStatus()
          return {
            success: true,
            message: `vrSrc metadata is already current with ${catalog.items.length} remote entries.`,
            details: null,
            usedCachedCatalog: false,
            delta: this.buildSyncDelta(baselineCatalog, catalog),
            status,
            catalog
          }
        }

        await this.extractArchive(stagedArchivePath, stagedExtractPath, decodedPassword, logger)
        const catalog = await this.buildCatalog(logger, {
          rootPath: stagedExtractPath,
          catalogPath: stagedCatalogPath,
          assetRootPath: this.getMetaExtractPath()
        })
        await this.finalizeStagedCatalog(stagedArchivePath, stagedExtractPath, stagedCatalogPath, logger)
        const status = await this.buildStatus()
        await logger.info('vrSrc sync completed successfully.', {
          itemCount: catalog.items.length,
          lastSyncAt: status.lastSyncAt,
          logPath: logger.logPath
        })

        return {
          success: true,
          message: `vrSrc synced ${catalog.items.length} remote entries.`,
          details: null,
          usedCachedCatalog: false,
          delta: this.buildSyncDelta(baselineCatalog, catalog),
          status,
          catalog
        }
      } catch (error) {
        await logger.error('vrSrc sync failed.', error)
        const catalog = await this.readCatalog()
        const status = await this.buildStatus()
        const errorMessage = error instanceof Error ? error.message : String(error)
        const cloudflareHint = this.isCloudflareForbidden(errorMessage)
          ? '\nvrSrc was reachable, but Cloudflare rejected the request. QuestVault now prefers IPv4 for vrSrc on Windows; if this persists, retry from another network.'
          : ''
        const fallbackMessage = Boolean(catalog.syncedAt || catalog.items.length)
          ? `Sync failed and QuestVault is showing cached vrSrc data. See log: ${logger.logPath}`
          : `Sync failed before any cached vrSrc data was available. See log: ${logger.logPath}`
        await logger.warn('vrSrc sync is returning cached status to the app.', {
          usedCachedCatalog: Boolean(catalog.syncedAt || catalog.items.length),
          cachedItemCount: catalog.items.length,
          lastSyncAt: catalog.syncedAt
        })
        return {
          success: false,
          message: 'Unable to sync vrSrc.',
          details: `${errorMessage}${cloudflareHint}\n${fallbackMessage}`,
          usedCachedCatalog: Boolean(catalog.syncedAt || catalog.items.length),
          delta: null,
          status,
          catalog
        }
      } finally {
        await rm(this.getStagedMetaArchivePath(), { force: true }).catch(() => undefined)
        await rm(this.getStagedMetaExtractPath(), { recursive: true, force: true }).catch(() => undefined)
        await rm(this.getStagedCatalogPath(), { force: true }).catch(() => undefined)
        await logger.info('vrSrc sync finished.', {
          inFlightDownloads: this.activePayloadDownloads,
          inFlightExtractionImports: this.activeExtractionImports
        })
        this.syncInFlight = null
      }
    })()

    return this.syncInFlight
  }

  async clearCache(): Promise<VrSrcClearCacheResponse> {
    if (this.syncInFlight) {
      const status = await this.buildStatus()
      const catalog = await this.readCatalog()
      return {
        success: false,
        message: 'Unable to clear the vrSrc cache while a sync is in progress.',
        details: 'Wait for the current vrSrc sync to finish, then try clearing the cache again.',
        status,
        catalog
      }
    }

    try {
      await this.resetCachedState({
        includeCatalog: true,
        includeDownloads: true,
        includeCredentials: true,
        reason: 'Manual cache clear requested.'
      })
      const status = await this.buildStatus()
      const catalog = await this.readCatalog()

      return {
        success: true,
        message: 'Cleared the cached vrSrc catalog, metadata, downloads, and credentials.',
        details: 'Run Sync Source to resolve fresh vrSrc credentials and rebuild the remote catalog from scratch.',
        status,
        catalog
      }
    } catch (error) {
      const status = await this.buildStatus()
      const catalog = await this.readCatalog()
      return {
        success: false,
        message: 'Unable to clear the vrSrc cache.',
        details: error instanceof Error ? error.message : String(error),
        status,
        catalog
      }
    }
  }

  async clearBrokenDownload(releaseName: string): Promise<VrSrcClearBrokenDownloadResponse> {
    const normalizedReleaseName = releaseName.trim()
    if (!normalizedReleaseName) {
      return {
        success: false,
        message: 'Unable to clear broken vrSrc release files.',
        details: 'No release name was provided.',
        status: await this.buildStatus(),
        catalog: await this.readCatalog()
      }
    }

    const payloadPath = join(this.getDownloadsPath(), this.sanitizeSegment(normalizedReleaseName))
    try {
      await rm(payloadPath, { recursive: true, force: true })
      await mkdir(this.getDownloadsPath(), { recursive: true })
      return {
        success: true,
        message: `Cleared broken release files for ${normalizedReleaseName}.`,
        details: 'This release remains marked as broken until a retry completes successfully.',
        status: await this.buildStatus(),
        catalog: await this.readCatalog()
      }
    } catch (error) {
      return {
        success: false,
        message: `Unable to clear broken release files for ${normalizedReleaseName}.`,
        details: error instanceof Error ? error.message : String(error),
        status: await this.buildStatus(),
        catalog: await this.readCatalog()
      }
    }
  }

  async downloadToLibrary(releaseName: string): Promise<VrSrcDownloadToLibraryResponse> {
    return await this.registerQueuedRequest(
      { releaseName, operation: 'download-to-library', serial: null },
      () => this.performDownloadToLibrary(releaseName)
    )
  }

  private async performDownloadToLibrary(releaseName: string): Promise<VrSrcDownloadToLibraryResponse> {
    const control = this.getOrCreateTransferControl(releaseName, 'download-to-library', null)
    this.emitControlledTransferProgress(control, {
      operation: 'download-to-library',
      releaseName,
      phase: 'preparing',
      progress: 4,
      fileName: null,
      transferredBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null
    })

    const settings = await settingsService.getSettings()
    const libraryPath = settings.localLibraryPath?.trim() ?? ''

    if (!libraryPath) {
      return {
        success: false,
        cancelled: false,
        releaseName,
        sourcePath: null,
        targetPath: null,
        packageName: null,
        message: 'Select a Local Library path before adding vrSrc items.',
        details: null
      }
    }

    try {
      const catalogItem = await this.findCatalogItem(releaseName)
      const targetPath = await this.createUniqueLibraryTarget(libraryPath, releaseName)
      const payloadResult = await this.ensureReleasePayload(releaseName, 'download-to-library', null, {
        libraryTargetPath: targetPath,
        requiredExtractionBytes: this.getRequiredExtractionBytes(catalogItem?.sizeBytes ?? null)
      })
      const sourcePath = payloadResult.payloadPath
      const importSourcePath = payloadResult.extractedToLibraryTarget
        ? payloadResult.libraryTargetPath
        : await this.resolveLibraryImportSource(sourcePath)
      if (payloadResult.extractedToLibraryTarget) {
        await settingsService.rescanLocalLibrary()
        await settingsService.setLocalLibraryItemSourceLastUpdatedByAbsolutePath(
          targetPath,
          catalogItem?.lastUpdated ?? null
        )
        await this.cleanupReleasePayload(sourcePath)

        return {
          success: true,
          cancelled: false,
          releaseName,
          sourcePath: null,
          targetPath,
          packageName: catalogItem?.packageName ?? null,
          message: `${releaseName} was added to the Local Library.`,
          details: targetPath
        }
      }

      if (!importSourcePath) {
        throw new Error('Unable to resolve extracted vrSrc payload path.')
      }

      if (this.activeExtractionImports >= this.maxConcurrentExtractionImports) {
        this.emitControlledTransferProgress(control, {
          operation: 'download-to-library',
          releaseName,
          phase: 'waiting-for-extraction',
          progress: 97,
          fileName: null,
          transferredBytes: 0,
          totalBytes: null,
          speedBytesPerSecond: null,
          etaSeconds: null
        })
      }
      const releaseImportSlot = await this.acquireExtractionImportSlot()
      try {
        this.emitControlledTransferProgress(control, {
          operation: 'download-to-library',
          releaseName,
          phase: 'importing',
          progress: 1,
          fileName: null,
          transferredBytes: 0,
          totalBytes: null,
          speedBytesPerSecond: null,
          etaSeconds: null
        })
        await this.copyPathWithProgress(importSourcePath, targetPath, ({ transferredBytes, totalBytes, fileName, progress }) => {
          this.emitControlledTransferProgress(control, {
            operation: 'download-to-library',
            releaseName,
            phase: 'importing',
            progress,
            fileName,
            transferredBytes,
            totalBytes,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        })
        this.emitControlledTransferProgress(control, {
          operation: 'download-to-library',
          releaseName,
          phase: 'importing',
          progress: 96,
          fileName: null,
          transferredBytes: 0,
          totalBytes: null,
          speedBytesPerSecond: null,
          etaSeconds: null
        })
        await settingsService.rescanLocalLibrary()
        await settingsService.setLocalLibraryItemSourceLastUpdatedByAbsolutePath(
          targetPath,
          catalogItem?.lastUpdated ?? null
        )
      } finally {
        releaseImportSlot()
      }
      await this.cleanupReleasePayload(sourcePath)

      return {
        success: true,
        cancelled: false,
        releaseName,
        sourcePath: null,
        targetPath,
        packageName: catalogItem?.packageName ?? null,
        message: `${releaseName} was added to the Local Library.`,
        details: targetPath
      }
    } catch (error) {
      if (error instanceof VrSrcTransferCancelledError) {
        return {
          success: false,
          cancelled: true,
          releaseName,
          sourcePath: null,
          targetPath: null,
          packageName: null,
          message: `${releaseName} download was cancelled.`,
          details: null
        }
      }

      return {
        success: false,
        cancelled: false,
        releaseName,
        sourcePath: null,
        targetPath: null,
        packageName: null,
        message: `Unable to add ${releaseName} to the Local Library.`,
        details: this.readTransferErrorDetails(error)
      }
    } finally {
      this.clearTransferControl(releaseName, 'download-to-library', null)
    }
  }

  async downloadToLibraryAndInstall(serial: string, releaseName: string): Promise<VrSrcDownloadAndInstallResponse> {
    return await this.registerQueuedRequest(
      { releaseName, operation: 'download-to-library-and-install', serial },
      () => this.performDownloadToLibraryAndInstall(serial, releaseName)
    )
  }

  private async performDownloadToLibraryAndInstall(
    serial: string,
    releaseName: string
  ): Promise<VrSrcDownloadAndInstallResponse> {
    const control = this.getOrCreateTransferControl(releaseName, 'download-to-library-and-install', serial)
    this.emitControlledTransferProgress(control, {
      operation: 'download-to-library-and-install',
      releaseName,
      phase: 'preparing',
      progress: 4,
      fileName: null,
      transferredBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null
    })

    const settings = await settingsService.getSettings()
    const libraryPath = settings.localLibraryPath?.trim() ?? ''

    if (!libraryPath) {
      return {
        success: false,
        cancelled: false,
        releaseName,
        serial,
        sourcePath: null,
        targetPath: null,
        packageName: null,
        message: 'Select a Local Library path before downloading and installing vrSrc items.',
        details: null,
        verificationToken: null
      }
    }

    try {
      const catalogItem = await this.findCatalogItem(releaseName)
      const targetPath = await this.createUniqueLibraryTarget(libraryPath, releaseName)
      const payloadResult = await this.ensureReleasePayload(releaseName, 'download-to-library-and-install', serial, {
        libraryTargetPath: targetPath,
        requiredExtractionBytes: this.getRequiredExtractionBytes(catalogItem?.sizeBytes ?? null)
      })
      const sourcePath = payloadResult.payloadPath
      const importSourcePath = payloadResult.extractedToLibraryTarget
        ? payloadResult.libraryTargetPath
        : await this.resolveLibraryImportSource(sourcePath)
      if (!payloadResult.extractedToLibraryTarget) {
        if (this.activeExtractionImports >= this.maxConcurrentExtractionImports) {
          this.emitControlledTransferProgress(control, {
            operation: 'download-to-library-and-install',
            releaseName,
            phase: 'waiting-for-extraction',
            progress: 97,
            fileName: null,
            transferredBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        }

        if (!importSourcePath) {
          throw new Error('Unable to resolve extracted vrSrc payload path.')
        }

        const releaseImportSlot = await this.acquireExtractionImportSlot()
        try {
          this.emitControlledTransferProgress(control, {
            operation: 'download-to-library-and-install',
            releaseName,
            phase: 'importing',
            progress: 1,
            fileName: null,
            transferredBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
          await this.copyPathWithProgress(importSourcePath, targetPath, ({ transferredBytes, totalBytes, fileName, progress }) => {
            this.emitControlledTransferProgress(control, {
              operation: 'download-to-library-and-install',
              releaseName,
              phase: 'importing',
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              speedBytesPerSecond: null,
              etaSeconds: null
            })
          })
          this.emitControlledTransferProgress(control, {
            operation: 'download-to-library-and-install',
            releaseName,
            phase: 'importing',
            progress: 96,
            fileName: null,
            transferredBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        } finally {
          releaseImportSlot()
        }
      }

      await settingsService.rescanLocalLibrary()
      await settingsService.setLocalLibraryItemSourceLastUpdatedByAbsolutePath(
        targetPath,
        catalogItem?.lastUpdated ?? null
      )

      const installResponse = await deviceService.installManualPath(serial, targetPath, {
        onQueued: async () => {
          const control = this.getTransferControl(releaseName, 'download-to-library-and-install', serial)
          if (!control) {
            this.emitTransferProgress({
              operation: 'download-to-library-and-install',
              releaseName,
              serial,
              phase: 'waiting-for-install',
              progress: 97,
              fileName: null,
              transferredBytes: 0,
              totalBytes: null,
              speedBytesPerSecond: null,
              etaSeconds: null,
              canPause: false,
              canResume: false,
              canCancel: false
            })
            return
          }

          this.emitControlledTransferProgress(control, {
            operation: 'download-to-library-and-install',
            releaseName,
            phase: 'waiting-for-install',
            progress: 97,
            fileName: null,
            transferredBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        },
        onStarted: async () => {
          const control = this.getTransferControl(releaseName, 'download-to-library-and-install', serial)
          if (!control) {
            this.emitTransferProgress({
              operation: 'download-to-library-and-install',
              releaseName,
              serial,
              phase: 'installing',
              progress: 98,
              fileName: null,
              transferredBytes: 0,
              totalBytes: null,
              speedBytesPerSecond: null,
              etaSeconds: null,
              canPause: false,
              canResume: false,
              canCancel: false
            })
            return
          }

          this.emitControlledTransferProgress(control, {
            operation: 'download-to-library-and-install',
            releaseName,
            phase: 'installing',
            progress: 98,
            fileName: null,
            transferredBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        }
      })

      await this.cleanupReleasePayload(sourcePath)

      return {
        success: installResponse.success,
        cancelled: false,
        releaseName,
        serial,
        sourcePath: null,
        targetPath,
        packageName: installResponse.packageName ?? catalogItem?.packageName ?? null,
        message: installResponse.success
          ? `${releaseName} was added to the Local Library and installed on the selected headset.`
          : `${releaseName} was added to the Local Library, but the headset install did not complete.`,
        details: installResponse.details ?? targetPath,
        verificationToken: installResponse.verificationToken
      }
    } catch (error) {
      if (error instanceof VrSrcTransferCancelledError) {
        return {
          success: false,
          cancelled: true,
          releaseName,
          serial,
          sourcePath: null,
          targetPath: null,
          packageName: null,
          message: `${releaseName} download was cancelled.`,
          details: null,
          verificationToken: null
        }
      }

      return {
        success: false,
        cancelled: false,
        releaseName,
        serial,
        sourcePath: null,
        targetPath: null,
        packageName: null,
        message: `Unable to download and install ${releaseName} from vrSrc.`,
        details: this.readTransferErrorDetails(error),
        verificationToken: null
      }
    } finally {
      this.clearTransferControl(releaseName, 'download-to-library-and-install', serial)
    }
  }

  async installNow(serial: string, releaseName: string): Promise<VrSrcInstallNowResponse> {
    return await this.registerQueuedRequest(
      { releaseName, operation: 'install-now', serial },
      () => this.performInstallNow(serial, releaseName)
    )
  }

  private async performInstallNow(serial: string, releaseName: string): Promise<VrSrcInstallNowResponse> {
    const control = this.getOrCreateTransferControl(releaseName, 'install-now', serial)
    this.emitControlledTransferProgress(control, {
      operation: 'install-now',
      releaseName,
      phase: 'preparing',
      progress: 4,
      fileName: null,
      transferredBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null
    })

    try {
      const payloadResult = await this.ensureReleasePayload(releaseName, 'install-now', serial)
      const sourcePath = payloadResult.payloadPath
      const installResponse = await deviceService.installManualPath(serial, sourcePath, {
        onQueued: async () => {
          const control = this.getTransferControl(releaseName, 'install-now', serial)
          if (!control) {
            this.emitTransferProgress({
              operation: 'install-now',
              releaseName,
              serial,
              phase: 'waiting-for-install',
              progress: 97,
              fileName: null,
              transferredBytes: 0,
              totalBytes: null,
              speedBytesPerSecond: null,
              etaSeconds: null,
              canPause: false,
              canResume: false,
              canCancel: false
            })
            return
          }
          this.emitControlledTransferProgress(control, {
            operation: 'install-now',
            releaseName,
            phase: 'waiting-for-install',
            progress: 97,
            fileName: null,
            transferredBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        },
        onStarted: async () => {
          const control = this.getTransferControl(releaseName, 'install-now', serial)
          if (!control) {
            this.emitTransferProgress({
              operation: 'install-now',
              releaseName,
              serial,
              phase: 'installing',
              progress: 98,
              fileName: null,
              transferredBytes: 0,
              totalBytes: null,
              speedBytesPerSecond: null,
              etaSeconds: null,
              canPause: false,
              canResume: false,
              canCancel: false
            })
            return
          }
          this.emitControlledTransferProgress(control, {
            operation: 'install-now',
            releaseName,
            phase: 'installing',
            progress: 98,
            fileName: null,
            transferredBytes: 0,
            totalBytes: null,
            speedBytesPerSecond: null,
            etaSeconds: null
          })
        }
      })
      if (installResponse.success) {
        await this.cleanupReleasePayload(sourcePath)
      }
      const catalogItem = await this.findCatalogItem(releaseName)

      return {
        success: installResponse.success,
        cancelled: false,
        releaseName,
        serial,
        sourcePath: installResponse.success ? null : sourcePath,
        packageName: installResponse.packageName ?? catalogItem?.packageName ?? null,
        message: installResponse.message,
        details: installResponse.details,
        verificationToken: installResponse.verificationToken
      }
    } catch (error) {
      if (error instanceof VrSrcTransferCancelledError) {
        return {
          success: false,
          cancelled: true,
          releaseName,
          serial,
          sourcePath: null,
          packageName: null,
          message: `${releaseName} install was cancelled.`,
          details: null,
          verificationToken: null
        }
      }

      return {
        success: false,
        cancelled: false,
        releaseName,
        serial,
        sourcePath: null,
        packageName: null,
        message: `Unable to install ${releaseName} from vrSrc.`,
        details: this.readTransferErrorDetails(error),
        verificationToken: null
      }
    } finally {
      this.clearTransferControl(releaseName, 'install-now', serial)
    }
  }

  async pauseTransfer(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null
  ): Promise<VrSrcTransferControlResponse> {
    const control = this.getTransferControl(releaseName, operation, serial)
    const queuedRecord = this.getQueuedRequestRecord(releaseName, operation, serial)
    if (!control || control.operation !== operation) {
      return {
        success: false,
        releaseName,
        operation,
        serial,
        message: 'No active vrSrc transfer was found to pause.',
        details: null
      }
    }

    if (control.child === null && queuedRecord && queuedRecord.state !== 'running') {
      queuedRecord.state = 'paused'
      control.status = 'paused'
      control.command = 'pause'
      await this.persistQueuedRequests()
      this.emitControlledTransferProgress(control, {
        operation,
        releaseName,
        phase: 'paused',
        progress: control.lastUpdate?.progress ?? 0,
        fileName: control.lastUpdate?.fileName ?? null,
        transferredBytes: control.lastUpdate?.transferredBytes ?? 0,
        totalBytes: control.lastUpdate?.totalBytes ?? null,
        speedBytesPerSecond: null,
        etaSeconds: null
      })
      return {
        success: true,
        releaseName,
        operation,
        serial,
        message: `Paused ${releaseName}.`,
        details: null
      }
    }

    if (control.status === 'paused') {
      return {
        success: true,
        releaseName,
        operation,
        serial,
        message: `${releaseName} is already paused.`,
        details: null
      }
    }

    control.command = 'pause'
    if (control.child) {
      control.child.kill('SIGTERM')
    } else {
      control.status = 'paused'
      const fallbackProgress = control.lastUpdate?.progress ?? 0
      this.emitControlledTransferProgress(control, {
        operation,
        releaseName,
        phase: 'paused',
        progress: fallbackProgress,
        fileName: control.lastUpdate?.fileName ?? null,
        transferredBytes: control.lastUpdate?.transferredBytes ?? 0,
        totalBytes: control.lastUpdate?.totalBytes ?? null,
        speedBytesPerSecond: null,
        etaSeconds: null
      })
    }

    return {
      success: true,
      releaseName,
      operation,
      serial,
      message: `Paused ${releaseName}.`,
      details: null
    }
  }

  async resumeTransfer(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null
  ): Promise<VrSrcTransferControlResponse> {
    const control = this.getTransferControl(releaseName, operation, serial)
    const queuedRecord = this.getQueuedRequestRecord(releaseName, operation, serial)
    if (!control || control.operation !== operation) {
      return {
        success: false,
        releaseName,
        operation,
        serial,
        message: 'No paused vrSrc transfer was found to resume.',
        details: null
      }
    }

    if (control.child === null && queuedRecord && queuedRecord.state === 'paused') {
      queuedRecord.state = 'queued'
      control.status = 'running'
      control.command = 'none'
      await this.persistQueuedRequests()
      this.scheduleQueuedRequestDrain()
    }

    control.status = 'running'
    control.command = 'none'
    const waiters = control.waiters.splice(0)
    for (const resolve of waiters) {
      resolve()
    }

    const lastUpdate = control.lastUpdate
    if (lastUpdate) {
      const resumePhase =
        lastUpdate.phase === 'paused'
          ? control.child
            ? 'downloading'
            : lastUpdate.fileName
              ? 'downloading'
              : lastUpdate.progress > 0
                ? 'preparing'
                : 'queued'
          : lastUpdate.phase

      this.emitControlledTransferProgress(control, {
        ...lastUpdate,
        phase: resumePhase
      })
    }

    return {
      success: true,
      releaseName,
      operation,
      serial,
      message: `Resuming remaining files for ${releaseName}.`,
      details: null
    }
  }

  async cancelTransfer(
    releaseName: string,
    operation: VrSrcTransferOperation,
    serial: string | null
  ): Promise<VrSrcTransferControlResponse> {
    const control = this.getTransferControl(releaseName, operation, serial)
    const queuedRecord = this.getQueuedRequestRecord(releaseName, operation, serial)
    if (!control || control.operation !== operation) {
      return {
        success: false,
        releaseName,
        operation,
        serial,
        message: 'No active vrSrc transfer was found to cancel.',
        details: null
      }
    }

    if (control.child === null && queuedRecord && queuedRecord.state !== 'running') {
      const key = this.getQueuedRequestKey(releaseName, operation, serial)
      this.queuedRequestRecords = this.queuedRequestRecords.filter(
        (entry) => this.getQueuedRequestKey(entry.releaseName, entry.operation, entry.serial) !== key
      )
      this.queuedRequestRunners.delete(key)
      this.queuedRequestPromiseByReleaseName.delete(key)
      this.clearTransferControl(releaseName, operation, serial)
      await this.persistQueuedRequests()
      return {
        success: true,
        releaseName,
        operation,
        serial,
        message: `Cancelled ${releaseName}.`,
        details: null
      }
    }

    control.command = 'cancel'
    control.status = 'cancelled'
    const waiters = control.waiters.splice(0)
    for (const resolve of waiters) {
      resolve()
    }
    if (control.child) {
      control.child.kill('SIGTERM')
    } else {
      const fallbackProgress = control.lastUpdate?.progress ?? 0
      this.emitControlledTransferProgress(control, {
        operation,
        releaseName,
        phase: 'cancelled',
        progress: fallbackProgress,
        fileName: control.lastUpdate?.fileName ?? null,
        transferredBytes: control.lastUpdate?.transferredBytes ?? 0,
        totalBytes: control.lastUpdate?.totalBytes ?? null,
        speedBytesPerSecond: null,
        etaSeconds: null
      })
    }

    return {
      success: true,
      releaseName,
      operation,
      serial,
      message: `Cancelled ${releaseName}.`,
      details: null
    }
  }

  async clearCredentialsForHiddenKeyRemoval(): Promise<void> {
    if (this.syncInFlight) {
      return
    }

    await this.resetCachedState({
      includeCatalog: false,
      includeDownloads: false,
      includeCredentials: true,
      reason: 'Hidden remote-source key was cleared.'
    })
  }
}

export const vrSrcService = new VrSrcService()
