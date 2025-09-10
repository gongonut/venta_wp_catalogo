
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  GenericMessage,
  IWhatsAppProvider,
  WHATSAPP_PROVIDER,
} from './providers/whatsapp-provider.interface';
import { EmpresasService } from '../empresas/empresas.service';
import { ProductosService } from '../productos/productos.service';
import { ClientesService } from '../clientes/clientes.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { CreatePedidoDto } from '../pedidos/dto/create-pedido.dto';

// Estado de la sesión de un usuario
interface UserSession {
  company?: { code: string; id: string };
  cart: Map<string, { quantity: number; precioVenta: number; nombreCorto: string }>; // sku -> { quantity, precioVenta, nombreCorto }
}

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private readonly sessions = new Map<string, UserSession>();

  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly whatsAppProvider: IWhatsAppProvider,
    private readonly empresasService: EmpresasService,
    private readonly productosService: ProductosService,
    private readonly clientesService: ClientesService,
    private readonly pedidosService: PedidosService,
  ) {}

  onModuleInit() {
    this.logger.log('Initializing WhatsApp provider...');
    this.whatsAppProvider.initialize();
    this.whatsAppProvider.events.on('message', (message: GenericMessage) => {
      // Ignorar mensajes propios
      if (message.isFromMe) return;
      this.handleIncomingMessage(message);
    });
  }

  private async handleIncomingMessage(message: GenericMessage) {
    this.logger.debug(`Processing message from ${message.from}: "${message.text}"`);
    const userJid = message.from;
    const messageText = message.text.trim().toLowerCase();

    // Asegurar que el usuario tiene una sesión
    if (!this.sessions.has(userJid)) {
      this.sessions.set(userJid, { cart: new Map() });
    }
    const session = this.sessions.get(userJid)!;

    /*
     * FUTURO: Punto de entrada para Asesor IA
     * if (session.company) {
     *   const empresa = await this.empresasService.findOneByCode(session.company.code);
     *   if (empresa?.useAIAdvisor) {
     *     const response = await this.aiAdvisorService.getCompletion(session, message);
     *     await this.sendMessage(userJid, response);
     *     return;
     *   }
     * }
    */

    // Flujo basado en reglas
    if (!session.company) {
      await this.handleCompanySelection(userJid, session, messageText);
    } else {
      // El usuario ya está en el contexto de una empresa
      switch (messageText) {
        case 'pedido':
          await this.handleCreateOrder(userJid, session);
          break;
        case 'ver carrito':
          await this.handleShowCart(userJid, session);
          break;
        case 'cancelar':
          this.sessions.delete(userJid);
          await this.sendMessage(userJid, 'Sesión reiniciada. Para comenzar, elige una empresa de la lista.');
          await this.handleCompanySelection(userJid, session, ''); // Mostrar lista de nuevo
          break;
        default:
          await this.handleOrdering(userJid, session, messageText);
          break;
      }
    }
  }

  private async handleCompanySelection(userJid: string, session: UserSession, messageText: string) {
    const empresa = await this.empresasService.findOneByCode(messageText);

    if (empresa) {
      session.company = { code: empresa.code, id: empresa._id.toString() };
      let response = `${empresa.saludoBienvenida || `¡Bienvenido a ${empresa.nombre}!`} Nuestro catálogo es:`;
      
      const productos = await this.productosService.findAllByEmpresa(session.company.id);
      if (productos.length > 0) {
        response += productos.map(p => `*${p.sku}* - ${p.nombreCorto} - ${p.precioVenta}`).join(' ');
        response += 'Para ordenar, envía un mensaje con: *SKU Cantidad* Ejemplo: *PROD01 2*Escribe *ver carrito* para ver tu compra o *pedido* para finalizar.';
      } else {
        response += 'Actualmente no tenemos productos en el catálogo.';
      }
      await this.sendMessage(userJid, response);
    } else {
      const empresas = await this.empresasService.findAll();
      let response = 'Hola, bienvenido. Por favor, elige una de nuestras empresas respondiendo con su código:';
      response += empresas.map(e => `*${e.code}* - ${e.nombre}`).join(' ');
      await this.sendMessage(userJid, response);
    }
  }

  private async handleOrdering(userJid: string, session: UserSession, messageText: string) {
    const orderRegex = /^(\S+)\s+(\d+)$/; // SKU Cantidad
    const match = messageText.match(orderRegex);

    if (match) {
      const [, sku, quantityStr] = match;
      const quantity = parseInt(quantityStr, 10);
      
      const producto = await this.productosService.findOneBySkuAndEmpresa(sku.toUpperCase(), session.company!.id);
      if (producto) {
        session.cart.set(producto.sku, { quantity, precioVenta: producto.precioVenta, nombreCorto: producto.nombreCorto });
        await this.sendMessage(userJid, `✅ Añadido al carrito: ${quantity} x ${producto.nombreCorto}.Escribe 'ver carrito' para revisar o 'pedido' para finalizar.`);
      } else {
        await this.sendMessage(userJid, `❌ No encontramos el producto con SKU "${sku.toUpperCase()}". Por favor, verifica el código.`);
      }
    } else {
      await this.sendMessage(userJid, "No entendí tu mensaje. Para ordenar, usa el formato *SKU Cantidad* (ej: *PROD01 2*). Escribe *pedido* para finalizar.");
    }
  }

  private async handleShowCart(userJid: string, session: UserSession) {
    if (session.cart.size === 0) {
      await this.sendMessage(userJid, 'Tu carrito está vacío.');
      return;
    }

    let total = 0;
    const cartItems = [];
    for (const [sku, item] of session.cart.entries()) {
      const subtotal = item.quantity * item.precioVenta;
      cartItems.push(`${item.quantity} x ${item.nombreCorto} (*${sku}*) - ${subtotal.toFixed(2)}`);
      total += subtotal;
    }

    const cartContent = `🛒 *Tu Carrito:*${cartItems.join(' ')}

*Total: ${total.toFixed(2)}*

Escribe *pedido* para confirmar o *cancelar* para reiniciar.`;

    await this.sendMessage(userJid, cartContent);
  }

  private async handleCreateOrder(userJid: string, session: UserSession) {
    if (session.cart.size === 0) {
      await this.sendMessage(userJid, 'No puedes crear un pedido con el carrito vacío.');
      return;
    }

    const empresa = await this.empresasService.findOneByCode(session.company!.code);
    if (!empresa) {
        await this.sendMessage(userJid, 'Hubo un error al procesar tu pedido. La empresa no fue encontrada.');
        return;
    }
    
    // Busca o crea al cliente
    const cliente = await this.clientesService.findOrCreateByWhatsApp(userJid);

    const items = Array.from(session.cart.entries()).map(([sku, item]) => ({
        sku: sku,
        cantidad: item.quantity,
    }));

    const total = Array.from(session.cart.values()).reduce((sum, item) => sum + (item.quantity * item.precioVenta), 0);

    const pedidoDto: CreatePedidoDto = {
      clienteId: cliente._id.toString(),
      empresaId: empresa._id.toString(),
      items: items,
      totalPrecio: total,
    };

    try {
      await this.pedidosService.create(pedidoDto);
      // La notificación a la empresa debe ser manejada dentro de pedidosService.create
      
      await this.sendMessage(userJid, empresa.saludoDespedida || '¡Gracias por tu compra! Hemos recibido tu pedido y lo estamos procesando.');
      
      // Limpiar sesión
      this.sessions.delete(userJid);

    } catch (error) {
      this.logger.error(`Error creating order for ${userJid}:`, error);
      await this.sendMessage(userJid, 'Tuvimos un problema al registrar tu pedido. Por favor, intenta de nuevo más tarde.');
    }
  }

  async sendMessage(to: string, message: string): Promise<void> {
    this.logger.log(`Sending message to ${to}: "${message}"`);
    await this.whatsAppProvider.sendMessage(to, message);
  }
}
