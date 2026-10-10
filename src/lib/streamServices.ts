/**
 * The streaming services offered in Stream Settings. Each is just a server
 * address and a note on where to find the stream key; the stream itself is
 * the same RTMP stream whichever service receives it.
 */

export type ServiceId = 'youtube' | 'twitch' | 'custom'

export interface StreamService {
  id: ServiceId
  label: string
  /** The server address, or '' for a service where the person supplies it. */
  url: string
  /** Where to find the stream key. */
  keyHelp: string
}

export const STREAM_SERVICES: readonly StreamService[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    keyHelp: 'In YouTube Studio choose Create, then Go live, then Stream. Copy the Stream key from there, press Go Live here, and then press Go live on YouTube once its preview shows the picture.',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    url: 'rtmp://live.twitch.tv/app',
    keyHelp: 'On Twitch open the Creator Dashboard, then Settings, then Stream, and copy the Primary Stream key.',
  },
  {
    id: 'custom',
    label: 'Custom RTMP server',
    url: '',
    keyHelp: 'Paste the server address and the stream key your service gave you.',
  },
]

/** Which service an address belongs to: a known one by its address, anything else (including none) as custom. */
export function serviceOf(url: string): ServiceId {
  const wanted = normalize(url)
  const known = STREAM_SERVICES.find((s) => s.url && normalize(s.url) === wanted)
  return known ? known.id : 'custom'
}

export const serviceById = (id: ServiceId): StreamService =>
  STREAM_SERVICES.find((s) => s.id === id) ?? STREAM_SERVICES[STREAM_SERVICES.length - 1]

/** An address compared without letter case, spaces or a trailing slash. */
function normalize(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}
