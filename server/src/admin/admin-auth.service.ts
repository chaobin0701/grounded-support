import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import { admins } from '../db/schema';
import { AdminLoginDto } from './auth.dto';
import { AdminPrincipal } from './admin.types';

@Injectable()
export class AdminAuthService {
  constructor(private readonly database: DatabaseService, private readonly jwt: JwtService) {}

  async me(admin: AdminPrincipal) {
    const [roles, permissions] = await Promise.all([
      this.database.query<{ id: number; code: string; name: string }>(
        `SELECT r.id::int AS id, r.code, r.name FROM roles r
         JOIN admin_roles ar ON ar.role_id = r.id WHERE ar.admin_id = $1 ORDER BY r.id`, [admin.id],
      ),
      this.database.query<{ code: string }>(
        `SELECT DISTINCT rp.permission_code AS code FROM admin_roles ar
         JOIN role_permissions rp ON rp.role_id = ar.role_id
         WHERE ar.admin_id = $1 ORDER BY code`, [admin.id],
      ),
    ]);
    return { ...admin, roles: roles.rows, permissionCodes: permissions.rows.map((row) => row.code) };
  }

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
