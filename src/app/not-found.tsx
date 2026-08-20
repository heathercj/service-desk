import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-muted-foreground">
        This page or resource doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/" className="mt-6 inline-block text-primary underline">
        Return home
      </Link>
    </div>
  );
}
