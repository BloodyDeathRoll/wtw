import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Emphasis } from '@/app/components/Emphasis'

const html = (text: string) => render(<p><Emphasis text={text} /></p>).container.innerHTML

describe('<Emphasis />', () => {
  it('renders *Title* as <em>', () => {
    expect(html('like *Heat* meets *Ronin*')).toBe('<p>like <em>Heat</em> meets <em>Ronin</em></p>')
  })
  it('renders **Title** as <em>', () => {
    expect(html('a **bold** pick')).toBe('<p>a <em>bold</em> pick</p>')
  })
  it('leaves an unpaired asterisk as typed', () => {
    expect(html('rated 5* overall')).toBe('<p>rated 5* overall</p>')
  })
  it('does not pair loose asterisks across text', () => {
    expect(html('5* and 4* films')).toBe('<p>5* and 4* films</p>')
  })
  it('passes plain text through', () => {
    expect(html('no markup here')).toBe('<p>no markup here</p>')
  })
})
