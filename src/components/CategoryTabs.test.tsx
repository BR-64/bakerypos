import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Category } from '../domain/types'
import { CategoryTabs } from './CategoryTabs'

const categories: Category[] = ['brownies', 'cookies', 'jar']

describe('CategoryTabs', () => {
  it('renders one tab per given category plus All, with All first', () => {
    render(<CategoryTabs categories={categories} selected="all" onSelect={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['All', 'Brownies', 'Soft cookies', 'Jar'])
  })

  it('the selected tab has aria-selected="true", others false', () => {
    render(<CategoryTabs categories={categories} selected="brownies" onSelect={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Brownies' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false')
  })

  it('All is selected by default in this usage', () => {
    render(<CategoryTabs categories={categories} selected="all" onSelect={() => {}} />)
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
  })

  it('clicking a tab calls onSelect with that tab', () => {
    const onSelect = vi.fn()
    render(<CategoryTabs categories={categories} selected="all" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Soft cookies' }))
    expect(onSelect).toHaveBeenCalledWith('cookies')
  })
})
