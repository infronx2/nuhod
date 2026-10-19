#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "NuhoudHudWidget.generated.h"

class UTextBlock;

/**
 * The four lines that float in the majlis ahead of the patient: progress, tracking status, the
 * current hand shape, and the task instruction. Shown through a widget component so Arabic is
 * shaped and laid out right to left (text render components cannot do that).
 */
UCLASS()
class NUHOUD_API UNuhoudHudWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	UPROPERTY()
	UTextBlock* Score;

	UPROPERTY()
	UTextBlock* Status;

	UPROPERTY()
	UTextBlock* Gesture;

	UPROPERTY()
	UTextBlock* Instruction;

protected:
	virtual void NativeOnInitialized() override;
};
