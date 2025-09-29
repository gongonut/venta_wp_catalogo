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
import * as fs from 'fs';

const appsDir = join(__dirname, '..', 'apps');
const appFolders = fs.existsSync(appsDir) ? fs.readdirSync(appsDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name) : [];

const staticServeModules = appFolders.map(appFolder => {
  const appName = appFolder;
  const rootPath = join(appsDir, appName);

  return ServeStaticModule.forRoot({
    rootPath,
    serveRoot: `/${appName}`,
  });
});

@Module({
  imports: [
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
    ...staticServeModules,
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

