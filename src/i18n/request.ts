import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

/**
 * next-intl request config — supports both Arabic and English.
 *
 * The locale is stored in a cookie named 'nuhoud-locale' (default: 'ar').
 * The user toggles between Arabic and English via the header language button,
 * which sets this cookie and reloads the page.
 *
 * This is the simplest approach for a single-route app (no /ar /en prefix routing):
 * the whole app is one locale at a time, toggled client-side.
 */
const LOCALES = ['ar', 'en'] as const
type Locale = typeof LOCALES[number]

export default getRequestConfig(async () => {
  // Read the locale from the cookie, defaulting to 'ar'.
  let locale: Locale = 'ar'
  try {
    const cookieStore = await cookies()
    const stored = cookieStore.get('nuhoud-locale')?.value
    if (stored === 'en' || stored === 'ar') {
      locale = stored as Locale
    }
  } catch {
    // cookies() not available in some contexts — default to 'ar'.
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
