import { z } from 'zod';

export const knowledgeConfigSchema = z.object({
  indexMode: z.enum(['economy', 'high_quality']).default('economy'),
  retrievalMode: z.enum(['fulltext', 'vector', 'hybrid']).default('fulltext'),
  chunkMode: z.enum(['general', 'parent_child']).default('general'),
  chunkChars: z.number().int().min(200).max(4000).default(800),
  overlapChars: z.number().int().min(0).max(400).default(60),
  parentChars: z.number().int().min(500).max(6000).default(2400),
  childChars: z.number().int().min(100).max(2000).default(500),
  childOverlapChars: z.number().int().min(0).max(200).default(50),
  embeddingProfileId: z.number().int().positive().nullable().default(null),
  lexicalThreshold: z.number().min(0).max(1).default(0.15),
  vectorThreshold: z.number().min(-1).max(1).default(0.3),
}).strict().superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (value.overlapChars >= value.chunkChars) invalid('Overlap must be smaller than chunk size');
  if (value.childOverlapChars >= value.childChars || value.childChars > value.parentChars) invalid('Invalid parent/child sizes');
  if (value.indexMode === 'economy' && (value.retrievalMode !== 'fulltext' || value.embeddingProfileId !== null)) invalid('Economy mode uses fulltext without embeddings');
  if (value.indexMode === 'high_quality' && value.embeddingProfileId === null) invalid('High quality requires an embedding profile');
});
export type KnowledgeConfig = z.infer<typeof knowledgeConfigSchema>;

export const sourceLocatorSchema = z.object({
  type: z.enum(['markdown_lines', 'pdf_page', 'docx_paragraph', 'faq_entry']),
  start: z.number().int().positive(), end: z.number().int().positive(),
}).strict().refine((v) => v.end >= v.start);

export const documentBlockSchema = z.object({
  ordinal: z.number().int().positive(), blockType: z.enum(['paragraph', 'code', 'page', 'faq']),
  headingPath: z.string(), content: z.string().min(1), sourceLocator: sourceLocatorSchema,
}).strict();
