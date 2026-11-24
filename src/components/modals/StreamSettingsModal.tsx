import { useState, useEffect } from 'react'
import { toErrorMessage } from '@/lib/errors'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Eye, EyeOff } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useOutputStore } from '@/stores/outputStore'
import { startStreaming } from '@/lib/outputs'
import { cn } from '@/lib/utils'
import { STREAM_SERVICES, serviceById, serviceOf, type ServiceId } from '@/lib/streamServices'
import { ipc, type YoutubeStatus } from '@/ipc'

export function StreamSettingsModal() {
  const { modal, closeModal } = useUIStore((s) => ({
    modal:      s.modal,
    closeModal: s.closeModal,
  }))
  const { stream, setStreamSettings } = useOutputStore((s) => ({
    stream:               s.stream,
    setStreamSettings:    s.setStreamSettings,
  }))

  const open = modal?.type === 'stream-settings'

  const [rtmpUrl,      setRtmpUrl]      = useState(stream.rtmpUrl)
  const [streamKey,    setStreamKey]    = useState(stream.streamKey)
  const [showKey,      setShowKey]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [starting,     setStarting]     = useState(false)
  // A saved address that is one of the known services shows as that service.
  const [service,      setService]      = useState<ServiceId>(serviceOf(stream.rtmpUrl))
  const [youtube,      setYoutube]      = useState<YoutubeStatus>({ state: 'unavailable' })
  const [title,        setTitle]        = useState('')
  const [privacy,      setPrivacy]      = useState<'public' | 'unlisted' | 'private'>('unlisted')
  const [signingIn,    setSigningIn]    = useState(false)
  const [watchUrl,     setWatchUrl]     = useState<string | null>(null)
  // Signed in to YouTube: the broadcast is made for the person, no key needed.
  const viaAccount = service === 'youtube' && youtube.state === 'signed-in'

  // Sync inputs when modal opens
  useEffect(() => {
    if (open) {
      setRtmpUrl(stream.rtmpUrl)
      setStreamKey(stream.streamKey)
      setService(serviceOf(stream.rtmpUrl))
      setError(null)
      setWatchUrl(null)
      ipc.youtube.status().then((st) => setYoutube(st?.state ? st : { state: 'unavailable' })).catch(() => setYoutube({ state: 'unavailable' }))
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function chooseService(id: ServiceId) {
    setService(id)
    const chosen = serviceById(id)
    // A known service fills in its address; Custom keeps whatever is there to be edited.
    if (chosen.url) setRtmpUrl(chosen.url)
    else if (serviceOf(rtmpUrl) !== 'custom') setRtmpUrl('')
  }

  async function signIn() {
    setError(null)
    setSigningIn(true)
    try { const st = await ipc.youtube.signIn(); if (st?.state) setYoutube(st) } catch (e) { setError(toErrorMessage(e)) } finally { setSigningIn(false) }
  }

  async function signOut() {
    setError(null)
    try { await ipc.youtube.signOut(); setYoutube({ state: 'signed-out' }) } catch (e) { setError(toErrorMessage(e)) }
  }

  async function goLiveOnYoutube() {
    setError(null)
    setStarting(true)
    try {
      const b = await ipc.youtube.createBroadcast(title, privacy)
      // The address is remembered so YouTube stays chosen; the key is the broadcast's own, used once and not saved.
      setStreamSettings(b.rtmpUrl, stream.streamKey)
      await startStreaming(b.rtmpUrl, b.streamKey)
      setWatchUrl(b.watchUrl)
    } catch (e) {
      setError(toErrorMessage(e))
    } finally {
      setStarting(false)
    }
  }

  async function handleGoLive() {
    if (viaAccount) { await goLiveOnYoutube(); return }
    const url = rtmpUrl.trim()
    if (!url) { setError('RTMP URL is required'); return }
    setError(null)
    setStarting(true)
    try {
      setStreamSettings(url, streamKey.trim())
      await startStreaming(url, streamKey.trim())
      closeModal()
    } catch (e) {
      setError(toErrorMessage(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60] animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[400px] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in',
          )}
          onKeyDown={(e) => { if (e.key === 'Escape') closeModal() }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-bg-divider">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              Stream Settings
            </Dialog.Title>
            <button onClick={closeModal} className="icon-btn">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stream-service" className="text-caption text-text-secondary font-medium">
                Service
              </label>
              <select
                id="stream-service"
                value={service}
                onChange={(e) => chooseService(e.target.value as ServiceId)}
                className="h-8 px-2 rounded-input bg-bg-surface border border-bg-divider
                           text-body text-text-primary focus:outline-none focus:border-accent-start cursor-pointer"
              >
                {STREAM_SERVICES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <p className="text-[11px] text-text-muted leading-relaxed">{serviceById(service).keyHelp}</p>
            </div>

            {service === 'custom' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="stream-rtmp-url" className="text-caption text-text-secondary font-medium">
                  RTMP URL
                </label>
                <input
                  id="stream-rtmp-url"
                  type="text"
                  placeholder="rtmp://live.example.com/app"
                  value={rtmpUrl}
                  onChange={(e) => setRtmpUrl(e.target.value)}
                  className="h-8 px-3 rounded-input bg-bg-surface border border-bg-divider
                             text-body text-text-primary focus:outline-none focus:border-accent-start"
                />
              </div>
            )}

            {service === 'youtube' && youtube.state === 'signed-out' && (
              <div className="flex flex-col gap-1.5 rounded-input border border-bg-divider p-3">
                <button
                  type="button"
                  onClick={signIn}
                  disabled={signingIn}
                  className="h-8 rounded-button text-caption font-semibold text-white bg-accent-gradient hover:opacity-90 disabled:opacity-50"
                >
                  {signingIn ? 'Finish signing in in your browser…' : 'Sign in with Google'}
                </button>
                <p className="text-[11px] text-text-muted">Or paste a stream key below.</p>
              </div>
            )}

            {viaAccount && youtube.state === 'signed-in' && (
              <div className="flex flex-col gap-3 rounded-input border border-bg-divider p-3">
                <div className="flex items-center justify-between text-caption">
                  <span className="text-text-secondary">Signed in as <b className="text-text-primary">{youtube.channel}</b></span>
                  <button type="button" onClick={signOut} className="text-text-muted hover:text-text-primary underline">Sign out</button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="yt-title" className="text-caption text-text-secondary font-medium">Title</label>
                  <input
                    id="yt-title"
                    type="text"
                    maxLength={100}
                    placeholder="Live with CodeBuilders"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-8 px-3 rounded-input bg-bg-surface border border-bg-divider text-body text-text-primary focus:outline-none focus:border-accent-start"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="yt-privacy" className="text-caption text-text-secondary font-medium">Who can watch</label>
                  <select
                    id="yt-privacy"
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
                    className="h-8 px-2 rounded-input bg-bg-surface border border-bg-divider text-body text-text-primary cursor-pointer"
                  >
                    <option value="private">Private (only you)</option>
                    <option value="unlisted">Unlisted (anyone with the link)</option>
                    <option value="public">Public</option>
                  </select>
                </div>
                <p className="text-[11px] text-text-muted">Go Live creates the broadcast on your channel and starts it as soon as the video arrives. Stopping the stream ends it.</p>
              </div>
            )}

            {watchUrl && (
              <p className="text-caption text-state-success break-all">You are live: {watchUrl}</p>
            )}

            {!viaAccount && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="stream-key" className="text-caption text-text-secondary font-medium">
                Stream Key
              </label>
              <div className="relative">
                <input
                  id="stream-key"
                  type={showKey ? 'text' : 'password'}
                  // Not a row of bullets: a masked field full of placeholder
                  // bullets is indistinguishable from one holding a real key,
                  // so revealing it looked like the toggle was broken.
                  placeholder="Paste your stream key"
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  className="w-full h-8 px-3 pr-8 rounded-input bg-bg-surface border border-bg-divider
                             text-body text-text-primary focus:outline-none focus:border-accent-start"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? 'Hide stream key' : 'Show stream key'}
                  aria-pressed={showKey}
                  title={showKey ? 'Hide stream key' : 'Show stream key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            )}

            {/* A real Dialog.Description: Radix wires aria-describedby from it,
                so the dialog announces its purpose instead of warning. */}
            <Dialog.Description className="text-[11px] text-text-muted opacity-60 leading-relaxed">
              Your stream key is saved on this computer only. Anyone who has it can stream to your channel, so do not share it.
            </Dialog.Description>

            {error && (
              <p className="text-caption text-state-danger bg-state-danger/10 px-3 py-2 rounded-input">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-bg-divider">
            <button
              onClick={closeModal}
              className="h-7 px-4 rounded-button text-caption text-text-secondary
                         hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGoLive}
              disabled={starting}
              className="h-7 px-5 rounded-button text-caption font-semibold text-white
                         bg-state-danger hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {starting ? 'Starting…' : 'Go Live'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
