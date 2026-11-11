
export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="rounded-xl bg-white p-8 text-center shadow">

        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />

        <h2 className="mt-4 text-lg font-semibold text-slate-800">
          Loading HROS Dashboard
        </h2>

        <p className="mt-2 text-sm text-slate-500">
          Checking your account and permissions...
        </p>

      </div>
    </main>
  );
}
