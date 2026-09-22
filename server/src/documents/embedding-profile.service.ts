import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database.service';
import { AppConfigService } from '../config/config.service';
import { embeddingProfileSchema, validateProfileEndpoint } from './profile-embedding';

@Injectable()
export class EmbeddingProfileService {
  constructor(private readonly database: DatabaseService, private readonly runtime: AppConfigService) {}

  async list() {
    return (await this.database.query('SELECT id::int,name,config,enabled FROM embedding_profiles ORDER BY id')).rows;
  }

  async create(actorId: number, input: unknown) {
    const parsed = z.object({ name: z.string().trim().min(1).max(120), config: embeddingProfileSchema }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid embedding profile');
    try { validateProfileEndpoint(parsed.data.config, this.runtime); } catch {
      throw new BadRequestException('Base URL must match the approved EMBEDDING_BASE_URL');
    }
    return this.database.transaction(async (client) => {
      const row = (await client.query('INSERT INTO embedding_profiles(name,config) VALUES ($1,$2) RETURNING id::int,name,config,enabled',
        [parsed.data.name, JSON.stringify(parsed.data.config)])).rows[0];
      await client.query(`INSERT INTO audit_logs(actor_admin_id,action,target_type,target_id)
        VALUES ($1,'embedding_profile.created','embedding_profile',$2)`, [actorId, String(row.id)]);
      return row;
    });
  }

  async setEnabled(actorId: number, id: number, input: unknown) {
    const parsed=z.object({enabled:z.boolean()}).strict().safeParse(input);
    if(!parsed.success) throw new BadRequestException('enabled must be a boolean');
    return this.database.transaction(async(client)=>{
      const row=(await client.query('UPDATE embedding_profiles SET enabled=$2 WHERE id=$1 RETURNING id::int,name,config,enabled',[id,parsed.data.enabled])).rows[0];
      if(!row) throw new NotFoundException('Embedding profile not found');
      await client.query(`INSERT INTO audit_logs(actor_admin_id,action,target_type,target_id,details)
        VALUES($1,'embedding_profile.updated','embedding_profile',$2,$3)`,[actorId,String(id),JSON.stringify(parsed.data)]);
      return row;
    });
  }
}
