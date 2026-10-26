export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const disabled = reason === "disabled";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">{disabled ? "Your account is disabled" : "No access yet"}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {disabled
          ? "An administrator has disabled your account. Contact them if you think this is a mistake."
          : "You are signed in, but no role has been assigned to your account. Ask an administrator to add you."}
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="rounded-md border px-4 py-2 text-sm font-medium">
          Sign out
        </button>
      </form>
    </main>
  );
}
