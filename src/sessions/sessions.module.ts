import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SessionsService } from './sessions.service';
import { UserSession, UserSessionSchema } from './schemas/session.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserSession.name, schema: UserSessionSchema }]),
  ],
  providers: [SessionsService],
  exports: [SessionsService], // Exportar para que otros módulos puedan usarlo
})
export class SessionsModule {}
