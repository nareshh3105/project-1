import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { signIn, authUrl, pkcePair, refresh, usable, TOKEN_URL, type ClientConfig, type Tokens } from '../../electron/main/youtube/oauth'
import { createBroadcast, myChannel, explain } from '../../electron/main/youtube/api'
import { YoutubeAccount, loadClientConfig, type AccountDeps } from '../../electron/main/youtube/account'

/**
 * Sign-in with Google and YouTube broadcasts, against a stand-in for Google: the
 * browser step goes through a real local web server, as it would for a person,
 * and Google's token and YouTube endpoints answer from a script.
 */

const CONFIG: ClientConfig = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'shh' }

interface Call { url: string; method: string; body: string; auth: string | null }

/** A scripted Google: answers by URL, and records every call. */
function fakeGoogle(answers: Record<string, (call: Call) => { status?: number; json: unknown }>) {
  const calls: Call[] = []
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url, method: init.method ?? 'GET', body: String(init.body ?? ''),
      auth: (init.headers as Record<string, string> | undefined)?.Authorization ?? null,
    }
    calls.push(call)
    const key = Object.keys(answers).find((k) => url.startsWith(k))
    if (!key) return new Response(JSON.stringify({ error: 'not scripted' }), { status: 500 })
    const a = answers[key](call)
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 })
  }) as typeof fetch
  return { fetch, calls }
}

/** The person's browser: follows the sign-in link, "signs in", and is sent back to the app. */
function browser(outcome: { code?: string; error?: string; wrongState?: boolean } = { code: 'the-code' }) {
  const visited: string[] = []
  const openBrowser = async (url: string) => {
    visited.push(url)
    const u = new URL(url)
    const back = new URL(u.searchParams.get('redirect_uri')!)
    // A browser asks for a favicon too; that must not count as the reply.
    await fetch(new URL('/favicon.ico', back))
    if (outcome.wrongState) await fetch(`${back}?code=x&state=not-ours`).catch(() => {})
    const q = new URLSearchParams({ state: outcome.wrongState ? 'not-ours' : u.searchParams.get('state')! })
    if (outcome.code) q.set('code', outcome.code)
    if (outcome.error) q.set('error', outcome.error)
    if (!outcome.wrongState) await fetch(`${back}?${q}`)
  }
  return { openBrowser, visited }
}

const tokenAnswer = (over: Record<string, unknown> = {}) => () => ({
  json: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, ...over },
})

describe('the sign-in link', () => {
  it('asks Google for YouTube access, offline, with PKCE', () => {
    const u = new URL(authUrl(CONFIG, 'http://127.0.0.1:5000', 'challenge', 'state-1'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: CONFIG.clientId, redirect_uri: 'http://127.0.0.1:5000', response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube', code_challenge: 'challenge', code_challenge_method: 'S256',
      state: 'state-1', access_type: 'offline',
    })
  })

  it('makes a challenge that is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkcePair()
    const expected = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(challenge).toBe(expected)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
  })
})

describe('signing in', () => {
  it('opens the browser, takes the code it comes back with, and exchanges it for tokens', async () => {
    const google = fakeGoogle({ [TOKEN_URL]: tokenAnswer() })
    const b = browser()
    const tokens = await signIn(CONFIG, { fetch: google.fetch, openBrowser: b.openBrowser, now: () => 1000 })

    expect(tokens).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 1000 + 3600_000 })
    const form = new URLSearchParams(google.calls[0].body)
    expect(form.get('code')).toBe('the-code')
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('client_secret')).toBe('shh')
    // The verifier sent matches the challenge in the link the browser was given.
    const challenge = new URL(b.visited[0]).searchParams.get('code_challenge')
    expect(crypto.createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(challenge)
    // And the redirect is the same local address.
    expect(form.get('redirect_uri')).toBe(new URL(b.visited[0]).searchParams.get('redirect_uri'))
  })

  it('listens only on this computer', async () => {
    const google = fakeGoogle({ [TOKEN_URL]: tokenAnswer() })
    const b = browser()
    await signIn(CONFIG, { fetch: google.fetch, openBrowser: b.openBrowser, now: () => 0 })
    expect(new URL(new URL(b.visited[0]).searchParams.get('redirect_uri')!).hostname).toBe('127.0.0.1')
  })

  it('says so when the person cancels in the browser', async () => {
    const google = fakeGoogle({ [TOKEN_URL]: tokenAnswer() })
    await expect(signIn(CONFIG, { fetch: google.fetch, openBrowser: browser({ error: 'access_denied' }).openBrowser, now: () => 0 }))
      .rejects.toThrow('Sign-in was cancelled.')
    expect(google.calls).toEqual([])
  })

  it('ignores a reply that is not for this sign-in, and gives up in time', async () => {
    const google = fakeGoogle({ [TOKEN_URL]: tokenAnswer() })
    await expect(signIn(CONFIG, { fetch: google.fetch, openBrowser: browser({ wrongState: true }).openBrowser, now: () => 0 }, 300))
      .rejects.toThrow(/not finished in time/)
    expect(google.calls).toEqual([])
  })

  it('passes on why Google refused the code', async () => {
    const google = fakeGoogle({ [TOKEN_URL]: () => ({ status: 400, json: { error: 'invalid_client', error_description: 'Bad client' } }) })
    await expect(signIn(CONFIG, { fetch: google.fetch, openBrowser: browser().openBrowser, now: () => 0 }))
      .rejects.toThrow(/Bad client/)
  })
})

describe('keeping the sign-in fresh', () => {
  const tokens: Tokens = { accessToken: 'old', refreshToken: 'refresh-1', expiresAt: 600_000 }

  it('uses the tokens as they are while they have more than a minute left', async () => {
    const google = fakeGoogle({})
    expect(await usable(CONFIG, { fetch: google.fetch, openBrowser: () => {}, now: () => 0 }, tokens)).toBe(tokens)
    expect(google.calls).toEqual([])
  })

  it('refreshes them near the end, keeping the refresh token', async () => {
    const google = fakeGoogle({ [TOKEN_URL]: tokenAnswer({ access_token: 'new', refresh_token: undefined }) })
    const next = await usable(CONFIG, { fetch: google.fetch, openBrowser: () => {}, now: () => 590_000 }, tokens)
    expect(next).toMatchObject({ accessToken: 'new', refreshToken: 'refresh-1' })
    expect(new URLSearchParams(google.calls[0].body).get('grant_type')).toBe('refresh_token')
  })

  it('asks the person to sign in again when Google no longer honours the refresh token', async () => {
    const google = fakeGoogle({ [TOKEN_URL]: () => ({ status: 400, json: { error: 'invalid_grant' } }) })
    await expect(refresh(CONFIG, { fetch: google.fetch, openBrowser: () => {}, now: () => 0 }, tokens)).rejects.toThrow(/Sign in again/)
  })
})

describe('the YouTube calls', () => {
  const API = 'https://www.googleapis.com/youtube/v3/'
  const youtube = () => fakeGoogle({
    [`${API}channels`]: () => ({ json: { items: [{ id: 'UC1', snippet: { title: 'Naresh Plays' } }] } }),
    [`${API}liveBroadcasts/bind`]: () => ({ json: { id: 'b1' } }),
    [`${API}liveBroadcasts`]: () => ({ json: { id: 'b1' } }),
    [`${API}liveStreams`]: () => ({ json: { id: 's1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', streamName: 'abcd-efgh' } } } }),
  })

  it('names the signed-in channel', async () => {
    const g = youtube()
    expect(await myChannel(g.fetch, 'tok')).toEqual({ id: 'UC1', title: 'Naresh Plays' })
    expect(g.calls[0].auth).toBe('Bearer tok')
  })

  it('creates a broadcast that starts and stops with the stream, binds a stream to it, and says where to send video', async () => {
    const g = youtube()
    const b = await createBroadcast(g.fetch, 'tok', { title: 'My stream', privacy: 'unlisted', now: new Date('2026-11-24T10:00:00Z') })

    expect(b).toEqual({ broadcastId: 'b1', rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'abcd-efgh', watchUrl: 'https://www.youtube.com/watch?v=b1' })
    const broadcast = JSON.parse(g.calls[0].body)
    expect(broadcast.snippet).toEqual({ title: 'My stream', scheduledStartTime: '2026-11-24T10:00:00.000Z' })
    expect(broadcast.status.privacyStatus).toBe('unlisted')
    expect(broadcast.contentDetails).toMatchObject({ enableAutoStart: true, enableAutoStop: true })
    expect(g.calls[2].url).toContain('liveBroadcasts/bind')
    expect(g.calls[2].url).toContain('id=b1')
    expect(g.calls[2].url).toContain('streamId=s1')
  })

  it('gives a broadcast a title even when none was typed, and keeps it within YouTube\'s limit', async () => {
    const g = youtube()
    await createBroadcast(g.fetch, 'tok', { title: '   ', privacy: 'private', now: new Date() })
    expect(JSON.parse(g.calls[0].body).snippet.title).toBe('Live with CodeBuilders')
    const g2 = youtube()
    await createBroadcast(g2.fetch, 'tok', { title: 'x'.repeat(300), privacy: 'private', now: new Date() })
    expect(JSON.parse(g2.calls[0].body).snippet.title).toHaveLength(100)
  })

  it('explains the usual refusals', () => {
    expect(explain(403, 'liveStreamingNotEnabled')).toMatch(/Turn it on in YouTube Studio/)
    expect(explain(403, 'quotaExceeded')).toMatch(/paste a stream key/)
    expect(explain(401)).toMatch(/Sign in again/)
  })

  it('stops with the reason when a step is refused', async () => {
    const g = fakeGoogle({ [`${API}liveBroadcasts`]: () => ({ status: 403, json: { error: { errors: [{ reason: 'liveStreamingNotEnabled' }] } } }) })
    await expect(createBroadcast(g.fetch, 'tok', { title: 't', privacy: 'public', now: new Date() })).rejects.toThrow(/YouTube Studio/)
  })
})

describe('the account', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-yt-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const vault = { available: () => true, encrypt: (t: string) => Buffer.from(`E${Buffer.from(t).toString('base64')}`), decrypt: (b: Buffer) => Buffer.from(b.toString().slice(1), 'base64').toString() }

  function account(over: Partial<AccountDeps> = {}, google = fakeGoogle({
    [TOKEN_URL]: tokenAnswer(),
    'https://www.googleapis.com/youtube/v3/channels': () => ({ json: { items: [{ id: 'UC1', snippet: { title: 'Naresh Plays' } }] } }),
    'https://oauth2.googleapis.com/revoke': () => ({ json: {} }),
  })) {
    const deps: AccountDeps = {
      fetch: google.fetch, openBrowser: browser().openBrowser, now: () => 0,
      configPaths: [], env: { CB_YOUTUBE_CLIENT_ID: 'id', CB_YOUTUBE_CLIENT_SECRET: 'secret' },
      tokenFile: path.join(dir, 'youtube.bin'), vault, ...over,
    }
    return { a: new YoutubeAccount(deps), google, deps }
  }

  it('is not offered when this build has no Google client', () => {
    expect(account({ env: {} }).a.status()).toEqual({ state: 'unavailable' })
  })

  it('signs in, names the channel, and is still signed in after a restart', async () => {
    const { a, deps } = account()
    expect(a.status()).toEqual({ state: 'signed-out' })
    expect(await a.signIn()).toEqual({ state: 'signed-in', channel: 'Naresh Plays' })
    expect(new YoutubeAccount(deps).status()).toEqual({ state: 'signed-in', channel: 'Naresh Plays' })
  })

  it('keeps the tokens encrypted on disk, never in plain text', async () => {
    const { a, deps } = account()
    await a.signIn()
    const onDisk = fs.readFileSync(deps.tokenFile, 'utf8')
    expect(onDisk).not.toContain('refresh-1')
    expect(onDisk).not.toContain('access-1')
  })

  it('writes nothing when encryption is not available, but works for this run', async () => {
    const { a, deps } = account({ vault: { ...vault, available: () => false } })
    expect(await a.signIn()).toMatchObject({ state: 'signed-in' })
    expect(fs.existsSync(deps.tokenFile)).toBe(false)
  })

  it('signs out: forgets the tokens and asks Google to revoke them', async () => {
    const { a, deps, google } = account()
    await a.signIn()
    await a.signOut()
    expect(a.status()).toEqual({ state: 'signed-out' })
    expect(fs.existsSync(deps.tokenFile)).toBe(false)
    expect(google.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true)
  })

  it('will not create a broadcast while signed out', async () => {
    await expect(account().a.goLive('t', 'unlisted')).rejects.toThrow(/Sign in to YouTube first/)
  })

  it('says how to stream without it when there is no Google client', async () => {
    await expect(account({ env: {} }).a.signIn()).rejects.toThrow(/Paste a stream key instead/)
  })
})

describe('where the Google client comes from', () => {
  const files = (map: Record<string, string>) => (p: string) => { if (p in map) return map[p]; throw new Error('missing') }

  it('prefers the environment', () => {
    expect(loadClientConfig({ configPaths: ['a'], env: { CB_YOUTUBE_CLIENT_ID: 'e', CB_YOUTUBE_CLIENT_SECRET: 's' } }, files({ a: '{"client_id":"f","client_secret":"g"}' })))
      .toEqual({ clientId: 'e', clientSecret: 's' })
  })

  it('reads the file as Google hands it out', () => {
    expect(loadClientConfig({ configPaths: ['a'], env: {} }, files({ a: '{"installed":{"client_id":"f","client_secret":"g"}}' })))
      .toEqual({ clientId: 'f', clientSecret: 'g' })
  })

  it('tries each place in turn, and is null when none has one', () => {
    expect(loadClientConfig({ configPaths: ['x', 'b'], env: {} }, files({ b: '{"client_id":"f","client_secret":"g"}' }))?.clientId).toBe('f')
    expect(loadClientConfig({ configPaths: ['x'], env: {} }, files({}))).toBeNull()
    expect(loadClientConfig({ configPaths: ['a'], env: {} }, files({ a: 'not json' }))).toBeNull()
  })
})
