import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  brand!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  suggestedPrice?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string | null;

  @IsObject()
  specifications!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999999)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  suggestedPrice?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999999)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
