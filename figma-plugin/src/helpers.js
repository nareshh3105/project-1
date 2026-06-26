// ─── Shared Figma helper utilities ───────────────────────────────────────────

// Parse "#RRGGBB" or "#RRGGBBAA" → { r, g, b, a } in 0-1 range
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const len = h.length;
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const a = len === 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

// Parse "rgba(r,g,b,a)" → { r, g, b, a } in 0-1 range
function rgbaStringToRgb(str) {
  const m = str.match(/rgba?\((\d+\.?\d*),\s*(\d+\.?\d*),\s*(\d+\.?\d*)(?:,\s*(\d+\.?\d*))?\)/);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseFloat(m[1]) / 255,
    g: parseFloat(m[2]) / 255,
    b: parseFloat(m[3]) / 255,
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

// Solid paint from hex string
function solidPaint(hex) {
  const { r, g, b } = hexToRgb(hex);
  return [{ type: 'SOLID', color: { r, g, b } }];
}

// Solid paint with opacity from rgba() string
function solidPaintRgba(str) {
  const { r, g, b, a } = rgbaStringToRgb(str);
  return [{ type: 'SOLID', color: { r, g, b }, opacity: a }];
}

// Linear gradient paint — angle in degrees, stops: [{ color, position }]
function gradientPaint(angleDeg, stops) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [{
    type: 'GRADIENT_LINEAR',
    gradientStops: stops.map(s => ({
      color: Object.assign({ a: 1 }, hexToRgb(s.color)),
      position: s.position,
    })),
    gradientTransform: [
      [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
      [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
    ],
  }];
}

// The brand gradient paint (135° #8A5CFF → #FF4FD8)
function accentGradientPaint() {
  return gradientPaint(135, [
    { color: '#8A5CFF', position: 0 },
    { color: '#FF4FD8', position: 1 },
  ]);
}

// Drop shadow effect
function dropShadow(offsetX, offsetY, blur, spread, colorHex, opacity = 1) {
  const { r, g, b } = hexToRgb(colorHex);
  return {
    type: 'DROP_SHADOW',
    offset: { x: offsetX, y: offsetY },
    radius: blur,
    spread,
    color: { r, g, b, a: opacity },
    blendMode: 'NORMAL',
    visible: true,
  };
}

// Glow effect (accent)
function accentGlow() {
  return dropShadow(0, 0, 18, 0, '#8A5CFF', 0.35);
}

// Apply Auto Layout to a frame
function applyAutoLayout(frame, direction = 'VERTICAL', gap = 0, paddingH = 0, paddingV = 0) {
  frame.layoutMode = direction;
  frame.itemSpacing = gap;
  frame.paddingLeft   = paddingH;
  frame.paddingRight  = paddingH;
  frame.paddingTop    = paddingV;
  frame.paddingBottom = paddingV;
  frame.primaryAxisSizingMode   = 'AUTO';
  frame.counterAxisSizingMode   = 'AUTO';
}

// Create a filled rectangle (returns SceneNode)
function rect(name, w, h, fillHex, radius = 0) {
  const r = figma.createRectangle();
  r.name = w + 'x' + h;
  r.resize(w, h);
  r.fills = solidPaint(fillHex);
  r.cornerRadius = radius;
  r.name = name;
  return r;
}

// Create a text node
async function text(content, styleName, colorHex = '#FFFFFF', maxWidth = 0) {
  const t = figma.createText();
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  const styleMap = {
    'heading-xl':   { size: 24, weight: 'Semi Bold' },
    'heading-lg':   { size: 22, weight: 'Medium' },
    'heading-md':   { size: 18, weight: 'Medium' },
    'panel-title':  { size: 15, weight: 'Medium' },
    'body':         { size: 13, weight: 'Regular' },
    'caption':      { size: 11, weight: 'Regular' },
  };

  const s = styleMap[styleName] || styleMap['body'];
  t.fontName   = { family: 'Inter', style: s.weight };
  t.fontSize   = s.size;
  t.characters = content;
  t.fills      = solidPaint(colorHex);
  if (maxWidth > 0) {
    t.textAutoResize = 'HEIGHT';
    t.resize(maxWidth, t.height);
  }
  return t;
}

// Create a named page, delete default if needed
function ensurePage(name) {
  const existing = figma.root.children.find(p => p.name === name);
  if (existing) return existing;
  const page = figma.createPage();
  page.name = name;
  return page;
}

// Register a Figma paint style and return it
function registerPaintStyle(name, paints, description = '') {
  const s = figma.createPaintStyle();
  s.name = name;
  s.paints = paints;
  if (description) s.description = description;
  return s;
}

// Register a Figma text style and return it
async function registerTextStyle(name, family, style, size, lineHeight) {
  await figma.loadFontAsync({ family, style });
  const s = figma.createTextStyle();
  s.name = name;
  s.fontName   = { family, style };
  s.fontSize   = size;
  s.lineHeight = { value: lineHeight, unit: 'PIXELS' };
  return s;
}

// Register a Figma effect style
function registerEffectStyle(name, effects, description = '') {
  const s = figma.createEffectStyle();
  s.name = name;
  s.effects = effects;
  if (description) s.description = description;
  return s;
}

// Group nodes under a parent frame (Auto Layout HORIZONTAL by default)
function frameRow(name, children, gap = 8, paddingH = 0, paddingV = 0, fillHex = null) {
  const f = figma.createFrame();
  f.name = name;
  applyAutoLayout(f, 'HORIZONTAL', gap, paddingH, paddingV);
  if (fillHex) f.fills = solidPaint(fillHex);
  else         f.fills = [];
  for (const c of children) f.appendChild(c);
  return f;
}

function frameCol(name, children, gap = 8, paddingH = 0, paddingV = 0, fillHex = null) {
  const f = figma.createFrame();
  f.name = name;
  applyAutoLayout(f, 'VERTICAL', gap, paddingH, paddingV);
  if (fillHex) f.fills = solidPaint(fillHex);
  else         f.fills = [];
  for (const c of children) f.appendChild(c);
  return f;
}

// Stroke border
function strokeBorder(node, colorHex, weight = 1, inside = true) {
  node.strokes = solidPaint(colorHex);
  node.strokeWeight = weight;
  node.strokeAlign = inside ? 'INSIDE' : 'OUTSIDE';
}

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  hexToRgb,
  rgbaStringToRgb,
  solidPaint,
  solidPaintRgba,
  gradientPaint,
  accentGradientPaint,
  dropShadow,
  accentGlow,
  applyAutoLayout,
  rect,
  text,
  ensurePage,
  registerPaintStyle,
  registerTextStyle,
  registerEffectStyle,
  frameRow,
  frameCol,
  strokeBorder,
};
