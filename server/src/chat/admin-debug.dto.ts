import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const DEBUG_CASE_STATUSES = ['pending', 'analyzing', 'confirmed', 'ignored'] as const;
export type DebugCaseStatus = typeof DEBUG_CASE_STATUSES[number];

export class InspectConversationDebugDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  conversationIds!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  traceIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  issueDescription?: string;
}

export class CreateDebugCaseDto extends InspectConversationDebugDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class UpdateDebugCaseStatusDto {
  @IsIn(DEBUG_CASE_STATUSES)
  status!: DebugCaseStatus;
}
