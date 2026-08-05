import { NextRequest, NextResponse } from "next/server";

const GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

type NaverAddress = {
  roadAddress?: string;
  jibunAddress?: string;
  x?: string;
  y?: string;
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { code, message, fieldErrors: [], traceId: null },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim() || "";

  if (query.length < 2 || query.length > 200) {
    return errorResponse(
      400,
      "COMMON_001",
      "주소를 두 글자 이상 입력해 주세요.",
    );
  }

  const clientId = process.env.ERSYNC_NAVER_MAPS_CLIENT_ID;
  const clientSecret = process.env.ERSYNC_NAVER_MAPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return errorResponse(
      503,
      "GEOCODING_NOT_CONFIGURED",
      "주소 검색이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("count", "5");

    const response = await fetch(url, {
      headers: {
        "x-ncp-apigw-api-key-id": clientId,
        "x-ncp-apigw-api-key": clientSecret,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return errorResponse(
        502,
        "GEOCODING_UPSTREAM_ERROR",
        "주소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    const body = (await response.json()) as { addresses?: NaverAddress[] };
    const items = (body.addresses || []).flatMap((address) => {
      const latitude = Number(address.y);
      const longitude = Number(address.x);
      const roadAddress = address.roadAddress || address.jibunAddress || "";

      if (!roadAddress || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return [];
      }

      return [
        {
          roadAddress,
          jibunAddress: address.jibunAddress || "",
          latitude,
          longitude,
        },
      ];
    });

    return NextResponse.json({ items });
  } catch {
    return errorResponse(
      502,
      "GEOCODING_UPSTREAM_ERROR",
      "주소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
