import { BadRequestException, Body, Controller, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { AdminRequest } from '../admin/admin.types';
import { RequirePermission } from '../admin/permission.decorator';
import { PermissionGuard } from '../admin/permission.guard';
import { SecurityRateLimitService } from '../security/security-rate-limit.service';
import { DocumentService } from './document.service';
import { UploadDocumentDto } from './document.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeIndexService } from './knowledge-index.service';
import { EmbeddingProfileService } from './embedding-profile.service';
import { VersionSearchService } from './version-search.service';
import { FaqService } from './faq.service';
import { SearchService } from './search.service';

@Controller('admin/knowledge-bases')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class KnowledgeBaseController {
  constructor(private readonly bases: KnowledgeBaseService, private readonly documents: DocumentService,
    private readonly rateLimit: SecurityRateLimitService, private readonly indexes: KnowledgeIndexService,
    private readonly profiles: EmbeddingProfileService, private readonly search: VersionSearchService,
    private readonly faqs: FaqService, private readonly liveSearch: SearchService) {}

  @Post(':id/recall-test')
  @RequirePermission('documents.read')
  recallTest(@Param('id', ParseIntPipe) id: number, @Body() body: { query?: unknown; topK?: unknown; retrievalMode?: unknown }) {
    const topK = body.topK === undefined ? 5 : Number(body.topK);
    return this.liveSearch.recallTest(id, body.query, topK, body.retrievalMode);
  }

  @Get(':id/faqs')
  @RequirePermission('documents.read')
  faqList(@Param('id', ParseIntPipe) id: number) { return this.faqs.list(id); }

  @Post(':id/faqs')
  @RequirePermission('knowledge_bases.manage')
  faqCreate(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.faqs.save(request.admin!.id,id,body);
  }

  @Patch(':id/faqs/:faqId')
  @RequirePermission('knowledge_bases.manage')
  faqUpdate(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number,
    @Param('faqId', ParseIntPipe) faqId: number, @Body() body: unknown) { return this.faqs.save(request.admin!.id,id,body,faqId); }

  @Post(':id/faqs/import')
  @RequirePermission('knowledge_bases.manage')
  faqImport(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.faqs.importCsv(request.admin!.id,id,body);
  }

  @Get('embedding-profiles')
  @RequirePermission('knowledge_bases.manage')
  profileList() { return this.profiles.list(); }

  @Post('embedding-profiles')
  @RequirePermission('knowledge_bases.manage')
  profileCreate(@Req() request: AdminRequest, @Body() body: unknown) { return this.profiles.create(request.admin!.id, body); }

  @Patch('embedding-profiles/:profileId')
  @RequirePermission('knowledge_bases.manage')
  profileStatus(@Req() request: AdminRequest,@Param('profileId',ParseIntPipe) id:number,@Body() body:unknown) {
    return this.profiles.setEnabled(request.admin!.id,id,body);
  }

  @Get(':id/search')
  @RequirePermission('documents.read')
  searchKnowledge(@Param('id', ParseIntPipe) id: number, @Query('q') query: string,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
    @Query('versionId') versionId?: string) { return this.search.search(query, limit, id, versionId === undefined ? undefined : Number(versionId)); }

  @Patch(':id/config')
  @RequirePermission('knowledge_bases.manage')
  configure(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.indexes.configure(request.admin!.id, id, body);
  }

  @Get(':id/documents/:documentId/preview')
  @RequirePermission('documents.read')
  preview(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.indexes.preview(id, documentId);
  }

  @Get(':id/documents/:documentId/blocks')
  @RequirePermission('documents.read')
  blocks(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.indexes.blocks(id,documentId);
  }

  @Get(':id/documents/:documentId/file')
  @RequirePermission('documents.read')
  download(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.documents.download(documentId,id);
  }

  @Get(':id/versions')
  @RequirePermission('documents.read')
  versions(@Param('id', ParseIntPipe) id: number) { return this.indexes.versions(id); }

  @Post(':id/versions')
  @HttpCode(202)
  @RequirePermission('knowledge_bases.manage')
  build(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number) { return this.indexes.build(request.admin!.id, id); }

  @Post(':id/versions/:versionId/activate')
  @RequirePermission('knowledge_bases.manage')
  activate(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Param('versionId', ParseIntPipe) versionId: number) {
    return this.indexes.activate(request.admin!.id, id, versionId);
  }

  @Get()
  @RequirePermission('documents.read', 'knowledge_bases.manage')
  list() { return this.bases.list(); }

  @Post()
  @RequirePermission('knowledge_bases.manage')
  create(@Req() request: AdminRequest, @Body() body: unknown) { return this.bases.create(request.admin!.id, body); }

  @Get(':id')
  @RequirePermission('documents.read', 'knowledge_bases.manage')
  get(@Param('id', ParseIntPipe) id: number) { return this.bases.get(id); }

  @Patch(':id')
  @RequirePermission('knowledge_bases.manage')
  update(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.bases.update(request.admin!.id, id, body);
  }

  @Post(':id/archive')
  @RequirePermission('knowledge_bases.manage')
  archive(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number) {
    return this.bases.archive(request.admin!.id, id);
  }

  @Get(':id/documents')
  @RequirePermission('documents.read')
  async listDocuments(@Param('id', ParseIntPipe) id: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number) {
    await this.bases.get(id);
    return this.documents.list(Math.max(1, Math.min(limit, 100)), Math.max(0, offset), id);
  }

  @Post(':id/documents')
  @HttpCode(202)
  @RequirePermission('documents.upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1, parts: 2, fieldSize: 8 * 1024 } }))
  upload(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File, @Body() body: UploadDocumentDto) {
    const source = request as AdminRequest & { ip?: string; socket?: { remoteAddress?: string } };
    return this.rateLimit.run('document-upload', source.ip || source.socket?.remoteAddress || `admin:${request.admin!.id}`,
      () => this.documents.upload(request.admin!.id, file, body.title, id, body.processingConfig, body.deferProcessing === 'true'));
  }

  @Post(':id/documents/reprocess')
  @HttpCode(202)
  @RequirePermission('documents.reprocess')
  reprocessAll(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number) {
    return this.documents.reprocessAll(request.admin!.id, id);
  }

  @Get(':id/documents/:documentId')
  @RequirePermission('documents.read')
  document(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.documents.get(documentId, id);
  }

  @Get(':id/documents/:documentId/chunks')
  @RequirePermission('documents.read')
  chunks(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.documents.listChunks(documentId, id);
  }

  @Patch(':id/documents/:documentId/archive')
  @RequirePermission('documents.archive')
  archiveDocument(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.documents.archive(request.admin!.id, documentId, id);
  }

  @Patch(':id/documents/:documentId/unarchive')
  @RequirePermission('documents.archive')
  unarchiveDocument(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.documents.unarchive(request.admin!.id, documentId, id);
  }

  @Patch(':id/documents/:documentId/retrieval-status')
  @RequirePermission('documents.archive')
  setDocumentEnabled(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @Body() body: { enabled?: unknown }) {
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled must be boolean');
    return this.documents.setEnabled(request.admin!.id, documentId, body.enabled, id);
  }

  @Post(':id/documents/:documentId/retry')
  @RequirePermission('documents.reprocess')
  retry(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number) {
    return this.documents.retry(request.admin!.id, documentId, id);
  }

  @Post(':id/documents/:documentId/reprocess')
  @RequirePermission('documents.reprocess')
  reprocess(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @Body() body: { chunkOverride?: unknown }) {
    return this.documents.reprocess(request.admin!.id, documentId, id, body?.chunkOverride);
  }
}
