// ─── Dockable panel system builder ───────────────────────────────────────────
// Builds: panel/frame (base), panel/scenes, panel/sources, panel/mixer,
//         panel/transitions, panel/controls, panel/stats, panel/log-viewer,
//         panel/audio-monitoring, panel/preview, panel/program, panel/studio-mode,
//         panel/plugin-slot

const {
  solidPaint, accentGradientPaint, accentGlow, applyAutoLayout,
  hexToRgb, strokeBorder,
} = require('../helpers');

async function loadFonts() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
}

// ─── Text helper ─────────────────────────────────────────────────────────────
async function makeText(str, size, weight, color) {
  await figma.loadFontAsync({ family: 'Inter', style: weight });
  const t = figma.createText();
  t.fontName   = { family: 'Inter', style: weight };
  t.fontSize   = size;
  t.characters = str;
  t.fills      = solidPaint(color);
  return t;
}

// ─── Panel header bar ─────────────────────────────────────────────────────────
async function makePanelHeader(title, withSearch = false) {
  const header = figma.createFrame();
  header.name  = 'header';
  header.resize(280, 36);
  header.fills = solidPaint('#14141C');
  applyAutoLayout(header, 'HORIZONTAL', 6, 10, 0);
  header.primaryAxisSizingMode  = 'FIXED';
  header.counterAxisSizingMode  = 'FIXED';
  header.counterAxisAlignItems  = 'CENTER';
  header.primaryAxisAlignItems  = 'SPACE_BETWEEN';

  // Drag handle
  const handle = figma.createRectangle();
  handle.name   = 'drag-handle';
  handle.resize(6, 18);
  handle.cornerRadius = 3;
  handle.fills  = solidPaint('#2A2A3A');
  header.appendChild(handle);

  const titleNode = await makeText(title, 13, 'Medium', '#FFFFFF');
  titleNode.name  = 'title';
  titleNode.layoutGrow = 1;
  header.appendChild(titleNode);

  if (withSearch) {
    const searchBtn = figma.createRectangle();
    searchBtn.name = 'search-btn';
    searchBtn.resize(16, 16);
    searchBtn.cornerRadius = 3;
    searchBtn.fills = solidPaint('#6C6C80');
    header.appendChild(searchBtn);
  }

  const settingsBtn = figma.createRectangle();
  settingsBtn.name = 'settings-btn';
  settingsBtn.resize(16, 16);
  settingsBtn.cornerRadius = 8;
  settingsBtn.fills = solidPaint('#6C6C80');
  header.appendChild(settingsBtn);

  const closeBtn = figma.createRectangle();
  closeBtn.name   = 'close-btn';
  closeBtn.resize(14, 14);
  closeBtn.cornerRadius = 7;
  closeBtn.fills  = solidPaint('#FF5470');
  header.appendChild(closeBtn);

  return header;
}

// ─── Panel toolbar row (icon buttons) ────────────────────────────────────────
function makePanelToolbar(icons) {
  const bar  = figma.createFrame();
  bar.name   = 'toolbar';
  bar.fills  = solidPaint('#0B0B0F');
  applyAutoLayout(bar, 'HORIZONTAL', 2, 6, 4);
  bar.primaryAxisSizingMode = 'AUTO';
  bar.counterAxisSizingMode = 'AUTO';

  for (const label of icons) {
    const btn = figma.createFrame();
    btn.name  = 'btn-' + label;
    btn.resize(24, 24);
    btn.cornerRadius = 4;
    btn.fills = solidPaint('#1C1C27');
    applyAutoLayout(btn, 'HORIZONTAL', 0, 0, 0);
    btn.primaryAxisAlignItems  = 'CENTER';
    btn.counterAxisAlignItems  = 'CENTER';
    btn.primaryAxisSizingMode  = 'FIXED';
    btn.counterAxisSizingMode  = 'FIXED';

    const ico = figma.createRectangle();
    ico.name  = label;
    ico.resize(12, 12);
    ico.cornerRadius = 2;
    ico.fills = solidPaint('#6C6C80');
    btn.appendChild(ico);
    bar.appendChild(btn);
  }
  return bar;
}

// ─── List item row ────────────────────────────────────────────────────────────
async function makeListItem(label, isActive = false, hasEye = false) {
  const row = figma.createFrame();
  row.name  = label;
  row.resize(260, 28);
  row.fills = isActive
    ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.18 }]
    : [];
  row.cornerRadius = 6;
  applyAutoLayout(row, 'HORIZONTAL', 6, 8, 0);
  row.primaryAxisSizingMode  = 'FIXED';
  row.counterAxisSizingMode  = 'FIXED';
  row.counterAxisAlignItems  = 'CENTER';

  if (isActive) {
    const accent = figma.createRectangle();
    accent.name  = 'active-indicator';
    accent.resize(3, 18);
    accent.cornerRadius = 999;
    accent.fills = accentGradientPaint();
    row.appendChild(accent);
  }

  // Source icon placeholder
  const ico  = figma.createRectangle();
  ico.name   = 'icon';
  ico.resize(14, 14);
  ico.cornerRadius = 3;
  ico.fills  = solidPaint(isActive ? '#8A5CFF' : '#2A2A3A');
  row.appendChild(ico);

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const t = figma.createText();
  t.fontName   = { family: 'Inter', style: 'Regular' };
  t.fontSize   = 12;
  t.characters = label;
  t.fills      = solidPaint(isActive ? '#FFFFFF' : '#B9B9C9');
  t.layoutGrow = 1;
  row.appendChild(t);

  if (hasEye) {
    const eye = figma.createEllipse();
    eye.name  = 'visibility';
    eye.resize(12, 12);
    eye.fills = solidPaint('#6C6C80');
    row.appendChild(eye);
  }

  const lock = figma.createRectangle();
  lock.name   = 'lock';
  lock.resize(10, 12);
  lock.cornerRadius = 2;
  lock.fills  = solidPaint('#2A2A3A');
  row.appendChild(lock);

  return row;
}

// ─── panel/scenes ─────────────────────────────────────────────────────────────
async function buildPanelScenes() {
  const panel = figma.createComponent();
  panel.name  = 'panel/scenes';
  panel.resize(280, 300);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode  = 'FIXED';
  panel.counterAxisSizingMode  = 'FIXED';

  const header  = await makePanelHeader('Scenes', true);
  panel.appendChild(header);

  const divider = figma.createRectangle();
  divider.name  = 'divider';
  divider.resize(280, 1);
  divider.fills = solidPaint('#2A2A3A');
  panel.appendChild(divider);

  const toolbar = makePanelToolbar(['+', '−', 'dup', '↑', '↓']);
  panel.appendChild(toolbar);

  const list = figma.createFrame();
  list.name  = 'scene-list';
  list.fills = [];
  applyAutoLayout(list, 'VERTICAL', 2, 8, 4);
  list.layoutGrow = 1;
  list.primaryAxisSizingMode  = 'FIXED';
  list.counterAxisSizingMode  = 'FIXED';
  list.resize(280, 220);

  const sceneNames = ['Main Scene', 'Webcam Only', 'Screen Share', 'Intermission', 'Starting Soon'];
  for (let i = 0; i < sceneNames.length; i++) {
    const item = await makeListItem(sceneNames[i], i === 0);
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel;
}

// ─── panel/sources ────────────────────────────────────────────────────────────
async function buildPanelSources() {
  const panel = figma.createComponent();
  panel.name  = 'panel/sources';
  panel.resize(280, 280);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode  = 'FIXED';
  panel.counterAxisSizingMode  = 'FIXED';

  panel.appendChild(await makePanelHeader('Sources'));

  const div = figma.createRectangle();
  div.resize(280, 1);
  div.fills = solidPaint('#2A2A3A');
  panel.appendChild(div);

  panel.appendChild(makePanelToolbar(['+', '−', 'dup', '↑', '↓', 'props', 'filters']));

  const list = figma.createFrame();
  list.name  = 'source-list';
  list.fills = [];
  applyAutoLayout(list, 'VERTICAL', 2, 8, 4);
  list.resize(280, 190);
  list.primaryAxisSizingMode  = 'FIXED';
  list.counterAxisSizingMode  = 'FIXED';

  const sources = ['Display Capture', 'Webcam (FaceTime)', 'Microphone/AUX', 'Browser Source', 'Image Overlay'];
  for (let i = 0; i < sources.length; i++) {
    const item = await makeListItem(sources[i], i === 0, true);
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel;
}

// ─── mixer/channel-strip (sub-component) ──────────────────────────────────────
async function makeChannelStrip(name, isMuted = false) {
  const strip = figma.createFrame();
  strip.name  = 'mixer/channel-strip — ' + name;
  strip.resize(110, 180);
  strip.fills = solidPaint('#14141C');
  strip.cornerRadius = 8;
  applyAutoLayout(strip, 'VERTICAL', 6, 8, 8);
  strip.primaryAxisSizingMode = 'FIXED';
  strip.counterAxisSizingMode = 'FIXED';

  // Channel name
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const label = figma.createText();
  label.fontName   = { family: 'Inter', style: 'Regular' };
  label.fontSize   = 11;
  label.characters = name;
  label.fills      = solidPaint('#B9B9C9');
  label.textAlignHorizontal = 'CENTER';
  strip.appendChild(label);

  // Meter (vertical bar pair)
  const meterGroup = figma.createFrame();
  meterGroup.name = 'meter';
  meterGroup.resize(24, 80);
  meterGroup.fills = solidPaint('#0B0B0F');
  meterGroup.cornerRadius = 3;
  applyAutoLayout(meterGroup, 'HORIZONTAL', 2, 2, 2);
  meterGroup.primaryAxisSizingMode = 'FIXED';
  meterGroup.counterAxisSizingMode = 'FIXED';

  for (let ch = 0; ch < 2; ch++) {
    const bar = figma.createRectangle();
    bar.name  = 'bar-' + ch;
    bar.resize(8, 60);
    bar.cornerRadius = 2;
    bar.fills = solidPaint(isMuted ? '#2A2A3A' : '#3DDC97');
    meterGroup.appendChild(bar);
  }
  strip.appendChild(meterGroup);

  // Volume slider (vertical)
  const sliderTrack = figma.createRectangle();
  sliderTrack.name  = 'vol-track';
  sliderTrack.resize(4, 50);
  sliderTrack.cornerRadius = 999;
  sliderTrack.fills = solidPaint('#2A2A3A');
  strip.appendChild(sliderTrack);

  // Mute button
  const mute = figma.createFrame();
  mute.name  = 'mute-btn';
  mute.resize(28, 22);
  mute.cornerRadius = 4;
  mute.fills = solidPaint(isMuted ? '#FF5470' : '#1C1C27');
  applyAutoLayout(mute, 'HORIZONTAL', 0, 0, 0);
  mute.primaryAxisAlignItems  = 'CENTER';
  mute.counterAxisAlignItems  = 'CENTER';
  mute.primaryAxisSizingMode  = 'FIXED';
  mute.counterAxisSizingMode  = 'FIXED';
  const muteIcon = figma.createRectangle();
  muteIcon.resize(12, 12);
  muteIcon.cornerRadius = 2;
  muteIcon.fills = solidPaint('#FFFFFF');
  mute.appendChild(muteIcon);
  strip.appendChild(mute);

  return strip;
}

// ─── panel/mixer ─────────────────────────────────────────────────────────────
async function buildPanelMixer() {
  const panel = figma.createComponent();
  panel.name  = 'panel/mixer';
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode = 'AUTO';
  panel.counterAxisSizingMode = 'AUTO';

  panel.appendChild(await makePanelHeader('Audio Mixer'));

  const div = figma.createRectangle();
  div.resize(600, 1);
  div.fills = solidPaint('#2A2A3A');
  panel.appendChild(div);

  const strips = figma.createFrame();
  strips.name  = 'channel-strips';
  strips.fills = [];
  applyAutoLayout(strips, 'HORIZONTAL', 8, 12, 12);
  strips.primaryAxisSizingMode = 'AUTO';
  strips.counterAxisSizingMode = 'AUTO';

  const channels = ['Desktop Audio', 'Mic/Aux', 'Browser Src', 'Game Capture', 'Music'];
  for (let i = 0; i < channels.length; i++) {
    strips.appendChild(await makeChannelStrip(channels[i], i === 1));
  }
  panel.appendChild(strips);
  return panel;
}

// ─── panel/transitions ────────────────────────────────────────────────────────
async function buildPanelTransitions() {
  await loadFonts();
  const panel = figma.createComponent();
  panel.name  = 'panel/transitions';
  panel.resize(280, 140);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 8, 12, 10);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';

  const title = await figma.createText();
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  title.fontName   = { family: 'Inter', style: 'Medium' };
  title.fontSize   = 13;
  title.characters = 'Scene Transitions';
  title.fills      = solidPaint('#FFFFFF');
  panel.appendChild(title);

  // Transition type dropdown mock
  const dropdown = figma.createFrame();
  dropdown.name  = 'transition-type';
  dropdown.resize(256, 30);
  dropdown.cornerRadius = 8;
  dropdown.fills = solidPaint('#14141C');
  dropdown.strokes = solidPaint('#2A2A3A');
  dropdown.strokeWeight = 1;
  dropdown.strokeAlign = 'INSIDE';
  applyAutoLayout(dropdown, 'HORIZONTAL', 8, 10, 0);
  dropdown.primaryAxisSizingMode  = 'FIXED';
  dropdown.counterAxisSizingMode  = 'FIXED';
  dropdown.counterAxisAlignItems  = 'CENTER';
  dropdown.primaryAxisAlignItems  = 'SPACE_BETWEEN';

  const dropText = figma.createText();
  dropText.fontName   = { family: 'Inter', style: 'Regular' };
  dropText.fontSize   = 13;
  dropText.characters = 'Fade';
  dropText.fills      = solidPaint('#FFFFFF');
  dropdown.appendChild(dropText);
  panel.appendChild(dropdown);

  // Duration row
  const durRow = figma.createFrame();
  durRow.name  = 'duration-row';
  durRow.fills = [];
  applyAutoLayout(durRow, 'HORIZONTAL', 8, 0, 0);
  durRow.primaryAxisSizingMode = 'AUTO';
  durRow.counterAxisSizingMode = 'AUTO';
  durRow.counterAxisAlignItems = 'CENTER';

  const durLabel = figma.createText();
  durLabel.fontName   = { family: 'Inter', style: 'Regular' };
  durLabel.fontSize   = 12;
  durLabel.characters = 'Duration:';
  durLabel.fills      = solidPaint('#B9B9C9');
  durRow.appendChild(durLabel);

  const durInput = figma.createFrame();
  durInput.name  = 'duration-input';
  durInput.resize(80, 26);
  durInput.cornerRadius = 6;
  durInput.fills = solidPaint('#14141C');
  durInput.strokes = solidPaint('#2A2A3A');
  durInput.strokeWeight = 1;
  durInput.strokeAlign = 'INSIDE';
  applyAutoLayout(durInput, 'HORIZONTAL', 0, 10, 0);
  durInput.primaryAxisSizingMode  = 'FIXED';
  durInput.counterAxisSizingMode  = 'FIXED';
  durInput.counterAxisAlignItems  = 'CENTER';
  const durVal = figma.createText();
  durVal.fontName   = { family: 'Inter', style: 'Regular' };
  durVal.fontSize   = 12;
  durVal.characters = '300 ms';
  durVal.fills      = solidPaint('#FFFFFF');
  durInput.appendChild(durVal);
  durRow.appendChild(durInput);
  panel.appendChild(durRow);

  // Transition button (gradient)
  const transBtn = figma.createFrame();
  transBtn.name   = 'transition-btn';
  transBtn.resize(256, 32);
  transBtn.cornerRadius = 6;
  transBtn.fills  = accentGradientPaint();
  applyAutoLayout(transBtn, 'HORIZONTAL', 0, 0, 0);
  transBtn.primaryAxisAlignItems  = 'CENTER';
  transBtn.counterAxisAlignItems  = 'CENTER';
  transBtn.primaryAxisSizingMode  = 'FIXED';
  transBtn.counterAxisSizingMode  = 'FIXED';
  const transBtnLabel = figma.createText();
  transBtnLabel.fontName   = { family: 'Inter', style: 'Medium' };
  transBtnLabel.fontSize   = 13;
  transBtnLabel.characters = 'Transition';
  transBtnLabel.fills      = solidPaint('#FFFFFF');
  transBtn.appendChild(transBtnLabel);
  panel.appendChild(transBtn);

  return panel;
}

// ─── panel/controls ───────────────────────────────────────────────────────────
async function buildPanelControls() {
  await loadFonts();
  const panel = figma.createComponent();
  panel.name  = 'panel/controls';
  panel.resize(180, 280);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 6, 10, 10);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';

  const buttons = [
    { label: 'Start Streaming',      gradient: true,  active: false },
    { label: 'Start Recording',      gradient: false, active: false },
    { label: 'Start Virtual Camera', gradient: false, active: false },
    { label: 'Studio Mode',          gradient: false, active: false },
    { label: 'Settings',             gradient: false, active: false },
    { label: 'Exit',                 gradient: false, active: false, danger: true },
  ];

  for (const b of buttons) {
    const btn = figma.createFrame();
    btn.name  = b.label;
    btn.resize(160, 36);
    btn.cornerRadius = 6;
    btn.fills  = b.gradient ? accentGradientPaint()
               : b.danger   ? solidPaint('#FF5470')
               :               solidPaint('#14141C');
    if (!b.gradient && !b.danger) {
      btn.strokes = solidPaint('#2A2A3A');
      btn.strokeWeight = 1;
      btn.strokeAlign  = 'INSIDE';
    }
    applyAutoLayout(btn, 'HORIZONTAL', 0, 0, 0);
    btn.primaryAxisAlignItems  = 'CENTER';
    btn.counterAxisAlignItems  = 'CENTER';
    btn.primaryAxisSizingMode  = 'FIXED';
    btn.counterAxisSizingMode  = 'FIXED';

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Medium' };
    t.fontSize   = 12;
    t.characters = b.label;
    t.fills      = solidPaint('#FFFFFF');
    btn.appendChild(t);
    panel.appendChild(btn);
  }
  return panel;
}

// ─── panel/stats ─────────────────────────────────────────────────────────────
async function buildPanelStats() {
  await loadFonts();
  const panel = figma.createComponent();
  panel.name  = 'panel/stats';
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode = 'AUTO';
  panel.counterAxisSizingMode = 'AUTO';

  panel.appendChild(await makePanelHeader('Statistics'));

  const grid = figma.createFrame();
  grid.name  = 'stats-grid';
  grid.fills = [];
  applyAutoLayout(grid, 'HORIZONTAL', 8, 12, 10);
  grid.primaryAxisSizingMode = 'AUTO';
  grid.counterAxisSizingMode = 'AUTO';
  grid.layoutWrap = 'WRAP';
  grid.itemSpacing = 8;
  grid.counterAxisSpacing = 8;

  const metrics = [
    { label: 'CPU Usage',      value: '12.4%' },
    { label: 'Memory',         value: '1.2 GB' },
    { label: 'Avg Frame Time', value: '4.2 ms' },
    { label: 'FPS',            value: '60.0' },
    { label: 'Skipped Frames', value: '0 (0%)' },
    { label: 'Dropped Frames', value: '0 (0%)' },
    { label: 'Encoding Lag',   value: '0 ms' },
    { label: 'Render Lag',     value: '0 ms' },
  ];

  for (const m of metrics) {
    const card = figma.createFrame();
    card.name  = m.label;
    card.resize(120, 56);
    card.cornerRadius = 8;
    card.fills = solidPaint('#14141C');
    card.strokes = solidPaint('#2A2A3A');
    card.strokeWeight = 1;
    card.strokeAlign  = 'INSIDE';
    applyAutoLayout(card, 'VERTICAL', 4, 10, 8);
    card.primaryAxisSizingMode = 'FIXED';
    card.counterAxisSizingMode = 'FIXED';

    const lbl = figma.createText();
    lbl.fontName   = { family: 'Inter', style: 'Regular' };
    lbl.fontSize   = 10;
    lbl.characters = m.label;
    lbl.fills      = solidPaint('#6C6C80');
    card.appendChild(lbl);

    const val = figma.createText();
    val.fontName   = { family: 'Inter', style: 'Medium' };
    val.fontSize   = 18;
    val.characters = m.value;
    val.fills      = solidPaint('#FFFFFF');
    card.appendChild(val);

    grid.appendChild(card);
  }
  panel.appendChild(grid);
  return panel;
}

// ─── panel/preview & panel/program ───────────────────────────────────────────
async function buildPanelPreview() {
  const panel = figma.createComponent();
  panel.name  = 'panel/preview';
  panel.resize(640, 380);
  panel.fills = solidPaint('#0B0B0F');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';

  // Header
  const header = figma.createFrame();
  header.name  = 'preview-header';
  header.resize(640, 32);
  header.fills = solidPaint('#14141C');
  applyAutoLayout(header, 'HORIZONTAL', 8, 10, 0);
  header.primaryAxisSizingMode = 'FIXED';
  header.counterAxisSizingMode = 'FIXED';
  header.counterAxisAlignItems = 'CENTER';
  header.primaryAxisAlignItems = 'SPACE_BETWEEN';

  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  const previewLabel = figma.createText();
  previewLabel.fontName   = { family: 'Inter', style: 'Medium' };
  previewLabel.fontSize   = 12;
  previewLabel.characters = 'Preview';
  previewLabel.fills      = solidPaint('#B9B9C9');
  header.appendChild(previewLabel);

  const zoomChip = figma.createFrame();
  zoomChip.name   = 'zoom-chip';
  zoomChip.resize(50, 20);
  zoomChip.cornerRadius = 4;
  zoomChip.fills = solidPaint('#1C1C27');
  applyAutoLayout(zoomChip, 'HORIZONTAL', 0, 8, 0);
  zoomChip.primaryAxisSizingMode = 'FIXED';
  zoomChip.counterAxisSizingMode = 'FIXED';
  zoomChip.counterAxisAlignItems = 'CENTER';
  zoomChip.primaryAxisAlignItems = 'CENTER';
  const zoomText = figma.createText();
  zoomText.fontName   = { family: 'Inter', style: 'Regular' };
  zoomText.fontSize   = 10;
  zoomText.characters = '100%';
  zoomText.fills      = solidPaint('#6C6C80');
  zoomChip.appendChild(zoomText);
  header.appendChild(zoomChip);
  panel.appendChild(header);

  // Canvas area
  const canvas = figma.createFrame();
  canvas.name  = 'canvas';
  canvas.resize(640, 336);
  canvas.fills = solidPaint('#000000');
  applyAutoLayout(canvas, 'HORIZONTAL', 0, 0, 0);
  canvas.primaryAxisSizingMode = 'FIXED';
  canvas.counterAxisSizingMode = 'FIXED';
  canvas.primaryAxisAlignItems = 'CENTER';
  canvas.counterAxisAlignItems = 'CENTER';

  // Safe area overlay
  const safeArea = figma.createRectangle();
  safeArea.name = 'safe-margin';
  safeArea.resize(576, 303);
  safeArea.fills = [];
  safeArea.strokes = solidPaint('#2A2A3A');
  safeArea.strokeWeight = 1;
  safeArea.strokeDashes = [4, 4];
  canvas.appendChild(safeArea);

  // Aspect ratio badge
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const badge = figma.createFrame();
  badge.name  = 'aspect-badge';
  badge.resize(40, 18);
  badge.cornerRadius = 4;
  badge.fills = solidPaint('#1C1C27');
  applyAutoLayout(badge, 'HORIZONTAL', 0, 6, 0);
  badge.primaryAxisSizingMode = 'FIXED';
  badge.counterAxisSizingMode = 'FIXED';
  badge.primaryAxisAlignItems = 'CENTER';
  badge.counterAxisAlignItems = 'CENTER';
  const badgeText = figma.createText();
  badgeText.fontName   = { family: 'Inter', style: 'Regular' };
  badgeText.fontSize   = 9;
  badgeText.characters = '16:9';
  badgeText.fills      = solidPaint('#6C6C80');
  badge.appendChild(badgeText);
  canvas.appendChild(badge);

  panel.appendChild(canvas);
  return panel;
}

async function buildPanelProgram() {
  const panel = await buildPanelPreview();
  panel.name  = 'panel/program';

  const header = panel.findChild(n => n.name === 'preview-header');
  if (header) {
    const lbl = header.findChild(n => n.name.startsWith('P') || n.type === 'TEXT');
    if (lbl && lbl.type === 'TEXT') {
      await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
      lbl.characters = 'Program';
    }

    // Add LIVE pill
    const live = figma.createFrame();
    live.name  = 'live-pill';
    live.resize(38, 18);
    live.cornerRadius = 999;
    live.fills = solidPaint('#FF5470');
    applyAutoLayout(live, 'HORIZONTAL', 0, 8, 0);
    live.primaryAxisSizingMode = 'FIXED';
    live.counterAxisSizingMode = 'FIXED';
    live.primaryAxisAlignItems = 'CENTER';
    live.counterAxisAlignItems = 'CENTER';
    await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
    const liveText = figma.createText();
    liveText.fontName   = { family: 'Inter', style: 'Semi Bold' };
    liveText.fontSize   = 9;
    liveText.characters = 'LIVE';
    liveText.fills      = solidPaint('#FFFFFF');
    live.appendChild(liveText);
    header.insertChild(0, live);
  }
  return panel;
}

// ─── panel/studio-mode ────────────────────────────────────────────────────────
async function buildPanelStudioMode() {
  const preview = await buildPanelPreview();
  const program = await buildPanelProgram();

  const studioFrame = figma.createComponent();
  studioFrame.name  = 'panel/studio-mode';
  studioFrame.fills = solidPaint('#0B0B0F');
  studioFrame.cornerRadius = 12;
  applyAutoLayout(studioFrame, 'HORIZONTAL', 16, 16, 16);
  studioFrame.primaryAxisSizingMode = 'AUTO';
  studioFrame.counterAxisSizingMode = 'AUTO';

  studioFrame.appendChild(preview);

  // Transition column
  const transCol = figma.createFrame();
  transCol.name  = 'transition-column';
  transCol.resize(80, 380);
  transCol.fills = solidPaint('#14141C');
  transCol.cornerRadius = 8;
  applyAutoLayout(transCol, 'VERTICAL', 12, 10, 12);
  transCol.primaryAxisSizingMode = 'FIXED';
  transCol.counterAxisSizingMode = 'FIXED';
  transCol.primaryAxisAlignItems = 'CENTER';
  transCol.counterAxisAlignItems = 'CENTER';

  const transBtn = figma.createFrame();
  transBtn.name  = 'cut-transition';
  transBtn.resize(60, 32);
  transBtn.cornerRadius = 6;
  transBtn.fills = accentGradientPaint();
  applyAutoLayout(transBtn, 'HORIZONTAL', 0, 0, 0);
  transBtn.primaryAxisAlignItems  = 'CENTER';
  transBtn.counterAxisAlignItems  = 'CENTER';
  transBtn.primaryAxisSizingMode  = 'FIXED';
  transBtn.counterAxisSizingMode  = 'FIXED';
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  const transBtnLabel = figma.createText();
  transBtnLabel.fontName   = { family: 'Inter', style: 'Medium' };
  transBtnLabel.fontSize   = 10;
  transBtnLabel.characters = 'Cut';
  transBtnLabel.fills      = solidPaint('#FFFFFF');
  transBtn.appendChild(transBtnLabel);
  transCol.appendChild(transBtn);

  studioFrame.appendChild(transCol);
  studioFrame.appendChild(program);
  return studioFrame;
}

// ─── panel/plugin-slot ────────────────────────────────────────────────────────
async function buildPanelPluginSlot() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const panel = figma.createComponent();
  panel.name  = 'panel/plugin-slot';
  panel.resize(280, 200);
  panel.cornerRadius = 12;
  panel.fills = solidPaint('#1C1C27');
  panel.strokes = [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.5 }];
  panel.strokeWeight = 1.5;
  panel.strokeAlign  = 'INSIDE';
  panel.dashPattern  = [6, 4];
  applyAutoLayout(panel, 'VERTICAL', 8, 20, 20);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';
  panel.primaryAxisAlignItems = 'CENTER';
  panel.counterAxisAlignItems = 'CENTER';

  const icon = figma.createRectangle();
  icon.name  = 'plugin-icon';
  icon.resize(32, 32);
  icon.cornerRadius = 8;
  icon.fills = [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.3 }];
  panel.appendChild(icon);

  const t1 = figma.createText();
  t1.fontName   = { family: 'Inter', style: 'Regular' };
  t1.fontSize   = 13;
  t1.characters = 'Plugin Dock';
  t1.fills      = solidPaint('#B9B9C9');
  t1.textAlignHorizontal = 'CENTER';
  panel.appendChild(t1);

  const t2 = figma.createText();
  t2.fontName   = { family: 'Inter', style: 'Regular' };
  t2.fontSize   = 11;
  t2.characters = 'Extension panel placeholder\nPlugin API ready';
  t2.fills      = solidPaint('#6C6C80');
  t2.textAlignHorizontal = 'CENTER';
  panel.appendChild(t2);

  return panel;
}

// ─── panel/log-viewer ────────────────────────────────────────────────────────
async function buildPanelLogViewer() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });

  const panel = figma.createComponent();
  panel.name  = 'panel/log-viewer';
  panel.resize(560, 280);
  panel.fills = solidPaint('#1C1C27');
  panel.cornerRadius = 12;
  applyAutoLayout(panel, 'VERTICAL', 0, 0, 0);
  panel.primaryAxisSizingMode = 'FIXED';
  panel.counterAxisSizingMode = 'FIXED';

  panel.appendChild(await makePanelHeader('Log Viewer'));
  panel.appendChild(makePanelToolbar(['filter', 'clear', 'copy', 'save']));

  const logArea = figma.createFrame();
  logArea.name  = 'log-area';
  logArea.fills = solidPaint('#0B0B0F');
  logArea.resize(560, 218);
  applyAutoLayout(logArea, 'VERTICAL', 2, 10, 8);
  logArea.primaryAxisSizingMode = 'FIXED';
  logArea.counterAxisSizingMode = 'FIXED';

  const logLines = [
    { level: 'INFO',  msg: '[08:00:00.001] OBS Studio initialized', color: '#B9B9C9' },
    { level: 'INFO',  msg: '[08:00:00.120] Audio device: Default', color: '#B9B9C9' },
    { level: 'WARN',  msg: '[08:00:01.000] Encoder lag detected (12ms)', color: '#FFC857' },
    { level: 'ERROR', msg: '[08:00:02.500] Failed to connect to stream server', color: '#FF5470' },
    { level: 'INFO',  msg: '[08:00:03.000] Reconnecting…', color: '#B9B9C9' },
    { level: 'INFO',  msg: '[08:00:04.200] Stream connected (bitrate: 6000 kbps)', color: '#3DDC97' },
  ];

  for (const line of logLines) {
    const row = figma.createFrame();
    row.name  = line.level + '-line';
    row.fills = [];
    applyAutoLayout(row, 'HORIZONTAL', 6, 0, 0);
    row.primaryAxisSizingMode = 'AUTO';
    row.counterAxisSizingMode = 'AUTO';
    row.counterAxisAlignItems = 'CENTER';

    // Level chip
    const chip = figma.createFrame();
    chip.name  = 'level';
    chip.resize(40, 16);
    chip.cornerRadius = 3;
    chip.fills = solidPaint(
      line.level === 'ERROR' ? '#FF5470' :
      line.level === 'WARN'  ? '#FFC857' :
      '#2A2A3A'
    );
    applyAutoLayout(chip, 'HORIZONTAL', 0, 4, 0);
    chip.primaryAxisSizingMode = 'FIXED';
    chip.counterAxisSizingMode = 'FIXED';
    chip.primaryAxisAlignItems = 'CENTER';
    chip.counterAxisAlignItems = 'CENTER';
    const chipText = figma.createText();
    chipText.fontName   = { family: 'Inter', style: 'Medium' };
    chipText.fontSize   = 9;
    chipText.characters = line.level;
    chipText.fills      = solidPaint('#FFFFFF');
    chip.appendChild(chipText);
    row.appendChild(chip);

    const msg = figma.createText();
    msg.fontName   = { family: 'Inter', style: 'Regular' };
    msg.fontSize   = 11;
    msg.characters = line.msg;
    msg.fills      = solidPaint(line.color);
    row.appendChild(msg);
    logArea.appendChild(row);
  }

  panel.appendChild(logArea);
  return panel;
}

async function buildAllPanels(page) {
  await loadFonts();

  const scenes     = await buildPanelScenes();
  const sources    = await buildPanelSources();
  const mixer      = await buildPanelMixer();
  const transitions= await buildPanelTransitions();
  const controls   = await buildPanelControls();
  const stats      = await buildPanelStats();
  const logViewer  = await buildPanelLogViewer();
  const preview    = await buildPanelPreview();
  const program    = await buildPanelProgram();
  const studioMode = await buildPanelStudioMode();
  const pluginSlot = await buildPanelPluginSlot();

  const nodes = [scenes, sources, mixer, transitions, controls,
                 stats, logViewer, preview, program, studioMode, pluginSlot];

  // Lay out in a grid (3 columns)
  let x = 0, y = 0, col = 0;
  for (const n of nodes) {
    n.x = x;
    n.y = y;
    page.appendChild(n);
    col++;
    if (col >= 3) {
      x   = 0;
      y  += 400;
      col = 0;
    } else {
      x += n.width + 40;
    }
  }

  return { scenes, sources, mixer, transitions, controls, stats, logViewer,
           preview, program, studioMode, pluginSlot };
}

module.exports = { buildAllPanels };
