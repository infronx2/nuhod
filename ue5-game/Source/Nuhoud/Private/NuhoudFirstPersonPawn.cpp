#include "NuhoudFirstPersonPawn.h"
#include "Camera/CameraComponent.h"

namespace
{
	constexpr float ScreenDepthTolerance = 2.5f;
}

ANuhoudFirstPersonPawn::ANuhoudFirstPersonPawn()
{
	PrimaryActorTick.bCanEverTick = false;

	// A seated reach lands 25-50 cm ahead and ~45 cm below the eyes; this view keeps that
	// zone and the overhead hooks in frame without the patient turning their head.
	EyeHeight = 90.f;
	ViewPitch = -26.f;
	FieldOfView = 100.f;
	bHeadsetView = false;

	Seat = CreateDefaultSubobject<USceneComponent>(TEXT("Seat"));
	RootComponent = Seat;

	HeadOrigin = CreateDefaultSubobject<USceneComponent>(TEXT("HeadOrigin"));
	HeadOrigin->SetupAttachment(Seat);
	HeadOrigin->SetRelativeLocation(FVector(0.f, 0.f, EyeHeight));

	Eyes = CreateDefaultSubobject<UCameraComponent>(TEXT("Eyes"));
	Eyes->SetupAttachment(HeadOrigin);
	Eyes->bUsePawnControlRotation = false;
	// Only a headset session moves the camera with head tracking (see UseHeadsetView).
	Eyes->bLockToHmd = false;
	Eyes->SetRelativeRotation(FRotator(ViewPitch, 0.f, 0.f));
	Eyes->SetFieldOfView(FieldOfView);
}

void ANuhoudFirstPersonPawn::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);
	HeadOrigin->SetRelativeLocation(FVector(0.f, 0.f, EyeHeight));
	Eyes->SetRelativeRotation(FRotator(bHeadsetView ? 0.f : ViewPitch, 0.f, 0.f));
	Eyes->SetFieldOfView(FieldOfView);
}

void ANuhoudFirstPersonPawn::SeatAt(const FVector& EyesLocation, float Yaw)
{
	SetActorLocationAndRotation(EyesLocation - FVector(0.f, 0.f, EyeHeight), FRotator(0.f, Yaw, 0.f));
}

void ANuhoudFirstPersonPawn::UseHeadsetView()
{
	// With a seated (Local) tracking origin recentred on the patient, the headset pose is relative
	// to HeadOrigin, so the patient's real head starts exactly at the virtual eyes.
	bHeadsetView = true;
	Eyes->SetRelativeLocationAndRotation(FVector::ZeroVector, FRotator::ZeroRotator);
	Eyes->bLockToHmd = true;
}

FTransform ANuhoudFirstPersonPawn::GetBodyFrame() const
{
	return FTransform(FRotator(0.f, GetActorRotation().Yaw, 0.f), HeadOrigin->GetComponentLocation());
}

float ANuhoudFirstPersonPawn::PerceivedDistance(const FVector& A, const FVector& B) const
{
	const float DepthTolerance = bHeadsetView ? 1.f : ScreenDepthTolerance;
	const FVector LineOfSight = (B - Eyes->GetComponentLocation()).GetSafeNormal();
	const FVector Delta = A - B;
	const float Along = FVector::DotProduct(Delta, LineOfSight);
	const FVector Across = Delta - LineOfSight * Along;
	return FMath::Sqrt(Across.SizeSquared() + FMath::Square(Along / DepthTolerance));
}
