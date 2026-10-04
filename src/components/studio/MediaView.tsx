import { useEffect, useRef, useState } from 'react'
import { ipc } from '@/ipc'
import { fileNameOf, parseMedia, playbackProblem } from '@/lib/sources/media'

/**
 * How a video or sound file looks in the preview: the video, played silently (the
 * recorder mixes the sound itself, and it would otherwise sound twice), or a note
 * of what is wrong with the file.
 */

interface Props {
  settings: Record<string, unknown>
  style?: React.CSSProperties
  /** Tells the caller how large the picture really is, once it has loaded. */
  onNaturalSize?: (size: { w: number; h: number } | null) => void
}

export function MediaView({ settings, style, onNaturalSize }: Props) {
  const { filePath, loop } = parseMedia(settings)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<{ url: string | null; error: string | null; soundOnly: boolean }>({
    url: null, error: null, soundOnly: false,
  })

  useEffect(() => {
    let current = true
    setState({ url: null, error: null, soundOnly: false })
    onNaturalSize?.(null)
    if (!filePath) return

    ipc.media.url(filePath).then(
      (url) => { if (current) setState({ url, error: null, soundOnly: false }) },
      (err) => { if (current) setState({ url: null, error: err instanceof Error ? err.message : String(err), soundOnly: false }) },
    )
    return () => { current = false }
    // The size callback is the caller's business; a new one is not a reason to start again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  if (state.url) {
    return (
      <video
        ref={videoRef}
        src={state.url}
        autoPlay
        muted
        loop={loop}
        playsInline
        style={style}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          const sound = v.videoWidth === 0
          setState((s) => ({ ...s, soundOnly: sound }))
          onNaturalSize?.(sound ? null : { w: v.videoWidth, h: v.videoHeight })
        }}
        onError={(e) => {
          // Read now: the event is not there any more by the time the update runs.
          const problem = playbackProblem(e.currentTarget.error?.code)
          setState((s) => ({ ...s, url: null, error: problem }))
        }}
        className={state.soundOnly ? 'w-full h-full opacity-0 pointer-events-none' : 'w-full h-full object-contain pointer-events-none'}
      />
    )
  }

  return (
    <div className="w-full h-full flex items-center justify-center border border-dashed border-bg-divider/60 px-4 text-center">
      <span className="text-text-muted opacity-60 text-[28px]">
        {state.error ?? (filePath ? `Loading ${fileNameOf(filePath)}…` : 'Choose a video or sound file')}
      </span>
    </div>
  )
}
