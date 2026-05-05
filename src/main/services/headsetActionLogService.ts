import { app } from 'electron'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HeadsetActionLogRecord } from '@shared/types/ipc'

type HeadsetActionKind = 'connect' | 'disconnect' | 'install' | 'uninstall' | 'reboot'
type HeadsetActionStatus = 'started' | 'step' | 'succeeded' | 'failed'

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

  async readRecent(limit = 50): Promise<{ records: HeadsetActionLogRecord[]; logPath: string }> {
    const logPath = this.getLogPath()
    try {
      const raw = await readFile(logPath, 'utf8')
      const records = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as HeadsetActionLogRecord
          } catch {
            return null
          }
        })
        .filter((record): record is HeadsetActionLogRecord => Boolean(record))
        .slice(-limit)

      return { records, logPath }
    } catch {
      return { records: [], logPath }
    }
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
