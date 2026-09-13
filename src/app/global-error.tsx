"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#f4f0e8",
          color: "#191713",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <main style={{ textAlign: "center", padding: 24, maxWidth: 380 }}>
          <h1 style={{ fontSize: 30, letterSpacing: "-0.02em", margin: 0 }}>maeosan hit a snag.</h1>
          <p style={{ color: "#847d6f", marginTop: 12 }}>
            Something failed while loading the app. Your messages are safe.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              height: 44,
              padding: "0 22px",
              borderRadius: 999,
              border: 0,
              background: "#191713",
              color: "#f4f0e8",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
