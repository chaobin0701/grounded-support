import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

export class PreviousTurnDto {
  @IsString()
  @Length(2, 2000)
  question!: string;

  @IsString()
  @Length(1, 1200)
  answer!: string;
}

export class ProductReferenceDto {
  @IsString()
  @Length(1, 80)
  productId!: string;

  @IsInt()
  @Min(0)
  @Max(2000)
  offset!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  length?: number;
}
export class RequestContextDto {
  @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? [...new Set(value.map(item => typeof item === 'string' ? item.trim() : item))] : value)
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ProductReferenceDto)
  productReferences?: ProductReferenceDto[];
}

export class AskQuestionDto {
  @IsString()
  @Length(2, 2000)
  question!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RequestContextDto)
  context?: RequestContextDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PreviousTurnDto)
  history?: PreviousTurnDto[];
}
