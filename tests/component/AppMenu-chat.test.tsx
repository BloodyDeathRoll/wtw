import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppMenu, type MenuItem } from '@/modules/session/components/AppMenu'

// P3-1 (Q5, Eran 2026-11-14): the menu's "Ask WTW" is the consultant chat's
// only way in. It needs CHAT_MODE=consultant and a host that lets the person
// in. The voice picker belongs to the old spoken chat only.

const user = { id: 'u1', email: 'a@b.c', name: 'Ann', avatarUrl: null }

async function openMenu(props: { onChat?: () => void; hide?: MenuItem[] } = {}) {
  render(
    <AppMenu
      onRecommend={() => {}} onWatchlist={() => {}} onFastLearning={() => {}} onRatings={() => {}} onProfile={() => {}}
      user={user} onSignOut={() => {}} voice="Kore" setVoice={() => {}}
      {...props}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'menu' }))
}
const item = (name: string) => screen.queryByRole('menuitem', { name: new RegExp(name) })

afterEach(() => { delete process.env.CHAT_MODE })

describe('the menu and the chat', () => {
  it('consultant: "Ask WTW" opens the chat, and there is no voice picker', async () => {
    process.env.CHAT_MODE = 'consultant'
    const onChat = vi.fn()
    await openMenu({ onChat })
    expect(item('Set Voice')).toBeNull()
    await userEvent.click(item('Ask WTW')!)
    expect(onChat).toHaveBeenCalledTimes(1)
    // The drawer closes behind it.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('consultant: no entry where the host does not let the person in (onboarding not done)', async () => {
    process.env.CHAT_MODE = 'consultant'
    await openMenu()
    expect(item('Ask WTW')).toBeNull()
  })

  it('consultant: a host can leave the entry out, like any other', async () => {
    process.env.CHAT_MODE = 'consultant'
    await openMenu({ onChat: () => {}, hide: ['chat'] })
    expect(item('Ask WTW')).toBeNull()
    expect(item('Watchlist')).not.toBeNull()
  })

  it('off: neither the chat nor the voice picker', async () => {
    process.env.CHAT_MODE = 'off'
    await openMenu({ onChat: () => {} })
    expect(item('Ask WTW')).toBeNull()
    expect(item('Set Voice')).toBeNull()
  })

  it('legacy: the voice picker, and no "Ask WTW" (that chat is the header\'s icon)', async () => {
    await openMenu({ onChat: () => {} })
    expect(item('Ask WTW')).toBeNull()
    expect(item('Set Voice')).not.toBeNull()
  })
})
