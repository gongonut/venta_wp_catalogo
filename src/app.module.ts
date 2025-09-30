import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { EmpresasModule } from './empresas/empresas.module';
import { ClientesModule } from './clientes/clientes.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BotsModule } from './bots/bots.module';
import { SessionsModule } from './sessions/sessions.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'apps', 'frontend'),
      serveRoot: '/',
    }),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    WhatsappModule,
    EmpresasModule,
    ClientesModule,
    PedidosModule,
    BotsModule,
    SessionsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}