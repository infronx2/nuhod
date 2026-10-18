#include "NuhoudVoice.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundWaveProcedural.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"

ANuhoudVoice::ANuhoudVoice()
{
	PrimaryActorTick.bCanEverTick = false;
	Audio = CreateDefaultSubobject<UAudioComponent>(TEXT("Audio"));
	Audio->bAutoActivate = false;
	Audio->bIsUISound = true;
	RootComponent = Audio;
	CurrentWave = nullptr;
}

void ANuhoudVoice::BeginPlay()
{
	Super::BeginPlay();
	bDisabled = FParse::Param(FCommandLine::Get(), TEXT("NuhoudNoVoice"));
	if (!bDisabled) ScanLines();
}

void ANuhoudVoice::ScanLines()
{
	const FString Dir = FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Nuhoud/Voice"));
	TArray<FString> Files;
	IFileManager::Get().FindFiles(Files, *FPaths::Combine(Dir, TEXT("*.wav")), true, false);
	for (const FString& File : Files)
	{
		// <event>_<n>.wav: the event is everything before the last underscore.
		const FString Base = FPaths::GetBaseFilename(File);
		int32 Underscore;
		if (!Base.FindLastChar(TEXT('_'), Underscore) || Underscore == 0) continue;
		Lines.FindOrAdd(Base.Left(Underscore)).Add(FPaths::Combine(Dir, File));
	}
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: voice has %d line(s) for %d event(s) in %s"), Files.Num(), Lines.Num(), *Dir);
}

bool ANuhoudVoice::IsSpeaking() const
{
	return FPlatformTime::Seconds() < LineEndsAt;
}

float ANuhoudVoice::SecondsSinceLastLine() const
{
	return static_cast<float>(FPlatformTime::Seconds() - LineEndsAt);
}

void ANuhoudVoice::Say(const FString& Event, bool bInterrupt)
{
	if (bDisabled) return;
	const TArray<FString>* Files = Lines.Find(Event);
	if (!Files || Files->Num() == 0) return;
	if (IsSpeaking() && !bInterrupt) return;

	int32 Pick = FMath::RandRange(0, Files->Num() - 1);
	if (Files->Num() > 1 && LastPicked.FindRef(Event) == Pick + 1) Pick = (Pick + 1) % Files->Num();
	LastPicked.Add(Event, Pick + 1);

	USoundWaveProcedural* Wave = LoadWav((*Files)[Pick]);
	if (!Wave) return;
	Audio->Stop();
	CurrentWave = Wave;
	Audio->SetSound(Wave);
	Audio->Play();
	LineEndsAt = FPlatformTime::Seconds() + Wave->Duration;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: voice %s (%s, %.1fs)"), *Event, *FPaths::GetBaseFilename((*Files)[Pick]), Wave->Duration);
}

USoundWaveProcedural* ANuhoudVoice::LoadWav(const FString& Path) const
{
	TArray<uint8> Bytes;
	if (!FFileHelper::LoadFileToArray(Bytes, *Path) || Bytes.Num() < 44) return nullptr;
	if (FMemory::Memcmp(Bytes.GetData(), "RIFF", 4) != 0 || FMemory::Memcmp(Bytes.GetData() + 8, "WAVE", 4) != 0) return nullptr;

	auto U16 = [&Bytes](int32 At) { return static_cast<uint32>(Bytes[At] | (Bytes[At + 1] << 8)); };
	auto U32 = [&Bytes](int32 At) { return static_cast<uint32>(Bytes[At] | (Bytes[At + 1] << 8) | (Bytes[At + 2] << 16) | (Bytes[At + 3] << 24)); };

	uint32 Channels = 0, Rate = 0, Bits = 0;
	int32 DataAt = -1;
	uint32 DataSize = 0;
	for (int32 At = 12; At + 8 <= Bytes.Num();)
	{
		const uint32 Size = U32(At + 4);
		if (FMemory::Memcmp(Bytes.GetData() + At, "fmt ", 4) == 0 && At + 24 <= Bytes.Num())
		{
			if (U16(At + 8) != 1) return nullptr; // PCM only
			Channels = U16(At + 10);
			Rate = U32(At + 12);
			Bits = U16(At + 22);
		}
		else if (FMemory::Memcmp(Bytes.GetData() + At, "data", 4) == 0)
		{
			DataAt = At + 8;
			DataSize = FMath::Min<uint32>(Size, static_cast<uint32>(Bytes.Num() - DataAt));
			break;
		}
		At += 8 + Size + (Size & 1);
	}
	if (DataAt < 0 || Bits != 16 || Channels < 1 || Channels > 2 || Rate == 0 || DataSize == 0)
	{
		UE_LOG(LogTemp, Warning, TEXT("Nuhoud: voice file %s is not 16-bit PCM WAV"), *Path);
		return nullptr;
	}

	USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>();
	Wave->SetSampleRate(Rate);
	Wave->NumChannels = Channels;
	Wave->Duration = static_cast<float>(DataSize) / (Rate * Channels * 2);
	Wave->SoundGroup = SOUNDGROUP_Voice;
	Wave->bLooping = false;
	Wave->QueueAudio(Bytes.GetData() + DataAt, DataSize);
	return Wave;
}
