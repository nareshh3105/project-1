// ─── OBS CodeBuilders UI Kit — Figma Plugin Orchestrator ─────────────────────
// Entry point for the Figma plugin. Registers all styles, creates pages,
// then delegates component building to the src/ modules.
//
// NOTE: Figma plugins run in a sandboxed JS environment. This file uses
// ES5-compatible syntax and inlines the module code because Figma's API
// doesn't support Node.js require() natively. In production, bundle with
// esbuild or webpack before loading. The src/ files use module.exports
// so they can be bundled cleanly.
//
// To use:
//   1. Open Figma → Plugins → Development → New Plugin → Link Existing Plugin
//   2. Select this manifest.json
//   3. Run the plugin — click "Build UI Kit"

figma.showUI(__html__, { width: 380, height: 480, title: 'OBS CodeBuilders UI Kit' });

// ─── Token definitions (mirrors tokens.json) ─────────────────────────────────
const TOKENS = {
  colors: {
    'color/bg/base':      '#0B0B0F',
    'color/bg/surface':   '#14141C',
    'color/bg/panel':     '#1C1C27',
    'color/bg/divider':   '#2A2A3A',
    'color/text/primary': '#FFFFFF',
    'color/text/secondary':'#B9B9C9',
    'color/text/muted':   '#6C6C80',
    'color/accent/start': '#8A5CFF',
    'color/accent/end':   '#FF4FD8',
    'color/state/danger': '#FF5470',
    'color/state/warning':'#FFC857',
    'color/state/success':'#3DDC97',
    'color/meter/safe':   '#3DDC97',
    'color/meter/caution':'#FFC857',
    'color/meter/clip':   '#FF5470',
  },
  gradients: {
    'gradient/accent-primary': {
      angle: 135,
      stops: [{ color: '#8A5CFF', pos: 0 }, { color: '#FF4FD8', pos: 1 }],
    },
  },
  typography: [
    { name: 'type/heading-xl',  family: 'Inter', style: 'Semi Bold', size: 24, lh: 32 },

    { name: 'type/heading-lg',  family: 'Inter', style: 'Medium',   size: 22, lh: 30 },
    { name: 'type/heading-md',  family: 'Inter', style: 'Medium',   size: 18, lh: 26 },
    { name: 'type/panel-title', family: 'Inter', style: 'Medium',   size: 15, lh: 20 },
    { name: 'type/body',        family: 'Inter', style: 'Regular',  size: 13, lh: 18 },
    { name: 'type/caption',     family: 'Inter', style: 'Regular',  size: 11, lh: 16 },
  ],
  effects: {
    'elev/panel': [{ type: 'DROP_SHADOW', offset: { x: 0, y: 1 }, radius: 2,  spread: 0, color: { r: 0, g: 0, b: 0, a: 0.35 }, blendMode: 'NORMAL', visible: true }],
    'elev/float': [{ type: 'DROP_SHADOW', offset: { x: 0, y: 12 }, radius: 32, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.55 }, blendMode: 'NORMAL', visible: true }],
    'elev/glow':  [{ type: 'DROP_SHADOW', offset: { x: 0, y: 0 },  radius: 18, spread: 0, color: { r: 0.54, g: 0.36, b: 1, a: 0.35 }, blendMode: 'NORMAL', visible: true }],
    'elev/modal': [{ type: 'DROP_SHADOW', offset: { x: 0, y: 24 }, radius: 64, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.65 }, blendMode: 'NORMAL', visible: true }],
  },
};

// ─── Utility functions ────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

function solidPaint(hex) {
  const { r, g, b } = hexToRgb(hex);
  return [{ type: 'SOLID', color: { r, g, b } }];
}

function gradientPaint(angleDeg, stops) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [{
    type: 'GRADIENT_LINEAR',
    gradientStops: stops.map(s => ({
      color: Object.assign({ a: 1 }, hexToRgb(s.color)),
      position: s.pos,
    })),
    gradientTransform: [
      [cos,  sin, 0.5 - 0.5 * cos - 0.5 * sin],
      [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
    ],
  }];
}

function accentGradient() {
  return gradientPaint(135, [{ color: '#8A5CFF', pos: 0 }, { color: '#FF4FD8', pos: 1 }]);
}

function applyAL(frame, dir, gap, ph, pv) {
  frame.layoutMode   = dir;
  frame.itemSpacing  = gap;
  frame.paddingLeft = frame.paddingRight = ph;
  frame.paddingTop  = frame.paddingBottom = pv;
  frame.primaryAxisSizingMode   = 'AUTO';
  frame.counterAxisSizingMode   = 'AUTO';
}

// ─── Helper aliases (matching names used in inlined src/ modules) ─────────────
function accentGradientPaint()            { return accentGradient(); }
function applyAutoLayout(f, d, g, ph, pv) { applyAL(f, d, g, ph, pv); }
function accentGlow() {
  return { type: 'DROP_SHADOW', offset: { x: 0, y: 0 }, radius: 18, spread: 0,
    color: { r: 0.54, g: 0.36, b: 1, a: 0.35 }, blendMode: 'NORMAL', visible: true };
}
function strokeBorder(node, hex, w, ins) {
  node.strokes = solidPaint(hex); node.strokeWeight = w || 1;
  node.strokeAlign = (ins !== false) ? 'INSIDE' : 'OUTSIDE';
}

// ─── Prototype reaction helper ───────────────────────────────────────────────
// Navigation goes in `action` (singular). `actions` array is for variable
// side-effects only — must be present but empty for navigation-only reactions.
function navReaction(destId, transition) {
  // Try action without the `navigation` / `transition` fields first — bare minimum.
  // Figma runtime rejects extra unrecognized keys; trimming to just type + destinationId.
  return {
    trigger: { type: 'ON_CLICK' },
    action: {
      type: 'NODE',
      destinationId: destId,
      navigation: 'NAVIGATE',
      transition: transition || { type: 'DISSOLVE', duration: 0.25, easing: { type: 'EASE_OUT' } },
      preserveScrollPosition: false
    },
    actions: [{
      type: 'NODE',
      destinationId: destId,
      navigation: 'NAVIGATE',
      transition: transition || { type: 'DISSOLVE', duration: 0.25, easing: { type: 'EASE_OUT' } },
      preserveScrollPosition: false
    }]
  };
}

// ─── Step notifiers ───────────────────────────────────────────────────────────

function stepStart(id, label) {
  figma.ui.postMessage({ type: 'STEP_START', stepId: id, label });
}
function stepDone(id, label) {
  figma.ui.postMessage({ type: 'STEP_DONE', stepId: id, label });
}
function stepError(id, error) {
  figma.ui.postMessage({ type: 'STEP_ERROR', stepId: id, error: String(error) });
}
function log(msg, level) {
  figma.ui.postMessage({ type: 'LOG', message: msg, level: level || 'info' });
}

// ─── Page setup ───────────────────────────────────────────────────────────────

// Free plan: max 3 pages per file
const PAGE_NAMES = [
  '01 — Tokens & Components',
  '02 — Panels, Menus & Modals',
  '03 — App Frames',
];

async function setupPages() {
  const pages = {};

  // Rename / reuse existing pages rather than creating new ones
  const existing = figma.root.children.slice();

  for (let i = 0; i < PAGE_NAMES.length; i++) {
    const name = PAGE_NAMES[i];
    const found = figma.root.children.find(p => p.name === name);
    if (found) {
      pages[name] = found;
    } else if (existing[i]) {
      // Reuse existing page (rename it)
      existing[i].name = name;
      pages[name] = existing[i];
    } else {
      const p = figma.createPage();
      p.name = name;
      pages[name] = p;
    }
  }

  return pages;
}

// ─── Cover page ───────────────────────────────────────────────────────────────

async function buildCoverPage(page) {
  await figma.setCurrentPageAsync(page);
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  const cover = figma.createFrame();
  cover.name  = 'cover';
  cover.resize(1440, 900);
  cover.fills = solidPaint('#0B0B0F');
  applyAL(cover, 'VERTICAL', 24, 0, 0);
  cover.primaryAxisSizingMode = 'FIXED';
  cover.counterAxisSizingMode = 'FIXED';
  cover.primaryAxisAlignItems  = 'CENTER';
  cover.counterAxisAlignItems  = 'CENTER';

  // Gradient blob background
  const blob = figma.createEllipse();
  blob.name   = 'bg-blob';
  blob.resize(800, 400);
  blob.fills  = [{ type: 'SOLID', color: { r: 0.54, g: 0.36, b: 1 }, opacity: 0.06 }];
  blob.effects = [{ type: 'LAYER_BLUR', radius: 80, visible: true }];
  cover.appendChild(blob);

  // Logo mark
  const logoMark = figma.createFrame();
  logoMark.name  = 'logo-mark';
  logoMark.resize(80, 80);
  logoMark.cornerRadius = 20;
  logoMark.fills = accentGradient();
  logoMark.effects = [{ type: 'DROP_SHADOW', offset: { x: 0, y: 0 }, radius: 40, spread: 0,
    color: { r: 0.54, g: 0.36, b: 1, a: 0.5 }, blendMode: 'NORMAL', visible: true }];
  applyAL(logoMark, 'HORIZONTAL', 0, 0, 0);
  logoMark.primaryAxisAlignItems  = 'CENTER';
  logoMark.counterAxisAlignItems  = 'CENTER';
  logoMark.primaryAxisSizingMode  = 'FIXED';
  logoMark.counterAxisSizingMode  = 'FIXED';
  const logoText = figma.createText();
  logoText.fontName   = { family: 'Inter', style: 'Semi Bold' };
  logoText.fontSize   = 28;
  logoText.characters = 'OBS';
  logoText.fills      = solidPaint('#FFFFFF');
  logoMark.appendChild(logoText);
  cover.appendChild(logoMark);

  const title = figma.createText();
  title.fontName   = { family: 'Inter', style: 'Semi Bold' };
  title.fontSize   = 48;
  title.characters = 'OBS Studio UI Kit';
  title.fills      = solidPaint('#FFFFFF');
  title.textAlignHorizontal = 'CENTER';
  cover.appendChild(title);

  const subtitle = figma.createText();
  subtitle.fontName   = { family: 'Inter', style: 'Regular' };
  subtitle.fontSize   = 18;
  subtitle.characters = 'Code Builders — Neon Gradient Dark Theme';
  subtitle.fills      = solidPaint('#B9B9C9');
  subtitle.textAlignHorizontal = 'CENTER';
  cover.appendChild(subtitle);

  // Feature chips row
  const chips = figma.createFrame();
  chips.name  = 'feature-chips';
  chips.fills = [];
  applyAL(chips, 'HORIZONTAL', 12, 0, 0);
  chips.primaryAxisSizingMode = 'AUTO';
  chips.counterAxisSizingMode = 'AUTO';
  chips.counterAxisAlignItems = 'CENTER';

  const chipLabels = [
    '8 Pages', '12 Panels', '10 Modals', '4 Context Menus',
    '3 App Frames', '5 Button Variants', 'Full Token System',
  ];
  for (const lbl of chipLabels) {
    const chip = figma.createFrame();
    chip.name  = lbl;
    chip.cornerRadius = 999;
    chip.fills = [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.15 }];
    chip.strokes = solidPaint('#8A5CFF');
    chip.strokeWeight = 1;
    chip.strokeAlign  = 'INSIDE';
    applyAL(chip, 'HORIZONTAL', 0, 12, 0);
    chip.primaryAxisSizingMode = 'AUTO';
    chip.counterAxisSizingMode = 'FIXED';
    chip.resize(chip.width, 28);
    chip.counterAxisAlignItems = 'CENTER';
    const ct = figma.createText();
    ct.fontName   = { family: 'Inter', style: 'Regular' };
    ct.fontSize   = 12;
    ct.characters = lbl;
    ct.fills      = solidPaint('#8A5CFF');
    chip.appendChild(ct);
    chips.appendChild(chip);
  }
  cover.appendChild(chips);

  const version = figma.createText();
  version.fontName   = { family: 'Inter', style: 'Regular' };
  version.fontSize   = 11;
  version.characters = 'v1.0.0  •  Inter · JetBrains Mono  •  Figma Auto Layout  •  Component Variants  •  Design Tokens';
  version.fills      = solidPaint('#6C6C80');
  version.textAlignHorizontal = 'CENTER';
  cover.appendChild(version);

  page.appendChild(cover);
}

// ─── Token page ───────────────────────────────────────────────────────────────

async function buildTokensPage(page) {
  await figma.setCurrentPageAsync(page);

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  // Register paint styles
  for (const [name, hex] of Object.entries(TOKENS.colors)) {
    const s = figma.createPaintStyle();
    s.name   = name;
    s.paints = solidPaint(hex);
    log('Registered style: ' + name);
  }

  // Gradient paint style
  for (const [name, def] of Object.entries(TOKENS.gradients)) {
    const s = figma.createPaintStyle();
    s.name   = name;
    s.paints = gradientPaint(def.angle, def.stops);
    log('Registered style: ' + name);
  }

  // Register text styles
  for (const t of TOKENS.typography) {
    await figma.loadFontAsync({ family: t.family, style: t.style });
    const s = figma.createTextStyle();
    s.name       = t.name;
    s.fontName   = { family: t.family, style: t.style };
    s.fontSize   = t.size;
    s.lineHeight = { value: t.lh, unit: 'PIXELS' };
    log('Registered text style: ' + t.name);
  }

  // Register effect styles
  for (const [name, effects] of Object.entries(TOKENS.effects)) {
    const s = figma.createEffectStyle();
    s.name    = name;
    s.effects = effects;
    log('Registered effect style: ' + name);
  }

  // Color swatch grid on canvas
  const swatchFrame = figma.createFrame();
  swatchFrame.name  = 'color-swatches';
  swatchFrame.fills = [];
  applyAL(swatchFrame, 'HORIZONTAL', 12, 0, 0);
  swatchFrame.primaryAxisSizingMode = 'AUTO';
  swatchFrame.counterAxisSizingMode = 'AUTO';
  swatchFrame.layoutWrap = 'WRAP';
  swatchFrame.itemSpacing = 12;
  swatchFrame.counterAxisSpacing = 12;

  for (const [name, hex] of Object.entries(TOKENS.colors)) {
    const swatch = figma.createFrame();
    swatch.name   = name;
    swatch.resize(120, 80);
    swatch.cornerRadius = 8;
    swatch.fills  = solidPaint('#14141C');
    swatch.strokes = solidPaint('#2A2A3A');
    swatch.strokeWeight = 1;
    swatch.strokeAlign  = 'INSIDE';
    applyAL(swatch, 'VERTICAL', 6, 10, 8);
    swatch.primaryAxisSizingMode = 'FIXED';
    swatch.counterAxisSizingMode = 'FIXED';

    const colorBlock = figma.createRectangle();
    colorBlock.resize(100, 28);
    colorBlock.cornerRadius = 4;
    colorBlock.fills = solidPaint(hex);
    swatch.appendChild(colorBlock);

    const n = figma.createText();
    n.fontName   = { family: 'Inter', style: 'Regular' };
    n.fontSize   = 9;
    n.characters = name.split('/').pop();
    n.fills      = solidPaint('#B9B9C9');
    swatch.appendChild(n);

    const hv = figma.createText();
    hv.fontName   = { family: 'Inter', style: 'Regular' };
    hv.fontSize   = 9;
    hv.characters = hex;
    hv.fills      = solidPaint('#6C6C80');
    swatch.appendChild(hv);

    swatchFrame.appendChild(swatch);
  }

  swatchFrame.x = 0;
  swatchFrame.y = 0;
  page.appendChild(swatchFrame);

  // Typography specimens
  const typoFrame = figma.createFrame();
  typoFrame.name  = 'typography-specimens';
  typoFrame.fills = solidPaint('#14141C');
  typoFrame.cornerRadius = 12;
  applyAL(typoFrame, 'VERTICAL', 16, 24, 24);
  typoFrame.primaryAxisSizingMode = 'AUTO';
  typoFrame.counterAxisSizingMode = 'AUTO';

  for (const t of TOKENS.typography) {
    await figma.loadFontAsync({ family: t.family, style: t.style });
    const specimen = figma.createText();
    specimen.name     = t.name;
    specimen.fontName = { family: t.family, style: t.style };
    specimen.fontSize = t.size;
    specimen.characters = t.name + '  —  The quick brown fox jumps over the lazy dog';
    specimen.fills    = solidPaint('#FFFFFF');
    typoFrame.appendChild(specimen);
  }

  typoFrame.x = 0;
  typoFrame.y = 500;
  page.appendChild(typoFrame);
}

// ─── Main build runner ────────────────────────────────────────────────────────

let buildCancelled = false;

async function runBuild() {
  buildCancelled = false;
  let pages;

  try {
    // ── Step: pages (3 total — free plan compatible) ───────────────────────
    stepStart('step-pages', 'Creating page structure (3 pages)');
    pages = await setupPages();
    const P1 = pages['01 — Tokens & Components'];
    const P2 = pages['02 — Panels, Menus & Modals'];
    const P3 = pages['03 — App Frames'];
    stepDone('step-pages', 'Page structure');
    if (buildCancelled) return cancel();

    // ── PAGE 1: Tokens + Components ────────────────────────────────────────
    stepStart('step-tokens', 'Registering color, typography & effect styles');
    await figma.setCurrentPageAsync(P1);
    await buildTokensPage(P1);
    stepDone('step-tokens', 'Color, typography & effect styles');
    if (buildCancelled) return cancel();

    stepStart('step-primitives', 'Building cover section on page 1');
    await buildCoverSection(P1);
    stepDone('step-primitives', 'Cover section');
    if (buildCancelled) return cancel();

    stepStart('step-buttons', 'Building button component set');
    await figma.setCurrentPageAsync(P1);
    await buildButtons(P1);
    stepDone('step-buttons', 'Button component set');
    if (buildCancelled) return cancel();

    stepStart('step-inputs', 'Building input component set');
    await buildInputs(P1);
    stepDone('step-inputs', 'Input component set');
    if (buildCancelled) return cancel();

    stepStart('step-list', 'Building list/item component set');
    stepDone('step-list', 'List component set (included in menus step)');
    if (buildCancelled) return cancel();

    stepStart('step-variables', 'Setting up Figma Variables (Dark + Light tokens)');
    await figma.setCurrentPageAsync(P1);
    await buildVariables();
    stepDone('step-variables', 'Figma Variables (Dark + Light tokens)');
    if (buildCancelled) return cancel();

    stepStart('step-icons', 'Building icon component set (26 icons)');
    await figma.setCurrentPageAsync(P1);
    await buildIcons(P1);
    stepDone('step-icons', 'Icon component set');
    if (buildCancelled) return cancel();

    stepStart('step-states', 'Building button & input state variants');
    await figma.setCurrentPageAsync(P1);
    await buildButtonStates(P1);
    await buildInputStates(P1);
    stepDone('step-states', 'Button & input state variants');
    if (buildCancelled) return cancel();

    // ── PAGE 2: Panels + Menus + Modals ────────────────────────────────────
    stepStart('step-panels', 'Building dockable panel system');
    await figma.setCurrentPageAsync(P2);
    await buildPanels(P2);
    stepDone('step-panels', 'Dockable panel system');
    if (buildCancelled) return cancel();

    stepStart('step-modals', 'Building modal & dialog system');
    await figma.setCurrentPageAsync(P2);
    await buildModals(P2);
    stepDone('step-modals', 'Modal & dialog system');
    if (buildCancelled) return cancel();

    stepStart('step-menus', 'Building menus & toolbars');
    await figma.setCurrentPageAsync(P2);
    await buildMenus(P2);
    stepDone('step-menus', 'Menus & toolbars');
    if (buildCancelled) return cancel();

    // ── PAGE 3: App Frames ─────────────────────────────────────────────────
    stepStart('step-frames', 'Assembling 1440×900 app frames');
    await figma.setCurrentPageAsync(P3);
    await buildAppFrames(P3);
    stepDone('step-frames', '1440×900 app frames');

    // ── Done ───────────────────────────────────────────────────────────────
    figma.ui.postMessage({
      type: 'DONE',
      summary: '3 pages — Tokens/Components · Panels/Menus/Modals · App Frames',
    });
    log('Done — go to page "03 — App Frames" to see the full UI', 'ok');

    await figma.setCurrentPageAsync(P3);
    if (P3.children.length > 0) {
      figma.viewport.scrollAndZoomIntoView(P3.children);
    }

  } catch (err) {
    stepError('step-frames', err);
    console.error('[OBS UIKit]', err);
  }
}

function cancel() {
  figma.ui.postMessage({ type: 'CANCELLED' });
}

// ─── Cover section (compact banner on Page 1) ────────────────────────────────
async function buildCoverSection(page) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  const cover = figma.createFrame();
  cover.name  = '✦ OBS CodeBuilders UI Kit';
  cover.resize(1440, 200);
  cover.fills = solidPaint('#0B0B0F');
  cover.cornerRadius = 12;
  applyAL(cover, 'HORIZONTAL', 24, 48, 0);
  cover.primaryAxisSizingMode = 'FIXED';
  cover.counterAxisSizingMode = 'FIXED';
  cover.counterAxisAlignItems = 'CENTER';

  const logo = figma.createFrame();
  logo.resize(60, 60);
  logo.cornerRadius = 14;
  logo.fills = accentGradient();
  applyAL(logo, 'HORIZONTAL', 0, 0, 0);
  logo.primaryAxisAlignItems = 'CENTER';
  logo.counterAxisAlignItems = 'CENTER';
  logo.primaryAxisSizingMode = 'FIXED';
  logo.counterAxisSizingMode = 'FIXED';
  const logoTxt = figma.createText();
  logoTxt.fontName = { family: 'Inter', style: 'Semi Bold' };
  logoTxt.fontSize = 20;
  logoTxt.characters = 'OBS';
  logoTxt.fills = solidPaint('#FFFFFF');
  logo.appendChild(logoTxt);
  cover.appendChild(logo);

  const info = figma.createFrame();
  info.fills = [];
  applyAL(info, 'VERTICAL', 6, 0, 0);
  info.primaryAxisSizingMode = 'AUTO';
  info.counterAxisSizingMode = 'AUTO';

  const h = figma.createText();
  h.fontName = { family: 'Inter', style: 'Semi Bold' };
  h.fontSize = 28;
  h.characters = 'OBS Studio UI Kit — Code Builders';
  h.fills = solidPaint('#FFFFFF');
  info.appendChild(h);

  const sub = figma.createText();
  sub.fontName = { family: 'Inter', style: 'Regular' };
  sub.fontSize = 13;
  sub.characters = 'Neon gradient dark theme  ·  3 pages  ·  Tokens · Components · Panels · Modals · Menus · App Frames';
  sub.fills = solidPaint('#6C6C80');
  info.appendChild(sub);

  cover.appendChild(info);
  cover.x = 0;
  cover.y = -240;
  page.appendChild(cover);
}

// ─── Inline component builders (adapted from src/ modules) ───────────────────
// These are compact inline versions. For the full implementation, bundle
// the src/ modules with esbuild: esbuild src/index.js --bundle --outfile=code.js

async function buildButtons(page) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  const STATES = ['Default', 'Hover', 'Pressed', 'Active', 'Disabled'];
  const variants = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `button/primary, state=${state}`;
    c.resize(100, 32);
    c.cornerRadius = 6;
    applyAL(c, 'HORIZONTAL', 0, 14, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.primaryAxisAlignItems  = 'CENTER';
    c.counterAxisAlignItems  = 'CENTER';
    c.fills  = accentGradient();
    if (state === 'Disabled') c.opacity = 0.4;
    if (state === 'Active')   c.effects = TOKENS.effects['elev/glow'];

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Medium' };
    t.fontSize   = 13;
    t.characters = 'Button';
    t.fills      = solidPaint('#FFFFFF');
    c.appendChild(t);
    variants.push(c);
  }

  // Secondary buttons
  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `button/secondary, state=${state}`;
    c.resize(100, 32);
    c.cornerRadius = 6;
    applyAL(c, 'HORIZONTAL', 0, 14, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.primaryAxisAlignItems  = 'CENTER';
    c.counterAxisAlignItems  = 'CENTER';
    c.fills   = solidPaint('#1C1C27');
    c.strokes = solidPaint('#2A2A3A');
    c.strokeWeight = 1;
    c.strokeAlign  = 'INSIDE';
    if (state === 'Disabled') c.opacity = 0.4;
    if (state === 'Active') { c.strokes = solidPaint('#8A5CFF'); c.effects = TOKENS.effects['elev/glow']; }

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Medium' };
    t.fontSize   = 13;
    t.characters = 'Button';
    t.fills      = solidPaint('#B9B9C9');
    c.appendChild(t);
    variants.push(c);
  }

  // Danger buttons
  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `button/danger, state=${state}`;
    c.resize(100, 32);
    c.cornerRadius = 6;
    applyAL(c, 'HORIZONTAL', 0, 14, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.primaryAxisAlignItems  = 'CENTER';
    c.counterAxisAlignItems  = 'CENTER';
    c.fills = solidPaint('#FF5470');
    if (state === 'Disabled') c.opacity = 0.4;

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Medium' };
    t.fontSize   = 13;
    t.characters = 'Delete';
    t.fills      = solidPaint('#FFFFFF');
    c.appendChild(t);
    variants.push(c);
  }

  // Icon buttons
  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `button/icon, state=${state}`;
    c.resize(32, 32);
    c.cornerRadius = 6;
    applyAL(c, 'HORIZONTAL', 0, 0, 0);
    c.primaryAxisSizingMode = 'FIXED';
    c.counterAxisSizingMode = 'FIXED';
    c.primaryAxisAlignItems = 'CENTER';
    c.counterAxisAlignItems = 'CENTER';
    c.fills   = solidPaint(state === 'Active' ? '#1C1C27' : '#1C1C27');
    c.strokes = solidPaint(state === 'Active' ? '#8A5CFF' : '#2A2A3A');
    c.strokeWeight = 1;
    c.strokeAlign  = 'INSIDE';
    if (state === 'Active')   c.effects = TOKENS.effects['elev/glow'];
    if (state === 'Disabled') c.opacity  = 0.4;
    const ico = figma.createRectangle();
    ico.resize(14, 14);
    ico.cornerRadius = 3;
    ico.fills = solidPaint(state === 'Active' ? '#8A5CFF' : '#6C6C80');
    c.appendChild(ico);
    variants.push(c);
  }

  const set = figma.combineAsVariants(variants, page);
  set.name  = 'button/∗';
  set.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.12 }, opacity: 0.5 }];
  applyAL(set, 'HORIZONTAL', 16, 24, 24);
  set.x = 0;
  set.y = 0;
  return set;
}

async function buildInputs(page) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });

  const variants = [];
  const inputStates = ['Default', 'Hover', 'Focus', 'Filled', 'Error', 'Disabled'];

  for (const state of inputStates) {
    const c = figma.createComponent();
    c.name  = `input/text, state=${state}`;
    c.resize(240, 32);
    c.cornerRadius = 8;
    c.fills  = solidPaint('#1C1C27');
    c.strokes = solidPaint(state === 'Focus' ? '#8A5CFF' : state === 'Error' ? '#FF5470' : '#2A2A3A');
    c.strokeWeight = state === 'Focus' ? 1.5 : 1;
    c.strokeAlign  = 'INSIDE';
    if (state === 'Disabled') c.opacity = 0.4;
    if (state === 'Focus')    c.effects  = TOKENS.effects['elev/glow'];
    applyAL(c, 'HORIZONTAL', 0, 12, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.counterAxisAlignItems  = 'CENTER';

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 13;
    t.characters = state === 'Filled' ? 'Value text' : 'Placeholder…';
    t.fills      = solidPaint(state === 'Filled' ? '#FFFFFF' : '#6C6C80');
    t.layoutGrow = 1;
    c.appendChild(t);
    variants.push(c);
  }

  // Toggle
  for (const state of ['Off', 'On', 'Disabled']) {
    const c = figma.createComponent();
    c.name  = `input/toggle, state=${state}`;
    applyAL(c, 'HORIZONTAL', 8, 0, 0);
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'AUTO';
    c.counterAxisAlignItems = 'CENTER';
    if (state === 'Disabled') c.opacity = 0.4;

    const track = figma.createRectangle();
    track.resize(36, 20);
    track.cornerRadius = 999;
    track.fills = state === 'On' ? accentGradient() : solidPaint('#2A2A3A');
    c.appendChild(track);

    const lbl = figma.createText();
    lbl.fontName   = { family: 'Inter', style: 'Regular' };
    lbl.fontSize   = 13;
    lbl.characters = 'Toggle';
    lbl.fills      = solidPaint('#B9B9C9');
    c.appendChild(lbl);
    variants.push(c);
  }

  // Checkbox
  for (const state of ['Unchecked', 'Checked', 'Indeterminate', 'Disabled']) {
    const c = figma.createComponent();
    c.name  = `input/checkbox, state=${state}`;
    applyAL(c, 'HORIZONTAL', 8, 0, 0);
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'AUTO';
    c.counterAxisAlignItems = 'CENTER';
    if (state === 'Disabled') c.opacity = 0.4;

    const box = figma.createRectangle();
    box.resize(16, 16);
    box.cornerRadius = 4;
    box.fills   = state === 'Checked' || state === 'Indeterminate' ? accentGradient() : [];
    box.strokes = (state === 'Checked' || state === 'Indeterminate') ? [] : solidPaint('#2A2A3A');
    box.strokeWeight = 1.5;
    box.strokeAlign  = 'INSIDE';
    c.appendChild(box);

    const lbl = figma.createText();
    lbl.fontName   = { family: 'Inter', style: 'Regular' };
    lbl.fontSize   = 13;
    lbl.characters = 'Checkbox';
    lbl.fills      = solidPaint('#B9B9C9');
    c.appendChild(lbl);
    variants.push(c);
  }

  // Audio meter
  for (const orientation of ['horizontal', 'vertical']) {
    const c = figma.createComponent();
    c.name  = `meter/audio, orientation=${orientation}`;
    c.resize(orientation === 'horizontal' ? 200 : 12, orientation === 'horizontal' ? 8 : 100);
    c.cornerRadius = 2;
    c.fills  = solidPaint('#0B0B0F');
    applyAL(c, orientation === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL', 0, 0, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';

    const safe = figma.createRectangle();
    safe.resize(orientation === 'horizontal' ? 120 : 12, orientation === 'horizontal' ? 8 : 60);
    safe.fills = solidPaint('#3DDC97');
    safe.cornerRadius = 2;
    c.appendChild(safe);

    const caution = figma.createRectangle();
    caution.resize(orientation === 'horizontal' ? 50 : 12, orientation === 'horizontal' ? 8 : 25);
    caution.fills = solidPaint('#FFC857');
    c.appendChild(caution);

    const clip = figma.createRectangle();
    clip.resize(orientation === 'horizontal' ? 30 : 12, orientation === 'horizontal' ? 8 : 15);
    clip.fills = solidPaint('#FF5470');
    c.appendChild(clip);
    variants.push(c);
  }

  const set = figma.combineAsVariants(variants, page);
  set.name  = 'input/∗ + meter/∗';
  set.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.12 }, opacity: 0.5 }];
  applyAL(set, 'VERTICAL', 12, 24, 24);
  set.x = 0;
  set.y = 160;
  return set;
}

// ─── buildPanels (inlined from src/components/panels.js) ─────────────────────
async function buildPanels(page) {
  async function makeText(str, size, weight, color) {
    await figma.loadFontAsync({ family: 'Inter', style: weight });
    const t = figma.createText();
    t.fontName = { family: 'Inter', style: weight }; t.fontSize = size;
    t.characters = str; t.fills = solidPaint(color); return t;
  }
  async function makePanelHeader(title, withSearch) {
    const h = figma.createFrame(); h.name = 'header'; h.resize(280, 36);
    h.fills = solidPaint('#14141C'); applyAutoLayout(h, 'HORIZONTAL', 6, 10, 0);
    h.primaryAxisSizingMode = 'FIXED'; h.counterAxisSizingMode = 'FIXED';
    h.counterAxisAlignItems = 'CENTER'; h.primaryAxisAlignItems = 'SPACE_BETWEEN';
    const drag = figma.createRectangle(); drag.name = 'drag-handle';
    drag.resize(6, 18); drag.cornerRadius = 3; drag.fills = solidPaint('#2A2A3A'); h.appendChild(drag);
    const tn = await makeText(title, 13, 'Medium', '#FFFFFF'); tn.name = 'title'; tn.layoutGrow = 1; h.appendChild(tn);
    if (withSearch) { const sb = figma.createRectangle(); sb.name = 'search-btn'; sb.resize(16,16); sb.cornerRadius = 3; sb.fills = solidPaint('#6C6C80'); h.appendChild(sb); }
    const set = figma.createRectangle(); set.name = 'settings-btn'; set.resize(16,16); set.cornerRadius = 8; set.fills = solidPaint('#6C6C80'); h.appendChild(set);
    const cl = figma.createRectangle(); cl.name = 'close-btn'; cl.resize(14,14); cl.cornerRadius = 7; cl.fills = solidPaint('#FF5470'); h.appendChild(cl);
    return h;
  }
  function makeToolbar(icons) {
    const bar = figma.createFrame(); bar.name = 'toolbar'; bar.fills = solidPaint('#0B0B0F');
    applyAutoLayout(bar, 'HORIZONTAL', 2, 6, 4); bar.primaryAxisSizingMode = 'AUTO'; bar.counterAxisSizingMode = 'AUTO';
    for (const lbl of icons) {
      const btn = figma.createFrame(); btn.name = 'btn-' + lbl; btn.resize(24,24); btn.cornerRadius = 4; btn.fills = solidPaint('#1C1C27');
      applyAutoLayout(btn,'HORIZONTAL',0,0,0); btn.primaryAxisAlignItems='CENTER'; btn.counterAxisAlignItems='CENTER';
      btn.primaryAxisSizingMode='FIXED'; btn.counterAxisSizingMode='FIXED';
      const ico = figma.createRectangle(); ico.resize(12,12); ico.cornerRadius=2; ico.fills=solidPaint('#6C6C80'); btn.appendChild(ico); bar.appendChild(btn);
    }
    return bar;
  }
  async function makeListItem(label, isActive, hasEye) {
    const row = figma.createFrame(); row.name = label; row.resize(260,28);
    row.fills = isActive ? [{ type:'SOLID', color:hexToRgb('#8A5CFF'), opacity:0.18 }] : [];
    row.cornerRadius = 6; applyAutoLayout(row,'HORIZONTAL',6,8,0);
    row.primaryAxisSizingMode='FIXED'; row.counterAxisSizingMode='FIXED'; row.counterAxisAlignItems='CENTER';
    if (isActive) { const a=figma.createRectangle(); a.resize(3,18); a.cornerRadius=999; a.fills=accentGradientPaint(); row.appendChild(a); }
    const ico=figma.createRectangle(); ico.resize(14,14); ico.cornerRadius=3; ico.fills=solidPaint(isActive?'#8A5CFF':'#2A2A3A'); row.appendChild(ico);
    await figma.loadFontAsync({family:'Inter',style:'Regular'});
    const t=figma.createText(); t.fontName={family:'Inter',style:'Regular'}; t.fontSize=12;
    t.characters=label; t.fills=solidPaint(isActive?'#FFFFFF':'#B9B9C9'); t.layoutGrow=1; row.appendChild(t);
    if (hasEye) { const e=figma.createEllipse(); e.resize(12,12); e.fills=solidPaint('#6C6C80'); row.appendChild(e); }
    const lk=figma.createRectangle(); lk.resize(10,12); lk.cornerRadius=2; lk.fills=solidPaint('#2A2A3A'); row.appendChild(lk);
    return row;
  }
  async function makeChannelStrip(name, isMuted) {
    const s=figma.createFrame(); s.name='mixer/channel-strip — '+name; s.resize(110,180);
    s.fills=solidPaint('#14141C'); s.cornerRadius=8; applyAutoLayout(s,'VERTICAL',6,8,8);
    s.primaryAxisSizingMode='FIXED'; s.counterAxisSizingMode='FIXED';
    await figma.loadFontAsync({family:'Inter',style:'Regular'});
    const lbl=figma.createText(); lbl.fontName={family:'Inter',style:'Regular'}; lbl.fontSize=11;
    lbl.characters=name; lbl.fills=solidPaint('#B9B9C9'); lbl.textAlignHorizontal='CENTER'; s.appendChild(lbl);
    const mg=figma.createFrame(); mg.name='meter'; mg.resize(24,80); mg.fills=solidPaint('#0B0B0F'); mg.cornerRadius=3;
    applyAutoLayout(mg,'HORIZONTAL',2,2,2); mg.primaryAxisSizingMode='FIXED'; mg.counterAxisSizingMode='FIXED';
    for (let c=0;c<2;c++){const b=figma.createRectangle();b.resize(8,60);b.cornerRadius=2;b.fills=solidPaint(isMuted?'#2A2A3A':'#3DDC97');mg.appendChild(b);}
    s.appendChild(mg);
    const st=figma.createRectangle(); st.resize(4,50); st.cornerRadius=999; st.fills=solidPaint('#2A2A3A'); s.appendChild(st);
    const mu=figma.createFrame(); mu.name='mute-btn'; mu.resize(28,22); mu.cornerRadius=4; mu.fills=solidPaint(isMuted?'#FF5470':'#1C1C27');
    applyAutoLayout(mu,'HORIZONTAL',0,0,0); mu.primaryAxisAlignItems='CENTER'; mu.counterAxisAlignItems='CENTER';
    mu.primaryAxisSizingMode='FIXED'; mu.counterAxisSizingMode='FIXED';
    const mi=figma.createRectangle(); mi.resize(12,12); mi.cornerRadius=2; mi.fills=solidPaint('#FFFFFF'); mu.appendChild(mi); s.appendChild(mu);
    return s;
  }
  async function buildPanelScenes() {
    const p=figma.createComponent(); p.name='panel/scenes'; p.resize(280,300);
    p.fills=solidPaint('#1C1C27'); p.cornerRadius=12; applyAutoLayout(p,'VERTICAL',0,0,0);
    p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    p.appendChild(await makePanelHeader('Scenes',true));
    const d=figma.createRectangle(); d.resize(280,1); d.fills=solidPaint('#2A2A3A'); p.appendChild(d);
    p.appendChild(makeToolbar(['+','−','dup','↑','↓']));
    const list=figma.createFrame(); list.name='scene-list'; list.fills=[];
    applyAutoLayout(list,'VERTICAL',2,8,4); list.primaryAxisSizingMode='FIXED'; list.counterAxisSizingMode='FIXED'; list.resize(280,220);
    const names=['Main Scene','Webcam Only','Screen Share','Intermission','Starting Soon'];
    for (let i=0;i<names.length;i++) list.appendChild(await makeListItem(names[i],i===0));
    p.appendChild(list); return p;
  }
  async function buildPanelSources() {
    const p=figma.createComponent(); p.name='panel/sources'; p.resize(280,280);
    p.fills=solidPaint('#1C1C27'); p.cornerRadius=12; applyAutoLayout(p,'VERTICAL',0,0,0);
    p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    p.appendChild(await makePanelHeader('Sources'));
    const d=figma.createRectangle(); d.resize(280,1); d.fills=solidPaint('#2A2A3A'); p.appendChild(d);
    p.appendChild(makeToolbar(['+','−','dup','↑','↓','props','filters']));
    const list=figma.createFrame(); list.name='source-list'; list.fills=[];
    applyAutoLayout(list,'VERTICAL',2,8,4); list.resize(280,190);
    list.primaryAxisSizingMode='FIXED'; list.counterAxisSizingMode='FIXED';
    const srcs=['Display Capture','Webcam (FaceTime)','Microphone/AUX','Browser Source','Image Overlay'];
    for (let i=0;i<srcs.length;i++) list.appendChild(await makeListItem(srcs[i],i===0,true));
    p.appendChild(list); return p;
  }
  async function buildPanelMixer() {
    const p=figma.createComponent(); p.name='panel/mixer'; p.fills=solidPaint('#1C1C27'); p.cornerRadius=12;
    applyAutoLayout(p,'VERTICAL',0,0,0); p.primaryAxisSizingMode='AUTO'; p.counterAxisSizingMode='AUTO';
    p.appendChild(await makePanelHeader('Audio Mixer'));
    const d=figma.createRectangle(); d.resize(600,1); d.fills=solidPaint('#2A2A3A'); p.appendChild(d);
    const strips=figma.createFrame(); strips.name='channel-strips'; strips.fills=[];
    applyAutoLayout(strips,'HORIZONTAL',8,12,12); strips.primaryAxisSizingMode='AUTO'; strips.counterAxisSizingMode='AUTO';
    const chs=['Desktop Audio','Mic/Aux','Browser Src','Game Capture','Music'];
    for (let i=0;i<chs.length;i++) strips.appendChild(await makeChannelStrip(chs[i],i===1));
    p.appendChild(strips); return p;
  }
  async function buildPanelTransitions() {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const p=figma.createComponent(); p.name='panel/transitions'; p.resize(280,140);
    p.fills=solidPaint('#1C1C27'); p.cornerRadius=12; applyAutoLayout(p,'VERTICAL',8,12,10);
    p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    const ti=figma.createText(); ti.fontName={family:'Inter',style:'Medium'}; ti.fontSize=13;
    ti.characters='Scene Transitions'; ti.fills=solidPaint('#FFFFFF'); p.appendChild(ti);
    const dd=figma.createFrame(); dd.name='transition-type'; dd.resize(256,30); dd.cornerRadius=8;
    dd.fills=solidPaint('#14141C'); dd.strokes=solidPaint('#2A2A3A'); dd.strokeWeight=1; dd.strokeAlign='INSIDE';
    applyAutoLayout(dd,'HORIZONTAL',8,10,0); dd.primaryAxisSizingMode='FIXED'; dd.counterAxisSizingMode='FIXED';
    dd.counterAxisAlignItems='CENTER'; dd.primaryAxisAlignItems='SPACE_BETWEEN';
    const ddt=figma.createText(); ddt.fontName={family:'Inter',style:'Regular'}; ddt.fontSize=13;
    ddt.characters='Fade'; ddt.fills=solidPaint('#FFFFFF'); dd.appendChild(ddt); p.appendChild(dd);
    const dr=figma.createFrame(); dr.name='duration-row'; dr.fills=[]; applyAutoLayout(dr,'HORIZONTAL',8,0,0);
    dr.primaryAxisSizingMode='AUTO'; dr.counterAxisSizingMode='AUTO'; dr.counterAxisAlignItems='CENTER';
    const drl=figma.createText(); drl.fontName={family:'Inter',style:'Regular'}; drl.fontSize=12;
    drl.characters='Duration:'; drl.fills=solidPaint('#B9B9C9'); dr.appendChild(drl);
    const di=figma.createFrame(); di.name='duration-input'; di.resize(80,26); di.cornerRadius=6;
    di.fills=solidPaint('#14141C'); di.strokes=solidPaint('#2A2A3A'); di.strokeWeight=1; di.strokeAlign='INSIDE';
    applyAutoLayout(di,'HORIZONTAL',0,10,0); di.primaryAxisSizingMode='FIXED'; di.counterAxisSizingMode='FIXED'; di.counterAxisAlignItems='CENTER';
    const dv=figma.createText(); dv.fontName={family:'Inter',style:'Regular'}; dv.fontSize=12;
    dv.characters='300 ms'; dv.fills=solidPaint('#FFFFFF'); di.appendChild(dv); dr.appendChild(di); p.appendChild(dr);
    const tb=figma.createFrame(); tb.name='transition-btn'; tb.resize(256,32); tb.cornerRadius=6; tb.fills=accentGradientPaint();
    applyAutoLayout(tb,'HORIZONTAL',0,0,0); tb.primaryAxisAlignItems='CENTER'; tb.counterAxisAlignItems='CENTER';
    tb.primaryAxisSizingMode='FIXED'; tb.counterAxisSizingMode='FIXED';
    const tbl=figma.createText(); tbl.fontName={family:'Inter',style:'Medium'}; tbl.fontSize=13;
    tbl.characters='Transition'; tbl.fills=solidPaint('#FFFFFF'); tb.appendChild(tbl); p.appendChild(tb);
    return p;
  }
  async function buildPanelControls() {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const p=figma.createComponent(); p.name='panel/controls'; p.resize(180,280);
    p.fills=solidPaint('#1C1C27'); p.cornerRadius=12; applyAutoLayout(p,'VERTICAL',6,10,10);
    p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    const btns=[{label:'Start Streaming',gradient:true},{label:'Start Recording',gradient:false},
                {label:'Start Virtual Camera',gradient:false},{label:'Studio Mode',gradient:false},
                {label:'Settings',gradient:false},{label:'Exit',gradient:false,danger:true}];
    for (const b of btns) {
      const btn=figma.createFrame(); btn.name=b.label; btn.resize(160,36); btn.cornerRadius=6;
      btn.fills=b.gradient?accentGradientPaint():b.danger?solidPaint('#FF5470'):solidPaint('#14141C');
      if (!b.gradient&&!b.danger){btn.strokes=solidPaint('#2A2A3A');btn.strokeWeight=1;btn.strokeAlign='INSIDE';}
      applyAutoLayout(btn,'HORIZONTAL',0,0,0); btn.primaryAxisAlignItems='CENTER'; btn.counterAxisAlignItems='CENTER';
      btn.primaryAxisSizingMode='FIXED'; btn.counterAxisSizingMode='FIXED';
      const t=figma.createText(); t.fontName={family:'Inter',style:'Medium'}; t.fontSize=12;
      t.characters=b.label; t.fills=solidPaint('#FFFFFF'); btn.appendChild(t); p.appendChild(btn);
    }
    return p;
  }
  async function buildPanelStats() {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const p=figma.createComponent(); p.name='panel/stats'; p.fills=solidPaint('#1C1C27'); p.cornerRadius=12;
    applyAutoLayout(p,'VERTICAL',0,0,0); p.primaryAxisSizingMode='AUTO'; p.counterAxisSizingMode='AUTO';
    p.appendChild(await makePanelHeader('Statistics'));
    const grid=figma.createFrame(); grid.name='stats-grid'; grid.fills=[];
    applyAutoLayout(grid,'HORIZONTAL',8,12,10); grid.primaryAxisSizingMode='AUTO'; grid.counterAxisSizingMode='AUTO';
    grid.layoutWrap='WRAP'; grid.itemSpacing=8; grid.counterAxisSpacing=8;
    const metrics=[{label:'CPU Usage',value:'12.4%'},{label:'Memory',value:'1.2 GB'},
      {label:'Avg Frame Time',value:'4.2 ms'},{label:'FPS',value:'60.0'},
      {label:'Skipped Frames',value:'0 (0%)'},{label:'Dropped Frames',value:'0 (0%)'},
      {label:'Encoding Lag',value:'0 ms'},{label:'Render Lag',value:'0 ms'}];
    for (const m of metrics) {
      const c=figma.createFrame(); c.name=m.label; c.resize(120,56); c.cornerRadius=8;
      c.fills=solidPaint('#14141C'); c.strokes=solidPaint('#2A2A3A'); c.strokeWeight=1; c.strokeAlign='INSIDE';
      applyAutoLayout(c,'VERTICAL',4,10,8); c.primaryAxisSizingMode='FIXED'; c.counterAxisSizingMode='FIXED';
      const lb=figma.createText(); lb.fontName={family:'Inter',style:'Regular'}; lb.fontSize=10;
      lb.characters=m.label; lb.fills=solidPaint('#6C6C80'); c.appendChild(lb);
      const vl=figma.createText(); vl.fontName={family:'Inter',style:'Medium'}; vl.fontSize=18;
      vl.characters=m.value; vl.fills=solidPaint('#FFFFFF'); c.appendChild(vl); grid.appendChild(c);
    }
    p.appendChild(grid); return p;
  }
  async function buildPanelPreview() {
    const p=figma.createComponent(); p.name='panel/preview'; p.resize(640,380);
    p.fills=solidPaint('#0B0B0F'); p.cornerRadius=12; applyAutoLayout(p,'VERTICAL',0,0,0);
    p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    const hd=figma.createFrame(); hd.name='preview-header'; hd.resize(640,32); hd.fills=solidPaint('#14141C');
    applyAutoLayout(hd,'HORIZONTAL',8,10,0); hd.primaryAxisSizingMode='FIXED'; hd.counterAxisSizingMode='FIXED';
    hd.counterAxisAlignItems='CENTER'; hd.primaryAxisAlignItems='SPACE_BETWEEN';
    await figma.loadFontAsync({family:'Inter',style:'Medium'}); await figma.loadFontAsync({family:'Inter',style:'Regular'});
    const pl=figma.createText(); pl.fontName={family:'Inter',style:'Medium'}; pl.fontSize=12;
    pl.characters='Preview'; pl.fills=solidPaint('#B9B9C9'); hd.appendChild(pl);
    const zc=figma.createFrame(); zc.name='zoom-chip'; zc.resize(50,20); zc.cornerRadius=4; zc.fills=solidPaint('#1C1C27');
    applyAutoLayout(zc,'HORIZONTAL',0,8,0); zc.primaryAxisSizingMode='FIXED'; zc.counterAxisSizingMode='FIXED';
    zc.counterAxisAlignItems='CENTER'; zc.primaryAxisAlignItems='CENTER';
    const zt=figma.createText(); zt.fontName={family:'Inter',style:'Regular'}; zt.fontSize=10;
    zt.characters='100%'; zt.fills=solidPaint('#6C6C80'); zc.appendChild(zt); hd.appendChild(zc); p.appendChild(hd);
    const cv=figma.createFrame(); cv.name='canvas'; cv.resize(640,336); cv.fills=solidPaint('#000000');
    applyAutoLayout(cv,'HORIZONTAL',0,0,0); cv.primaryAxisSizingMode='FIXED'; cv.counterAxisSizingMode='FIXED';
    cv.primaryAxisAlignItems='CENTER'; cv.counterAxisAlignItems='CENTER';
    const sa=figma.createRectangle(); sa.name='safe-margin'; sa.resize(576,303); sa.fills=[];
    sa.strokes=solidPaint('#2A2A3A'); sa.strokeWeight=1; sa.dashPattern=[4,4]; cv.appendChild(sa);
    const bg=figma.createFrame(); bg.name='aspect-badge'; bg.resize(40,18); bg.cornerRadius=4; bg.fills=solidPaint('#1C1C27');
    applyAutoLayout(bg,'HORIZONTAL',0,6,0); bg.primaryAxisSizingMode='FIXED'; bg.counterAxisSizingMode='FIXED';
    bg.primaryAxisAlignItems='CENTER'; bg.counterAxisAlignItems='CENTER';
    const bt=figma.createText(); bt.fontName={family:'Inter',style:'Regular'}; bt.fontSize=9;
    bt.characters='16:9'; bt.fills=solidPaint('#6C6C80'); bg.appendChild(bt); cv.appendChild(bg); p.appendChild(cv);
    return p;
  }
  async function buildPanelProgram() {
    const p=await buildPanelPreview(); p.name='panel/program';
    const hd=p.findChild(n=>n.name==='preview-header');
    if (hd) {
      const lbl=hd.findChild(n=>n.type==='TEXT');
      if (lbl){await figma.loadFontAsync({family:'Inter',style:'Medium'}); lbl.characters='Program';}
      const lv=figma.createFrame(); lv.name='live-pill'; lv.resize(38,18); lv.cornerRadius=999; lv.fills=solidPaint('#FF5470');
      applyAutoLayout(lv,'HORIZONTAL',0,8,0); lv.primaryAxisSizingMode='FIXED'; lv.counterAxisSizingMode='FIXED';
      lv.primaryAxisAlignItems='CENTER'; lv.counterAxisAlignItems='CENTER';
      await figma.loadFontAsync({family:'Inter',style:'Semi Bold'});
      const lt=figma.createText(); lt.fontName={family:'Inter',style:'Semi Bold'}; lt.fontSize=9;
      lt.characters='LIVE'; lt.fills=solidPaint('#FFFFFF'); lv.appendChild(lt); hd.insertChild(0,lv);
    }
    return p;
  }
  async function buildPanelStudioMode() {
    const preview=await buildPanelPreview(); const program=await buildPanelProgram();
    const sf=figma.createFrame(); sf.name='panel/studio-mode'; sf.fills=solidPaint('#0B0B0F'); sf.cornerRadius=12;
    applyAutoLayout(sf,'HORIZONTAL',16,16,16); sf.primaryAxisSizingMode='AUTO'; sf.counterAxisSizingMode='AUTO';
    sf.appendChild(preview);
    const tc=figma.createFrame(); tc.name='transition-column'; tc.resize(80,380); tc.fills=solidPaint('#14141C'); tc.cornerRadius=8;
    applyAutoLayout(tc,'VERTICAL',12,10,12); tc.primaryAxisSizingMode='FIXED'; tc.counterAxisSizingMode='FIXED';
    tc.primaryAxisAlignItems='CENTER'; tc.counterAxisAlignItems='CENTER';
    const tb=figma.createFrame(); tb.name='cut-transition'; tb.resize(60,32); tb.cornerRadius=6; tb.fills=accentGradientPaint();
    applyAutoLayout(tb,'HORIZONTAL',0,0,0); tb.primaryAxisAlignItems='CENTER'; tb.counterAxisAlignItems='CENTER';
    tb.primaryAxisSizingMode='FIXED'; tb.counterAxisSizingMode='FIXED';
    await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const tl=figma.createText(); tl.fontName={family:'Inter',style:'Medium'}; tl.fontSize=10;
    tl.characters='Cut'; tl.fills=solidPaint('#FFFFFF'); tb.appendChild(tl); tc.appendChild(tb);
    sf.appendChild(tc); sf.appendChild(program); return sf;
  }
  async function buildPanelPluginSlot() {
    await figma.loadFontAsync({family:'Inter',style:'Regular'});
    const p=figma.createComponent(); p.name='panel/plugin-slot'; p.resize(280,200); p.cornerRadius=12;
    p.fills=solidPaint('#1C1C27'); p.strokes=[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.5}];
    p.strokeWeight=1.5; p.strokeAlign='INSIDE'; p.dashPattern=[6,4];
    applyAutoLayout(p,'VERTICAL',8,20,20); p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    p.primaryAxisAlignItems='CENTER'; p.counterAxisAlignItems='CENTER';
    const ic=figma.createRectangle(); ic.resize(32,32); ic.cornerRadius=8;
    ic.fills=[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.3}]; p.appendChild(ic);
    const t1=figma.createText(); t1.fontName={family:'Inter',style:'Regular'}; t1.fontSize=13;
    t1.characters='Plugin Dock'; t1.fills=solidPaint('#B9B9C9'); t1.textAlignHorizontal='CENTER'; p.appendChild(t1);
    const t2=figma.createText(); t2.fontName={family:'Inter',style:'Regular'}; t2.fontSize=11;
    t2.characters='Extension panel placeholder\nPlugin API ready'; t2.fills=solidPaint('#6C6C80'); t2.textAlignHorizontal='CENTER'; p.appendChild(t2);
    return p;
  }
  async function buildPanelLogViewer() {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const p=figma.createComponent(); p.name='panel/log-viewer'; p.resize(560,280);
    p.fills=solidPaint('#1C1C27'); p.cornerRadius=12; applyAutoLayout(p,'VERTICAL',0,0,0);
    p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    p.appendChild(await makePanelHeader('Log Viewer')); p.appendChild(makeToolbar(['filter','clear','copy','save']));
    const la=figma.createFrame(); la.name='log-area'; la.fills=solidPaint('#0B0B0F'); la.resize(560,218);
    applyAutoLayout(la,'VERTICAL',2,10,8); la.primaryAxisSizingMode='FIXED'; la.counterAxisSizingMode='FIXED';
    const lines=[
      {level:'INFO', msg:'[08:00:00.001] OBS Studio initialized',color:'#B9B9C9'},
      {level:'INFO', msg:'[08:00:00.120] Audio device: Default',color:'#B9B9C9'},
      {level:'WARN', msg:'[08:00:01.000] Encoder lag detected (12ms)',color:'#FFC857'},
      {level:'ERROR',msg:'[08:00:02.500] Failed to connect to stream server',color:'#FF5470'},
      {level:'INFO', msg:'[08:00:03.000] Reconnecting…',color:'#B9B9C9'},
      {level:'INFO', msg:'[08:00:04.200] Stream connected (bitrate: 6000 kbps)',color:'#3DDC97'},
    ];
    for (const ln of lines) {
      const row=figma.createFrame(); row.fills=[]; applyAutoLayout(row,'HORIZONTAL',6,0,0);
      row.primaryAxisSizingMode='AUTO'; row.counterAxisSizingMode='AUTO'; row.counterAxisAlignItems='CENTER';
      const ch=figma.createFrame(); ch.resize(40,16); ch.cornerRadius=3;
      ch.fills=solidPaint(ln.level==='ERROR'?'#FF5470':ln.level==='WARN'?'#FFC857':'#2A2A3A');
      applyAutoLayout(ch,'HORIZONTAL',0,4,0); ch.primaryAxisSizingMode='FIXED'; ch.counterAxisSizingMode='FIXED';
      ch.primaryAxisAlignItems='CENTER'; ch.counterAxisAlignItems='CENTER';
      const ct=figma.createText(); ct.fontName={family:'Inter',style:'Medium'}; ct.fontSize=9;
      ct.characters=ln.level; ct.fills=solidPaint('#FFFFFF'); ch.appendChild(ct); row.appendChild(ch);
      const mg=figma.createText(); mg.fontName={family:'Inter',style:'Regular'}; mg.fontSize=11;
      mg.characters=ln.msg; mg.fills=solidPaint(ln.color); row.appendChild(mg); la.appendChild(row);
    }
    p.appendChild(la); return p;
  }

  await figma.loadFontAsync({family:'Inter',style:'Regular'});
  await figma.loadFontAsync({family:'Inter',style:'Medium'});
  await figma.loadFontAsync({family:'Inter',style:'Semi Bold'});
  const scenes=await buildPanelScenes(); const sources=await buildPanelSources();
  const mixer=await buildPanelMixer(); const transitions=await buildPanelTransitions();
  const controls=await buildPanelControls(); const stats=await buildPanelStats();
  const logViewer=await buildPanelLogViewer(); const preview=await buildPanelPreview();
  const program=await buildPanelProgram(); const studioMode=await buildPanelStudioMode();
  const pluginSlot=await buildPanelPluginSlot();
  const nodes=[scenes,sources,mixer,transitions,controls,stats,logViewer,preview,program,studioMode,pluginSlot];
  let px=0, py=0, pc=0;
  for (const n of nodes) {
    n.x=px; n.y=py; page.appendChild(n); pc++;
    if (pc>=3){px=0;py+=400;pc=0;} else {px+=n.width+40;}
  }
  return {scenes,sources,mixer,transitions,controls,stats,logViewer,preview,program,studioMode,pluginSlot};
}

// ─── buildModals (inlined from src/components/modals.js) ─────────────────────
async function buildModals(page) {
  async function mt(str, size, weight, color) {
    await figma.loadFontAsync({family:'Inter',style:weight});
    const n=figma.createText(); n.fontName={family:'Inter',style:weight};
    n.fontSize=size; n.characters=str; n.fills=solidPaint(color); return n;
  }
  async function makeModalFrame(title, width, height, withSidebar) {
    const overlay=figma.createFrame(); overlay.name='modal-overlay/'+title;
    overlay.resize(1440,900); overlay.fills=[{type:'SOLID',color:{r:0,g:0,b:0},opacity:0.6}];
    applyAutoLayout(overlay,'HORIZONTAL',0,0,0); overlay.primaryAxisSizingMode='FIXED'; overlay.counterAxisSizingMode='FIXED';
    overlay.primaryAxisAlignItems='CENTER'; overlay.counterAxisAlignItems='CENTER';
    const modal=figma.createFrame(); modal.name='modal/'+title.toLowerCase().replace(/\s+/g,'-');
    modal.resize(width,height); modal.fills=solidPaint('#1C1C27'); modal.cornerRadius=12;
    modal.effects=[{type:'DROP_SHADOW',offset:{x:0,y:24},radius:64,spread:0,color:{r:0,g:0,b:0,a:0.65},blendMode:'NORMAL',visible:true}];
    applyAutoLayout(modal,'VERTICAL',0,0,0); modal.primaryAxisSizingMode='FIXED'; modal.counterAxisSizingMode='FIXED';
    const tb=figma.createFrame(); tb.name='titlebar'; tb.resize(width,44); tb.fills=solidPaint('#14141C');
    applyAutoLayout(tb,'HORIZONTAL',8,16,0); tb.primaryAxisSizingMode='FIXED'; tb.counterAxisSizingMode='FIXED';
    tb.counterAxisAlignItems='CENTER'; tb.primaryAxisAlignItems='SPACE_BETWEEN';
    const tt=await mt(title,15,'Medium','#FFFFFF'); tt.layoutGrow=1; tb.appendChild(tt);
    const cl=figma.createRectangle(); cl.name='close-btn'; cl.resize(14,14); cl.cornerRadius=7; cl.fills=solidPaint('#FF5470'); tb.appendChild(cl);
    modal.appendChild(tb);
    const dv=figma.createRectangle(); dv.resize(width,1); dv.fills=solidPaint('#2A2A3A'); modal.appendChild(dv);
    if (withSidebar) {
      const br=figma.createFrame(); br.name='body-row'; br.fills=[]; applyAutoLayout(br,'HORIZONTAL',0,0,0);
      br.primaryAxisSizingMode='FIXED'; br.counterAxisSizingMode='FIXED'; br.resize(width,height-44-1-52);
      const sb=figma.createFrame(); sb.name='sidebar'; sb.resize(180,height-44-1-52); sb.fills=solidPaint('#14141C');
      applyAutoLayout(sb,'VERTICAL',2,0,8); sb.primaryAxisSizingMode='FIXED'; sb.counterAxisSizingMode='FIXED'; br.appendChild(sb);
      const sd=figma.createRectangle(); sd.resize(1,height-44-1-52); sd.fills=solidPaint('#2A2A3A'); br.appendChild(sd);
      const ct=figma.createFrame(); ct.name='content'; ct.resize(width-181,height-44-1-52); ct.fills=[];
      applyAutoLayout(ct,'VERTICAL',16,24,20); ct.primaryAxisSizingMode='FIXED'; ct.counterAxisSizingMode='FIXED'; ct.layoutGrow=1; br.appendChild(ct);
      modal.appendChild(br); return {overlay,modal,titlebar:tb,sidebar:sb,content:ct};
    } else {
      const ct=figma.createFrame(); ct.name='content'; ct.resize(width,height-44-1-52); ct.fills=[];
      applyAutoLayout(ct,'VERTICAL',16,24,20); ct.primaryAxisSizingMode='FIXED'; ct.counterAxisSizingMode='FIXED'; modal.appendChild(ct);
      return {overlay,modal,titlebar:tb,content:ct};
    }
  }
  async function makeModalFooter(width, confirmLabel, confirmDanger) {
    await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const f=figma.createFrame(); f.name='footer'; f.resize(width,52); f.fills=solidPaint('#14141C');
    applyAutoLayout(f,'HORIZONTAL',8,16,0); f.primaryAxisSizingMode='FIXED'; f.counterAxisSizingMode='FIXED';
    f.counterAxisAlignItems='CENTER'; f.primaryAxisAlignItems='MAX';
    const cn=figma.createFrame(); cn.name='btn-cancel'; cn.resize(90,32); cn.cornerRadius=6;
    cn.fills=solidPaint('#1C1C27'); cn.strokes=solidPaint('#2A2A3A'); cn.strokeWeight=1; cn.strokeAlign='INSIDE';
    applyAutoLayout(cn,'HORIZONTAL',0,0,0); cn.primaryAxisAlignItems='CENTER'; cn.counterAxisAlignItems='CENTER';
    cn.primaryAxisSizingMode='FIXED'; cn.counterAxisSizingMode='FIXED';
    const ct=figma.createText(); ct.fontName={family:'Inter',style:'Medium'}; ct.fontSize=13;
    ct.characters='Cancel'; ct.fills=solidPaint('#B9B9C9'); cn.appendChild(ct); f.appendChild(cn);
    const cf=figma.createFrame(); cf.name='btn-confirm'; cf.resize(90,32); cf.cornerRadius=6;
    cf.fills=confirmDanger?solidPaint('#FF5470'):accentGradientPaint();
    applyAutoLayout(cf,'HORIZONTAL',0,0,0); cf.primaryAxisAlignItems='CENTER'; cf.counterAxisAlignItems='CENTER';
    cf.primaryAxisSizingMode='FIXED'; cf.counterAxisSizingMode='FIXED';
    const cft=figma.createText(); cft.fontName={family:'Inter',style:'Medium'}; cft.fontSize=13;
    cft.characters=confirmLabel||'OK'; cft.fills=solidPaint('#FFFFFF'); cf.appendChild(cft); f.appendChild(cf);
    return f;
  }
  async function makeSidebarItem(label, isActive) {
    const item=figma.createFrame(); item.name=label; item.resize(180,34);
    item.fills=isActive?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.15}]:[];
    item.cornerRadius=6; applyAutoLayout(item,'HORIZONTAL',8,12,0);
    item.primaryAxisSizingMode='FIXED'; item.counterAxisSizingMode='FIXED'; item.counterAxisAlignItems='CENTER';
    if (isActive){const b=figma.createRectangle();b.resize(3,20);b.cornerRadius=999;b.fills=accentGradientPaint();item.appendChild(b);}
    const ic=figma.createRectangle(); ic.resize(14,14); ic.cornerRadius=3; ic.fills=solidPaint(isActive?'#8A5CFF':'#6C6C80'); item.appendChild(ic);
    await figma.loadFontAsync({family:'Inter',style:isActive?'Medium':'Regular'});
    const t=figma.createText(); t.fontName={family:'Inter',style:isActive?'Medium':'Regular'}; t.fontSize=13;
    t.characters=label; t.fills=solidPaint(isActive?'#FFFFFF':'#B9B9C9'); item.appendChild(t); return item;
  }
  async function makeFormRow(label, type) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'});
    const row=figma.createFrame(); row.name='row-'+label; row.fills=[];
    applyAutoLayout(row,'HORIZONTAL',12,0,0); row.primaryAxisSizingMode='AUTO'; row.counterAxisSizingMode='AUTO'; row.counterAxisAlignItems='CENTER';
    const lb=figma.createText(); lb.fontName={family:'Inter',style:'Regular'}; lb.fontSize=13;
    lb.characters=label; lb.fills=solidPaint('#B9B9C9'); lb.resize(180,lb.height); row.appendChild(lb);
    if (type==='input'||type==='dropdown') {
      const fd=figma.createFrame(); fd.resize(220,30); fd.cornerRadius=8; fd.fills=solidPaint('#14141C');
      fd.strokes=solidPaint('#2A2A3A'); fd.strokeWeight=1; fd.strokeAlign='INSIDE';
      applyAutoLayout(fd,'HORIZONTAL',0,12,0); fd.primaryAxisSizingMode='FIXED'; fd.counterAxisSizingMode='FIXED';
      fd.counterAxisAlignItems='CENTER'; if (type==='dropdown') fd.primaryAxisAlignItems='SPACE_BETWEEN';
      const vt=figma.createText(); vt.fontName={family:'Inter',style:'Regular'}; vt.fontSize=13;
      vt.characters=type==='dropdown'?'Option':'Value'; vt.fills=solidPaint('#FFFFFF'); fd.appendChild(vt);
      if (type==='dropdown'){const cv=figma.createRectangle();cv.resize(10,6);cv.cornerRadius=1;cv.fills=solidPaint('#6C6C80');fd.appendChild(cv);}
      row.appendChild(fd);
    } else if (type==='toggle') {
      const tr=figma.createRectangle(); tr.resize(36,20); tr.cornerRadius=999; tr.fills=solidPaint('#2A2A3A'); row.appendChild(tr);
    }
    return row;
  }
  async function buildModalSettings(pg) {
    const {overlay,modal,sidebar,content}=await makeModalFrame('Settings',760,560,true);
    const cats=['General','Stream','Output','Audio','Video','Hotkeys','Accessibility','Advanced'];
    for (let i=0;i<cats.length;i++) sidebar.appendChild(await makeSidebarItem(cats[i],i===0));
    content.appendChild(await mt('Video Settings',15,'Medium','#FFFFFF'));
    const frows=[{label:'Base (Canvas) Resolution',type:'dropdown'},{label:'Output (Scaled) Resolution',type:'dropdown'},
      {label:'Downscale Filter',type:'dropdown'},{label:'Common FPS Values',type:'dropdown'},{label:'Integer FPS Value',type:'input'}];
    for (const fr of frows) content.appendChild(await makeFormRow(fr.label,fr.type));
    modal.appendChild(await makeModalFooter(760,'Apply')); overlay.appendChild(modal); pg.appendChild(overlay); return overlay;
  }
  async function buildModalFilters(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const {overlay,modal}=await makeModalFrame('Filters — Display Capture',700,500);
    const ec=modal.findChild(n=>n.name==='content'); if(ec)ec.remove();
    const body=figma.createFrame(); body.name='filters-body'; body.fills=[];
    applyAutoLayout(body,'HORIZONTAL',0,0,0); body.resize(700,403);
    body.primaryAxisSizingMode='FIXED'; body.counterAxisSizingMode='FIXED';
    const fl=figma.createFrame(); fl.name='filter-list'; fl.resize(220,403); fl.fills=solidPaint('#14141C');
    applyAutoLayout(fl,'VERTICAL',2,0,8); fl.primaryAxisSizingMode='FIXED'; fl.counterAxisSizingMode='FIXED';
    const ltb=figma.createFrame(); ltb.name='list-toolbar'; ltb.fills=solidPaint('#0B0B0F');
    applyAutoLayout(ltb,'HORIZONTAL',4,8,4); ltb.primaryAxisSizingMode='AUTO'; ltb.counterAxisSizingMode='AUTO';
    for (const ico of ['+','−','↑','↓']){const b=figma.createFrame();b.resize(24,24);b.cornerRadius=4;b.fills=solidPaint('#1C1C27');
      applyAutoLayout(b,'HORIZONTAL',0,0,0);b.primaryAxisAlignItems='CENTER';b.counterAxisAlignItems='CENTER';
      b.primaryAxisSizingMode='FIXED';b.counterAxisSizingMode='FIXED';
      const ir=figma.createRectangle();ir.resize(10,10);ir.cornerRadius=2;ir.fills=solidPaint('#6C6C80');b.appendChild(ir);ltb.appendChild(b);}
    fl.appendChild(ltb);
    const filters=['Color Correction','Crop/Pad','Sharpness','LUT Filter','Scroll'];
    for (let i=0;i<filters.length;i++){
      const it=figma.createFrame(); it.name=filters[i]; it.resize(220,30);
      it.fills=i===0?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.15}]:[]; it.cornerRadius=4;
      applyAutoLayout(it,'HORIZONTAL',8,10,0); it.primaryAxisSizingMode='FIXED'; it.counterAxisSizingMode='FIXED'; it.counterAxisAlignItems='CENTER';
      const ir=figma.createRectangle(); ir.resize(12,12); ir.cornerRadius=3; ir.fills=solidPaint(i===0?'#8A5CFF':'#2A2A3A'); it.appendChild(ir);
      const lt=figma.createText(); lt.fontName={family:'Inter',style:'Regular'}; lt.fontSize=12;
      lt.characters=filters[i]; lt.fills=solidPaint(i===0?'#FFFFFF':'#B9B9C9'); it.appendChild(lt); fl.appendChild(it);}
    body.appendChild(fl);
    const vd=figma.createRectangle(); vd.resize(1,403); vd.fills=solidPaint('#2A2A3A'); body.appendChild(vd);
    const pp=figma.createFrame(); pp.name='filter-properties'; pp.resize(479,403); pp.fills=[];
    applyAutoLayout(pp,'VERTICAL',14,20,16); pp.primaryAxisSizingMode='FIXED'; pp.counterAxisSizingMode='FIXED';
    pp.appendChild(await mt('Color Correction',14,'Medium','#FFFFFF'));
    for (const pr of ['Gamma','Contrast','Brightness','Saturation','Hue Shift','Opacity']) pp.appendChild(await makeFormRow(pr,'input'));
    body.appendChild(pp); modal.appendChild(body); modal.appendChild(await makeModalFooter(700,'Close'));
    overlay.appendChild(modal); pg.appendChild(overlay); return overlay;
  }
  async function buildModalProperties(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const {overlay,modal,content}=await makeModalFrame('Transform — Display Capture',520,540);
    const secs=[{label:'Position & Size',rows:[['Position X','input'],['Position Y','input'],['Width','input'],['Height','input']]},
      {label:'Rotation',rows:[['Rotation','input']]},{label:'Crop',rows:[['Left','input'],['Right','input'],['Top','input'],['Bottom','input']]},
      {label:'Blend Mode',rows:[['Mode','dropdown']]}];
    for (const sec of secs) {
      content.appendChild(await mt(sec.label,13,'Medium','#B9B9C9'));
      for (const [l,t] of sec.rows) content.appendChild(await makeFormRow(l,t));
      const dv=figma.createRectangle(); dv.resize(472,1); dv.fills=solidPaint('#2A2A3A'); content.appendChild(dv);
    }
    modal.appendChild(await makeModalFooter(520,'Reset')); overlay.appendChild(modal); pg.appendChild(overlay); return overlay;
  }
  async function buildModalConfirm(pg, isDanger) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const {overlay,modal,content}=await makeModalFrame(isDanger?'Delete Scene':'Confirm Action',400,220);
    const ib=figma.createRectangle(); ib.resize(40,40); ib.cornerRadius=20;
    ib.fills=solidPaint(isDanger?'#FF5470':'#8A5CFF'); content.appendChild(ib);
    content.appendChild(await mt(isDanger?'Delete "Main Scene"?':'Confirm Action',15,'Medium','#FFFFFF'));
    content.appendChild(await mt(isDanger?'This action cannot be undone. The scene and all its sources will be permanently removed.':'Are you sure you want to proceed?',13,'Regular','#B9B9C9'));
    modal.appendChild(await makeModalFooter(400,isDanger?'Delete':'Confirm',isDanger)); overlay.appendChild(modal); pg.appendChild(overlay); return overlay;
  }
  async function buildModalInput(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'});
    const {overlay,modal,content}=await makeModalFrame('Rename Scene',400,180);
    content.appendChild(await mt('Scene name',13,'Regular','#B9B9C9'));
    const fd=figma.createFrame(); fd.name='rename-input'; fd.resize(352,32); fd.cornerRadius=8;
    fd.fills=solidPaint('#14141C'); fd.strokes=solidPaint('#8A5CFF'); fd.strokeWeight=1.5; fd.strokeAlign='INSIDE';
    fd.effects=[{type:'DROP_SHADOW',offset:{x:0,y:0},radius:18,spread:0,color:Object.assign({a:0.35},hexToRgb('#8A5CFF')),blendMode:'NORMAL',visible:true}];
    applyAutoLayout(fd,'HORIZONTAL',0,12,0); fd.primaryAxisSizingMode='FIXED'; fd.counterAxisSizingMode='FIXED'; fd.counterAxisAlignItems='CENTER';
    const ft=figma.createText(); ft.fontName={family:'Inter',style:'Regular'}; ft.fontSize=13;
    ft.characters='Main Scene'; ft.fills=solidPaint('#FFFFFF'); fd.appendChild(ft); content.appendChild(fd);
    modal.appendChild(await makeModalFooter(400,'Rename')); overlay.appendChild(modal); pg.appendChild(overlay); return overlay;
  }
  async function buildModalSceneCollection(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const {overlay,modal,content}=await makeModalFrame('Scene Collection Manager',500,420);
    const tb=figma.createFrame(); tb.name='collection-toolbar'; tb.fills=[];
    applyAutoLayout(tb,'HORIZONTAL',8,0,0); tb.primaryAxisSizingMode='AUTO'; tb.counterAxisSizingMode='AUTO';
    for (const lbl of ['New','Rename','Duplicate','Delete','Import','Export']){
      const b=figma.createFrame(); b.name='btn-'+lbl; b.resize(70,28); b.cornerRadius=6;
      b.fills=lbl==='Delete'?solidPaint('#FF5470'):solidPaint('#1C1C27');
      if(lbl!=='Delete'){b.strokes=solidPaint('#2A2A3A');b.strokeWeight=1;b.strokeAlign='INSIDE';}
      applyAutoLayout(b,'HORIZONTAL',0,0,0); b.primaryAxisAlignItems='CENTER'; b.counterAxisAlignItems='CENTER';
      b.primaryAxisSizingMode='FIXED'; b.counterAxisSizingMode='FIXED';
      const bt=figma.createText(); bt.fontName={family:'Inter',style:'Regular'}; bt.fontSize=11;
      bt.characters=lbl; bt.fills=solidPaint('#FFFFFF'); b.appendChild(bt); tb.appendChild(b);}
    content.appendChild(tb);
    const cols=['Default','Streaming Setup','Recording Setup','Podcast Mode'];
    for (let i=0;i<cols.length;i++){
      const it=figma.createFrame(); it.name=cols[i]; it.resize(452,36); it.cornerRadius=6;
      it.fills=i===0?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.15}]:[];
      applyAutoLayout(it,'HORIZONTAL',8,10,0); it.primaryAxisSizingMode='FIXED'; it.counterAxisSizingMode='FIXED'; it.counterAxisAlignItems='CENTER';
      const ir=figma.createRectangle(); ir.resize(14,14); ir.cornerRadius=3; ir.fills=solidPaint(i===0?'#8A5CFF':'#2A2A3A'); it.appendChild(ir);
      const lt=figma.createText(); lt.fontName={family:'Inter',style:i===0?'Medium':'Regular'}; lt.fontSize=13;
      lt.characters=cols[i]+(i===0?' (Active)':''); lt.fills=solidPaint(i===0?'#FFFFFF':'#B9B9C9'); it.appendChild(lt); content.appendChild(it);}
    modal.appendChild(await makeModalFooter(500,'Done')); overlay.appendChild(modal); pg.appendChild(overlay); return overlay;
  }
  async function buildModalAbout(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    await figma.loadFontAsync({family:'Inter',style:'Semi Bold'});
    const {overlay,modal,content}=await makeModalFrame('About OBS Studio',380,260);
    content.primaryAxisAlignItems='CENTER'; content.counterAxisAlignItems='CENTER';
    const logo=figma.createFrame(); logo.name='logo'; logo.resize(56,56); logo.cornerRadius=14; logo.fills=accentGradientPaint();
    applyAutoLayout(logo,'HORIZONTAL',0,0,0); logo.primaryAxisAlignItems='CENTER'; logo.counterAxisAlignItems='CENTER';
    logo.primaryAxisSizingMode='FIXED'; logo.counterAxisSizingMode='FIXED';
    const lt=figma.createText(); lt.fontName={family:'Inter',style:'Semi Bold'}; lt.fontSize=22;
    lt.characters='OBS'; lt.fills=solidPaint('#FFFFFF'); logo.appendChild(lt); content.appendChild(logo);
    content.appendChild(await mt('OBS Studio',18,'Semi Bold','#FFFFFF'));
    content.appendChild(await mt('Version 31.0.0',13,'Regular','#B9B9C9'));
    content.appendChild(await mt('Free and open source software\nfor video recording and live streaming',12,'Regular','#6C6C80'));
    modal.appendChild(await makeModalFooter(380,'Close')); overlay.appendChild(modal); pg.appendChild(overlay); return overlay;
  }

  await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
  await figma.loadFontAsync({family:'Inter',style:'Semi Bold'});
  const settings=await buildModalSettings(page); const filters=await buildModalFilters(page);
  const properties=await buildModalProperties(page); const confirmDanger=await buildModalConfirm(page,true);
  const confirmNeutral=await buildModalConfirm(page,false); const inputModal=await buildModalInput(page);
  const sceneCollection=await buildModalSceneCollection(page); const about=await buildModalAbout(page);
  const modals=[settings,filters,properties,confirmDanger,confirmNeutral,inputModal,sceneCollection,about];
  let mx=0;
  for (const m of modals) { m.x=mx; m.y=0; mx+=1440+40; }
  return {settings,filters,properties,confirmDanger,confirmNeutral,inputModal,sceneCollection,about};
}

// ─── buildMenus (inlined from src/components/menus.js) ───────────────────────
async function buildMenus(page) {
  async function mtx(str, size, weight, color) {
    await figma.loadFontAsync({family:'Inter',style:weight});
    const t=figma.createText(); t.fontName={family:'Inter',style:weight};
    t.fontSize=size; t.characters=str; t.fills=solidPaint(color); return t;
  }
  async function makeMenuBarItem(label, state) {
    state = state || 'Default';
    const item=figma.createFrame(); item.name='menu-item/'+label+'/'+state; item.resize(48,30); item.cornerRadius=4;
    item.fills=state==='Open'?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.15}]:state==='Hover'?[{type:'SOLID',color:{r:1,g:1,b:1},opacity:0.06}]:[];
    applyAutoLayout(item,'HORIZONTAL',0,10,0); item.primaryAxisSizingMode='FIXED'; item.counterAxisSizingMode='FIXED';
    item.primaryAxisAlignItems='CENTER'; item.counterAxisAlignItems='CENTER';
    if (state==='Disabled') item.opacity=0.4;
    item.appendChild(await mtx(label,13,'Regular',state==='Open'?'#FFFFFF':state==='Disabled'?'#6C6C80':'#B9B9C9'));
    return item;
  }
  async function makeMenuItem(label, shortcut, hasSubmenu, type, isActive) {
    type=type||'default';
    if (type==='separator'){
      const sep=figma.createFrame(); sep.name='menu/separator'; sep.resize(200,9); sep.fills=[];
      applyAutoLayout(sep,'HORIZONTAL',0,8,0); sep.primaryAxisSizingMode='FIXED'; sep.counterAxisSizingMode='FIXED'; sep.counterAxisAlignItems='CENTER';
      const ln=figma.createRectangle(); ln.resize(184,1); ln.fills=solidPaint('#2A2A3A'); sep.appendChild(ln); return sep;
    }
    const item=figma.createFrame(); item.name='menu/item/'+label; item.resize(200,30); item.cornerRadius=4;
    item.fills=isActive?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.15}]:[];
    applyAutoLayout(item,'HORIZONTAL',6,10,0); item.primaryAxisSizingMode='FIXED'; item.counterAxisSizingMode='FIXED';
    item.counterAxisAlignItems='CENTER'; item.primaryAxisAlignItems='SPACE_BETWEEN';
    if (type==='checkbox'){const ck=figma.createRectangle();ck.resize(12,12);ck.cornerRadius=3;ck.fills=isActive?accentGradientPaint():solidPaint('#2A2A3A');item.appendChild(ck);}
    else if (type==='radio'){const rd=figma.createEllipse();rd.resize(12,12);rd.fills=isActive?accentGradientPaint():[];rd.strokes=solidPaint('#2A2A3A');rd.strokeWeight=1.5;item.appendChild(rd);}
    else{const ic=figma.createRectangle();ic.resize(14,14);ic.cornerRadius=3;ic.fills=solidPaint('#2A2A3A');item.appendChild(ic);}
    const t=await mtx(label,13,'Regular',isActive?'#FFFFFF':'#B9B9C9'); t.layoutGrow=1; item.appendChild(t);
    if (shortcut){item.appendChild(await mtx(shortcut,11,'Regular','#6C6C80'));}
    if (hasSubmenu){const ar=figma.createRectangle();ar.resize(6,10);ar.cornerRadius=1;ar.fills=solidPaint('#6C6C80');item.appendChild(ar);}
    return item;
  }
  async function buildDropdown(items, name) {
    const menu=figma.createFrame(); menu.name='menu/dropdown/'+name; menu.fills=solidPaint('#1C1C27');
    menu.cornerRadius=8; menu.strokes=solidPaint('#2A2A3A'); menu.strokeWeight=1; menu.strokeAlign='OUTSIDE';
    menu.effects=[{type:'DROP_SHADOW',offset:{x:0,y:8},radius:24,spread:0,color:{r:0,g:0,b:0,a:0.5},blendMode:'NORMAL',visible:true}];
    applyAutoLayout(menu,'VERTICAL',2,4,4); menu.primaryAxisSizingMode='AUTO'; menu.counterAxisSizingMode='AUTO';
    for (const i of items) menu.appendChild(i); return menu;
  }
  async function buildMenuBar_m(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const bar=figma.createFrame(); bar.name='menu/bar'; bar.resize(1440,30); bar.fills=solidPaint('#14141C');
    bar.strokes=solidPaint('#2A2A3A'); bar.strokeWeight=1; bar.strokeAlign='OUTSIDE';
    applyAutoLayout(bar,'HORIZONTAL',0,8,0); bar.primaryAxisSizingMode='FIXED'; bar.counterAxisSizingMode='FIXED'; bar.counterAxisAlignItems='CENTER';
    const ai=figma.createRectangle(); ai.name='app-icon'; ai.resize(20,20); ai.cornerRadius=4; ai.fills=accentGradientPaint(); bar.appendChild(ai);
    for (const m of ['File','Edit','View','Profile','Scene Collection','Tools','Help']) bar.appendChild(await makeMenuBarItem(m));
    const sp=figma.createRectangle(); sp.fills=[]; sp.resize(400,1); sp.layoutGrow=1; bar.appendChild(sp);
    pg.appendChild(bar); return bar;
  }
  async function buildToolbar_m(pg) {
    const tb=figma.createFrame(); tb.name='toolbar/main'; tb.resize(1440,40); tb.fills=solidPaint('#14141C');
    tb.strokes=solidPaint('#2A2A3A'); tb.strokeWeight=1; tb.strokeAlign='OUTSIDE';
    applyAutoLayout(tb,'HORIZONTAL',4,8,0); tb.primaryAxisSizingMode='FIXED'; tb.counterAxisSizingMode='FIXED'; tb.counterAxisAlignItems='CENTER';
    const tools=[{name:'studio-mode',active:false},{name:'fullscreen-preview',active:false},{name:'screenshot',active:false},
      {name:'stats',active:true},{name:'multiview',active:false},{name:'recording-folder',active:false},{name:'settings',active:false}];
    for (const tool of tools){
      const btn=figma.createFrame(); btn.name='toolbar-btn/'+tool.name; btn.resize(32,32); btn.cornerRadius=6;
      btn.fills=tool.active?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.18}]:solidPaint('#1C1C27');
      btn.strokes=solidPaint(tool.active?'#8A5CFF':'#2A2A3A'); btn.strokeWeight=1; btn.strokeAlign='INSIDE';
      if (tool.active) btn.effects=[accentGlow()];
      applyAutoLayout(btn,'HORIZONTAL',0,0,0); btn.primaryAxisAlignItems='CENTER'; btn.counterAxisAlignItems='CENTER';
      btn.primaryAxisSizingMode='FIXED'; btn.counterAxisSizingMode='FIXED';
      const ic=figma.createRectangle(); ic.resize(16,16); ic.cornerRadius=3; ic.fills=solidPaint(tool.active?'#8A5CFF':'#6C6C80'); btn.appendChild(ic); tb.appendChild(btn);}
    pg.appendChild(tb); return tb;
  }
  async function buildStatusBar_m(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'});
    const bar=figma.createFrame(); bar.name='statusbar'; bar.resize(1440,24); bar.fills=solidPaint('#0B0B0F');
    bar.strokes=solidPaint('#2A2A3A'); bar.strokeWeight=1; bar.strokeAlign='OUTSIDE';
    applyAutoLayout(bar,'HORIZONTAL',12,12,0); bar.primaryAxisSizingMode='FIXED'; bar.counterAxisSizingMode='FIXED'; bar.counterAxisAlignItems='CENTER';
    const metrics=[{label:'CPU: 12.4%',color:'#B9B9C9'},{label:'60.0 FPS',color:'#3DDC97'},
      {label:'Dropped: 0 (0%)',color:'#B9B9C9'},{label:'● REC 00:12:34',color:'#FF5470'},{label:'● LIVE 01:05:22',color:'#FF5470'}];
    for (let i=0;i<metrics.length;i++){
      if (i>0){const sp=figma.createRectangle();sp.resize(1,12);sp.fills=solidPaint('#2A2A3A');bar.appendChild(sp);}
      const t=figma.createText(); t.fontName={family:'Inter',style:'Regular'}; t.fontSize=11;
      t.characters=metrics[i].label; t.fills=solidPaint(metrics[i].color); bar.appendChild(t);}
    pg.appendChild(bar); return bar;
  }
  async function buildListItems(pg) {
    await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
    const STATES=['Default','Hover','Selected','Active','Dragging','Disabled','Locked'];
    const components=[];
    for (const state of STATES){
      const c=figma.createComponent(); c.name='list/item, state='+state; c.resize(260,30); c.cornerRadius=6;
      c.fills=state==='Selected'||state==='Active'?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.18}]:
        state==='Hover'?[{type:'SOLID',color:{r:1,g:1,b:1},opacity:0.06}]:state==='Dragging'?solidPaint('#1C1C27'):[];
      if(state==='Dragging'){c.strokes=solidPaint('#8A5CFF');c.strokeWeight=1.5;c.strokeAlign='INSIDE';c.effects=[accentGlow()];}
      if(state==='Disabled')c.opacity=0.4;
      applyAutoLayout(c,'HORIZONTAL',6,8,0); c.primaryAxisSizingMode='FIXED'; c.counterAxisSizingMode='FIXED'; c.counterAxisAlignItems='CENTER';
      if(state==='Active'){const b=figma.createRectangle();b.resize(3,18);b.cornerRadius=999;b.fills=accentGradientPaint();c.appendChild(b);}
      const dh=figma.createFrame(); dh.name='drag-handle'; dh.resize(8,14); dh.fills=[];
      applyAutoLayout(dh,'VERTICAL',3,0,0); dh.primaryAxisAlignItems='CENTER'; dh.counterAxisAlignItems='CENTER';
      dh.primaryAxisSizingMode='FIXED'; dh.counterAxisSizingMode='FIXED';
      for(let i=0;i<3;i++){const rw=figma.createFrame();rw.fills=[];applyAutoLayout(rw,'HORIZONTAL',2,0,0);
        rw.primaryAxisSizingMode='AUTO';rw.counterAxisSizingMode='AUTO';
        for(let j=0;j<2;j++){const d=figma.createEllipse();d.resize(2,2);d.fills=solidPaint(state==='Dragging'?'#8A5CFF':'#2A2A3A');rw.appendChild(d);}
        dh.appendChild(rw);}
      c.appendChild(dh);
      const ic=figma.createRectangle(); ic.resize(14,14); ic.cornerRadius=3;
      ic.fills=solidPaint(state==='Locked'?'#2A2A3A':state==='Active'?'#8A5CFF':state==='Disabled'?'#2A2A3A':'#6C6C80'); c.appendChild(ic);
      const lb=figma.createText(); lb.fontName={family:'Inter',style:state==='Active'?'Medium':'Regular'}; lb.fontSize=12;
      lb.characters='List item label'; lb.fills=solidPaint(state==='Disabled'?'#6C6C80':state==='Active'?'#FFFFFF':'#B9B9C9'); lb.layoutGrow=1; c.appendChild(lb);
      if(state!=='Locked'){const ey=figma.createEllipse();ey.resize(12,12);ey.fills=solidPaint('#6C6C80');c.appendChild(ey);}
      else{const lk=figma.createRectangle();lk.resize(10,12);lk.cornerRadius=2;lk.fills=solidPaint('#FFC857');c.appendChild(lk);}
      components.push(c);}
    const set=figma.combineAsVariants(components,pg); set.name='list/item';
    set.fills=[{type:'SOLID',color:{r:0.07,g:0.07,b:0.12},opacity:0.5}]; applyAutoLayout(set,'VERTICAL',4,16,16);
    return set;
  }

  await figma.loadFontAsync({family:'Inter',style:'Regular'}); await figma.loadFontAsync({family:'Inter',style:'Medium'});
  const menuBar=await buildMenuBar_m(page);
  const toolbar=await buildToolbar_m(page);
  const statusBar=await buildStatusBar_m(page);
  const ctxScene=await (async()=>{
    const items=[await makeMenuItem('Add Scene'),await makeMenuItem('Remove Scene'),await makeMenuItem('Rename','F2'),
      await makeMenuItem('Duplicate'),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Lock/Unlock','',false,'checkbox',true),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Scene Filters…'),await makeMenuItem('Scene Transitions…'),await makeMenuItem('Copy Filters'),await makeMenuItem('Paste Filters')];
    const m=await buildDropdown(items,'scene'); m.name='menu/context/scene'; page.appendChild(m); return m;
  })();
  const ctxSource=await (async()=>{
    const items=[await makeMenuItem('Rename','F2'),await makeMenuItem('Remove Source','Del'),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Order','',true),await makeMenuItem('Transform','',true),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Filters…'),await makeMenuItem('Properties…'),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Copy Source'),await makeMenuItem('Paste (Reference)'),await makeMenuItem('Duplicate')];
    const m=await buildDropdown(items,'source'); m.name='menu/context/source'; page.appendChild(m); return m;
  })();
  const ctxMixer=await (async()=>{
    const items=[await makeMenuItem('Mute','',false,'checkbox'),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Audio Monitoring','',false,'checkbox',true),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Filters…'),await makeMenuItem('Properties…'),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Mixer Layout','',true)];
    const m=await buildDropdown(items,'mixer'); m.name='menu/context/mixer'; page.appendChild(m); return m;
  })();
  const ctxDock=await (async()=>{
    const items=[await makeMenuItem('Scenes','',false,'checkbox',true),await makeMenuItem('Sources','',false,'checkbox',true),
      await makeMenuItem('Audio Mixer','',false,'checkbox',true),await makeMenuItem('Scene Transitions','',false,'checkbox',true),
      await makeMenuItem('Controls','',false,'checkbox',true),await makeMenuItem('Stats','',false,'checkbox'),
      await makeMenuItem('Log Viewer','',false,'checkbox'),await makeMenuItem('separator','',false,'separator'),
      await makeMenuItem('Lock Docks','',false,'checkbox'),await makeMenuItem('Reset UI')];
    const m=await buildDropdown(items,'dock'); m.name='menu/context/dock'; page.appendChild(m); return m;
  })();
  const listItemSet=await buildListItems(page);
  menuBar.x=0;    menuBar.y=0;
  toolbar.x=0;    toolbar.y=50;
  statusBar.x=0;  statusBar.y=110;
  ctxScene.x=0;   ctxScene.y=160;
  ctxSource.x=220; ctxSource.y=160;
  ctxMixer.x=440;  ctxMixer.y=160;
  ctxDock.x=660;   ctxDock.y=160;
  listItemSet.x=0; listItemSet.y=480;
  return {menuBar,toolbar,statusBar,ctxScene,ctxSource,ctxMixer,ctxDock,listItemSet};
}

// ─── buildAppFrames (inlined from src/components/appFrames.js) ────────────────
async function buildAppFrames(page) {
  await figma.loadFontAsync({family:'Inter',style:'Regular'});
  await figma.loadFontAsync({family:'Inter',style:'Medium'});
  await figma.loadFontAsync({family:'Inter',style:'Semi Bold'});

  async function aftx(str, size, weight, color) {
    await figma.loadFontAsync({family:'Inter',style:weight});
    const t=figma.createText(); t.fontName={family:'Inter',style:weight};
    t.fontSize=size; t.characters=str; t.fills=solidPaint(color); return t;
  }
  function afMenuBar() {
    const bar=figma.createFrame(); bar.name='menubar'; bar.resize(1440,30); bar.fills=solidPaint('#14141C');
    bar.strokes=solidPaint('#2A2A3A'); bar.strokeWeight=1; bar.strokeAlign='OUTSIDE';
    applyAutoLayout(bar,'HORIZONTAL',0,8,0); bar.primaryAxisSizingMode='FIXED'; bar.counterAxisSizingMode='FIXED'; bar.counterAxisAlignItems='CENTER';
    const ic=figma.createRectangle(); ic.name='app-icon'; ic.resize(18,18); ic.cornerRadius=4; ic.fills=accentGradientPaint(); bar.appendChild(ic);
    return bar;
  }
  function afToolbar() {
    const bar=figma.createFrame(); bar.name='toolbar'; bar.resize(1440,40); bar.fills=solidPaint('#14141C');
    bar.strokes=solidPaint('#2A2A3A'); bar.strokeWeight=1; bar.strokeAlign='OUTSIDE';
    applyAutoLayout(bar,'HORIZONTAL',4,8,0); bar.primaryAxisSizingMode='FIXED'; bar.counterAxisSizingMode='FIXED'; bar.counterAxisAlignItems='CENTER';
    for (let i=0;i<7;i++){
      const btn=figma.createFrame(); btn.name='tool-btn-'+i; btn.resize(32,32); btn.cornerRadius=6;
      btn.fills=i===3?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.18}]:solidPaint('#1C1C27');
      btn.strokes=solidPaint(i===3?'#8A5CFF':'#2A2A3A'); btn.strokeWeight=1; btn.strokeAlign='INSIDE';
      if(i===3)btn.effects=[accentGlow()];
      applyAutoLayout(btn,'HORIZONTAL',0,0,0); btn.primaryAxisAlignItems='CENTER'; btn.counterAxisAlignItems='CENTER';
      btn.primaryAxisSizingMode='FIXED'; btn.counterAxisSizingMode='FIXED';
      const ic=figma.createRectangle(); ic.resize(14,14); ic.cornerRadius=3; ic.fills=solidPaint(i===3?'#8A5CFF':'#6C6C80'); btn.appendChild(ic); bar.appendChild(btn);}
    return bar;
  }
  function afStatusBar() {
    const bar=figma.createFrame(); bar.name='statusbar'; bar.resize(1440,24); bar.fills=solidPaint('#0B0B0F');
    bar.strokes=solidPaint('#2A2A3A'); bar.strokeWeight=1; bar.strokeAlign='OUTSIDE';
    applyAutoLayout(bar,'HORIZONTAL',12,12,0); bar.primaryAxisSizingMode='FIXED'; bar.counterAxisSizingMode='FIXED'; bar.counterAxisAlignItems='CENTER';
    return bar;
  }
  async function afPanelHeader(title, w) {
    const h=figma.createFrame(); h.name='panel-header'; h.resize(w,34); h.fills=solidPaint('#14141C');
    applyAutoLayout(h,'HORIZONTAL',6,10,0); h.primaryAxisSizingMode='FIXED'; h.counterAxisSizingMode='FIXED';
    h.counterAxisAlignItems='CENTER'; h.primaryAxisAlignItems='SPACE_BETWEEN';
    const dg=figma.createRectangle(); dg.resize(5,14); dg.cornerRadius=3; dg.fills=solidPaint('#2A2A3A'); h.appendChild(dg);
    const t=await aftx(title,12,'Medium','#FFFFFF'); t.layoutGrow=1; h.appendChild(t);
    const cl=figma.createRectangle(); cl.resize(10,10); cl.cornerRadius=5; cl.fills=solidPaint('#FF5470'); h.appendChild(cl);
    return h;
  }
  async function afScenesPanel(w, h) {
    const p=figma.createFrame(); p.name='scenes-panel'; p.resize(w,h); p.fills=solidPaint('#1C1C27'); p.cornerRadius=8;
    applyAutoLayout(p,'VERTICAL',0,0,0); p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    p.appendChild(await afPanelHeader('Scenes',w));
    const dv=figma.createRectangle(); dv.resize(w,1); dv.fills=solidPaint('#2A2A3A'); p.appendChild(dv);
    const list=figma.createFrame(); list.name='scene-list'; list.fills=[];
    list.resize(w,h-35); applyAutoLayout(list,'VERTICAL',2,6,4); list.primaryAxisSizingMode='FIXED'; list.counterAxisSizingMode='FIXED';
    const scenes=['Main Scene','Webcam Only','Screen Share','Intermission'];
    for (let i=0;i<scenes.length;i++){
      const it=figma.createFrame(); it.name=scenes[i]; it.resize(w-12,28); it.cornerRadius=5;
      it.fills=i===0?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.18}]:[];
      applyAutoLayout(it,'HORIZONTAL',6,6,0); it.primaryAxisSizingMode='FIXED'; it.counterAxisSizingMode='FIXED'; it.counterAxisAlignItems='CENTER';
      if(i===0){const b=figma.createRectangle();b.resize(3,16);b.cornerRadius=999;b.fills=accentGradientPaint();it.appendChild(b);}
      const ic=figma.createRectangle(); ic.resize(12,12); ic.cornerRadius=2; ic.fills=solidPaint(i===0?'#8A5CFF':'#2A2A3A'); it.appendChild(ic);
      const t=figma.createText(); t.fontName={family:'Inter',style:i===0?'Medium':'Regular'}; t.fontSize=12;
      t.characters=scenes[i]; t.fills=solidPaint(i===0?'#FFFFFF':'#B9B9C9'); it.appendChild(t); list.appendChild(it);}
    p.appendChild(list); return p;
  }
  async function afSourcesPanel(w, h) {
    const p=figma.createFrame(); p.name='sources-panel'; p.resize(w,h); p.fills=solidPaint('#1C1C27'); p.cornerRadius=8;
    applyAutoLayout(p,'VERTICAL',0,0,0); p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    p.appendChild(await afPanelHeader('Sources',w));
    const dv=figma.createRectangle(); dv.resize(w,1); dv.fills=solidPaint('#2A2A3A'); p.appendChild(dv);
    const list=figma.createFrame(); list.name='source-list'; list.fills=[];
    list.resize(w,h-35); applyAutoLayout(list,'VERTICAL',2,6,4); list.primaryAxisSizingMode='FIXED'; list.counterAxisSizingMode='FIXED';
    const srcs=['Display Capture','Webcam','Mic/AUX','Browser Source','Image'];
    for (let i=0;i<srcs.length;i++){
      const it=figma.createFrame(); it.name=srcs[i]; it.resize(w-12,26); it.cornerRadius=4;
      it.fills=i===0?[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.12}]:[];
      applyAutoLayout(it,'HORIZONTAL',6,6,0); it.primaryAxisSizingMode='FIXED'; it.counterAxisSizingMode='FIXED';
      it.counterAxisAlignItems='CENTER'; it.primaryAxisAlignItems='SPACE_BETWEEN';
      const ic=figma.createRectangle(); ic.resize(12,12); ic.cornerRadius=2; ic.fills=solidPaint(i===0?'#8A5CFF':'#6C6C80'); it.appendChild(ic);
      const t=figma.createText(); t.fontName={family:'Inter',style:'Regular'}; t.fontSize=11;
      t.characters=srcs[i]; t.fills=solidPaint(i===0?'#FFFFFF':'#B9B9C9'); t.layoutGrow=1; it.appendChild(t);
      const ey=figma.createEllipse(); ey.resize(10,10); ey.fills=solidPaint('#6C6C80'); it.appendChild(ey); list.appendChild(it);}
    p.appendChild(list); return p;
  }
  async function afPreviewCanvas(w, h, label, isLive) {
    const p=figma.createFrame(); p.name=label.toLowerCase()+'-canvas'; p.resize(w,h); p.fills=solidPaint('#0B0B0F'); p.cornerRadius=8;
    p.strokes=solidPaint(isLive?'#FF5470':'#2A2A3A'); p.strokeWeight=isLive?2:1; p.strokeAlign='INSIDE';
    applyAutoLayout(p,'VERTICAL',0,0,0); p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    const hd=figma.createFrame(); hd.name='canvas-header'; hd.resize(w,28); hd.fills=solidPaint('#14141C');
    applyAutoLayout(hd,'HORIZONTAL',8,10,0); hd.primaryAxisSizingMode='FIXED'; hd.counterAxisSizingMode='FIXED';
    hd.counterAxisAlignItems='CENTER'; hd.primaryAxisAlignItems='SPACE_BETWEEN';
    if (isLive){
      const lp=figma.createFrame(); lp.name='live-pill'; lp.resize(36,16); lp.cornerRadius=999; lp.fills=solidPaint('#FF5470');
      applyAutoLayout(lp,'HORIZONTAL',0,6,0); lp.primaryAxisSizingMode='FIXED'; lp.counterAxisSizingMode='FIXED';
      lp.primaryAxisAlignItems='CENTER'; lp.counterAxisAlignItems='CENTER';
      const lt=figma.createText(); lt.fontName={family:'Inter',style:'Semi Bold'}; lt.fontSize=8;
      lt.characters='LIVE'; lt.fills=solidPaint('#FFFFFF'); lp.appendChild(lt); hd.appendChild(lp);}
    const ln=await aftx(label,11,'Medium',isLive?'#FFFFFF':'#B9B9C9'); ln.layoutGrow=1; hd.appendChild(ln);
    const bg=figma.createFrame(); bg.name='res-badge'; bg.resize(58,16); bg.cornerRadius=3; bg.fills=solidPaint('#1C1C27');
    applyAutoLayout(bg,'HORIZONTAL',0,4,0); bg.primaryAxisSizingMode='FIXED'; bg.counterAxisSizingMode='FIXED';
    bg.primaryAxisAlignItems='CENTER'; bg.counterAxisAlignItems='CENTER';
    const bt=await aftx('1920×1080',8,'Regular','#6C6C80'); bg.appendChild(bt); hd.appendChild(bg); p.appendChild(hd);
    const cv=figma.createFrame(); cv.name='canvas'; cv.resize(w,h-28); cv.fills=solidPaint('#000000');
    applyAutoLayout(cv,'HORIZONTAL',0,0,0); cv.primaryAxisSizingMode='FIXED'; cv.counterAxisSizingMode='FIXED';
    cv.primaryAxisAlignItems='CENTER'; cv.counterAxisAlignItems='CENTER'; cv.layoutGrow=1;
    const sa=figma.createRectangle(); sa.name='safe-area'; sa.resize(Math.round(w*0.9),Math.round((h-28)*0.9));
    sa.fills=[]; sa.strokes=solidPaint('#2A2A3A'); sa.strokeWeight=1; sa.dashPattern=[4,4]; cv.appendChild(sa);
    p.appendChild(cv); return p;
  }
  async function afMixerStrip(name, isMuted) {
    const s=figma.createFrame(); s.name='strip-'+name; s.resize(90,120); s.fills=solidPaint('#14141C'); s.cornerRadius=6;
    applyAutoLayout(s,'VERTICAL',4,6,6); s.primaryAxisSizingMode='FIXED'; s.counterAxisSizingMode='FIXED'; s.counterAxisAlignItems='CENTER';
    const lb=figma.createText(); lb.fontName={family:'Inter',style:'Regular'}; lb.fontSize=10;
    lb.characters=name; lb.fills=solidPaint('#B9B9C9'); lb.textAlignHorizontal='CENTER'; s.appendChild(lb);
    const mt=figma.createRectangle(); mt.resize(60,6); mt.cornerRadius=999; mt.fills=solidPaint(isMuted?'#2A2A3A':'#3DDC97'); s.appendChild(mt);
    const sl=figma.createRectangle(); sl.resize(4,40); sl.cornerRadius=999; sl.fills=solidPaint('#2A2A3A'); s.appendChild(sl);
    const mu=figma.createFrame(); mu.name='mute'; mu.resize(28,20); mu.cornerRadius=4; mu.fills=solidPaint(isMuted?'#FF5470':'#1C1C27');
    applyAutoLayout(mu,'HORIZONTAL',0,0,0); mu.primaryAxisAlignItems='CENTER'; mu.counterAxisAlignItems='CENTER';
    mu.primaryAxisSizingMode='FIXED'; mu.counterAxisSizingMode='FIXED';
    const mi=figma.createRectangle(); mi.resize(10,10); mi.cornerRadius=2; mi.fills=solidPaint('#FFFFFF'); mu.appendChild(mi); s.appendChild(mu);
    return s;
  }
  async function afControlsPanel(w) {
    const p=figma.createFrame(); p.name='controls-panel'; p.resize(w,240); p.fills=solidPaint('#1C1C27'); p.cornerRadius=8;
    applyAutoLayout(p,'VERTICAL',6,8,8); p.primaryAxisSizingMode='FIXED'; p.counterAxisSizingMode='FIXED';
    const btns=[{lbl:'Start Streaming',gradient:true},{lbl:'Start Recording',gradient:false},{lbl:'Virtual Camera',gradient:false},{lbl:'Studio Mode',gradient:false},{lbl:'Settings',gradient:false}];
    for (const b of btns){
      const btn=figma.createFrame(); btn.name=b.lbl; btn.resize(w-16,34); btn.cornerRadius=6;
      btn.fills=b.gradient?accentGradientPaint():solidPaint('#14141C');
      if(!b.gradient){btn.strokes=solidPaint('#2A2A3A');btn.strokeWeight=1;btn.strokeAlign='INSIDE';}
      applyAutoLayout(btn,'HORIZONTAL',0,0,0); btn.primaryAxisAlignItems='CENTER'; btn.counterAxisAlignItems='CENTER';
      btn.primaryAxisSizingMode='FIXED'; btn.counterAxisSizingMode='FIXED';
      const t=figma.createText(); t.fontName={family:'Inter',style:'Medium'}; t.fontSize=12;
      t.characters=b.lbl; t.fills=solidPaint('#FFFFFF'); btn.appendChild(t); p.appendChild(btn);}
    return p;
  }
  async function buildDefault(pg) {
    const frame=figma.createFrame(); frame.name='app/default'; frame.resize(1440,900); frame.fills=solidPaint('#0B0B0F');
    applyAutoLayout(frame,'VERTICAL',0,0,0); frame.primaryAxisSizingMode='FIXED'; frame.counterAxisSizingMode='FIXED';
    frame.appendChild(afMenuBar()); frame.appendChild(afToolbar());
    const d1=figma.createRectangle(); d1.resize(1440,1); d1.fills=solidPaint('#2A2A3A'); frame.appendChild(d1);
    const ws=figma.createFrame(); ws.name='workspace'; ws.fills=[]; ws.resize(1440,780);
    applyAutoLayout(ws,'HORIZONTAL',0,0,0); ws.primaryAxisSizingMode='FIXED'; ws.counterAxisSizingMode='FIXED'; ws.layoutGrow=1;
    const ld=figma.createFrame(); ld.name='left-dock'; ld.resize(220,780); ld.fills=solidPaint('#14141C');
    ld.strokes=solidPaint('#2A2A3A'); ld.strokeWeight=1; ld.strokeAlign='OUTSIDE';
    applyAutoLayout(ld,'VERTICAL',8,0,8); ld.primaryAxisSizingMode='FIXED'; ld.counterAxisSizingMode='FIXED';
    ld.appendChild(await afScenesPanel(220,340)); ld.appendChild(await afSourcesPanel(220,340)); ws.appendChild(ld);
    const vd=figma.createRectangle(); vd.resize(1,780); vd.fills=solidPaint('#2A2A3A'); ws.appendChild(vd);
    const ct=figma.createFrame(); ct.name='center'; ct.fills=[]; ct.resize(879,780);
    applyAutoLayout(ct,'VERTICAL',0,0,0); ct.primaryAxisSizingMode='FIXED'; ct.counterAxisSizingMode='FIXED'; ct.layoutGrow=1;
    ct.appendChild(await afPreviewCanvas(879,540,'Preview',false));
    const hd=figma.createRectangle(); hd.resize(879,1); hd.fills=solidPaint('#2A2A3A'); ct.appendChild(hd);
    const br=figma.createFrame(); br.name='bottom-row'; br.fills=solidPaint('#14141C'); br.resize(879,239);
    applyAutoLayout(br,'HORIZONTAL',0,0,0); br.primaryAxisSizingMode='FIXED'; br.counterAxisSizingMode='FIXED';
    const mx=figma.createFrame(); mx.name='mixer'; mx.fills=[]; mx.resize(879,239);
    applyAutoLayout(mx,'VERTICAL',0,0,0); mx.primaryAxisSizingMode='FIXED'; mx.counterAxisSizingMode='FIXED';
    const mxh=figma.createFrame(); mxh.name='mixer-header'; mxh.resize(879,32); mxh.fills=solidPaint('#0B0B0F');
    applyAutoLayout(mxh,'HORIZONTAL',0,10,0); mxh.primaryAxisSizingMode='FIXED'; mxh.counterAxisSizingMode='FIXED'; mxh.counterAxisAlignItems='CENTER';
    mxh.appendChild(await aftx('Audio Mixer',12,'Medium','#FFFFFF')); mx.appendChild(mxh);
    const st=figma.createFrame(); st.name='strips'; st.fills=[]; applyAutoLayout(st,'HORIZONTAL',6,10,8); st.primaryAxisSizingMode='AUTO'; st.counterAxisSizingMode='AUTO';
    for (let i=0;i<['Desktop','Mic/Aux','Browser','Music'].length;i++) st.appendChild(await afMixerStrip(['Desktop','Mic/Aux','Browser','Music'][i],i===1));
    mx.appendChild(st); br.appendChild(mx); ct.appendChild(br); ws.appendChild(ct);
    const vd2=figma.createRectangle(); vd2.resize(1,780); vd2.fills=solidPaint('#2A2A3A'); ws.appendChild(vd2);
    ws.appendChild(await afControlsPanel(220)); frame.appendChild(ws); frame.appendChild(afStatusBar());
    pg.appendChild(frame); return frame;
  }
  async function buildStudioMode(pg) {
    const frame=figma.createFrame(); frame.name='app/studio-mode'; frame.resize(1440,900); frame.fills=solidPaint('#0B0B0F');
    applyAutoLayout(frame,'VERTICAL',0,0,0); frame.primaryAxisSizingMode='FIXED'; frame.counterAxisSizingMode='FIXED';
    frame.appendChild(afMenuBar()); frame.appendChild(afToolbar());
    const dv=figma.createRectangle(); dv.resize(1440,1); dv.fills=solidPaint('#2A2A3A'); frame.appendChild(dv);
    const ws=figma.createFrame(); ws.name='workspace'; ws.fills=[]; ws.resize(1440,779);
    applyAutoLayout(ws,'HORIZONTAL',0,0,0); ws.primaryAxisSizingMode='FIXED'; ws.counterAxisSizingMode='FIXED'; ws.layoutGrow=1;
    const ld=figma.createFrame(); ld.name='left-dock'; ld.resize(180,779); ld.fills=solidPaint('#14141C');
    applyAutoLayout(ld,'VERTICAL',8,0,8); ld.primaryAxisSizingMode='FIXED'; ld.counterAxisSizingMode='FIXED';
    ld.appendChild(await afScenesPanel(180,360)); ld.appendChild(await afSourcesPanel(180,340)); ws.appendChild(ld);
    const ct=figma.createFrame(); ct.name='center'; ct.fills=[]; ct.resize(900,779);
    applyAutoLayout(ct,'VERTICAL',0,0,0); ct.primaryAxisSizingMode='FIXED'; ct.counterAxisSizingMode='FIXED'; ct.layoutGrow=1;
    const sl=figma.createFrame(); sl.name='studio-mode-label'; sl.resize(900,28);
    sl.fills=[{type:'SOLID',color:hexToRgb('#8A5CFF'),opacity:0.12}];
    applyAutoLayout(sl,'HORIZONTAL',0,0,0); sl.primaryAxisSizingMode='FIXED'; sl.counterAxisSizingMode='FIXED';
    sl.primaryAxisAlignItems='CENTER'; sl.counterAxisAlignItems='CENTER';
    sl.appendChild(await aftx('STUDIO MODE',10,'Medium','#8A5CFF')); ct.appendChild(sl);
    const cr=figma.createFrame(); cr.name='canvas-row'; cr.fills=[]; cr.resize(900,460);
    applyAutoLayout(cr,'HORIZONTAL',8,8,8); cr.primaryAxisSizingMode='FIXED'; cr.counterAxisSizingMode='FIXED';
    cr.appendChild(await afPreviewCanvas(418,444,'Preview',false));
    const tc=figma.createFrame(); tc.name='trans-column'; tc.resize(48,444); tc.fills=solidPaint('#14141C'); tc.cornerRadius=6;
    applyAutoLayout(tc,'VERTICAL',8,8,12); tc.primaryAxisSizingMode='FIXED'; tc.counterAxisSizingMode='FIXED';
    tc.primaryAxisAlignItems='CENTER'; tc.counterAxisAlignItems='CENTER';
    const cb=figma.createFrame(); cb.name='cut-btn'; cb.resize(32,32); cb.cornerRadius=6; cb.fills=accentGradientPaint();
    applyAutoLayout(cb,'HORIZONTAL',0,0,0); cb.primaryAxisAlignItems='CENTER'; cb.counterAxisAlignItems='CENTER';
    cb.primaryAxisSizingMode='FIXED'; cb.counterAxisSizingMode='FIXED';
    const ci=figma.createRectangle(); ci.resize(12,12); ci.cornerRadius=2; ci.fills=solidPaint('#FFFFFF'); cb.appendChild(ci); tc.appendChild(cb); cr.appendChild(tc);
    cr.appendChild(await afPreviewCanvas(418,444,'Program',true)); ct.appendChild(cr);
    const mr=figma.createFrame(); mr.name='mixer-row'; mr.fills=solidPaint('#14141C'); mr.resize(900,291);
    applyAutoLayout(mr,'HORIZONTAL',6,10,8); mr.primaryAxisSizingMode='FIXED'; mr.counterAxisSizingMode='FIXED';
    for (const ch of ['Desktop','Mic/Aux','Browser','Music','VoIP']) mr.appendChild(await afMixerStrip(ch,false));
    ct.appendChild(mr); ws.appendChild(ct); ws.appendChild(await afControlsPanel(180));
    frame.appendChild(ws); frame.appendChild(afStatusBar()); pg.appendChild(frame); return frame;
  }
  async function buildFloating(pg) {
    const base=await buildDefault(pg); base.name='app/floating-windows';
    const fm=figma.createFrame(); fm.name='floating/mixer'; fm.resize(460,160); fm.fills=solidPaint('#1C1C27'); fm.cornerRadius=10;
    fm.strokes=solidPaint('#8A5CFF'); fm.strokeWeight=1.5; fm.strokeAlign='INSIDE';
    fm.effects=[{type:'DROP_SHADOW',offset:{x:0,y:12},radius:32,spread:0,color:{r:0,g:0,b:0,a:0.55},blendMode:'NORMAL',visible:true},accentGlow()];
    applyAutoLayout(fm,'VERTICAL',0,0,0); fm.primaryAxisSizingMode='FIXED'; fm.counterAxisSizingMode='FIXED';
    fm.x=400; fm.y=200; base.appendChild(fm); fm.layoutPositioning='ABSOLUTE';
    const fs=figma.createFrame(); fs.name='floating/stats'; fs.resize(320,220); fs.fills=solidPaint('#1C1C27'); fs.cornerRadius=10;
    fs.strokes=solidPaint('#8A5CFF'); fs.strokeWeight=1.5; fs.strokeAlign='INSIDE';
    fs.effects=[{type:'DROP_SHADOW',offset:{x:0,y:12},radius:32,spread:0,color:{r:0,g:0,b:0,a:0.55},blendMode:'NORMAL',visible:true},accentGlow()];
    applyAutoLayout(fs,'VERTICAL',0,0,0); fs.primaryAxisSizingMode='FIXED'; fs.counterAxisSizingMode='FIXED';
    fs.x=900; fs.y=150; base.appendChild(fs); fs.layoutPositioning='ABSOLUTE'; return base;
  }

  const defaultFrame=await buildDefault(page); const studioFrame=await buildStudioMode(page); const floatingFrame=await buildFloating(page);
  defaultFrame.x=0;    defaultFrame.y=0;
  studioFrame.x=1500;  studioFrame.y=0;
  floatingFrame.x=3000; floatingFrame.y=0;
  return {defaultFrame,studioFrame,floatingFrame};
}

// ─── buildVariables ───────────────────────────────────────────────────────────
async function buildVariables() {
  if (!figma.variables) { log('Variables API not available — skipping','warn'); return; }
  const existing = await figma.variables.getLocalVariableCollectionsAsync();
  let coll = existing.find(c => c.name === 'Tokens');
  if (!coll) coll = figma.variables.createVariableCollection('Tokens');
  const darkModeId = coll.modes[0].modeId;
  coll.renameMode(darkModeId, 'Dark');
  // Note: Figma free plan supports only 1 mode — Light mode skipped
  function hc(hex) { const rgb = hexToRgb(hex); return { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }; }
  const pairs = [
    ['color/bg/base',        '#0B0B0F'],
    ['color/bg/surface',     '#14141C'],
    ['color/bg/panel',       '#1C1C27'],
    ['color/bg/divider',     '#2A2A3A'],
    ['color/text/primary',   '#FFFFFF'],
    ['color/text/secondary', '#B9B9C9'],
    ['color/text/muted',     '#6C6C80'],
    ['color/accent/start',   '#8A5CFF'],
    ['color/accent/end',     '#FF4FD8'],
    ['color/state/danger',   '#FF5470'],
    ['color/state/warning',  '#FFC857'],
    ['color/state/success',  '#3DDC97'],
    ['color/meter/safe',     '#3DDC97'],
    ['color/meter/caution',  '#FFC857'],
    ['color/meter/clip',     '#FF5470'],
  ];
  const existingVars = await figma.variables.getLocalVariablesAsync('COLOR');
  for (const [name, dark] of pairs) {
    let v = existingVars.find(ev => ev.name === name && ev.variableCollectionId === coll.id);
    if (!v) v = figma.variables.createVariable(name, coll, 'COLOR');
    v.setValueForMode(darkModeId, hc(dark));
    log('Variable: ' + name);
  }
}

// ─── buildIcons ───────────────────────────────────────────────────────────────
async function buildIcons(page) {
  await figma.setCurrentPageAsync(page);
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  // createVector/vectorPaths is unsupported in this plugin environment.
  // Create named component placeholders — replace with Lucide icons from Assets panel.
  const ICON_NAMES = [
    'plus','minus','x','check',
    'chevron-down','chevron-up','chevron-right','chevron-left',
    'arrow-up','arrow-down','search','settings',
    'eye','lock','unlock','trash',
    'copy','filter','save','mic',
    'monitor','camera','image','video',
    'music','drag',
  ];

  const COLS = 8, GAP = 44;
  for (let i = 0; i < ICON_NAMES.length; i++) {
    const name = ICON_NAMES[i];
    const comp = figma.createComponent();
    comp.name = 'icon/' + name;
    comp.resize(16, 16);
    comp.fills = [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.12 }];
    comp.cornerRadius = 3;
    comp.strokes = solidPaint('#8A5CFF');
    comp.strokeWeight = 1; comp.strokeAlign = 'INSIDE';
    comp.x = (i % COLS) * GAP;
    comp.y = 1800 + Math.floor(i / COLS) * GAP;
    page.appendChild(comp);
  }

  // Instruction label
  const rows = Math.ceil(ICON_NAMES.length / COLS);
  const note = figma.createFrame();
  note.name = 'icon-setup-note'; note.resize(352, 56); note.cornerRadius = 8;
  note.fills = solidPaint('#14141C');
  note.strokes = solidPaint('#FFC857'); note.strokeWeight = 1; note.strokeAlign = 'INSIDE';
  applyAL(note, 'VERTICAL', 4, 12, 10);
  note.primaryAxisSizingMode = 'FIXED'; note.counterAxisSizingMode = 'FIXED';
  note.x = 0; note.y = 1800 + rows * GAP + 12;
  const t1 = figma.createText(); t1.fontName = { family:'Inter', style:'Regular' }; t1.fontSize = 12;
  t1.characters = 'Icon placeholders — swap with real icons:'; t1.fills = solidPaint('#FFC857');
  note.appendChild(t1);
  const t2 = figma.createText(); t2.fontName = { family:'Inter', style:'Regular' }; t2.fontSize = 11;
  t2.characters = 'Assets panel > search "Lucide" > drag icon into each 16x16 component';
  t2.fills = solidPaint('#6C6C80'); note.appendChild(t2);
  page.appendChild(note);
  log(ICON_NAMES.length + ' icon placeholders created — replace with Lucide icons', 'warn');
}

// ─── buildButtonStates ────────────────────────────────────────────────────────
async function buildButtonStates(page) {
  await figma.setCurrentPageAsync(page);
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  const TYPES  = ['Primary','Secondary','Ghost','Danger'];
  const STATES = ['Default','Hover','Pressed','Disabled'];
  const variants = [];
  for (const type of TYPES) {
    for (const state of STATES) {
      const c = figma.createComponent();
      c.name = 'Type=' + type + ', State=' + state;
      c.resize(128, 36); c.cornerRadius = 6;
      if (type === 'Primary') {
        c.fills = state === 'Disabled' ? solidPaint('#1C1C27') : accentGradientPaint();
        if (state === 'Hover')   { c.opacity = 0.88; }
        if (state === 'Pressed') { c.effects = [accentGlow()]; }
      } else if (type === 'Secondary') {
        c.fills = state === 'Hover' ? solidPaint('#22222F') : solidPaint('#1C1C27');
        c.strokes = solidPaint(state === 'Hover' ? '#8A5CFF' : '#2A2A3A');
        c.strokeWeight = 1; c.strokeAlign = 'INSIDE';
      } else if (type === 'Ghost') {
        c.fills = state === 'Hover'    ? [{ type:'SOLID', color:{r:1,g:1,b:1}, opacity:0.06 }]
                : state === 'Pressed'  ? [{ type:'SOLID', color:hexToRgb('#8A5CFF'), opacity:0.12 }]
                : [];
      } else if (type === 'Danger') {
        c.fills = state === 'Disabled' ? solidPaint('#1C1C27') : solidPaint('#FF5470');
        if (state === 'Hover') { c.opacity = 0.88; }
      }
      if (state === 'Disabled') c.opacity = 0.4;
      applyAutoLayout(c, 'HORIZONTAL', 0, 0, 0);
      c.primaryAxisAlignItems = 'CENTER'; c.counterAxisAlignItems = 'CENTER';
      c.primaryAxisSizingMode = 'FIXED';  c.counterAxisSizingMode = 'FIXED';
      const t = figma.createText(); t.fontName = { family:'Inter', style:'Medium' }; t.fontSize = 13;
      t.characters = type;
      t.fills = state === 'Disabled' ? solidPaint('#6C6C80')
              : (type === 'Ghost' && state === 'Default') ? solidPaint('#B9B9C9')
              : solidPaint('#FFFFFF');
      c.appendChild(t); variants.push(c);
    }
  }
  const set = figma.combineAsVariants(variants, page);
  set.name = 'button/states'; set.cornerRadius = 12;
  set.fills = [{ type:'SOLID', color:hexToRgb('#14141C') }];
  applyAutoLayout(set, 'HORIZONTAL', 12, 24, 24);
  set.layoutWrap = 'WRAP'; set.itemSpacing = 12; set.counterAxisSpacing = 12;
  set.x = 0; set.y = 2050;
  return set;
}

// ─── buildInputStates ─────────────────────────────────────────────────────────
async function buildInputStates(page) {
  await figma.setCurrentPageAsync(page);
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const TYPES  = ['Text','Dropdown','Toggle-On','Toggle-Off','Checkbox-Checked','Checkbox-Unchecked'];
  const STATES = ['Default','Hover','Focus','Error','Disabled'];
  const variants = [];
  for (const type of TYPES) {
    for (const state of STATES) {
      const c = figma.createComponent();
      c.name = 'Type=' + type + ', State=' + state;
      if (type === 'Text' || type === 'Dropdown') {
        c.resize(200, 32); c.cornerRadius = 8;
        c.fills = solidPaint(state === 'Disabled' ? '#0B0B0F' : '#14141C');
        c.strokes = state === 'Focus'    ? accentGradientPaint()
                  : state === 'Error'    ? solidPaint('#FF5470')
                  : state === 'Hover'    ? solidPaint('#4A4A5A')
                  : state === 'Disabled' ? solidPaint('#1C1C27')
                  : solidPaint('#2A2A3A');
        c.strokeWeight = state === 'Focus' ? 1.5 : 1; c.strokeAlign = 'INSIDE';
        if (state === 'Focus') c.effects = [accentGlow()];
        applyAutoLayout(c, 'HORIZONTAL', 0, 12, 0);
        c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'FIXED';
        c.counterAxisAlignItems = 'CENTER';
        if (type === 'Dropdown') c.primaryAxisAlignItems = 'SPACE_BETWEEN';
        const t = figma.createText(); t.fontName = { family:'Inter', style:'Regular' }; t.fontSize = 13;
        t.characters = state === 'Disabled' ? 'Disabled' : type === 'Dropdown' ? 'Select option' : 'Enter value';
        t.fills = state === 'Disabled' ? solidPaint('#2A2A3A') : solidPaint('#FFFFFF'); c.appendChild(t);
        if (type === 'Dropdown') {
          const arr = figma.createRectangle(); arr.resize(8, 5); arr.cornerRadius = 1;
          arr.fills = solidPaint(state === 'Disabled' ? '#2A2A3A' : '#6C6C80'); c.appendChild(arr);
        }
        if (state === 'Disabled') c.opacity = 0.5;
      } else if (type === 'Toggle-On' || type === 'Toggle-Off') {
        const isOn = type === 'Toggle-On';
        c.resize(40, 22); c.cornerRadius = 999;
        c.fills = state === 'Disabled' ? solidPaint('#1C1C27')
                : isOn ? accentGradientPaint() : solidPaint('#2A2A3A');
        if (state === 'Hover' && isOn) c.effects = [accentGlow()];
        if (state === 'Disabled') c.opacity = 0.4;
        const knob = figma.createEllipse(); knob.resize(16, 16);
        knob.x = isOn ? 21 : 3; knob.y = 3; knob.fills = solidPaint('#FFFFFF');
        c.appendChild(knob);
      } else {
        const isChecked = type === 'Checkbox-Checked';
        c.resize(18, 18); c.cornerRadius = 4;
        c.fills = state === 'Disabled' ? solidPaint('#1C1C27')
                : isChecked ? accentGradientPaint() : solidPaint('#14141C');
        if (!isChecked || state !== 'Disabled') {
          c.strokes = state === 'Error'  ? solidPaint('#FF5470')
                    : state === 'Focus'  ? solidPaint('#8A5CFF')
                    : state === 'Hover'  ? solidPaint('#4A4A5A')
                    : isChecked          ? solidPaint('#8A5CFF')
                    : solidPaint('#2A2A3A');
          c.strokeWeight = 1.5; c.strokeAlign = 'INSIDE';
        }
        if (isChecked && state !== 'Disabled') {
          const tick = figma.createRectangle(); tick.resize(10, 7); tick.cornerRadius = 1;
          tick.fills = solidPaint('#FFFFFF'); tick.x = 4; tick.y = 5; c.appendChild(tick);
        }
        if (state === 'Disabled') c.opacity = 0.4;
      }
      variants.push(c);
    }
  }
  const set = figma.combineAsVariants(variants, page);
  set.name = 'input/states'; set.cornerRadius = 12;
  set.fills = [{ type:'SOLID', color:hexToRgb('#14141C') }];
  applyAutoLayout(set, 'HORIZONTAL', 16, 24, 24);
  set.layoutWrap = 'WRAP'; set.itemSpacing = 12; set.counterAxisSpacing = 12;
  set.x = 0; set.y = 2250;
  return set;
}

// ─── buildMissingPanels (hotkeys + audio monitoring) ─────────────────────────
async function buildMissingPanels() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });

  // Find or use page 02
  let page = figma.root.children.find(p => p.name === '02 — Panels, Menus & Modals');
  if (!page) { log('Page 02 not found — run full build first', 'warn'); return; }
  await figma.setCurrentPageAsync(page);

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function tx(str, size, weight, color) {
    await figma.loadFontAsync({ family: 'Inter', style: weight });
    const t = figma.createText(); t.fontName = { family: 'Inter', style: weight };
    t.fontSize = size; t.characters = str; t.fills = solidPaint(color); return t;
  }
  function makePanelHdr(title) {
    const h = figma.createFrame(); h.name = 'header'; h.resize(320, 36);
    h.fills = solidPaint('#14141C'); applyAL(h, 'HORIZONTAL', 6, 10, 0);
    h.primaryAxisSizingMode = 'FIXED'; h.counterAxisSizingMode = 'FIXED';
    h.counterAxisAlignItems = 'CENTER'; h.primaryAxisAlignItems = 'SPACE_BETWEEN';
    const drag = figma.createRectangle(); drag.resize(6, 18); drag.cornerRadius = 3;
    drag.fills = solidPaint('#2A2A3A'); h.appendChild(drag);
    return { h, addTitle: async (t) => {
      const tn = await tx(t, 13, 'Medium', '#FFFFFF'); tn.layoutGrow = 1; h.appendChild(tn);
      const cl = figma.createRectangle(); cl.resize(14, 14); cl.cornerRadius = 7;
      cl.fills = solidPaint('#FF5470'); h.appendChild(cl);
    }};
  }

  // ── panel/hotkeys ──────────────────────────────────────────────────────────
  const hk = figma.createComponent(); hk.name = 'panel/hotkeys'; hk.resize(400, 320);
  hk.fills = solidPaint('#1C1C27'); hk.cornerRadius = 12; applyAL(hk, 'VERTICAL', 0, 0, 0);
  hk.primaryAxisSizingMode = 'FIXED'; hk.counterAxisSizingMode = 'FIXED';

  const { h: hkHdr, addTitle: hkTitle } = makePanelHdr('Hotkeys'); hkHdr.resize(400, 36);
  await hkTitle('Hotkeys'); hk.appendChild(hkHdr);
  const hkDiv = figma.createRectangle(); hkDiv.resize(400, 1); hkDiv.fills = solidPaint('#2A2A3A'); hk.appendChild(hkDiv);

  // Column headers
  const hkHead = figma.createFrame(); hkHead.name = 'col-headers'; hkHead.resize(400, 28);
  hkHead.fills = solidPaint('#14141C'); applyAL(hkHead, 'HORIZONTAL', 0, 12, 0);
  hkHead.primaryAxisSizingMode = 'FIXED'; hkHead.counterAxisSizingMode = 'FIXED'; hkHead.counterAxisAlignItems = 'CENTER';
  const hkC1 = await tx('Action', 11, 'Medium', '#6C6C80'); hkC1.resize(220, hkC1.height); hkHead.appendChild(hkC1);
  const hkC2 = await tx('Binding', 11, 'Medium', '#6C6C80'); hkHead.appendChild(hkC2);
  hk.appendChild(hkHead);

  // Hotkey rows
  const hkRows = [
    { action: 'Start Streaming',    key: 'Ctrl + Shift + S' },
    { action: 'Stop Streaming',     key: '—' },
    { action: 'Start Recording',    key: 'Ctrl + Shift + R' },
    { action: 'Pause Recording',    key: '—' },
    { action: 'Studio Mode',        key: 'Ctrl + Shift + T' },
    { action: 'Start Virtual Cam',  key: '—' },
    { action: 'Screenshot',         key: 'Ctrl + Shift + P' },
  ];
  const hkList = figma.createFrame(); hkList.name = 'hotkey-list'; hkList.fills = [];
  applyAL(hkList, 'VERTICAL', 0, 0, 0); hkList.primaryAxisSizingMode = 'AUTO'; hkList.counterAxisSizingMode = 'AUTO';
  for (let i = 0; i < hkRows.length; i++) {
    const row = figma.createFrame(); row.name = hkRows[i].action; row.resize(400, 32);
    row.fills = i % 2 === 1 ? [{ type: 'SOLID', color: hexToRgb('#14141C'), opacity: 0.5 }] : [];
    applyAL(row, 'HORIZONTAL', 0, 12, 0); row.primaryAxisSizingMode = 'FIXED'; row.counterAxisSizingMode = 'FIXED';
    row.counterAxisAlignItems = 'CENTER'; row.primaryAxisAlignItems = 'SPACE_BETWEEN';
    const at = await tx(hkRows[i].action, 12, 'Regular', '#B9B9C9'); at.resize(200, at.height); row.appendChild(at);
    const chip = figma.createFrame(); chip.name = 'key-chip'; chip.cornerRadius = 4;
    chip.fills = solidPaint('#14141C'); chip.strokes = solidPaint('#2A2A3A');
    chip.strokeWeight = 1; chip.strokeAlign = 'INSIDE';
    applyAL(chip, 'HORIZONTAL', 0, 8, 4); chip.primaryAxisSizingMode = 'AUTO'; chip.counterAxisSizingMode = 'AUTO';
    const kt = await tx(hkRows[i].key, 11, 'Regular', hkRows[i].key === '—' ? '#6C6C80' : '#FFFFFF'); chip.appendChild(kt);
    row.appendChild(chip);
    // Edit + Clear buttons
    const acts = figma.createFrame(); acts.fills = []; applyAL(acts, 'HORIZONTAL', 4, 0, 0);
    acts.primaryAxisSizingMode = 'AUTO'; acts.counterAxisSizingMode = 'AUTO';
    for (const lbl of ['Edit', 'Clear']) {
      const b = figma.createFrame(); b.resize(36, 20); b.cornerRadius = 4;
      b.fills = solidPaint('#1C1C27'); b.strokes = solidPaint('#2A2A3A'); b.strokeWeight = 1; b.strokeAlign = 'INSIDE';
      applyAL(b, 'HORIZONTAL', 0, 0, 0); b.primaryAxisAlignItems = 'CENTER'; b.counterAxisAlignItems = 'CENTER';
      b.primaryAxisSizingMode = 'FIXED'; b.counterAxisSizingMode = 'FIXED';
      const bl = await tx(lbl, 10, 'Regular', '#6C6C80'); b.appendChild(bl); acts.appendChild(b);
    }
    row.appendChild(acts); hkList.appendChild(row);
  }
  hk.appendChild(hkList);
  // Position panel
  let maxX = 0;
  for (const child of page.children) { if (child.x + child.width > maxX) maxX = child.x + child.width; }
  hk.x = 0; hk.y = 2800; page.appendChild(hk);

  // ── panel/audio-monitoring ─────────────────────────────────────────────────
  const am = figma.createComponent(); am.name = 'panel/audio-monitoring'; am.resize(480, 240);
  am.fills = solidPaint('#1C1C27'); am.cornerRadius = 12; applyAL(am, 'VERTICAL', 0, 0, 0);
  am.primaryAxisSizingMode = 'FIXED'; am.counterAxisSizingMode = 'FIXED';

  const { h: amHdr, addTitle: amTitle } = makePanelHdr('Audio Monitoring'); amHdr.resize(480, 36);
  await amTitle('Audio Monitoring'); am.appendChild(amHdr);
  const amDiv = figma.createRectangle(); amDiv.resize(480, 1); amDiv.fills = solidPaint('#2A2A3A'); am.appendChild(amDiv);

  // Column headers
  const amHead = figma.createFrame(); amHead.name = 'col-headers'; amHead.resize(480, 28);
  amHead.fills = solidPaint('#14141C'); applyAL(amHead, 'HORIZONTAL', 0, 12, 0);
  amHead.primaryAxisSizingMode = 'FIXED'; amHead.counterAxisSizingMode = 'FIXED'; amHead.counterAxisAlignItems = 'CENTER';
  const amC1 = await tx('Source', 11, 'Medium', '#6C6C80'); amC1.resize(180, amC1.height); amHead.appendChild(amC1);
  amHead.appendChild(await tx('Monitor Mode', 11, 'Medium', '#6C6C80')); am.appendChild(amHead);

  const MODES = ['Off', 'Monitor Only', 'Monitor and Output'];
  const amSources = [
    { name: 'Desktop Audio',   mode: 0 },
    { name: 'Mic/Aux',         mode: 2 },
    { name: 'Browser Source',  mode: 0 },
    { name: 'Music',           mode: 1 },
  ];
  for (let i = 0; i < amSources.length; i++) {
    const row = figma.createFrame(); row.name = amSources[i].name; row.resize(480, 36);
    row.fills = i % 2 === 1 ? [{ type: 'SOLID', color: hexToRgb('#14141C'), opacity: 0.5 }] : [];
    applyAL(row, 'HORIZONTAL', 0, 12, 0); row.primaryAxisSizingMode = 'FIXED'; row.counterAxisSizingMode = 'FIXED';
    row.counterAxisAlignItems = 'CENTER'; row.primaryAxisAlignItems = 'SPACE_BETWEEN';
    const sn = await tx(amSources[i].name, 12, 'Regular', '#B9B9C9'); sn.resize(160, sn.height); row.appendChild(sn);
    // Mode selector (3 pill buttons)
    const mSel = figma.createFrame(); mSel.name = 'mode-selector'; mSel.fills = solidPaint('#14141C');
    mSel.cornerRadius = 6; mSel.strokes = solidPaint('#2A2A3A'); mSel.strokeWeight = 1; mSel.strokeAlign = 'INSIDE';
    applyAL(mSel, 'HORIZONTAL', 2, 3, 3); mSel.primaryAxisSizingMode = 'AUTO'; mSel.counterAxisSizingMode = 'AUTO';
    for (let m = 0; m < MODES.length; m++) {
      const mb = figma.createFrame(); mb.cornerRadius = 4; mb.primaryAxisSizingMode = 'AUTO'; mb.counterAxisSizingMode = 'AUTO';
      mb.fills = m === amSources[i].mode ? accentGradientPaint() : [];
      applyAL(mb, 'HORIZONTAL', 0, 8, 4);
      const ml = await tx(MODES[m], 10, 'Regular', m === amSources[i].mode ? '#FFFFFF' : '#6C6C80'); mb.appendChild(ml); mSel.appendChild(mb);
    }
    row.appendChild(mSel); am.appendChild(row);
  }
  am.x = 440; am.y = 2800; page.appendChild(am);

  figma.viewport.scrollAndZoomIntoView([hk, am]);
  figma.ui.postMessage({ type: 'PANELS_DONE' });
  log('panel/hotkeys + panel/audio-monitoring added to page 02', 'ok');
}

// ─── polishAppFrames ──────────────────────────────────────────────────────────
async function polishAppFrames() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  let page = figma.root.children.find(p => p.name === '03 — App Frames');
  if (!page) { log('Page 03 not found', 'warn'); return; }
  await figma.setCurrentPageAsync(page);

  const frames = ['app/default','app/studio-mode','app/floating-windows'];

  for (const frameName of frames) {
    const frame = page.children.find(n => n.name === frameName);
    if (!frame) { log('Frame not found: ' + frameName, 'warn'); continue; }

    // 1. Add subtle top gradient accent bar
    const accentBar = figma.createRectangle();
    accentBar.name = 'accent-bar';
    accentBar.resize(frame.width, 2);
    accentBar.x = 0; accentBar.y = 0;
    accentBar.fills = accentGradientPaint();
    accentBar.opacity = 0.9;
    frame.insertChild(frame.children.length, accentBar);

    // 2. Find and enhance canvas areas
    function enhanceCanvas(node) {
      if (!node || !node.children) return;
      for (const child of node.children) {
        if (child.name === 'canvas' && child.type === 'FRAME') {
          // Add glow effect to canvas
          child.effects = [
            { type: 'DROP_SHADOW', offset: { x: 0, y: 0 }, radius: 24, spread: 0,
              color: { r: 0.54, g: 0.36, b: 1, a: 0.2 }, blendMode: 'NORMAL', visible: true }
          ];
          // Enhance safe-margin dashed border
          const sm = child.findChild ? child.findChild(n => n.name === 'safe-margin') : null;
          if (sm) { sm.strokes = solidPaint('#8A5CFF'); sm.strokeWeight = 1; sm.opacity = 0.3; }
        }
        if (child.name === 'preview-header' || child.name === 'canvas') {
          enhanceCanvas(child);
        }
        if (child.children) enhanceCanvas(child);
      }
    }
    enhanceCanvas(frame);

    // 3. Find and enhance the menu bar
    function findMenuBar(node) {
      if (!node.children) return null;
      for (const child of node.children) {
        if (child.name === 'menubar') return child;
        const found = findMenuBar(child);
        if (found) return found;
      }
      return null;
    }
    const menuBar = findMenuBar(frame);
    if (menuBar) {
      menuBar.fills = solidPaint('#0D0D12');
      menuBar.effects = [
        { type: 'DROP_SHADOW', offset: { x: 0, y: 1 }, radius: 0, spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.4 }, blendMode: 'NORMAL', visible: true }
      ];
    }

    // 4. Find status bar and add gradient left border
    function findStatusBar(node) {
      if (!node.children) return null;
      for (const child of node.children) {
        if (child.name === 'statusbar') return child;
        const found = findStatusBar(child);
        if (found) return found;
      }
      return null;
    }
    const statusBar = findStatusBar(frame);
    if (statusBar) {
      statusBar.fills = solidPaint('#0B0B0F');
      statusBar.effects = [
        { type: 'DROP_SHADOW', offset: { x: 0, y: -1 }, radius: 0, spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.4 }, blendMode: 'NORMAL', visible: true }
      ];
    }

    // 5. Add watermark / version badge to bottom-right of each frame
    const badge = figma.createFrame();
    badge.name = 'kit-badge';
    badge.resize(140, 20); badge.cornerRadius = 999;
    badge.fills = [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.12 }];
    badge.strokes = solidPaint('#8A5CFF'); badge.strokeWeight = 1; badge.strokeAlign = 'INSIDE';
    applyAL(badge, 'HORIZONTAL', 0, 10, 0);
    badge.primaryAxisAlignItems = 'CENTER'; badge.counterAxisAlignItems = 'CENTER';
    badge.primaryAxisSizingMode = 'FIXED'; badge.counterAxisSizingMode = 'FIXED';
    badge.x = frame.width - 148; badge.y = frame.height - 28;
    badge.opacity = 0.6;
    const bt = figma.createText(); bt.fontName = { family: 'Inter', style: 'Regular' }; bt.fontSize = 9;
    bt.characters = 'OBS CodeBuilders UI Kit v1.0';
    bt.fills = solidPaint('#8A5CFF');
    badge.appendChild(bt);
    frame.appendChild(badge);

    log('Polished: ' + frameName);
  }

  // 6. On app/default — add a grid overlay annotation frame
  const defFrame = page.children.find(n => n.name === 'app/default');
  if (defFrame) {
    // Highlight the dock zones with subtle labels
    const annotation = figma.createFrame();
    annotation.name = 'layout-annotation'; annotation.fills = [];
    annotation.resize(defFrame.width, defFrame.height);
    annotation.x = defFrame.x; annotation.y = defFrame.y + defFrame.height + 40;
    applyAL(annotation, 'VERTICAL', 8, 24, 24);
    annotation.primaryAxisSizingMode = 'FIXED'; annotation.counterAxisSizingMode = 'AUTO';

    const at = figma.createText(); at.fontName = { family: 'Inter', style: 'Semi Bold' }; at.fontSize = 16;
    at.characters = 'app/default — Layout Zones'; at.fills = solidPaint('#FFFFFF'); annotation.appendChild(at);

    const zones = [
      { label: 'Menu Bar', color: '#8A5CFF', desc: '1440 × 30px — File / Edit / View / Profile / Tools / Help' },
      { label: 'Toolbar', color: '#FF4FD8', desc: '1440 × 32px — Studio Mode / Screenshot / Stats / Settings' },
      { label: 'Left Dock', color: '#3DDC97', desc: '220 × 780px — Scenes + Sources panels' },
      { label: 'Center Canvas', color: '#FFC857', desc: '879 × 540px — Preview (16:9) + Mixer + Transitions' },
      { label: 'Right Controls', color: '#FF5470', desc: '220 × 780px — Start/Stop controls' },
      { label: 'Status Bar', color: '#B9B9C9', desc: '1440 × 24px — CPU / FPS / Network / Recording timer' },
    ];
    for (const z of zones) {
      const row = figma.createFrame(); row.name = z.label; row.fills = [];
      applyAL(row, 'HORIZONTAL', 10, 0, 0); row.primaryAxisSizingMode = 'AUTO'; row.counterAxisSizingMode = 'AUTO';
      row.counterAxisAlignItems = 'CENTER';
      const dot = figma.createRectangle(); dot.resize(8, 8); dot.cornerRadius = 999;
      dot.fills = solidPaint(z.color); row.appendChild(dot);
      const lt = figma.createText(); lt.fontName = { family: 'Inter', style: 'Medium' }; lt.fontSize = 12;
      lt.characters = z.label + ' — '; lt.fills = solidPaint('#FFFFFF'); row.appendChild(lt);
      const dt = figma.createText(); dt.fontName = { family: 'Inter', style: 'Regular' }; dt.fontSize = 12;
      dt.characters = z.desc; dt.fills = solidPaint('#6C6C80'); row.appendChild(dt);
      annotation.appendChild(row);
    }
    page.appendChild(annotation);
  }

  figma.viewport.scrollAndZoomIntoView(page.children.filter(n => frames.includes(n.name)));
  figma.ui.postMessage({ type: 'POLISH_DONE' });
  log('App frames polished + layout annotation added', 'ok');
}

// ─── buildRefAppFrame ─────────────────────────────────────────────────────────
// Rebuilds app/default on page 03 to match reference layout:
//   Left dock: Sources + Audio Mixer
//   Center: Scene tabs + 16:9 Preview canvas + Recording/Streaming bottom row
//   Right dock: Controls (Start Streaming, Start Recording, etc.)
async function buildRefAppFrame() {
  const p03 = figma.root.children.find(p => p.name.startsWith('03'));
  if (!p03) { figma.ui.postMessage({ type: 'REFFRAME_ERROR', error: 'Page 03 not found' }); return; }
  await figma.setCurrentPageAsync(p03);
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  // Remove old app/default and its label
  ['app/default','lbl/app/default','div/app/default'].forEach(nm => {
    const n = p03.findOne(x => x.name === nm);
    if (n) n.remove();
  });

  // ── Color palette (dark navy — matches reference) ────────────────────────────
  const BG      = '#0B0B18';
  const PANEL   = '#141428';
  const HEADER  = '#1A2344';
  const BORDER  = '#252545';
  const TEXT    = '#FFFFFF';
  const TEXT2   = '#9999BB';
  const CANVAS  = '#05050E';
  const TAB_ON  = '#263060';

  function sp(hex)  { return solidPaint(hex); }
  function agrad()  { return [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1,0,0],[0,1,0]], gradientStops: [{ position:0, color:{r:0.541,g:0.361,b:1,a:1}},{ position:1, color:{r:1,g:0.310,b:0.847,a:1}}] }]; }
  function al(n,dir,gap,padH,padV) { applyAL(n,dir,gap,padH,padV); }
  function fixed(n,w,h) { n.primaryAxisSizingMode='FIXED'; n.counterAxisSizingMode='FIXED'; n.resize(w,h); }

  async function tx(chars, sz, style, col) {
    const t = figma.createText();
    t.fontName = { family:'Inter', style: style||'Regular' };
    t.fontSize = sz||11; t.characters = chars;
    t.fills = sp(col||TEXT); return t;
  }

  function makePanelShell(name, title, w, h) {
    const f = figma.createFrame(); f.name = name;
    f.fills = sp(PANEL); f.strokes = sp(BORDER); f.strokeWeight = 1; f.strokeAlign = 'INSIDE';
    al(f,'VERTICAL',0,0,0); fixed(f,w,h);
    const hdr = figma.createFrame(); hdr.name = 'ph'; hdr.fills = sp(HEADER);
    hdr.strokes = sp(BORDER); hdr.strokeWeight = 1;
    al(hdr,'HORIZONTAL',0,10,0); fixed(hdr,w,28); hdr.counterAxisAlignItems = 'CENTER';
    return { panel: f, hdr };
  }
  async function finishPanel(p, hdr, title) {
    hdr.appendChild(await tx(title, 11, 'Medium', TEXT2));
    p.panel.appendChild(hdr); return p.panel;
  }

  // ── Outer frame: 1440×900 ────────────────────────────────────────────────────
  const frame = figma.createFrame();
  frame.name = 'app/default'; fixed(frame, 1440, 900);
  frame.fills = sp(BG); frame.cornerRadius = 8;
  al(frame,'VERTICAL',0,0,0);

  // Menu bar 1440×30
  const menuBar = figma.createFrame(); menuBar.name = 'menu-bar';
  menuBar.fills = sp('#0A0A16'); menuBar.strokes = sp(BORDER); menuBar.strokeWeight = 1;
  al(menuBar,'HORIZONTAL',0,16,0); fixed(menuBar,1440,30); menuBar.counterAxisAlignItems = 'CENTER';
  for (const item of ['File','Edit','View','Profile','Scene Collection','Tools','Help']) {
    const f = figma.createFrame(); f.name = item; f.fills = [];
    al(f,'HORIZONTAL',0,10,0); f.primaryAxisSizingMode='AUTO'; f.counterAxisSizingMode='FIXED'; f.resize(10,30); f.counterAxisAlignItems='CENTER'; f.primaryAxisSizingMode='AUTO';
    f.appendChild(await tx(item, 11, 'Regular', TEXT2)); menuBar.appendChild(f);
  }
  frame.appendChild(menuBar);

  // Workspace row 1440×846
  const ws = figma.createFrame(); ws.name = 'workspace'; ws.fills = [];
  al(ws,'HORIZONTAL',0,0,0); fixed(ws,1440,846);

  // ── Left dock 220×846 ────────────────────────────────────────────────────────
  const ld = figma.createFrame(); ld.name = 'left-dock';
  ld.fills = sp(PANEL); ld.strokes = sp(BORDER); ld.strokeWeight = 1; ld.strokeAlign = 'INSIDE';
  al(ld,'VERTICAL',0,0,0); fixed(ld,220,846);

  // Sources panel 220×423
  const srcShell = makePanelShell('sources-panel','Sources',220,423);
  const srcList = figma.createFrame(); srcList.name = 'source-list'; srcList.fills = []; al(srcList,'VERTICAL',0,0,0); fixed(srcList,220,395);
  const srcItems = ['Display Capture','Webcam','Mic/Aux','Browser Source','Image'];
  for (let i=0;i<srcItems.length;i++) {
    const row = figma.createFrame(); row.name = srcItems[i]; row.fills = i===0?[{type:'SOLID',color:hexToRgb('#1E3060'),opacity:0.8}]:[]; al(row,'HORIZONTAL',6,12,0); fixed(row,220,28); row.counterAxisAlignItems='CENTER';
    const dot = figma.createRectangle(); dot.resize(5,5); dot.cornerRadius=999; dot.fills=sp(i===0?'#8A5CFF':BORDER); row.appendChild(dot);
    row.appendChild(await tx(srcItems[i], 11, i===0?'Medium':'Regular', i===0?TEXT:TEXT2));
    srcList.appendChild(row);
  }
  srcShell.panel.appendChild(srcList);
  ld.appendChild(await finishPanel(srcShell, srcShell.hdr, 'Sources'));

  // Audio Mixer 220×423
  const mixShell = makePanelShell('mixer-panel','Audio Mixer',220,423);
  const mixBody = figma.createFrame(); mixBody.name = 'mix-body'; mixBody.fills = []; al(mixBody,'VERTICAL',8,8,8); fixed(mixBody,220,395);
  for (const ch of ['Desktop','Mic/Aux','Game Capture']) {
    const strip = figma.createFrame(); strip.name = ch; strip.cornerRadius=6; strip.fills=sp('#0F0F20');
    strip.strokes=sp(BORDER); strip.strokeWeight=1; al(strip,'VERTICAL',4,8,6); fixed(strip,204,80);
    strip.appendChild(await tx(ch, 10, 'Medium', TEXT2));
    const meter = figma.createFrame(); meter.name='meter'; meter.cornerRadius=999; meter.fills=sp('#0A0A18'); fixed(meter,188,6);
    const mFill = figma.createRectangle(); mFill.resize(ch==='Mic/Aux'?80:130,6); mFill.cornerRadius=999; mFill.fills=sp(ch==='Mic/Aux'?'#FFC857':'#3DDC97'); meter.appendChild(mFill); strip.appendChild(meter);
    const vol = figma.createFrame(); vol.name='vol'; vol.cornerRadius=999; vol.fills=sp(BORDER); fixed(vol,188,4);
    const vFill = figma.createRectangle(); vFill.resize(140,4); vFill.cornerRadius=999; vFill.fills=agrad(); vol.appendChild(vFill); strip.appendChild(vol);
    mixBody.appendChild(strip);
  }
  mixShell.panel.appendChild(mixBody);
  ld.appendChild(await finishPanel(mixShell, mixShell.hdr, 'Audio Mixer'));
  ws.appendChild(ld);

  // ── Center 1000×846 ──────────────────────────────────────────────────────────
  const center = figma.createFrame(); center.name = 'center'; center.fills = sp(BG);
  al(center,'VERTICAL',0,0,0); fixed(center,1000,846);

  // Scene tabs 1000×36
  const tabs = figma.createFrame(); tabs.name = 'scene-tabs';
  tabs.fills = sp(HEADER); tabs.strokes = sp(BORDER); tabs.strokeWeight = 1;
  al(tabs,'HORIZONTAL',0,0,0); fixed(tabs,1000,36); tabs.counterAxisAlignItems = 'CENTER';
  const addBtn = figma.createFrame(); addBtn.name = 'SCENES+'; addBtn.fills = sp('#0F0F24');
  addBtn.strokes = sp(BORDER); addBtn.strokeWeight = 1;
  al(addBtn,'HORIZONTAL',0,0,0); fixed(addBtn,80,36); addBtn.primaryAxisAlignItems='CENTER'; addBtn.counterAxisAlignItems='CENTER';
  addBtn.appendChild(await tx('SCENES +', 10, 'Medium', '#8A5CFF')); tabs.appendChild(addBtn);
  for (let i=1;i<=6;i++) {
    const t = figma.createFrame(); t.name = 'SCENE ' + i; t.fills = i===1?sp(TAB_ON):sp(HEADER);
    t.strokes = sp(BORDER); t.strokeWeight = 1;
    al(t,'HORIZONTAL',0,0,0); fixed(t,90,36); t.primaryAxisAlignItems='CENTER'; t.counterAxisAlignItems='CENTER';
    t.appendChild(await tx('SCENE ' + i, 10, i===1?'Medium':'Regular', i===1?TEXT:TEXT2)); tabs.appendChild(t);
  }
  center.appendChild(tabs);

  // Preview canvas 1000×610
  const prev = figma.createFrame(); prev.name = 'preview-canvas'; prev.fills = sp(CANVAS);
  prev.strokes = sp(BORDER); prev.strokeWeight = 1; al(prev,'HORIZONTAL',0,0,0); fixed(prev,1000,610);
  prev.primaryAxisAlignItems = 'CENTER'; prev.counterAxisAlignItems = 'CENTER';
  const safe = figma.createFrame(); safe.name = 'safe-area'; safe.fills = []; safe.strokes = [{type:'SOLID',color:{r:1,g:1,b:1,a:0.04}}]; safe.strokeWeight = 1; safe.resize(882,496); prev.appendChild(safe);
  const prevLbl = figma.createFrame(); prevLbl.name = 'preview-badge';
  prevLbl.fills = [{type:'SOLID',color:{r:0,g:0,b:0,a:0.5}}]; prevLbl.cornerRadius = 3;
  al(prevLbl,'HORIZONTAL',0,8,0); fixed(prevLbl,66,20); prevLbl.primaryAxisAlignItems='CENTER'; prevLbl.counterAxisAlignItems='CENTER';
  prevLbl.appendChild(await tx('PREVIEW', 9, 'Medium', '#B9B9C9'));
  prev.appendChild(prevLbl); prevLbl.layoutPositioning = 'ABSOLUTE'; prevLbl.x = 10; prevLbl.y = 10;
  center.appendChild(prev);

  // Bottom row: Recording + Streaming 1000×200
  const bot = figma.createFrame(); bot.name = 'bottom-row'; bot.fills = [];
  al(bot,'HORIZONTAL',0,0,0); fixed(bot,1000,200);
  for (const [title, live] of [['Recording', false], ['Streaming', true]]) {
    const ps = makePanelShell(title.toLowerCase(), title, 500, 200);
    const body = figma.createFrame(); body.name = 'body'; body.fills = []; al(body,'VERTICAL',10,14,12); fixed(body,500,172);
    if (live) {
      const liveRow = figma.createFrame(); liveRow.fills = []; al(liveRow,'HORIZONTAL',6,0,0); liveRow.primaryAxisSizingMode='AUTO'; liveRow.counterAxisSizingMode='AUTO'; liveRow.counterAxisAlignItems='CENTER';
      const dot = figma.createEllipse(); dot.resize(7,7); dot.fills = sp('#FF5470'); dot.effects=[{type:'DROP_SHADOW',color:{r:1,g:0.33,b:0.44,a:0.7},offset:{x:0,y:0},radius:5,spread:0,visible:true,blendMode:'NORMAL'}]; liveRow.appendChild(dot);
      liveRow.appendChild(await tx('NOT LIVE', 10, 'Semi Bold', '#FF5470'));
      liveRow.appendChild(await tx('00:00:00', 10, 'Regular', TEXT2));
      body.appendChild(liveRow);
    }
    body.appendChild(await tx(live ? 'Not streaming' : 'Not recording', 11, 'Regular', TEXT2));
    for (const s of (live ? ['Bitrate: — Kbps','Dropped frames: 0 (0.0%)'] : ['Output: output.mkv','File size: 0.00 MB']))
      body.appendChild(await tx(s, 10, 'Regular', '#6C6C80'));
    ps.panel.appendChild(body);
    bot.appendChild(await finishPanel(ps, ps.hdr, title));
  }
  center.appendChild(bot);
  ws.appendChild(center);

  // ── Right dock: Controls 220×846 ─────────────────────────────────────────────
  const rd = figma.createFrame(); rd.name = 'right-dock';
  rd.fills = sp(PANEL); rd.strokes = sp(BORDER); rd.strokeWeight = 1; rd.strokeAlign = 'INSIDE';
  al(rd,'VERTICAL',10,10,10); fixed(rd,220,846);
  const rdH = figma.createFrame(); rdH.name = 'ctrl-hdr'; rdH.fills = sp(HEADER); rdH.strokes = sp(BORDER); rdH.strokeWeight = 1;
  al(rdH,'HORIZONTAL',0,10,0); fixed(rdH,220,28); rdH.counterAxisAlignItems = 'CENTER';
  rdH.appendChild(await tx('Controls', 11, 'Medium', TEXT2)); rd.appendChild(rdH);
  for (const b of [
    { label:'Start Streaming', gradient:true },
    { label:'Start Recording', gradient:false },
    { label:'Virtual Camera',  gradient:false },
    { label:'Studio Mode',     gradient:false },
    { label:'Settings',        gradient:false },
  ]) {
    const btn = figma.createFrame(); btn.name = b.label; btn.cornerRadius = 6;
    btn.fills = b.gradient ? agrad() : sp('#1A1A2E');
    btn.strokes = b.gradient ? [] : sp(BORDER); btn.strokeWeight = 1; btn.strokeAlign = 'INSIDE';
    al(btn,'HORIZONTAL',0,0,0); fixed(btn,200,36); btn.primaryAxisAlignItems='CENTER'; btn.counterAxisAlignItems='CENTER';
    btn.appendChild(await tx(b.label, 12, 'Medium', TEXT));
    rd.appendChild(btn);
  }
  ws.appendChild(rd);
  frame.appendChild(ws);

  // Status bar 1440×24
  const sb = figma.createFrame(); sb.name = 'status-bar';
  sb.fills = sp('#0A0A16'); sb.strokes = sp(BORDER); sb.strokeWeight = 1;
  al(sb,'HORIZONTAL',0,16,0); fixed(sb,1440,24); sb.counterAxisAlignItems='CENTER'; sb.primaryAxisAlignItems='SPACE_BETWEEN';
  const sbL = figma.createFrame(); sbL.fills=[]; al(sbL,'HORIZONTAL',16,0,0); sbL.primaryAxisSizingMode='AUTO'; sbL.counterAxisSizingMode='AUTO'; sbL.counterAxisAlignItems='CENTER';
  for (const s of ['CPU: 0.0%','RAM: 1.2 GB','FPS: 60.00','Skipped: 0']) sbL.appendChild(await tx(s, 10, 'Regular', '#6C6C80'));
  const sbR = figma.createFrame(); sbR.fills=[]; al(sbR,'HORIZONTAL',12,0,0); sbR.primaryAxisSizingMode='AUTO'; sbR.counterAxisSizingMode='AUTO'; sbR.counterAxisAlignItems='CENTER';
  sbR.appendChild(await tx('● REC 00:00:00', 10, 'Medium', '#FF5470'));
  sb.appendChild(sbL); sb.appendChild(sbR); frame.appendChild(sb);

  // Position and add to page
  frame.x = 0; frame.y = 0;
  p03.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  log('app/default rebuilt with reference layout', 'ok');
  figma.ui.postMessage({ type: 'REFFRAME_DONE' });
}

// ─── reorganizePage01 ─────────────────────────────────────────────────────────
// Complete clean-up pass on page 01:
//   • Removes floating sec-tag chips and old section headers
//   • Moves the 1440×900 cover to the very bottom (documentation frame)
//   • Restacks all content blocks top-to-bottom in one clean column
//   • Inserts styled section-divider headers between each group
async function reorganizePage01() {
  const page = figma.root.children.find(p => p.name.startsWith('01'));
  if (!page) { figma.ui.postMessage({ type: 'REORG_ERROR', error: 'Page 01 not found' }); return; }
  await figma.setCurrentPageAsync(page);
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  // ── 1. Remove all floating clutter ──────────────────────────────────────────
  page.findAll(n =>
    n.name.startsWith('sec-tag/') ||
    n.name.startsWith('sechdr/') ||
    n.name.startsWith('section/') ||
    n.name === 'icon-setup-note'
  ).forEach(n => n.remove());
  log('Removed floating tags', 'ok');

  // ── 2. Identify key content blocks (direct page children) ───────────────────
  const pageCover    = page.findOne(n => n.name === 'page-cover');         // our 940×128 header
  const bigCover     = page.findOne(n => n.name === 'cover');               // original 1440×900 cover
  const colorBlock   = page.findOne(n => n.name === 'color-swatches');
  const typoBlock    = page.findOne(n => n.name === 'typography-specimens');
  const btnStates    = page.findOne(n => n.name === 'button/states' && n.parent === page);
  const inpStates    = page.findOne(n => n.name === 'input/states'  && n.parent === page);
  const iconShowcase = page.findOne(n => n.name === 'icon-showcase');
  const iconComponents = page.findAll(n => n.type === 'COMPONENT' && n.name.startsWith('icon/') && n.parent === page)
                           .sort((a,b) => a.name.localeCompare(b.name));
  const compSets = page.findAll(n =>
    n.parent === page &&
    (n.type === 'COMPONENT_SET' || n.type === 'COMPONENT') &&
    !n.name.startsWith('icon/') &&
    !n.name.includes('/states') &&
    !['cover','color-swatches','typography-specimens','page-cover','icon-showcase'].includes(n.name)
  ).sort((a,b) => a.name.localeCompare(b.name));

  // ── 3. Layout helpers ────────────────────────────────────────────────────────
  const LEFT = 0;
  const W    = 940;  // canonical content width
  let   Y    = 60;   // start Y (below page-cover which lives at y=-168)

  // Styled section divider
  function makeDivider(title, color) {
    const old = page.findOne(n => n.name === 'div/' + title);
    if (old) old.remove();
    const d = figma.createFrame();
    d.name = 'div/' + title; d.resize(W, 36); d.cornerRadius = 8;
    d.fills = [{ type: 'SOLID', color: hexToRgb(color), opacity: 0.08 }];
    d.strokes = [{ type: 'SOLID', color: hexToRgb(color), opacity: 0.4 }];
    d.strokeWeight = 1; d.strokeAlign = 'INSIDE';
    applyAL(d, 'HORIZONTAL', 10, 14, 0);
    d.primaryAxisSizingMode = 'FIXED'; d.counterAxisSizingMode = 'FIXED';
    d.counterAxisAlignItems = 'CENTER';
    const bar = figma.createRectangle(); bar.resize(3, 18); bar.cornerRadius = 999; bar.fills = solidPaint(color); d.appendChild(bar);
    const t = figma.createText(); t.fontName = { family:'Inter', style:'Semi Bold' }; t.fontSize = 12;
    t.characters = title; t.fills = solidPaint('#FFFFFF'); d.appendChild(t);
    d.x = LEFT; d.y = Y; page.appendChild(d);
    Y += 36 + 16;
  }

  function place(node, gap) {
    if (!node) return;
    node.x = LEFT; node.y = Y;
    Y += node.height + (gap || 60);
  }

  // ── 4. Section: Color Tokens ─────────────────────────────────────────────────
  makeDivider('Color Tokens', '#8A5CFF');
  place(colorBlock, 60);

  // ── 5. Section: Typography ───────────────────────────────────────────────────
  makeDivider('Typography — Text Styles', '#FF4FD8');
  place(typoBlock, 60);

  // ── 6. Section: Component Library ───────────────────────────────────────────
  if (compSets.length > 0) {
    makeDivider('Component Library — Buttons · Inputs · Lists · Tabs · Meters', '#3DDC97');
    // Stack component sets vertically with smaller gap
    for (const c of compSets) {
      c.x = LEFT; c.y = Y;
      Y += c.height + 32;
    }
    Y += 28; // extra gap after section
  }

  // ── 7. Section: State Variants ───────────────────────────────────────────────
  makeDivider('State Variants — Button × 4 states · Input × 5 states', '#FFC857');
  place(btnStates, 32);
  place(inpStates, 60);

  // ── 8. Section: Icon Set (16×16 components) ───────────────────────────────────
  if (iconComponents.length > 0) {
    makeDivider('Icon Set — 26 Lucide Components (16×16)', '#3DDC97');
    const COLS = 10, ICON_STEP = 44;
    for (let i = 0; i < iconComponents.length; i++) {
      iconComponents[i].x = LEFT + (i % COLS) * ICON_STEP;
      iconComponents[i].y = Y    + Math.floor(i / COLS) * ICON_STEP;
    }
    Y += (Math.ceil(iconComponents.length / COLS)) * ICON_STEP + 24;
  }

  // ── 9. Section: Icon Showcase ─────────────────────────────────────────────────
  makeDivider('Icon Showcase — 24×24 Preview Cards', '#FFC857');
  place(iconShowcase, 80);

  // ── 10. Move big 1440×900 cover to bottom (keep as reference) ────────────────
  if (bigCover) {
    bigCover.x = 0; bigCover.y = Y + 40;
    Y += bigCover.height + 80;
    log('Original cover moved to y=' + bigCover.y, 'ok');
  }

  // ── 11. Keep page-cover pinned at top ────────────────────────────────────────
  if (pageCover) { pageCover.x = 0; pageCover.y = -168; }

  figma.viewport.scrollAndZoomIntoView([pageCover, colorBlock, typoBlock].filter(Boolean));
  log('Page 01 reorganized — clean single-column layout', 'ok');
  figma.ui.postMessage({ type: 'REORG_DONE' });
}

// ─── buildPrototype ──────────────────────────────────────────────────────────
// Wires prototype interactions between the three app frames on page 03.
// Uses Figma's reactions API: ON_CLICK → NAVIGATE with DISSOLVE transition.
async function buildPrototype() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  const p03 = figma.root.children.find(p => p.name.startsWith('03'));
  if (!p03) { figma.ui.postMessage({ type: 'PROTO_ERROR', error: 'Page 03 not found — run Build first' }); return; }
  await figma.setCurrentPageAsync(p03);

  const appDefault = p03.findOne(n => n.name === 'app/default');
  const appStudio  = p03.findOne(n => n.name === 'app/studio-mode');
  const appFloat   = p03.findOne(n => n.name === 'app/floating-windows');

  if (!appDefault) { figma.ui.postMessage({ type: 'PROTO_ERROR', error: 'app/default not found on page 03' }); return; }

  const dissolve = { type: 'DISSOLVE', duration: 0.3, easing: { type: 'EASE_OUT' } };
  const slideIn  = { type: 'MOVE_IN',  direction: 'RIGHT', matchLayers: false, duration: 0.28, easing: { type: 'EASE_OUT' } };
  const slideOut = { type: 'MOVE_OUT', direction: 'LEFT',  matchLayers: false, duration: 0.22, easing: { type: 'EASE_IN'  } };

  async function wire(srcFrame, btnName, dstFrame, transition) {
    if (!srcFrame || !dstFrame) return false;
    const btn = srcFrame.findOne(n => n.name === btnName);
    if (!btn) { log('btn "' + btnName + '" not found in ' + srcFrame.name, 'warn'); return false; }
    btn.reactions = [navReaction(dstFrame.id, transition || dissolve)];
    log('⇢ ' + srcFrame.name + '  [' + btnName + ']  →  ' + dstFrame.name, 'ok');
    return true;
  }

  let count = 0;

  // ── app/default → other frames ──────────────────────────────────────────────
  if (appStudio) {
    if (wire(appDefault, 'Start Streaming', appStudio, slideIn))  count++;
    if (wire(appDefault, 'Studio Mode',     appStudio, dissolve)) count++;
  }
  if (appFloat) {
    if (wire(appDefault, 'Settings', appFloat, slideIn)) count++;
  }

  // ── app/studio-mode → back ──────────────────────────────────────────────────
  if (appDefault && appStudio) {
    if (wire(appStudio, 'Studio Mode',     appDefault, slideOut)) count++;
    if (wire(appStudio, 'Start Streaming', appDefault, slideOut)) count++;
  }

  // ── app/floating-windows → back ─────────────────────────────────────────────
  if (appDefault && appFloat) {
    if (wire(appFloat, 'Studio Mode', appDefault, slideOut)) count++;
    if (wire(appFloat, 'Settings',    appDefault, slideOut)) count++;
  }

  // ── Prototype flow annotation ───────────────────────────────────────────────
  const oldFlow = p03.findOne(n => n.name === 'prototype-flow');
  if (oldFlow) oldFlow.remove();

  const appFrames = ['app/default','app/studio-mode','app/floating-windows'].map(nm => p03.findOne(n => n.name === nm)).filter(Boolean);
  const maxY = appFrames.length > 0 ? Math.max(...appFrames.map(f => f.y + f.height)) : 1800;

  const flowDiag = figma.createFrame();
  flowDiag.name = 'prototype-flow';
  flowDiag.fills = solidPaint('#0D0D12'); flowDiag.cornerRadius = 12;
  flowDiag.strokes = solidPaint('#2A2A3A'); flowDiag.strokeWeight = 1;
  applyAL(flowDiag, 'VERTICAL', 12, 24, 24);
  flowDiag.primaryAxisSizingMode = 'AUTO'; flowDiag.counterAxisSizingMode = 'AUTO';
  flowDiag.x = 0; flowDiag.y = maxY + 60;

  const fhdr = figma.createText();
  fhdr.fontName = { family: 'Inter', style: 'Semi Bold' }; fhdr.fontSize = 14;
  fhdr.characters = 'Prototype Flow  —  Click ▶ in Prototype tab to preview'; fhdr.fills = solidPaint('#FFFFFF');
  flowDiag.appendChild(fhdr);

  const FLOWS = [
    { from: 'app/default',         btn: 'Start Streaming →',  to: 'app/studio-mode',         col: '#8A5CFF' },
    { from: 'app/default',         btn: 'Studio Mode →',      to: 'app/studio-mode',         col: '#8A5CFF' },
    { from: 'app/default',         btn: 'Settings →',         to: 'app/floating-windows',    col: '#FF4FD8' },
    { from: 'app/studio-mode',     btn: 'Studio Mode →',      to: 'app/default (back)',      col: '#3DDC97' },
    { from: 'app/studio-mode',     btn: 'Start Streaming →',  to: 'app/default (back)',      col: '#3DDC97' },
    { from: 'app/floating-windows',btn: 'Studio Mode →',      to: 'app/default (back)',      col: '#3DDC97' },
    { from: 'app/floating-windows',btn: 'Settings →',         to: 'app/default (back)',      col: '#3DDC97' },
  ];

  for (const f of FLOWS) {
    const row = figma.createFrame(); row.name = 'flow/' + f.btn; row.fills = [];
    applyAL(row, 'HORIZONTAL', 8, 0, 0); row.primaryAxisSizingMode = 'AUTO'; row.counterAxisSizingMode = 'AUTO'; row.counterAxisAlignItems = 'CENTER';

    const mkChip = (label, color, bg) => {
      const ch = figma.createFrame(); ch.name = 'chip'; ch.cornerRadius = 4;
      ch.fills = bg ? solidPaint(bg) : [{ type: 'SOLID', color: hexToRgb(color), opacity: 0.12 }];
      ch.strokes = solidPaint(color); ch.strokeWeight = 1;
      applyAL(ch, 'HORIZONTAL', 0, 6, 3); ch.primaryAxisSizingMode = 'AUTO'; ch.counterAxisSizingMode = 'AUTO';
      const ct = figma.createText(); ct.fontName = { family: 'Inter', style: 'Regular' }; ct.fontSize = 11;
      ct.characters = label; ct.fills = solidPaint(color); ch.appendChild(ct); return ch;
    };
    const mkTxt = (chars, color) => { const t = figma.createText(); t.fontName = { family: 'Inter', style: 'Regular' }; t.fontSize = 11; t.characters = chars; t.fills = solidPaint(color); return t; };

    row.appendChild(mkChip(f.from, f.col, null));
    row.appendChild(mkTxt(f.btn, '#6C6C80'));
    row.appendChild(mkChip(f.to, '#B9B9C9', '#1C1C27'));
    flowDiag.appendChild(row);
  }
  p03.appendChild(flowDiag);

  figma.viewport.scrollAndZoomIntoView([appDefault, appStudio, appFloat].filter(Boolean));
  figma.ui.postMessage({ type: 'PROTO_DONE', count: count });
  log(count + ' interactions wired — open Prototype tab → ▶ to preview', 'ok');
}

// ─── buildEnhancement ────────────────────────────────────────────────────────
// Comprehensive visual enhancement pass:
//   Page 01: cover banner + 24px icon showcase + section headers
//   Page 03: frame labels
async function buildEnhancement() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  // ── PAGE 01 ────────────────────────────────────────────────────────────────
  const p01 = figma.root.children.find(p => p.name.startsWith('01'));
  if (p01) {
    await figma.setCurrentPageAsync(p01);

    // 1. Cover banner
    const oldCover = p01.findOne(n => n.name === 'page-cover');
    if (oldCover) oldCover.remove();
    const cover = figma.createFrame();
    cover.name = 'page-cover';
    cover.resize(940, 128);
    cover.x = 0; cover.y = -168;
    cover.cornerRadius = 16; cover.clipsContent = true;
    cover.fills = solidPaint('#0B0B0F');
    cover.effects = [{ type: 'DROP_SHADOW', color: { r: 0.541, g: 0.361, b: 1, a: 0.35 }, offset: { x: 0, y: 8 }, radius: 40, spread: 0, visible: true, blendMode: 'NORMAL' }];
    cover.strokes = solidPaint('#2A2A3A'); cover.strokeWeight = 1;
    applyAL(cover, 'VERTICAL', 8, 36, 40);
    cover.primaryAxisSizingMode = 'FIXED'; cover.counterAxisSizingMode = 'FIXED';
    cover.primaryAxisAlignItems = 'CENTER';
    // Gradient top stripe (absolute — must append first, then set layoutPositioning)
    const stripe = figma.createRectangle();
    stripe.name = 'accent-stripe'; stripe.resize(940, 3); stripe.x = 0; stripe.y = 0;
    stripe.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1,0,0],[0,1,0]], gradientStops: [{ position: 0, color: { r: 0.541, g: 0.361, b: 1, a: 1 } }, { position: 1, color: { r: 1, g: 0.310, b: 0.847, a: 1 } }] }];
    cover.appendChild(stripe);
    stripe.layoutPositioning = 'ABSOLUTE';
    const ct = figma.createText();
    ct.fontName = { family: 'Inter', style: 'Semi Bold' }; ct.fontSize = 26;
    ct.characters = 'OBS CodeBuilders UI Kit'; ct.fills = solidPaint('#FFFFFF');
    cover.appendChild(ct);
    const cs = figma.createText();
    cs.fontName = { family: 'Inter', style: 'Regular' }; cs.fontSize = 13;
    cs.characters = 'v1.0  ·  Dark mode  ·  Figma Variables  ·  26 Icons  ·  12 Panels  ·  3 App Frames';
    cs.fills = solidPaint('#6C6C80');
    cover.appendChild(cs);
    p01.appendChild(cover);

    // 2. Icon showcase at 24px
    const oldNote = p01.findOne(n => n.name === 'icon-setup-note');
    if (oldNote) oldNote.remove();
    const oldShowcase = p01.findOne(n => n.name === 'icon-showcase');
    if (oldShowcase) oldShowcase.remove();

    const iconComps = p01.findAll(n => n.type === 'COMPONENT' && n.name.startsWith('icon/'));
    const iconsBaseY = iconComps.length > 0 ? Math.min(...iconComps.map(c => c.y)) : 1800;

    const S24 = 'stroke="#B9B9C9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
    const H24 = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" ' + S24 + '>';
    const SHOW_SVGS = {
      'plus':          H24+'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      'minus':         H24+'<line x1="5" y1="12" x2="19" y2="12"/></svg>',
      'x':             H24+'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      'check':         H24+'<polyline points="20 6 9 17 4 12"/></svg>',
      'chevron-down':  H24+'<polyline points="6 9 12 15 18 9"/></svg>',
      'chevron-up':    H24+'<polyline points="18 15 12 9 6 15"/></svg>',
      'chevron-right': H24+'<polyline points="9 18 15 12 9 6"/></svg>',
      'chevron-left':  H24+'<polyline points="15 18 9 12 15 6"/></svg>',
      'arrow-up':      H24+'<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
      'arrow-down':    H24+'<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
      'search':        H24+'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      'settings':      H24+'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
      'eye':           H24+'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
      'lock':          H24+'<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      'unlock':        H24+'<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
      'trash':         H24+'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      'copy':          H24+'<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      'filter':        H24+'<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
      'save':          H24+'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
      'mic':           H24+'<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
      'monitor':       H24+'<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
      'camera':        H24+'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      'image':         H24+'<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      'video':         H24+'<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
      'music':         H24+'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      'drag':          '<svg width="24" height="24" viewBox="0 0 24 24" fill="#6C6C80" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>',
    };
    const ICON_ORDER = ['plus','minus','x','check','chevron-down','chevron-up','chevron-right','chevron-left','arrow-up','arrow-down','search','settings','eye','lock','unlock','trash','copy','filter','save','mic','monitor','camera','image','video','music','drag'];
    const COLS = 8, CW = 68, CH = 76, CGAP = 10;

    const showcase = figma.createFrame();
    showcase.name = 'icon-showcase';
    showcase.fills = solidPaint('#0D0D12');
    showcase.cornerRadius = 12;
    showcase.strokes = solidPaint('#2A2A3A'); showcase.strokeWeight = 1;
    applyAL(showcase, 'VERTICAL', 14, 20, 20);
    showcase.primaryAxisSizingMode = 'AUTO'; showcase.counterAxisSizingMode = 'AUTO';

    const sct = figma.createText();
    sct.fontName = { family: 'Inter', style: 'Semi Bold' }; sct.fontSize = 13;
    sct.characters = 'Icon Set  —  Lucide  (26 icons at 24px)'; sct.fills = solidPaint('#FFFFFF');
    showcase.appendChild(sct);
    const scs = figma.createText();
    scs.fontName = { family: 'Inter', style: 'Regular' }; scs.fontSize = 11;
    scs.characters = 'Use the 16×16 component instances in layouts  ·  change stroke color via Fills panel';
    scs.fills = solidPaint('#6C6C80'); showcase.appendChild(scs);

    for (let r = 0; r < Math.ceil(ICON_ORDER.length / COLS); r++) {
      const row = figma.createFrame();
      row.name = 'icon-row-' + r; row.fills = [];
      applyAL(row, 'HORIZONTAL', CGAP, 0, 0);
      row.primaryAxisSizingMode = 'AUTO'; row.counterAxisSizingMode = 'AUTO';
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        if (idx >= ICON_ORDER.length) break;
        const name = ICON_ORDER[idx];
        const card = figma.createFrame();
        card.name = 'ic/' + name; card.cornerRadius = 8;
        card.fills = solidPaint('#14141C');
        card.strokes = solidPaint('#2A2A3A'); card.strokeWeight = 1;
        applyAL(card, 'VERTICAL', 6, 10, 8);
        card.primaryAxisSizingMode = 'FIXED'; card.counterAxisSizingMode = 'FIXED';
        card.resize(CW, CH);
        card.primaryAxisAlignItems = 'CENTER'; card.counterAxisAlignItems = 'CENTER';
        const svgStr = SHOW_SVGS[name];
        if (svgStr) {
          const sv = figma.createNodeFromSvg(svgStr);
          sv.name = name; sv.resize(24, 24); card.appendChild(sv);
        }
        const lbl = figma.createText();
        lbl.fontName = { family: 'Inter', style: 'Regular' }; lbl.fontSize = 9;
        lbl.characters = name; lbl.fills = solidPaint('#6C6C80');
        lbl.textAlignHorizontal = 'CENTER'; card.appendChild(lbl);
        row.appendChild(card);
      }
      showcase.appendChild(row);
    }
    showcase.x = 0; showcase.y = iconsBaseY + 100;
    p01.appendChild(showcase);

    // 3. Section header chips for key groups
    function makeSectionTag(label, color, x, y) {
      const old2 = p01.findOne(n => n.name === 'sec-tag/' + label);
      if (old2) old2.remove();
      const tag = figma.createFrame();
      tag.name = 'sec-tag/' + label; tag.cornerRadius = 6;
      tag.fills = [{ type: 'SOLID', color: hexToRgb(color), opacity: 0.14 }];
      tag.strokes = solidPaint(color); tag.strokeWeight = 1;
      applyAL(tag, 'HORIZONTAL', 6, 10, 6);
      tag.primaryAxisSizingMode = 'AUTO'; tag.counterAxisSizingMode = 'AUTO';
      tag.counterAxisAlignItems = 'CENTER';
      const dot = figma.createRectangle(); dot.resize(6, 6); dot.cornerRadius = 999; dot.fills = solidPaint(color);
      tag.appendChild(dot);
      const t = figma.createText(); t.fontName = { family: 'Inter', style: 'Medium' }; t.fontSize = 11;
      t.characters = label; t.fills = solidPaint(color); tag.appendChild(t);
      tag.x = x; tag.y = y;
      p01.appendChild(tag);
    }
    // Place section tags above the major component areas
    const firstBtnComp = p01.findOne(n => n.type === 'COMPONENT_SET' && n.name === 'button/states');
    if (firstBtnComp) makeSectionTag('Components', '#8A5CFF', firstBtnComp.x, firstBtnComp.y - 30);
    const firstIcon = iconComps[0];
    if (firstIcon) makeSectionTag('Icon Components (16×16)', '#3DDC97', firstIcon.x, firstIcon.y - 30);
    makeSectionTag('Icon Showcase (24×24)', '#FFC857', showcase.x, showcase.y - 30);

    log('Page 01 enhanced — cover + showcase + section tags', 'ok');
    figma.viewport.scrollAndZoomIntoView([cover]);
  }

  // ── PAGE 03 ────────────────────────────────────────────────────────────────
  const p03 = figma.root.children.find(p => p.name.startsWith('03'));
  if (p03) {
    await figma.setCurrentPageAsync(p03);
    for (const fname of ['app/default', 'app/studio-mode', 'app/floating-windows']) {
      const fr = p03.findOne(n => n.name === fname);
      if (!fr) continue;
      const oldLbl = p03.findOne(n => n.name === 'lbl/' + fname);
      if (oldLbl) oldLbl.remove();
      const lbl = figma.createFrame();
      lbl.name = 'lbl/' + fname; lbl.fills = [];
      applyAL(lbl, 'HORIZONTAL', 8, 0, 0); lbl.primaryAxisSizingMode = 'AUTO'; lbl.counterAxisSizingMode = 'AUTO'; lbl.counterAxisAlignItems = 'CENTER';
      const d = figma.createRectangle(); d.resize(6, 6); d.cornerRadius = 999; d.fills = solidPaint('#8A5CFF'); lbl.appendChild(d);
      const lt = figma.createText(); lt.fontName = { family: 'Inter', style: 'Medium' }; lt.fontSize = 13; lt.characters = fname; lt.fills = solidPaint('#FFFFFF'); lbl.appendChild(lt);
      const dt = figma.createText(); dt.fontName = { family: 'Inter', style: 'Regular' }; dt.fontSize = 11; dt.characters = '1440 × 900px'; dt.fills = solidPaint('#6C6C80'); lbl.appendChild(dt);
      lbl.x = fr.x; lbl.y = fr.y - 32;
      p03.appendChild(lbl);
    }
    log('Page 03 frame labels added', 'ok');
  }

  figma.ui.postMessage({ type: 'ENHANCE_DONE' });
}

// ─── buildRealIcons ───────────────────────────────────────────────────────────
// Replaces the 16×16 placeholder frames with real Lucide SVG icon geometry
// using figma.createNodeFromSvg() — the high-level API that handles strokes.
async function buildRealIcons() {
  const page = figma.root.children.find(p => p.name.startsWith('01'));
  if (!page) { log('Page 01 not found', 'warn'); figma.ui.postMessage({ type: 'ICONS_DONE', count: 0 }); return; }
  await figma.setCurrentPageAsync(page);

  // Common SVG header — 16×16 render of a 24×24 Lucide viewBox
  const S  = 'stroke="#B9B9C9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const HD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" ' + S + '>';

  const ICON_SVGS = {
    'plus':          HD + '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    'minus':         HD + '<line x1="5" y1="12" x2="19" y2="12"/></svg>',
    'x':             HD + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    'check':         HD + '<polyline points="20 6 9 17 4 12"/></svg>',
    'chevron-down':  HD + '<polyline points="6 9 12 15 18 9"/></svg>',
    'chevron-up':    HD + '<polyline points="18 15 12 9 6 15"/></svg>',
    'chevron-right': HD + '<polyline points="9 18 15 12 9 6"/></svg>',
    'chevron-left':  HD + '<polyline points="15 18 9 12 15 6"/></svg>',
    'arrow-up':      HD + '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    'arrow-down':    HD + '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
    'search':        HD + '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    'settings':      HD + '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    'eye':           HD + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    'lock':          HD + '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    'unlock':        HD + '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
    'trash':         HD + '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    'copy':          HD + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    'filter':        HD + '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    'save':          HD + '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    'mic':           HD + '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    'monitor':       HD + '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    'camera':        HD + '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    'image':         HD + '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    'video':         HD + '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    'music':         HD + '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    'drag':          '<svg width="16" height="16" viewBox="0 0 24 24" fill="#B9B9C9" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>',
  };

  let replaced = 0, skipped = 0;
  for (const [name, svgStr] of Object.entries(ICON_SVGS)) {
    const comp = page.findOne(n => n.type === 'COMPONENT' && n.name === 'icon/' + name);
    if (!comp) { log('icon/' + name + ' not found — skipping', 'warn'); skipped++; continue; }

    // Clear placeholder styling
    for (const child of [...comp.children]) child.remove();
    comp.fills = [];
    comp.strokes = [];
    comp.cornerRadius = 0;

    // Build real icon from SVG
    const svgNode = figma.createNodeFromSvg(svgStr);
    svgNode.name = name;
    svgNode.resize(16, 16);
    svgNode.x = 0; svgNode.y = 0;
    comp.appendChild(svgNode);
    replaced++;
  }

  // Update the note card on page
  const note = page.findOne(n => n.name === 'icon-setup-note');
  if (note) {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const texts = note.findAll(n => n.type === 'TEXT');
    if (texts[0]) { texts[0].characters = '✓ Icons replaced with Lucide SVG (' + replaced + '/26)'; texts[0].fills = solidPaint('#3DDC97'); }
    if (texts[1]) { texts[1].characters = 'Tip: select a component → Fills → change stroke colour'; texts[1].fills = solidPaint('#6C6C80'); }
    note.strokes = solidPaint('#3DDC97');
  }

  figma.viewport.scrollAndZoomIntoView(page.findAll(n => n.type === 'COMPONENT' && n.name.startsWith('icon/')));
  log(replaced + '/26 icons replaced with Lucide SVG' + (skipped ? ' (' + skipped + ' skipped)' : ''), 'ok');
  figma.ui.postMessage({ type: 'ICONS_DONE', count: replaced });
}

// ─── Feature Components (9 OBS feature areas) ────────────────────────────────
async function buildFeatureComponents() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  const page = figma.root.children.find(p => p.name === '02 — Panels, Menus & Modals');
  if (!page) {
    figma.ui.postMessage({ type: 'FEATURES_ERROR', error: 'Page "02 — Panels, Menus & Modals" not found — run Build first' });
    return;
  }
  await page.loadAsync();

  const BG='#0B0B0F', SURF='#14141C', PNL='#1C1C27', DIV='#2A2A3A';
  const TXT='#FFFFFF', TXT2='#B9B9C9', MUT='#6C6C80';
  const ACC='#8A5CFF', DANGER='#FF5470', SUCCESS='#3DDC97';

  // ── Text helper
  async function T(chars, size, wt, color) {
    const t = figma.createText();
    t.fontName = { family: 'Inter', style: wt || 'Regular' };
    t.fontSize = size || 12;
    t.characters = String(chars);
    t.fills = solidPaint(color || TXT2);
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    return t;
  }

  // ── Rectangle
  function R(w, h, fill, r) {
    const rect = figma.createRectangle();
    rect.resize(w, h);
    rect.fills = fill ? solidPaint(fill) : [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0 }];
    if (r) rect.cornerRadius = r;
    return rect;
  }

  // ── Fixed frame with no layout (for slider tracks etc.)
  function fixedFrame(w, h, fill, r) {
    const f = figma.createFrame();
    f.resize(w, h);
    f.fills = fill ? solidPaint(fill) : [];
    if (r) f.cornerRadius = r;
    return f;
  }

  // ── Modal container
  function makeModal(name, w, h) {
    const f = figma.createFrame();
    f.name = name; f.resize(w, h);
    f.fills = solidPaint(PNL); f.cornerRadius = 12;
    f.effects = [{ type: 'DROP_SHADOW', offset: { x: 0, y: 24 }, radius: 64, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.65 }, blendMode: 'NORMAL', visible: true }];
    f.strokes = solidPaint(DIV); f.strokeWeight = 1; f.strokeAlign = 'INSIDE';
    applyAL(f, 'VERTICAL', 0, 0, 0);
    f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
    f.clipsContent = true;
    return f;
  }

  // ── Title bar
  async function titleBar(w, title) {
    const bar = figma.createFrame(); bar.name = 'titlebar';
    bar.resize(w, 48); bar.fills = solidPaint(SURF);
    bar.strokes = solidPaint(DIV); bar.strokeWeight = 1; bar.strokeAlign = 'INSIDE';
    applyAL(bar, 'HORIZONTAL', 0, 16, 0);
    bar.primaryAxisSizingMode = 'FIXED'; bar.counterAxisSizingMode = 'FIXED';
    bar.primaryAxisAlignItems = 'SPACE_BETWEEN'; bar.counterAxisAlignItems = 'CENTER';
    bar.appendChild(await T(title, 14, 'Medium', TXT));
    const closeBtn = figma.createFrame(); closeBtn.name = 'close'; closeBtn.resize(24, 24); closeBtn.cornerRadius = 4;
    closeBtn.fills = solidPaint(PNL);
    applyAL(closeBtn, 'HORIZONTAL', 0, 0, 0);
    closeBtn.primaryAxisAlignItems = 'CENTER'; closeBtn.counterAxisAlignItems = 'CENTER';
    closeBtn.primaryAxisSizingMode = 'FIXED'; closeBtn.counterAxisSizingMode = 'FIXED';
    closeBtn.appendChild(R(10, 10, MUT, 2));
    bar.appendChild(closeBtn);
    return bar;
  }

  // ── Content area (scrollable body)
  function bodyArea(w, h) {
    const c = figma.createFrame(); c.name = 'body';
    c.resize(w, h); c.fills = [];
    applyAL(c, 'VERTICAL', 10, 20, 14);
    c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'FIXED';
    c.primaryAxisAlignItems = 'MIN'; c.clipsContent = true;
    return c;
  }

  // ── Footer bar
  async function footerBar(w, confirmLabel, isDanger) {
    const f = figma.createFrame(); f.name = 'footer'; f.resize(w, 52);
    f.fills = solidPaint(SURF); f.strokes = solidPaint(DIV); f.strokeWeight = 1; f.strokeAlign = 'INSIDE';
    applyAL(f, 'HORIZONTAL', 8, 16, 0);
    f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
    f.primaryAxisAlignItems = 'MAX'; f.counterAxisAlignItems = 'CENTER';
    const cancelBtn = figma.createFrame(); cancelBtn.name = 'btn-cancel'; cancelBtn.resize(80, 32); cancelBtn.cornerRadius = 6;
    cancelBtn.fills = solidPaint(PNL); cancelBtn.strokes = solidPaint(DIV); cancelBtn.strokeWeight = 1; cancelBtn.strokeAlign = 'INSIDE';
    applyAL(cancelBtn, 'HORIZONTAL', 0, 0, 0); cancelBtn.primaryAxisAlignItems = 'CENTER'; cancelBtn.counterAxisAlignItems = 'CENTER';
    cancelBtn.primaryAxisSizingMode = 'FIXED'; cancelBtn.counterAxisSizingMode = 'FIXED';
    cancelBtn.appendChild(await T('Cancel', 12, 'Regular', TXT2));
    const confirmBtn = figma.createFrame(); confirmBtn.name = 'btn-confirm'; confirmBtn.resize(isDanger ? 90 : 80, 32); confirmBtn.cornerRadius = 6;
    confirmBtn.fills = isDanger ? solidPaint(DANGER) : accentGradient();
    applyAL(confirmBtn, 'HORIZONTAL', 0, 0, 0); confirmBtn.primaryAxisAlignItems = 'CENTER'; confirmBtn.counterAxisAlignItems = 'CENTER';
    confirmBtn.primaryAxisSizingMode = 'FIXED'; confirmBtn.counterAxisSizingMode = 'FIXED';
    confirmBtn.appendChild(await T(confirmLabel || 'OK', 12, 'Medium', TXT));
    f.appendChild(cancelBtn); f.appendChild(confirmBtn);
    return f;
  }

  // ── Section header
  async function secHdr(w, text) {
    const f = figma.createFrame(); f.name = 'sec-hdr'; f.fills = []; f.resize(w, 22);
    applyAL(f, 'HORIZONTAL', 8, 0, 0); f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED'; f.counterAxisAlignItems = 'CENTER';
    const bar = R(3, 14, ACC, 999); f.appendChild(bar);
    f.appendChild(await T(text, 11, 'Medium', TXT));
    return f;
  }

  // ── Divider
  function divLine(w) { return R(w, 1, DIV); }

  // ── Form row: label + input/dropdown/toggle/path
  async function frow(w, label, type, val) {
    const LBLW = 170; const INPW = w - LBLW - 8;
    const row = figma.createFrame(); row.name = 'frow'; row.fills = [];
    applyAL(row, 'HORIZONTAL', 8, 0, 0);
    row.primaryAxisSizingMode = 'FIXED'; row.counterAxisSizingMode = 'AUTO';
    row.counterAxisAlignItems = 'CENTER';
    const lblF = fixedFrame(LBLW, 22, null); lblF.fills = [];
    applyAL(lblF, 'HORIZONTAL', 0, 0, 0); lblF.primaryAxisSizingMode = 'FIXED'; lblF.counterAxisSizingMode = 'FIXED';
    lblF.counterAxisAlignItems = 'CENTER';
    lblF.appendChild(await T(label, 12, 'Regular', TXT2));
    row.appendChild(lblF);
    const inp = figma.createFrame(); inp.name = 'inp'; inp.cornerRadius = 6;
    if (type === 'toggle') {
      inp.fills = []; inp.strokes = []; inp.strokeWeight = 0;
      applyAL(inp, 'HORIZONTAL', 8, 0, 0); inp.primaryAxisSizingMode = 'AUTO'; inp.counterAxisSizingMode = 'AUTO'; inp.counterAxisAlignItems = 'CENTER';
      const track = figma.createFrame(); track.resize(32, 18); track.cornerRadius = 999;
      track.fills = solidPaint(val ? ACC : DIV);
      applyAL(track, 'HORIZONTAL', 0, val ? 14 : 2, 0); track.primaryAxisSizingMode = 'FIXED'; track.counterAxisSizingMode = 'FIXED'; track.counterAxisAlignItems = 'CENTER';
      const thumb = figma.createEllipse(); thumb.resize(14, 14); thumb.fills = solidPaint(TXT); track.appendChild(thumb);
      inp.appendChild(track);
    } else if (type === 'path') {
      inp.fills = solidPaint(SURF); inp.strokes = solidPaint(DIV); inp.strokeWeight = 1; inp.strokeAlign = 'INSIDE';
      inp.resize(INPW, 28); applyAL(inp, 'HORIZONTAL', 4, 8, 0); inp.primaryAxisSizingMode = 'FIXED'; inp.counterAxisSizingMode = 'FIXED'; inp.counterAxisAlignItems = 'CENTER'; inp.primaryAxisAlignItems = 'SPACE_BETWEEN';
      inp.appendChild(await T(val || 'C:\\Path\\file', 11, 'Regular', MUT));
      const browseBtn = figma.createFrame(); browseBtn.resize(54, 20); browseBtn.cornerRadius = 4;
      browseBtn.fills = solidPaint(PNL); browseBtn.strokes = solidPaint(DIV); browseBtn.strokeWeight = 1; browseBtn.strokeAlign = 'INSIDE';
      applyAL(browseBtn, 'HORIZONTAL', 0, 0, 0); browseBtn.primaryAxisAlignItems = 'CENTER'; browseBtn.counterAxisAlignItems = 'CENTER'; browseBtn.primaryAxisSizingMode = 'FIXED'; browseBtn.counterAxisSizingMode = 'FIXED';
      browseBtn.appendChild(await T('Browse', 11, 'Regular', TXT2)); inp.appendChild(browseBtn);
    } else if (type === 'dropdown') {
      inp.fills = solidPaint(SURF); inp.strokes = solidPaint(DIV); inp.strokeWeight = 1; inp.strokeAlign = 'INSIDE';
      inp.resize(INPW, 28); applyAL(inp, 'HORIZONTAL', 4, 8, 0); inp.primaryAxisSizingMode = 'FIXED'; inp.counterAxisSizingMode = 'FIXED'; inp.counterAxisAlignItems = 'CENTER'; inp.primaryAxisAlignItems = 'SPACE_BETWEEN';
      inp.appendChild(await T(val || 'Select…', 12, 'Regular', TXT));
      inp.appendChild(R(5, 4, MUT, 1));
    } else {
      // text / number input
      inp.fills = solidPaint(SURF); inp.strokes = solidPaint(DIV); inp.strokeWeight = 1; inp.strokeAlign = 'INSIDE';
      inp.resize(INPW, 28); applyAL(inp, 'HORIZONTAL', 0, 10, 0); inp.primaryAxisSizingMode = 'FIXED'; inp.counterAxisSizingMode = 'FIXED'; inp.counterAxisAlignItems = 'CENTER';
      inp.appendChild(await T(val || '', 12, 'Regular', TXT));
    }
    row.appendChild(inp);
    return row;
  }

  // ── Slider row: label + track + value chip
  async function slrow(w, label, pct) {
    const LBLW = 160; const SLIDERW = w - LBLW - 52 - 16; const p = Math.max(0, Math.min(1, pct || 0.5));
    const row = figma.createFrame(); row.name = 'slider-row'; row.fills = [];
    applyAL(row, 'HORIZONTAL', 8, 0, 3); row.primaryAxisSizingMode = 'FIXED'; row.counterAxisSizingMode = 'AUTO'; row.counterAxisAlignItems = 'CENTER';
    const lblF = fixedFrame(LBLW, 18, null); lblF.fills = [];
    applyAL(lblF, 'HORIZONTAL', 0, 0, 0); lblF.primaryAxisSizingMode = 'FIXED'; lblF.counterAxisSizingMode = 'FIXED';
    lblF.appendChild(await T(label, 12, 'Regular', TXT2));
    row.appendChild(lblF);
    // Track (no auto layout, children are absolute)
    const track = fixedFrame(SLIDERW, 4, DIV, 999);
    const fillW = Math.max(2, Math.round(SLIDERW * p));
    const fill = R(fillW, 4, null, 999); fill.fills = accentGradient();
    track.appendChild(fill);
    row.appendChild(track);
    // Value chip
    const chip = figma.createFrame(); chip.name = 'val'; chip.resize(44, 22); chip.cornerRadius = 4;
    chip.fills = solidPaint(SURF); chip.strokes = solidPaint(DIV); chip.strokeWeight = 1; chip.strokeAlign = 'INSIDE';
    applyAL(chip, 'HORIZONTAL', 0, 0, 0); chip.primaryAxisAlignItems = 'CENTER'; chip.counterAxisAlignItems = 'CENTER'; chip.primaryAxisSizingMode = 'FIXED'; chip.counterAxisSizingMode = 'FIXED';
    chip.appendChild(await T(Math.round(p * 100) + '%', 11, 'Regular', TXT));
    row.appendChild(chip);
    return row;
  }

  // ── List item
  async function listItem(w, label, selected) {
    const f = figma.createFrame(); f.name = 'list-item'; f.resize(w, 34);
    f.fills = selected ? [{ type: 'SOLID', color: hexToRgb(ACC), opacity: 0.15 }] : []; f.cornerRadius = 4;
    applyAL(f, 'HORIZONTAL', 8, 10, 0); f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED'; f.counterAxisAlignItems = 'CENTER';
    const dot = figma.createEllipse(); dot.resize(8, 8); dot.fills = solidPaint(selected ? SUCCESS : DIV); f.appendChild(dot);
    f.appendChild(await T(label, 12, selected ? 'Medium' : 'Regular', selected ? TXT : TXT2));
    return f;
  }

  // ── Source tile (for add-source grid)
  async function srcTile(label) {
    const f = figma.createFrame(); f.name = 'src-' + label.toLowerCase().replace(/\s+/g, '-');
    f.resize(136, 76); f.cornerRadius = 8; f.fills = solidPaint(SURF); f.strokes = solidPaint(DIV); f.strokeWeight = 1; f.strokeAlign = 'INSIDE';
    applyAL(f, 'VERTICAL', 6, 0, 10); f.primaryAxisAlignItems = 'CENTER'; f.counterAxisAlignItems = 'CENTER'; f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
    f.appendChild(R(22, 22, DIV, 5));
    f.appendChild(await T(label, 10, 'Regular', TXT2));
    return f;
  }

  // ── Pill / badge
  async function badge(text, color) {
    const f = figma.createFrame(); f.name = 'badge'; f.cornerRadius = 999;
    f.fills = [{ type: 'SOLID', color: hexToRgb(color || ACC), opacity: 0.2 }];
    applyAL(f, 'HORIZONTAL', 0, 8, 3); f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
    f.appendChild(await T(text, 9, 'Medium', color || ACC));
    return f;
  }

  // ─ Layout cursor ─────────────────────────────────────────────────────────────
  const GAP = 60;
  let cx = 40, cy = 2200;
  let created = 0;

  // ══════════════════════════════════════════════════════════════════════════════
  // ROW 1 — Add Source | Streaming Settings | Recording Settings
  // ══════════════════════════════════════════════════════════════════════════════

  // 1 ── modal/add-source ─────────────────────────────────────────────────────
  {
    const W = 640, H = 500;
    const m = makeModal('modal/add-source', W, H);
    m.appendChild(await titleBar(W, 'Add Source'));
    const body = bodyArea(W, H - 48 - 52);
    // Search bar
    const srch = figma.createFrame(); srch.name = 'search'; srch.resize(W - 40, 32); srch.cornerRadius = 8;
    srch.fills = solidPaint(SURF); srch.strokes = solidPaint(DIV); srch.strokeWeight = 1; srch.strokeAlign = 'INSIDE';
    applyAL(srch, 'HORIZONTAL', 8, 10, 0); srch.primaryAxisSizingMode = 'FIXED'; srch.counterAxisSizingMode = 'FIXED'; srch.counterAxisAlignItems = 'CENTER';
    srch.appendChild(R(14, 14, MUT, 3)); srch.appendChild(await T('Search sources…', 12, 'Regular', MUT));
    body.appendChild(srch);
    // Source grid
    const grid = figma.createFrame(); grid.name = 'source-grid'; grid.fills = [];
    grid.layoutMode = 'HORIZONTAL'; grid.layoutWrap = 'WRAP'; grid.itemSpacing = 10; grid.counterAxisSpacing = 10;
    grid.paddingLeft = grid.paddingRight = grid.paddingTop = grid.paddingBottom = 0;
    grid.primaryAxisSizingMode = 'FIXED'; grid.counterAxisSizingMode = 'AUTO'; grid.resize(W - 40, 300);
    const sources = ['Display Capture', 'Window Capture', 'Game Capture', 'Video Capture', 'Audio Input', 'Audio Output', 'Browser Source', 'Color Source', 'Image', 'Slideshow', 'Media Source', 'Scene', 'Text (GDI+)', 'VLC Video', 'RTSP Source', 'NDI Source'];
    for (const s of sources) grid.appendChild(await srcTile(s));
    body.appendChild(grid);
    m.appendChild(body); m.appendChild(await footerBar(W, 'Add Source'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 2 ── modal/streaming-settings ─────────────────────────────────────────────
  {
    const W = 640, H = 520;
    const m = makeModal('modal/streaming-settings', W, H);
    m.appendChild(await titleBar(W, 'Stream Settings'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await secHdr(W - 40, 'Service'));
    body.appendChild(await frow(W - 40, 'Service', 'dropdown', 'Twitch'));
    body.appendChild(await frow(W - 40, 'Server (Ingest)', 'dropdown', 'Auto (Recommended)'));
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Authentication'));
    body.appendChild(await frow(W - 40, 'Stream Key', 'path', '••••••••••••••••••••'));
    const linkRow = figma.createFrame(); linkRow.fills = []; applyAL(linkRow, 'HORIZONTAL', 0, 0, 2); linkRow.primaryAxisSizingMode = 'AUTO'; linkRow.counterAxisSizingMode = 'AUTO';
    linkRow.appendChild(await T('Get Stream Key  →', 11, 'Regular', ACC)); body.appendChild(linkRow);
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Encoder Settings'));
    body.appendChild(await frow(W - 40, 'Video Encoder', 'dropdown', 'NVIDIA NVENC H.264'));
    body.appendChild(await frow(W - 40, 'Rate Control', 'dropdown', 'CBR'));
    body.appendChild(await frow(W - 40, 'Bitrate (Kbps)', 'input', '6000'));
    body.appendChild(await frow(W - 40, 'Keyframe Interval', 'dropdown', '2s (recommended)'));
    body.appendChild(await frow(W - 40, 'Preset', 'dropdown', 'P5 – Slow, High Quality'));
    m.appendChild(body); m.appendChild(await footerBar(W, 'Apply'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 3 ── modal/recording-settings ─────────────────────────────────────────────
  {
    const W = 600, H = 500;
    const m = makeModal('modal/recording-settings', W, H);
    m.appendChild(await titleBar(W, 'Recording Settings'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await secHdr(W - 40, 'Output'));
    body.appendChild(await frow(W - 40, 'Recording Path', 'path', 'C:\\Users\\User\\Videos'));
    body.appendChild(await frow(W - 40, 'Recording Format', 'dropdown', 'MKV (.mkv)'));
    body.appendChild(await frow(W - 40, 'Video Encoder', 'dropdown', 'Hardware (NVENC H.264)'));
    body.appendChild(await frow(W - 40, 'Audio Encoder', 'dropdown', 'AAC 320 Kbps'));
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Audio Tracks'));
    const tracksRow = figma.createFrame(); tracksRow.fills = []; tracksRow.resize(W - 40, 32);
    applyAL(tracksRow, 'HORIZONTAL', 8, 0, 0); tracksRow.primaryAxisSizingMode = 'FIXED'; tracksRow.counterAxisSizingMode = 'FIXED'; tracksRow.counterAxisAlignItems = 'CENTER';
    for (let i = 1; i <= 6; i++) {
      const chip = figma.createFrame(); chip.resize(28, 28); chip.cornerRadius = 6;
      chip.fills = i <= 2 ? [{ type: 'SOLID', color: hexToRgb(ACC), opacity: 0.15 }] : solidPaint(SURF);
      chip.strokes = solidPaint(i <= 2 ? ACC : DIV); chip.strokeWeight = 1; chip.strokeAlign = 'INSIDE';
      applyAL(chip, 'HORIZONTAL', 0, 0, 0); chip.primaryAxisAlignItems = 'CENTER'; chip.counterAxisAlignItems = 'CENTER'; chip.primaryAxisSizingMode = 'FIXED'; chip.counterAxisSizingMode = 'FIXED';
      chip.appendChild(await T(String(i), 11, i <= 2 ? 'Medium' : 'Regular', i <= 2 ? TXT : MUT));
      tracksRow.appendChild(chip);
    }
    body.appendChild(tracksRow);
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Replay Buffer'));
    body.appendChild(await frow(W - 40, 'Enable Replay Buffer', 'toggle', false));
    body.appendChild(await frow(W - 40, 'Maximum Replay Time', 'input', '30 s'));
    body.appendChild(await frow(W - 40, 'Maximum Size (MB)', 'input', '512'));
    m.appendChild(body); m.appendChild(await footerBar(W, 'Apply'));
    m.x = cx; m.y = cy; page.appendChild(m); created++;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ROW 2 — Source Settings Modals
  // ══════════════════════════════════════════════════════════════════════════════
  cx = 40; cy += 580;

  // 4 ── modal/source/webcam ──────────────────────────────────────────────────
  {
    const W = 480, H = 420;
    const m = makeModal('modal/source/webcam', W, H);
    m.appendChild(await titleBar(W, 'Video Capture Device'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await frow(W - 40, 'Device', 'dropdown', 'HD Webcam C920'));
    body.appendChild(await frow(W - 40, 'Resolution', 'dropdown', '1920×1080'));
    body.appendChild(await frow(W - 40, 'Frame Rate', 'dropdown', '30 FPS'));
    body.appendChild(await frow(W - 40, 'Video Format', 'dropdown', 'YUY2'));
    body.appendChild(divLine(W - 40));
    body.appendChild(await frow(W - 40, 'Flip Horizontally', 'toggle', false));
    body.appendChild(await frow(W - 40, 'Flip Vertically', 'toggle', false));
    body.appendChild(await frow(W - 40, 'Color Range', 'dropdown', 'Default'));
    body.appendChild(await frow(W - 40, 'Color Space', 'dropdown', 'Default'));
    m.appendChild(body); m.appendChild(await footerBar(W, 'OK'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 5 ── modal/source/browser-source ─────────────────────────────────────────
  {
    const W = 520, H = 460;
    const m = makeModal('modal/source/browser-source', W, H);
    m.appendChild(await titleBar(W, 'Browser Source'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await frow(W - 40, 'URL', 'input', 'https://example.com/overlay'));
    body.appendChild(await frow(W - 40, 'Width', 'input', '1920'));
    body.appendChild(await frow(W - 40, 'Height', 'input', '1080'));
    body.appendChild(await frow(W - 40, 'FPS', 'input', '30'));
    body.appendChild(divLine(W - 40));
    const cssBox = figma.createFrame(); cssBox.name = 'css-box'; cssBox.resize(W - 40, 72); cssBox.cornerRadius = 6;
    cssBox.fills = solidPaint(SURF); cssBox.strokes = solidPaint(DIV); cssBox.strokeWeight = 1; cssBox.strokeAlign = 'INSIDE';
    applyAL(cssBox, 'VERTICAL', 2, 10, 8); cssBox.primaryAxisSizingMode = 'FIXED'; cssBox.counterAxisSizingMode = 'FIXED';
    cssBox.appendChild(await T('Custom CSS', 10, 'Regular', MUT));
    cssBox.appendChild(await T('body { background-color: rgba(0,0,0,0); }', 11, 'Regular', ACC));
    body.appendChild(cssBox);
    body.appendChild(divLine(W - 40));
    body.appendChild(await frow(W - 40, 'Shutdown when not visible', 'toggle', true));
    body.appendChild(await frow(W - 40, 'Refresh on scene activate', 'toggle', false));
    body.appendChild(await frow(W - 40, 'Use custom frame rate', 'toggle', false));
    m.appendChild(body); m.appendChild(await footerBar(W, 'OK'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 6 ── modal/source/display-capture ────────────────────────────────────────
  {
    const W = 480, H = 360;
    const m = makeModal('modal/source/display-capture', W, H);
    m.appendChild(await titleBar(W, 'Display Capture'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await frow(W - 40, 'Display', 'dropdown', 'Display 1: 1920×1080'));
    body.appendChild(await frow(W - 40, 'Capture Method', 'dropdown', 'Windows DXGI'));
    body.appendChild(await frow(W - 40, 'Capture Cursor', 'toggle', true));
    body.appendChild(divLine(W - 40));
    const prev = R(W - 40, 130, BG, 6); prev.strokes = solidPaint(DIV); prev.strokeWeight = 1; prev.strokeAlign = 'INSIDE';
    body.appendChild(prev);
    m.appendChild(body); m.appendChild(await footerBar(W, 'OK'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 7 ── modal/source/media-source ───────────────────────────────────────────
  {
    const W = 480, H = 420;
    const m = makeModal('modal/source/media-source', W, H);
    m.appendChild(await titleBar(W, 'Media Source'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await frow(W - 40, 'Local File', 'path', 'C:\\Videos\\intro.mp4'));
    body.appendChild(await frow(W - 40, 'Loop', 'toggle', true));
    body.appendChild(await frow(W - 40, 'Restart on scene activate', 'toggle', false));
    body.appendChild(await frow(W - 40, 'Pause when not visible', 'toggle', false));
    body.appendChild(divLine(W - 40));
    body.appendChild(await frow(W - 40, 'Playback Speed (%)', 'input', '100'));
    body.appendChild(await frow(W - 40, 'Use hardware decoding', 'toggle', true));
    body.appendChild(await frow(W - 40, 'Audio Track', 'dropdown', 'Track 1'));
    body.appendChild(await frow(W - 40, 'Color Range', 'dropdown', 'Auto'));
    m.appendChild(body); m.appendChild(await footerBar(W, 'OK'));
    m.x = cx; m.y = cy; page.appendChild(m); created++;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ROW 3 — Audio Filters | Chroma Key | Color Correction
  // ══════════════════════════════════════════════════════════════════════════════
  cx = 40; cy += 500;

  // 8 ── modal/audio-filters ─────────────────────────────────────────────────
  {
    const W = 700, H = 540, SPLIT_H = H - 48 - 52;
    const m = makeModal('modal/audio-filters', W, H);
    m.appendChild(await titleBar(W, 'Audio Filters — Mic/Aux'));
    // Split body
    const split = figma.createFrame(); split.name = 'split-body'; split.fills = [];
    split.resize(W, SPLIT_H); applyAL(split, 'HORIZONTAL', 0, 0, 0); split.primaryAxisSizingMode = 'FIXED'; split.counterAxisSizingMode = 'FIXED';
    // Left: filter list
    const fl = figma.createFrame(); fl.name = 'filter-list'; fl.resize(220, SPLIT_H); fl.fills = solidPaint(SURF);
    applyAL(fl, 'VERTICAL', 2, 0, 6); fl.primaryAxisSizingMode = 'FIXED'; fl.counterAxisSizingMode = 'FIXED';
    const ltb = figma.createFrame(); ltb.name = 'toolbar'; ltb.resize(220, 36); ltb.fills = solidPaint(BG);
    applyAL(ltb, 'HORIZONTAL', 4, 8, 0); ltb.primaryAxisSizingMode = 'FIXED'; ltb.counterAxisSizingMode = 'FIXED'; ltb.counterAxisAlignItems = 'CENTER';
    ltb.appendChild(await T('Filters', 12, 'Medium', TXT));
    ltb.appendChild(R(60, 1, null)); // spacer
    for (const ico of ['+', '−']) {
      const b = figma.createFrame(); b.resize(22, 22); b.cornerRadius = 4; b.fills = solidPaint(PNL);
      applyAL(b, 'HORIZONTAL', 0, 0, 0); b.primaryAxisAlignItems = 'CENTER'; b.counterAxisAlignItems = 'CENTER'; b.primaryAxisSizingMode = 'FIXED'; b.counterAxisSizingMode = 'FIXED';
      b.appendChild(R(8, 8, TXT2)); ltb.appendChild(b);
    }
    fl.appendChild(ltb);
    const audioFilters = [{ n: 'Noise Suppression', on: true }, { n: 'Compressor', on: false }, { n: 'Noise Gate', on: false }, { n: 'Limiter', on: false }, { n: 'Gain', on: false }, { n: 'Expander', on: false }, { n: 'VST 2.x Plugin', on: false }];
    for (const af of audioFilters) {
      const it = figma.createFrame(); it.name = af.n; it.resize(220, 34);
      it.fills = af.on ? [{ type: 'SOLID', color: hexToRgb(ACC), opacity: 0.15 }] : []; it.cornerRadius = 4;
      applyAL(it, 'HORIZONTAL', 8, 10, 0); it.primaryAxisSizingMode = 'FIXED'; it.counterAxisSizingMode = 'FIXED'; it.counterAxisAlignItems = 'CENTER';
      const dot = figma.createEllipse(); dot.resize(8, 8); dot.fills = solidPaint(af.on ? SUCCESS : DIV); it.appendChild(dot);
      it.appendChild(await T(af.n, 12, af.on ? 'Medium' : 'Regular', af.on ? TXT : TXT2));
      fl.appendChild(it);
    }
    split.appendChild(fl); split.appendChild(R(1, SPLIT_H, DIV));
    // Right: active filter props
    const fp = figma.createFrame(); fp.name = 'filter-props'; fp.resize(W - 221, SPLIT_H); fp.fills = [];
    applyAL(fp, 'VERTICAL', 10, 18, 14); fp.primaryAxisSizingMode = 'FIXED'; fp.counterAxisSizingMode = 'FIXED';
    fp.appendChild(await secHdr(W - 261, 'Noise Suppression'));
    fp.appendChild(await frow(W - 261, 'Method', 'dropdown', 'NVIDIA RTX Voice (AI)'));
    fp.appendChild(divLine(W - 261));
    fp.appendChild(await secHdr(W - 261, 'Parameters'));
    fp.appendChild(await slrow(W - 261, 'Suppression Level', 0.75));
    fp.appendChild(await slrow(W - 261, 'Voice Activity Detection', 0.6));
    fp.appendChild(divLine(W - 261));
    fp.appendChild(await frow(W - 261, 'Enable', 'toggle', true));
    split.appendChild(fp);
    m.appendChild(split); m.appendChild(await footerBar(W, 'Close'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 9 ── modal/filter/chroma-key ─────────────────────────────────────────────
  {
    const W = 520, H = 480;
    const m = makeModal('modal/filter/chroma-key', W, H);
    m.appendChild(await titleBar(W, 'Filter: Chroma Key'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await frow(W - 40, 'Key Color Type', 'dropdown', 'Green'));
    // Color swatch row
    const colorRow = figma.createFrame(); colorRow.fills = []; applyAL(colorRow, 'HORIZONTAL', 12, 0, 2); colorRow.primaryAxisSizingMode = 'AUTO'; colorRow.counterAxisSizingMode = 'AUTO'; colorRow.counterAxisAlignItems = 'CENTER';
    colorRow.appendChild(await T('Key Color', 12, 'Regular', TXT2));
    const swatch = R(48, 28, '#00CC44', 6); swatch.strokes = solidPaint(DIV); swatch.strokeWeight = 1; swatch.strokeAlign = 'INSIDE';
    colorRow.appendChild(swatch); body.appendChild(colorRow);
    body.appendChild(divLine(W - 40));
    body.appendChild(await slrow(W - 40, 'Similarity', 0.40));
    body.appendChild(await slrow(W - 40, 'Smoothness', 0.25));
    body.appendChild(await slrow(W - 40, 'Key Color Spill Reduction', 0.10));
    body.appendChild(await slrow(W - 40, 'Opacity', 1.0));
    body.appendChild(divLine(W - 40));
    body.appendChild(await slrow(W - 40, 'Contrast', 0.5));
    body.appendChild(await slrow(W - 40, 'Brightness', 0.5));
    body.appendChild(await slrow(W - 40, 'Gamma', 0.5));
    m.appendChild(body); m.appendChild(await footerBar(W, 'Close'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 10 ── modal/filter/color-correction ──────────────────────────────────────
  {
    const W = 520, H = 460;
    const m = makeModal('modal/filter/color-correction', W, H);
    m.appendChild(await titleBar(W, 'Filter: Color Correction'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await secHdr(W - 40, 'Tone'));
    body.appendChild(await slrow(W - 40, 'Gamma', 0.50));
    body.appendChild(await slrow(W - 40, 'Contrast', 0.50));
    body.appendChild(await slrow(W - 40, 'Brightness', 0.50));
    body.appendChild(await slrow(W - 40, 'Saturation', 0.60));
    body.appendChild(await slrow(W - 40, 'Hue Shift', 0.50));
    body.appendChild(await slrow(W - 40, 'Opacity', 1.00));
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Color Add'));
    body.appendChild(await slrow(W - 40, 'Red', 0.50));
    body.appendChild(await slrow(W - 40, 'Green', 0.50));
    body.appendChild(await slrow(W - 40, 'Blue', 0.50));
    body.appendChild(await slrow(W - 40, 'Alpha', 1.00));
    m.appendChild(body); m.appendChild(await footerBar(W, 'Close'));
    m.x = cx; m.y = cy; page.appendChild(m); created++;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ROW 4 — Crop/Pad | Transform | Multiview
  // ══════════════════════════════════════════════════════════════════════════════
  cx = 40; cy += 560;

  // 11 ── modal/filter/crop-pad ──────────────────────────────────────────────
  {
    const W = 480, H = 400;
    const m = makeModal('modal/filter/crop-pad', W, H);
    m.appendChild(await titleBar(W, 'Filter: Crop/Pad'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await frow(W - 40, 'Relative', 'toggle', false));
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Crop'));
    body.appendChild(await frow(W - 40, 'Top (px)', 'input', '0'));
    body.appendChild(await frow(W - 40, 'Bottom (px)', 'input', '0'));
    body.appendChild(await frow(W - 40, 'Left (px)', 'input', '0'));
    body.appendChild(await frow(W - 40, 'Right (px)', 'input', '0'));
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Pad'));
    body.appendChild(await frow(W - 40, 'Top (px)', 'input', '0'));
    body.appendChild(await frow(W - 40, 'Left (px)', 'input', '0'));
    m.appendChild(body); m.appendChild(await footerBar(W, 'Close'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 12 ── modal/transform ────────────────────────────────────────────────────
  {
    const W = 520, H = 540;
    const m = makeModal('modal/transform', W, H);
    m.appendChild(await titleBar(W, 'Edit Transform'));
    const body = bodyArea(W, H - 48 - 52);
    body.appendChild(await secHdr(W - 40, 'Position & Size'));
    body.appendChild(await frow(W - 40, 'Position X', 'input', '0.0'));
    body.appendChild(await frow(W - 40, 'Position Y', 'input', '0.0'));
    body.appendChild(await frow(W - 40, 'Width', 'input', '1920'));
    body.appendChild(await frow(W - 40, 'Height', 'input', '1080'));
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Rotation'));
    body.appendChild(await frow(W - 40, 'Rotation (°)', 'input', '0.0'));
    body.appendChild(await frow(W - 40, 'Bounding Box Type', 'dropdown', 'No bounds'));
    body.appendChild(divLine(W - 40));
    // Alignment 3×3 grid
    const alignRow = figma.createFrame(); alignRow.fills = []; applyAL(alignRow, 'HORIZONTAL', 10, 0, 2); alignRow.primaryAxisSizingMode = 'AUTO'; alignRow.counterAxisSizingMode = 'AUTO'; alignRow.counterAxisAlignItems = 'CENTER';
    alignRow.appendChild(await T('Alignment', 12, 'Regular', TXT2));
    const grid3 = figma.createFrame(); grid3.fills = solidPaint(SURF); grid3.cornerRadius = 6; grid3.strokes = solidPaint(DIV); grid3.strokeWeight = 1; grid3.strokeAlign = 'INSIDE';
    grid3.layoutMode = 'HORIZONTAL'; grid3.layoutWrap = 'WRAP'; grid3.itemSpacing = 2; grid3.counterAxisSpacing = 2;
    grid3.paddingLeft = grid3.paddingRight = grid3.paddingTop = grid3.paddingBottom = 4;
    grid3.primaryAxisSizingMode = 'AUTO'; grid3.counterAxisSizingMode = 'AUTO';
    for (let i = 0; i < 9; i++) { const cell = R(16, 16, i === 4 ? ACC : PNL, 3); grid3.appendChild(cell); }
    alignRow.appendChild(grid3); body.appendChild(alignRow);
    body.appendChild(divLine(W - 40));
    body.appendChild(await secHdr(W - 40, 'Crop'));
    body.appendChild(await frow(W - 40, 'Left', 'input', '0'));
    body.appendChild(await frow(W - 40, 'Right', 'input', '0'));
    body.appendChild(await frow(W - 40, 'Top', 'input', '0'));
    body.appendChild(await frow(W - 40, 'Bottom', 'input', '0'));
    m.appendChild(body); m.appendChild(await footerBar(W, 'Reset'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 13 ── panel/multiview ────────────────────────────────────────────────────
  {
    const W = 840, H = 520, GRID_H = H - 48;
    const m = makeModal('panel/multiview', W, H);
    m.appendChild(await titleBar(W, 'Multiview'));
    const grid = figma.createFrame(); grid.name = 'scene-grid'; grid.fills = solidPaint(BG);
    grid.resize(W, GRID_H); grid.layoutMode = 'HORIZONTAL'; grid.layoutWrap = 'WRAP';
    grid.itemSpacing = 4; grid.counterAxisSpacing = 4;
    grid.paddingLeft = grid.paddingRight = grid.paddingTop = grid.paddingBottom = 8;
    grid.primaryAxisSizingMode = 'FIXED'; grid.counterAxisSizingMode = 'FIXED';
    const TW = Math.floor((W - 16 - 12) / 4); const TH = Math.floor((GRID_H - 16 - 4) / 2);
    const sceneData = [
      { label: 'Scene 1', tag: 'PREVIEW', border: SUCCESS },
      { label: 'Scene 2', tag: 'LIVE', border: DANGER },
      { label: 'Scene 3', tag: null, border: DIV },
      { label: 'Scene 4', tag: null, border: DIV },
      { label: 'Scene 5', tag: null, border: DIV },
      { label: 'Scene 6', tag: null, border: DIV },
      { label: 'Scene 7', tag: null, border: DIV },
      { label: 'Scene 8', tag: null, border: DIV },
    ];
    for (const s of sceneData) {
      const tile = figma.createFrame(); tile.name = s.label; tile.resize(TW, TH); tile.cornerRadius = 6;
      tile.fills = solidPaint(SURF); tile.strokes = solidPaint(s.border); tile.strokeWeight = s.tag ? 2 : 1; tile.strokeAlign = 'INSIDE';
      applyAL(tile, 'VERTICAL', 6, 0, 8); tile.primaryAxisAlignItems = 'CENTER'; tile.counterAxisAlignItems = 'CENTER'; tile.primaryAxisSizingMode = 'FIXED'; tile.counterAxisSizingMode = 'FIXED';
      tile.appendChild(R(TW - 16, Math.floor(TH * 0.65), BG, 4));
      tile.appendChild(await T(s.label, 10, 'Medium', TXT));
      if (s.tag) tile.appendChild(await badge(s.tag, s.border));
      grid.appendChild(tile);
    }
    m.appendChild(grid);
    m.x = cx; m.y = cy; page.appendChild(m); created++;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ROW 5 — Full Hotkeys | Source Filters
  // ══════════════════════════════════════════════════════════════════════════════
  cx = 40; cy += 600;

  // 14 ── modal/hotkeys-full ─────────────────────────────────────────────────
  {
    const W = 800, H = 560, SPLIT_H = H - 48 - 52;
    const m = makeModal('modal/hotkeys-full', W, H);
    m.appendChild(await titleBar(W, 'Hotkeys'));
    const split = figma.createFrame(); split.name = 'split-body'; split.fills = [];
    split.resize(W, SPLIT_H); applyAL(split, 'HORIZONTAL', 0, 0, 0); split.primaryAxisSizingMode = 'FIXED'; split.counterAxisSizingMode = 'FIXED';
    // Left sidebar categories
    const sb = figma.createFrame(); sb.name = 'categories'; sb.resize(180, SPLIT_H); sb.fills = solidPaint(SURF);
    applyAL(sb, 'VERTICAL', 2, 0, 8); sb.primaryAxisSizingMode = 'FIXED'; sb.counterAxisSizingMode = 'FIXED';
    const hkCats = ['General', 'Scenes', 'Sources', 'Audio Mixer', 'Streaming', 'Recording', 'Virtual Camera', 'Replay Buffer'];
    for (let i = 0; i < hkCats.length; i++) {
      const cat = figma.createFrame(); cat.name = hkCats[i]; cat.resize(180, 32); cat.cornerRadius = 4;
      cat.fills = i === 0 ? [{ type: 'SOLID', color: hexToRgb(ACC), opacity: 0.15 }] : [];
      applyAL(cat, 'HORIZONTAL', 8, 12, 0); cat.primaryAxisSizingMode = 'FIXED'; cat.counterAxisSizingMode = 'FIXED'; cat.counterAxisAlignItems = 'CENTER';
      if (i === 0) { const bar = R(3, 14, ACC, 999); cat.appendChild(bar); }
      cat.appendChild(await T(hkCats[i], 12, i === 0 ? 'Medium' : 'Regular', i === 0 ? TXT : TXT2));
      sb.appendChild(cat);
    }
    split.appendChild(sb); split.appendChild(R(1, SPLIT_H, DIV));
    // Right: hotkey table
    const tbl = figma.createFrame(); tbl.name = 'table'; tbl.resize(W - 181, SPLIT_H); tbl.fills = [];
    applyAL(tbl, 'VERTICAL', 0, 14, 8); tbl.primaryAxisSizingMode = 'FIXED'; tbl.counterAxisSizingMode = 'FIXED';
    // Search bar
    const srch2 = figma.createFrame(); srch2.resize(W - 181 - 28, 30); srch2.cornerRadius = 6;
    srch2.fills = solidPaint(SURF); srch2.strokes = solidPaint(DIV); srch2.strokeWeight = 1; srch2.strokeAlign = 'INSIDE';
    applyAL(srch2, 'HORIZONTAL', 8, 10, 0); srch2.primaryAxisSizingMode = 'FIXED'; srch2.counterAxisSizingMode = 'FIXED'; srch2.counterAxisAlignItems = 'CENTER';
    srch2.appendChild(R(12, 12, MUT, 3)); srch2.appendChild(await T('Filter hotkeys…', 11, 'Regular', MUT));
    tbl.appendChild(srch2);
    // Column headers
    const ACOL = W - 181 - 28 - 130 - 14;
    const thead = figma.createFrame(); thead.resize(W - 181 - 28, 26); thead.fills = solidPaint(BG);
    applyAL(thead, 'HORIZONTAL', 0, 0, 0); thead.primaryAxisSizingMode = 'FIXED'; thead.counterAxisSizingMode = 'FIXED'; thead.counterAxisAlignItems = 'CENTER';
    const aHdr = fixedFrame(ACOL, 26, null); aHdr.fills = []; applyAL(aHdr, 'HORIZONTAL', 0, 10, 0); aHdr.primaryAxisSizingMode = 'FIXED'; aHdr.counterAxisSizingMode = 'FIXED'; aHdr.counterAxisAlignItems = 'CENTER'; aHdr.appendChild(await T('Action', 10, 'Medium', MUT));
    const bHdr = fixedFrame(130, 26, null); bHdr.fills = []; applyAL(bHdr, 'HORIZONTAL', 0, 10, 0); bHdr.primaryAxisSizingMode = 'FIXED'; bHdr.counterAxisSizingMode = 'FIXED'; bHdr.counterAxisAlignItems = 'CENTER'; bHdr.appendChild(await T('Binding', 10, 'Medium', MUT));
    thead.appendChild(aHdr); thead.appendChild(bHdr); tbl.appendChild(thead);
    tbl.appendChild(R(W - 181 - 28, 1, DIV));
    // Hotkey rows
    const hks = [['Start Streaming', 'Ctrl+Shift+S'], ['Stop Streaming', 'Ctrl+Shift+Q'], ['Start Recording', 'Ctrl+Shift+R'], ['Stop Recording', 'Ctrl+Shift+P'], ['Pause Recording', 'Ctrl+Shift+Space'], ['Start Virtual Camera', '—'], ['Studio Mode', 'Ctrl+Shift+T'], ['Screenshot Output', 'Ctrl+F12'], ['Fullscreen Preview', '—'], ['Scene 1', 'F1'], ['Scene 2', 'F2'], ['Scene 3', 'F3'], ['Scene 4', 'F4']];
    for (const [action, binding] of hks) {
      const row = figma.createFrame(); row.name = 'hk'; row.resize(W - 181 - 28, 30); row.fills = [];
      applyAL(row, 'HORIZONTAL', 0, 0, 0); row.primaryAxisSizingMode = 'FIXED'; row.counterAxisSizingMode = 'FIXED'; row.counterAxisAlignItems = 'CENTER';
      const aCell = fixedFrame(ACOL, 30, null); aCell.fills = []; applyAL(aCell, 'HORIZONTAL', 0, 10, 0); aCell.primaryAxisSizingMode = 'FIXED'; aCell.counterAxisSizingMode = 'FIXED'; aCell.counterAxisAlignItems = 'CENTER'; aCell.appendChild(await T(action, 11, 'Regular', TXT));
      const bCell = fixedFrame(130, 30, null); bCell.fills = []; applyAL(bCell, 'HORIZONTAL', 4, 6, 0); bCell.primaryAxisSizingMode = 'FIXED'; bCell.counterAxisSizingMode = 'FIXED'; bCell.counterAxisAlignItems = 'CENTER';
      if (binding !== '—') {
        const kbd = figma.createFrame(); kbd.cornerRadius = 4; kbd.fills = solidPaint(PNL); kbd.strokes = solidPaint(DIV); kbd.strokeWeight = 1; kbd.strokeAlign = 'INSIDE';
        applyAL(kbd, 'HORIZONTAL', 0, 6, 2); kbd.primaryAxisSizingMode = 'AUTO'; kbd.counterAxisSizingMode = 'AUTO';
        kbd.appendChild(await T(binding, 10, 'Medium', TXT)); bCell.appendChild(kbd);
      } else { bCell.appendChild(await T('—', 11, 'Regular', MUT)); }
      row.appendChild(aCell); row.appendChild(bCell); tbl.appendChild(row);
    }
    split.appendChild(tbl); m.appendChild(split); m.appendChild(await footerBar(W, 'OK'));
    m.x = cx; m.y = cy; page.appendChild(m); cx += W + GAP; created++;
  }

  // 15 ── modal/source-filters ───────────────────────────────────────────────
  {
    const W = 700, H = 520, SPLIT_H = H - 48 - 52;
    const m = makeModal('modal/source-filters', W, H);
    m.appendChild(await titleBar(W, 'Source Filters — Display Capture'));
    const split = figma.createFrame(); split.name = 'split-body'; split.fills = [];
    split.resize(W, SPLIT_H); applyAL(split, 'HORIZONTAL', 0, 0, 0); split.primaryAxisSizingMode = 'FIXED'; split.counterAxisSizingMode = 'FIXED';
    // Left filter list
    const fl2 = figma.createFrame(); fl2.name = 'filter-list'; fl2.resize(220, SPLIT_H); fl2.fills = solidPaint(SURF);
    applyAL(fl2, 'VERTICAL', 2, 0, 6); fl2.primaryAxisSizingMode = 'FIXED'; fl2.counterAxisSizingMode = 'FIXED';
    const ltb2 = figma.createFrame(); ltb2.name = 'toolbar'; ltb2.resize(220, 36); ltb2.fills = solidPaint(BG);
    applyAL(ltb2, 'HORIZONTAL', 4, 8, 0); ltb2.primaryAxisSizingMode = 'FIXED'; ltb2.counterAxisSizingMode = 'FIXED'; ltb2.counterAxisAlignItems = 'CENTER';
    ltb2.appendChild(await T('Effect Filters', 11, 'Medium', TXT));
    ltb2.appendChild(R(40, 1, null)); // spacer
    for (const ico of ['+', '−']) {
      const b2 = figma.createFrame(); b2.resize(22, 22); b2.cornerRadius = 4; b2.fills = solidPaint(PNL);
      applyAL(b2, 'HORIZONTAL', 0, 0, 0); b2.primaryAxisAlignItems = 'CENTER'; b2.counterAxisAlignItems = 'CENTER'; b2.primaryAxisSizingMode = 'FIXED'; b2.counterAxisSizingMode = 'FIXED';
      b2.appendChild(R(8, 8, TXT2)); ltb2.appendChild(b2);
    }
    fl2.appendChild(ltb2);
    const vFilters = [{ n: 'Chroma Key', on: true }, { n: 'Color Correction', on: false }, { n: 'Crop/Pad', on: false }, { n: 'LUT Filter', on: false }, { n: 'Sharpen', on: false }, { n: 'Scroll', on: false }];
    for (const vf of vFilters) {
      const it2 = figma.createFrame(); it2.name = vf.n; it2.resize(220, 34);
      it2.fills = vf.on ? [{ type: 'SOLID', color: hexToRgb(ACC), opacity: 0.15 }] : []; it2.cornerRadius = 4;
      applyAL(it2, 'HORIZONTAL', 8, 10, 0); it2.primaryAxisSizingMode = 'FIXED'; it2.counterAxisSizingMode = 'FIXED'; it2.counterAxisAlignItems = 'CENTER';
      const dot2 = figma.createEllipse(); dot2.resize(8, 8); dot2.fills = solidPaint(vf.on ? SUCCESS : DIV); it2.appendChild(dot2);
      it2.appendChild(await T(vf.n, 12, vf.on ? 'Medium' : 'Regular', vf.on ? TXT : TXT2));
      fl2.appendChild(it2);
    }
    split.appendChild(fl2); split.appendChild(R(1, SPLIT_H, DIV));
    // Right: Chroma Key props
    const fp2 = figma.createFrame(); fp2.name = 'filter-props'; fp2.resize(W - 221, SPLIT_H); fp2.fills = [];
    applyAL(fp2, 'VERTICAL', 10, 18, 14); fp2.primaryAxisSizingMode = 'FIXED'; fp2.counterAxisSizingMode = 'FIXED';
    fp2.appendChild(await secHdr(W - 261, 'Chroma Key'));
    fp2.appendChild(await frow(W - 261, 'Key Color Type', 'dropdown', 'Green'));
    const colorRow2 = figma.createFrame(); colorRow2.fills = []; applyAL(colorRow2, 'HORIZONTAL', 12, 0, 2); colorRow2.primaryAxisSizingMode = 'AUTO'; colorRow2.counterAxisSizingMode = 'AUTO'; colorRow2.counterAxisAlignItems = 'CENTER';
    colorRow2.appendChild(await T('Key Color', 12, 'Regular', TXT2));
    const swatch2 = R(48, 28, '#00CC44', 6); swatch2.strokes = solidPaint(DIV); swatch2.strokeWeight = 1; swatch2.strokeAlign = 'INSIDE';
    colorRow2.appendChild(swatch2); fp2.appendChild(colorRow2);
    fp2.appendChild(await slrow(W - 261, 'Similarity', 0.40));
    fp2.appendChild(await slrow(W - 261, 'Smoothness', 0.25));
    fp2.appendChild(await slrow(W - 261, 'Key Color Spill Reduction', 0.10));
    fp2.appendChild(await slrow(W - 261, 'Opacity', 1.0));
    split.appendChild(fp2); m.appendChild(split); m.appendChild(await footerBar(W, 'Close'));
    m.x = cx; m.y = cy; page.appendChild(m); created++;
  }

  log('Feature components built: ' + created + ' modals/panels on page 02', 'ok');
  figma.viewport.scrollAndZoomIntoView([page.children[page.children.length - 1]]);
  figma.ui.postMessage({ type: 'FEATURES_DONE', count: created });
}

// ─── Advanced Prototype Flows ─────────────────────────────────────────────────
// Adds: app state frames (live/recording), full Settings dialog (7 tabs),
// source-configuration chain, scene-management flows.
async function buildAdvancedFlows() {
  for (const s of ['Regular','Medium','Semi Bold']) await figma.loadFontAsync({family:'Inter',style:s});

  const p2 = figma.root.children.find(p => p.name.startsWith('02'));
  const p3 = figma.root.children.find(p => p.name.startsWith('03'));
  if (!p2||!p3) { figma.ui.postMessage({type:'ADV_ERROR',error:'Pages not found — run Build first'}); return; }
  await p2.loadAsync(); await p3.loadAsync();

  const appDefault = p3.findOne(n=>n.name==='app/default');
  if (!appDefault) { figma.ui.postMessage({type:'ADV_ERROR',error:'app/default not found'}); return; }

  // ── colour tokens ──
  const C = {
    BASE:'#0B0B0F', SURF:'#14141C', PNL:'#1C1C27', DIV:'#2A2A3A',
    TXT:'#FFFFFF', TXT2:'#B9B9C9', MUT:'#6C6C80',
    ACC:'#8A5CFF', DANGER:'#FF5470', SUCCESS:'#3DDC97', WARN:'#FFC857'
  };
  const sp = hex => solidPaint(hex);
  const spA = (hex,a) => [Object.assign({},solidPaint(hex)[0],{opacity:a})];

  // ── inline T / R helpers ──
  async function T(chars,size,style,hex){
    await figma.loadFontAsync({family:'Inter',style:style||'Regular'});
    const t=figma.createText(); t.fontName={family:'Inter',style:style||'Regular'};
    t.fontSize=size||12; t.characters=String(chars);
    t.fills=hex?sp(hex):sp(C.TXT); return t;
  }
  function R(w,h,hex,r){ const x=figma.createRectangle(); x.resize(w,h); if(hex)x.fills=sp(hex); if(r)x.cornerRadius=r; return x; }
  function F(w,h,hex,r){ const f=figma.createFrame(); f.resize(w,h); f.fills=hex?sp(hex):[]; if(r)f.cornerRadius=r; return f; }
  function fixedAL(f,dir,gap,ph,pv){ applyAL(f,dir,gap,ph,pv); f.primaryAxisSizingMode='FIXED'; f.counterAxisSizingMode='FIXED'; }

  // ── self-probe reaction format ──
  let probeTemplate=null;
  { const pr1=figma.createFrame(); pr1.name='__adv_p1__'; pr1.resize(100,100);
    const pr2=figma.createFrame(); pr2.name='__adv_p2__'; pr2.resize(100,100);
    p3.appendChild(pr1); p3.appendChild(pr2);
    const FMTS=[
      [{trigger:{type:'ON_CLICK'},action:{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false},actions:[{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}],
      [{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}],
      [{trigger:{type:'ON_CLICK'},action:{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}}],
    ];
    for(let i=0;i<FMTS.length;i++){ try{ pr1.reactions=FMTS[i]; const s=pr1.reactions; if(s&&s.length>0){probeTemplate=s[0];break;} }catch(e){} }
    pr1.remove(); pr2.remove();
    if(!probeTemplate) log('ADV: no reaction format worked — prototype links will be static','warn');
  }

  function wire(node,destId,tr){
    if(!probeTemplate||!node) return false;
    const r=JSON.parse(JSON.stringify(probeTemplate));
    const patch=a=>{if(a&&a.type==='NODE'){a.destinationId=destId; if(tr!==undefined)a.transition=tr;}};
    patch(r.action); if(r.actions)r.actions.forEach(patch);
    try{node.reactions=[r];return true;}catch(e){log('wire fail: '+e.message.slice(0,60),'warn');return false;}
  }
  function nb(parent,name){ return parent.findOne(n=>n.name===name&&n.type!=='TEXT')||parent.findOne(n=>n.name===name); }

  const dis={type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}};
  const slideIn={type:'MOVE_IN',direction:'LEFT',duration:0.25,easing:{type:'EASE_OUT'}};
  const APP_W=1440,APP_H=900;
  let wired=0;

  // ── next-position tracker ──
  let nx = appDefault.x+APP_W+80;
  const ny = appDefault.y;
  const existSc=p3.children.filter(n=>n.name.startsWith('scene/')||n.name.startsWith('app/'));
  if(existSc.length){ const rm=existSc.reduce((a,b)=>a.x>b.x?a:b); nx=rm.x+rm.width+80; }
  function pos(){ const x=nx; nx+=APP_W+80; return {x,y:ny}; }

  function makeScene(name){
    const old=p3.findOne(n=>n.name===name); if(old)old.remove();
    const f=F(APP_W,APP_H,C.BASE); f.name=name;
    const p=pos(); f.x=p.x; f.y=p.y; p3.appendChild(f); return f;
  }
  function addScrim(scene,destId){
    const s=R(APP_W,APP_H); s.name='scrim'; s.fills=spA('#000000',0.65);
    scene.appendChild(s); if(destId&&wire(s,destId,dis))wired++;
  }
  function placeModal(scene,modal){
    scene.appendChild(modal);
    modal.x=Math.round((APP_W-modal.width)/2);
    modal.y=Math.round((APP_H-modal.height)/2);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. APP STATE FRAMES  — streaming-live & recording-active
  // ─────────────────────────────────────────────────────────────────────────
  for(const nm of ['app/streaming-live','app/recording-active']){
    const old=p3.findOne(n=>n.name===nm); if(old)old.remove();
  }

  // streaming-live: clone, recolor Start Streaming → Stop Streaming (red)
  const liveFrame=appDefault.clone();
  liveFrame.name='app/streaming-live';
  { const p=pos(); liveFrame.x=p.x; liveFrame.y=p.y; } p3.appendChild(liveFrame);
  {
    const btn=nb(liveFrame,'Start Streaming');
    if(btn){ btn.name='Stop Streaming'; btn.fills=sp(C.DANGER);
      const t=btn.findOne(n=>n.type==='TEXT'); if(t){try{await figma.loadFontAsync(t.fontName);t.characters='Stop Streaming';}catch(e){}} }
    // LIVE badge over preview
    const badge=F(90,26,C.DANGER,999); badge.name='live-badge';
    fixedAL(badge,'HORIZONTAL',6,14,0); badge.primaryAxisAlignItems='CENTER'; badge.counterAxisAlignItems='CENTER';
    badge.appendChild(await T('⬤ LIVE 00:00',11,'Semi Bold',C.TXT));
    liveFrame.appendChild(badge);
    const prev=liveFrame.findOne(n=>n.name==='panel/preview')||liveFrame.findOne(n=>n.name==='preview');
    if(prev){ badge.x=prev.x+12; badge.y=prev.y+prev.height-38; } else { badge.x=270; badge.y=820; }
    // stop streaming → app/default
    const stop=nb(liveFrame,'Stop Streaming');
    if(stop&&wire(stop,appDefault.id,dis))wired++;
    log('app/streaming-live created','ok');
  }

  // recording-active: clone, recolor Start Recording → Stop Recording (red)
  const recFrame=appDefault.clone();
  recFrame.name='app/recording-active';
  { const p=pos(); recFrame.x=p.x; recFrame.y=p.y; } p3.appendChild(recFrame);
  {
    const btn=nb(recFrame,'Start Recording');
    if(btn){ btn.name='Stop Recording'; btn.fills=sp(C.DANGER);
      const t=btn.findOne(n=>n.type==='TEXT'); if(t){try{await figma.loadFontAsync(t.fontName);t.characters='Stop Recording';}catch(e){}} }
    // REC badge
    const badge=F(100,26,C.DANGER,999); badge.name='rec-badge';
    fixedAL(badge,'HORIZONTAL',6,14,0); badge.primaryAxisAlignItems='CENTER'; badge.counterAxisAlignItems='CENTER';
    badge.appendChild(await T('⬤ REC 00:00:00',11,'Semi Bold',C.TXT));
    recFrame.appendChild(badge);
    const prev=recFrame.findOne(n=>n.name==='panel/preview')||recFrame.findOne(n=>n.name==='preview');
    if(prev){ badge.x=prev.x+prev.width-112; badge.y=prev.y+prev.height-38; } else { badge.x=1050; badge.y=820; }
    // stop recording → app/default
    const stop=nb(recFrame,'Stop Recording');
    if(stop&&wire(stop,appDefault.id,dis))wired++;
    log('app/recording-active created','ok');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. FULL SETTINGS MODAL  — 7-tab scene per tab
  // ─────────────────────────────────────────────────────────────────────────
  const TABS=['General','Stream','Output','Audio','Video','Hotkeys','Advanced'];
  const tabScenes={};
  const MW=900,MH=700,SBW=180;

  async function makeDropdown(w,label,val){
    const f=F(w,32,C.PNL,8); f.name='field-'+label.toLowerCase().replace(/\s/g,'-');
    f.strokes=sp(C.DIV); f.strokeWeight=1; f.strokeAlign='INSIDE';
    fixedAL(f,'HORIZONTAL',0,12,0); f.primaryAxisAlignItems='SPACE_BETWEEN'; f.counterAxisAlignItems='CENTER';
    f.appendChild(await T(val,12,'Regular',C.TXT2)); f.appendChild(await T('▾',11,'Regular',C.MUT)); return f;
  }
  async function makeInput(w,label,placeholder){
    const f=F(w,32,C.PNL,8); f.name='input-'+label.toLowerCase().replace(/\s/g,'-');
    f.strokes=sp(C.DIV); f.strokeWeight=1; f.strokeAlign='INSIDE';
    fixedAL(f,'HORIZONTAL',0,12,0); f.counterAxisAlignItems='CENTER';
    f.appendChild(await T(placeholder||'',12,'Regular',C.MUT)); return f;
  }
  async function makeRow(w,label,type,val){
    const row=F(w,32); row.name='row-'+label.toLowerCase().replace(/\s/g,'-');
    fixedAL(row,'HORIZONTAL',0,0,0); row.primaryAxisAlignItems='SPACE_BETWEEN'; row.counterAxisAlignItems='CENTER';
    row.appendChild(await T(label,12,'Regular',C.TXT2));
    const ctrl=type==='dropdown'?await makeDropdown(220,label,val||'Select…'):await makeInput(220,label,val||'');
    row.appendChild(ctrl); return row;
  }
  async function makeToggleRow(w,label,on){
    const row=F(w,32); row.name='toggle-'+label.toLowerCase().replace(/\s/g,'-');
    fixedAL(row,'HORIZONTAL',0,0,0); row.primaryAxisAlignItems='SPACE_BETWEEN'; row.counterAxisAlignItems='CENTER';
    row.appendChild(await T(label,12,'Regular',C.TXT2));
    const tog=F(44,24,on?C.ACC:C.DIV,999); tog.name='toggle';
    const knob=R(18,18,'#FFFFFF',999); knob.x=on?22:4; knob.y=3; tog.appendChild(knob);
    row.appendChild(tog); return row;
  }
  async function sectionHdr(w,label){
    const f=F(w,28); fixedAL(f,'HORIZONTAL',8,0,0); f.counterAxisAlignItems='CENTER';
    f.appendChild(R(3,16,C.ACC,999)); f.appendChild(await T(label,13,'Semi Bold',C.TXT)); return f;
  }
  async function divider(w){ const f=F(w,1,C.DIV); return f; }

  async function buildSettingsContent(content,tab,cw){
    if(tab==='General'){
      content.appendChild(await sectionHdr(cw,'Application'));
      content.appendChild(await makeRow(cw,'Language','dropdown','English'));
      content.appendChild(await makeRow(cw,'Theme','dropdown','Dark'));
      content.appendChild(await makeToggleRow(cw,'Enable auto-update',true));
      content.appendChild(await makeToggleRow(cw,'Show confirmation dialogs',true));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'System Tray'));
      content.appendChild(await makeToggleRow(cw,'Enable System Tray Icon',true));
      content.appendChild(await makeToggleRow(cw,'Minimise to tray on close',false));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'Output'));
      content.appendChild(await makeRow(cw,'Recording Path','path','~/Videos/OBS'));
      content.appendChild(await makeRow(cw,'Filename Formatting','input','%CCYY-%MM-%DD %hh-%mm-%ss'));
    } else if(tab==='Stream'){
      content.appendChild(await sectionHdr(cw,'Service'));
      content.appendChild(await makeRow(cw,'Service','dropdown','Twitch'));
      content.appendChild(await makeRow(cw,'Server','dropdown','Auto (Recommended)'));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'Authentication'));
      content.appendChild(await makeRow(cw,'Stream Key','password','••••••••••••••••••••'));
      const linkF=F(cw,20); linkF.fills=[]; applyAL(linkF,'HORIZONTAL',0,0,0);
      linkF.appendChild(await T('Get Stream Key →',11,'Regular',C.ACC)); content.appendChild(linkF);
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'Encoder'));
      content.appendChild(await makeRow(cw,'Video Encoder','dropdown','NVIDIA NVENC H.264'));
      content.appendChild(await makeRow(cw,'Rate Control','dropdown','CBR'));
      content.appendChild(await makeRow(cw,'Bitrate (Kbps)','input','6000'));
      content.appendChild(await makeRow(cw,'Keyframe Interval','dropdown','2s'));
      content.appendChild(await makeRow(cw,'Preset','dropdown','P5 – Slow (High Quality)'));
    } else if(tab==='Output'){
      content.appendChild(await sectionHdr(cw,'Recording'));
      content.appendChild(await makeRow(cw,'Recording Format','dropdown','MKV'));
      content.appendChild(await makeRow(cw,'Video Encoder','dropdown','NVIDIA NVENC H.264'));
      content.appendChild(await makeRow(cw,'Audio Track','dropdown','Track 1 (160 Kbps)'));
      content.appendChild(await makeRow(cw,'Output Path','path','~/Videos/OBS'));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'Replay Buffer'));
      content.appendChild(await makeToggleRow(cw,'Enable Replay Buffer',false));
      content.appendChild(await makeRow(cw,'Max Replay Time','input','30 seconds'));
    } else if(tab==='Audio'){
      content.appendChild(await sectionHdr(cw,'Global Audio Devices'));
      content.appendChild(await makeRow(cw,'Desktop Audio','dropdown','Default'));
      content.appendChild(await makeRow(cw,'Desktop Audio 2','dropdown','Disabled'));
      content.appendChild(await makeRow(cw,'Mic / Aux','dropdown','Default'));
      content.appendChild(await makeRow(cw,'Mic / Aux 2','dropdown','Disabled'));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'Advanced'));
      content.appendChild(await makeRow(cw,'Sample Rate','dropdown','48 kHz'));
      content.appendChild(await makeRow(cw,'Channels','dropdown','Stereo'));
    } else if(tab==='Video'){
      content.appendChild(await sectionHdr(cw,'Video'));
      content.appendChild(await makeRow(cw,'Base (Canvas) Resolution','dropdown','1920×1080'));
      content.appendChild(await makeRow(cw,'Output (Scaled) Resolution','dropdown','1920×1080'));
      content.appendChild(await makeRow(cw,'Downscale Filter','dropdown','Lanczos (Sharpened)'));
      content.appendChild(await makeRow(cw,'Common FPS Values','dropdown','60'));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'GPU'));
      content.appendChild(await makeRow(cw,'GPU Encoder','dropdown','NVIDIA NVENC'));
      content.appendChild(await makeToggleRow(cw,'Enable Hardware Decoding',true));
    } else if(tab==='Hotkeys'){
      content.appendChild(await sectionHdr(cw,'Search'));
      const srch=await makeInput(cw,'search','Search hotkeys…'); content.appendChild(srch);
      content.appendChild(await divider(cw));
      const hotkeys=[['Start Streaming','Alt+S'],['Stop Streaming','Alt+S'],['Start Recording','Alt+R'],['Stop Recording','Alt+R'],['Pause Recording','Alt+P'],['Start Virtual Camera','Alt+V'],['Studio Mode','Alt+M'],['Screenshot','Alt+F10'],['Save Replay','Alt+F9']];
      for(const [act,key] of hotkeys){
        const row=F(cw,32); row.name='hk-'+act.toLowerCase().replace(/\s/g,'-');
        fixedAL(row,'HORIZONTAL',0,0,0); row.primaryAxisAlignItems='SPACE_BETWEEN'; row.counterAxisAlignItems='CENTER';
        row.appendChild(await T(act,12,'Regular',C.TXT2));
        const keyBadge=F(90,24,C.PNL,6); keyBadge.strokes=sp(C.DIV); keyBadge.strokeWeight=1; keyBadge.strokeAlign='INSIDE';
        fixedAL(keyBadge,'HORIZONTAL',0,0,0); keyBadge.primaryAxisAlignItems='CENTER'; keyBadge.counterAxisAlignItems='CENTER';
        keyBadge.appendChild(await T(key,11,'Regular',C.TXT));
        row.appendChild(keyBadge); content.appendChild(row);
      }
    } else if(tab==='Advanced'){
      content.appendChild(await sectionHdr(cw,'General'));
      content.appendChild(await makeRow(cw,'Process Priority','dropdown','Normal'));
      content.appendChild(await makeRow(cw,'Renderer','dropdown','Direct3D 11'));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'Video'));
      content.appendChild(await makeRow(cw,'Color Format','dropdown','NV12'));
      content.appendChild(await makeRow(cw,'Color Space','dropdown','709'));
      content.appendChild(await makeRow(cw,'Color Range','dropdown','Partial'));
      content.appendChild(await divider(cw));
      content.appendChild(await sectionHdr(cw,'Network'));
      content.appendChild(await makeToggleRow(cw,'Enable Network Optimisations',true));
      content.appendChild(await makeToggleRow(cw,'Enable TCP pacing',false));
    }
  }

  for(let ti=0;ti<TABS.length;ti++){
    const tab=TABS[ti];
    const scene=makeScene('scene/settings-'+tab.toLowerCase());
    addScrim(scene,appDefault.id);

    // modal shell
    const modal=F(MW,MH,C.SURF,12); modal.name='modal/settings';
    modal.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.65},offset:{x:0,y:24},radius:64,spread:0,visible:true,blendMode:'NORMAL'}];
    applyAL(modal,'VERTICAL',0,0,0); modal.primaryAxisSizingMode='FIXED'; modal.counterAxisSizingMode='FIXED';

    // title bar
    const tb=F(MW,48,C.PNL,0); tb.name='titlebar';
    fixedAL(tb,'HORIZONTAL',0,20,0); tb.primaryAxisAlignItems='SPACE_BETWEEN'; tb.counterAxisAlignItems='CENTER';
    tb.appendChild(await T('Settings',15,'Medium',C.TXT));
    const cl=R(14,14,C.DANGER,7); cl.name='close'; tb.appendChild(cl);
    modal.appendChild(tb);

    // body
    const body=F(MW,MH-48-52); body.name='body'; body.fills=[];
    applyAL(body,'HORIZONTAL',0,0,0); body.primaryAxisSizingMode='FIXED'; body.counterAxisSizingMode='FIXED';

    // sidebar
    const sb=F(SBW,MH-48-52,C.PNL,0); sb.name='sidebar';
    applyAL(sb,'VERTICAL',2,0,8); sb.primaryAxisSizingMode='FIXED'; sb.counterAxisSizingMode='FIXED';
    for(let i=0;i<TABS.length;i++){
      const isAct=i===ti;
      const item=F(SBW,36); item.name='tab-'+TABS[i].toLowerCase();
      item.fills=isAct?spA(C.ACC,0.18):[];
      item.cornerRadius=6;
      fixedAL(item,'HORIZONTAL',6,12,0); item.counterAxisAlignItems='CENTER';
      if(isAct){ const bar=R(3,18,C.ACC,999); item.appendChild(bar); }
      item.appendChild(await T(TABS[i],13,isAct?'Medium':'Regular',isAct?C.TXT:C.TXT2));
      sb.appendChild(item);
    }
    body.appendChild(sb);

    // content
    const cw=MW-SBW-48;
    const content=F(MW-SBW,MH-48-52,C.SURF,0); content.name='content';
    applyAL(content,'VERTICAL',12,24,20); content.primaryAxisSizingMode='FIXED'; content.counterAxisSizingMode='FIXED'; content.clipsContent=true;
    await buildSettingsContent(content,tab,cw);
    body.appendChild(content);
    modal.appendChild(body);

    // footer
    const ft=F(MW,52,C.PNL,0); ft.name='footer';
    fixedAL(ft,'HORIZONTAL',8,16,0); ft.primaryAxisAlignItems='MAX'; ft.counterAxisAlignItems='CENTER';
    const canBtn=F(80,32,C.PNL,6); canBtn.name='btn-cancel'; canBtn.strokes=sp(C.DIV); canBtn.strokeWeight=1; canBtn.strokeAlign='INSIDE';
    fixedAL(canBtn,'HORIZONTAL',0,0,0); canBtn.primaryAxisAlignItems='CENTER'; canBtn.counterAxisAlignItems='CENTER';
    canBtn.appendChild(await T('Cancel',12,'Regular',C.TXT2));
    const applyBtn=F(80,32,null,6); applyBtn.name='btn-apply'; applyBtn.fills=accentGradient();
    fixedAL(applyBtn,'HORIZONTAL',0,0,0); applyBtn.primaryAxisAlignItems='CENTER'; applyBtn.counterAxisAlignItems='CENTER';
    applyBtn.appendChild(await T('Apply',12,'Medium',C.TXT));
    ft.appendChild(canBtn); ft.appendChild(applyBtn);
    modal.appendChild(ft);

    placeModal(scene,modal);
    tabScenes[tab]=scene;

    // close / cancel → app/default
    if(wire(cl,appDefault.id,dis))wired++;
    if(wire(canBtn,appDefault.id,dis))wired++;
    log('Settings tab built: '+tab,'ok');
  }

  // tab-to-tab navigation
  for(let ti=0;ti<TABS.length;ti++){
    const scene=tabScenes[TABS[ti]];
    if(!scene) continue;
    const modal=scene.findOne(n=>n.name==='modal/settings');
    if(!modal) continue;
    for(let oi=0;oi<TABS.length;oi++){
      if(oi===ti) continue;
      const target=tabScenes[TABS[oi]];
      if(!target) continue;
      const tabItem=modal.findOne(n=>n.name==='tab-'+TABS[oi].toLowerCase());
      if(tabItem&&wire(tabItem,target.id,dis))wired++;
    }
    // apply → app/default (settings saved)
    const applyB=modal.findOne(n=>n.name==='btn-apply');
    if(applyB&&wire(applyB,appDefault.id,dis))wired++;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. SOURCE CONFIGURATION CHAIN
  //    Add Source grid tiles → individual source config scenes
  // ─────────────────────────────────────────────────────────────────────────
  const addSrcScene=p3.findOne(n=>n.name==='scene/add-source');

  // map source tile names → existing modal on p2 (or null to auto-build)
  const srcModals={
    'Display Capture': p2.findOne(n=>n.name==='modal/source/display-capture'),
    'Browser Source':  p2.findOne(n=>n.name==='modal/source/browser-source'),
    'Media Source':    p2.findOne(n=>n.name==='modal/source/media-source'),
    'Video Capture':   p2.findOne(n=>n.name==='modal/source/webcam'),
    'Window Capture':  null,
    'Audio Input':     null,
    'Image':           null,
    'Game Capture':    null,
  };

  async function simpleSourceModal(srcName){
    // create a minimal property dialog for sources without a dedicated modal
    const W=500,H=320;
    const m=F(W,H,C.SURF,12); m.name='modal/source/'+srcName.toLowerCase().replace(/\s+/g,'-');
    applyAL(m,'VERTICAL',0,0,0); m.primaryAxisSizingMode='FIXED'; m.counterAxisSizingMode='FIXED';
    // title bar
    const tb=F(W,48,C.PNL,0); fixedAL(tb,'HORIZONTAL',0,20,0); tb.primaryAxisAlignItems='SPACE_BETWEEN'; tb.counterAxisAlignItems='CENTER';
    const cl2=R(14,14,C.DANGER,7); cl2.name='close';
    tb.appendChild(await T(srcName+' Properties',14,'Medium',C.TXT)); tb.appendChild(cl2); m.appendChild(tb);
    // body
    const body2=F(W,H-48-52,C.SURF,0); applyAL(body2,'VERTICAL',12,20,16); body2.primaryAxisSizingMode='FIXED'; body2.counterAxisSizingMode='FIXED';
    // source-specific fields
    if(srcName==='Window Capture'||srcName==='Game Capture'){
      body2.appendChild(await makeRow(W-40,'Window','dropdown','Select window…'));
      body2.appendChild(await makeToggleRow(W-40,'Capture Cursor',true));
      body2.appendChild(await makeToggleRow(W-40,'Allow Transparency',false));
    } else if(srcName==='Audio Input'){
      body2.appendChild(await makeRow(W-40,'Device','dropdown','Default Microphone'));
      body2.appendChild(await makeToggleRow(W-40,'Use Device Timestamps',false));
      body2.appendChild(await makeRow(W-40,'Channels','dropdown','Stereo'));
    } else if(srcName==='Image'){
      body2.appendChild(await makeRow(W-40,'Image File','path','Browse…'));
      body2.appendChild(await makeToggleRow(W-40,'Unload when not showing',false));
      body2.appendChild(await makeRow(W-40,'Linear Alpha','dropdown','None'));
    }
    m.appendChild(body2);
    // footer
    const ft2=F(W,52,C.PNL,0); fixedAL(ft2,'HORIZONTAL',8,16,0); ft2.primaryAxisAlignItems='MAX'; ft2.counterAxisAlignItems='CENTER';
    const can2=F(80,32,C.PNL,6); can2.name='btn-cancel'; can2.strokes=sp(C.DIV); can2.strokeWeight=1; can2.strokeAlign='INSIDE';
    fixedAL(can2,'HORIZONTAL',0,0,0); can2.primaryAxisAlignItems='CENTER'; can2.counterAxisAlignItems='CENTER';
    can2.appendChild(await T('Cancel',12,'Regular',C.TXT2));
    const ok2=F(60,32,null,6); ok2.name='btn-confirm'; ok2.fills=accentGradient();
    fixedAL(ok2,'HORIZONTAL',0,0,0); ok2.primaryAxisAlignItems='CENTER'; ok2.counterAxisAlignItems='CENTER';
    ok2.appendChild(await T('OK',12,'Medium',C.TXT));
    ft2.appendChild(can2); ft2.appendChild(ok2); m.appendChild(ft2);
    p2.appendChild(m); return m;
  }

  for(const [srcName, existingModal] of Object.entries(srcModals)){
    const modal2=existingModal||(await simpleSourceModal(srcName));
    if(!modal2) continue;

    const sceneName='scene/source-'+srcName.toLowerCase().replace(/\s+/g,'-');
    const srcScene=makeScene(sceneName);
    // scrim → back to add-source (not app/default)
    if(addSrcScene) addScrim(srcScene,addSrcScene.id);
    else addScrim(srcScene,appDefault.id);

    const cloned=modal2.clone();
    placeModal(srcScene,cloned);

    // close/cancel → add-source scene; confirm → app/default
    const closeB2=nb(cloned,'close')||nb(cloned,'close-btn');
    if(closeB2&&addSrcScene&&wire(closeB2,addSrcScene.id,dis))wired++;
    const canB2=nb(cloned,'btn-cancel');
    if(canB2&&addSrcScene&&wire(canB2,addSrcScene.id,dis))wired++;
    const conB2=nb(cloned,'btn-confirm');
    if(conB2&&wire(conB2,appDefault.id,dis))wired++;

    // wire the tile in the Add Source scene
    if(addSrcScene){
      const tile=addSrcScene.findOne(n=>n.name===srcName&&n.type!=='TEXT')
               ||addSrcScene.findOne(n=>n.name===srcName);
      if(tile&&wire(tile,srcScene.id,dis))wired++;
    }
    log('Source chain: '+srcName,'ok');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. WIRE app/default control buttons → new state frames
  // ─────────────────────────────────────────────────────────────────────────
  // Start Streaming → app/streaming-live
  { const b=nb(appDefault,'Start Streaming'); if(b&&wire(b,liveFrame.id,dis))wired++; }
  // Start Recording → app/recording-active
  { const b=nb(appDefault,'Start Recording'); if(b&&wire(b,recFrame.id,dis))wired++; }
  // Settings → scene/settings-general
  { const b=nb(appDefault,'Settings'); const s=tabScenes['General']; if(b&&s&&wire(b,s.id,dis))wired++; }
  // Virtual Camera → existing scene
  { const vcScene=p3.findOne(n=>n.name==='scene/virtual-camera');
    const b=nb(appDefault,'Virtual Camera'); if(b&&vcScene&&wire(b,vcScene.id,dis))wired++; }
  // Studio Mode → app/studio-mode
  { const sm=p3.findOne(n=>n.name==='app/studio-mode'); const b=nb(appDefault,'Studio Mode');
    if(b&&sm&&wire(b,sm.id,{type:'MOVE_IN',direction:'LEFT',duration:0.3,easing:{type:'EASE_OUT'}}))wired++; }

  log('Advanced flows complete: '+wired+' connections','ok');
  figma.ui.postMessage({type:'ADV_DONE',count:wired});
}

// ─── Modal Prototype Flows ────────────────────────────────────────────────────
// Creates 1440×900 "scene" frames on page 03, each showing app/default + scrim +
// one feature modal centred. Wires Controls panel buttons to open those scenes,
// and wires each modal's close/cancel buttons back to app/default.
async function buildModalPrototypes() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });

  const p2 = figma.root.children.find(p => p.name === '02 — Panels, Menus & Modals');
  const p3 = figma.root.children.find(p => p.name === '03 — App Frames') ||
             figma.root.children.find(p => p.name.startsWith('03'));
  if (!p2 || !p3) {
    figma.ui.postMessage({ type: 'MPROTO_ERROR', error: 'Pages not found — run Build first' });
    return;
  }
  await p2.loadAsync();
  await p3.loadAsync();

  // ── Self-probe: discover the exact reaction format this Figma version accepts ──
  // Create two throwaway frames, set a reaction using our best-guess format,
  // then READ BACK what Figma actually stored. Use that canonical form for all
  // real reactions so we never have a format mismatch.
  let probeReactionTemplate = null;
  {
    const probe1 = figma.createFrame(); probe1.name = '__probe_src__'; probe1.resize(100,100);
    const probe2 = figma.createFrame(); probe2.name = '__probe_dst__'; probe2.resize(100,100);
    p3.appendChild(probe1); p3.appendChild(probe2);
    const candidateFormats = [
      // Format A: action + actions (both)
      [{ trigger:{type:'ON_CLICK'}, action:{type:'NODE',destinationId:probe2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}, actions:[{type:'NODE',destinationId:probe2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}] }],
      // Format B: actions only
      [{ trigger:{type:'ON_CLICK'}, actions:[{type:'NODE',destinationId:probe2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}] }],
      // Format C: action only (deprecated)
      [{ trigger:{type:'ON_CLICK'}, action:{type:'NODE',destinationId:probe2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false} }],
      // Format D: bare minimum
      [{ trigger:{type:'ON_CLICK'}, action:{type:'NODE',destinationId:probe2.id} }],
      // Format E: action without transition
      [{ trigger:{type:'ON_CLICK'}, action:{type:'NODE',destinationId:probe2.id,navigation:'NAVIGATE',transition:null,preserveScrollPosition:false} }],
    ];
    for (let i = 0; i < candidateFormats.length; i++) {
      try {
        probe1.reactions = candidateFormats[i];
        // If assignment didn't throw, read back what Figma stored
        const stored = probe1.reactions;
        if (stored && stored.length > 0) {
          probeReactionTemplate = stored[0];
          log('Reaction format probe: format ' + (i+1) + ' accepted — ' + JSON.stringify(probeReactionTemplate).slice(0,120), 'ok');
          break;
        }
      } catch(e) {
        log('Reaction probe format ' + (i+1) + ' rejected: ' + e.message.slice(0,80), 'warn');
      }
    }
    probe1.remove(); probe2.remove();
    if (!probeReactionTemplate) {
      log('All reaction formats rejected — prototype links will not be interactive', 'warn');
    }
  }

  // Build a reaction using the probed template, substituting destinationId
  function makeReaction(destId, customTransition) {
    if (!probeReactionTemplate) return null;
    const r = JSON.parse(JSON.stringify(probeReactionTemplate));
    const patchAction = (a) => {
      if (a && a.type === 'NODE') {
        a.destinationId = destId;
        if (customTransition !== undefined) a.transition = customTransition;
      }
    };
    patchAction(r.action);
    if (r.actions) r.actions.forEach(patchAction);
    return r;
  }

  const appDefault = p3.findOne(n => n.name === 'app/default');
  if (!appDefault) {
    figma.ui.postMessage({ type: 'MPROTO_ERROR', error: 'app/default not found on page 03 — run Build / Rebuild App Frame first' });
    return;
  }

  const APP_W = 1440, APP_H = 900;
  const dissolve = { type: 'DISSOLVE', duration: 0.25, easing: { type: 'EASE_OUT' } };

  // Connections: trigger button name → modal name on page 02 → new scene name
  const CONNECTIONS = [
    { btn: 'Start Streaming',  modal: 'modal/streaming-settings', scene: 'scene/streaming-settings' },
    { btn: 'Start Recording',  modal: 'modal/recording-settings',  scene: 'scene/recording-settings'  },
    { btn: 'SCENES+',          modal: 'modal/add-source',          scene: 'scene/add-source'           },
    { btn: 'Settings',         modal: 'modal/hotkeys-full',        scene: 'scene/hotkeys'              },
    { btn: 'Virtual Camera',   modal: 'modal/source/webcam',       scene: 'scene/virtual-camera'       },
  ];

  // Remove stale scene frames from a previous run
  for (const conn of CONNECTIONS) {
    const old = p3.findOne(n => n.name === conn.scene);
    if (old) old.remove();
  }

  // Place new scene frames to the right of app/default with 80px gaps
  let sceneX = appDefault.x + APP_W + 80;
  const sceneY = appDefault.y;
  let wired = 0;

  const sceneMap = {}; // btn label → scene frame

  for (const conn of CONNECTIONS) {
    // Find modal on page 02
    const modalNode = p2.findOne(n => n.name === conn.modal);
    if (!modalNode) { log('Modal not found: ' + conn.modal + ' — skipping', 'warn'); continue; }

    // ── Create 1440×900 scene frame ───────────────────────────────────────────
    const scene = figma.createFrame();
    scene.name = conn.scene;
    scene.resize(APP_W, APP_H);
    scene.fills = [{ type: 'SOLID', color: { r: 0.04, g: 0.04, b: 0.07 } }];
    scene.clipsContent = true;

    // Scrim (click-to-dismiss)
    const scrim = figma.createRectangle();
    scrim.name = 'scrim';
    scrim.resize(APP_W, APP_H);
    scrim.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.65 }];
    scene.appendChild(scrim);

    // CLONE modal into scene (leave original on p2 so re-runs still find it)
    const modalClone = modalNode.clone();
    const mW = modalClone.width, mH = modalClone.height;
    scene.appendChild(modalClone);
    modalClone.x = Math.round((APP_W - mW) / 2);
    modalClone.y = Math.round((APP_H - mH) / 2);

    scene.x = sceneX; scene.y = sceneY;
    p3.appendChild(scene);
    sceneMap[conn.btn] = scene;
    sceneX += APP_W + 80;

    // Wire scrim click → back to app/default
    const scrimR = makeReaction(appDefault.id);
    if (scrimR) try { scrim.reactions = [scrimR]; } catch(e) { log('scrim: ' + e.message.slice(0,60), 'warn'); }

    // Wire modal close / cancel buttons → back to app/default
    for (const closeName of ['close', 'close-btn', 'btn-cancel']) {
      const closeBtn = modalClone.findOne(n => n.name === closeName && n.type !== 'TEXT')
                    || modalClone.findOne(n => n.name === closeName);
      if (closeBtn) {
        const closeR = makeReaction(appDefault.id);
        if (closeR) try { closeBtn.reactions = [closeR]; } catch(e) { log('closeBtn: ' + e.message.slice(0,60), 'warn'); }
      }
    }
    wired++;
  }

  // ── Wire Controls panel buttons in app/default → scene frames ────────────────
  for (const conn of CONNECTIONS) {
    const scene = sceneMap[conn.btn];
    if (!scene) continue;
    // Prefer a FRAME/GROUP/INSTANCE node; avoid landing on a raw TEXT node
    const btn = appDefault.findOne(n => n.name === conn.btn && n.type !== 'TEXT')
             || appDefault.findOne(n => n.name === conn.btn);
    if (!btn) { log('Button not found: ' + conn.btn, 'warn'); continue; }
    log('Wiring ' + conn.btn + ' (' + btn.type + ') → scene', 'info');
    const btnR = makeReaction(scene.id);
    if (btnR) {
      try {
        btn.reactions = [btnR];
        log('  OK', 'ok');
        wired++;
      } catch(e) { log('btn FAILED (' + conn.btn + '): ' + e.message.slice(0,80), 'warn'); }
    }
  }

  // ── Studio Mode still navigates to app/studio-mode ───────────────────────────
  const studioBtn = appDefault.findOne(n => n.name === 'Studio Mode' && n.type !== 'TEXT')
                 || appDefault.findOne(n => n.name === 'Studio Mode');
  const studioFrame = p3.findOne(n => n.name === 'app/studio-mode');
  if (studioBtn && studioFrame) {
    const studioR = makeReaction(studioFrame.id, { type: 'MOVE_IN', direction: 'LEFT', duration: 0.3, easing: { type: 'EASE_OUT' } });
    if (studioR) try { studioBtn.reactions = [studioR]; wired++; } catch(e) { log('studio: ' + e.message.slice(0,60), 'warn'); }
  }

  figma.viewport.scrollAndZoomIntoView(p3.children.filter(n => n.name.startsWith('scene/')));
  log('Modal prototype flows wired: ' + wired + ' connections', 'ok');
  figma.ui.postMessage({ type: 'MPROTO_DONE', count: wired });
}

// ─── PDF Export ───────────────────────────────────────────────────────────────
// Exports key app frames as PNG, sends to UI which builds a print-ready HTML doc.
async function buildPDFExport() {
  const pages = figma.root.children;
  const p3 = pages.find(p => p.name.startsWith('03'));
  if (!p3) { figma.ui.postMessage({type:'PDF_ERROR',error:'Page 03 not found'}); return; }
  await p3.loadAsync();

  function u8ToB64(bytes) {
    let bin = ''; const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }

  const EXPORTS = [
    { name:'app/default',             label:'Main Interface' },
    { name:'app/studio-mode',         label:'Studio Mode' },
    { name:'app/streaming-live',      label:'Live Streaming State' },
    { name:'app/recording-active',    label:'Active Recording State' },
    { name:'app/scene-webcam-only',   label:'Scene — Webcam Only' },
    { name:'app/scene-screen-share',  label:'Scene — Screen Share' },
    { name:'app/scene-intermission',  label:'Scene — Intermission' },
    { name:'scene/settings-general',  label:'Settings — General' },
    { name:'scene/settings-stream',   label:'Settings — Stream' },
    { name:'scene/settings-output',   label:'Settings — Output' },
    { name:'scene/settings-audio',    label:'Settings — Audio' },
    { name:'scene/settings-video',    label:'Settings — Video' },
    { name:'scene/settings-hotkeys',  label:'Settings — Hotkeys' },
    { name:'scene/settings-advanced', label:'Settings — Advanced' },
    { name:'scene/add-source',        label:'Add Source Dialog' },
    { name:'scene/streaming-settings',label:'Start Streaming Dialog' },
    { name:'scene/recording-settings',label:'Start Recording Dialog' },
    { name:'scene/virtual-camera',    label:'Virtual Camera' },
    { name:'scene/menu-file',         label:'File Menu' },
    { name:'scene/menu-view',         label:'View Menu' },
    { name:'scene/menu-tools',        label:'Tools Menu' },
  ];

  const images = [];
  let done = 0;
  for (const exp of EXPORTS) {
    const node = p3.findOne(n => n.name === exp.name && n.type === 'FRAME');
    if (!node) { log('Skip (not found): ' + exp.name, 'warn'); continue; }
    try {
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 0.5 } });
      images.push({ name: exp.name, label: exp.label, data: u8ToB64(bytes) });
      done++;
      figma.ui.postMessage({ type: 'PDF_PROGRESS', done, total: EXPORTS.length, label: exp.label });
      log('Captured: ' + exp.label, 'ok');
    } catch(e) {
      log('Export failed: ' + exp.label + ' — ' + e.message.slice(0,60), 'warn');
    }
  }

  figma.ui.postMessage({ type: 'PDF_READY', images });
}

// ─── Wire All Interactions ────────────────────────────────────────────────────
// Comprehensive idempotent pass — wires EVERY named button across all
// app/* and scene/* frames on page 03. Safe to run multiple times.
async function buildAllInteractions() {
  for (const s of ['Regular','Medium','Semi Bold'])
    await figma.loadFontAsync({family:'Inter',style:s});

  const p3 = figma.root.children.find(p => p.name.startsWith('03'));
  if (!p3) { figma.ui.postMessage({type:'ALLWIRE_ERROR',error:'Page 03 not found'}); return; }
  await p3.loadAsync();

  // ── Self-probe to discover working reaction format at runtime ──
  let probeTemplate = null;
  {
    const pr1=figma.createFrame(); pr1.name='__aw_p1__'; pr1.resize(10,10);
    const pr2=figma.createFrame(); pr2.name='__aw_p2__'; pr2.resize(10,10);
    p3.appendChild(pr1); p3.appendChild(pr2);
    const FMTS=[
      [{trigger:{type:'ON_CLICK'},action:{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false},actions:[{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}],
      [{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}],
      [{trigger:{type:'ON_CLICK'},action:{type:'NODE',destinationId:pr2.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}}],
    ];
    for(let i=0;i<FMTS.length;i++){
      try{pr1.reactions=FMTS[i];const s=pr1.reactions;if(s&&s.length>0){probeTemplate=s[0];break;}}catch(e){}
    }
    pr1.remove(); pr2.remove();
  }
  if(!probeTemplate){figma.ui.postMessage({type:'ALLWIRE_ERROR',error:'Reaction format probe failed — ensure manifest has no documentAccess restriction'});return;}

  // wire(node, destId, optionalTransition) — assigns one reaction; returns true on success
  function wire(node,destId,tr){
    if(!node||!destId)return false;
    const r=JSON.parse(JSON.stringify(probeTemplate));
    const patch=a=>{if(a&&a.type==='NODE'){a.destinationId=destId;if(tr!==undefined)a.transition=tr;}};
    patch(r.action); if(r.actions)r.actions.forEach(patch);
    try{node.reactions=[r];return true;}catch(e){return false;}
  }

  // nb(parent, name) — prefers non-TEXT node to avoid landing on label spans
  function nb(parent,name){
    return parent.findOne(n=>n.name===name&&n.type!=='TEXT')
        || parent.findOne(n=>n.name===name);
  }

  // sc(name) — look up a top-level FRAME on p3
  function sc(name){return p3.findOne(n=>n.name===name&&n.type==='FRAME');}

  const dis={type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}};
  const slideLeft={type:'MOVE_IN',direction:'LEFT',duration:0.3,easing:{type:'EASE_OUT'}};
  let wired=0;

  const appDefault=sc('app/default');
  if(!appDefault){figma.ui.postMessage({type:'ALLWIRE_ERROR',error:'app/default not found — run Build UI Kit first'});return;}

  // ── Resolve destination frames (fall back to app/default when not yet built) ──
  const D={
    default:      appDefault,
    streaming:    sc('app/streaming-live')    || appDefault,
    recording:    sc('app/recording-active')  || appDefault,
    studio:       sc('app/studio-mode')       || appDefault,
    settings:     sc('scene/settings-general') || sc('scene/hotkeys') || appDefault,
    addSource:    sc('scene/add-source')      || appDefault,
    virtualCam:   sc('scene/virtual-camera')  || appDefault,
    webcamOnly:   sc('app/scene-webcam-only')  || appDefault,
    screenShare:  sc('app/scene-screen-share') || appDefault,
    intermission: sc('app/scene-intermission') || appDefault,
  };

  // ── Global button wiring map: button names → destination ──
  const WIRES=[
    {names:['Start Streaming'],                                    dest:D.streaming},
    {names:['Stop Streaming'],                                     dest:D.default},
    {names:['Start Recording'],                                    dest:D.recording},
    {names:['Stop Recording'],                                     dest:D.default},
    {names:['Virtual Camera','Start Virtual Camera'],              dest:D.virtualCam},
    {names:['Stop Virtual Camera'],                                dest:D.default},
    {names:['Studio Mode'],                                        dest:D.studio, tr:slideLeft},
    {names:['Settings'],                                           dest:D.settings},
    {names:['Exit'],                                               dest:D.default},
    // Generic close/cancel/back
    {names:['close','close-btn','btn-close','settings-close'],     dest:D.default},
    {names:['btn-cancel','Cancel'],                                dest:D.default},
    {names:['btn-ok','OK','btn-apply','Apply'],                    dest:D.default},
    // Add source entry points
    {names:['SCENES+','btn-add-source','btn-add'],                 dest:D.addSource},
    // Scene switcher items
    {names:['Main Scene'],         dest:D.default},
    {names:['Webcam Only'],        dest:D.webcamOnly},
    {names:['Screen Share'],       dest:D.screenShare},
    {names:['Intermission'],       dest:D.intermission},
  ];

  // Apply WIRES to every frame on p3
  // If dest === frame itself (self-loop), fall back to appDefault so click is visible
  const allFrames=p3.children.filter(n=>n.type==='FRAME');
  for(const frame of allFrames){
    for(const {names,dest,tr} of WIRES){
      if(!dest)continue;
      const effectiveDest = (dest===frame) ? appDefault : dest;
      if(effectiveDest===frame)continue; // truly stuck — skip
      for(const name of names){
        const node=nb(frame,name);
        if(node&&wire(node,effectiveDest.id,tr)){wired++;break;}
      }
    }

    // ── Extra: wire ALL controls-panel buttons in EVERY frame ──
    // (catches studio-mode, streaming-live, etc. where names are the same)
    const ctrlBtns=[
      {n:'Start Streaming',  d:D.streaming},
      {n:'Stop Streaming',   d:D.default},
      {n:'Start Recording',  d:D.recording},
      {n:'Stop Recording',   d:D.default},
      {n:'Virtual Camera',   d:D.virtualCam},
      {n:'Studio Mode',      d:(frame===D.studio)?D.default:D.studio, tr:slideLeft},
      {n:'Settings',         d:D.settings},
      {n:'Exit',             d:D.default},
    ];
    for(const {n,d,tr} of ctrlBtns){
      if(!d||d===frame)continue;
      const node=nb(frame,n); if(node&&wire(node,d.id,tr))wired++;
    }

    // ── Wire every toolbar button in this frame ──
    const ICON_TYPES_LOCAL=['studio-mode','fullscreen','screenshot','stats','multiview','folder','settings'];
    const toolDests=[D.studio,D.default,D.default,D.settings,D.studio,D.default,D.settings];
    for(let i=0;i<7;i++){
      const btn=frame.findOne(n=>n.name==='tool-btn-'+i)
             || frame.findOne(n=>n.name==='toolbar-btn/'+ICON_TYPES_LOCAL[i]);
      if(!btn)continue;
      const td=toolDests[i]; if(!td||td===frame)continue;
      wire(btn,td.id,i===0||i===4?slideLeft:undefined); wired++;
    }
  }

  const ICON_TYPES=['studio-mode','fullscreen','screenshot','stats','multiview','folder','settings'];

  // ── Settings tab ↔ tab navigation (inside each scene/settings-* frame) ──
  const TABS=['General','Stream','Output','Audio','Video','Hotkeys','Advanced'];
  const tabSceneMap={};
  for(const tab of TABS){const s=sc('scene/settings-'+tab.toLowerCase());if(s)tabSceneMap[tab]=s;}
  for(const [tabName,tabScene] of Object.entries(tabSceneMap)){
    // Wire every OTHER tab's sidebar button → that tab's scene
    for(const [otherTab,otherScene] of Object.entries(tabSceneMap)){
      if(otherTab===tabName)continue;
      // Try multiple name conventions used by buildAdvancedFlows sidebar items
      const btn=nb(tabScene,'tab-'+otherTab.toLowerCase())
             || tabScene.findOne(n=>n.name===otherTab&&n.type!=='TEXT')
             || tabScene.findOne(n=>n.name===otherTab);
      if(btn&&wire(btn,otherScene.id))wired++;
    }
    // Close / Cancel / Apply all return to app/default
    for(const nm of ['settings-close','close','close-btn','btn-cancel','Cancel','btn-apply','Apply','btn-ok','OK']){
      const btn=nb(tabScene,nm);
      if(btn&&wire(btn,appDefault.id))wired++;
    }
  }

  // ── Add-source grid tiles → individual source config scenes ──
  const addSrcFrame=sc('scene/add-source');
  if(addSrcFrame){
    const srcPairs=[
      [['src-display-capture','Display Capture'],              'scene/src-display-capture'],
      [['src-window-capture','Window Capture'],                'scene/src-window-capture'],
      [['src-game-capture','Game Capture'],                    'scene/src-game-capture'],
      [['src-browser-source','Browser Source'],                'scene/src-browser-source'],
      [['src-video-capture','Video Capture','Video Capture Device'],'scene/src-video-capture'],
      [['src-audio-input','Audio Input','Audio Input Capture'],'scene/src-audio-input'],
      [['src-image','Image'],                                  'scene/src-image'],
      [['src-text','Text','Text (FreeType 2)'],                'scene/src-text'],
      [['src-media-source','Media Source'],                    'scene/src-media-source'],
      [['src-color-source','Color Source'],                    'scene/src-color-source'],
    ];
    for(const [tileNames,destName] of srcPairs){
      const destFrame=sc(destName);
      if(!destFrame)continue;
      for(const tileName of tileNames){
        const tile=nb(addSrcFrame,tileName);
        if(tile&&wire(tile,destFrame.id)){wired++;break;}
      }
    }
    const scrimN=addSrcFrame.findOne(n=>n.name==='scrim');
    if(scrimN&&wire(scrimN,appDefault.id))wired++;
    const canN=nb(addSrcFrame,'btn-cancel')||nb(addSrcFrame,'Cancel')||nb(addSrcFrame,'close');
    if(canN&&wire(canN,appDefault.id))wired++;
  }

  // ── Source config scenes: back → add-source, OK/Cancel → app/default ──
  const srcScenes=p3.children.filter(n=>n.type==='FRAME'&&n.name.startsWith('scene/src-'));
  for(const s2 of srcScenes){
    const scrimN=s2.findOne(n=>n.name==='scrim');
    if(scrimN&&wire(scrimN,appDefault.id))wired++;
    const backN=nb(s2,'src-back')||nb(s2,'back-btn')||nb(s2,'Back')||nb(s2,'close');
    if(backN&&addSrcFrame&&wire(backN,addSrcFrame.id))wired++;
    for(const nm of ['src-ok','OK','btn-ok']){const b=nb(s2,nm);if(b&&wire(b,appDefault.id)){wired++;break;}}
    for(const nm of ['src-cancel','Cancel','btn-cancel']){const b=nb(s2,nm);if(b&&wire(b,appDefault.id)){wired++;break;}}
  }

  // ── Streaming / recording confirm modals — Start button triggers state frame ──
  const streamScene=sc('scene/streaming-settings');
  if(streamScene){
    for(const nm of ['Start','btn-start','Start Streaming']){
      const b=nb(streamScene,nm);if(b&&wire(b,D.streaming.id)){wired++;break;}
    }
    const scrimN=streamScene.findOne(n=>n.name==='scrim');
    if(scrimN&&wire(scrimN,appDefault.id))wired++;
  }
  const recScene=sc('scene/recording-settings');
  if(recScene){
    for(const nm of ['Start','btn-start','Start Recording']){
      const b=nb(recScene,nm);if(b&&wire(b,D.recording.id)){wired++;break;}
    }
    const scrimN=recScene.findOne(n=>n.name==='scrim');
    if(scrimN&&wire(scrimN,appDefault.id))wired++;
  }

  // ── Virtual camera modal — Start → app/default; scrim → app/default ──
  const vcScene=sc('scene/virtual-camera');
  if(vcScene){
    for(const nm of ['Start','btn-start','Start Virtual Camera']){
      const b=nb(vcScene,nm);if(b&&wire(b,appDefault.id)){wired++;break;}
    }
    const scrimN=vcScene.findOne(n=>n.name==='scrim');
    if(scrimN&&wire(scrimN,appDefault.id))wired++;
  }

  // ── Also wire the same controls in streaming-live and recording-active ──
  // Start Streaming in streaming-live → already a "Stop Streaming" (handled by WIRES above)
  // Ensure Settings button also works from those frames
  for(const frameName of ['app/streaming-live','app/recording-active']){
    const f=sc(frameName);
    if(!f)continue;
    const settBtn=nb(f,'Settings');
    if(settBtn&&wire(settBtn,D.settings.id))wired++;
    const studioBtn=nb(f,'Studio Mode');
    if(studioBtn&&wire(studioBtn,D.studio.id,slideLeft))wired++;
  }

  log('Wire All: '+wired+' connections across '+allFrames.length+' frames','ok');
  figma.ui.postMessage({type:'ALLWIRE_DONE',count:wired});
}

// ─── Full Design Polish Pass ──────────────────────────────────────────────────
// A–H: preview content, toolbar icons, scene thumbs, source icons,
//       hover states, audio meters, status bar, empty states.
async function buildPolishPass() {
  for (const s of ['Regular','Medium','Semi Bold'])
    await figma.loadFontAsync({family:'Inter',style:s});

  const p3 = figma.root.children.find(p=>p.name.startsWith('03'));
  if (!p3){figma.ui.postMessage({type:'POLISH2_ERROR',error:'Page 03 not found'});return;}
  await p3.loadAsync();

  const C={BASE:'#0B0B0F',SURF:'#14141C',PNL:'#1C1C27',DIV:'#2A2A3A',
           TXT:'#FFFFFF',TXT2:'#B9B9C9',MUT:'#6C6C80',
           ACC:'#8A5CFF',ACCENT2:'#FF4FD8',DANGER:'#FF5470',SUCCESS:'#3DDC97',WARN:'#FFC857'};
  const sp=hex=>solidPaint(hex);
  const APP_FRAMES=['app/default','app/streaming-live','app/recording-active',
                    'app/studio-mode','app/scene-webcam-only','app/scene-screen-share','app/scene-intermission'];
  let polished=0;

  async function T(txt,size,style,hex){
    await figma.loadFontAsync({family:'Inter',style:style||'Regular'});
    const t=figma.createText(); t.fontName={family:'Inter',style:style||'Regular'};
    t.fontSize=size||12; t.characters=String(txt); t.fills=sp(hex||C.TXT); return t;
  }
  function R(w,h,hex,r){const x=figma.createRectangle();x.resize(w,h);if(hex)x.fills=sp(hex);if(r)x.cornerRadius=r;return x;}
  function E(w,h,hex){const e=figma.createEllipse();e.resize(w,h);if(hex)e.fills=sp(hex);return e;}
  function F(w,h,hex,r){const f=figma.createFrame();f.resize(w,h);f.fills=hex?sp(hex):[];if(r)f.cornerRadius=r;return f;}

  // ── A. PREVIEW CANVAS — add realistic screen content ────────────────────────
  async function polishCanvas(canvasNode, label) {
    if (!canvasNode) return;
    // Clear existing children (safe-area dashes) and replace
    canvasNode.children.slice().forEach(c=>c.remove());
    canvasNode.fills = sp('#0A0A12');
    const W=canvasNode.width, H=canvasNode.height;
    // Background gradient (subtle purple-to-black)
    canvasNode.fills = [{
      type:'GRADIENT_LINEAR',
      gradientStops:[
        {color:{r:0.05,g:0.03,b:0.12,a:1},position:0},
        {color:{r:0.04,g:0.04,b:0.07,a:1},position:1}
      ],
      gradientTransform:[[0,1,0],[-1,0,1]]
    }];
    // Safe-area dashed border
    const sa=R(Math.round(W*0.9),Math.round(H*0.9));
    sa.name='safe-area'; sa.fills=[]; sa.strokes=sp('#3A3A4A'); sa.strokeWeight=1; sa.dashPattern=[6,4];
    sa.x=Math.round(W*0.05); sa.y=Math.round(H*0.05); canvasNode.appendChild(sa);
    // Simulated desktop content
    const desk=F(Math.round(W*0.7),Math.round(H*0.6),'#0E0E1A',6);
    desk.x=Math.round(W*0.15); desk.y=Math.round(H*0.2);
    desk.strokes=sp('#2A2A3A'); desk.strokeWeight=1; desk.strokeAlign='INSIDE';
    canvasNode.appendChild(desk);
    // Fake desktop top bar inside
    const dbar=R(desk.width,22,'#1A1A2E'); dbar.y=0; desk.appendChild(dbar);
    // Fake traffic lights
    for (const [i,col] of [['#FF5F57'],['#FFBC2E'],['#28C840']].entries()) {
      const dot=E(8,8,col[0]); dot.x=6+i*12; dot.y=7; desk.appendChild(dot);
    }
    // Fake content bars
    for (let i=0;i<5;i++) {
      const bar=R(Math.round(desk.width*(0.4+Math.random()*0.35)),6,i===0?C.ACC:'#2A2A3A',3);
      bar.x=12; bar.y=34+i*16; bar.opacity=i===0?0.8:0.5; desk.appendChild(bar);
    }
    // "No Signal" / label text
    if (label==='Preview') {
      const lbl=await T('PREVIEW',10,'Semi Bold','#3A3A5A');
      lbl.x=Math.round(W/2)-20; lbl.y=Math.round(H*0.85);
      lbl.textAlignHorizontal='CENTER'; canvasNode.appendChild(lbl);
    }
    polished++;
  }

  // ── B. TOOLBAR ICONS — replace placeholder rectangles with icon shapes ───────
  function drawIcon(btn, type) {
    // Remove old inner rectangle(s)
    btn.children.filter(c=>c.type==='RECTANGLE').forEach(c=>c.remove());
    const S=14, OFF=Math.round((32-S)/2);
    const col = btn.strokes && btn.strokes.length && btn.strokes[0].color && btn.strokes[0].color.r > 0.4 ? C.ACC : C.MUT;
    const container=F(S,S); container.x=OFF; container.y=OFF;
    applyAL(container,'HORIZONTAL',1,0,0); container.primaryAxisSizingMode='FIXED'; container.counterAxisSizingMode='FIXED';
    if (type==='studio-mode') {
      // split-pane: two rects separated by thin line
      const l=R(5,S,'#8A5CFF',1); const d=R(1,S,C.DIV); const r=R(7,S,col,1);
      container.appendChild(l); container.appendChild(d); container.appendChild(r);
    } else if (type==='fullscreen') {
      // 4 corner arrows — simplified as outer rect
      const b=R(S,S); b.fills=[]; b.strokes=sp(col); b.strokeWeight=1.5; b.cornerRadius=1;
      container.appendChild(b);
    } else if (type==='screenshot') {
      // camera: rect with circle
      applyAL(container,'VERTICAL',2,0,0); container.primaryAxisAlignItems='CENTER';
      const body=R(S,10,col,2);
      const lens=E(6,6,C.BASE); lens.x=Math.round((S-6)/2);
      container.appendChild(body); container.appendChild(lens);
    } else if (type==='stats') {
      // bar chart: 3 bars of different heights
      applyAL(container,'HORIZONTAL',2,0,0); container.counterAxisAlignItems='MAX';
      container.appendChild(R(3,6,col,1));
      container.appendChild(R(3,10,C.ACC,1));
      container.appendChild(R(3,S,C.ACCENT2,1));
    } else if (type==='multiview') {
      // 2x2 grid
      applyAL(container,'VERTICAL',2,0,0);
      for (let i=0;i<2;i++) {
        const row=F(S,6); applyAL(row,'HORIZONTAL',2,0,0);
        row.primaryAxisSizingMode='FIXED'; row.counterAxisSizingMode='FIXED';
        row.appendChild(R(6,6,col,1)); row.appendChild(R(6,6,col,1));
        container.appendChild(row);
      }
    } else if (type==='folder') {
      // folder: tab + body
      applyAL(container,'VERTICAL',1,0,0);
      const tab=R(7,3,col,1);
      const body2=R(S,10,col,1);
      container.appendChild(tab); container.appendChild(body2);
    } else if (type==='settings') {
      // gear: circle + ring hint
      applyAL(container,'HORIZONTAL',0,0,0); container.primaryAxisAlignItems='CENTER'; container.counterAxisAlignItems='CENTER';
      const ring=E(S,S); ring.fills=[]; ring.strokes=sp(col); ring.strokeWeight=1.5; container.appendChild(ring);
      const dot=E(5,5,col); dot.x=Math.round((S-5)/2); dot.y=Math.round((S-5)/2); container.appendChild(dot);
    }
    btn.appendChild(container);
  }

  const ICON_TYPES=['studio-mode','fullscreen','screenshot','stats','multiview','folder','settings'];

  // ── C. SCENE THUMBNAILS ──────────────────────────────────────────────────────
  const SCENE_THUMB_COLORS={
    'Main Scene':C.ACC,'Webcam Only':'#8A5CFF','Screen Share':C.SUCCESS,'Intermission':C.WARN
  };
  function addSceneThumbnail(itemFrame,color) {
    const existing=itemFrame.findOne(n=>n.name==='scene-thumb');
    if(existing)existing.remove();
    const thumb=F(28,18,null,3); thumb.name='scene-thumb'; thumb.resize(28,18);
    thumb.fills=[{type:'GRADIENT_LINEAR',gradientStops:[
      {color:Object.assign({a:0.9},hexToRgb(color)),position:0},
      {color:{r:0.04,g:0.04,b:0.07,a:0.9},position:1}
    ],gradientTransform:[[1,0,0],[0,1,0]]}];
    thumb.strokes=sp(color); thumb.strokeWeight=1; thumb.strokeAlign='INSIDE';
    // small content dot
    const dot=R(6,4,'#FFFFFF',1); dot.opacity=0.5; dot.x=11; dot.y=7; thumb.appendChild(dot);
    itemFrame.insertChild(0,thumb);
    polished++;
  }

  // ── D. SOURCE ICONS ──────────────────────────────────────────────────────────
  const SRC_ICON_COLORS={
    'Display Capture':'#3DDC97','display capture':'#3DDC97',
    'Webcam':'#8A5CFF','webcam':'#8A5CFF',
    'Mic/AUX':'#FFC857','mic/aux':'#FFC857',
    'Browser Source':'#FF4FD8','browser source':'#FF4FD8',
    'Image':'#FF5470','image':'#FF5470',
  };
  function enhanceSourceIcon(itemFrame, srcName) {
    const col=SRC_ICON_COLORS[srcName]||SRC_ICON_COLORS[srcName.toLowerCase()]||C.MUT;
    const existing=itemFrame.findOne(n=>n.name==='src-icon');
    if(existing)existing.remove();
    const icon=F(16,16,null,3); icon.name='src-icon';
    icon.fills=[{type:'SOLID',color:hexToRgb(col),opacity:0.2}];
    icon.strokes=sp(col); icon.strokeWeight=1; icon.strokeAlign='INSIDE';
    const dot=E(6,6,col); dot.x=5; dot.y=5; icon.appendChild(dot);
    itemFrame.insertChild(0,icon);
    polished++;
  }

  // ── F. AUDIO METER ENHANCEMENT ───────────────────────────────────────────────
  function enhanceMixerStrip(strip, isMuted) {
    // Find existing meter bar and replace with segmented version
    const existMeter=strip.findOne(n=>n.type==='RECTANGLE'&&n.height===6);
    if(existMeter){
      const parent=existMeter.parent; const idx=parent.children.indexOf(existMeter);
      existMeter.remove();
      const meterRow=F(60,10); meterRow.name='meter-row'; applyAL(meterRow,'HORIZONTAL',1,0,0);
      meterRow.primaryAxisSizingMode='FIXED'; meterRow.counterAxisSizingMode='FIXED';
      // green zone (60%), yellow zone (25%), red zone (15%)
      const g=R(34,10,isMuted?C.DIV:C.SUCCESS,2); g.opacity=isMuted?0.3:0.9; meterRow.appendChild(g);
      const y=R(14,10,isMuted?C.DIV:C.WARN,0); y.opacity=isMuted?0.3:0.6; meterRow.appendChild(y);
      const r=R(9,10,isMuted?C.DIV:C.DANGER,2); r.opacity=isMuted?0.3:0.3; meterRow.appendChild(r);
      // peak hold indicator
      const pk=R(2,10,'#FFFFFF',0); pk.opacity=0.7; meterRow.appendChild(pk);
      parent.insertChild(idx,meterRow);
      polished++;
    }
    // Replace slider track with gradient
    const sliderTrack=strip.findOne(n=>n.type==='RECTANGLE'&&n.height===40);
    if(sliderTrack&&!isMuted){
      sliderTrack.fills=[{
        type:'GRADIENT_LINEAR',
        gradientStops:[{color:{r:0.54,g:0.36,b:1,a:0.6},position:0},{color:{r:0.16,g:0.16,b:0.2,a:0.4},position:1}],
        gradientTransform:[[0,1,0],[-1,0,1]]
      }];
    }
  }

  // ── G. STATUS BAR — realistic metrics ────────────────────────────────────────
  async function polishStatusBar(statusBar) {
    if(!statusBar) return;
    // Clear and rebuild with richer data
    statusBar.children.slice().forEach(c=>c.remove());
    applyAL(statusBar,'HORIZONTAL',0,12,0); statusBar.counterAxisAlignItems='CENTER';
    statusBar.primaryAxisSizingMode='FIXED'; statusBar.counterAxisSizingMode='FIXED';
    const metrics=[
      {txt:'⬤ CONNECTED',col:'#3DDC97'},{txt:'|',col:C.DIV},
      {txt:'CPU: 12.4%',col:C.TXT2},{txt:'|',col:C.DIV},
      {txt:'60.0 FPS',col:C.SUCCESS},{txt:'|',col:C.DIV},
      {txt:'Dropped: 0 (0%)',col:C.TXT2},{txt:'|',col:C.DIV},
      {txt:'Skipped: 0',col:C.TXT2},{txt:'|',col:C.DIV},
      {txt:'Disk: 850 GB free',col:C.TXT2},{txt:'|',col:C.DIV},
      {txt:'⬤ REC 00:12:34',col:C.DANGER},{txt:'|',col:C.DIV},
      {txt:'⬤ LIVE 01:05:22',col:C.DANGER},
    ];
    for(const m of metrics){
      const t=await T(m.txt,10,'Regular',m.col);
      statusBar.appendChild(t);
    }
    polished++;
  }

  // ── H. EMPTY STATE for blank panels ──────────────────────────────────────────
  async function addEmptyState(panel, message, iconChar) {
    const existEmpty=panel.findOne(n=>n.name==='empty-state');
    if(existEmpty) return; // already has one
    const es=F(panel.width-20,60); es.name='empty-state';
    applyAL(es,'VERTICAL',4,0,8); es.primaryAxisAlignItems='CENTER'; es.counterAxisAlignItems='CENTER';
    es.primaryAxisSizingMode='FIXED'; es.counterAxisSizingMode='AUTO';
    const ic=await T(iconChar||'+',18,'Semi Bold',C.MUT);
    const tx=await T(message,11,'Regular',C.MUT);
    tx.textAlignHorizontal='CENTER';
    es.appendChild(ic); es.appendChild(tx);
    panel.appendChild(es);
    polished++;
  }

  // ─── Apply to all app frames ────────────────────────────────────────────────
  for(const frameName of APP_FRAMES){
    const appFrame=p3.findOne(n=>n.name===frameName&&n.type==='FRAME');
    if(!appFrame)continue;

    // A. Preview canvas
    const previewCanvas=appFrame.findOne(n=>n.name==='canvas'&&n.parent&&n.parent.name==='preview-canvas');
    if(previewCanvas) await polishCanvas(previewCanvas,'Preview');
    const programCanvas=appFrame.findOne(n=>n.name==='canvas'&&n.parent&&n.parent.name==='program-canvas');
    if(programCanvas) await polishCanvas(programCanvas,'Program');
    // Also try by direct canvas name
    const canvases=appFrame.findAll(n=>n.name==='canvas'&&n.type==='FRAME');
    for(const cv of canvases) if(cv.width>100) await polishCanvas(cv,'Preview');

    // B. Toolbar icons
    const toolbar=appFrame.findOne(n=>n.name==='toolbar'||n.name==='toolbar/main');
    if(toolbar){
      for(let i=0;i<7;i++){
        const btn=toolbar.findOne(n=>n.name==='tool-btn-'+i)
               || toolbar.findOne(n=>n.name==='toolbar-btn/'+ICON_TYPES[i]);
        if(btn) { drawIcon(btn,ICON_TYPES[i]); polished++; }
      }
    }

    // C. Scene thumbnails
    const scenesPanel=appFrame.findOne(n=>n.name==='scenes-panel'||n.name==='panel/scenes'
                                     ||(n.type==='FRAME'&&n.name.toLowerCase().includes('scenes')));
    if(scenesPanel){
      for(const [sceneName,col] of Object.entries(SCENE_THUMB_COLORS)){
        const item=scenesPanel.findOne(n=>n.name===sceneName&&n.type!=='TEXT');
        if(item) addSceneThumbnail(item,col);
      }
    }
    // Also search left-dock
    const leftDock=appFrame.findOne(n=>n.name==='left-dock');
    if(leftDock){
      for(const [sceneName,col] of Object.entries(SCENE_THUMB_COLORS)){
        const item=leftDock.findOne(n=>n.name===sceneName&&n.type!=='TEXT');
        if(item) addSceneThumbnail(item,col);
      }
    }

    // D. Source icons
    const sourceNames=['Display Capture','Webcam','Mic/AUX','Browser Source','Image'];
    const sourceLookup=appFrame.findOne(n=>n.name==='left-dock')||appFrame;
    for(const srcName of sourceNames){
      const item=sourceLookup.findOne(n=>n.name===srcName&&n.type!=='TEXT');
      if(item) enhanceSourceIcon(item,srcName);
    }

    // E. Hover states — add subtle hover fill to all control buttons
    const ctrlPanel=appFrame.findOne(n=>n.name==='controls-panel');
    if(ctrlPanel){
      for(const btn of ctrlPanel.findAll(n=>n.type==='FRAME'&&n.height===34||n.height===36)){
        if(!btn.effects||!btn.effects.length){
          btn.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.2},offset:{x:0,y:2},radius:4,spread:0,visible:true,blendMode:'NORMAL'}];
          polished++;
        }
      }
    }

    // F. Audio meters
    const strips=appFrame.findAll(n=>n.name&&n.name.startsWith('strip-')&&n.type==='FRAME');
    for(const strip of strips){
      const isMuted=strip.name==='strip-Mic/Aux'||strip.name==='strip-Mic/AUX';
      enhanceMixerStrip(strip,isMuted);
    }

    // G. Status bar
    const statusBar=appFrame.findOne(n=>n.name==='statusbar');
    if(statusBar) await polishStatusBar(statusBar);

  }

  log('Polish pass complete: '+polished+' elements enhanced','ok');
  figma.ui.postMessage({type:'POLISH2_DONE',count:polished});
}

// ─── Complete Wire — creates missing scenes + wires every button ──────────────
// The definitive "make every button work" pass.
// 1. Builds any missing scene-variant frames
// 2. Runs explicit named wiring (all known button→destination pairs)
// 3. Fallback sweep: any FRAME that looks like a button but has no reactions → wire to appDefault
async function buildCompleteWire() {
  for (const s of ['Regular','Medium','Semi Bold'])
    await figma.loadFontAsync({family:'Inter',style:s});

  const p3 = figma.root.children.find(p => p.name.startsWith('03'));
  if (!p3) { figma.ui.postMessage({type:'COMPLETEWIRE_ERROR',error:'Page 03 not found'}); return; }
  await p3.loadAsync();

  // ── Self-probe ──
  let PT = null;
  {
    const a=figma.createFrame(); a.name='__cw_a'; a.resize(10,10);
    const b=figma.createFrame(); b.name='__cw_b'; b.resize(10,10);
    p3.appendChild(a); p3.appendChild(b);
    const FMTS=[
      [{trigger:{type:'ON_CLICK'},action:{type:'NODE',destinationId:b.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false},actions:[{type:'NODE',destinationId:b.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}],
      [{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:b.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}],
      [{trigger:{type:'ON_CLICK'},action:{type:'NODE',destinationId:b.id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}}],
    ];
    for(let i=0;i<FMTS.length;i++){try{a.reactions=FMTS[i];const s=a.reactions;if(s&&s.length>0){PT=s[0];break;}}catch(e){}}
    a.remove(); b.remove();
  }
  if(!PT){figma.ui.postMessage({type:'COMPLETEWIRE_ERROR',error:'Reaction probe failed'});return;}

  function wire(node,destId,tr){
    if(!node||!destId)return false;
    const r=JSON.parse(JSON.stringify(PT));
    const p=a=>{if(a&&a.type==='NODE'){a.destinationId=destId;if(tr!==undefined)a.transition=tr;}};
    p(r.action); if(r.actions)r.actions.forEach(p);
    try{node.reactions=[r];return true;}catch(e){return false;}
  }
  function nb(parent,name){
    return parent.findOne(n=>n.name===name&&n.type!=='TEXT')
        || parent.findOne(n=>n.name===name);
  }
  function sc(name){return p3.findOne(n=>n.name===name&&n.type==='FRAME');}

  const dis={type:'DISSOLVE',duration:0.25,easing:{type:'EASE_OUT'}};
  const slideL={type:'MOVE_IN',direction:'LEFT',duration:0.3,easing:{type:'EASE_OUT'}};
  const APP_W=1440,APP_H=900;
  let wired=0;

  const appDefault=sc('app/default');
  if(!appDefault){figma.ui.postMessage({type:'COMPLETEWIRE_ERROR',error:'app/default not found'});return;}

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. CREATE MISSING SCENE FRAMES
  //    Scene switcher variants + placeholder menu overlays
  // ─────────────────────────────────────────────────────────────────────────────

  // Scene label badge helper
  async function makeBadge(label,color){
    const b=figma.createFrame(); b.name='scene-badge'; b.resize(220,36);
    b.fills=[{type:'SOLID',color:hexToRgb(color)}]; b.cornerRadius=8;
    b.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.5},offset:{x:0,y:4},radius:16,spread:0,visible:true,blendMode:'NORMAL'}];
    applyAL(b,'HORIZONTAL',0,0,0); b.primaryAxisAlignItems='CENTER'; b.counterAxisAlignItems='CENTER';
    b.primaryAxisSizingMode='FIXED'; b.counterAxisSizingMode='FIXED';
    const t=figma.createText(); t.fontName={family:'Inter',style:'Semi Bold'}; t.fontSize=14;
    t.characters=label; t.fills=solidPaint('#FFFFFF'); b.appendChild(t); return b;
  }

  // Create app/scene-* frames as clones of app/default with a coloured badge overlay
  const SCENE_VARIANTS=[
    {name:'app/scene-webcam-only',  label:'⬤ WEBCAM ONLY',    color:'#8A5CFF'},
    {name:'app/scene-screen-share', label:'⬤ SCREEN SHARE',   color:'#3DDC97'},
    {name:'app/scene-intermission', label:'⬤ INTERMISSION',    color:'#FFC857'},
  ];
  for(const {name,label,color} of SCENE_VARIANTS){
    if(!sc(name)){
      const f=appDefault.clone(); f.name=name;
      // position to the right of the last frame
      const frames=p3.children.filter(n=>n.type==='FRAME');
      const rightmost=frames.reduce((a,b)=>a.x>b.x?a:b,frames[0]);
      f.x=rightmost.x+rightmost.width+80; f.y=appDefault.y;
      p3.appendChild(f);
      // add scene indicator badge
      const badge=await makeBadge(label,color);
      f.appendChild(badge);
      badge.x=Math.round((APP_W-badge.width)/2);
      badge.y=Math.round(APP_H/2)-60;
      // wire its own back button to app/default
      const stopS=nb(f,'Stop Streaming'); if(stopS)wire(stopS,appDefault.id);
      const stopR=nb(f,'Stop Recording'); if(stopR)wire(stopR,appDefault.id);
      log('Created scene: '+name,'ok');
    }
  }

  // Simple menu-dropdown overlay factory
  async function makeMenuOverlay(menuName,items,anchorX){
    const sceneName='scene/menu-'+menuName.toLowerCase();
    if(sc(sceneName)){return sc(sceneName);}
    const scene=figma.createFrame(); scene.name=sceneName; scene.resize(APP_W,APP_H);
    scene.fills=[{type:'SOLID',color:{r:0.04,g:0.04,b:0.07}}];
    // transparent click-away scrim
    const scrim=figma.createRectangle(); scrim.name='scrim'; scrim.resize(APP_W,APP_H);
    scrim.fills=[{type:'SOLID',color:{r:0,g:0,b:0},opacity:0.35}];
    scene.appendChild(scrim);
    // dropdown panel
    const dd=figma.createFrame(); dd.name='menu-dropdown';
    dd.fills=solidPaint('#1C1C27'); dd.cornerRadius=8;
    dd.strokes=solidPaint('#2A2A3A'); dd.strokeWeight=1; dd.strokeAlign='INSIDE';
    dd.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.6},offset:{x:0,y:8},radius:24,spread:0,visible:true,blendMode:'NORMAL'}];
    applyAL(dd,'VERTICAL',0,0,4); dd.primaryAxisSizingMode='AUTO'; dd.counterAxisSizingMode='FIXED';
    dd.resize(200,items.length*36+8);
    for(const item of items){
      if(item==='---'){
        const sep=figma.createRectangle(); sep.name='separator'; sep.resize(180,1); sep.fills=solidPaint('#2A2A3A');
        const sepRow=figma.createFrame(); sepRow.name='sep-row'; sepRow.fills=[]; sepRow.resize(200,9);
        applyAL(sepRow,'HORIZONTAL',0,10,4); sepRow.primaryAxisSizingMode='FIXED'; sepRow.counterAxisSizingMode='FIXED';
        sepRow.primaryAxisAlignItems='CENTER'; sepRow.counterAxisAlignItems='CENTER';
        sepRow.appendChild(sep); dd.appendChild(sepRow);
      } else {
        const row=figma.createFrame(); row.name='menu-item-'+item.toLowerCase().replace(/[^a-z0-9]/g,'-');
        row.fills=[]; row.cornerRadius=4; row.resize(200,36);
        applyAL(row,'HORIZONTAL',0,12,0); row.counterAxisAlignItems='CENTER';
        row.primaryAxisSizingMode='FIXED'; row.counterAxisSizingMode='FIXED';
        const t=figma.createText(); t.fontName={family:'Inter',style:'Regular'}; t.fontSize=13;
        t.characters=item; t.fills=solidPaint('#B9B9C9'); row.appendChild(t);
        dd.appendChild(row);
      }
    }
    scene.appendChild(dd);
    dd.x=anchorX; dd.y=52;
    // place to right of last frame
    const frames=p3.children.filter(n=>n.type==='FRAME');
    const rightmost=frames.reduce((a,b)=>a.x>b.x?a:b,frames[0]);
    scene.x=rightmost.x+rightmost.width+80; scene.y=appDefault.y;
    p3.appendChild(scene);
    return scene;
  }

  // Build menu overlays
  const menuFile  = await makeMenuOverlay('file',  ['New Scene Collection','Open…','Save','Save As…','---','Import…','Export…','---','Remux Recordings','Check File Integrity…','---','Show Recordings Folder','---','Exit'],4);
  const menuEdit  = await makeMenuOverlay('edit',  ['Undo','Redo','---','Copy','Paste','Duplicate','---','Select All'],44);
  const menuView  = await makeMenuOverlay('view',  ['Docks','---','Stats','Log Viewer','Audio Mixer','---','Fullscreen','---','Lock Docks','---','Reset to Default Layout'],88);
  const menuTools = await makeMenuOverlay('tools', ['Auto-Configuration Wizard…','---','Output Timer','Captions (Experimental)','---','Script Editor…','---','Hotkeys…','---','Virtual Camera','---','QR Code'],320);
  const menuHelp  = await makeMenuOverlay('help',  ['Help Portal','Forum','Discord','---','Check for Updates','---','About OBS Studio'],1360);

  // Wire scrim in each menu overlay → app/default
  for(const mScene of [menuFile,menuEdit,menuView,menuTools,menuHelp]){
    if(!mScene)continue;
    const s=mScene.findOne(n=>n.name==='scrim');
    if(s&&wire(s,appDefault.id))wired++;
    // wire every menu item row → app/default (selecting any item dismisses the menu)
    const rows=mScene.findAll(n=>n.name.startsWith('menu-item-')&&n.type==='FRAME');
    for(const row of rows){if(wire(row,appDefault.id))wired++;}
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. EXPLICIT NAMED WIRING across all frames
  // ─────────────────────────────────────────────────────────────────────────────

  // Build destination map (after scene creation, re-query)
  const D={
    default:      appDefault,
    streaming:    sc('app/streaming-live')    || appDefault,
    recording:    sc('app/recording-active')  || appDefault,
    studio:       sc('app/studio-mode')       || appDefault,
    settings:     sc('scene/settings-general') || sc('scene/hotkeys') || appDefault,
    addSource:    sc('scene/add-source')      || appDefault,
    virtualCam:   sc('scene/virtual-camera')  || appDefault,
    webcamOnly:   sc('app/scene-webcam-only')  || appDefault,
    screenShare:  sc('app/scene-screen-share') || appDefault,
    intermission: sc('app/scene-intermission') || appDefault,
    menuFile,menuEdit,menuView,menuTools,menuHelp,
  };

  const WIRES=[
    // Controls panel
    {names:['Start Streaming'],                                 dest:D.streaming},
    {names:['Stop Streaming'],                                  dest:D.default},
    {names:['Start Recording'],                                 dest:D.recording},
    {names:['Stop Recording'],                                  dest:D.default},
    {names:['Virtual Camera','Start Virtual Camera'],           dest:D.virtualCam},
    {names:['Stop Virtual Camera'],                             dest:D.default},
    {names:['Studio Mode'],                                     dest:D.studio, tr:slideL},
    {names:['Settings'],                                        dest:D.settings},
    {names:['Exit'],                                            dest:D.default},
    // ── Toolbar icon buttons (7 squares at top) ──
    // tool-btn-0 = Studio Mode, tool-btn-3 = Stats, tool-btn-6 = Settings
    {names:['tool-btn-0','toolbar-btn/studio-mode'],            dest:D.studio, tr:slideL},
    {names:['tool-btn-1','toolbar-btn/fullscreen-preview'],     dest:D.default},
    {names:['tool-btn-2','toolbar-btn/screenshot'],             dest:D.default},
    {names:['tool-btn-3','toolbar-btn/stats'],                  dest:D.settings},
    {names:['tool-btn-4','toolbar-btn/multiview'],              dest:D.studio},
    {names:['tool-btn-5','toolbar-btn/recording-folder'],       dest:D.default},
    {names:['tool-btn-6','toolbar-btn/settings'],               dest:D.settings},
    // Menu bar items
    {names:['File','menu-file'],                                dest:D.menuFile},
    {names:['Edit','menu-edit'],                                dest:D.menuEdit},
    {names:['View','menu-view'],                                dest:D.menuView},
    {names:['Tools','menu-tools'],                              dest:D.menuTools},
    {names:['Help','menu-help'],                                dest:D.menuHelp},
    // Add source
    {names:['SCENES+','btn-add-source','btn-add'],              dest:D.addSource},
    // Scene panel items
    {names:['Main Scene'],                                      dest:D.default},
    {names:['Webcam Only'],                                     dest:D.webcamOnly},
    {names:['Screen Share'],                                    dest:D.screenShare},
    {names:['Intermission'],                                    dest:D.intermission},
    // Generic close/cancel/back/apply
    {names:['close','close-btn','btn-close','settings-close'],  dest:D.default},
    {names:['btn-cancel','Cancel'],                             dest:D.default},
    {names:['btn-ok','OK','btn-apply','Apply'],                 dest:D.default},
  ];

  const allFrames=p3.children.filter(n=>n.type==='FRAME');
  for(const frame of allFrames){
    for(const {names,dest,tr} of WIRES){
      if(!dest)continue;
      for(const name of names){
        const node=nb(frame,name);
        if(node&&wire(node,dest.id,tr)){wired++;break;}
      }
    }
  }

  // Settings tab-to-tab navigation
  const TABS=['General','Stream','Output','Audio','Video','Hotkeys','Advanced'];
  const tabMap={};
  for(const t of TABS){const s=sc('scene/settings-'+t.toLowerCase());if(s)tabMap[t]=s;}
  for(const [tName,tScene] of Object.entries(tabMap)){
    for(const [oName,oScene] of Object.entries(tabMap)){
      if(oName===tName)continue;
      const btn=nb(tScene,'tab-'+oName.toLowerCase())
             ||tScene.findOne(n=>n.name===oName&&n.type!=='TEXT')
             ||tScene.findOne(n=>n.name===oName);
      if(btn&&wire(btn,oScene.id))wired++;
    }
    for(const nm of ['settings-close','close','close-btn','btn-cancel','Cancel','btn-apply','Apply','btn-ok','OK']){
      const btn=nb(tScene,nm); if(btn&&wire(btn,appDefault.id))wired++;
    }
  }

  // Add-source tiles → source config scenes
  const addSrcF=sc('scene/add-source');
  if(addSrcF){
    const srcPairs=[
      [['src-display-capture','Display Capture'],              'scene/src-display-capture'],
      [['src-window-capture','Window Capture'],                'scene/src-window-capture'],
      [['src-game-capture','Game Capture'],                    'scene/src-game-capture'],
      [['src-browser-source','Browser Source'],                'scene/src-browser-source'],
      [['src-video-capture','Video Capture','Video Capture Device'],'scene/src-video-capture'],
      [['src-audio-input','Audio Input','Audio Input Capture'],'scene/src-audio-input'],
      [['src-image','Image'],                                  'scene/src-image'],
      [['src-text','Text','Text (FreeType 2)'],                'scene/src-text'],
    ];
    for(const [tileNames,destName] of srcPairs){
      const df=sc(destName); if(!df)continue;
      for(const tn of tileNames){const t=nb(addSrcF,tn);if(t&&wire(t,df.id)){wired++;break;}}
    }
    const sc2=addSrcF.findOne(n=>n.name==='scrim');
    if(sc2&&wire(sc2,appDefault.id))wired++;
    const cn=nb(addSrcF,'btn-cancel')||nb(addSrcF,'Cancel')||nb(addSrcF,'close');
    if(cn&&wire(cn,appDefault.id))wired++;
  }

  // Source config close/cancel/OK
  const srcCfgScenes=p3.children.filter(n=>n.type==='FRAME'&&n.name.startsWith('scene/src-'));
  for(const sc3 of srcCfgScenes){
    const scrimN=sc3.findOne(n=>n.name==='scrim'); if(scrimN&&wire(scrimN,appDefault.id))wired++;
    const backN=nb(sc3,'src-back')||nb(sc3,'back-btn')||nb(sc3,'Back')||nb(sc3,'close');
    if(backN&&addSrcF&&wire(backN,addSrcF.id))wired++;
    for(const nm of ['src-ok','OK','btn-ok']){const b=nb(sc3,nm);if(b&&wire(b,appDefault.id)){wired++;break;}}
    for(const nm of ['src-cancel','Cancel','btn-cancel']){const b=nb(sc3,nm);if(b&&wire(b,appDefault.id)){wired++;break;}}
  }

  // Streaming/recording confirm scenes
  const streamSc=sc('scene/streaming-settings');
  if(streamSc){
    for(const nm of ['Start','btn-start','Start Streaming']){const b=nb(streamSc,nm);if(b&&wire(b,D.streaming.id)){wired++;break;}}
    const scrimN=streamSc.findOne(n=>n.name==='scrim'); if(scrimN&&wire(scrimN,appDefault.id))wired++;
  }
  const recSc=sc('scene/recording-settings');
  if(recSc){
    for(const nm of ['Start','btn-start','Start Recording']){const b=nb(recSc,nm);if(b&&wire(b,D.recording.id)){wired++;break;}}
    const scrimN=recSc.findOne(n=>n.name==='scrim'); if(scrimN&&wire(scrimN,appDefault.id))wired++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. FALLBACK SWEEP — wire every remaining button-like node to appDefault
  //    Heuristic: FRAME, height 20–52px, has ≥1 TEXT descendant,
  //    has at least 1 fill, no reactions yet, name not a layout container
  // ─────────────────────────────────────────────────────────────────────────────
  const SKIP_NAMES=new Set([
    'workspace','left-dock','right-dock','top-bar','bottom-bar','menu-bar','toolbar',
    'preview-area','program-area','canvas','viewport','split','sidebar','main-content',
    'content','body','header','footer','titlebar','scrim','background','divider',
    'separator','spacer','overlay','panel/preview','panel/program',
  ]);
  // substring patterns to skip
  const SKIP_PATTERNS=['-panel','-dock','panel/','-area','workspace','app/'];

  function isSkippable(name){
    if(!name)return true;
    if(SKIP_NAMES.has(name))return true;
    const n=name.toLowerCase();
    for(const p of SKIP_PATTERNS){if(n.includes(p))return true;}
    return false;
  }

  let fallback=0;
  const appFrameNames=['app/default','app/streaming-live','app/recording-active','app/studio-mode',
                        'app/scene-webcam-only','app/scene-screen-share','app/scene-intermission'];

  for(const frameName of appFrameNames){
    const appFrame=sc(frameName); if(!appFrame)continue;
    // For this frame, pick a fallback dest that is NOT itself
    // (so clicking does something visually noticeable)
    const fallbackDest = (appFrame===appDefault) ? D.settings : appDefault;
    const candidates=appFrame.findAll(n=>{
      if(n.type!=='FRAME')return false;
      if(n.reactions&&n.reactions.length>0)return false; // already wired
      if(isSkippable(n.name))return false;
      if(n.height<20||n.height>52)return false;
      const hasText=n.findOne(c=>c.type==='TEXT');
      if(!hasText)return false;
      if(!n.fills||n.fills.length===0)return false;
      return true;
    });
    for(const node of candidates){
      if(wire(node,fallbackDest.id)){fallback++;wired++;}
    }
  }

  log('Explicit: '+(wired-fallback)+' | Fallback sweep: '+fallback+' | Total: '+wired,'ok');
  figma.ui.postMessage({type:'COMPLETEWIRE_DONE',count:wired,fallback});
}

// ─── Message handler ──────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'BUILD') {
    await runBuild();
  } else if (msg.type === 'BUILD_MISSING') {
    try {
      figma.ui.postMessage({ type: 'MISSING_START' });
      await buildMissingPanels();
    } catch(err) {
      figma.ui.postMessage({ type: 'MISSING_ERROR', error: String(err) });
      console.error('[OBS UIKit] missing panels', err);
    }
  } else if (msg.type === 'BUILD_POLISH') {
    try {
      await polishAppFrames();
    } catch(err) {
      figma.ui.postMessage({ type: 'POLISH_ERROR', error: String(err) });
      console.error('[OBS UIKit] polish', err);
    }
  } else if (msg.type === 'BUILD_ICONS') {
    try {
      await buildRealIcons();
    } catch(err) {
      figma.ui.postMessage({ type: 'ICONS_ERROR', error: String(err) });
      console.error('[OBS UIKit] icons', err);
    }
  } else if (msg.type === 'CLEAN_ORPHANS') {
    try {
      let removed = 0;
      for (const pg of figma.root.children) {
        await pg.loadAsync();
        const orphans = pg.findAll(n =>
          n.parent === pg && (n.name === 'floating/mixer' || n.name === 'floating/stats')
        );
        orphans.forEach(n => { n.remove(); removed++; });
      }
      figma.ui.postMessage({ type: 'ORPHANS_DONE', count: removed });
    } catch(err) {
      figma.ui.postMessage({ type: 'ORPHANS_ERROR', error: String(err) });
    }
  } else if (msg.type === 'BUILD_REFFRAME') {
    try {
      await buildRefAppFrame();
    } catch(err) {
      figma.ui.postMessage({ type: 'REFFRAME_ERROR', error: String(err) });
      console.error('[OBS UIKit] refframe', err);
    }
  } else if (msg.type === 'REORG_PAGE01') {
    try {
      await reorganizePage01();
    } catch(err) {
      figma.ui.postMessage({ type: 'REORG_ERROR', error: String(err) });
      console.error('[OBS UIKit] reorg', err);
    }
  } else if (msg.type === 'BUILD_PROTO') {
    try {
      await buildPrototype();
    } catch(err) {
      figma.ui.postMessage({ type: 'PROTO_ERROR', error: String(err) });
      console.error('[OBS UIKit] prototype', err);
    }
  } else if (msg.type === 'BUILD_ENHANCE') {
    try {
      await buildEnhancement();
    } catch(err) {
      figma.ui.postMessage({ type: 'ENHANCE_ERROR', error: String(err) });
      console.error('[OBS UIKit] enhance', err);
    }
  } else if (msg.type === 'DIAGNOSE_REACTIONS') {
    // Dump the raw reaction JSON from the selected node so we can inspect the format
    const sel = figma.currentPage.selection;
    if (!sel.length) {
      figma.ui.postMessage({ type: 'DIAG_RESULT', result: 'Select a node with existing prototype reactions first.' });
    } else {
      const node = sel[0];
      const raw = JSON.stringify(node.reactions, null, 2);
      figma.ui.postMessage({ type: 'DIAG_RESULT', result: raw || '(no reactions)' });
    }
  } else if (msg.type === 'BUILD_MPROTO') {
    try {
      await buildModalPrototypes();
    } catch(err) {
      figma.ui.postMessage({ type: 'MPROTO_ERROR', error: String(err) });
      console.error('[OBS UIKit] modal-proto', err);
    }
  } else if (msg.type === 'BUILD_FEATURES') {
    try {
      await buildFeatureComponents();
    } catch(err) {
      figma.ui.postMessage({ type: 'FEATURES_ERROR', error: String(err) });
      console.error('[OBS UIKit] features', err);
    }
  } else if (msg.type === 'BUILD_ADV') {
    try {
      await buildAdvancedFlows();
    } catch(err) {
      figma.ui.postMessage({ type: 'ADV_ERROR', error: String(err) });
      console.error('[OBS UIKit] advanced-flows', err);
    }
  } else if (msg.type === 'BUILD_PDF') {
    try {
      await buildPDFExport();
    } catch(err) {
      figma.ui.postMessage({ type: 'PDF_ERROR', error: String(err) });
      console.error('[OBS UIKit] pdf', err);
    }
  } else if (msg.type === 'BUILD_ALLWIRE') {
    try {
      await buildAllInteractions();
    } catch(err) {
      figma.ui.postMessage({ type: 'ALLWIRE_ERROR', error: String(err) });
      console.error('[OBS UIKit] allwire', err);
    }
  } else if (msg.type === 'BUILD_POLISH2') {
    try {
      await buildPolishPass();
    } catch(err) {
      figma.ui.postMessage({ type: 'POLISH2_ERROR', error: String(err) });
      console.error('[OBS UIKit] polish2', err);
    }
  } else if (msg.type === 'BUILD_COMPLETEWIRE') {
    try {
      await buildCompleteWire();
    } catch(err) {
      figma.ui.postMessage({ type: 'COMPLETEWIRE_ERROR', error: String(err) });
      console.error('[OBS UIKit] completewire', err);
    }
  } else if (msg.type === 'CANCEL') {
    buildCancelled = true;
  }
};
