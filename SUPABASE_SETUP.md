# دليل إعداد Supabase لـ نُهوض

## الخطوة 1: إنشاء مشروع Supabase
1. اذهب إلى https://supabase.com وأنشئ حساباً
2. اضغط **New Project**
3. اختر اسماً للمشروع (مثلاً `nuhoud`)
4. اختر المنطقة الأقرب (Asia / Singapore)
5. اضغط **Create**

## الخطوة 2: الحصول على Connection String
1. في لوحة Supabase، اذهب إلى **Project Settings** → **Database**
2. ابحث عن **Connection String** (URI)
3. انسخ الرابط (يبدأ بـ `postgresql://`)
4. استبدل `[YOUR-PASSWORD]` بكلمة مرور قاعدة البيانات

مثال:
```
postgresql://postgres:your_password@db.xxxxxx.supabase.co:5432/postgres
```

## الخطوة 3: تحديث Prisma
افتح `prisma/schema.prisma` وغيّر:
```prisma
datasource db {
  provider = "postgresql"  // بدل "sqlite"
  url      = env("DATABASE_URL")
}
```

## الخطوة 4: ضع الـ Connection String في .env
```bash
# في ملف .env (محلي) أو في إعدادات Vercel (للإنتاج):
DATABASE_URL="postgresql://postgres:your_password@db.xxxxxx.supabase.co:5432/postgres"
```

## الخطوة 5: اضغط القاعدة
```bash
bun run db:push
```

## الخطوة 6: بذرة البيانات
```bash
curl -X POST http://localhost:3000/api/v2/seed
```

## ملاحظات
- Supabase يدعم PostgreSQL مجاناً حتى 500MB
- الاتصال المباشر (Direct Connection) يعمل مع Prisma
- للحصول على أداء أفضل في الإنتاج، استخدم Connection Pooling (PgBouncer)
