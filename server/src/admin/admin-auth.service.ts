import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import { admins } from '../db/schema';
import { AdminLoginDto } from './auth.dto';

@Injectable()
export class AdminAuthService {
  constructor(private readonly database: DatabaseService, private readonly jwt: JwtService) {}

  async login(input: AdminLoginDto) {
    const email = input.email.trim().toLowerCase();
    const [admin] = await this.database.db
      .select({ id: admins.id, email: admins.email, passwordHash: admins.passwordHash, displayName: admins.displayName, disabledAt: admins.disabledAt })
      .from(admins)
      .where(sql`lower(${admins.email}) = ${email}`)
      .limit(1);

    if (!admin || admin.disabledAt || !(await compare(input.password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      accessToken: await this.jwt.signAsync({ sub: String(admin.id) }),
      tokenType: 'Bearer',
      expiresIn: 900,
      admin: { id: admin.id, email: admin.email, displayName: admin.displayName },
    };
  }
}
