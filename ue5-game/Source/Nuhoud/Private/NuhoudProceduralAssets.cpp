#include "NuhoudProceduralAssets.h"
#include "KismetProceduralMeshLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"

UMaterialInterface* FNuhoudProceduralAssets::GetLitMaterial()
{
	return LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Nuhoud/Materials/M_NuhoudLit.M_NuhoudLit"));
}

UMaterialInstanceDynamic* FNuhoudProceduralAssets::MakeLitMaterial(UObject* Outer, const FLinearColor& BaseColor,
	float Metallic, float Roughness, const FLinearColor& Emissive)
{
	UMaterialInterface* Base = GetLitMaterial();
	if (!Base)
	{
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: M_NuhoudLit missing — run the content setup script"));
		return nullptr;
	}
	UMaterialInstanceDynamic* MID = UMaterialInstanceDynamic::Create(Base, Outer);
	MID->SetVectorParameterValue(TEXT("BaseColor"), BaseColor);
	MID->SetScalarParameterValue(TEXT("Metallic"), Metallic);
	MID->SetScalarParameterValue(TEXT("Roughness"), Roughness);
	MID->SetVectorParameterValue(TEXT("EmissiveColor"), Emissive);
	return MID;
}

UProceduralMeshComponent* FNuhoudProceduralAssets::NewMeshComponent(AActor* Owner, USceneComponent* Parent)
{
	UProceduralMeshComponent* Mesh = NewObject<UProceduralMeshComponent>(Owner);
	Mesh->SetupAttachment(Parent ? Parent : Owner->GetRootComponent());
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->RegisterComponent();
	return Mesh;
}

void FNuhoudProceduralAssets::FinalizeTriangles(TArray<int32>& Tris)
{
	// Generators below emit triangles whose edge cross product points along the outward normal.
	// Match whatever winding the engine's own GenerateBoxMesh treats as front-facing.
	static const bool bFlip = []
	{
		TArray<FVector> V; TArray<int32> T; TArray<FVector> N; TArray<FVector2D> UV; TArray<FProcMeshTangent> Tan;
		UKismetProceduralMeshLibrary::GenerateBoxMesh(FVector(1.f), V, T, N, UV, Tan);
		const FVector Cross = FVector::CrossProduct(V[T[1]] - V[T[0]], V[T[2]] - V[T[0]]);
		return FVector::DotProduct(Cross, N[T[0]]) < 0.f;
	}();

	if (bFlip)
	{
		for (int32 i = 0; i + 2 < Tris.Num(); i += 3)
		{
			Swap(Tris[i + 1], Tris[i + 2]);
		}
	}
}

float FNuhoudProceduralAssets::HashFloat(int32 N)
{
	N = (N << 13) ^ N;
	return 1.f - ((N * (N * N * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.f;
}

float FNuhoudProceduralAssets::SimpleNoise3D(float X, float Y, float Z)
{
	int32 xi = FMath::FloorToInt(X);
	int32 yi = FMath::FloorToInt(Y);
	int32 zi = FMath::FloorToInt(Z);
	float xf = X - xi;
	float yf = Y - yi;
	float zf = Z - zi;

	xf = xf * xf * (3.f - 2.f * xf);
	yf = yf * yf * (3.f - 2.f * yf);
	zf = zf * zf * (3.f - 2.f * zf);

	auto Hash3 = [](int32 x, int32 y, int32 z) -> int32 {
		return x * 73856093 ^ y * 19349663 ^ z * 83492791;
	};

	float c000 = HashFloat(Hash3(xi, yi, zi));
	float c100 = HashFloat(Hash3(xi + 1, yi, zi));
	float c010 = HashFloat(Hash3(xi, yi + 1, zi));
	float c110 = HashFloat(Hash3(xi + 1, yi + 1, zi));
	float c001 = HashFloat(Hash3(xi, yi, zi + 1));
	float c101 = HashFloat(Hash3(xi + 1, yi, zi + 1));
	float c011 = HashFloat(Hash3(xi, yi + 1, zi + 1));
	float c111 = HashFloat(Hash3(xi + 1, yi + 1, zi + 1));

	float x00 = FMath::Lerp(c000, c100, xf);
	float x10 = FMath::Lerp(c010, c110, xf);
	float x01 = FMath::Lerp(c001, c101, xf);
	float x11 = FMath::Lerp(c011, c111, xf);

	return FMath::Lerp(FMath::Lerp(x00, x10, yf), FMath::Lerp(x01, x11, yf), zf);
}

void FNuhoudProceduralAssets::SubdivideSphere(TArray<FVector>& Verts, TArray<int32>& Tris, int32 Subdivisions, float Radius)
{
	float T = (1.f + FMath::Sqrt(5.f)) / 2.f;

	Verts.Empty();
	Tris.Empty();

	auto AddVert = [&](float x, float y, float z) {
		Verts.Add(FVector(x, y, z).GetSafeNormal() * Radius);
	};

	AddVert(-1, T, 0); AddVert(1, T, 0); AddVert(-1, -T, 0); AddVert(1, -T, 0);
	AddVert(0, -1, T); AddVert(0, 1, T); AddVert(0, -1, -T); AddVert(0, 1, -T);
	AddVert(T, 0, -1); AddVert(T, 0, 1); AddVert(-T, 0, -1); AddVert(-T, 0, 1);

	int32 Faces[] = {
		0,11,5, 0,5,1, 0,1,7, 0,7,10, 0,10,11,
		1,5,9, 5,11,4, 11,10,2, 10,7,6, 7,1,8,
		3,9,4, 3,4,2, 3,2,6, 3,6,8, 3,8,9,
		4,9,5, 2,4,11, 6,2,10, 8,6,7, 9,8,1
	};
	for (int32 i = 0; i < 60; i++) Tris.Add(Faces[i]);

	TMap<int64, int32> MidpointCache;
	auto GetMidpoint = [&](int32 A, int32 B) -> int32 {
		int64 Key = FMath::Min(A, B) * 100000LL + FMath::Max(A, B);
		if (int32* Found = MidpointCache.Find(Key)) return *Found;
		int32 Idx = Verts.Num();
		Verts.Add(((Verts[A] + Verts[B]) * 0.5f).GetSafeNormal() * Radius);
		MidpointCache.Add(Key, Idx);
		return Idx;
	};

	for (int32 S = 0; S < Subdivisions; S++)
	{
		TArray<int32> NewTris;
		for (int32 i = 0; i < Tris.Num(); i += 3)
		{
			int32 A = Tris[i], B = Tris[i + 1], C = Tris[i + 2];
			int32 AB = GetMidpoint(A, B);
			int32 BC = GetMidpoint(B, C);
			int32 CA = GetMidpoint(C, A);

			NewTris.Append({ A, AB, CA, B, BC, AB, C, CA, BC, AB, BC, CA });
		}
		Tris = MoveTemp(NewTris);
		MidpointCache.Empty();
	}
}

UProceduralMeshComponent* FNuhoudProceduralAssets::CreateIcosahedron(AActor* Owner, int32 Subdivisions, float Radius,
	float Irregularity, USceneComponent* Parent)
{
	if (!Owner) return nullptr;
	UProceduralMeshComponent* Mesh = NewMeshComponent(Owner, Parent);

	TArray<FVector> Verts;
	TArray<int32> Tris;
	SubdivideSphere(Verts, Tris, Subdivisions, Radius);

	if (Irregularity > 0.f)
	{
		for (FVector& V : Verts)
		{
			FVector Dir = V.GetSafeNormal();
			V += Dir * SimpleNoise3D(Dir.X * 3.f, Dir.Y * 3.f, Dir.Z * 3.f) * Irregularity * Radius;
		}
	}

	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	Normals.SetNum(Verts.Num());
	UVs.SetNum(Verts.Num());
	for (int32 i = 0; i < Verts.Num(); i++)
	{
		const FVector N = Verts[i].GetSafeNormal();
		Normals[i] = N;
		UVs[i] = FVector2D(0.5f + FMath::Atan2(N.Y, N.X) / (2.f * PI), 0.5f - FMath::Asin(FMath::Clamp(N.Z, -1.f, 1.f)) / PI);
	}

	FinalizeTriangles(Tris);
	Mesh->CreateMeshSection(0, Verts, Tris, Normals, UVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
	return Mesh;
}

UProceduralMeshComponent* FNuhoudProceduralAssets::CreateLathe(AActor* Owner, const TArray<FVector2D>& Profile,
	int32 Segments, USceneComponent* Parent)
{
	if (!Owner || Profile.Num() < 2) return nullptr;
	UProceduralMeshComponent* Mesh = NewMeshComponent(Owner, Parent);

	const int32 P = Profile.Num();
	TArray<FVector2D> ProfileNormals;
	TArray<float> V;
	ProfileNormals.SetNum(P);
	V.SetNum(P);
	V[0] = 0.f;
	for (int32 k = 0; k < P; k++)
	{
		const FVector2D Tangent = (Profile[FMath::Min(k + 1, P - 1)] - Profile[FMath::Max(k - 1, 0)]).GetSafeNormal();
		ProfileNormals[k] = FVector2D(Tangent.Y, -Tangent.X);
		if (k > 0) V[k] = V[k - 1] + FVector2D::Distance(Profile[k], Profile[k - 1]);
	}
	const float Total = FMath::Max(V[P - 1], KINDA_SMALL_NUMBER);

	TArray<FVector> Verts;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	for (int32 k = 0; k < P; k++)
	{
		for (int32 s = 0; s <= Segments; s++)
		{
			const float A = 2.f * PI * s / Segments;
			const float C = FMath::Cos(A);
			const float S = FMath::Sin(A);
			Verts.Add(FVector(Profile[k].X * C, Profile[k].X * S, Profile[k].Y));
			Normals.Add(FVector(ProfileNormals[k].X * C, ProfileNormals[k].X * S, ProfileNormals[k].Y).GetSafeNormal());
			UVs.Add(FVector2D((float)s / Segments, V[k] / Total));
		}
	}

	TArray<int32> Tris;
	const int32 Row = Segments + 1;
	for (int32 k = 0; k < P - 1; k++)
	{
		for (int32 s = 0; s < Segments; s++)
		{
			const int32 A = k * Row + s;
			const int32 B = A + 1;
			const int32 C = A + Row;
			const int32 D = C + 1;
			Tris.Append({ A, B, C, B, D, C });
		}
	}

	FinalizeTriangles(Tris);
	Mesh->CreateMeshSection(0, Verts, Tris, Normals, UVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
	return Mesh;
}

UProceduralMeshComponent* FNuhoudProceduralAssets::CreateTube(AActor* Owner, const TArray<FVector>& Path,
	const TArray<float>& Radii, int32 Sides, USceneComponent* Parent)
{
	if (!Owner || Path.Num() < 2 || Radii.Num() != Path.Num()) return nullptr;
	UProceduralMeshComponent* Mesh = NewMeshComponent(Owner, Parent);

	const int32 Count = Path.Num();
	const int32 Row = Sides + 1;
	TArray<FVector> Verts;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	TArray<int32> Tris;

	const FVector FirstTangent = (Path[1] - Path[0]).GetSafeNormal();
	FVector Frame = FVector::CrossProduct(FirstTangent,
		FMath::Abs(FirstTangent.Z) < 0.9f ? FVector::UpVector : FVector::ForwardVector).GetSafeNormal();
	FVector LastTangent = FirstTangent;

	for (int32 i = 0; i < Count; i++)
	{
		const FVector Tangent = (Path[FMath::Min(i + 1, Count - 1)] - Path[FMath::Max(i - 1, 0)]).GetSafeNormal();
		Frame = (Frame - Tangent * FVector::DotProduct(Frame, Tangent)).GetSafeNormal();
		const FVector Binormal = FVector::CrossProduct(Tangent, Frame);
		LastTangent = Tangent;

		for (int32 s = 0; s <= Sides; s++)
		{
			const float A = 2.f * PI * s / Sides;
			const FVector Dir = Frame * FMath::Cos(A) + Binormal * FMath::Sin(A);
			Verts.Add(Path[i] + Dir * Radii[i]);
			Normals.Add(Dir);
			UVs.Add(FVector2D((float)s / Sides, (float)i / (Count - 1)));
		}
	}

	for (int32 i = 0; i < Count - 1; i++)
	{
		for (int32 s = 0; s < Sides; s++)
		{
			const int32 A = i * Row + s;
			const int32 B = A + 1;
			const int32 C = A + Row;
			const int32 D = C + 1;
			Tris.Append({ A, B, C, B, D, C });
		}
	}

	auto AddCap = [&](int32 RingStart, const FVector& Center, const FVector& Normal, bool bStart)
	{
		const int32 CenterIdx = Verts.Num();
		Verts.Add(Center);
		Normals.Add(Normal);
		UVs.Add(FVector2D(0.5f, 0.5f));
		for (int32 s = 0; s < Sides; s++)
		{
			const int32 A = RingStart + s;
			const int32 B = RingStart + s + 1;
			if (bStart) Tris.Append({ CenterIdx, B, A });
			else Tris.Append({ CenterIdx, A, B });
		}
	};
	AddCap(0, Path[0], -FirstTangent, true);
	AddCap((Count - 1) * Row, Path[Count - 1], LastTangent, false);

	FinalizeTriangles(Tris);
	Mesh->CreateMeshSection(0, Verts, Tris, Normals, UVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
	return Mesh;
}

UProceduralMeshComponent* FNuhoudProceduralAssets::CreateRoundedBox(AActor* Owner, const FVector& HalfExtents,
	float Radius, int32 EdgeSteps, USceneComponent* Parent)
{
	if (!Owner) return nullptr;
	UProceduralMeshComponent* Mesh = NewMeshComponent(Owner, Parent);

	const float R = FMath::Min(Radius, HalfExtents.GetMin());
	const FVector Inner = HalfExtents - FVector(R);

	// Coordinates along one axis: rounded band, flat span, rounded band.
	auto AxisCoords = [EdgeSteps, R](float InnerA)
	{
		TArray<float> C;
		for (int32 k = 0; k <= EdgeSteps; k++) C.Add(-InnerA - R * FMath::Cos(HALF_PI * k / EdgeSteps));
		if (InnerA > KINDA_SMALL_NUMBER) C.Add(InnerA);
		for (int32 k = EdgeSteps - 1; k >= 0; k--) C.Add(InnerA + R * FMath::Cos(HALF_PI * k / EdgeSteps));
		return C;
	};

	struct FFace { FVector N, U, V; };
	const FFace Faces[6] = {
		{ FVector::ForwardVector,  FVector::RightVector,   FVector::UpVector },
		{ -FVector::ForwardVector, -FVector::RightVector,  FVector::UpVector },
		{ FVector::RightVector,    FVector::UpVector,      FVector::ForwardVector },
		{ -FVector::RightVector,   -FVector::UpVector,     FVector::ForwardVector },
		{ FVector::UpVector,       FVector::ForwardVector, FVector::RightVector },
		{ -FVector::UpVector,      -FVector::ForwardVector, FVector::RightVector },
	};

	auto AxisValue = [](const FVector& Axis, const FVector& V) { return FMath::Abs(FVector::DotProduct(Axis, V)); };

	TArray<FVector> Verts;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	TArray<int32> Tris;

	for (const FFace& F : Faces)
	{
		const TArray<float> CU = AxisCoords(AxisValue(F.U, Inner));
		const TArray<float> CV = AxisCoords(AxisValue(F.V, Inner));
		const float FaceDist = AxisValue(F.N, HalfExtents);
		const int32 Base = Verts.Num();

		for (int32 j = 0; j < CV.Num(); j++)
		{
			for (int32 i = 0; i < CU.Num(); i++)
			{
				const FVector Q = F.N * FaceDist + F.U * CU[i] + F.V * CV[j];
				const FVector Clamped(
					FMath::Clamp(Q.X, -Inner.X, Inner.X),
					FMath::Clamp(Q.Y, -Inner.Y, Inner.Y),
					FMath::Clamp(Q.Z, -Inner.Z, Inner.Z));
				FVector N = (Q - Clamped).GetSafeNormal();
				if (N.IsNearlyZero()) N = F.N;
				Verts.Add(Clamped + N * R);
				Normals.Add(N);
				UVs.Add(FVector2D((float)i / (CU.Num() - 1), (float)j / (CV.Num() - 1)));
			}
		}

		const int32 Row = CU.Num();
		for (int32 j = 0; j < CV.Num() - 1; j++)
		{
			for (int32 i = 0; i < CU.Num() - 1; i++)
			{
				const int32 A = Base + j * Row + i;
				const int32 B = A + 1;
				const int32 C = A + Row;
				const int32 D = C + 1;
				Tris.Append({ A, B, C, B, D, C });
			}
		}
	}

	FinalizeTriangles(Tris);
	Mesh->CreateMeshSection(0, Verts, Tris, Normals, UVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
	return Mesh;
}
