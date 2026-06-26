// ─── Menu, toolbar, status bar, and context menu builder ─────────────────────
// Builds: menu/bar, menu/dropdown, menu/context (4 variants),
//         toolbar/main, statusbar, list/item component set

const {
  solidPaint, accentGradientPaint, accentGlow,
  applyAutoLayout, hexToRgb,
} = require('../helpers');

async function loadFonts() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
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

// ─── Menu bar item ────────────────────────────────────────────────────────────
async function makeMenuBarItem(label, state = 'Default') {
  const item = figma.createFrame();
  item.name  = 'menu-item/' + label + '/' + state;
  item.resize(48, 30);
  item.cornerRadius = 4;
  item.fills = state === 'Open'  ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.15 }]
             : state === 'Hover' ? [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.06 }]
             : [];
  applyAutoLayout(item, 'HORIZONTAL', 0, 10, 0);
  item.primaryAxisSizingMode  = 'FIXED';
  item.counterAxisSizingMode  = 'FIXED';
  item.primaryAxisAlignItems  = 'CENTER';
  item.counterAxisAlignItems  = 'CENTER';
  if (state === 'Disabled') item.opacity = 0.4;

  const t = await tx(label, 13, 'Regular',
    state === 'Open' ? '#FFFFFF' : state === 'Disabled' ? '#6C6C80' : '#B9B9C9'
  );
  item.appendChild(t);
  return item;
}

// ─── menu/bar ─────────────────────────────────────────────────────────────────
async function buildMenuBar(page) {
  await loadFonts();

  const bar = figma.createFrame();
  bar.name  = 'menu/bar';
  bar.resize(1440, 30);
  bar.fills = solidPaint('#14141C');
  bar.strokes = solidPaint('#2A2A3A');
  bar.strokeWeight = 1;
  bar.strokeAlign  = 'OUTSIDE';
  applyAutoLayout(bar, 'HORIZONTAL', 0, 8, 0);
  bar.primaryAxisSizingMode = 'FIXED';
  bar.counterAxisSizingMode = 'FIXED';
  bar.counterAxisAlignItems = 'CENTER';

  // App icon
  const appIcon = figma.createRectangle();
  appIcon.name  = 'app-icon';
  appIcon.resize(20, 20);
  appIcon.cornerRadius = 4;
  appIcon.fills = accentGradientPaint();
  bar.appendChild(appIcon);

  const menuItems = ['File', 'Edit', 'View', 'Profile', 'Scene Collection', 'Tools', 'Help'];
  for (const m of menuItems) {
    bar.appendChild(await makeMenuBarItem(m));
  }

  // Spacer
  const spacer = figma.createRectangle();
  spacer.name  = 'spacer';
  spacer.fills = [];
  spacer.resize(400, 1);
  spacer.layoutGrow = 1;
  bar.appendChild(spacer);

  page.appendChild(bar);
  return bar;
}

// ─── menu/item variants ───────────────────────────────────────────────────────
async function makeMenuItem(label, shortcut = '', hasSubmenu = false,
                             type = 'default', isActive = false) {
  if (type === 'separator') {
    const sep = figma.createFrame();
    sep.name  = 'menu/separator';
    sep.resize(200, 9);
    sep.fills = [];
    applyAutoLayout(sep, 'HORIZONTAL', 0, 8, 0);
    sep.primaryAxisSizingMode = 'FIXED';
    sep.counterAxisSizingMode = 'FIXED';
    sep.counterAxisAlignItems = 'CENTER';
    const line = figma.createRectangle();
    line.resize(184, 1);
    line.fills = solidPaint('#2A2A3A');
    sep.appendChild(line);
    return sep;
  }

  const item = figma.createFrame();
  item.name  = 'menu/item/' + label;
  item.resize(200, 30);
  item.cornerRadius = 4;
  item.fills = isActive
    ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.15 }]
    : [];
  applyAutoLayout(item, 'HORIZONTAL', 6, 10, 0);
  item.primaryAxisSizingMode  = 'FIXED';
  item.counterAxisSizingMode  = 'FIXED';
  item.counterAxisAlignItems  = 'CENTER';
  item.primaryAxisAlignItems  = 'SPACE_BETWEEN';

  if (type === 'checkbox') {
    const check = figma.createRectangle();
    check.resize(12, 12);
    check.cornerRadius = 3;
    check.fills = isActive ? accentGradientPaint() : solidPaint('#2A2A3A');
    item.appendChild(check);
  } else if (type === 'radio') {
    const radio = figma.createEllipse();
    radio.resize(12, 12);
    radio.fills = isActive ? accentGradientPaint() : [];
    radio.strokes = solidPaint('#2A2A3A');
    radio.strokeWeight = 1.5;
    item.appendChild(radio);
  } else {
    // Icon placeholder
    const ico = figma.createRectangle();
    ico.resize(14, 14);
    ico.cornerRadius = 3;
    ico.fills = solidPaint('#2A2A3A');
    item.appendChild(ico);
  }

  const t = await tx(label, 13, 'Regular', isActive ? '#FFFFFF' : '#B9B9C9');
  t.layoutGrow = 1;
  item.appendChild(t);

  if (shortcut) {
    const sc = await tx(shortcut, 11, 'Regular', '#6C6C80');
    item.appendChild(sc);
  }

  if (hasSubmenu) {
    const arrow = figma.createRectangle();
    arrow.resize(6, 10);
    arrow.cornerRadius = 1;
    arrow.fills = solidPaint('#6C6C80');
    item.appendChild(arrow);
  }

  return item;
}

// ─── menu/dropdown ────────────────────────────────────────────────────────────
async function buildMenuDropdown(items, name) {
  const menu = figma.createFrame();
  menu.name  = 'menu/dropdown/' + name;
  menu.fills = solidPaint('#1C1C27');
  menu.cornerRadius = 8;
  menu.strokes = solidPaint('#2A2A3A');
  menu.strokeWeight = 1;
  menu.strokeAlign  = 'OUTSIDE';
  menu.effects = [{
    type: 'DROP_SHADOW', offset: { x: 0, y: 8 }, radius: 24, spread: 0,
    color: { r: 0, g: 0, b: 0, a: 0.5 }, blendMode: 'NORMAL', visible: true,
  }];
  applyAutoLayout(menu, 'VERTICAL', 2, 4, 4);
  menu.primaryAxisSizingMode = 'AUTO';
  menu.counterAxisSizingMode = 'AUTO';

  for (const item of items) {
    menu.appendChild(item);
  }
  return menu;
}

// ─── Context menus ────────────────────────────────────────────────────────────
async function buildContextMenuScene(page) {
  await loadFonts();
  const items = [
    await makeMenuItem('Add Scene'),
    await makeMenuItem('Remove Scene', '', false, 'default'),
    await makeMenuItem('Rename', 'F2'),
    await makeMenuItem('Duplicate'),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Lock/Unlock', '', false, 'checkbox', true),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Scene Filters…'),
    await makeMenuItem('Scene Transitions…'),
    await makeMenuItem('Copy Filters'),
    await makeMenuItem('Paste Filters'),
  ];
  const menu = await buildMenuDropdown(items, 'scene');
  menu.name  = 'menu/context/scene';
  page.appendChild(menu);
  return menu;
}

async function buildContextMenuSource(page) {
  await loadFonts();
  const items = [
    await makeMenuItem('Rename', 'F2'),
    await makeMenuItem('Remove Source', 'Del'),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Order', '', true),
    await makeMenuItem('Transform', '', true),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Filters…'),
    await makeMenuItem('Properties…'),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Copy Source'),
    await makeMenuItem('Paste (Reference)'),
    await makeMenuItem('Duplicate'),
  ];
  const menu = await buildMenuDropdown(items, 'source');
  menu.name  = 'menu/context/source';
  page.appendChild(menu);
  return menu;
}

async function buildContextMenuMixer(page) {
  await loadFonts();
  const items = [
    await makeMenuItem('Mute', '', false, 'checkbox'),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Audio Monitoring', '', false, 'checkbox', true),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Filters…'),
    await makeMenuItem('Properties…'),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Mixer Layout', '', true),
  ];
  const menu = await buildMenuDropdown(items, 'mixer');
  menu.name  = 'menu/context/mixer';
  page.appendChild(menu);
  return menu;
}

async function buildContextMenuDock(page) {
  await loadFonts();
  const items = [
    await makeMenuItem('Scenes',          '', false, 'checkbox', true),
    await makeMenuItem('Sources',         '', false, 'checkbox', true),
    await makeMenuItem('Audio Mixer',     '', false, 'checkbox', true),
    await makeMenuItem('Scene Transitions','', false, 'checkbox', true),
    await makeMenuItem('Controls',        '', false, 'checkbox', true),
    await makeMenuItem('Stats',           '', false, 'checkbox'),
    await makeMenuItem('Log Viewer',      '', false, 'checkbox'),
    await makeMenuItem('separator', '', false, 'separator'),
    await makeMenuItem('Lock Docks',      '', false, 'checkbox'),
    await makeMenuItem('Reset UI',        ''),
  ];
  const menu = await buildMenuDropdown(items, 'dock');
  menu.name  = 'menu/context/dock';
  page.appendChild(menu);
  return menu;
}

// ─── toolbar/main ─────────────────────────────────────────────────────────────
async function buildToolbar(page) {
  const toolbar = figma.createFrame();
  toolbar.name  = 'toolbar/main';
  toolbar.resize(1440, 40);
  toolbar.fills = solidPaint('#14141C');
  toolbar.strokes = solidPaint('#2A2A3A');
  toolbar.strokeWeight = 1;
  toolbar.strokeAlign  = 'OUTSIDE';
  applyAutoLayout(toolbar, 'HORIZONTAL', 4, 8, 0);
  toolbar.primaryAxisSizingMode = 'FIXED';
  toolbar.counterAxisSizingMode = 'FIXED';
  toolbar.counterAxisAlignItems = 'CENTER';

  const tools = [
    { name: 'studio-mode',       tooltip: 'Studio Mode',       active: false },
    { name: 'fullscreen-preview',tooltip: 'Fullscreen Preview',active: false },
    { name: 'screenshot',        tooltip: 'Screenshot',        active: false },
    { name: 'stats',             tooltip: 'Statistics',        active: true  },
    { name: 'multiview',         tooltip: 'Multiview',         active: false },
    { name: 'recording-folder',  tooltip: 'Recording Folder',  active: false },
    { name: 'settings',          tooltip: 'Settings',          active: false },
  ];

  for (const tool of tools) {
    const btn = figma.createFrame();
    btn.name  = 'toolbar-btn/' + tool.name;
    btn.resize(32, 32);
    btn.cornerRadius = 6;
    btn.fills = tool.active
      ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.18 }]
      : solidPaint('#1C1C27');
    btn.strokes = solidPaint(tool.active ? '#8A5CFF' : '#2A2A3A');
    btn.strokeWeight = 1;
    btn.strokeAlign  = 'INSIDE';
    if (tool.active) btn.effects = [accentGlow()];
    applyAutoLayout(btn, 'HORIZONTAL', 0, 0, 0);
    btn.primaryAxisAlignItems = 'CENTER';
    btn.counterAxisAlignItems = 'CENTER';
    btn.primaryAxisSizingMode = 'FIXED';
    btn.counterAxisSizingMode = 'FIXED';

    const ico = figma.createRectangle();
    ico.name  = tool.name + '-icon';
    ico.resize(16, 16);
    ico.cornerRadius = 3;
    ico.fills = solidPaint(tool.active ? '#8A5CFF' : '#6C6C80');
    btn.appendChild(ico);
    toolbar.appendChild(btn);
  }

  page.appendChild(toolbar);
  return toolbar;
}

// ─── statusbar ────────────────────────────────────────────────────────────────
async function buildStatusBar(page) {
  await loadFonts();

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

  const metrics = [
    { label: 'CPU: 12.4%',       color: '#B9B9C9' },
    { label: '60.0 FPS',         color: '#3DDC97' },
    { label: 'Dropped: 0 (0%)',  color: '#B9B9C9' },
    { label: '● REC 00:12:34',   color: '#FF5470' },
    { label: '● LIVE 01:05:22',  color: '#FF5470' },
  ];

  for (let i = 0; i < metrics.length; i++) {
    if (i > 0) {
      const sep = figma.createRectangle();
      sep.resize(1, 12);
      sep.fills = solidPaint('#2A2A3A');
      bar.appendChild(sep);
    }
    const t = figma.createText();
    t.fontName   = { family: 'Inter', style: 'Regular' };
    t.fontSize   = 11;
    t.characters = metrics[i].label;
    t.fills      = solidPaint(metrics[i].color);
    bar.appendChild(t);
  }

  page.appendChild(bar);
  return bar;
}

// ─── list/item component set ─────────────────────────────────────────────────
async function buildListItemSet(page) {
  await loadFonts();

  const STATES = ['Default', 'Hover', 'Selected', 'Active', 'Dragging', 'Disabled', 'Locked'];
  const components = [];

  for (const state of STATES) {
    const c = figma.createComponent();
    c.name  = `list/item, state=${state}`;
    c.resize(260, 30);
    c.cornerRadius = 6;
    c.fills = state === 'Selected' || state === 'Active'
      ? [{ type: 'SOLID', color: hexToRgb('#8A5CFF'), opacity: 0.18 }]
      : state === 'Hover'
      ? [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.06 }]
      : state === 'Dragging'
      ? solidPaint('#1C1C27')
      : [];

    if (state === 'Dragging') {
      c.strokes = solidPaint('#8A5CFF');
      c.strokeWeight = 1.5;
      c.strokeAlign  = 'INSIDE';
      c.effects = [accentGlow()];
    }
    if (state === 'Disabled') c.opacity = 0.4;

    applyAutoLayout(c, 'HORIZONTAL', 6, 8, 0);
    c.primaryAxisSizingMode  = 'FIXED';
    c.counterAxisSizingMode  = 'FIXED';
    c.counterAxisAlignItems  = 'CENTER';

    // Active indicator bar
    if (state === 'Active') {
      const bar = figma.createRectangle();
      bar.name  = 'active-bar';
      bar.resize(3, 18);
      bar.cornerRadius = 999;
      bar.fills = accentGradientPaint();
      c.appendChild(bar);
    }

    // Drag handle
    const dragHandle = figma.createFrame();
    dragHandle.name   = 'drag-handle';
    dragHandle.resize(8, 14);
    dragHandle.fills = [];
    applyAutoLayout(dragHandle, 'VERTICAL', 3, 0, 0);
    dragHandle.primaryAxisAlignItems = 'CENTER';
    dragHandle.counterAxisAlignItems = 'CENTER';
    dragHandle.primaryAxisSizingMode = 'FIXED';
    dragHandle.counterAxisSizingMode = 'FIXED';
    for (let i = 0; i < 3; i++) {
      const row = figma.createFrame();
      row.fills = [];
      applyAutoLayout(row, 'HORIZONTAL', 2, 0, 0);
      row.primaryAxisSizingMode = 'AUTO';
      row.counterAxisSizingMode = 'AUTO';
      for (let j = 0; j < 2; j++) {
        const dot = figma.createEllipse();
        dot.resize(2, 2);
        dot.fills = solidPaint(state === 'Dragging' ? '#8A5CFF' : '#2A2A3A');
        row.appendChild(dot);
      }
      dragHandle.appendChild(row);
    }
    c.appendChild(dragHandle);

    // Source icon
    const ico = figma.createRectangle();
    ico.resize(14, 14);
    ico.cornerRadius = 3;
    ico.fills = solidPaint(
      state === 'Locked'   ? '#2A2A3A' :
      state === 'Active'   ? '#8A5CFF' :
      state === 'Disabled' ? '#2A2A3A' : '#6C6C80'
    );
    c.appendChild(ico);

    // Label
    const label = figma.createText();
    label.fontName   = { family: 'Inter', style: state === 'Active' ? 'Medium' : 'Regular' };
    label.fontSize   = 12;
    label.characters = 'List item label';
    label.fills      = solidPaint(
      state === 'Disabled' ? '#6C6C80' :
      state === 'Active'   ? '#FFFFFF' : '#B9B9C9'
    );
    label.layoutGrow = 1;
    c.appendChild(label);

    // Trailing: visibility + lock
    if (state !== 'Locked') {
      const eye = figma.createEllipse();
      eye.resize(12, 12);
      eye.fills = solidPaint('#6C6C80');
      c.appendChild(eye);
    } else {
      const lockIco = figma.createRectangle();
      lockIco.resize(10, 12);
      lockIco.cornerRadius = 2;
      lockIco.fills = solidPaint('#FFC857');
      c.appendChild(lockIco);
    }

    components.push(c);
  }

  const set = figma.combineAsVariants(components, page);
  set.name  = 'list/item';
  set.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.12 }, opacity: 0.5 }];
  applyAutoLayout(set, 'VERTICAL', 4, 16, 16);
  return set;
}

async function buildAllMenus(page) {
  await loadFonts();

  const menuBar       = await buildMenuBar(page);
  const toolbar       = await buildToolbar(page);
  const statusBar     = await buildStatusBar(page);
  const ctxScene      = await buildContextMenuScene(page);
  const ctxSource     = await buildContextMenuSource(page);
  const ctxMixer      = await buildContextMenuMixer(page);
  const ctxDock       = await buildContextMenuDock(page);
  const listItemSet   = await buildListItemSet(page);

  // Layout on page
  menuBar.x      = 0;  menuBar.y      = 0;
  toolbar.x      = 0;  toolbar.y      = 50;
  statusBar.x    = 0;  statusBar.y    = 110;
  ctxScene.x     = 0;  ctxScene.y     = 160;
  ctxSource.x    = 220; ctxSource.y   = 160;
  ctxMixer.x     = 440; ctxMixer.y    = 160;
  ctxDock.x      = 660; ctxDock.y     = 160;
  listItemSet.x  = 0;  listItemSet.y  = 480;

  return { menuBar, toolbar, statusBar, ctxScene, ctxSource, ctxMixer, ctxDock, listItemSet };
}

module.exports = { buildAllMenus };
