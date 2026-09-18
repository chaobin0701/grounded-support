import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database.service';

@Injectable()
export class McpCapabilityAdminService {
  constructor(private readonly database: DatabaseService) {}

  async list() {
    const result = await this.database.query<{
      id: string; name: string; transport: string; manifestKey: string; enabled: boolean;
      updatedAt: Date; tools: { name: string; displayName: string; enabled: boolean }[];
    }>(`SELECT c.id, c.name, c.transport, c.manifest_key AS "manifestKey", c.enabled,
              c.updated_at AS "updatedAt",
              COALESCE(json_agg(json_build_object('name', p.tool_name, 'displayName', p.display_name,
                'enabled', p.enabled) ORDER BY p.tool_name)
                FILTER (WHERE p.tool_name IS NOT NULL), '[]'::json) AS tools
       FROM mcp_capabilities c LEFT JOIN mcp_tool_policies p ON p.capability_id = c.id
       GROUP BY c.id ORDER BY c.id`);
    return result.rows;
  }

  async setCapability(actorId: number, id: string, enabled: boolean) {
    await this.database.transaction(async (client) => {
      await this.requirePermission(client, actorId);
      const changed = await client.query(
        'UPDATE mcp_capabilities SET enabled = $1, updated_at = now(), updated_by = $2 WHERE id = $3',
        [enabled, actorId, id],
      );
      if (!changed.rowCount) throw new NotFoundException('MCP capability not found');
      await this.audit(client, actorId, enabled ? 'mcp.capability_enabled' : 'mcp.capability_disabled', id, {});
    });
    return { id, enabled };
  }

  async setTool(actorId: number, capabilityId: string, toolName: string, enabled: boolean) {
    await this.database.transaction(async (client) => {
      await this.requirePermission(client, actorId);
      const changed = await client.query(
        `UPDATE mcp_tool_policies SET enabled = $1, updated_at = now(), updated_by = $2
         WHERE capability_id = $3 AND tool_name = $4`,
        [enabled, actorId, capabilityId, toolName],
      );
      if (!changed.rowCount) throw new NotFoundException('MCP tool not found');
      await this.audit(client, actorId, enabled ? 'mcp.tool_enabled' : 'mcp.tool_disabled', `${capabilityId}:${toolName}`, {});
    });
    return { capabilityId, toolName, enabled };
  }

  private async requirePermission(client: PoolClient, actorId: number): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM admins a JOIN admin_roles ar ON ar.admin_id = a.id
       JOIN role_permissions rp ON rp.role_id = ar.role_id
       WHERE a.id = $1 AND a.disabled_at IS NULL AND rp.permission_code = 'mcp.manage' LIMIT 1`, [actorId],
    );
    if (!result.rowCount) throw new ForbiddenException('Permission denied');
  }

  private async audit(client: PoolClient, actorId: number, action: string, targetId: string, details: object) {
    await client.query(
      `INSERT INTO audit_logs (actor_admin_id, action, target_type, target_id, details)
       VALUES ($1, $2, 'mcp', $3, $4)`,
      [actorId, action, targetId, JSON.stringify(details)],
    );
  }
}
