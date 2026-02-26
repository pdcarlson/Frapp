import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDocBySlug } from "../../../lib/docs";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: { slug: string };
};

export default function DocPage({ params }: PageProps) {
  const { slug } = params;
  const doc = getDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          Docs
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-[13px] font-medium text-foreground/70">Spec</span>
      </div>

      <article className="prose-docs">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </article>
    </div>
  );
}
