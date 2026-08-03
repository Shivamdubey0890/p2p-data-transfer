import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { UserDTO } from '../../../shared/protocol';
import { env } from '../config/env';
import { User } from '../domain/entities';
import { IUserRepository } from '../repositories/interfaces';
import { HttpError } from '../http/errors';

export interface UserTokenClaims {
  sub: string; // userId
  username: string;
  kind: 'user';
}

export interface DeviceTokenClaims {
  sub: string; // userId
  deviceId: string;
  kind: 'device';
}

export class AuthService {
  constructor(private readonly users: IUserRepository) {}

  async signup(username: string, password: string): Promise<UserDTO> {
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      throw new HttpError(400, 'Username must be 3-32 chars (letters, digits, _.-)');
    }
    if (password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }
    if (await this.users.findByUsername(username)) {
      throw new HttpError(409, 'Username already taken');
    }
    const user: User = {
      id: uuid(),
      username,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: new Date(),
    };
    await this.users.create(user);
    return AuthService.toDTO(user);
  }

  async login(username: string, password: string): Promise<{ token: string; user: UserDTO }> {
    const user = await this.users.findByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'Invalid username or password');
    }
    const claims: UserTokenClaims = { sub: user.id, username: user.username, kind: 'user' };
    const token = jwt.sign(claims, env.jwtSecret, { expiresIn: env.jwtTtlSeconds });
    return { token, user: AuthService.toDTO(user) };
  }

  issueDeviceToken(userId: string, deviceId: string): string {
    const claims: DeviceTokenClaims = { sub: userId, deviceId, kind: 'device' };
    return jwt.sign(claims, env.jwtSecret, { expiresIn: env.jwtTtlSeconds });
  }

  verifyUserToken(token: string): UserTokenClaims {
    const claims = this.verify(token);
    if (claims.kind !== 'user') throw new HttpError(401, 'User token required');
    return claims as UserTokenClaims;
  }

  verifyDeviceToken(token: string): DeviceTokenClaims {
    const claims = this.verify(token);
    if (claims.kind !== 'device') throw new HttpError(401, 'Device token required');
    return claims as DeviceTokenClaims;
  }

  private verify(token: string): UserTokenClaims | DeviceTokenClaims {
    try {
      return jwt.verify(token, env.jwtSecret) as UserTokenClaims | DeviceTokenClaims;
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
  }

  static toDTO(user: User): UserDTO {
    return { id: user.id, username: user.username, createdAt: user.createdAt.toISOString() };
  }
}
