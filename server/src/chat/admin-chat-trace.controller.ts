import { Controller, DefaultValuePipe, Get, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { RequirePermission } from '../admin/permission.decorator';
import { PermissionGuard } from '../admin/permission.guard';
import { DatabaseService } from '../database.service';

@Controller('admin/chat-traces')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class AdminChatTraceController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @RequirePermission('conversations.read')
  async list(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    const result = await this.database.query(
      `SELECT id, kind, conversation_id AS "conversationId", question, model, final_answer AS "finalAnswer",
              refused, status, error_code AS "errorCode", input_tokens AS "inputTokens",
              output_tokens AS "outputTokens", total_tokens AS "totalTokens",
              duration_ms AS "durationMs", created_at AS "createdAt"
       FROM chat_traces ORDER BY created_at DESC LIMIT $1`, [Math.max(1, Math.min(limit, 100))],
    );
    return result.rows;
  }

  @Get(':id')
  @RequirePermission('conversations.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.database.query(
      `SELECT id, kind, conversation_id AS "conversationId", question, context_snapshot AS "contextSnapshot",
              model, raw_model_output AS "rawModelOutput", final_answer AS "finalAnswer",
              refused, status, error_code AS "errorCode", input_tokens AS "inputTokens",
              output_tokens AS "outputTokens", total_tokens AS "totalTokens",
              duration_ms AS "durationMs", created_at AS "createdAt"
       FROM chat_traces WHERE id = $1`, [id],
    );
    if (!result.rows[0]) throw new NotFoundException('Trace not found');
    return result.rows[0];
  }
}
