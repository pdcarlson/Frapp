export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">Frapp Admin Dashboard</h1>
      <p className="text-lg text-gray-600 mb-8">
        The Operating System for Greek Life
      </p>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md w-full">
        <p className="text-center text-gray-500">
          Authentication and dashboard coming soon.
        </p>
        <p className="text-center text-sm text-gray-400 mt-4">
          Supabase Auth integration pending setup.
        </p>
      </div>
    </main>
  );
}
