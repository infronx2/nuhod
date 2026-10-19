import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/hooks/use-auth'
import { PlayGame } from '@/components/play/play-game'

export const metadata: Metadata = {
  title: 'نُهوض · جلسة المجلس',
  // Lets "Add to Home Screen" on iPhone open the session full screen.
  appleWebApp: { capable: true, title: 'نُهوض', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0B3E46',
}

/** /play, the majlis session in the browser (phone, tablet or laptop camera). */
export default function PlayPage() {
  return (
    <AuthProvider>
      <PlayGame />
    </AuthProvider>
  )
}
