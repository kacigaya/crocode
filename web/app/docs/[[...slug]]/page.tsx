import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DOCS_CONTENT, type DocSection } from "@/lib/docs-content";
import { DOCS_PAGES, findDoc } from "@/lib/docs-nav";
import { canonicalDocUrl } from "@/lib/docs-site";

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) notFound();
  return {
    title: `${doc.title} · Docs`,
    description: doc.description,
    alternates: { canonical: canonicalDocUrl(doc.href) },
    openGraph: {
      type: "article",
      url: canonicalDocUrl(doc.href),
      title: `${doc.title} · CroCode Docs`,
      description: doc.description,
    },
  };
}

function Outline({ sections }: { sections: DocSection[] }) {
  return (
    <nav aria-label="On this page" className="text-sm">
      <ul className="flex flex-col gap-3">
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className="block rounded-sm text-muted-foreground hover:text-foreground">
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) notFound();
  const sections = DOCS_CONTENT[doc.href];
  const index = DOCS_PAGES.findIndex((page) => page.href === doc.href);
  const previous = DOCS_PAGES[index - 1];
  const next = DOCS_PAGES[index + 1];

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_11rem] xl:gap-10">
      <div className="min-w-0">
        <article aria-labelledby="doc-title">
          <p className="mb-3 text-xs font-medium text-brand">Documentation</p>
          <h1 id="doc-title" className="text-balance text-3xl font-semibold sm:text-4xl">{doc.title}</h1>
          <p className="mt-4 text-pretty text-lg leading-8 text-muted-foreground">{doc.description}</p>
          <details className="mt-7 rounded-lg border px-4 py-3 text-sm xl:hidden">
            <summary className="cursor-pointer font-medium">On this page</summary>
            <div className="pt-4"><Outline sections={sections} /></div>
          </details>
          <div className="docs-prose">
            {sections.map((section) => (
              <section key={section.id} aria-labelledby={section.id}>
                <h2 id={section.id}><a className="heading-anchor" href={`#${section.id}`}>{section.title}</a></h2>
                {section.content}
              </section>
            ))}
          </div>
        </article>
        <nav aria-label="Previous and next pages" className="mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2">
          {previous && (
            <Link href={previous.href} className="flex flex-col gap-1 rounded-lg border p-4 hover:bg-accent">
              <span className="text-xs text-muted-foreground">Previous</span>
              <span className="text-sm font-medium">{previous.title}</span>
            </Link>
          )}
          {next && (
            <Link href={next.href} className="flex flex-col gap-1 rounded-lg border p-4 text-right hover:bg-accent sm:col-start-2">
              <span className="text-xs text-muted-foreground">Next</span>
              <span className="text-sm font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </div>
      <aside className="hidden xl:block">
        <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pb-4">
          <p className="mb-4 text-xs font-semibold">On this page</p>
          <Outline sections={sections} />
        </div>
      </aside>
    </div>
  );
}
