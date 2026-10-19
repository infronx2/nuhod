#include "NuhoudHudWidget.h"
#include "NuhoudUI.h"
#include "Blueprint/WidgetTree.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"

void UNuhoudHudWidget::NativeOnInitialized()
{
	Super::NativeOnInitialized();

	UVerticalBox* Lines = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("Lines"));
	WidgetTree->RootWidget = Lines;

	auto AddLine = [this, Lines](const TCHAR* Name, float Size, const FColor& Color) -> UTextBlock*
	{
		UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), Name);
		Text->SetFont(NuhoudUI::Font(Size, true));
		Text->SetColorAndOpacity(FSlateColor(FLinearColor(Color)));
		Text->SetShadowOffset(FVector2D(2.f, 2.f));
		Text->SetShadowColorAndOpacity(FLinearColor(0.f, 0.f, 0.f, 0.7f));
		Text->SetJustification(ETextJustify::Center);
		UVerticalBoxSlot* LineSlot = Lines->AddChildToVerticalBox(Text);
		LineSlot->SetHorizontalAlignment(HAlign_Center);
		LineSlot->SetPadding(FMargin(0.f, 6.f));
		return Text;
	};

	Score = AddLine(TEXT("Score"), 44.f, FColor(255, 215, 90));
	Status = AddLine(TEXT("Status"), 34.f, FColor(80, 255, 210));
	Gesture = AddLine(TEXT("Gesture"), 40.f, FColor(255, 230, 150));
	Instruction = AddLine(TEXT("Instruction"), 36.f, FColor(225, 225, 255));
}
