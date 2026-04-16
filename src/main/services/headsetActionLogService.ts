import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

type HeadsetActionKind = 'connect' | 'disconnect' | 'install' | 'uninstall'
type HeadsetActionStatus = 'started' | 'step' | 'succeeded' | 'failed'

interface HeadsetActionLogRecord {
  id: string
  action: HeadsetActionKind
  status: HeadsetActionStatus
  timestamp: string
  serial: string | null
  itemId?: string | null
  itemName?: string | null
  packageName?: string | null
  message: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface HeadsetActionContext {
  id: string
  action: HeadsetActionKind
  serial: string | null
  itemId?: string | null
  itemName?: string | null
  packageName?: string | null
}

class HeadsetActionLogService {
  private getLogPath(): string {
    return join(app.getPath('userData'), 'headset-actions.ndjson')
  }

  private async writeRecord(record: HeadsetActionLogRecord): Promise<void> {
    const logPath = this.getLogPath()
    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8')
  }

  async start(
    action: HeadsetActionKind,
    options: {
      serial: string | null
      itemId?: string | null
      itemName?: string | null
      packageName?: string | null
      message: string
      metadata?: Record<string, string | number | boolean | null>
    }
  ): Promise<HeadsetActionContext> {
    const context: HeadsetActionContext = {
      id: randomUUID(),
      action,
      serial: options.serial,
      itemId: options.itemId ?? null,
      itemName: options.itemName ?? null,
      packageName: options.packageName ?? null
    }

    await this.writeRecord({
      ...context,
      status: 'started',
      timestamp: new Date().toISOString(),
      message: options.message,
      metadata: options.metadata
    })

    return context
  }

  async step(
    context: HeadsetActionContext,
    message: string,
    metadata?: Record<string, string | number | boolean | null>
  ): Promise<void> {
    await this.writeRecord({
      ...context,
      status: 'step',
      timestamp: new Date().toISOString(),
      message,
      metadata
    })
  }

  async succeed(
    context: HeadsetActionContext,
    message: string,
    metadata?: Record<string, string | number | boolean | null>
  ): Promise<void> {
    await this.writeRecord({
      ...context,
      status: 'succeeded',
      timestamp: new Date().toISOString(),
      message,
      metadata
    })
  }

  async fail(
    context: HeadsetActionContext,
    message: string,
    metadata?: Record<string, string | number | boolean | null>
  ): Promise<void> {
    await this.writeRecord({
      ...context,
      status: 'failed',
      timestamp: new Date().toISOString(),
      message,
      metadata
    })
  }
}

export const headsetActionLogService = new HeadsetActionLogService()
