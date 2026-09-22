import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { DatabaseService } from '../database.service';

const faqSchema = z.object({ question: z.string().trim().min(2).max(200), answer: z.string().trim().min(1).max(6000),
  category: z.string().trim().max(120).default(''), source: z.string().trim().max(500).default('') }).strict();

export function parseFaqCsv(csv: string): z.infer<typeof faqSchema>[] {
  if (Buffer.byteLength(csv) > 256 * 1024) throw new BadRequestException('CSV exceeds 256 KB');
  try {
    const rows: unknown = parse(csv, { columns: true, bom: true, skip_empty_lines: true, max_record_size: 32000 });
    return z.array(faqSchema).min(1).max(100).parse(rows);
  } catch { throw new BadRequestException('Invalid CSV; use question,answer,category,source headers; maximum 100 rows'); }
}

@Injectable()
export class FaqService {
  constructor(private readonly database: DatabaseService) {}

  async list(id: number) {
    return (await this.database.query(`SELECT f.id::int,f.document_id::int AS "documentId",f.question,f.answer,f.category,f.source
      FROM faq_entries f JOIN documents d ON d.id=f.document_id WHERE d.knowledge_base_id=$1 AND d.archived_at IS NULL ORDER BY f.id`, [id])).rows;
  }

  async save(actorId: number, id: number, input: unknown, faqId?: number) {
    const parsed = faqSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid FAQ');
    return (await this.write(actorId, id, [parsed.data], faqId))[0];
  }

  async importCsv(actorId: number, id: number, input: unknown) {
    const parsed = z.object({ csv: z.string().max(262144) }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('CSV string required');
    return this.write(actorId, id, parseFaqCsv(parsed.data.csv));
  }

  private async write(actorId: number, id: number, entries: z.infer<typeof faqSchema>[], faqId?: number) {
    return this.database.transaction(async (client) => {
      if (!(await client.query('SELECT id FROM knowledge_bases WHERE id=$1 AND archived_at IS NULL FOR SHARE', [id])).rowCount) {
        throw new NotFoundException('Active knowledge base not found');
      }
      const result: { id: number; documentId: number }[] = [];
      for (const item of entries) {
        const text = `${item.question}\n${item.answer}`;
        let documentId: number;
        let entryId: number;
        if (faqId !== undefined) {
          const existing = (await client.query(`SELECT f.document_id::int FROM faq_entries f JOIN documents d ON d.id=f.document_id
            WHERE f.id=$1 AND d.knowledge_base_id=$2 AND d.archived_at IS NULL FOR UPDATE OF d,f`, [faqId,id])).rows[0];
          if (!existing) throw new NotFoundException('FAQ not found');
          documentId = existing.document_id; entryId = faqId;
          await client.query('UPDATE faq_entries SET question=$2,answer=$3,category=$4,source=$5,updated_at=now() WHERE id=$1',
            [faqId,item.question,item.answer,item.category,item.source]);
        } else {
          documentId = (await client.query(`INSERT INTO documents(knowledge_base_id,title,original_filename,storage_key,sha256,byte_size,
            uploaded_by,status,source_type) VALUES ($1,$2,'FAQ',$3,$4,$5,$6,'ready','faq') RETURNING id::int`,
          [id,item.question,`${randomUUID()}.faq`,createHash('sha256').update(text).digest('hex'),Buffer.byteLength(text),actorId])).rows[0].id;
          entryId = (await client.query(`INSERT INTO faq_entries(document_id,question,answer,category,source) VALUES($1,$2,$3,$4,$5) RETURNING id::int`,
            [documentId,item.question,item.answer,item.category,item.source])).rows[0].id;
        }
        await client.query(`UPDATE documents SET title=$2,extracted_text=$3,parser_version='faq-v1',
          sha256=$4,byte_size=$5,updated_at=now() WHERE id=$1`,
        [documentId,item.question,text,createHash('sha256').update(text).digest('hex'),Buffer.byteLength(text)]);
        await client.query('DELETE FROM document_blocks WHERE document_id=$1', [documentId]);
        await client.query(`INSERT INTO document_blocks(document_id,ordinal,block_type,heading_path,content,source_locator)
          VALUES($1,1,'faq',$2,$3,$4)`, [documentId,item.question,item.answer,JSON.stringify({ type:'faq_entry',start:entryId,end:entryId })]);
        await client.query(`INSERT INTO audit_logs(actor_admin_id,action,target_type,target_id)
          VALUES($1,'faq.saved','faq',$2)`, [actorId,String(entryId)]);
        result.push({ id:entryId, documentId });
      }
      return result;
    });
  }
}
