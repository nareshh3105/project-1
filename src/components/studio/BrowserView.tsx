import { useEffect, useRef, useState } from 'react'
import { ipc, onBrowserFailure, onBrowserFrame } from '@/ipc'
import { pageKey, parseBrowser } from '@/lib/sources/browser'
import { isPaintable, paintUpdate } from '@/lib/sources/pageSurface'

/**
 * How a web page looks in the preview: the regions of it the main process sends,
 * drawn on a canvas; or a note of what is wrong with the address.
 *
 * The page is run once by the main process however many windows show it, so the
 * recorder shows exactly the page that is seen here.
 */

interface Props {
  sourceId: string
  settings: Record<string, unknown>
  style?: React.CSSProperties
  /** Tells the caller how large the page is, for working out a crop. */
  onNaturalSize?: (size: { w: number; h: number } | null) => void
}

export function BrowserView({ sourceId, settings, style, onNaturalSize }: Props) {
  const b = parseBrowser(settings)
  const key = pageKey(b)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    setError(null)
    setPainted(false)
    onNaturalSize?.(b.url ? { w: b.width, h: b.height } : null)
    if (!b.url) return

    let current = true
    const stopFrames = onBrowserFrame((id, update) => {
      if (!current || id !== sourceId) return
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx || typeof VideoFrame === 'undefined' || !isPaintable(update)) return

      // A page of another size starts a new picture.
      if (canvas.width !== update.width || canvas.height !== update.height) {
        canvas.width = update.width
        canvas.height = update.height
      }
      paintUpdate(ctx, update)
      setPainted(true)
      setError(null)
    })
    const stopFailures = onBrowserFailure((id, message) => { if (current && id === sourceId) setError(message) })

    ipc.browser.attach(sourceId, { url: b.url, width: b.width, height: b.height, fps: b.fps }).catch((err) => {
      if (current) setError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      current = false
      stopFrames()
      stopFailures()
      void ipc.browser.detach(sourceId).catch(() => {})
    }
    // The key stands for every setting that restarts the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, key])

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        style={style}
        className={painted && !error ? 'w-full h-full object-contain pointer-events-none' : 'w-full h-full object-contain pointer-events-none opacity-0'}
      />
      {(!painted || error) && (
        <div className="absolute inset-0 flex items-center justify-center border border-dashed border-bg-divider/60 px-4 text-center">
          <span className="text-text-muted opacity-60 text-[28px]">
            {error ?? (b.url ? 'Loading page…' : 'Enter a web address')}
          </span>
        </div>
      )}
    </div>
  )
}
