import { describe, expect, it } from 'vitest'
import { repoImageFileName, repoImageId } from '../domain/productImage'
import { REPO_PRODUCT_IMAGE_FILES } from './repoImages'

// Keys only (lazy, never loaded): the real files in public/products/.
const onDisk = Object.keys(import.meta.glob('../../public/products/*')).map(
  (path) => path.split('/').pop() ?? '',
)

describe('REPO_PRODUCT_IMAGE_FILES (generated index)', () => {
  it('only names files that really exist in public/products, with exact case', () => {
    for (const file of Object.values(REPO_PRODUCT_IMAGE_FILES)) {
      expect(onDisk).toContain(file)
    }
  })

  it('indexes every picture file in public/products (nothing silently left out)', () => {
    const indexed = new Set(Object.values(REPO_PRODUCT_IMAGE_FILES))
    const pictures = onDisk.filter((name) => repoImageId(name) !== null)
    expect(pictures.length).toBeGreaterThan(0)
    for (const name of pictures) expect(indexed).toContain(name)
  })

  it('resolves every indexed id to its file, including upper-case extensions', () => {
    for (const [id, file] of Object.entries(REPO_PRODUCT_IMAGE_FILES)) {
      expect(repoImageFileName(id, REPO_PRODUCT_IMAGE_FILES)).toBe(file)
    }
  })
})
