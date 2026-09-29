import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service';

export type ConversationStatusFilter = 'all' | 'answered' | 'refused' | 'failed' | 'active';

@Injectable()
export class AdminConversationService {
  constructor(private readonly database: DatabaseService) {}

  async list(limit: number, offset: number, query = '', status: string = 'all') {
    const filter = this.normalizeStatus(status);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const safeOffset = Math.max(0, offset);
    const search = `%${query.trim()}%`;
    const result = await this.database.query(
      `WITH message_stats AS (
         SELECT conversation_id, count(*)::int AS "messageCount",
                count(*) FILTER (WHERE role = 'user')::int AS "turnCount"
         FROM conversation_messages GROUP BY conversation_id
       ), latest_trace AS (
         SELECT DISTINCT ON (conversation_id) conversation_id, id AS "traceId",
                question, status, refused, created_at AS "traceCreatedAt"
         FROM chat_traces WHERE kind = 'answer'
         ORDER BY conversation_id, created_at DESC
       )
       SELECT c.id, c.title, c.updated_at AS "updatedAt", c.created_at AS "createdAt",
              c.visitor_session_id AS "visitorSessionId",
              COALESCE(ms."messageCount", 0) AS "messageCount",
              COALESCE(ms."turnCount", 0) AS "turnCount",
              lt.question AS "lastQuestion", lt.status AS "lastStatus", lt.refused AS "lastRefused",
              lt."traceId" AS "lastTraceId",
              EXISTS (SELECT 1 FROM chat_traces t WHERE t.conversation_id = c.id AND t.status = 'failed') AS "hasFailed",
              EXISTS (SELECT 1 FROM chat_traces t WHERE t.conversation_id = c.id AND t.refused = true) AS "hasRefused"
       FROM conversations c
       LEFT JOIN message_stats ms ON ms.conversation_id = c.id
       LEFT JOIN latest_trace lt ON lt.conversation_id = c.id
       WHERE ($1 = '%%' OR c.id::text ILIKE $1 OR c.title ILIKE $1 OR COALESCE(lt.question, '') ILIKE $1)
         AND ($2 = 'all'
           OR ($2 = 'answered' AND lt.status = 'completed' AND COALESCE(lt.refused, false) = false)
           OR ($2 = 'refused' AND lt.refused = true)
           OR ($2 = 'failed' AND (lt.status = 'failed' OR EXISTS (SELECT 1 FROM chat_traces t2 WHERE t2.conversation_id = c.id AND t2.status = 'failed')))
           OR ($2 = 'active' AND c.busy_until IS NOT NULL AND c.busy_until > now()))
       ORDER BY c.updated_at DESC
       LIMIT $3 OFFSET $4`, [search, filter, safeLimit + 1, safeOffset],
    );
    const hasMore = result.rows.length > safeLimit;
    return { items: result.rows.slice(0, safeLimit), pagination: { limit: safeLimit, offset: safeOffset, hasMore } };
  }

  async detail(id: string) {
    const conversation = await this.database.query(
      `SELECT id, visitor_session_id AS "visitorSessionId", title, summary,
              busy_until AS "busyUntil", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM conversations WHERE id = $1`, [id],
    );
    if (!conversation.rows[0]) throw new NotFoundException('Conversation not found');
    const [messages, runs, traces] = await Promise.all([
      this.database.query(
        `SELECT id::int, role, content, refused, citations, tool_steps AS "toolSteps",
                progress_events AS "progressEvents", created_at AS "createdAt"
         FROM conversation_messages WHERE conversation_id = $1 ORDER BY id ASC`, [id]),
      this.database.query(
        `SELECT id, client_request_id AS "clientRequestId", question, status,
                started_at AS "startedAt", finished_at AS "finishedAt", error_code AS "errorCode",
                user_message_id::int AS "userMessageId", assistant_message_id::int AS "assistantMessageId",
                created_at AS "createdAt"
         FROM conversation_runs WHERE conversation_id = $1 ORDER BY created_at ASC`, [id]),
      this.database.query(
        `SELECT id, kind, user_message_id AS "userMessageId", question, final_answer AS "finalAnswer",
                refused, status, error_code AS "errorCode", input_tokens AS "inputTokens",
                output_tokens AS "outputTokens", total_tokens AS "totalTokens", duration_ms AS "durationMs",
                created_at AS "createdAt"
         FROM chat_traces WHERE conversation_id = $1 ORDER BY created_at ASC`, [id]),
    ]);
    return { ...conversation.rows[0], messages: messages.rows, runs: runs.rows, traces: traces.rows };
  }

  private normalizeStatus(value: string): ConversationStatusFilter {
    const normalized = value || 'all';
    if (!['all', 'answered', 'refused', 'failed', 'active'].includes(normalized)) {
      throw new BadRequestException('Invalid conversation status filter');
    }
    return normalized as ConversationStatusFilter;
  }
}
