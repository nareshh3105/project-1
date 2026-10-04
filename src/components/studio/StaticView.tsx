import { useEffect, useRef, useState } from 'react'
import { ipc } from '@/ipc'
import {
  isImagePath, lookKey, paintColor, paintText, parseColor, parseImage, parseText,
  type PaintContext, type StaticType,
} from '@/lib/sources/static'

/**
 * How a color, text or image source looks in the preview. Colors and text are
 * painted by the same code the recorder uses, so what is arranged here is what
 * is recorded.
 */

interface Props {
  style?: React.CSSProperties
  /** Tells the caller how large a picture really is, once it has loaded. */
  onNaturalSize?: (size: { w: number; h: number } | null) => void
  type: StaticType
  settings: Record<string, unknown>
  width: number
  height: number
}

/** Pictures already read, so a redraw does not read the file again. */
const pictures = new Map<string, Promise<string>>()

function pictureFor(filePath: string): Promise<string> {
  let p = pictures.get(filePath)
  if (!p) {
    p = ipc.file.readImage(filePath)
    // A failed read must not be remembered, or fixing the file would change nothing.
    p.catch(() => pictures.delete(filePath))
    pictures.set(filePath, p)
  }
  return p
}

/** Forgets pictures read so far. For tests, and for when a file is known to have changed. */
export function forgetPictures(): void {
  pictures.clear()
}

export function StaticView({ type, settings, width, height, style, onNaturalSize }: Props) {
  if (type === 'image') return <PictureView settings={settings} style={style} onNaturalSize={onNaturalSize} />
  return <PaintedView type={type} settings={settings} width={width} height={height} style={style} />
}

function PaintedView({ type, settings, width, height, style }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = Math.min(4096, Math.max(1, Math.round(width)))
  const h = Math.min(4096, Math.max(1, Math.round(height)))
  const key = lookKey(type, settings, w, h)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const paint = ctx as unknown as PaintContext
    if (type === 'color_source') paintColor(paint, parseColor(settings), w, h)
    else paintText(paint, parseText(settings), w, h)
    // The key stands for every setting that changes the look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return <canvas ref={ref} width={w} height={h} style={style} className="w-full h-full pointer-events-none" />
}

function PictureView({ settings, style, onNaturalSize }: { settings: Record<string, unknown>; style?: React.CSSProperties; onNaturalSize?: Props['onNaturalSize'] }) {
  const { filePath } = parseImage(settings)
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null })

  useEffect(() => {
    let current = true
    setState({ url: null, error: null })
    if (!filePath) return
    if (!isImagePath(filePath)) { setState({ url: null, error: 'That file is not a picture.' }); return }

    pictureFor(filePath).then(
      (url) => { if (current) setState({ url, error: null }) },
      (err) => { if (current) setState({ url: null, error: err instanceof Error ? err.message : String(err) }) },
    )
    return () => { current = false }
  }, [filePath])

  if (state.url) {
    return (
      <img
        src={state.url} alt="" draggable={false} style={style}
        onLoad={(e) => onNaturalSize?.({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="w-full h-full object-contain pointer-events-none"
      />
    )
  }
  return (
    <div className="w-full h-full flex items-center justify-center border border-dashed border-bg-divider/60 px-4 text-center">
      <span className="text-text-muted opacity-60 text-[28px]">
        {state.error ?? (filePath ? 'Loading picture…' : 'Choose a picture')}
      </span>
    </div>
  )
}
