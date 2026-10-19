import type { Metadata } from 'next'
import { AuthProvider } from '@/hooks/use-auth'
import { QrSignIn } from '@/components/nuhoud/qr-sign-in'

export const metadata: Metadata = { title: 'نُهوض · الدخول', robots: { index: false } }

/** /q#<token> — where the QR code the doctor shows a patient opens. */
export default function QrPage() {
  return (
    <AuthProvider>
      <QrSignIn />
    </AuthProvider>
  )
}
