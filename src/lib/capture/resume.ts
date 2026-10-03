import { isCaptureType } from '@/stores/captureStore'
import { parseCaptureTarget, type CaptureTarget } from './target'
import type { SourceItem } from '@/stores/sourceStore'

export interface ResumeJob {
  source: SourceItem
  target: CaptureTarget
}

/**
 * Which captures to start on their own.
 *
 * Reopening the app used to leave every capture source dead until the user
 * restarted each one by hand. Now a source that knows what it captures starts
 * again by itself, as it does in OBS.
 *
 * Each source is tried once per session (`attempted`). A capture that failed,
 * say because its window is not open, must not be retried in a loop; the user
 * restarts it from the source's menu when the window is back.
 */
export function sourcesToResume(
  sources: readonly SourceItem[] | undefined,
  activeIds: readonly string[],
  attempted: ReadonlySet<string>,
): ResumeJob[] {
  const jobs: ResumeJob[] = []
  for (const source of sources ?? []) {
    if (!isCaptureType(source.sourceType)) continue
    if (attempted.has(source.id) || activeIds.includes(source.id)) continue

    const target = parseCaptureTarget(source.settings)
    if (target) jobs.push({ source, target })
  }
  return jobs
}
