import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "48px auto", padding: "0 16px" }}>
      <h1>Second Look</h1>
      <p>
        <Link href="/form">Open the mock warehouse receiving form</Link>
      </p>
      <p>
        <Link href="/dashboard">Open the verdicts &amp; audit dashboard</Link>
      </p>
    </main>
  );
}
