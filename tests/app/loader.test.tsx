// Hermes Desktop's real runtime loader evaluates the plugin file as shipped.
// Run with `npm run test:app` (see run.cjs).
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { COMPOSER_AREAS, runComposerMiddleware } from '@/app/chat/composer/contrib'
import { $pluginRecords } from '@/contrib/plugins-store'
import { Slot } from '@/contrib/react/slot'
import { registry } from '@/contrib/registry'
import { loadRuntimePlugin, unloadRuntimePlugin } from '@/contrib/runtime-loader'

import source from './plugin.js?raw'

// Node cannot import blob: URLs. The app's own loader tests make the same swap.
function blobToDataUrl() {
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(
      blob =>
        `data:text/javascript;base64,${Buffer.from((blob as unknown as { parts: string[] }).parts.join('')).toString('base64')}`
    )
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const RealBlob = globalThis.Blob

  vi.stubGlobal(
    'Blob',
    class {
      parts: string[]
      constructor(parts: string[]) {
        this.parts = parts
      }
    }
  )

  return () => {
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    vi.stubGlobal('Blob', RealBlob)
  }
}

afterEach(cleanup)

const mine = (area: string) => registry.getArea(area).filter(c => c.source === 'plugin:quote-selection')

it('loads through the real runtime loader with every import resolved', async () => {
  const restore = blobToDataUrl()
  const errors = vi.spyOn(console, 'error')

  try {
    const id = await loadRuntimePlugin(source, 'quote-selection', {
      file: '/local/.hermes/desktop-plugins/quote-selection/plugin.js'
    })

    expect(errors.mock.calls).toEqual([])
    expect(id).toBe('quote-selection')
    expect($pluginRecords.get()['quote-selection']).toMatchObject({ kind: 'disk', status: 'loaded' })
    expect(mine(COMPOSER_AREAS.top)).toHaveLength(1)
    expect(mine(COMPOSER_AREAS.middleware)).toHaveLength(1)

    const { container } = render(<Slot area={COMPOSER_AREAS.top} />)

    expect(container.innerHTML).toBe('')
    expect(await runComposerMiddleware({ text: 'hello' })).toEqual({ text: 'hello' })

    unloadRuntimePlugin('quote-selection')
    expect(mine(COMPOSER_AREAS.top)).toHaveLength(0)
    expect(mine(COMPOSER_AREAS.middleware)).toHaveLength(0)
  } finally {
    unloadRuntimePlugin('quote-selection')
    restore()
  }
})
