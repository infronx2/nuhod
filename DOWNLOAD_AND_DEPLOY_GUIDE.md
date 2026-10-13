# 📦 دليل كامل: تنزيل الملفات + GitHub + Vercel + Supabase + UE5

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 1️⃣ تنزيل الملفات على جهازك
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### الخطوة 1: نسخ الملفات من الساندبوكس
المشروع موجود في `/home/z/my-project/`. لتنزيله:

```bash
# في الساندبوكس، أنشئ أرشيف مضغوط:
cd /home/z/my-project
tar czf nuhoud-project.tar.gz \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='db/*.db' \
  --exclude='dev.log' \
  --exclude='server.log' \
  --exclude='*.png' \
  --exclude='upload' \
  --exclude='download' \
  --exclude='.zscripts' \
  --exclude='skills' \
  --exclude='examples' \
  --exclude='tests' \
  --exclude='tool-results' \
  src/ prisma/ messages/ mini-services/ ue5-game/ scripts/ \
  package.json bun.lock tsconfig.json next.config.ts \
  tailwind.config.ts postcss.config.mjs components.json \
  eslint.config.mjs .gitignore .env.example \
  README.md SUPABASE_SETUP.md vercel.json Caddyfile \
  worklog.md

# الملف سيكون: /home/z/my-project/nuhoud-project.tar.gz
```

### الخطوة 2: على جهازك
```bash
# فك الضغط
tar xzf nuhoud-project.tar.gz -C ~/Projects/Nuhoud/
cd ~/Projects/Nuhoud/

# تثبيت الحزم
bun install   # أو npm install

# إنشاء قاعدة البيانات
cp .env.example .env
# عدّل .env إذا لزم
bun run db:push
bun run db:generate

# بذرة البيانات التجريبية (بعد تشغيل الخادم)
bun run dev
# في نافذة أخرى:
curl -X POST http://localhost:3000/api/v2/seed
```

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 2️⃣ رفع المشروع على GitHub
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### الخطوة 1: إنشاء مستودع على GitHub
1. اذهب إلى https://github.com/new
2. اسم المستودع: `nuhoud`
3. اختر **Private** (مستودع خاص — لأنه مشروع طبي)
4. **لا** تختر "Add a README" أو ".gitignore" (عندنا بالفعل)
5. اضغط **Create repository**

### الخطوة 2: ارفع الكود
```bash
cd ~/Projects/Nuhoud/

# إذا لم يكن Git مُهيأ:
git init
git add .
git commit -m "نُهود — Initial commit"

# أضف GitHub كمصدر بعيد:
git remote add origin https://github.com/USERNAME/nuhoud.git
git branch -M main
git push -u origin main
```

### ⚠️ تأكد من:
- `.env` غير مرفوع (الـ .gitignore يمنعه)
- `db/*.db` غير مرفوع (قاعدة البيانات المحلية)
- `node_modules/` غير مرفوع
- الصور والملفات المؤقتة محذوفة

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 3️⃣ ربط Vercel (النشر التلقائي)
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### الخطوة 1: استيراد المشروع
1. اذهب إلى https://vercel.com/new
2. اختر مستودع `nuhoud` من GitHub
3. Vercel سيكتشف Next.js تلقائياً

### الخطوة 2: متغيرات البيئة
في صفحة الإعداد، أضف هذه المتغيرات:

| Variable | Value | ملاحظة |
|---|---|---|
| `DATABASE_URL` | `postgresql://...` | رابط Supabase (الخطوة التالية) |
| `NUHOUD_JWT_SECRET` | سرك الخاص | سترينج طويل عشوائي |
| `NUHOOD_SYNC_API_KEY` | `nuhoud-internal-sync-prod-XXX` | مفتاح المزامنة |

### الخطوة 3: Deploy
- اضغط **Deploy**
- Vercel سيبني المشروع وينشره على `https://nuhoud-xxx.vercel.app`
- كل push إلى `main` سيعيد النشر تلقائياً

### الخطوة 4: إعداد اسم نطاق مخصص (اختياري)
- Vercel Dashboard → Project → Settings → Domains
- أضف `nuhoud.health` أو نطاقك الخاص

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 4️⃣ إعداد Supabase (قاعدة بيانات PostgreSQL)
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### الخطوة 1: إنشاء مشروع
1. اذهب إلى https://supabase.com → **New Project**
2. اسم المشروع: `nuhoud`
3. المنطقة: **Asia Southeast** (الأقرب لعُمان)
4. كلمة مرور قوية لقاعدة البيانات
5. اضغط **Create new project**

### الخطوة 2: الحصول على Connection String
1. Project Settings → **Database**
2. ابحث عن **Connection String** (URI)
3. انسخ الرابط:
```
postgresql://postgres:YOUR_PASSWORD@db.xxxxxx.supabase.co:5432/postgres
```

### الخطوة 3: تحديث Prisma
في `prisma/schema.prisma` غيّر:
```prisma
datasource db {
  provider = "postgresql"  // ← غيّر من "sqlite" إلى "postgresql"
  url      = env("DATABASE_URL")
}
```

### الخطوة 4: اضغط القاعدة
```bash
# محلياً:
DATABASE_URL="postgresql://..." bun run db:push

# أو على Vercel:
# Vercel → Project → Settings → Environment Variables
# أضف DATABASE_URL = رابط Supabase
# ثم في Vercel → Project → Run command:
# npx prisma db push && npx prisma generate
```

### الخطوة 5: بذرة البيانات
بعد نشر Vercel، شغّل:
```bash
curl -X POST https://nuhoud-xxx.vercel.app/api/v2/seed
```

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 5️⃣ نقل لعبة UE5 لجهازك
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### الخطوة 1: نسخ ملفات اللعبة
ملفات اللعبة في `ue5-game/Source/Nuhoud/`:

```bash
# على جهازك، أنشئ مشروع UE5 جديد:
# 1. افتح Epic Games Launcher → Unreal Engine 5.4+ → New Project
# 2. اختر C++ Blank Project
# 3. اسم المشروع: Nuhoud
# 4. بعد إنشاء المشروع، انسخ ملفات المصدر:
cp -r nuhoud-project/ue5-game/Source/Nuhoud/* ~/Projects/Nuhoud/Source/Nuhoud/
```

### الخطوة 2: تحديث ملف البناء
```bash
# انسخ Nuhoud.Build.cs إلى مجلد المصدر:
cp nuhoud-project/ue5-game/Source/Nuhoud/Nuhoud.Build.cs ~/Projects/Nuhoud/Source/Nuhoud/
```

### الخطوة 3: إعادة بناء المشروع
1. أغلق محرر UE5
2. اضغط يميناً على `Nuhoud.uproject` → **Generate Visual Studio project files**
3. افتح `Nuhoud.sln` في Visual Studio
4. اضغط **Build** (Development Editor)
5. افتح محرر UE5 — ستظهر كودات Nuhoud في Content Browser

### الخطوة 4: تفعيل الإضافات
- Edit → Plugins → فعّل: **OpenXR**, **Niagara**, **WebSocket** (مفعّل افتراضياً)
- Project Settings → Maps & Modes → Game Instance → `NuhoudGameInstance`

### الخطوة 5: إنشاء Blueprints
اتبع الأدلة في:
- `ue5-game/DEPLOYMENT.md` (النشر)
- `ue5-game/PHASE2_BLUEPRINT_HOOKUP.md` (الصوت + الواجهة + VFX)
- `ue5-game/PHASE3_BLUEPRINT_HOOKUP.md` (المصادقة + الإرهاق + OpenXR)

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 6️⃣ تشغيل خادم Python محلياً
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```bash
cd ~/Projects/Nuhoud/mini-services/pose-server/

# تثبيت المتطلبات
pip install -r requirements.txt

# تشغيل الخادم
python3 main.py

# أو للتشغيل الدائم (daemon):
python3 daemon.py
```

الخادم سيعمل على `http://localhost:8001`

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 📋 ملخص البنية النهائية
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```
جهازك:
├── لوحة التحكم (Next.js)     ←→ Supabase (PostgreSQL)
├── خادم Python (MediaPipe)   ←→ UE5 (WebSocket)
└── لعبة UE5                  ←→ خادم Python + Supabase

الإنتاج (Vercel):
├── لوحة التحكم (Next.js)     ←→ Supabase
└── لعبة UE5                  ←→ خادم Python (على خادم منفصل)
```

## ⚠️ ملاحظات أمنية مهمة
1. **لا** ترفع `.env` إلى GitHub أبداً
2. غيّر `NUHOOD_JWT_SECRET` في الإنتاج لسطر عشوائي طويل
3. فعّل Supabase Row Level Security (RLS) لكل جدول
4. استخدم HTTPS فقط في الإنتاج
5. خادم Python يجب أن يكون على خادم منفصل (وليس Vercel)
