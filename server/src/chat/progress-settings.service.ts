import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';

@Injectable()
export class ProgressSettingsService {
  constructor(private readonly database: DatabaseService) {}

  async get(): Promise<{ publicProgressEnabled: boolean }> {
    const result = await this.database.query<{ publicProgressEnabled: boolean }>(
      'SELECT public_progress_enabled AS "publicProgressEnabled" FROM chat_display_settings WHERE id = 1',
    );
    return { publicProgressEnabled: result.rows[0]?.publicProgressEnabled ?? false };
  }

  async set(actorId: number, enabled: boolean) {
    await this.database.transaction(async (client) => {
      const permission = await client.query(
        `SELECT 1 FROM admins a JOIN admin_roles ar ON ar.admin_id = a.id
         JOIN role_permissions rp ON rp.role_id = ar.role_id
         WHERE a.id = $1 AND a.disabled_at IS NULL AND rp.permission_code = 'chat.settings.manage' LIMIT 1`, [actorId],
      );
      if (!permission.rowCount) throw new ForbiddenException('Permission denied');
      await client.query('UPDATE chat_display_settings SET public_progress_enabled = $1, updated_at = now(), updated_by = $2 WHERE id = 1', [enabled, actorId]);
      await client.query(
        `INSERT INTO audit_logs (actor_admin_id, action, target_type, target_id, details)
         VALUES ($1, 'chat.public_progress_updated', 'chat_settings', '1', $2::jsonb)`,
        [actorId, JSON.stringify({ publicProgressEnabled: enabled })],
      );
    });
    return { publicProgressEnabled: enabled };
  }
}
