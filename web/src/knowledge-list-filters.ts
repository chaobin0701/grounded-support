export type KnowledgeBaseStatusFilter = 'all' | 'enabled' | 'disabled';
export type DocumentStatusFilter = 'all' | 'processing' | 'ready' | 'failed';

type ArchivedRecord = { id: number; archivedAt: string | null; updatedAt: string };
type BaseRecord = ArchivedRecord & { name: string; description: string; enabledForChat: boolean };
type DocumentRecord = ArchivedRecord & { title: string; originalFilename: string; status: string; sourceType?: string };

function archiveLast(a: ArchivedRecord, b: ArchivedRecord) {
  return Number(!!a.archivedAt) - Number(!!b.archivedAt)
    || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    || b.id - a.id;
}

export function filterKnowledgeBases<T extends BaseRecord>(items: T[], query: string, status: KnowledgeBaseStatusFilter, showArchived = false): T[] {
  const keyword = query.trim().toLocaleLowerCase();
  return items.filter(item => (showArchived || !item.archivedAt)
    && (!keyword || `${item.name} ${item.description}`.toLocaleLowerCase().includes(keyword))
    && (status === 'all' || (status === 'enabled' ? item.enabledForChat : !item.enabledForChat)))
    .sort(archiveLast);
}

export function filterKnowledgeDocuments<T extends DocumentRecord>(items: T[], query: string, status: DocumentStatusFilter, showArchived = false): T[] {
  const keyword = query.trim().toLocaleLowerCase();
  return items.filter(item => item.sourceType !== 'faq'
    && (showArchived || !item.archivedAt)
    && (!keyword || `${item.title} ${item.originalFilename}`.toLocaleLowerCase().includes(keyword))
    && (status === 'all' || (status === 'processing'
      ? ['pending', 'queued', 'processing', 'extracted'].includes(item.status)
      : item.status === status)))
    .sort(archiveLast);
}
