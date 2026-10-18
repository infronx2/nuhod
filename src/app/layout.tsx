import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/nuhoud/theme-provider";
import { DepthLayer } from "@/components/nuhoud/depth-layer";

// IBM Plex Sans Arabic: a calm, clinical Arabic face with Latin to match; Inter for English-only runs.
const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "نُهوض — منصة تأهيل ما بعد السكتة الدماغية",
  description:
    "نُهوض منصة علاج رقمية لتأهيل الأطراف العلوية بعد السكتة الدماغية. تتبع حركي لحظي بالذكاء الاصطناعي، تغذية راجعة حركية، وتمارين تأهيل تفاعلية. مصممة لسلطنة عُمان.",
  keywords: [
    "نُهوض",
    "تأهيل السكتة الدماغية",
    "تأهيل الأطراف العلوية",
    "MediaPipe Pose",
    "الميكانيكا الحيوية",
    "عمان",
    "علاج رقمي",
  ],
  authors: [{ name: "فريق نُهوض" }],
  openGraph: {
    title: "نُهوض",
    description: "تأهيل الأطراف العلوية بعد السكتة الدماغية · ذكاء اصطناعي لحظي",
    siteName: "نُهوض",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "نُهوض",
    description: "تأهيل الأطراف العلوية بعد السكتة الدماغية · ذكاء اصطناعي لحظي",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const isRTL = locale === 'ar';
  return (
    <html lang={locale} dir={isRTL ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <body
        className={`${plexArabic.variable} ${inter.variable} antialiased bg-background text-foreground`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <DepthLayer />
            <SonnerToaster position={isRTL ? 'top-left' : 'top-right'} richColors closeButton dir={isRTL ? 'rtl' : 'ltr'} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
