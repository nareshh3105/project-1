// ─── Button component set builder ────────────────────────────────────────────
// Creates: button/primary, button/secondary, button/ghost, button/danger, button/icon
// Each variant matrix: state(5) × size(3) for primary; state(5) for others

const {
  solidPaint, solidPaintRgba, accentGradientPaint, accentGlow,
  applyAutoLayout, text, strokeBorder, hexToRgb,
} = require('../helpers');

// Token shorthand
const T = {
  bg:      '#1C1C27',
  bgHover: 'rgba(255,255,255,0.06)',
  border:  '#2A2A3A',
  text:    '#FFFFFF',
  textSec: '#B9B9C9',
  textMut: '#6C6C80',
  danger:  '#FF5470',
  accent:  '#8A5CFF',
};

const SIZE_MAP = {
  sm: { h: 28, px: 10, fontSize: 12 },
  md: { h: 32, px: 14, fontSize: 13 },
  lg: { h: 40, px: 18, fontSize: 14 },
};

const STATES = ['Default', 'Hover', 'Pressed', 'Active', 'Disabled'];

// Helper: create one button frame
function makeButtonFrame(label, size, fillFn, borderFn, textColor, opacity = 1) {
  const s    = SIZE_MAP[size];
  const frame = figma.createFrame();
  frame.name  = label;
  applyAutoLayout(frame, 'HORIZONTAL', 6, s.px, 0);
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.resize(frame.width, s.h);
  frame.counterAxisAlignItems = 'CENTER';
  frame.primaryAxisAlignItems  = 'CENTER';
  frame.cornerRadius  = 6;
  frame.fills   = fillFn ? fillFn() : [];
  frame.opacity = opacity;
  if (borderFn) borderFn(frame);

  const t = figma.createText();
  figma.loadFontAsync({ family: 'Inter', style: 'Medium' }).then(() => {
    t.fontName = { family: 'Inter', style: 'Medium' };
    t.fontSize = s.fontSize;
    t.characters = label;
    t.fills = solidPaint(textColor);
  });
  frame.appendChild(t);
  return frame;
}

// ─── Primary (gradient fill) ──────────────────────────────────────────────────
async function buildButtonPrimary(page) {
  const components = [];

  for (const size of ['sm', 'md', 'lg']) {
    for (const state of STATES) {
      const c = figma.createComponent();
      c.name  = `button/primary, size=${size}, state=${state}`;
      applyAutoLayout(c, 'HORIZONTAL', 6, SIZE_MAP[size].px, 0);
      c.primaryAxisSizingMode  = 'AUTO';
      c.counterAxisSizingMode  = 'FIXED';
      c.resize(c.width, SIZE_MAP[size].h);
      c.counterAxisAlignItems  = 'CENTER';
      c.primaryAxisAlignItems  = 'CENTER';
      c.cornerRadius = 6;

      switch (state) {
        case 'Default':
          c.fills  = accentGradientPaint();
          c.opacity = 1;
          break;
        case 'Hover':
          c.fills  = accentGradientPaint();
          c.opacity = 0.88;
          break;
        case 'Pressed':
          c.fills  = accentGradientPaint();
          c.opacity = 0.75;
          c.effects = [{ type: 'DROP_SHADOW', offset: { x: 0, y: 0 }, radius: 18, spread: 0,
            color: Object.assign({ a: 0.35 }, hexToRgb('#8A5CFF')), blendMode: 'NORMAL', visible: true }];
          break;
        case 'Active':
          c.fills  = accentGradientPaint();
          c.effects = [accentGlow()];
          break;
        case 'Disabled':
          c.fills  = accentGradientPaint();
          c.opacity = 0.35;
          break;
      }

      await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
      const t = figma.createText();
      t.fontName   = { family: 'Inter', style: 'Medium' };
      t.fontSize   = SIZE_MAP[size].fontSize;
      t.characters = 'Label';
      t.fills      = solidPaint('#FFFFFF');
      t.name       = 'label';
      c.appendChild(t);
      components.push(c);
    }
  }

  const set = figma.combineAsVariants(components, page);
  set.name = 'button/primary';
  set.fills = [{ type: 'SOLID', color: { r: 0.11, g: 0.11, b: 0.16 }, opacity: 0.5 }];
  set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 16;
  applyAutoLayout(set, 'HORIZONTAL', 12, 16, 16);
  return set;
}

// ─── Secondary (outline) ──────────────────────────────────────────────────────
async function buildButtonSecondary(page) {
  const components = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name = `button/secondary, state=${state}`;
    applyAutoLayout(c, 'HORIZONTAL', 6, 14, 0);
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'FIXED';
    c.resize(c.width, 32);
    c.counterAxisAlignItems = 'CENTER';
    c.primaryAxisAlignItems = 'CENTER';
    c.cornerRadius = 6;
    c.fills = solidPaint('#1C1C27');
    c.strokes = solidPaint(state === 'Active' ? '#8A5CFF' : '#2A2A3A');
    c.strokeWeight = 1;
    c.strokeAlign = 'INSIDE';
    if (state === 'Disabled') c.opacity = 0.4;
    if (state === 'Hover')    c.fills = solidPaint('#22222F');
    if (state === 'Active')   c.effects = [accentGlow()];

    await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Medium' };
    t.fontSize   = 13;
    t.characters = 'Label';
    t.fills      = solidPaint(state === 'Disabled' ? '#6C6C80' : '#B9B9C9');
    t.name       = 'label';
    c.appendChild(t);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name = 'button/secondary';
  set.fills = [];
  applyAutoLayout(set, 'HORIZONTAL', 12, 16, 16);
  return set;
}

// ─── Ghost ────────────────────────────────────────────────────────────────────
async function buildButtonGhost(page) {
  const components = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `button/ghost, state=${state}`;
    applyAutoLayout(c, 'HORIZONTAL', 6, 14, 0);
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'FIXED';
    c.resize(c.width, 32);
    c.counterAxisAlignItems = 'CENTER';
    c.primaryAxisAlignItems = 'CENTER';
    c.cornerRadius = 6;
    c.fills = state === 'Hover' ? [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.06 }] : [];
    if (state === 'Disabled') c.opacity = 0.4;

    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 13;
    t.characters = 'Label';
    t.fills      = solidPaint(state === 'Disabled' ? '#6C6C80' : '#B9B9C9');
    t.name       = 'label';
    c.appendChild(t);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name = 'button/ghost';
  set.fills = [];
  applyAutoLayout(set, 'HORIZONTAL', 12, 16, 16);
  return set;
}

// ─── Danger ───────────────────────────────────────────────────────────────────
async function buildButtonDanger(page) {
  const components = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `button/danger, state=${state}`;
    applyAutoLayout(c, 'HORIZONTAL', 6, 14, 0);
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'FIXED';
    c.resize(c.width, 32);
    c.counterAxisAlignItems = 'CENTER';
    c.primaryAxisAlignItems = 'CENTER';
    c.cornerRadius = 6;
    const alpha = state === 'Hover' ? 0.88 : state === 'Pressed' ? 0.75 : 1;
    c.fills  = [{ type: 'SOLID', color: hexToRgb('#FF5470'), opacity: alpha }];
    if (state === 'Disabled') c.opacity = 0.4;

    await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Medium' };
    t.fontSize   = 13;
    t.characters = 'Label';
    t.fills      = solidPaint('#FFFFFF');
    t.name       = 'label';
    c.appendChild(t);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name = 'button/danger';
  set.fills = [];
  applyAutoLayout(set, 'HORIZONTAL', 12, 16, 16);
  return set;
}

// ─── Icon button ──────────────────────────────────────────────────────────────
async function buildButtonIcon(page) {
  const components = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `button/icon, state=${state}`;
    c.resize(32, 32);
    c.cornerRadius = 6;
    applyAutoLayout(c, 'HORIZONTAL', 0, 0, 0);
    c.primaryAxisAlignItems  = 'CENTER';
    c.counterAxisAlignItems  = 'CENTER';
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';

    if (state === 'Default')  c.fills = solidPaint('#1C1C27');
    else if (state === 'Hover')    c.fills = solidPaint('#22222F');
    else if (state === 'Active')   c.fills = [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.18 }];
    else if (state === 'Pressed')  c.fills = solidPaint('#2A2A3A');
    else if (state === 'Disabled') { c.fills = solidPaint('#1C1C27'); c.opacity = 0.4; }

    // Icon placeholder (16×16 rounded rect)
    const icon = figma.createRectangle();
    icon.name = 'icon-placeholder';
    icon.resize(16, 16);
    icon.cornerRadius = 3;
    icon.fills = solidPaint(state === 'Active' ? '#8A5CFF' : '#6C6C80');
    c.appendChild(icon);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name = 'button/icon';
  set.fills = [];
  applyAutoLayout(set, 'HORIZONTAL', 12, 16, 16);
  return set;
}

async function buildAllButtons(page) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  const primary   = await buildButtonPrimary(page);
  const secondary = await buildButtonSecondary(page);
  const ghost     = await buildButtonGhost(page);
  const danger    = await buildButtonDanger(page);
  const icon      = await buildButtonIcon(page);

  // Position on page
  primary.x   = 0;   primary.y   = 0;
  secondary.x = 0;   secondary.y = primary.y + primary.height + 40;
  ghost.x     = 0;   ghost.y     = secondary.y + secondary.height + 40;
  danger.x    = 0;   danger.y    = ghost.y + ghost.height + 40;
  icon.x      = 0;   icon.y      = danger.y + danger.height + 40;

  return { primary, secondary, ghost, danger, icon };
}

module.exports = { buildAllButtons };
