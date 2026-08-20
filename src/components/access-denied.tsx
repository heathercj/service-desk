export function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center" role="alert">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="mt-2 text-muted-foreground">
        {message ?? "You don't have permission to view this."}
      </p>
    </div>
  );
}
