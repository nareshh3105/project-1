import { SceneCanvas } from './SceneCanvas'
import { useTransitionStore } from '@/stores/transitionStore'

/**
 * A scene on air. While a transition into it is playing, the scene it replaces
 * stays drawn underneath: a fade takes the old one away, a slide moves both
 * left, a wipe uncovers the new one. The recorder draws the same, with the same
 * easing, so this is what the recording shows.
 */

interface Props {
  sceneId: string | null
  /** Lets sources be dragged and resized. Switched off while a transition plays. */
  interactive?: boolean
  showPlaceholder?: boolean
}

export function TransitioningScene({ sceneId, interactive = false, showPlaceholder = true }: Props) {
  const active = useTransitionStore((s) => s.active)

  // Only while this scene is the one being brought in.
  const moving = active && sceneId && active.toSceneId === sceneId && active.fromSceneId ? active : null
  if (!moving) return <SceneCanvas sceneId={sceneId} interactive={interactive} showPlaceholder={showPlaceholder} />

  const motion = (name: string): React.CSSProperties => ({
    animationName: name,
    animationDuration: `${moving.durationMs}ms`,
    animationTimingFunction: 'ease-in-out',
    animationFillMode: 'both',
  })

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <div className="absolute inset-0" style={moving.type === 'slide' ? motion('xslide-out') : undefined}>
        <SceneCanvas sceneId={moving.type === 'fade' ? sceneId : moving.fromSceneId} showPlaceholder={false} />
      </div>
      <div
        className="absolute inset-0"
        style={moving.type === 'fade' ? motion('xfade-out')
          : moving.type === 'slide' ? motion('xslide-in') : motion('xwipe-in')}
      >
        <SceneCanvas sceneId={moving.type === 'fade' ? moving.fromSceneId : sceneId} showPlaceholder={false} />
      </div>
    </div>
  )
}
