import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, ValidateNested } from 'class-validator';

export class PreviousTurnDto {
  @IsString()
  @Length(2, 2000)
  question!: string;

  @IsString()
  @Length(1, 1200)
  answer!: string;
}

export class AskQuestionDto {
  @IsString()
  @Length(2, 2000)
  question!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PreviousTurnDto)
  history?: PreviousTurnDto[];
}
