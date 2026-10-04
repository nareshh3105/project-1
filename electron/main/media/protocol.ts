import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { SCHEME, MediaRegistry } from './registry'

/**
 * Serves registered media files at cbmedia://media/<id>.
 *
 * Responses allow cross-origin use: the output host draws the video into a
 * canvas, and a canvas that has held a picture from a source that did not allow
 * it can no longer be read back for encoding.
 */

export const mediaRegistry = new MediaRegistry()

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
  }])
}

/** The part of the request and the file source the handler uses. */
export interface MediaRequest { url: string; headers: Headers }
export type FileFetch = (fileUrl: string, headers: Headers) => Promise<Response>

export function createMediaHandler(registry: MediaRegistry, fetchFile: FileFetch) {
  return async (request: MediaRequest): Promise<Response> => {
    const file = registry.resolve(request.url)
    if (!file) return new Response('Not found', { status: 404 })

    let upstream: Response
    try {
      // Range requests are passed on, so a video can be played from the middle and seek.
      upstream = await fetchFile(pathToFileURL(file).toString(), request.headers)
    } catch {
      return new Response('The file could not be read', { status: 404 })
    }

    const headers = new Headers(upstream.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
    if (!headers.has('Accept-Ranges')) headers.set('Accept-Ranges', 'bytes')
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
  }
}

/** Starts serving. Runs once the app is ready. */
export function installMediaProtocol(): void {
  protocol.handle(SCHEME, createMediaHandler(mediaRegistry, (fileUrl, headers) =>
    net.fetch(fileUrl, { headers, bypassCustomProtocolHandlers: true })))
}
