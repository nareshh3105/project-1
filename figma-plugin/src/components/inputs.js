// ─── Input component set builder ─────────────────────────────────────────────
// Builds: input/text, input/dropdown, input/search, input/stepper,
//         input/checkbox, input/radio, input/toggle, input/slider

const {
  solidPaint, accentGradientPaint, accentGlow,
  applyAutoLayout, hexToRgb, strokeBorder,
} = require('../helpers');

const STATES = ['Default', 'Hover', 'Focus', 'Filled', 'Error', 'Disabled'];

const C = {
  bg:      '#1C1C27',
  surface: '#14141C',
  border:  '#2A2A3A',
  focus:   '#8A5CFF',
  error:   '#FF5470',
  text:    '#FFFFFF',
  muted:   '#6C6C80',
  sec:     '#B9B9C9',
  success: '#3DDC97',
};

function loadFonts() {
  return Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ]);
}

// ─── Text input ───────────────────────────────────────────────────────────────
async function buildInputText(page) {
  await loadFonts();
  const components = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `input/text, state=${state}`;
    c.resize(240, 32);
    c.cornerRadius = 8;
    c.fills  = solidPaint(C.bg);
    applyAutoLayout(c, 'HORIZONTAL', 8, 12, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.counterAxisAlignItems  = 'CENTER';
    if (state === 'Disabled') c.opacity = 0.4;

    // Border color
    const borderColor = state === 'Focus'  ? C.focus
                      : state === 'Error'  ? C.error
                      : state === 'Hover'  ? '#3A3A50'
                      : C.border;
    c.strokes = solidPaint(borderColor);
    c.strokeWeight = state === 'Focus' ? 1.5 : 1;
    c.strokeAlign  = 'INSIDE';
    if (state === 'Focus') c.effects = [accentGlow()];

    // Placeholder / value text
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 13;
    t.characters = state === 'Filled' ? 'Value text' : 'Placeholder…';
    t.fills      = solidPaint(state === 'Filled' ? C.text : C.muted);
    t.name       = 'value';
    t.layoutGrow = 1;
    c.appendChild(t);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name   = 'input/text';
  set.fills  = [];
  applyAutoLayout(set, 'VERTICAL', 12, 16, 16);
  return set;
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────
async function buildInputDropdown(page) {
  await loadFonts();
  const components = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `input/dropdown, state=${state}`;
    c.resize(240, 32);
    c.cornerRadius = 8;
    c.fills  = solidPaint(C.bg);
    applyAutoLayout(c, 'HORIZONTAL', 8, 12, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.counterAxisAlignItems  = 'CENTER';
    c.primaryAxisAlignItems  = 'SPACE_BETWEEN';
    if (state === 'Disabled') c.opacity = 0.4;

    const borderColor = state === 'Focus' ? C.focus : state === 'Hover' ? '#3A3A50' : C.border;
    c.strokes      = solidPaint(borderColor);
    c.strokeWeight = 1;
    c.strokeAlign  = 'INSIDE';

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 13;
    t.characters = state === 'Filled' ? 'Selected option' : 'Choose…';
    t.fills      = solidPaint(state === 'Filled' ? C.text : C.muted);
    t.name       = 'value';
    t.layoutGrow = 1;
    c.appendChild(t);

    // Chevron placeholder
    const chevron = figma.createRectangle();
    chevron.name = 'chevron';
    chevron.resize(10, 6);
    chevron.cornerRadius = 1;
    chevron.fills = solidPaint(C.muted);
    c.appendChild(chevron);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name  = 'input/dropdown';
  set.fills = [];
  applyAutoLayout(set, 'VERTICAL', 12, 16, 16);
  return set;
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────
async function buildInputCheckbox(page) {
  await loadFonts();
  const checkStates = ['Unchecked/Default', 'Unchecked/Hover', 'Checked/Default',
                       'Checked/Hover', 'Indeterminate/Default', 'Disabled'];
  const components = [];

  for (const cs of checkStates) {
    const c = figma.createComponent();
    c.name  = `input/checkbox, state=${cs}`;
    applyAutoLayout(c, 'HORIZONTAL', 8, 0, 0);
    c.primaryAxisSizingMode  = 'AUTO';
    c.counterAxisSizingMode  = 'AUTO';
    c.counterAxisAlignItems  = 'CENTER';
    if (cs === 'Disabled') c.opacity = 0.4;

    // Box
    const box = figma.createRectangle();
    box.name   = 'box';
    box.resize(16, 16);
    box.cornerRadius = 4;
    const isChecked = cs.startsWith('Checked');
    const isIndet   = cs.startsWith('Indeterminate');
    box.fills   = isChecked || isIndet ? accentGradientPaint() : [];
    box.strokes = (isChecked || isIndet) ? [] : solidPaint(cs.includes('Hover') ? '#8A5CFF' : C.border);
    box.strokeWeight = 1.5;
    box.strokeAlign  = 'INSIDE';
    c.appendChild(box);

    // Check mark
    if (isChecked) {
      const check = figma.createRectangle();
      check.name   = 'checkmark';
      check.resize(8, 2);
      check.fills  = solidPaint('#FFFFFF');
      check.cornerRadius = 1;
      c.appendChild(check);
    }
    if (isIndet) {
      const dash = figma.createRectangle();
      dash.name  = 'indeterminate';
      dash.resize(8, 2);
      dash.fills = solidPaint('#FFFFFF');
      dash.cornerRadius = 1;
      c.appendChild(dash);
    }

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 13;
    t.characters = 'Checkbox label';
    t.fills      = solidPaint(C.sec);
    t.name       = 'label';
    c.appendChild(t);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name  = 'input/checkbox';
  set.fills = [];
  applyAutoLayout(set, 'VERTICAL', 10, 16, 16);
  return set;
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
async function buildInputToggle(page) {
  await loadFonts();
  const toggleStates = ['Off/Default', 'Off/Hover', 'On/Default', 'On/Hover', 'Disabled'];
  const components   = [];

  for (const ts of toggleStates) {
    const c  = figma.createComponent();
    c.name   = `input/toggle, state=${ts}`;
    applyAutoLayout(c, 'HORIZONTAL', 8, 0, 0);
    c.primaryAxisSizingMode = 'AUTO';
    c.counterAxisSizingMode = 'AUTO';
    c.counterAxisAlignItems = 'CENTER';
    if (ts === 'Disabled') c.opacity = 0.4;

    const isOn   = ts.startsWith('On');
    const track  = figma.createRectangle();
    track.name   = 'track';
    track.resize(36, 20);
    track.cornerRadius = 999;
    track.fills  = isOn ? accentGradientPaint() : solidPaint(C.border);
    c.appendChild(track);

    const thumb  = figma.createEllipse();
    thumb.name   = 'thumb';
    thumb.resize(14, 14);
    thumb.fills  = solidPaint('#FFFFFF');
    c.appendChild(thumb);

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 13;
    t.characters = 'Toggle label';
    t.fills      = solidPaint(C.sec);
    t.name       = 'label';
    c.appendChild(t);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name  = 'input/toggle';
  set.fills = [];
  applyAutoLayout(set, 'VERTICAL', 10, 16, 16);
  return set;
}

// ─── Slider ───────────────────────────────────────────────────────────────────
async function buildInputSlider(page) {
  const sliderStates = ['Default', 'Hover', 'Active', 'Disabled'];
  const components   = [];

  for (const state of sliderStates) {
    const c = figma.createComponent();
    c.name  = `input/slider, state=${state}`;
    c.resize(200, 20);
    applyAutoLayout(c, 'HORIZONTAL', 0, 0, 0);
    c.primaryAxisSizingMode = 'FIXED';
    c.counterAxisSizingMode = 'FIXED';
    c.counterAxisAlignItems = 'CENTER';
    c.fills  = [];
    if (state === 'Disabled') c.opacity = 0.4;

    // Track
    const track = figma.createRectangle();
    track.name  = 'track';
    track.resize(200, 4);
    track.cornerRadius = 999;
    track.fills = solidPaint(C.border);
    c.appendChild(track);

    // Fill (50% wide placeholder)
    const fill  = figma.createRectangle();
    fill.name   = 'fill';
    fill.resize(100, 4);
    fill.cornerRadius = 999;
    fill.fills  = state === 'Disabled' ? solidPaint(C.muted) : accentGradientPaint();
    c.appendChild(fill);

    // Thumb
    const thumb = figma.createEllipse();
    thumb.name  = 'thumb';
    thumb.resize(state === 'Active' ? 18 : 14, state === 'Active' ? 18 : 14);
    thumb.fills = solidPaint('#FFFFFF');
    if (state === 'Active') thumb.effects = [accentGlow()];
    c.appendChild(thumb);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name  = 'input/slider';
  set.fills = [];
  applyAutoLayout(set, 'VERTICAL', 12, 16, 16);
  return set;
}

// ─── Search input ─────────────────────────────────────────────────────────────
async function buildInputSearch(page) {
  await loadFonts();
  const states    = ['Default', 'Hover', 'Focus', 'Filled'];
  const components = [];

  for (const state of states) {
    const c = figma.createComponent();
    c.name  = `input/search, state=${state}`;
    c.resize(240, 28);
    c.cornerRadius = 999;
    c.fills  = solidPaint(C.surface);
    applyAutoLayout(c, 'HORIZONTAL', 6, 10, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.counterAxisAlignItems  = 'CENTER';

    const borderColor = state === 'Focus' ? C.focus : state === 'Hover' ? '#3A3A50' : C.border;
    c.strokes      = solidPaint(borderColor);
    c.strokeWeight = state === 'Focus' ? 1.5 : 1;
    c.strokeAlign  = 'INSIDE';

    // Search icon
    const ico = figma.createEllipse();
    ico.name  = 'search-icon';
    ico.resize(12, 12);
    ico.fills = [];
    ico.strokes = solidPaint(C.muted);
    ico.strokeWeight = 1.5;
    c.appendChild(ico);

    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 12;
    t.characters = state === 'Filled' ? 'Search query' : 'Search…';
    t.fills      = solidPaint(state === 'Filled' ? C.text : C.muted);
    t.name       = 'value';
    t.layoutGrow = 1;
    c.appendChild(t);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name  = 'input/search';
  set.fills = [];
  applyAutoLayout(set, 'VERTICAL', 10, 16, 16);
  return set;
}

// ─── Audio meter ──────────────────────────────────────────────────────────────
async function buildMeterAudio(page) {
  const orientations = ['horizontal', 'vertical'];
  const components   = [];

  for (const orient of orientations) {
    const c = figma.createComponent();
    c.name  = `meter/audio, orientation=${orient}`;
    const w = orient === 'horizontal' ? 200 : 16;
    const h = orient === 'horizontal' ? 8   : 100;
    c.resize(w, h);
    c.cornerRadius = 2;
    c.fills = solidPaint('#0B0B0F');
    applyAutoLayout(c, orient === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL', 0, 0, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';

    // Safe zone (green ~60%)
    const safe = figma.createRectangle();
    safe.name  = 'zone-safe';
    safe.resize(orient === 'horizontal' ? 120 : w, orient === 'horizontal' ? h : 60);
    safe.fills = solidPaint('#3DDC97');
    safe.cornerRadius = 2;
    c.appendChild(safe);

    // Caution zone (yellow ~25%)
    const caution = figma.createRectangle();
    caution.name  = 'zone-caution';
    caution.resize(orient === 'horizontal' ? 50 : w, orient === 'horizontal' ? h : 25);
    caution.fills = solidPaint('#FFC857');
    c.appendChild(caution);

    // Clip zone (red ~15%)
    const clip  = figma.createRectangle();
    clip.name   = 'zone-clip';
    clip.resize(orient === 'horizontal' ? 30 : w, orient === 'horizontal' ? h : 15);
    clip.fills  = solidPaint('#FF5470');
    c.appendChild(clip);
    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name  = 'meter/audio';
  set.fills = [];
  applyAutoLayout(set, 'HORIZONTAL', 24, 16, 16);
  return set;
}

async function buildAllInputs(page) {
  await loadFonts();

  const text     = await buildInputText(page);
  const dropdown = await buildInputDropdown(page);
  const search   = await buildInputSearch(page);
  const checkbox = await buildInputCheckbox(page);
  const toggle   = await buildInputToggle(page);
  const slider   = await buildInputSlider(page);
  const meter    = await buildMeterAudio(page);

  // Stack vertically on page
  let y = 0;
  for (const node of [text, dropdown, search, checkbox, toggle, slider, meter]) {
    node.x = 0;
    node.y = y;
    y += node.height + 40;
  }

  return { text, dropdown, search, checkbox, toggle, slider, meter };
}

module.exports = { buildAllInputs };
