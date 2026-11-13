'use client'
/**
 * The onboarding's top bar: the logo, and a menu with only "Sign out" (signed off in P2-U0: nothing else is
 * ready for a new user yet; parked for Eran in docs/BACKLOG.md → "The menu"). The left slot holds Skip on the
 * cards and the quick picks; the genre step has none.
 */
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AppMenu, VOICES, type MenuItem } from '@/modules/session/components/AppMenu'
import type { AppUser } from '@/modules/session/types'

const ONLY_SIGN_OUT: MenuItem[] = ['recommend', 'watchlist', 'play', 'ratings', 'profile', 'voice']
const none = () => {}

export default function OnboardingTop({ user, left }: { user: AppUser; left?: React.ReactNode }) {
  const router = useRouter()
  return (
    <div className="apptop">
      <div className="tb-l">{left}</div>
      <div className="brand app-brand"><Image src="/logo_vector.svg" alt="" width={56} height={56} />WTW</div>
      <div className="tb-r">
        <AppMenu
          onRecommend={none} onWatchlist={none} onFastLearning={none} onRatings={none} onProfile={none}
          user={user}
          onSignOut={async () => {
            await createClient().auth.signOut()
            router.replace('/login')
            router.refresh()
          }}
          voice={VOICES[0].id} setVoice={none}
          hide={ONLY_SIGN_OUT}
        />
      </div>
    </div>
  )
}
