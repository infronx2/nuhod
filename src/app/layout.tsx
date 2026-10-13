import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo, Tajawal } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/nuhoud/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Cairo — خط عربي حديث مصمم للواجهات الرقمية. أنيق وواضح.
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Tajawal — خط عربي احتياطي للأرقام والنصوص المختصرة.
const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
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
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
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
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} ${tajawal.variable} font-cairo antialiased bg-background text-foreground`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <SonnerToaster position={isRTL ? 'top-left' : 'top-right'} richColors closeButton dir={isRTL ? 'rtl' : 'ltr'} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
