import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Second Look receiving form",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          color: "#111",
          background: "#fff",
        }}
      >
        {children}
      </body>
    </html>
  );
}
