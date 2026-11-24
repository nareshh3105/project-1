import fs from 'node:fs'
import path from 'node:path'
import type { ClientConfig, OAuthDeps, Tokens } from './oauth'
import { signIn, usable, revoke } from './oauth'
import { myChannel, createBroadcast, type ApiFetch, type Broadcast, type Channel, type Privacy } from './api'

/**
 * The signed-in YouTube account: where the app's Google client comes from, and
 * where the person's tokens are kept between runs.
 *
 * The client (an OAuth client ID of the "Desktop app" type, from the Google Cloud
 * console, with the YouTube Data API v3 switched on) is read from
 * youtube-oauth.json beside the app, or from CB_YOUTUBE_CLIENT_ID and
 * CB_YOUTUBE_CLIENT_SECRET. Without one, sign-in is not offered and the stream
 * key still works.
 *
 * The tokens are written encrypted with Electron's safeStorage (Windows' DPAPI:
 * readable only by this Windows user on this computer). If encryption is not
 * available they are not written at all, and the person signs in each run.
 */

export interface Vault {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export interface AccountDeps extends OAuthDeps {
  /** Where youtube-oauth.json may be: resources first, then the working folder. */
  configPaths: string[]
  env: Record<string, string | undefined>
  tokenFile: string
  vault: Vault
}

export function loadClientConfig(deps: Pick<AccountDeps, 'configPaths' | 'env'>, read = (p: string) => fs.readFileSync(p, 'utf8')): ClientConfig | null {
  const id = deps.env.CB_YOUTUBE_CLIENT_ID?.trim()
  const secret = deps.env.CB_YOUTUBE_CLIENT_SECRET?.trim()
  if (id && secret) return { clientId: id, clientSecret: secret }

  for (const p of deps.configPaths) {
    try {
      const raw = JSON.parse(read(p)) as Record<string, unknown>
      // Accepts the file as Google hands it out ({ "installed": { ... } }) or flattened.
      const c = (raw.installed ?? raw) as Record<string, unknown>
      if (typeof c.client_id === 'string' && typeof c.client_secret === 'string' && c.client_id && c.client_secret) {
        return { clientId: c.client_id, clientSecret: c.client_secret }
      }
    } catch { /* not there, or not JSON: try the next */ }
  }
  return null
}

interface Stored { tokens: Tokens; channel: Channel }

export type YoutubeStatus =
  | { state: 'unavailable' }          // no Google client set up for this build
  | { state: 'signed-out' }
  | { state: 'signed-in'; channel: string }

export class YoutubeAccount {
  private stored: Stored | null = null
  private loaded = false

  constructor(private readonly deps: AccountDeps) {}

  private get config(): ClientConfig | null {
    return loadClientConfig(this.deps)
  }

  status(): YoutubeStatus {
    if (!this.config) return { state: 'unavailable' }
    const s = this.load()
    return s ? { state: 'signed-in', channel: s.channel.title } : { state: 'signed-out' }
  }

  async signIn(): Promise<YoutubeStatus> {
    const config = this.require()
    const tokens = await signIn(config, this.deps)
    const channel = await myChannel(this.fetchFor(), tokens.accessToken)
    this.save({ tokens, channel })
    return this.status()
  }

  async signOut(): Promise<void> {
    const s = this.load()
    this.stored = null
    try { fs.rmSync(this.deps.tokenFile, { force: true }) } catch { /* already gone */ }
    if (s) await revoke(this.deps, s.tokens)
  }

  /** A new broadcast on the signed-in channel, ready to receive video. */
  async goLive(title: string, privacy: Privacy): Promise<Broadcast> {
    const config = this.require()
    const s = this.load()
    if (!s) throw new Error('Sign in to YouTube first.')
    const tokens = await usable(config, this.deps, s.tokens).catch(async (err) => {
      // A refresh token Google no longer honours: the person has to sign in again.
      await this.signOut()
      throw err
    })
    if (tokens !== s.tokens) this.save({ ...s, tokens })
    return createBroadcast(this.fetchFor(), tokens.accessToken, { title, privacy, now: new Date(this.deps.now()) })
  }

  // ── internals ──

  private require(): ClientConfig {
    const c = this.config
    if (!c) throw new Error('Sign-in with Google is not set up in this build. Paste a stream key instead.')
    return c
  }

  private fetchFor(): ApiFetch {
    return (url, init) => this.deps.fetch(url, init)
  }

  private load(): Stored | null {
    if (this.loaded) return this.stored
    this.loaded = true
    try {
      if (!this.deps.vault.available()) return null
      const data = fs.readFileSync(this.deps.tokenFile)
      const parsed = JSON.parse(this.deps.vault.decrypt(data)) as Stored
      if (parsed?.tokens?.refreshToken && parsed.channel?.title) this.stored = parsed
    } catch { /* none saved, or unreadable: signed out */ }
    return this.stored
  }

  private save(s: Stored): void {
    this.stored = s
    this.loaded = true
    if (!this.deps.vault.available()) return // kept for this run only
    fs.mkdirSync(path.dirname(this.deps.tokenFile), { recursive: true })
    fs.writeFileSync(this.deps.tokenFile, this.deps.vault.encrypt(JSON.stringify(s)))
  }
}
