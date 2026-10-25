import { Injectable } from '@nestjs/common';
import { DatabaseService, type Tx } from '../database/database.service';

/**
 * Búsquedas globales de usuarios (fuera de un tenant). La tabla `users` es
 * compartida: con RLS la app solo ve a los miembros de su org.
 */
@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  findByEmail(email: string) {
    return this.db.system.user.findUnique({ where: { email } });
  }

  /** Para invitar: reutiliza la cuenta si ya existe; si no, crea una sin contraseña. */
  async findOrCreateInvitee(email: string, name: string, tx?: Tx) {
    const client = tx ?? this.db.system;
    const existing = await client.user.findUnique({ where: { email } });
    if (existing) return existing;
    return client.user.create({ data: { email, name } });
  }
}
