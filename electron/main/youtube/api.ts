/**
 * The few YouTube Live calls a stream needs: who is signed in, and a broadcast
 * with a stream attached, ready to go live as soon as pictures arrive.
 *
 * YouTube splits a live event into a broadcast (what viewers see: title,
 * privacy) and a stream (where the video is sent). The broadcast is set to start
 * and stop by itself with the stream, so the app only has to send the video.
 */

const API = 'https://www.googleapis.com/youtube/v3'

export type Privacy = 'public' | 'unlisted' | 'private'

export interface Channel { id: string; title: string }

export interface Broadcast {
  broadcastId: string
  /** Where to send the video. */
  rtmpUrl: string
  streamKey: string
  /** Where the broadcast can be watched. */
  watchUrl: string
}

export type ApiFetch = (url: string, init: RequestInit) => Promise<Response>

async function call<T>(fetch: ApiFetch, token: string, method: string, path: string, query: Record<string, string>, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(query)}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({})) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }
  if (!res.ok) throw new Error(explain(res.status, json.error?.errors?.[0]?.reason, json.error?.message))
  return json as T
}

/** What a YouTube error means for the person. */
export function explain(status: number, reason?: string, message?: string): string {
  if (reason === 'liveStreamingNotEnabled' || reason === 'insufficientLivePermissions') {
    return 'Live streaming is not turned on for this YouTube channel. Turn it on in YouTube Studio (it can take up to 24 hours the first time).'
  }
  if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return 'YouTube is limiting how often this app can create broadcasts. Try again later, or paste a stream key instead.'
  }
  if (status === 401) return 'Your YouTube sign-in has expired. Sign in again.'
  if (status === 403) return `YouTube refused the request${message ? `: ${message}` : '.'}`
  return `YouTube could not be reached${message ? `: ${message}` : ` (error ${status}).`}`
}

export async function myChannel(fetch: ApiFetch, token: string): Promise<Channel> {
  const r = await call<{ items?: Array<{ id: string; snippet: { title: string } }> }>(fetch, token, 'GET', 'channels', { part: 'snippet', mine: 'true' })
  const c = r.items?.[0]
  if (!c) throw new Error('This Google account has no YouTube channel. Create one on YouTube first.')
  return { id: c.id, title: c.snippet.title }
}

/** Creates a broadcast and a stream, binds them, and says where to send the video. */
export async function createBroadcast(fetch: ApiFetch, token: string, opts: { title: string; privacy: Privacy; now: Date }): Promise<Broadcast> {
  const title = opts.title.trim().slice(0, 100) || 'Live with CodeBuilders'

  const broadcast = await call<{ id: string }>(fetch, token, 'POST', 'liveBroadcasts', { part: 'snippet,status,contentDetails' }, {
    snippet: { title, scheduledStartTime: opts.now.toISOString() },
    status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false },
    // Live as soon as the video arrives, and over when it stops: no buttons to press in YouTube Studio.
    contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: 'normal' },
  })

  const stream = await call<{ id: string; cdn: { ingestionInfo: { ingestionAddress: string; streamName: string } } }>(
    fetch, token, 'POST', 'liveStreams', { part: 'snippet,cdn,contentDetails' }, {
      snippet: { title: `${title} (CodeBuilders)` },
      cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
      contentDetails: { isReusable: false },
    },
  )

  await call(fetch, token, 'POST', 'liveBroadcasts/bind', { id: broadcast.id, part: 'id,contentDetails', streamId: stream.id })

  return {
    broadcastId: broadcast.id,
    rtmpUrl: stream.cdn.ingestionInfo.ingestionAddress,
    streamKey: stream.cdn.ingestionInfo.streamName,
    watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
  }
}
