import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SearchService } from '../../documents/search.service';
import { AgentTool } from './agent-tool';
import { ToolContext } from './tool-context';
import { ToolResult } from './tool-result';
import { knowledgeResources } from '../context/context-contribution';

const inputSchema = z.object({
  query: z.string().trim().min(2).max(200),
  topK: z.number().int().min(1).max(8).optional(),
});

@Injectable()
export class KnowledgeSearchTool implements AgentTool<z.infer<typeof inputSchema>> {
  readonly name = 'search_knowledge';
  readonly description = '查询已上传的商家资料，只返回资料中可以验证的内容。';
  readonly inputSchema = inputSchema;
  readonly planning = { canBatch: true } as const;
  readonly contributeContext = knowledgeResources;

  constructor(private readonly search: SearchService) {}

  async execute(input: z.infer<typeof inputSchema>, _context: ToolContext): Promise<ToolResult> {
    const result = await this.search.searchForAgent(input.query, input.topK ?? 5);
    const evidence = result.hits.map((hit) => ({
      chunkId: hit.chunkId,
      title: hit.documentTitle,
      heading: hit.headingPath,
      content: hit.content.slice(0, 1800),
      score: hit.score,
    }));
    return {
      success: true,
      content: evidence.length
        ? evidence.map((item) => `[${item.chunkId}] ${item.title}${item.heading ? ` · ${item.heading}` : ''}\n${item.content}`).join('\n\n')
        : '未找到足以支持回答的资料片段。',
      data: {
        hits: result.hits,
        retrievalMode: result.retrievalMode,
        vectorIndexedChunks: result.vectorIndexedChunks,
      },
      metadata: { retrievalMode: result.retrievalMode, vectorIndexedChunks: result.vectorIndexedChunks },
    };
  }
}
