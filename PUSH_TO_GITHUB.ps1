# ============================================================================
# نُهوض — سكربت رفع المشروع على GitHub + Vercel
# ============================================================================
# هذا السكربت ينفذ كل الخطوات تلقائياً على Windows PowerShell
# ============================================================================

Write-Host "`n🚀 نُهوض — رفع على GitHub" -ForegroundColor Cyan
Write-Host "=========================================`n" -ForegroundColor Cyan

# المتغيرات — عدّل هذه فقط
$GITHUB_USERNAME = Read-Host "اكتب اسم مستخدم GitHub (مثلاً: tkiwz)"
$REPO_NAME = "nuhoud"

Write-Host "`n📁 تأكد من أنك في مجلد المشروع:" -ForegroundColor Yellow
$PROJECT_PATH = "C:\Users\tkiwz\OneDrive\Desktop\نهوض"
Set-Location $PROJECT_PATH

# 1. إنشاء مستودع على GitHub عبر CLI (إذا كان gh مثبت)
Write-Host "`n1️⃣ إنشاء مستودع GitHub..." -ForegroundColor Green
$ghInstalled = Get-Command gh -ErrorAction SilentlyContinue
if ($ghInstalled) {
    gh repo create $REPO_NAME --private --source=. --remote=origin --push
} else {
    Write-Host "   GitHub CLI غير مثبت — أنشئ المستودع يدوياً:" -ForegroundColor Yellow
    Write-Host "   1. اذهب إلى https://github.com/new" -ForegroundColor White
    Write-Host "   2. الاسم: $REPO_NAME" -ForegroundColor White
    Write-Host "   3. اختر Private" -ForegroundColor White
    Write-Host "   4. اضغط Create repository" -ForegroundColor White
    Write-Host "   5. اضغط أي مفتاح للمتابعة..." -ForegroundColor White
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# 2. Git init + add + commit
Write-Host "`n2️⃣ تجهيز Git..." -ForegroundColor Green
git init 2>$null
git add .
git commit -m "نُهوض — Nuhoud rehabilitation platform (initial commit)" 2>$null
git branch -M main 2>$null

# 3. إضافة remote + push
Write-Host "`n3️⃣ رفع الكود على GitHub..." -ForegroundColor Green
$remoteUrl = "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
git remote add origin $remoteUrl 2>$null
git push -u origin main

Write-Host "`n✅ تم رفع الكود على GitHub!" -ForegroundColor Green
Write-Host "   الرابط: https://github.com/$GITHUB_USERNAME/$REPO_NAME" -ForegroundColor White

# 4. تعليمات Vercel
Write-Host "`n4️⃣ اربط Vercel:" -ForegroundColor Green
Write-Host "   1. اذهب إلى https://vercel.com/new" -ForegroundColor White
Write-Host "   2. اختر مستودع $REPO_NAME" -ForegroundColor White
Write-Host "   3. أضف متغيرات البيئة:" -ForegroundColor White
Write-Host "      DATABASE_URL = (رابط Supabase — الخطوة التالية)" -ForegroundColor White
Write-Host "      NUHOUD_JWT_SECRET = سترينج عشوائي طويل" -ForegroundColor White
Write-Host "      NUHOOD_SYNC_API_KEY = nuhoud-internal-sync-prod-XXX" -ForegroundColor White
Write-Host "   4. اضغط Deploy" -ForegroundColor White

Write-Host "`n5️⃣ إعداد Supabase:" -ForegroundColor Green
Write-Host "   1. اذهب إلى https://supabase.com → New Project" -ForegroundColor White
Write-Host "   2. اسم: nuhoud، المنطقة: Asia Southeast" -ForegroundColor White
Write-Host "   3. بعد الإنشاء: Settings → Database → انسخ Connection String" -ForegroundColor White
Write-Host "   4. حدّث prisma/schema.prisma: provider = postgresql" -ForegroundColor White
Write-Host "   5. ضع DATABASE_URL في .env + Vercel Environment Variables" -ForegroundColor White
Write-Host "   6. شغّل: npx prisma db push" -ForegroundColor White
Write-Host "   7. بذرة البيانات: Invoke-RestMethod -Method Post -Uri 'https://nuhoud.vercel.app/api/v2/seed'" -ForegroundColor White

Write-Host "`n🎉 انتهى! المشروع على GitHub وجاهز للنشر على Vercel." -ForegroundColor Cyan
Write-Host "   Demo accounts:" -ForegroundColor Yellow
Write-Host "   doctor@nuhoud.health / demo1234" -ForegroundColor White
Write-Host "   layla@nuhoud.health / demo1234" -ForegroundColor White
Write-Host "   omar@nuhoud.health / demo1234`n" -ForegroundColor White
