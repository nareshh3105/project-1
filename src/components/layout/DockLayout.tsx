import { useCallback, useRef } from 'react'
import { Layout, Model, type TabNode } from 'flexlayout-react'
import 'flexlayout-react/style/dark.css'

import { useUIStore } from '@/stores/uiStore'
import { DEFAULT_LAYOUT_MODEL } from '@/config/layoutConfig'
import { ScenesPanel }     from '@/components/panels/ScenesPanel'
import { SourcesPanel }    from '@/components/panels/SourcesPanel'
import { PreviewPanel }    from '@/components/panels/PreviewPanel'
import { AudioMixerPanel } from '@/components/panels/AudioMixerPanel'
import { ControlsPanel }   from '@/components/panels/ControlsPanel'

// Map component name → React component
function factory(node: TabNode) {
  const component = node.getComponent()
  switch (component) {
    case 'scenes':  return <ScenesPanel />
    case 'sources': return <SourcesPanel />
    case 'preview': return <PreviewPanel />
    case 'mixer':   return <AudioMixerPanel />
    case 'controls': return <ControlsPanel />
    default:
      return (
        <div className="flex items-center justify-center h-full text-text-muted text-caption">
          Unknown panel: {component}
        </div>
      )
  }
}

export function DockLayout() {
  const { layoutJson, setLayoutJson } = useUIStore((s) => ({
    layoutJson:    s.layoutJson,
    setLayoutJson: s.setLayoutJson,
  }))

  // Build model once on mount; persisted JSON wins, else use default
  const modelRef = useRef<Model | null>(null)
  if (!modelRef.current) {
    try {
      modelRef.current = layoutJson
        ? Model.fromJson(JSON.parse(layoutJson))
        : Model.fromJson(DEFAULT_LAYOUT_MODEL)
    } catch {
      // Corrupt persisted layout — fall back to default
      modelRef.current = Model.fromJson(DEFAULT_LAYOUT_MODEL)
    }
  }

  const handleModelChange = useCallback(
    (model: Model) => {
      setLayoutJson(JSON.stringify(model.toJson()))
    },
    [setLayoutJson]
  )

  return (
    <div className="flex-1 relative overflow-hidden">
      <Layout
        model={modelRef.current}
        factory={factory}
        onModelChange={handleModelChange}
        realtimeResize
      />
    </div>
  )
}
