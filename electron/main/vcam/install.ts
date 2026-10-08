import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

/**
 * Putting the virtual camera on the computer.
 *
 * Windows runs camera sources in a system service, which cannot read a user's
 * registry or a folder in their profile. So the camera's DLL is copied to
 * C:\ProgramData and registered for the whole machine, and that takes an
 * administrator's approval. It is done once, when the person asks for the camera
 * (and again if an update brings a new version of the DLL).
 */

export const VCAM_CLSID = '{B4D1A2C7-5E3F-4C1A-9D6B-2F7E8A3C1D90}'

/** `ready`: installed and current. `outdated`: installed, but not this version. `missing`: not installed. */
export type VcamState = 'missing' | 'outdated' | 'ready'

export interface VcamFiles {
  dll: string
  host: string
  install: string
  uninstall: string
}

/** The camera's files, in the app's resources, or null if this build does not have them. */
export function vcamFiles(
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  cwd: string = process.cwd(),
  exists: (p: string) => boolean = fs.existsSync,
): VcamFiles | null {
  for (const base of [resourcesPath && path.join(resourcesPath, 'vcam'), path.join(cwd, 'resources', 'vcam')]) {
    if (!base) continue
    const files = {
      dll: path.join(base, 'CodeBuildersCamera.dll'),
      host: path.join(base, 'CodeBuildersCameraHost.exe'),
      install: path.join(base, 'install.ps1'),
      uninstall: path.join(base, 'uninstall.ps1'),
    }
    if (Object.values(files).every(exists)) return files
  }
  return null
}

/** The first twelve hex digits of the DLL's SHA-256: the name the installer gives its copy. */
export function dllTag(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12)
}

/** The path Windows is told to load the camera from, or null if it is not registered. */
export function registeredPath(): string | null {
  const key = `HKLM\\Software\\Classes\\CLSID\\${VCAM_CLSID}\\InprocServer32`
  const result = spawnSync('reg', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return null
  const match = /REG_SZ\s+(.+)\s*$/m.exec(result.stdout)
  return match ? match[1].trim() : null
}

/** Decides the state from what is registered and what this build carries. Pure, so it can be tested. */
export function stateOf(registered: string | null, tag: string, fileExists: (p: string) => boolean): VcamState {
  if (!registered || !fileExists(registered)) return 'missing'
  return path.basename(registered).toLowerCase() === `codebuilderscamera-${tag}.dll` ? 'ready' : 'outdated'
}

export function vcamState(files: VcamFiles | null = vcamFiles()): VcamState {
  if (!files) return 'missing'
  return stateOf(registeredPath(), dllTag(files.dll), fs.existsSync)
}

export type ElevatedResult = { ok: true } | { ok: false; cancelled: boolean; message: string }

/**
 * Runs a PowerShell script as administrator. Windows shows its own approval
 * prompt; if the person declines it, that is reported as `cancelled`.
 */
export function runElevated(script: string, args: string[] = []): Promise<ElevatedResult> {
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
  const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args]
  const command =
    `try { $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList ${inner.map((a) => quote(`"${a}"`)).join(',')}; exit $p.ExitCode } ` +
    `catch { if ($_.Exception.Message -match 'canceled|cancelled') { exit 1223 } else { Write-Error $_; exit 1 } }`

  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.once('error', (err) => resolve({ ok: false, cancelled: false, message: err.message }))
    child.once('exit', (code) => {
      if (code === 0) resolve({ ok: true })
      else if (code === 1223) resolve({ ok: false, cancelled: true, message: 'The administrator approval was declined.' })
      else resolve({ ok: false, cancelled: false, message: stderr.trim() || `The installer stopped (exit ${code}).` })
    })
  })
}

export async function installCamera(files: VcamFiles): Promise<ElevatedResult> {
  return runElevated(files.install, ['-Dll', files.dll])
}

export async function uninstallCamera(files: VcamFiles): Promise<ElevatedResult> {
  return runElevated(files.uninstall)
}
