// Messages joined with " · " are translated part by part, unless the " · " is inside a record's title.
import { describe, expect, it } from 'vitest'
import { translateMessage } from './i18n'

describe('translating messages', () => {
  it('a history line about a draft keeps one message: its title is translated inside it', () => {
    expect(translateMessage('ar', 'created Quotation “Draft · Cairo Care Hospital”')).toBe('أنشأ عرض سعر «مسودة · Cairo Care Hospital»')
  })
  it('several failed checks joined with " · " are each translated', () => {
    const two = translateMessage('ar', 'Draft · Draft')
    expect(two).toBe('مسودة · مسودة')
  })
})
