import type { IJsonModel } from 'flexlayout-react'

// Default dock layout matching the approved Figma design
// Left dock: Scenes (top 50%) + Sources (bottom 50%)
// Center:    Preview (top 70%) + Audio Mixer (bottom 30%)
// Right dock: Controls panel
export const DEFAULT_LAYOUT_MODEL: IJsonModel = {
  global: {
    splitterSize: 4,
    splitterExtra: 4,
    tabEnableFloat: false,
    tabEnableClose: false,
    tabEnableRename: false,
    tabSetEnableMaximize: false,
    tabSetMinWidth: 160,
    tabSetMinHeight: 60,
    tabSetClassNameTabStrip: 'cb-tabstrip',
  },
  borders: [],
  layout: {
    type: 'row',
    id: 'root',
    children: [
      // ── Left dock ──────────────────────────────────────────────
      {
        type: 'row',
        id: 'left-dock',
        weight: 15,
        children: [
          {
            type: 'tabset',
            id: 'scenes-tabset',
            weight: 50,
            enableMaximize: false,
            children: [
              {
                type: 'tab',
                id: 'scenes-tab',
                name: 'Scenes',
                component: 'scenes',
                enableClose: false,
              },
            ],
          },
          {
            type: 'tabset',
            id: 'sources-tabset',
            weight: 50,
            enableMaximize: false,
            children: [
              {
                type: 'tab',
                id: 'sources-tab',
                name: 'Sources',
                component: 'sources',
                enableClose: false,
              },
            ],
          },
        ],
      },

      // ── Center ─────────────────────────────────────────────────
      {
        type: 'row',
        id: 'center',
        weight: 70,
        children: [
          {
            type: 'tabset',
            id: 'preview-tabset',
            weight: 70,
            enableMaximize: false,
            children: [
              {
                type: 'tab',
                id: 'preview-tab',
                name: 'Preview',
                component: 'preview',
                enableClose: false,
              },
            ],
          },
          {
            type: 'tabset',
            id: 'mixer-tabset',
            weight: 30,
            enableMaximize: false,
            children: [
              {
                type: 'tab',
                id: 'mixer-tab',
                name: 'Audio Mixer',
                component: 'mixer',
                enableClose: false,
              },
            ],
          },
        ],
      },

      // ── Right dock ─────────────────────────────────────────────
      {
        type: 'tabset',
        id: 'controls-tabset',
        weight: 15,
        enableMaximize: false,
        children: [
          {
            type: 'tab',
            id: 'controls-tab',
            name: 'Controls',
            component: 'controls',
            enableClose: false,
          },
        ],
      },
    ],
  },
}
