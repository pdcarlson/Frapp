import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getDocBySlug } from '../../../lib/docs';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:underline">
          ← Back to index
        </Link>
      </div>
      
      <article className="prose prose-blue lg:prose-xl max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-blue-600 prose-code:text-blue-600 prose-code:bg-blue-50 prose-code:px-1 prose-code:rounded">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {doc.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
