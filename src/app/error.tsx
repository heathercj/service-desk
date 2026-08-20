"use client";

// Section 15: never expose stack traces in production -- this boundary
// intentionally ignores `error.message` and shows only a generic notice.
// The full error (with its `digest`) still reaches server logs via Next's
// own logging before this boundary renders.
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-muted-foreground">
        An unexpected error occurred. Please try again, or contact Technology Support if
        this continues.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Try again
      </button>
    </div>
  );
}
