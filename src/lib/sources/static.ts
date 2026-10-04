import type { SourceType } from '@/types'

/**
 * Sources that are drawn from their settings alone: a solid color, a piece of
 * text, an image. Nothing is captured, so they are the same in the preview and
 * in the recording as long as both draw them with this code.
 */

export type StaticType = 'color_source' | 'text_gdi_plus' | 'image'

export const isStaticType = (type: SourceType | string): type is StaticType =>
  type === 'color_source' || type === 'text_gdi_plus' || type === 'image'

export type TextAlign = 'left' | 'center' | 'right'

export interface ColorSettings { color: string }

export interface TextSettings {
  text: string
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  color: string
  /** Empty for none. */
  backgroundColor: string
  align: TextAlign
}

export interface ImageSettings {
  filePath: string
}

export const DEFAULT_COLOR: ColorSettings = { color: '#2563eb' }

export const DEFAULT_TEXT: TextSettings = {
  text: 'Text',
  fontFamily: 'Segoe UI',
  fontSize: 64,
  bold: false,
  italic: false,
  color: '#ffffff',
  backgroundColor: '',
  align: 'left',
}

export const DEFAULT_IMAGE: ImageSettings = { filePath: '' }

/** Where a new source of each kind is placed, in canvas pixels. */
export const DEFAULT_PLACEMENT: Record<StaticType, { x: number; y: number; width: number; height: number }> = {
  color_source: { x: 0, y: 0, width: 1920, height: 1080 },
  text_gdi_plus: { x: 160, y: 80, width: 800, height: 160 },
  image: { x: 0, y: 0, width: 640, height: 360 },
}

export const FONT_FAMILIES = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Consolas', 'Impact'] as const

const MAX_TEXT = 2000
const MIN_FONT = 8
const MAX_FONT = 600

/** #rgb or #rrggbb. Anything else (a CSS name, a script) is not trusted as a color. */
export const isHexColor = (v: unknown): v is string =>
  typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)

export function parseColor(settings: Record<string, unknown> | undefined): ColorSettings {
  return { color: isHexColor(settings?.color) ? settings!.color as string : DEFAULT_COLOR.color }
}

export function parseText(settings: Record<string, unknown> | undefined): TextSettings {
  const s = settings ?? {}
  const size = typeof s.fontSize === 'number' && Number.isFinite(s.fontSize) ? s.fontSize : DEFAULT_TEXT.fontSize
  return {
    text: str(s.text, DEFAULT_TEXT.text).slice(0, MAX_TEXT),
    fontFamily: (FONT_FAMILIES as readonly string[]).includes(s.fontFamily as string) ? (s.fontFamily as string) : DEFAULT_TEXT.fontFamily,
    fontSize: Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(size))),
    bold: s.bold === true,
    italic: s.italic === true,
    color: isHexColor(s.color) ? s.color : DEFAULT_TEXT.color,
    backgroundColor: isHexColor(s.backgroundColor) ? s.backgroundColor : '',
    align: s.align === 'center' || s.align === 'right' ? s.align : 'left',
  }
}

export function parseImage(settings: Record<string, unknown> | undefined): ImageSettings {
  return { filePath: str(settings?.filePath, '').slice(0, 1024) }
}

// ── Drawing ────────────────────────────────────────────────────────────────

/** The part of a 2D context the drawing uses, so it can be tested without a canvas. */
export interface PaintContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  font: string
  textBaseline: CanvasTextBaseline
  textAlign: CanvasTextAlign
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
}

export function paintColor(ctx: PaintContext, s: ColorSettings, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = s.color
  ctx.fillRect(0, 0, width, height)
}

/**
 * Splits text into lines that fit `maxWidth`. Explicit line breaks are kept; a
 * single word wider than the box is left on its own line rather than cut.
 */
export function wrapText(ctx: Pick<PaintContext, 'measureText'>, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph === '') { lines.push(''); continue }

    let line = ''
    for (const word of paragraph.split(' ')) {
      const attempt = line === '' ? word : `${line} ${word}`
      if (line !== '' && ctx.measureText(attempt).width > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = attempt
      }
    }
    lines.push(line)
  }
  return lines
}

const PADDING = 12
const LINE_HEIGHT = 1.2

export function fontOf(s: TextSettings): string {
  return `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.fontSize}px "${s.fontFamily}", sans-serif`
}

/**
 * Draws text into a box, wrapped to its width and centred vertically. Text
 * taller than the box is cut at the bottom, not scaled, so the size the user
 * chose is the size they get.
 */
export function paintText(ctx: PaintContext, s: TextSettings, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)
  if (s.backgroundColor) {
    ctx.fillStyle = s.backgroundColor
    ctx.fillRect(0, 0, width, height)
  }

  ctx.font = fontOf(s)
  ctx.fillStyle = s.color
  ctx.textBaseline = 'top'
  ctx.textAlign = s.align

  const lines = wrapText(ctx, s.text, Math.max(1, width - PADDING * 2))
  const lineHeight = s.fontSize * LINE_HEIGHT
  const blockHeight = lines.length * lineHeight

  const x = s.align === 'left' ? PADDING : s.align === 'right' ? width - PADDING : width / 2
  let y = Math.max(0, (height - blockHeight) / 2)

  for (const line of lines) {
    if (y >= height) break
    ctx.fillText(line, x, y)
    y += lineHeight
  }
}

/** Image formats the app will load. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] as const

export const isImagePath = (p: string): boolean => {
  const dot = p.lastIndexOf('.')
  // A name with no extension at all is not an image, whatever it is called.
  if (dot < 1) return false
  return (IMAGE_EXTENSIONS as readonly string[]).includes(p.slice(dot + 1).toLowerCase())
}

/** A stable string for "has this source's look changed", used to decide whether to redraw. */
export function lookKey(type: StaticType, settings: Record<string, unknown> | undefined, width: number, height: number): string {
  const normalised = type === 'color_source' ? parseColor(settings)
    : type === 'text_gdi_plus' ? parseText(settings)
      : parseImage(settings)
  return `${type}|${width}x${height}|${JSON.stringify(normalised)}`
}
