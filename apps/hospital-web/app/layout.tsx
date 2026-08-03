import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "ERSync 병원 웹 | 응급환자 이송 연계 시스템",
    description:
      "병원과 구급대를 실시간으로 연결하는 ERSync 병원·관리자 웹 서비스입니다.",
    openGraph: {
      title: "ERSync 병원 웹 | 응급환자 이송 연계 시스템",
      description: "병원 수신 상태와 이송 요청을 관리하는 ERSync 병원 전용 웹",
      images: [{ url: imageUrl, width: 1732, height: 909, alt: "ERSync" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ERSync 병원 웹 | 응급환자 이송 연계 시스템",
      description: "병원 수신 상태와 이송 요청을 관리하는 ERSync 병원 전용 웹",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
