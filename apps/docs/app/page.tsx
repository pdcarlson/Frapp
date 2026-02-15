import Link from 'next/link';
import { getAllDocs } from '../lib/docs';

export default function Home() {
  const docs = getAllDocs();

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <header className="mb-12 border-b pb-8">
        <h1 className="text-4xl font-bold mb-4 tracking-tight">Frapp Documentation</h1>
        <p className="text-xl text-gray-600">The technical overview and domain logic of the Fraternity App ecosystem.</p>
      </header>

      <section>
        <h2 className="text-2xl font-semibold mb-6">Documentation Modules</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {docs.map((doc) => (
            <Link 
              key={doc.slug} 
              href={`/docs/${doc.slug}`}
              className="p-6 border rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
            >
              <h3 className="text-xl font-medium group-hover:text-blue-600">{doc.title}</h3>
              <p className="text-sm text-gray-500 mt-2">Technical specification and implementation details.</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
