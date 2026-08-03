import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3001";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "ERSync Admin | 슈퍼 관리자 운영 콘솔",
    description: "ERSync 조직과 일회용 가입 코드를 관리하는 슈퍼 관리자 전용 웹",
    openGraph: {
      title: "ERSync Admin | 슈퍼 관리자 운영 콘솔",
      description: "병원·구급대 조직 및 가입 코드 관리",
      images: [{ url: imageUrl, width: 1732, height: 909, alt: "ERSync Admin" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ERSync Admin | 슈퍼 관리자 운영 콘솔",
      description: "병원·구급대 조직 및 가입 코드 관리",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

