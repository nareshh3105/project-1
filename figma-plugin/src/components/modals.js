// ─── Modal & dialog system builder ───────────────────────────────────────────
// Builds: modal/settings, modal/filters, modal/properties, modal/scene-collection,
//         modal/profile-manager, modal/confirm, modal/warning, modal/input,
//         modal/about, modal/auto-config-wizard

const {
  solidPaint, accentGradientPaint, accentGlow,
  applyAutoLayout, hexToRgb,
} = require('../helpers');

async function loadFonts() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
}

async function t(str, size, weight, color) {
  await figma.loadFontAsync({ family: 'Inter', style: weight });
  const node = figma.createText();
  node.fontName   = { family: 'Inter', style: weight };
  node.fontSize   = size;
  node.characters = str;
  node.fills      = solidPaint(color);
  return node;
}

// ─── Scrim ────────────────────────────────────────────────────────────────────
function makeScrim(w = 1440, h = 900) {
  const scrim = figma.createRectangle();
  scrim.name  = 'scrim';
  scrim.resize(w, h);
  scrim.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.6 }];
  return scrim;
}

// ─── Modal frame (titlebar + optional sidebar + body + footer) ────────────────
async function makeModalFrame(title, width, height, withSidebar = false) {
  const overlay = figma.createFrame();
  overlay.name  = 'modal-overlay/' + title;
  overlay.resize(1440, 900);
  overlay.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.6 }];
  overlay.effects = [];
  applyAutoLayout(overlay, 'HORIZONTAL', 0, 0, 0);
  overlay.primaryAxisSizingMode = 'FIXED';
  overlay.counterAxisSizingMode = 'FIXED';
  overlay.primaryAxisAlignItems  = 'CENTER';
  overlay.counterAxisAlignItems  = 'CENTER';

  const modal = figma.createFrame();
  modal.name  = 'modal/' + title.toLowerCase().replace(/\s+/g, '-');
  modal.resize(width, height);
  modal.fills = solidPaint('#1C1C27');
  modal.cornerRadius = 12;
  modal.effects = [{
    type: 'DROP_SHADOW', offset: { x: 0, y: 24 }, radius: 64, spread: 0,
    color: { r: 0, g: 0, b: 0, a: 0.65 }, blendMode: 'NORMAL', visible: true,
  }];
  applyAutoLayout(modal, 'VERTICAL', 0, 0, 0);
  modal.primaryAxisSizingMode = 'FIXED';
  modal.counterAxisSizingMode = 'FIXED';

  // Titlebar
  const titlebar = figma.createFrame();
  titlebar.name  = 'titlebar';
  titlebar.resize(width, 44);
  titlebar.fills = solidPaint('#14141C');
  titlebar.cornerRadius = 0;
  applyAutoLayout(titlebar, 'HORIZONTAL', 8, 16, 0);
  titlebar.primaryAxisSizingMode  = 'FIXED';
  titlebar.counterAxisSizingMode  = 'FIXED';
  titlebar.counterAxisAlignItems  = 'CENTER';
  titlebar.primaryAxisAlignItems  = 'SPACE_BETWEEN';

  const titleText = await t(title, 15, 'Medium', '#FFFFFF');
  titleText.layoutGrow = 1;
  titlebar.appendChild(titleText);

  const closeBtn = figma.createRectangle();
  closeBtn.name   = 'close-btn';
  closeBtn.resize(14, 14);
  closeBtn.cornerRadius = 7;
  closeBtn.fills  = solidPaint('#FF5470');
  titlebar.appendChild(closeBtn);
  modal.appendChild(titlebar);

  // Divider under titlebar
  const div = figma.createRectangle();
  div.resize(width, 1);
  div.fills = solidPaint('#2A2A3A');
  modal.appendChild(div);

  // Body area (with optional sidebar)
  if (withSidebar) {
    const bodyRow = figma.createFrame();
    bodyRow.name  = 'body-row';
    bodyRow.fills = [];
    applyAutoLayout(bodyRow, 'HORIZONTAL', 0, 0, 0);
    bodyRow.primaryAxisSizingMode = 'FIXED';
    bodyRow.counterAxisSizingMode = 'FIXED';
    bodyRow.resize(width, height - 44 - 1 - 52);

    // Sidebar
    const sidebar = figma.createFrame();
    sidebar.name  = 'sidebar';
    sidebar.resize(180, height - 44 - 1 - 52);
    sidebar.fills = solidPaint('#14141C');
    applyAutoLayout(sidebar, 'VERTICAL', 2, 0, 8);
    sidebar.primaryAxisSizingMode = 'FIXED';
    sidebar.counterAxisSizingMode = 'FIXED';
    bodyRow.appendChild(sidebar);

    // Sidebar divider
    const sdiv = figma.createRectangle();
    sdiv.resize(1, height - 44 - 1 - 52);
    sdiv.fills = solidPaint('#2A2A3A');
    bodyRow.appendChild(sdiv);

    // Main content
    const content = figma.createFrame();
    content.name  = 'content';
    content.resize(width - 181, height - 44 - 1 - 52);
    content.fills = [];
    applyAutoLayout(content, 'VERTICAL', 16, 24, 20);
    content.primaryAxisSizingMode = 'FIXED';
    content.counterAxisSizingMode = 'FIXED';
    content.layoutGrow = 1;
    bodyRow.appendChild(content);

    modal.appendChild(bodyRow);
    return { overlay, modal, titlebar, sidebar, content };
  } else {
    const content = figma.createFrame();
    content.name  = 'content';
    content.resize(width, height - 44 - 1 - 52);
    content.fills = [];
    applyAutoLayout(content, 'VERTICAL', 16, 24, 20);
    content.primaryAxisSizingMode = 'FIXED';
    content.counterAxisSizingMode = 'FIXED';
    modal.appendChild(content);
    return { overlay, modal, titlebar, content };
  }
}

// ─── Footer row (Cancel + Confirm buttons) ────────────────────────────────────
async function makeModalFooter(width, confirmLabel = 'OK', confirmDanger = false) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  const footer = figma.createFrame();
  footer.name  = 'footer';
  footer.resize(width, 52);
  footer.fills = solidPaint('#14141C');
  applyAutoLayout(footer, 'HORIZONTAL', 8, 16, 0);
  footer.primaryAxisSizingMode = 'FIXED';
  footer.counterAxisSizingMode = 'FIXED';
  footer.counterAxisAlignItems = 'CENTER';
  footer.primaryAxisAlignItems = 'MAX';

  const cancelBtn = figma.createFrame();
  cancelBtn.name  = 'btn-cancel';
  cancelBtn.resize(90, 32);
  cancelBtn.cornerRadius = 6;
  cancelBtn.fills = solidPaint('#1C1C27');
  cancelBtn.strokes = solidPaint('#2A2A3A');
  cancelBtn.strokeWeight = 1;
  cancelBtn.strokeAlign  = 'INSIDE';
  applyAutoLayout(cancelBtn, 'HORIZONTAL', 0, 0, 0);
  cancelBtn.primaryAxisAlignItems  = 'CENTER';
  cancelBtn.counterAxisAlignItems  = 'CENTER';
  cancelBtn.primaryAxisSizingMode  = 'FIXED';
  cancelBtn.counterAxisSizingMode  = 'FIXED';
  const cancelText = figma.createText();
  cancelText.fontName   = { family: 'Inter', style: 'Medium' };
  cancelText.fontSize   = 13;
  cancelText.characters = 'Cancel';
  cancelText.fills      = solidPaint('#B9B9C9');
  cancelBtn.appendChild(cancelText);
  footer.appendChild(cancelBtn);

  const confirmBtn = figma.createFrame();
  confirmBtn.name  = 'btn-confirm';
  confirmBtn.resize(90, 32);
  confirmBtn.cornerRadius = 6;
  confirmBtn.fills = confirmDanger ? solidPaint('#FF5470') : accentGradientPaint();
  applyAutoLayout(confirmBtn, 'HORIZONTAL', 0, 0, 0);
  confirmBtn.primaryAxisAlignItems  = 'CENTER';
  confirmBtn.counterAxisAlignItems  = 'CENTER';
  confirmBtn.primaryAxisSizingMode  = 'FIXED';
  confirmBtn.counterAxisSizingMode  = 'FIXED';
  const confirmText = figma.createText();
  confirmText.fontName   = { family: 'Inter', style: 'Medium' };
  confirmText.fontSize   = 13;
  confirmText.characters = confirmLabel;
  confirmText.fills      = solidPaint('#FFFFFF');
  confirmBtn.appendChild(confirmText);
  footer.appendChild(confirmBtn);

  return footer;
}

// ─── Settings sidebar item ────────────────────────────────────────────────────
async function makeSidebarItem(label, isActive = false) {
  const item = figma.createFrame();
  item.name  = label;
  item.resize(180, 34);
  item.fills = isActive
    ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.15 }]
    : [];
  item.cornerRadius = 6;
  applyAutoLayout(item, 'HORIZONTAL', 8, 12, 0);
  item.primaryAxisSizingMode  = 'FIXED';
  item.counterAxisSizingMode  = 'FIXED';
  item.counterAxisAlignItems  = 'CENTER';

  if (isActive) {
    const bar = figma.createRectangle();
    bar.name  = 'active-bar';
    bar.resize(3, 20);
    bar.cornerRadius = 999;
    bar.fills = accentGradientPaint();
    item.appendChild(bar);
  }

  const ico = figma.createRectangle();
  ico.name  = 'icon';
  ico.resize(14, 14);
  ico.cornerRadius = 3;
  ico.fills = solidPaint(isActive ? '#8A5CFF' : '#6C6C80');
  item.appendChild(ico);

  await figma.loadFontAsync({ family: 'Inter', style: isActive ? 'Medium' : 'Regular' });
  const t = figma.createText();
  t.fontName   = { family: 'Inter', style: isActive ? 'Medium' : 'Regular' };
  t.fontSize   = 13;
  t.characters = label;
  t.fills      = solidPaint(isActive ? '#FFFFFF' : '#B9B9C9');
  item.appendChild(t);
  return item;
}

// ─── Settings form field ──────────────────────────────────────────────────────
async function makeFormRow(label, type = 'input') {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const row = figma.createFrame();
  row.name  = 'row-' + label;
  row.fills = [];
  applyAutoLayout(row, 'HORIZONTAL', 12, 0, 0);
  row.primaryAxisSizingMode = 'AUTO';
  row.counterAxisSizingMode = 'AUTO';
  row.counterAxisAlignItems = 'CENTER';

  const lbl = figma.createText();
  lbl.fontName   = { family: 'Inter', style: 'Regular' };
  lbl.fontSize   = 13;
  lbl.characters = label;
  lbl.fills      = solidPaint('#B9B9C9');
  lbl.resize(180, lbl.height);
  row.appendChild(lbl);

  if (type === 'input') {
    const field = figma.createFrame();
    field.resize(220, 30);
    field.cornerRadius = 8;
    field.fills = solidPaint('#14141C');
    field.strokes = solidPaint('#2A2A3A');
    field.strokeWeight = 1;
    field.strokeAlign = 'INSIDE';
    applyAutoLayout(field, 'HORIZONTAL', 0, 12, 0);
    field.primaryAxisSizingMode = 'FIXED';
    field.counterAxisSizingMode = 'FIXED';
    field.counterAxisAlignItems = 'CENTER';
    const val = figma.createText();
    val.fontName   = { family: 'Inter', style: 'Regular' };
    val.fontSize   = 13;
    val.characters = 'Value';
    val.fills      = solidPaint('#FFFFFF');
    field.appendChild(val);
    row.appendChild(field);
  } else if (type === 'dropdown') {
    const dd = figma.createFrame();
    dd.resize(220, 30);
    dd.cornerRadius = 8;
    dd.fills = solidPaint('#14141C');
    dd.strokes = solidPaint('#2A2A3A');
    dd.strokeWeight = 1;
    dd.strokeAlign = 'INSIDE';
    applyAutoLayout(dd, 'HORIZONTAL', 0, 12, 0);
    dd.primaryAxisSizingMode = 'FIXED';
    dd.counterAxisSizingMode = 'FIXED';
    dd.counterAxisAlignItems = 'CENTER';
    dd.primaryAxisAlignItems = 'SPACE_BETWEEN';
    const val = figma.createText();
    val.fontName   = { family: 'Inter', style: 'Regular' };
    val.fontSize   = 13;
    val.characters = 'Option';
    val.fills      = solidPaint('#FFFFFF');
    dd.appendChild(val);
    const chev = figma.createRectangle();
    chev.resize(10, 6);
    chev.cornerRadius = 1;
    chev.fills = solidPaint('#6C6C80');
    dd.appendChild(chev);
    row.appendChild(dd);
  } else if (type === 'toggle') {
    const track = figma.createRectangle();
    track.resize(36, 20);
    track.cornerRadius = 999;
    track.fills = solidPaint('#2A2A3A');
    row.appendChild(track);
  }

  return row;
}

// ─── modal/settings ───────────────────────────────────────────────────────────
async function buildModalSettings(page) {
  const { overlay, modal, sidebar, content } = await makeModalFrame('Settings', 760, 560, true);

  const categories = ['General', 'Stream', 'Output', 'Audio', 'Video', 'Hotkeys', 'Accessibility', 'Advanced'];
  for (let i = 0; i < categories.length; i++) {
    sidebar.appendChild(await makeSidebarItem(categories[i], i === 0));
  }

  // Video settings page (active)
  const sectionTitle = await t('Video Settings', 15, 'Medium', '#FFFFFF');
  content.appendChild(sectionTitle);

  const formRows = [
    { label: 'Base (Canvas) Resolution', type: 'dropdown' },
    { label: 'Output (Scaled) Resolution', type: 'dropdown' },
    { label: 'Downscale Filter', type: 'dropdown' },
    { label: 'Common FPS Values', type: 'dropdown' },
    { label: 'Integer FPS Value', type: 'input' },
  ];
  for (const fr of formRows) {
    content.appendChild(await makeFormRow(fr.label, fr.type));
  }

  modal.appendChild(await makeModalFooter(760, 'Apply'));
  overlay.appendChild(modal);
  page.appendChild(overlay);
  return overlay;
}

// ─── modal/filters ────────────────────────────────────────────────────────────
async function buildModalFilters(page) {
  await loadFonts();
  const { overlay, modal, content } = await makeModalFrame('Filters — Display Capture', 700, 500);

  const bodyRow = figma.createFrame();
  bodyRow.name  = 'filters-body';
  bodyRow.fills = [];
  applyAutoLayout(bodyRow, 'HORIZONTAL', 0, 0, 0);
  bodyRow.resize(700, 403);
  bodyRow.primaryAxisSizingMode = 'FIXED';
  bodyRow.counterAxisSizingMode = 'FIXED';

  // Filter list
  const filterList = figma.createFrame();
  filterList.name  = 'filter-list';
  filterList.resize(220, 403);
  filterList.fills = solidPaint('#14141C');
  applyAutoLayout(filterList, 'VERTICAL', 2, 0, 8);
  filterList.primaryAxisSizingMode = 'FIXED';
  filterList.counterAxisSizingMode = 'FIXED';

  const listToolbar = figma.createFrame();
  listToolbar.name = 'list-toolbar';
  listToolbar.fills = solidPaint('#0B0B0F');
  applyAutoLayout(listToolbar, 'HORIZONTAL', 4, 8, 4);
  listToolbar.primaryAxisSizingMode = 'AUTO';
  listToolbar.counterAxisSizingMode = 'AUTO';
  for (const ico of ['+', '−', '↑', '↓']) {
    const btn = figma.createFrame();
    btn.resize(24, 24);
    btn.cornerRadius = 4;
    btn.fills = solidPaint('#1C1C27');
    applyAutoLayout(btn, 'HORIZONTAL', 0, 0, 0);
    btn.primaryAxisAlignItems = 'CENTER';
    btn.counterAxisAlignItems = 'CENTER';
    btn.primaryAxisSizingMode = 'FIXED';
    btn.counterAxisSizingMode = 'FIXED';
    const icoRect = figma.createRectangle();
    icoRect.resize(10, 10);
    icoRect.cornerRadius = 2;
    icoRect.fills = solidPaint('#6C6C80');
    btn.appendChild(icoRect);
    listToolbar.appendChild(btn);
  }
  filterList.appendChild(listToolbar);

  const filters = ['Color Correction', 'Crop/Pad', 'Sharpness', 'LUT Filter', 'Scroll'];
  for (let i = 0; i < filters.length; i++) {
    const item = figma.createFrame();
    item.name  = filters[i];
    item.resize(220, 30);
    item.fills = i === 0 ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.15 }] : [];
    item.cornerRadius = 4;
    applyAutoLayout(item, 'HORIZONTAL', 8, 10, 0);
    item.primaryAxisSizingMode = 'FIXED';
    item.counterAxisSizingMode = 'FIXED';
    item.counterAxisAlignItems = 'CENTER';
    const icoR = figma.createRectangle();
    icoR.resize(12, 12);
    icoR.cornerRadius = 3;
    icoR.fills = solidPaint(i === 0 ? '#8A5CFF' : '#2A2A3A');
    item.appendChild(icoR);
    const lbl = figma.createText();
    lbl.fontName   = { family: 'Inter', style: 'Regular' };
    lbl.fontSize   = 12;
    lbl.characters = filters[i];
    lbl.fills      = solidPaint(i === 0 ? '#FFFFFF' : '#B9B9C9');
    item.appendChild(lbl);
    filterList.appendChild(item);
  }
  bodyRow.appendChild(filterList);

  // Divider
  const vdiv = figma.createRectangle();
  vdiv.resize(1, 403);
  vdiv.fills = solidPaint('#2A2A3A');
  bodyRow.appendChild(vdiv);

  // Properties pane
  const propsPane = figma.createFrame();
  propsPane.name  = 'filter-properties';
  propsPane.resize(479, 403);
  propsPane.fills = [];
  applyAutoLayout(propsPane, 'VERTICAL', 14, 20, 16);
  propsPane.primaryAxisSizingMode = 'FIXED';
  propsPane.counterAxisSizingMode = 'FIXED';

  const propTitle = await t('Color Correction', 14, 'Medium', '#FFFFFF');
  propsPane.appendChild(propTitle);

  const propRows = [
    { label: 'Gamma',      type: 'input' },
    { label: 'Contrast',   type: 'input' },
    { label: 'Brightness', type: 'input' },
    { label: 'Saturation', type: 'input' },
    { label: 'Hue Shift',  type: 'input' },
    { label: 'Opacity',    type: 'input' },
  ];
  for (const pr of propRows) propsPane.appendChild(await makeFormRow(pr.label, pr.type));
  bodyRow.appendChild(propsPane);

  // Replace auto-generated content with our custom body
  // Remove default content if present
  const existingContent = modal.findChild(n => n.name === 'content');
  if (existingContent) existingContent.remove();

  modal.appendChild(bodyRow);
  modal.appendChild(await makeModalFooter(700, 'Close'));
  overlay.appendChild(modal);
  page.appendChild(overlay);
  return overlay;
}

// ─── modal/properties ────────────────────────────────────────────────────────
async function buildModalProperties(page) {
  await loadFonts();
  const { overlay, modal, content } = await makeModalFrame('Transform — Display Capture', 520, 540);

  const sections = [
    { label: 'Position & Size', rows: [
      ['Position X', 'input'], ['Position Y', 'input'],
      ['Width', 'input'],      ['Height', 'input'],
    ]},
    { label: 'Rotation', rows: [['Rotation', 'input']] },
    { label: 'Crop', rows: [
      ['Left', 'input'], ['Right', 'input'],
      ['Top', 'input'],  ['Bottom', 'input'],
    ]},
    { label: 'Blend Mode', rows: [['Mode', 'dropdown']] },
  ];

  for (const sec of sections) {
    const secTitle = await t(sec.label, 13, 'Medium', '#B9B9C9');
    content.appendChild(secTitle);
    for (const [lbl, type] of sec.rows) {
      content.appendChild(await makeFormRow(lbl, type));
    }
    const divider = figma.createRectangle();
    divider.resize(472, 1);
    divider.fills = solidPaint('#2A2A3A');
    content.appendChild(divider);
  }

  modal.appendChild(await makeModalFooter(520, 'Reset', false));
  overlay.appendChild(modal);
  page.appendChild(overlay);
  return overlay;
}

// ─── modal/confirm ────────────────────────────────────────────────────────────
async function buildModalConfirm(page, isDanger = false) {
  await loadFonts();
  const { overlay, modal, content } = await makeModalFrame(
    isDanger ? 'Delete Scene' : 'Confirm Action', 400, 220
  );

  // Icon
  const iconBg = figma.createRectangle();
  iconBg.name  = 'icon-bg';
  iconBg.resize(40, 40);
  iconBg.cornerRadius = 20;
  iconBg.fills = solidPaint(isDanger ? '#FF5470' : '#8A5CFF');
  content.appendChild(iconBg);

  const msgTitle = await t(
    isDanger ? 'Delete "Main Scene"?' : 'Confirm Action',
    15, 'Medium', '#FFFFFF'
  );
  content.appendChild(msgTitle);

  const msgBody = await t(
    isDanger
      ? 'This action cannot be undone. The scene and all its sources will be permanently removed.'
      : 'Are you sure you want to proceed?',
    13, 'Regular', '#B9B9C9'
  );
  content.appendChild(msgBody);

  modal.appendChild(await makeModalFooter(400, isDanger ? 'Delete' : 'Confirm', isDanger));
  overlay.appendChild(modal);
  page.appendChild(overlay);
  return overlay;
}

// ─── modal/input ──────────────────────────────────────────────────────────────
async function buildModalInput(page) {
  await loadFonts();
  const { overlay, modal, content } = await makeModalFrame('Rename Scene', 400, 180);

  const lbl = await t('Scene name', 13, 'Regular', '#B9B9C9');
  content.appendChild(lbl);

  const field = figma.createFrame();
  field.name  = 'rename-input';
  field.resize(352, 32);
  field.cornerRadius = 8;
  field.fills = solidPaint('#14141C');
  field.strokes = solidPaint('#8A5CFF');
  field.strokeWeight = 1.5;
  field.strokeAlign  = 'INSIDE';
  field.effects = [{
    type: 'DROP_SHADOW', offset: { x: 0, y: 0 }, radius: 18, spread: 0,
    color: Object.assign({ a: 0.35 }, hexToRgb('#8A5CFF')), blendMode: 'NORMAL', visible: true,
  }];
  applyAutoLayout(field, 'HORIZONTAL', 0, 12, 0);
  field.primaryAxisSizingMode = 'FIXED';
  field.counterAxisSizingMode = 'FIXED';
  field.counterAxisAlignItems = 'CENTER';
  const fieldText = figma.createText();
  fieldText.fontName   = { family: 'Inter', style: 'Regular' };
  fieldText.fontSize   = 13;
  fieldText.characters = 'Main Scene';
  fieldText.fills      = solidPaint('#FFFFFF');
  field.appendChild(fieldText);
  content.appendChild(field);

  modal.appendChild(await makeModalFooter(400, 'Rename'));
  overlay.appendChild(modal);
  page.appendChild(overlay);
  return overlay;
}

// ─── modal/scene-collection ───────────────────────────────────────────────────
async function buildModalSceneCollection(page) {
  await loadFonts();
  const { overlay, modal, content } = await makeModalFrame('Scene Collection Manager', 500, 420);

  const toolbar = figma.createFrame();
  toolbar.name  = 'collection-toolbar';
  toolbar.fills = [];
  applyAutoLayout(toolbar, 'HORIZONTAL', 8, 0, 0);
  toolbar.primaryAxisSizingMode = 'AUTO';
  toolbar.counterAxisSizingMode = 'AUTO';

  for (const lbl of ['New', 'Rename', 'Duplicate', 'Delete', 'Import', 'Export']) {
    const btn = figma.createFrame();
    btn.name  = 'btn-' + lbl;
    btn.resize(70, 28);
    btn.cornerRadius = 6;
    btn.fills = lbl === 'Delete'
      ? solidPaint('#FF5470')
      : solidPaint('#1C1C27');
    btn.strokes = lbl === 'Delete' ? [] : solidPaint('#2A2A3A');
    btn.strokeWeight = 1;
    btn.strokeAlign  = 'INSIDE';
    applyAutoLayout(btn, 'HORIZONTAL', 0, 0, 0);
    btn.primaryAxisAlignItems = 'CENTER';
    btn.counterAxisAlignItems = 'CENTER';
    btn.primaryAxisSizingMode = 'FIXED';
    btn.counterAxisSizingMode = 'FIXED';
    const bText = figma.createText();
    bText.fontName   = { family: 'Inter', style: 'Regular' };
    bText.fontSize   = 11;
    bText.characters = lbl;
    bText.fills      = solidPaint('#FFFFFF');
    btn.appendChild(bText);
    toolbar.appendChild(btn);
  }
  content.appendChild(toolbar);

  const collections = ['Default', 'Streaming Setup', 'Recording Setup', 'Podcast Mode'];
  for (let i = 0; i < collections.length; i++) {
    const item = figma.createFrame();
    item.name  = collections[i];
    item.resize(452, 36);
    item.cornerRadius = 6;
    item.fills = i === 0
      ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.15 }]
      : [];
    applyAutoLayout(item, 'HORIZONTAL', 8, 10, 0);
    item.primaryAxisSizingMode = 'FIXED';
    item.counterAxisSizingMode = 'FIXED';
    item.counterAxisAlignItems = 'CENTER';
    const icoR = figma.createRectangle();
    icoR.resize(14, 14);
    icoR.cornerRadius = 3;
    icoR.fills = solidPaint(i === 0 ? '#8A5CFF' : '#2A2A3A');
    item.appendChild(icoR);
    const lbl = figma.createText();
    lbl.fontName   = { family: 'Inter', style: i === 0 ? 'Medium' : 'Regular' };
    lbl.fontSize   = 13;
    lbl.characters = collections[i] + (i === 0 ? ' (Active)' : '');
    lbl.fills      = solidPaint(i === 0 ? '#FFFFFF' : '#B9B9C9');
    item.appendChild(lbl);
    content.appendChild(item);
  }

  modal.appendChild(await makeModalFooter(500, 'Done'));
  overlay.appendChild(modal);
  page.appendChild(overlay);
  return overlay;
}

// ─── modal/about ─────────────────────────────────────────────────────────────
async function buildModalAbout(page) {
  await loadFonts();
  const { overlay, modal, content } = await makeModalFrame('About OBS Studio', 380, 260);
  content.primaryAxisAlignItems = 'CENTER';
  content.counterAxisAlignItems = 'CENTER';

  // Logo block
  const logo = figma.createFrame();
  logo.name  = 'logo';
  logo.resize(56, 56);
  logo.cornerRadius = 14;
  logo.fills = accentGradientPaint();
  applyAutoLayout(logo, 'HORIZONTAL', 0, 0, 0);
  logo.primaryAxisAlignItems = 'CENTER';
  logo.counterAxisAlignItems = 'CENTER';
  logo.primaryAxisSizingMode = 'FIXED';
  logo.counterAxisSizingMode = 'FIXED';
  const logoText = figma.createText();
  logoText.fontName   = { family: 'Inter', style: 'Semi Bold' };
  logoText.fontSize   = 22;
  logoText.characters = 'OBS';
  logoText.fills      = solidPaint('#FFFFFF');
  logo.appendChild(logoText);
  content.appendChild(logo);

  content.appendChild(await t('OBS Studio', 18, 'Semi Bold', '#FFFFFF'));
  content.appendChild(await t('Version 31.0.0', 13, 'Regular', '#B9B9C9'));
  content.appendChild(await t('Free and open source software\nfor video recording and live streaming', 12, 'Regular', '#6C6C80'));

  modal.appendChild(await makeModalFooter(380, 'Close'));
  overlay.appendChild(modal);
  page.appendChild(overlay);
  return overlay;
}

async function buildAllModals(page) {
  await loadFonts();

  const settings        = await buildModalSettings(page);
  const filters         = await buildModalFilters(page);
  const properties      = await buildModalProperties(page);
  const confirmDanger   = await buildModalConfirm(page, true);
  const confirmNeutral  = await buildModalConfirm(page, false);
  const inputModal      = await buildModalInput(page);
  const sceneCollection = await buildModalSceneCollection(page);
  const about           = await buildModalAbout(page);

  // Stack modals vertically with offset for visibility
  const modals = [settings, filters, properties, confirmDanger,
                  confirmNeutral, inputModal, sceneCollection, about];
  let x = 0;
  for (const m of modals) {
    m.x = x;
    m.y = 0;
    x  += 1440 + 40;
  }

  return { settings, filters, properties, confirmDanger, confirmNeutral,
           inputModal, sceneCollection, about };
}

module.exports = { buildAllModals };
