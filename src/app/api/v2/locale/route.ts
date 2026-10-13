import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/v2/locale — set the locale cookie.
 * Body: { locale: "ar" | "en" }
 *
 * Sets the 'nuhoud-locale' cookie so next-intl's request config picks it up
 * on the next page load. The client then reloads the page to apply the new
 * language + direction (RTL/LTR).
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const locale = String(body.locale || '').trim().toLowerCase()
  if (locale !== 'ar' && locale !== 'en') {
    return NextResponse.json({ ok: false, error: 'locale must be "ar" or "en"' }, { status: 400 })
  }

  const res = NextResponse.json({ ok: true, locale })
  // Set cookie for 1 year, accessible from the root path.
  res.cookies.set('nuhoud-locale', locale, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    httpOnly: true,
    sameSite: 'lax',
  })
  return res
}
