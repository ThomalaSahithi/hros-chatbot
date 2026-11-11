
export default function Loading() {
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">

        <h1 className="text-2xl font-bold text-blue-700">
          HROS Recruitment
        </h1>

        <div className="mt-10 rounded-xl border bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="font-semibold text-slate-700">
              Loading HR Dashboard...
            </p>
          </div>

          <p className="mt-3 text-sm text-slate-500">
            Retrieving your profile and recruitment information.
          </p>
        </div>

      </div>
    </main>
  );
}
