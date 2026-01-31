import { notFound } from 'next/navigation';
import { getDocument, getFolderTree, getAllDocuments } from '@/lib/kb';
import { KbDocPageClient } from '@/components/kb/KbDocPageClient';

type PageProps = {
  params: Promise<{ slug: string[] }>;
};

// Serialize Date objects to strings for client components
function serializeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Date) {
      result[key] = value.toISOString().split('T')[0];
    } else if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = serializeMeta(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const slugPath = slug.join('/');

  const [doc, tree, allDocs] = await Promise.all([
    getDocument(slugPath),
    getFolderTree(),
    getAllDocuments(),
  ]);

  if (!doc) {
    notFound();
  }

  // Build backlinks with titles
  const backlinks = doc.backlinks.map((bl) => {
    const blDoc = allDocs.find((d) => d.slug === bl);
    return {
      slug: bl,
      title: blDoc?.meta.title || bl,
    };
  });

  // Serialize meta to avoid Date objects in client components
  const serializedMeta = serializeMeta(doc.meta as Record<string, unknown>);

  // Extract specific meta fields for DocViewer
  const docMeta = {
    type: typeof serializedMeta.type === 'string' ? serializedMeta.type : undefined,
    status: typeof serializedMeta.status === 'string' ? serializedMeta.status : undefined,
    source: typeof serializedMeta.source === 'string' ? serializedMeta.source : undefined,
    confidence: typeof serializedMeta.confidence === 'string' ? serializedMeta.confidence : undefined,
  };

  return (
    <KbDocPageClient
      tree={tree}
      slugParts={slug}
      slugPath={slugPath}
      title={doc.meta.title}
      tags={doc.meta.tags}
      html={doc.html}
      created={typeof serializedMeta.created === 'string' ? serializedMeta.created : undefined}
      updated={typeof serializedMeta.updated === 'string' ? serializedMeta.updated : undefined}
      backlinks={backlinks}
      meta={docMeta}
    />
  );
}

export async function generateStaticParams() {
  try {
    const docs = await getAllDocuments();
    return docs.map((doc) => ({
      slug: doc.slug.split('/'),
    }));
  } catch {
    return [];
  }
}
