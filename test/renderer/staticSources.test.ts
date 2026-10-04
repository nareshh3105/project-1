import { describe, it, expect } from 'vitest'
import {
  isStaticType, isHexColor, parseColor, parseText, parseImage, paintColor, paintText, wrapText, lookKey,
  isImagePath, DEFAULT_TEXT, type PaintContext,
} from '../../src/lib/sources/static'

/**
 * Settings come out of the database and across a process boundary, so every
 * field is checked; a bad value must give a usable default, never a crash or a
 * script-bearing color string in a canvas.
 */

describe('which sources are static', () => {
  it.each(['color_source', 'text_gdi_plus', 'image'])('%s is', (t) => expect(isStaticType(t)).toBe(true))
  it.each(['display_capture', 'window_capture', 'dshow_video', 'browser_source', 'media_source', 'scene'])('%s is not', (t) =>
    expect(isStaticType(t)).toBe(false))
})

describe('colors', () => {
  it.each(['#fff', '#FFFFFF', '#0a1B2c'])('accepts %s', (c) => expect(isHexColor(c)).toBe(true))
  it.each(['red', '#ff', '#ggg', 'rgb(0,0,0)', '#12345', '#1234567', '', 5, null, undefined, 'url(x)'])('refuses %s', (c) =>
    expect(isHexColor(c)).toBe(false))

  it('falls back to the default for a bad color', () => {
    expect(parseColor({ color: 'javascript:alert(1)' }).color).toBe('#2563eb')
    expect(parseColor(undefined).color).toBe('#2563eb')
  })
  it('keeps a good one', () => expect(parseColor({ color: '#112233' }).color).toBe('#112233'))
})

describe('text settings', () => {
  it('start from sensible defaults', () => expect(parseText(undefined)).toEqual(DEFAULT_TEXT))

  it('keep valid choices', () => {
    expect(parseText({ text: 'Hi', fontFamily: 'Arial', fontSize: 40, bold: true, italic: true, color: '#000', backgroundColor: '#fff', align: 'center' }))
      .toEqual({ text: 'Hi', fontFamily: 'Arial', fontSize: 40, bold: true, italic: true, color: '#000', backgroundColor: '#fff', align: 'center' })
  })

  it.each([[1, 8], [5000, 600], [NaN, 64], [Infinity, 64], ['big', 64], [40.6, 41]])('clamps a font size of %s to %s', (given, expected) => {
    expect(parseText({ fontSize: given }).fontSize).toBe(expected)
  })

  it('refuses a font that is not on the list, so a setting cannot inject into the font string', () => {
    expect(parseText({ fontFamily: 'x"; background: url(evil)' }).fontFamily).toBe('Segoe UI')
  })

  it('cuts absurdly long text', () => expect(parseText({ text: 'a'.repeat(50_000) }).text).toHaveLength(2000))
  it('treats non-text as the default', () => expect(parseText({ text: 42 }).text).toBe('Text'))
  it('ignores an unknown alignment', () => expect(parseText({ align: 'justify' }).align).toBe('left'))
  it('takes no background unless it is a color', () => expect(parseText({ backgroundColor: 'red' }).backgroundColor).toBe(''))
})

describe('image settings', () => {
  it('default to no file', () => expect(parseImage(undefined).filePath).toBe(''))
  it('keep a path', () => expect(parseImage({ filePath: 'C:\\a\\b.png' }).filePath).toBe('C:\\a\\b.png'))
  it('ignore a non-string path', () => expect(parseImage({ filePath: 7 }).filePath).toBe(''))
  it('cut an absurdly long path', () => expect(parseImage({ filePath: 'x'.repeat(5000) }).filePath).toHaveLength(1024))

  it.each([['a.png', true], ['A.JPG', true], ['x.jpeg', true], ['x.webp', true], ['x.gif', true], ['x.bmp', true], ['x.exe', false], ['x.png.exe', false], ['png', false], ['', false]])(
    '%s is an image: %s', (p, ok) => expect(isImagePath(p)).toBe(ok))
})

/** Records what was drawn. Text is 10 pixels per character. */
function recorder() {
  const calls: unknown[][] = []
  const ctx: PaintContext = {
    fillStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    clearRect: (...a) => { calls.push(['clearRect', ...a]) },
    fillRect: (...a) => { calls.push(['fillRect', ...a]) },
    fillText: (...a) => { calls.push(['fillText', ...a]) },
    measureText: (t) => ({ width: t.length * 10 }),
  }
  return { ctx, calls, texts: () => calls.filter((c) => c[0] === 'fillText') }
}

describe('painting a color', () => {
  it('fills the whole box', () => {
    const r = recorder()
    paintColor(r.ctx, { color: '#123456' }, 300, 200)
    expect(r.ctx.fillStyle).toBe('#123456')
    expect(r.calls).toContainEqual(['fillRect', 0, 0, 300, 200])
  })
})

describe('wrapping text', () => {
  const m = { measureText: (t: string) => ({ width: t.length * 10 }) }

  it('leaves a short line alone', () => expect(wrapText(m, 'hello world', 500)).toEqual(['hello world']))
  it('breaks at spaces when too wide', () => expect(wrapText(m, 'aaa bbb ccc', 70)).toEqual(['aaa bbb', 'ccc']))
  it('keeps explicit line breaks', () => expect(wrapText(m, 'one\ntwo\r\nthree', 500)).toEqual(['one', 'two', 'three']))
  it('keeps blank lines', () => expect(wrapText(m, 'a\n\nb', 500)).toEqual(['a', '', 'b']))
  it('does not cut a word wider than the box', () => expect(wrapText(m, 'abcdefghij kl', 30)).toEqual(['abcdefghij', 'kl']))
  it('gives one empty line for empty text', () => expect(wrapText(m, '', 100)).toEqual(['']))
  it('does not loop on a zero width', () => expect(wrapText(m, 'a b c', 0).length).toBeGreaterThan(0))
})

describe('painting text', () => {
  const s = { ...DEFAULT_TEXT, text: 'Hello', fontSize: 20 }

  it('clears first, so an edit does not draw over the old text', () => {
    const r = recorder()
    paintText(r.ctx, s, 400, 100)
    expect(r.calls[0]).toEqual(['clearRect', 0, 0, 400, 100])
  })

  it('draws a background only when asked', () => {
    const none = recorder()
    paintText(none.ctx, s, 400, 100)
    expect(none.calls.some((c) => c[0] === 'fillRect')).toBe(false)

    const filled = recorder()
    paintText(filled.ctx, { ...s, backgroundColor: '#000000' }, 400, 100)
    expect(filled.calls).toContainEqual(['fillRect', 0, 0, 400, 100])
  })

  it('uses the chosen font, color and alignment', () => {
    const r = recorder()
    paintText(r.ctx, { ...s, bold: true, italic: true, fontFamily: 'Arial', color: '#ff0000', align: 'center' }, 400, 100)
    expect(r.ctx.font).toBe('italic bold 20px "Arial", sans-serif')
    expect(r.ctx.fillStyle).toBe('#ff0000')
    expect(r.ctx.textAlign).toBe('center')
  })

  it.each([['left', 12], ['center', 200], ['right', 388]] as const)('anchors %s text at x=%s', (align, x) => {
    const r = recorder()
    paintText(r.ctx, { ...s, align }, 400, 100)
    expect(r.texts()[0][2]).toBe(x)
  })

  it('centres a single line vertically', () => {
    const r = recorder()
    paintText(r.ctx, s, 400, 100) // line height 24
    expect(r.texts()[0][3]).toBe((100 - 24) / 2)
  })

  it('wraps to the box width', () => {
    const r = recorder()
    paintText(r.ctx, { ...s, text: 'aaaa bbbb cccc' }, 120, 200) // usable width 96 = 9 chars
    expect(r.texts().map((c) => c[1])).toEqual(['aaaa bbbb', 'cccc'])
  })

  it('stops at the bottom edge instead of drawing outside the box', () => {
    const r = recorder()
    paintText(r.ctx, { ...s, text: Array(50).fill('line').join('\n') }, 400, 100)
    expect(r.texts().length).toBeLessThan(10)
  })

  it('draws nothing for empty text but still clears', () => {
    const r = recorder()
    paintText(r.ctx, { ...s, text: '' }, 400, 100)
    expect(r.calls[0][0]).toBe('clearRect')
  })
})

describe('lookKey', () => {
  it('is the same for the same look', () => {
    expect(lookKey('text_gdi_plus', { text: 'a' }, 100, 50)).toBe(lookKey('text_gdi_plus', { text: 'a' }, 100, 50))
  })
  it('changes with the text, the size or the color', () => {
    const base = lookKey('text_gdi_plus', { text: 'a' }, 100, 50)
    expect(lookKey('text_gdi_plus', { text: 'b' }, 100, 50)).not.toBe(base)
    expect(lookKey('text_gdi_plus', { text: 'a' }, 200, 50)).not.toBe(base)
    expect(lookKey('text_gdi_plus', { text: 'a', color: '#000000' }, 100, 50)).not.toBe(base)
  })
  it('ignores settings that mean nothing, so they do not force a redraw', () => {
    expect(lookKey('color_source', { color: '#112233', junk: 1 }, 10, 10)).toBe(lookKey('color_source', { color: '#112233' }, 10, 10))
  })
})
