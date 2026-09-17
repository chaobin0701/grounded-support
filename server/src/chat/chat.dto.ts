import { IsString, Length } from 'class-validator';

export class AskQuestionDto {
  @IsString()
  @Length(2, 200)
  question!: string;
}
