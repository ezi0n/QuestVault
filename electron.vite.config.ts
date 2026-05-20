import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

function getRendererMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
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

function qamAssetDevPlugin() {
  return {
    name: 'questvault-qam-asset-dev',
    configureServer(server: {
      middlewares: {
        use: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void
      }
    }) {
      server.middlewares.use('/__qam_asset__', async (request: IncomingMessage, response: ServerResponse) => {
        try {
          const requestUrl = new URL(request.url ?? '', 'http://127.0.0.1')
          const requestedPath = requestUrl.searchParams.get('path')
          if (!requestedPath) {
            response.statusCode = 400
            response.end('Missing asset path')
            return
          }

          const decodedAssetPath = decodeURIComponent(requestedPath)
          const payload = await readFile(decodedAssetPath)
          response.statusCode = 200
          response.setHeader('Content-Type', getRendererMimeType(decodedAssetPath))
          response.setHeader('Cache-Control', 'no-cache')
          response.end(payload)
        } catch {
          response.statusCode = 404
          response.end('Asset not found')
        }
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), qamAssetDevPlugin()]
  }
})
