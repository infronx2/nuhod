// ============================================================================
// NuhoudAudioManager.cpp
// ============================================================================

#include "NuhoudAudioManager.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"

// Tempo table: Level1 → 0.8x, Level2 → 0.95x, Level3 → 1.1x, Level4 → 1.3x, Level5 → 1.5x
constexpr float ANuhoudAudioManager::TempoTable[];

ANuhoudAudioManager::ANuhoudAudioManager()
{
    PrimaryActorTick.bCanEverTick = true;

    // Create the ambient audio component
    AmbientAudioComp = CreateDefaultSubobject<UAudioComponent>(TEXT("AmbientAudioComp"));
    AmbientAudioComp->SetupAttachment(RootComponent);
    AmbientAudioComp->bAutoActivate = false;
    AmbientAudioComp->bIsUISound = false;
    AmbientAudioComp->bAllowSpatialization = true;
}

void ANuhoudAudioManager::BeginPlay()
{
    Super::BeginPlay();
}

void ANuhoudAudioManager::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    // Smoothly interpolate the tempo toward the target
    if (FMath::Abs(CurrentTempo - TargetTempo) > 0.01f)
    {
        CurrentTempo = FMath::FInterpTo(CurrentTempo, TargetTempo, DeltaSeconds, 2.0f);

        // UE5 AudioComponent supports pitch scaling for tempo.
        // Pitch = 1.0 is normal, 1.5 is faster/higher.
        if (AmbientAudioComp && AmbientAudioComp->IsPlaying())
        {
            AmbientAudioComp->SetPitchMultiplier(CurrentTempo);
        }
    }
}

// ---------------------------------------------------------------------------
// One-shot sounds
// ---------------------------------------------------------------------------

void ANuhoudAudioManager::PlaySuccessHit(FVector Location)
{
    if (SuccessHitSound)
    {
        UGameplayStatics::PlaySoundAtLocation(GetWorld(), SuccessHitSound, Location);
    }
}

void ANuhoudAudioManager::PlayCompensationError(FVector Location)
{
    if (CompensationErrorSound)
    {
        UGameplayStatics::PlaySoundAtLocation(GetWorld(), CompensationErrorSound, Location);
    }
}

void ANuhoudAudioManager::PlayLevelUp()
{
    if (LevelUpSound)
    {
        UGameplayStatics::PlaySound2D(GetWorld(), LevelUpSound);
    }
}

void ANuhoudAudioManager::PlaySessionComplete()
{
    if (SessionCompleteSound)
    {
        UGameplayStatics::PlaySound2D(GetWorld(), SessionCompleteSound);
    }
}

// ---------------------------------------------------------------------------
// Ambient music
// ---------------------------------------------------------------------------

void ANuhoudAudioManager::StartAmbientMusic()
{
    if (AmbientMusic && AmbientAudioComp)
    {
        AmbientAudioComp->SetSound(AmbientMusic);
        AmbientAudioComp->Play();
        AmbientAudioComp->SetPitchMultiplier(CurrentTempo);
    }
}

void ANuhoudAudioManager::StopAmbientMusic()
{
    if (AmbientAudioComp && AmbientAudioComp->IsPlaying())
    {
        AmbientAudioComp->Stop();
    }
}

void ANuhoudAudioManager::SetAmbientTempo(int32 LevelIndex)
{
    // Clamp to 0-4 and look up the tempo table
    LevelIndex = FMath::Clamp(LevelIndex, 0, 4);
    TargetTempo = TempoTable[LevelIndex];
}
