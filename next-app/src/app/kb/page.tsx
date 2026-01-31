import { getFolderTree, getDocumentSummaries, kbExists } from '@/lib/kb';
import { KbPageClient } from '@/components/kb/KbPageClient';

export default async function KnowledgeBasePage() {
  const hasKb = kbExists();
  const tree = hasKb ? await getFolderTree() : [];
  const docs = hasKb ? await getDocumentSummaries() : [];

  return <KbPageClient hasKb={hasKb} tree={tree} docs={docs} />;
}
