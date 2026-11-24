import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Signing in to Google for YouTube, the way Google asks desktop apps to: the
 * person signs in in their own browser, Google sends them back to a one-off
 * address on this computer (127.0.0.1, never reachable from outside), and the
 * code it carries is exchanged for tokens. PKCE ties the code to this app, and
 * a random state ties the reply to this request.
 *
 * Nothing here holds the person's password; only the tokens are kept, encrypted
 * with Windows' own protection (Electron's safeStorage), by the caller.
 */

export const SCOPES = ['https://www.googleapis.com/auth/youtube']
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/** How long to wait for the person to finish in the browser. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export interface ClientConfig {
  clientId: string
  /** Google issues desktop clients a secret that is not secret; the token endpoint still asks for it. */
  clientSecret: string
}

export interface Tokens {
  accessToken: string
  refreshToken: string
  /** Milliseconds since the epoch. */
  expiresAt: number
}

export interface OAuthDeps {
  fetch: typeof fetch
  /** Opens the sign-in page in the person's browser. */
  openBrowser(url: string): Promise<unknown> | void
  now(): number
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(random: (n: number) => Buffer = crypto.randomBytes) {
  const verifier = b64url(random(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function authUrl(config: ClientConfig, redirectUri: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // A refresh token, so the person signs in once rather than every hour.
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${AUTH_URL}?${q}`
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center"><h2>${title}</h2><p>${text}</p></div>`

/**
 * Runs the whole sign-in: listens on a free local port, opens the browser,
 * waits for Google to come back, and exchanges the code for tokens.
 */
export async function signIn(config: ClientConfig, deps: OAuthDeps, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<Tokens> {
  const { verifier, challenge } = pkcePair()
  const state = b64url(crypto.randomBytes(16))

  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  const redirectUri = `http://127.0.0.1:${port}`

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in was not finished in time. Try again.')), timeoutMs)
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        // Browsers also ask for a favicon; only the reply with our state counts.
        if (url.searchParams.get('state') !== state) { res.writeHead(404).end(); return }

        const error = url.searchParams.get('error')
        const got = url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        if (error || !got) {
          res.end(PAGE('Sign-in cancelled', 'You can close this tab and go back to CodeBuilders.'))
          clearTimeout(timer)
          reject(new Error(error === 'access_denied' ? 'Sign-in was cancelled.' : `Google refused the sign-in (${error ?? 'no code'}).`))
          return
        }
        res.end(PAGE('Signed in', 'You can close this tab and go back to CodeBuilders.'))
        clearTimeout(timer)
        resolve(got)
      })
      void Promise.resolve(deps.openBrowser(authUrl(config, redirectUri, challenge, state))).catch(reject)
    })

    return await exchange(config, deps, {
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri,
    })
  } finally {
    server.close()
  }
}

/** A fresh access token from the refresh token. The refresh token itself is kept. */
export async function refresh(config: ClientConfig, deps: OAuthDeps, tokens: Tokens): Promise<Tokens> {
  const next = await exchange(config, deps, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
  return { ...next, refreshToken: next.refreshToken || tokens.refreshToken }
}

/** Tokens that are good for at least another minute, refreshing them if not. */
export async function usable(config: ClientConfig, deps: OAuthDeps, tokens: Tokens): Promise<Tokens> {
  return tokens.expiresAt - deps.now() > 60_000 ? tokens : refresh(config, deps, tokens)
}

/** Tells Google to forget the app's access. Best effort: signing out here does not depend on it. */
export async function revoke(deps: OAuthDeps, tokens: Tokens): Promise<void> {
  try {
    await deps.fetch(`${REVOKE_URL}?${new URLSearchParams({ token: tokens.refreshToken })}`, { method: 'POST' })
  } catch { /* offline: the local copy is still removed */ }
}

async function exchange(config: ClientConfig, deps: OAuthDeps, form: Record<string, string>): Promise<Tokens> {
  const res = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...form }).toString(),
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || typeof body.access_token !== 'string') {
    if (body.error === 'invalid_grant') throw new Error('Your Google sign-in has expired. Sign in again.')
    throw new Error(`Google did not accept the sign-in (${String(body.error_description ?? body.error ?? res.status)}).`)
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : '',
    expiresAt: deps.now() + (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000,
  }
}
