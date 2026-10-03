import { describe, it, expect } from 'vitest'
import { exclusively } from '../../src/lib/capture/gate'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('exclusively', () => {
  it('never lets two tasks overlap', async () => {
    let running = 0
    let worst = 0
    const task = async () => {
      running++
      worst = Math.max(worst, running)
      await tick()
      running--
    }
    await Promise.all([exclusively(task), exclusively(task), exclusively(task)])
    expect(worst).toBe(1)
  })

  it('runs them in the order they were asked for', async () => {
    const order: number[] = []
    await Promise.all([1, 2, 3].map((n) => exclusively(async () => { await tick(); order.push(n) })))
    expect(order).toEqual([1, 2, 3])
  })

  it('gives each caller its own result', async () => {
    const results = await Promise.all([exclusively(async () => 'a'), exclusively(async () => 'b')])
    expect(results).toEqual(['a', 'b'])
  })

  it('carries on after a task fails, and still reports the failure to its caller', async () => {
    const failing = exclusively(async () => { throw new Error('refused') })
    const after = exclusively(async () => 'still ran')

    await expect(failing).rejects.toThrow('refused')
    await expect(after).resolves.toBe('still ran')
  })
})
