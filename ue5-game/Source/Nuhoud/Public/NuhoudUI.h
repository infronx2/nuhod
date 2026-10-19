#pragma once

#include "CoreMinimal.h"
#include "Fonts/SlateFontInfo.h"

class UGameViewportClient;

namespace NuhoudUI
{
	/** A font with Arabic glyphs (Segoe UI, else Tahoma, from the Windows fonts folder). */
	NUHOUD_API FSlateFontInfo Font(float Size, bool bBold = false);

	/**
	 * Full-screen question before or after a session. Before: pain 0-10 and tiredness 0-2.
	 * After: pain only, with a skip button (Pain = -1). Calls OnDone once and removes itself.
	 */
	NUHOUD_API void AskCheck(UGameViewportClient* Viewport, bool bBeforeSession, TFunction<void(int32 Pain, int32 Fatigue)> OnDone);

	/** A full-screen message with one button (e.g. "rest today"); OnClose runs when it is pressed. */
	NUHOUD_API void ShowMessage(UGameViewportClient* Viewport, const FString& Title, const FString& Body, const FString& Button, TFunction<void()> OnClose);
}
