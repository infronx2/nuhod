#include "NuhoudUI.h"
#include "Brushes/SlateColorBrush.h"
#include "Engine/GameViewportClient.h"
#include "Fonts/CompositeFont.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "Misc/CommandLine.h"
#include "Misc/Paths.h"
#include "Containers/Ticker.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SUniformGridPanel.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	const FLinearColor Backdrop(0.004f, 0.047f, 0.06f, 0.96f);
	const FLinearColor CardColor(0.02f, 0.1f, 0.12f, 1.f);
	const FLinearColor Mint(0.5f, 0.85f, 0.87f);
	const FLinearColor Muted(0.7f, 0.78f, 0.8f);

	TSharedPtr<const FCompositeFont> LoadFont(bool bBold)
	{
		const FString Dir = FPaths::Combine(FPlatformMisc::GetEnvironmentVariable(TEXT("WINDIR")), TEXT("Fonts"));
		const TCHAR* Names[] = { bBold ? TEXT("segoeuib.ttf") : TEXT("segoeui.ttf"), bBold ? TEXT("tahomabd.ttf") : TEXT("tahoma.ttf") };
		for (const TCHAR* Name : Names)
		{
			const FString Path = FPaths::Combine(Dir, Name);
			if (IFileManager::Get().FileExists(*Path))
			{
				return MakeShared<FCompositeFont>(TEXT("Default"), Path, EFontHinting::Default, EFontLoadingPolicy::LazyLoad);
			}
		}
		UE_LOG(LogTemp, Warning, TEXT("Nuhoud: no Arabic font in %s, Arabic text may not show"), *Dir);
		return nullptr;
	}

	const FSlateBrush* Plain()
	{
		static FSlateColorBrush White(FLinearColor::White);
		return &White;
	}

	TSharedRef<SWidget> Line(const FString& Text, float Size, bool bBold = false, const FLinearColor& Color = FLinearColor::White)
	{
		return SNew(STextBlock)
			.Text(FText::FromString(Text))
			.Font(NuhoudUI::Font(Size, bBold))
			.ColorAndOpacity(Color)
			.AutoWrapText(true);
	}

	/** A row of answers; the picked one turns white. */
	TSharedRef<SWidget> Choices(const TArray<FString>& Labels, TSharedRef<int32> Picked, TFunction<FLinearColor(int32)> Tint)
	{
		TSharedRef<SUniformGridPanel> Row = SNew(SUniformGridPanel).SlotPadding(FMargin(3.f));
		for (int32 i = 0; i < Labels.Num(); ++i)
		{
			Row->AddSlot(i, 0)
			[
				SNew(SButton)
				.ButtonColorAndOpacity_Lambda([Picked, Tint, i]() { return *Picked == i ? FLinearColor::White : Tint(i); })
				.HAlign(HAlign_Center)
				.VAlign(VAlign_Center)
				.ContentPadding(FMargin(4.f, 10.f))
				.OnClicked_Lambda([Picked, i]() { *Picked = i; return FReply::Handled(); })
				[
					SNew(STextBlock)
					.Text(FText::FromString(Labels[i]))
					.Font(NuhoudUI::Font(16.f, true))
					.ColorAndOpacity_Lambda([Picked, i]() { return FSlateColor(*Picked == i ? FLinearColor(0.02f, 0.2f, 0.25f) : FLinearColor::White); })
				]
			];
		}
		return Row;
	}

	TSharedRef<SWidget> Action(const FString& Text, TFunction<bool()> Enabled, TFunction<void()> OnClick, bool bPrimary = true)
	{
		return SNew(SButton)
			.ButtonColorAndOpacity(bPrimary ? FLinearColor::White : FLinearColor(1.f, 1.f, 1.f, 0.15f))
			.IsEnabled_Lambda(MoveTemp(Enabled))
			.HAlign(HAlign_Center)
			.ContentPadding(FMargin(20.f, 12.f))
			.OnClicked_Lambda([OnClick]() { OnClick(); return FReply::Handled(); })
			[
				SNew(STextBlock)
				.Text(FText::FromString(Text))
				.Font(NuhoudUI::Font(18.f, true))
				.ColorAndOpacity(bPrimary ? FLinearColor(0.02f, 0.2f, 0.25f) : FLinearColor::White)
			];
	}

	/** Dark full-screen backdrop with a centred card, laid out right to left. */
	TSharedRef<SWidget> Screen(TSharedRef<SWidget> Content)
	{
		return SNew(SBorder)
			.BorderImage(Plain())
			.BorderBackgroundColor(Backdrop)
			.HAlign(HAlign_Center)
			.VAlign(VAlign_Center)
			.FlowDirectionPreference(EFlowDirectionPreference::RightToLeft)
			[
				SNew(SBox)
				.WidthOverride(720.f)
				[
					SNew(SBorder)
					.BorderImage(Plain())
					.BorderBackgroundColor(CardColor)
					.Padding(FMargin(36.f, 30.f))
					[
						Content
					]
				]
			];
	}

	/** Adds a screen to the viewport and returns a function that removes it (safe to call twice). */
	TFunction<void()> Present(UGameViewportClient* Viewport, TSharedRef<SWidget> Widget)
	{
		Viewport->AddViewportWidgetContent(Widget, 200);
		TWeakObjectPtr<UGameViewportClient> Weak(Viewport);
		TWeakPtr<SWidget> WeakWidget(Widget);
		return [Weak, WeakWidget]()
		{
			if (Weak.IsValid() && WeakWidget.IsValid()) Weak->RemoveViewportWidgetContent(WeakWidget.Pin().ToSharedRef());
		};
	}
}

FSlateFontInfo NuhoudUI::Font(float Size, bool bBold)
{
	static TSharedPtr<const FCompositeFont> Regular = LoadFont(false);
	static TSharedPtr<const FCompositeFont> Bold = LoadFont(true);
	const TSharedPtr<const FCompositeFont>& Loaded = bBold ? Bold : Regular;
	return Loaded.IsValid() ? FSlateFontInfo(Loaded, Size) : FCoreStyle::GetDefaultFontStyle(bBold ? "Bold" : "Regular", Size);
}

void NuhoudUI::AskCheck(UGameViewportClient* Viewport, bool bBeforeSession, TFunction<void(int32 Pain, int32 Fatigue)> OnDone)
{
	if (!Viewport)
	{
		OnDone(-1, -1);
		return;
	}
	TSharedRef<int32> Pain = MakeShared<int32>(-1);
	TSharedRef<int32> Fatigue = MakeShared<int32>(-1);
	TSharedRef<TFunction<void()>> Close = MakeShared<TFunction<void()>>();
	TSharedRef<bool> bAnswered = MakeShared<bool>(false);

	auto Answer = [Pain, Fatigue, Close, bAnswered, OnDone](bool bSkip)
	{
		if (*bAnswered) return;
		*bAnswered = true;
		(*Close)();
		OnDone(bSkip ? -1 : *Pain, bSkip ? -1 : *Fatigue);
	};

	TArray<FString> Scale;
	for (int32 i = 0; i <= 10; ++i) Scale.Add(FString::FromInt(i));
	auto PainTint = [](int32 i)
	{
		return i >= 7 ? FLinearColor(0.84f, 0.27f, 0.27f, 0.45f) : i >= 4 ? FLinearColor(0.96f, 0.62f, 0.04f, 0.35f) : FLinearColor(0.06f, 0.73f, 0.5f, 0.3f);
	};

	TSharedRef<SVerticalBox> Body = SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 16)
		[
			Line(bBeforeSession ? TEXT("قبل ما نبدأ، كيف حالك الحين؟") : TEXT("خلصت الجلسة"), 26.f, true)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
		[
			Line(bBeforeSession ? TEXT("كم الألم في يدك أو كتفك؟") : TEXT("وكم الألم الحين؟"), 17.f, false, Muted)
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			Choices(Scale, Pain, PainTint)
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 4, 0, 0)
		[
			Line(TEXT("0 ما فيه ألم      ·      10 ألم شديد"), 12.f, false, Muted)
		];

	if (bBeforeSession)
	{
		Body->AddSlot().AutoHeight().Padding(0, 20, 0, 8)
		[
			Line(TEXT("وكيف التعب؟"), 17.f, false, Muted)
		];
		Body->AddSlot().AutoHeight()
		[
			Choices({ TEXT("مرتاح"), TEXT("تعبان شوي"), TEXT("تعبان وايد") }, Fatigue, [](int32) { return FLinearColor(1.f, 1.f, 1.f, 0.12f); })
		];
	}

	TSharedRef<SHorizontalBox> Buttons = SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.f)
		[
			Action(bBeforeSession ? TEXT("تابع") : TEXT("احفظ الجلسة"),
				[Pain, Fatigue, bBeforeSession]() { return *Pain >= 0 && (!bBeforeSession || *Fatigue >= 0); },
				[Answer]() { Answer(false); })
		];
	if (!bBeforeSession)
	{
		Buttons->AddSlot().AutoWidth().Padding(12, 0, 0, 0)
		[
			Action(TEXT("تخطي"), []() { return true; }, [Answer]() { Answer(true); }, false)
		];
	}
	Body->AddSlot().AutoHeight().Padding(0, 28, 0, 0)[Buttons];

	*Close = Present(Viewport, Screen(Body));

#if !UE_BUILD_SHIPPING
	// QA: -NuhoudAutoCheck=<pain>:<tiredness> answers after a few seconds, like a patient's taps.
	FString Auto;
	if (FParse::Value(FCommandLine::Get(), TEXT("NuhoudAutoCheck="), Auto))
	{
		FString PainText, FatigueText;
		Auto.Split(TEXT(":"), &PainText, &FatigueText);
		*Pain = FCString::Atoi(*PainText);
		*Fatigue = FCString::Atoi(*FatigueText);
		FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Answer](float) { Answer(false); return false; }), 4.f);
	}
#endif
}

void NuhoudUI::ShowMessage(UGameViewportClient* Viewport, const FString& Title, const FString& Text, const FString& Button, TFunction<void()> OnClose)
{
	if (!Viewport)
	{
		OnClose();
		return;
	}
	TSharedRef<TFunction<void()>> Close = MakeShared<TFunction<void()>>();
	TSharedRef<SWidget> Body = SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 12)[Line(Title, 26.f, true)]
		+ SVerticalBox::Slot().AutoHeight()[Line(Text, 17.f, false, Muted)]
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 28, 0, 0)
		[
			Action(Button, []() { return true; }, [Close, OnClose]() { (*Close)(); OnClose(); })
		];
	*Close = Present(Viewport, Screen(Body));
}
