# نُهوض (Nuhoud)

منصة لإعادة تأهيل الطرف العلوي بعد الجلطة الدماغية: كاميرا عادية، مهام يومية في مجلس عُماني، ومتابعة من الطبيب.

## الأجزاء

| الجزء | المكان | التقنيات |
|---|---|---|
| الموقع ولوحة الطبيب | `src/` | Next.js، TypeScript، Tailwind، Prisma، PostgreSQL (Supabase) |
| لعبة الجوال (المتصفح) | `src/components/play/`، الصفحة `/play` | three.js، MediaPipe Tasks |
| لعبة العيادة | `ue5-game/` | Unreal Engine 5.5 (C++) |
| خادم التتبع للعيادة | `ue5-game/pose_server.py` | Python، FastAPI، MediaPipe |

## التشغيل المحلي

```bash
npm install
cp .env.example .env   # ضع DATABASE_URL و NUHOUD_JWT_SECRET
npx prisma db push
npm run dev
```

حساب الطبيب الأول يُنشأ برمز الدعوة (`NUHOUD_DOCTOR_INVITE_CODE`)، والطبيب يضيف مرضاه من لوحته.

## النشر

يُنشر على Vercel من فرع `main`. المتغيرات المطلوبة في Vercel:

- `DATABASE_URL`: رابط Supabase (الـ pooler).
- `NUHOUD_JWT_SECRET`: سر توقيع الدخول.
- `NUHOUD_DOCTOR_INVITE_CODE`: رمز دعوة الأطباء.
- `DEEPSEEK_API_KEY`: مساعد «مُعين» (اختياري).

تعديلات قاعدة البيانات في `prisma/sql/`.

## مصادر رسومات لعبة الجوال (مجانية)

كل النماذج والخامات في `public/play/assets/` مجانية. التفاصيل الكاملة والرخص في
[`public/play/assets/CREDITS.md`](public/play/assets/CREDITS.md).

| المصدر | ما أخذناه | الرخصة |
|---|---|---|
| [Poly Haven](https://polyhaven.com) | الفانوس، المندوس، دلة النحاس للزينة، المساند، النباتات، خامات الجدار والأرضية والقماش، إضاءة HDRI | CC0 (ملكية عامة) |
| [Sketchfab: Dallah - Arabian Coffee pot (CGDELUXE)](https://sketchfab.com/3d-models/dallah-arabian-coffee-pot-1aa080b38eb142688b14e49dc8701ae0) | الدلة | CC BY 4.0 (مع ذكر المصدر) |
| [Sketchfab: Rigged hand (Elena FF)](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e) | اليد الواقعية (اليمنى، ومعكوسة لليسرى) | CC BY-SA 4.0 (مع ذكر المصدر، والتعديل بنفس الرخصة) |
| [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles) | اليد الاحتياطية | MIT |
| [Google MediaPipe](https://developers.google.com/mediapipe) | نماذج تتبع الجسم واليد | Apache 2.0 |

لإعادة تنزيل أصول Poly Haven وضغطها: `node scripts/fetch-play-assets.mjs`.

## قبل التجربة السريرية

`scripts/reset-trial-data.mjs` يأخذ نسخة احتياطية ثم يحذف بيانات المرضى التجريبية ويبقي حسابات الأطباء.

© 2026 نُهوض. جميع الحقوق محفوظة.
