// ─── Full 1440×900 assembled app frames ──────────────────────────────────────
// Frames: app/default, app/studio-mode, app/floating-windows

const {
  solidPaint, accentGradientPaint, accentGlow,
  applyAutoLayout, hexToRgb,
} = require('../helpers');

async function loadFonts() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
}

async function tx(str, size, weight, color) {
  await figma.loadFontAsync({ family: 'Inter', style: weight });
  const t = figma.createText();
  t.fontName   = { family: 'Inter', style: weight };
  t.fontSize   = size;
  t.characters = str;
  t.fills      = solidPaint(color);
  return t;
}

// ─── Shared sub-builders ─────────────────────────────────────────────────────

function makeMenuBar() {
  const bar = figma.createFrame();
  bar.name  = 'menubar';
  bar.resize(1440, 30);
  bar.fills = solidPaint('#14141C');
  bar.strokes = solidPaint('#2A2A3A');
  bar.strokeWeight = 1;
  bar.strokeAlign  = 'OUTSIDE';
  applyAutoLayout(bar, 'HORIZONTAL', 0, 8, 0);
  bar.primaryAxisSizingMode = 'FIXED';
  bar.counterAxisSizingMode = 'FIXED';
  bar.counterAxisAlignItems = 'CENTER';

  const icon = figma.createRectangle();
  icon.name  = 'app-icon';
  icon.resize(18, 18);
  icon.cornerRadius = 4;
  icon.fills = accentGradientPaint();
  bar.appendChild(icon);

  return bar;
}

function makeToolbar() {
  const bar = figma.createFrame();
  bar.name  = 'toolbar';
  bar.resize(1440, 40);
  bar.fills = solidPaint('#14141C');
  bar.strokes = solidPaint('#2A2A3A');
  bar.strokeWeight = 1;
  bar.strokeAlign  = 'OUTSIDE';
  applyAutoLayout(bar, 'HORIZONTAL', 4, 8, 0);
  bar.primaryAxisSizingMode = 'FIXED';
  bar.counterAxisSizingMode = 'FIXED';
  bar.counterAxisAlignItems = 'CENTER';

  for (let i = 0; i < 7; i++) {
    const btn = figma.createFrame();
    btn.name  = 'tool-btn-' + i;
    btn.resize(32, 32);
    btn.cornerRadius = 6;
    btn.fills = i === 3
      ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.18 }]
      : solidPaint('#1C1C27');
    btn.strokes = solidPaint(i === 3 ? '#8A5CFF' : '#2A2A3A');
    btn.strokeWeight = 1;
    btn.strokeAlign  = 'INSIDE';
    if (i === 3) btn.effects = [accentGlow()];
    applyAutoLayout(btn, 'HORIZONTAL', 0, 0, 0);
    btn.primaryAxisAlignItems = 'CENTER';
    btn.counterAxisAlignItems = 'CENTER';
    btn.primaryAxisSizingMode = 'FIXED';
    btn.counterAxisSizingMode = 'FIXED';
    const ico = figma.createRectangle();
    ico.resize(14, 14);
    ico.cornerRadius = 3;
    ico.fills = solidPaint(i === 3 ? '#8A5CFF' : '#6C6C80');
    btn.appendChild(ico);
    bar.appendChild(btn);
  }
  return bar;
}

function makeStatusBar() {
  const bar = figma.createFrame();
  bar.name  = 'statusbar';
  bar.resize(1440, 24);
  bar.fills = solidPaint('#0B0B0F');
  bar.strokes = solidPaint('#2A2A3A');
  bar.strokeWeight = 1;
  bar.strokeAlign  = 'OUTSIDE';
  applyAutoLayout(bar, 'HORIZONTAL', 12, 12, 0);
  bar.primaryAxisSizingMode = 'FIXED';
  bar.counterAxisSizingMode = 'FIXED';
  bar.counterAxisAlignItems = 'CENTER';
  return bar;
}

// ─── Panel builder helpers ────────────────────────────────────────────────────

async function makePanelHeader(title, w) {
  const h = figma.createFrame();
  h.name  = 'panel-header';
  h.resize(w, 34);
  h.fills = solidPaint('#14141C');
  applyAutoLayout(h, 'HORIZONTAL', 6, 10, 0);
  h.primaryAxisSizingMode  = 'FIXED';
  h.counterAxisSizingMode  = 'FIXED';
  h.counterAxisAlignItems  = 'CENTER';
  h.primaryAxisAlignItems  = 'SPACE_BETWEEN';

  const drag = figma.createRectangle();
  drag.resize(5, 14);
  drag.cornerRadius = 3;
  drag.fills = solidPaint('#2A2A3A');
  h.appendChild(drag);

  const t = await tx(title, 12, 'Medium', '#FFFFFF');
  t.layoutGrow = 1;
  h.appendChild(t);

  const closeBtn = figma.createRectangle();
  closeBtn.resize(10, 10);
  closeBtn.cornerRadius = 5;
  closeBtn.fills = solidPaint('#FF5470');
  h.appendChild(closeBtn);

  return h;
}

async function makeScenesPanel(w, h) {
  const panel = figma.createFrame();
  panel.name  = 'scenes-panel';
  panel.resize(w, h);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 8;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';
  panel.appendChild(await makePanelHeader('Scenes', w));

  const div = figma.createRectangle();
  div.resize(w, 1);
  div.fills = solidPaint('#2A2A3A');
  panel.appendChild(div);

  const list = figma.createFrame();
  list.name  = 'scene-list';
  list.fills = [];
  list.resize(w, h - 35);
  applyAutoLayout(list, 'VERTICAL', 2, 6, 4);
  list.primaryAxisSizingMode = 'FIXED';
  list.counterAxisSizingMode = 'FIXED';
  list.layoutGrow = 1;

  const scenes = ['Main Scene', 'Webcam Only', 'Screen Share', 'Intermission'];
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  for (let i = 0; i < scenes.length; i++) {
    const item = figma.createFrame();
    item.name  = scenes[i];
    item.resize(w - 12, 28);
    item.cornerRadius = 5;
    item.fills = i === 0
      ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.18 }]
      : [];
    applyAutoLayout(item, 'HORIZONTAL', 6, 6, 0);
    item.primaryAxisSizingMode = 'FIXED';
    item.counterAxisSizingMode = 'FIXED';
    item.counterAxisAlignItems = 'CENTER';
    if (i === 0) {
      const bar = figma.createRectangle();
      bar.resize(3, 16);
      bar.cornerRadius = 999;
      bar.fills = accentGradientPaint();
      item.appendChild(bar);
    }
    const ico = figma.createRectangle();
    ico.resize(12, 12);
    ico.cornerRadius = 2;
    ico.fills = solidPaint(i === 0 ? '#8A5CFF' : '#2A2A3A');
    item.appendChild(ico);
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: i === 0 ? 'Medium' : 'Regular' };
    t.fontSize   = 12;
    t.characters = scenes[i];
    t.fills      = solidPaint(i === 0 ? '#FFFFFF' : '#B9B9C9');
    item.appendChild(t);
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel;
}

async function makeSourcesPanel(w, h) {
  const panel = figma.createFrame();
  panel.name  = 'sources-panel';
  panel.resize(w, h);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 8;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';
  panel.appendChild(await makePanelHeader('Sources', w));

  const div = figma.createRectangle();
  div.resize(w, 1);
  div.fills = solidPaint('#2A2A3A');
  panel.appendChild(div);

  const list = figma.createFrame();
  list.name  = 'source-list';
  list.fills = [];
  list.resize(w, h - 35);
  applyAutoLayout(list, 'VERTICAL', 2, 6, 4);
  list.primaryAxisSizingMode = 'FIXED';
  list.counterAxisSizingMode = 'FIXED';

  const sources = ['Display Capture', 'Webcam', 'Mic/AUX', 'Browser Source', 'Image'];
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  for (let i = 0; i < sources.length; i++) {
    const item = figma.createFrame();
    item.name  = sources[i];
    item.resize(w - 12, 26);
    item.cornerRadius = 4;
    item.fills = i === 0
      ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.12 }]
      : [];
    applyAutoLayout(item, 'HORIZONTAL', 6, 6, 0);
    item.primaryAxisSizingMode = 'FIXED';
    item.counterAxisSizingMode = 'FIXED';
    item.counterAxisAlignItems = 'CENTER';
    item.primaryAxisAlignItems = 'SPACE_BETWEEN';
    const ico = figma.createRectangle();
    ico.resize(12, 12);
    ico.cornerRadius = 2;
    ico.fills = solidPaint(i === 0 ? '#8A5CFF' : '#6C6C80');
    item.appendChild(ico);
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 11;
    t.characters = sources[i];
    t.fills      = solidPaint(i === 0 ? '#FFFFFF' : '#B9B9C9');
    t.layoutGrow = 1;
    item.appendChild(t);
    const eye = figma.createEllipse();
    eye.resize(10, 10);
    eye.fills = solidPaint('#6C6C80');
    item.appendChild(eye);
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel;
}

async function makePreviewCanvas(w, h, label = 'Preview', isLive = false) {
  const panel = figma.createFrame();
  panel.name  = label.toLowerCase() + '-canvas';
  panel.resize(w, h);
  panel.fills = solidPaint('#0B0B0F');
  panel.cornerRadius = 8;
  panel.strokes = solidPaint(isLive ? '#FF5470' : '#2A2A3A');
  panel.strokeWeight = isLive ? 2 : 1;
  panel.strokeAlign  = 'INSIDE';
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';

  // Header
  const header = figma.createFrame();
  header.name  = 'canvas-header';
  header.resize(w, 28);
  header.fills = solidPaint('#14141C');
  applyAutoLayout(header, 'HORIZONTAL', 8, 10, 0);
  header.primaryAxisSizingMode = 'FIXED';
  header.counterAxisSizingMode = 'FIXED';
  header.counterAxisAlignItems = 'CENTER';
  header.primaryAxisAlignItems = 'SPACE_BETWEEN';

  if (isLive) {
    const livePill = figma.createFrame();
    livePill.name = 'live-pill';
    livePill.resize(36, 16);
    livePill.cornerRadius = 999;
    livePill.fills = solidPaint('#FF5470');
    applyAutoLayout(livePill, 'HORIZONTAL', 0, 6, 0);
    livePill.primaryAxisSizingMode = 'FIXED';
    livePill.counterAxisSizingMode = 'FIXED';
    livePill.primaryAxisAlignItems = 'CENTER';
    livePill.counterAxisAlignItems = 'CENTER';
    const liveText = figma.createText();
    liveText.fontName   = { family: 'Inter', style: 'Semi Bold' };
    liveText.fontSize   = 8;
    liveText.characters = 'LIVE';
    liveText.fills      = solidPaint('#FFFFFF');
    livePill.appendChild(liveText);
    header.appendChild(livePill);
  }

  const labelNode = await tx(label, 11, 'Medium', isLive ? '#FFFFFF' : '#B9B9C9');
  labelNode.layoutGrow = 1;
  header.appendChild(labelNode);

  const badge = figma.createFrame();
  badge.name  = 'res-badge';
  badge.resize(58, 16);
  badge.cornerRadius = 3;
  badge.fills = solidPaint('#1C1C27');
  applyAutoLayout(badge, 'HORIZONTAL', 0, 4, 0);
  badge.primaryAxisSizingMode = 'FIXED';
  badge.counterAxisSizingMode = 'FIXED';
  badge.primaryAxisAlignItems = 'CENTER';
  badge.counterAxisAlignItems = 'CENTER';
  const badgeText = await tx('1920×1080', 8, 'Regular', '#6C6C80');
  badge.appendChild(badgeText);
  header.appendChild(badge);
  panel.appendChild(header);

  // Canvas
  const canvas = figma.createFrame();
  canvas.name  = 'canvas';
  canvas.resize(w, h - 28);
  canvas.fills = solidPaint('#000000');
  applyAutoLayout(canvas, 'HORIZONTAL', 0, 0, 0);
  canvas.primaryAxisSizingMode = 'FIXED';
  canvas.counterAxisSizingMode = 'FIXED';
  canvas.primaryAxisAlignItems = 'CENTER';
  canvas.counterAxisAlignItems = 'CENTER';
  canvas.layoutGrow = 1;

  // Safe area
  const safe = figma.createRectangle();
  safe.name   = 'safe-area';
  safe.resize(Math.round(w * 0.9), Math.round((h - 28) * 0.9));
  safe.fills  = [];
  safe.strokes = solidPaint('#2A2A3A');
  safe.strokeWeight = 1;
  safe.dashPattern = [4, 4];
  canvas.appendChild(safe);

  panel.appendChild(canvas);
  return panel;
}

async function makeMixerStrip(name, isMuted = false) {
  const strip = figma.createFrame();
  strip.name  = 'strip-' + name;
  strip.resize(90, 120);
  strip.fills = solidPaint('#14141C');
  strip.cornerRadius = 6;
  applyAutoLayout(strip, 'VERTICAL', 4, 6, 6);
  strip.primaryAxisSizingMode = 'FIXED';
  strip.counterAxisSizingMode = 'FIXED';
  strip.counterAxisAlignItems = 'CENTER';

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const lbl = figma.createText();
  lbl.fontName   = { family: 'Inter', style: 'Regular' };
  lbl.fontSize   = 10;
  lbl.characters = name;
  lbl.fills      = solidPaint('#B9B9C9');
  lbl.textAlignHorizontal = 'CENTER';
  strip.appendChild(lbl);

  const meter = figma.createRectangle();
  meter.name  = 'meter';
  meter.resize(60, 6);
  meter.cornerRadius = 999;
  meter.fills = isMuted ? solidPaint('#2A2A3A') : solidPaint('#3DDC97');
  strip.appendChild(meter);

  const slider = figma.createRectangle();
  slider.name  = 'volume';
  slider.resize(4, 40);
  slider.cornerRadius = 999;
  slider.fills = solidPaint('#2A2A3A');
  strip.appendChild(slider);

  const muteBtn = figma.createFrame();
  muteBtn.name  = 'mute';
  muteBtn.resize(28, 20);
  muteBtn.cornerRadius = 4;
  muteBtn.fills = solidPaint(isMuted ? '#FF5470' : '#1C1C27');
  applyAutoLayout(muteBtn, 'HORIZONTAL', 0, 0, 0);
  muteBtn.primaryAxisAlignItems  = 'CENTER';
  muteBtn.counterAxisAlignItems  = 'CENTER';
  muteBtn.primaryAxisSizingMode  = 'FIXED';
  muteBtn.counterAxisSizingMode  = 'FIXED';
  const muteIco = figma.createRectangle();
  muteIco.resize(10, 10);
  muteIco.cornerRadius = 2;
  muteIco.fills = solidPaint('#FFFFFF');
  muteBtn.appendChild(muteIco);
  strip.appendChild(muteBtn);
  return strip;
}

async function makeControlsPanel(w) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  const panel = figma.createFrame();
  panel.name  = 'controls-panel';
  panel.resize(w, 240);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 8;
  applyAutoLayout(panel, 'VERTICAL', 6, 8, 8);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';

  const btns = [
    { lbl: 'Start Streaming', gradient: true  },
    { lbl: 'Start Recording', gradient: false },
    { lbl: 'Virtual Camera',  gradient: false },
    { lbl: 'Studio Mode',     gradient: false },
    { lbl: 'Settings',        gradient: false },
  ];
  for (const b of btns) {
    const btn = figma.createFrame();
    btn.name  = b.lbl;
    btn.resize(w - 16, 34);
    btn.cornerRadius = 6;
    btn.fills = b.gradient ? accentGradientPaint() : solidPaint('#14141C');
    if (!b.gradient) {
      btn.strokes = solidPaint('#2A2A3A');
      btn.strokeWeight = 1;
      btn.strokeAlign  = 'INSIDE';
    }
    applyAutoLayout(btn, 'HORIZONTAL', 0, 0, 0);
    btn.primaryAxisAlignItems = 'CENTER';
    btn.counterAxisAlignItems = 'CENTER';
    btn.primaryAxisSizingMode = 'FIXED';
    btn.counterAxisSizingMode = 'FIXED';
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Medium' };
    t.fontSize   = 12;
    t.characters = b.lbl;
    t.fills      = solidPaint('#FFFFFF');
    btn.appendChild(t);
    panel.appendChild(btn);
  }
  return panel;
}

// ─── app/default ─────────────────────────────────────────────────────────────
async function buildAppDefault(page) {
  await loadFonts();

  const frame = figma.createFrame();
  frame.name  = 'app/default';
  frame.resize(1440, 900);
  frame.fills = solidPaint('#0B0B0F');
  applyAutoLayout(frame, 'VERTICAL', 0, 0, 0);
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'FIXED';

  // ── Top chrome ───────────────────────────────────────────────────────────
  frame.appendChild(makeMenuBar());
  frame.appendChild(makeToolbar());

  const div1 = figma.createRectangle();
  div1.resize(1440, 1);
  div1.fills = solidPaint('#2A2A3A');
  frame.appendChild(div1);

  // ── Main workspace ────────────────────────────────────────────────────────
  const workspace = figma.createFrame();
  workspace.name  = 'workspace';
  workspace.fills = [];
  workspace.resize(1440, 806 - 24 - 2);
  applyAutoLayout(workspace, 'HORIZONTAL', 0, 0, 0);
  workspace.primaryAxisSizingMode = 'FIXED';
  workspace.counterAxisSizingMode = 'FIXED';
  workspace.layoutGrow = 1;

  // Left dock (Scenes + Sources stacked)
  const leftDock = figma.createFrame();
  leftDock.name  = 'left-dock';
  leftDock.resize(220, 780);
  leftDock.fills = solidPaint('#14141C');
  leftDock.strokes = solidPaint('#2A2A3A');
  leftDock.strokeWeight = 1;
  leftDock.strokeAlign  = 'OUTSIDE';
  applyAutoLayout(leftDock, 'VERTICAL', 8, 0, 8);
  leftDock.primaryAxisSizingMode = 'FIXED';
  leftDock.counterAxisSizingMode = 'FIXED';
  leftDock.appendChild(await makeScenesPanel(220, 340));
  leftDock.appendChild(await makeSourcesPanel(220, 340));
  workspace.appendChild(leftDock);

  const vdiv = figma.createRectangle();
  vdiv.resize(1, 780);
  vdiv.fills = solidPaint('#2A2A3A');
  workspace.appendChild(vdiv);

  // Center (preview + mixer)
  const center = figma.createFrame();
  center.name  = 'center';
  center.fills = [];
  center.resize(879, 780);
  applyAutoLayout(center, 'VERTICAL', 0, 0, 0);
  center.primaryAxisSizingMode = 'FIXED';
  center.counterAxisSizingMode = 'FIXED';
  center.layoutGrow = 1;

  // Preview canvas
  const preview = await makePreviewCanvas(879, 540, 'Preview', false);
  center.appendChild(preview);

  const hdiv = figma.createRectangle();
  hdiv.resize(879, 1);
  hdiv.fills = solidPaint('#2A2A3A');
  center.appendChild(hdiv);

  // Mixer + Transitions row
  const bottomRow = figma.createFrame();
  bottomRow.name  = 'bottom-row';
  bottomRow.fills = solidPaint('#14141C');
  bottomRow.resize(879, 239);
  applyAutoLayout(bottomRow, 'HORIZONTAL', 0, 0, 0);
  bottomRow.primaryAxisSizingMode = 'FIXED';
  bottomRow.counterAxisSizingMode = 'FIXED';

  // Mixer strips
  const mixer = figma.createFrame();
  mixer.name  = 'mixer';
  mixer.fills = [];
  mixer.resize(660, 239);
  applyAutoLayout(mixer, 'VERTICAL', 0, 0, 0);
  mixer.primaryAxisSizingMode = 'FIXED';
  mixer.counterAxisSizingMode = 'FIXED';
  mixer.appendChild(await (async () => {
    const h = figma.createFrame();
    h.name = 'mixer-header';
    h.resize(660, 32);
    h.fills = solidPaint('#0B0B0F');
    applyAutoLayout(h, 'HORIZONTAL', 0, 10, 0);
    h.primaryAxisSizingMode = 'FIXED';
    h.counterAxisSizingMode = 'FIXED';
    h.counterAxisAlignItems = 'CENTER';
    const t = await tx('Audio Mixer', 12, 'Medium', '#FFFFFF');
    h.appendChild(t);
    return h;
  })());
  const strips = figma.createFrame();
  strips.name  = 'strips';
  strips.fills = [];
  applyAutoLayout(strips, 'HORIZONTAL', 6, 10, 8);
  strips.primaryAxisSizingMode = 'AUTO';
  strips.counterAxisSizingMode = 'AUTO';
  const channels = ['Desktop', 'Mic/Aux', 'Browser', 'Music'];
  for (let i = 0; i < channels.length; i++) {
    strips.appendChild(await makeMixerStrip(channels[i], i === 1));
  }
  mixer.appendChild(strips);
  bottomRow.appendChild(mixer);

  const mvdiv = figma.createRectangle();
  mvdiv.resize(1, 239);
  mvdiv.fills = solidPaint('#2A2A3A');
  bottomRow.appendChild(mvdiv);

  // Transitions panel
  const transitions = figma.createFrame();
  transitions.name  = 'transitions';
  transitions.resize(218, 239);
  transitions.fills = solidPaint('#1C1C27');
  applyAutoLayout(transitions, 'VERTICAL', 8, 10, 10);
  transitions.primaryAxisSizingMode = 'FIXED';
  transitions.counterAxisSizingMode = 'FIXED';
  const transTitle = await tx('Transitions', 12, 'Medium', '#FFFFFF');
  transitions.appendChild(transTitle);
  const transBtn = figma.createFrame();
  transBtn.name  = 'trans-btn';
  transBtn.resize(198, 32);
  transBtn.cornerRadius = 6;
  transBtn.fills = accentGradientPaint();
  applyAutoLayout(transBtn, 'HORIZONTAL', 0, 0, 0);
  transBtn.primaryAxisAlignItems  = 'CENTER';
  transBtn.counterAxisAlignItems  = 'CENTER';
  transBtn.primaryAxisSizingMode  = 'FIXED';
  transBtn.counterAxisSizingMode  = 'FIXED';
  const transTxt = await tx('Cut', 12, 'Medium', '#FFFFFF');
  transBtn.appendChild(transTxt);
  transitions.appendChild(transBtn);
  bottomRow.appendChild(transitions);

  center.appendChild(bottomRow);
  workspace.appendChild(center);

  const vdiv2 = figma.createRectangle();
  vdiv2.resize(1, 780);
  vdiv2.fills = solidPaint('#2A2A3A');
  workspace.appendChild(vdiv2);

  // Right dock (Controls)
  const rightDock = await makeControlsPanel(220);
  workspace.appendChild(rightDock);

  frame.appendChild(workspace);

  // Status bar
  frame.appendChild(makeStatusBar());

  page.appendChild(frame);
  return frame;
}

// ─── app/studio-mode ─────────────────────────────────────────────────────────
async function buildAppStudioMode(page) {
  await loadFonts();

  const frame = figma.createFrame();
  frame.name  = 'app/studio-mode';
  frame.resize(1440, 900);
  frame.fills = solidPaint('#0B0B0F');
  applyAutoLayout(frame, 'VERTICAL', 0, 0, 0);
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'FIXED';

  frame.appendChild(makeMenuBar());
  frame.appendChild(makeToolbar());
  const div = figma.createRectangle();
  div.resize(1440, 1);
  div.fills = solidPaint('#2A2A3A');
  frame.appendChild(div);

  const workspace = figma.createFrame();
  workspace.name  = 'workspace';
  workspace.fills = [];
  workspace.resize(1440, 803 - 24);
  applyAutoLayout(workspace, 'HORIZONTAL', 0, 0, 0);
  workspace.primaryAxisSizingMode = 'FIXED';
  workspace.counterAxisSizingMode = 'FIXED';
  workspace.layoutGrow = 1;

  // Left: Scenes
  const leftDock = figma.createFrame();
  leftDock.name  = 'left-dock';
  leftDock.resize(180, 779);
  leftDock.fills = solidPaint('#14141C');
  applyAutoLayout(leftDock, 'VERTICAL', 8, 0, 8);
  leftDock.primaryAxisSizingMode = 'FIXED';
  leftDock.counterAxisSizingMode = 'FIXED';
  leftDock.appendChild(await makeScenesPanel(180, 360));
  leftDock.appendChild(await makeSourcesPanel(180, 340));
  workspace.appendChild(leftDock);

  // Center: dual canvas
  const center = figma.createFrame();
  center.name  = 'center';
  center.fills = [];
  center.resize(900, 779);
  applyAutoLayout(center, 'VERTICAL', 0, 0, 0);
  center.primaryAxisSizingMode = 'FIXED';
  center.counterAxisSizingMode = 'FIXED';
  center.layoutGrow = 1;

  // Studio mode label
  const studioLabel = figma.createFrame();
  studioLabel.name = 'studio-mode-label';
  studioLabel.resize(900, 28);
  studioLabel.fills = [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.12 }];
  applyAutoLayout(studioLabel, 'HORIZONTAL', 0, 0, 0);
  studioLabel.primaryAxisSizingMode = 'FIXED';
  studioLabel.counterAxisSizingMode = 'FIXED';
  studioLabel.primaryAxisAlignItems = 'CENTER';
  studioLabel.counterAxisAlignItems = 'CENTER';
  const studioTxt = await tx('STUDIO MODE', 10, 'Medium', '#8A5CFF');
  studioLabel.appendChild(studioTxt);
  center.appendChild(studioLabel);

  // Dual canvas row
  const canvasRow = figma.createFrame();
  canvasRow.name  = 'canvas-row';
  canvasRow.fills = [];
  canvasRow.resize(900, 460);
  applyAutoLayout(canvasRow, 'HORIZONTAL', 8, 8, 8);
  canvasRow.primaryAxisSizingMode = 'FIXED';
  canvasRow.counterAxisSizingMode = 'FIXED';

  const previewCanvas = await makePreviewCanvas(418, 444, 'Preview', false);
  canvasRow.appendChild(previewCanvas);

  // Transition column
  const transCol = figma.createFrame();
  transCol.name  = 'trans-column';
  transCol.resize(48, 444);
  transCol.fills = solidPaint('#14141C');
  transCol.cornerRadius = 6;
  applyAutoLayout(transCol, 'VERTICAL', 8, 8, 12);
  transCol.primaryAxisSizingMode = 'FIXED';
  transCol.counterAxisSizingMode = 'FIXED';
  transCol.primaryAxisAlignItems = 'CENTER';
  transCol.counterAxisAlignItems = 'CENTER';

  const cutBtn = figma.createFrame();
  cutBtn.name  = 'cut-btn';
  cutBtn.resize(32, 32);
  cutBtn.cornerRadius = 6;
  cutBtn.fills = accentGradientPaint();
  applyAutoLayout(cutBtn, 'HORIZONTAL', 0, 0, 0);
  cutBtn.primaryAxisAlignItems = 'CENTER';
  cutBtn.counterAxisAlignItems = 'CENTER';
  cutBtn.primaryAxisSizingMode = 'FIXED';
  cutBtn.counterAxisSizingMode = 'FIXED';
  const cutIco = figma.createRectangle();
  cutIco.resize(12, 12);
  cutIco.cornerRadius = 2;
  cutIco.fills = solidPaint('#FFFFFF');
  cutBtn.appendChild(cutIco);
  transCol.appendChild(cutBtn);
  canvasRow.appendChild(transCol);

  const programCanvas = await makePreviewCanvas(418, 444, 'Program', true);
  canvasRow.appendChild(programCanvas);
  center.appendChild(canvasRow);

  // Mixer row below
  const mixerRow = figma.createFrame();
  mixerRow.name  = 'mixer-row';
  mixerRow.fills = solidPaint('#14141C');
  mixerRow.resize(900, 291);
  applyAutoLayout(mixerRow, 'HORIZONTAL', 6, 10, 8);
  mixerRow.primaryAxisSizingMode = 'FIXED';
  mixerRow.counterAxisSizingMode = 'FIXED';
  const channels2 = ['Desktop', 'Mic/Aux', 'Browser', 'Music', 'VoIP'];
  for (let i = 0; i < channels2.length; i++) {
    mixerRow.appendChild(await makeMixerStrip(channels2[i], false));
  }
  center.appendChild(mixerRow);

  workspace.appendChild(center);

  // Right: Controls
  const rightDock = await makeControlsPanel(180);
  workspace.appendChild(rightDock);

  frame.appendChild(workspace);
  frame.appendChild(makeStatusBar());
  page.appendChild(frame);
  return frame;
}

// ─── app/floating-windows ────────────────────────────────────────────────────
async function buildAppFloating(page) {
  const base = await buildAppDefault(page);
  base.name  = 'app/floating-windows';

  // Detached Mixer panel
  const floatMixer = figma.createFrame();
  floatMixer.name   = 'floating/mixer';
  floatMixer.resize(460, 160);
  floatMixer.fills  = solidPaint('#1C1C27');
  floatMixer.cornerRadius = 10;
  floatMixer.strokes = solidPaint('#8A5CFF');
  floatMixer.strokeWeight = 1.5;
  floatMixer.strokeAlign  = 'INSIDE';
  floatMixer.effects = [
    { type: 'DROP_SHADOW', offset: { x: 0, y: 12 }, radius: 32, spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.55 }, blendMode: 'NORMAL', visible: true },
    accentGlow(),
  ];
  applyAutoLayout(floatMixer, 'VERTICAL', 0, 0, 0);
  floatMixer.primaryAxisSizingMode = 'FIXED';
  floatMixer.counterAxisSizingMode = 'FIXED';
  floatMixer.x = 400;
  floatMixer.y = 200;
  page.appendChild(floatMixer);

  // Detached Stats panel
  const floatStats = figma.createFrame();
  floatStats.name   = 'floating/stats';
  floatStats.resize(320, 220);
  floatStats.fills  = solidPaint('#1C1C27');
  floatStats.cornerRadius = 10;
  floatStats.strokes = solidPaint('#8A5CFF');
  floatStats.strokeWeight = 1.5;
  floatStats.strokeAlign  = 'INSIDE';
  floatStats.effects = [
    { type: 'DROP_SHADOW', offset: { x: 0, y: 12 }, radius: 32, spread: 0,
      color: { r: 0, g: 0, b: 0, a: 0.55 }, blendMode: 'NORMAL', visible: true },
    accentGlow(),
  ];
  applyAutoLayout(floatStats, 'VERTICAL', 0, 0, 0);
  floatStats.primaryAxisSizingMode = 'FIXED';
  floatStats.counterAxisSizingMode = 'FIXED';
  floatStats.x = 900;
  floatStats.y = 150;
  page.appendChild(floatStats);

  return base;
}

async function buildAllAppFrames(page) {
  await loadFonts();

  const defaultFrame  = await buildAppDefault(page);
  const studioFrame   = await buildAppStudioMode(page);
  const floatingFrame = await buildAppFloating(page);

  defaultFrame.x  = 0;    defaultFrame.y  = 0;
  studioFrame.x   = 1500; studioFrame.y   = 0;
  floatingFrame.x = 3000; floatingFrame.y = 0;

  return { defaultFrame, studioFrame, floatingFrame };
}

module.exports = { buildAllAppFrames };
