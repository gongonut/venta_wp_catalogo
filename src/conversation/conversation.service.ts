
import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { GenericMessage } from '../whatsapp/providers/whatsapp-provider.interface';
import { EmpresasService } from '../empresas/empresas.service';
import { ProductosService } from '../productos/productos.service';
import { ClientesService } from '../clientes/clientes.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { CreatePedidoDto } from '../pedidos/dto/create-pedido.dto';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SessionsService } from '../sessions/sessions.service';
import { UserSessionDocument } from '../sessions/schemas/session.schema';

@Injectable()
export class ConversationService implements OnModuleInit {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    private readonly sessionsService: SessionsService,
    private readonly empresasService: EmpresasService,
    private readonly productosService: ProductosService,
    private readonly clientesService: ClientesService,
    private readonly pedidosService: PedidosService,
  ) {}

  onModuleInit() {
    this.logger.log('ConversationService initialized for persistent sessions.');
  }

  public async handleIncomingMessage(message: GenericMessage) {
    this.logger.debug(`Processing message from ${message.from} via session ${message.sessionId}: "${message.text}"`);
    const userJid = message.from;
    const messageText = message.text.trim().toLowerCase();

    const session = await this.sessionsService.findOrCreate(userJid, message.sessionId);

    switch (session.state) {
      case 'selecting_company':
        await this.handleCompanySelection(userJid, session, messageText);
        break;
      case 'selecting_category':
        await this.handleCategorySelection(userJid, session, messageText);
        break;
      case 'browsing_products':
        switch (messageText) {
          case 'pedido':
            await this.handleCreateOrder(userJid, session);
            break;
          case 'ver carrito':
            await this.handleShowCart(userJid, session);
            break;
          case 'cancelar':
            await this.resetSession(userJid, session);
            break;
          case 'categorias':
            await this.showCategories(userJid, session);
            break;
          default:
            await this.handleOrdering(userJid, session, messageText);
            break;
        }
        break;
    }
    
    // Guardar todos los cambios en la sesión al final del procesamiento
    await session.save();
  }

  private async resetSession(userJid: string, session: UserSessionDocument, sendMessage = true) {
    const oldSessionId = session.sessionId;
    session.company = undefined;
    session.cart = [];
    session.state = 'selecting_company';
    session.availableCategories = [];

    if (sendMessage) {
      await this.sendMessage(userJid, oldSessionId, 'Sesión reiniciada. Para comenzar, elige una empresa de la lista.');
      await this.handleCompanySelection(userJid, session, '');
    }
  }

  private async showCategories(userJid: string, session: UserSessionDocument) {
    if (!session.availableCategories || session.availableCategories.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'No hay categorías definidas para esta empresa.');
      session.state = 'browsing_products';
      return;
    }
    session.state = 'selecting_category';
    const categoryList = session.availableCategories.map(c => `*${c}*`).join('\n');
    const response = `Por favor, elige una categoría:
${categoryList}

Escribe *cancelar* para reiniciar la sesión.`;
    await this.sendMessage(userJid, session.sessionId, response);
  }

  private async handleCompanySelection(userJid: string, session: UserSessionDocument, messageText: string) {
    const empresa = await this.empresasService.findOneByCode(messageText);

    if (empresa) {
      session.company = { code: empresa.code, id: empresa._id.toString() };
      await this.sendMessage(userJid, session.sessionId, empresa.saludoBienvenida || `¡Bienvenido a ${empresa.nombre}!`);

      const categories = await this.productosService.findCategoriesByEmpresa(session.company.id);

      if (categories && categories.length > 0) {
        session.availableCategories = categories;
        await this.showCategories(userJid, session);
      } else {
        session.state = 'browsing_products';
        const productos = await this.productosService.findAllByEmpresa(session.company.id);
        let response = `Nuestro catálogo es:
`;
        if (productos.length > 0) {
          response += productos.map(p => `*${p.sku}* - ${p.nombreCorto} - ${p.precioVenta}`).join(`
`);
          response += `

Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)
Escribe *ver carrito* o *pedido* para finalizar.`;
        } else {
          response += `Actualmente no tenemos productos en el catálogo.`;
        }
        await this.sendMessage(userJid, session.sessionId, response);
      }
    } else {
      const empresas = await this.empresasService.findAll();
      let response = `Hola, bienvenido. Por favor, elige una de nuestras empresas respondiendo con su código:
`;
      response += empresas.map(e => `*${e.code}* - ${e.nombre}`).join(`
`);
      await this.sendMessage(userJid, session.sessionId, response);
    }
  }

  private async handleCategorySelection(userJid: string, session: UserSessionDocument, messageText: string) {
    const chosenCategory = session.availableCategories?.find(c => c.toLowerCase() === messageText);

    if (chosenCategory) {
      session.state = 'browsing_products';
      const productos = await this.productosService.findAllByEmpresaAndCategory(session.company!.id, chosenCategory);

      let response = `Aquí están los productos de la categoría *${chosenCategory}*:

`;
      if (productos.length > 0) {
        response += productos.map(p => `*${p.sku}* - ${p.nombreCorto} - ${p.precioVenta}`).join('\n');
        response += '\n\nPara ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)\n\nEscribe *categorias* para volver a la lista de categorías, *ver carrito* para revisar tu compra, o *pedido* para finalizar.';
      } else {
        response += 'No hay productos en esta categoría. Escribe *categorias* para volver a la lista.';
      }
      await this.sendMessage(userJid, session.sessionId, response);
    } else if (messageText === 'cancelar') {
      await this.resetSession(userJid, session);
    } else {
      await this.sendMessage(userJid, session.sessionId, 'Categoría no válida. Por favor, elige una de la lista o escribe *cancelar* para reiniciar.');
    }
  }

  private async handleOrdering(userJid: string, session: UserSessionDocument, messageText: string) {
    const orderRegex = /^(\S+)\s+(\d+)$/;
    const match = messageText.match(orderRegex);

    if (match) {
      const [, sku, quantityStr] = match;
      const quantity = parseInt(quantityStr, 10);

      const producto = await this.productosService.findOneBySkuAndEmpresa(sku.toUpperCase(), session.company!.id);
      if (producto) {
        const existingItem = session.cart.find(item => item.sku === producto.sku);
        if (existingItem) {
          existingItem.quantity = quantity;
        } else {
          session.cart.push({
            sku: producto.sku, 
            quantity, 
            precioVenta: producto.precioVenta, 
            nombreCorto: producto.nombreCorto 
          });
        }
        await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${producto.nombreCorto}.
Escribe *ver carrito* para revisar o *pedido* para finalizar.`);
      } else {
        await this.sendMessage(userJid, session.sessionId, `❌ No encontramos el producto con SKU "${sku.toUpperCase()}". Por favor, verifica el código.`);
      }
    } else {
      await this.sendMessage(userJid, session.sessionId, "No entendí tu mensaje. Para ordenar, usa el formato *SKU Cantidad* (ej: *PROD01 2*). También puedes escribir *categorias*, *ver carrito* o *pedido*.");
    }
  }

  private async handleShowCart(userJid: string, session: UserSessionDocument) {
    if (session.cart.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'Tu carrito está vacío.');
      return;
    }

    let total = 0;
    const cartItems = [];
    for (const item of session.cart) {
      const subtotal = item.quantity * item.precioVenta;
      cartItems.push(`${item.quantity} x ${item.nombreCorto} (*${item.sku}*) - ${subtotal.toFixed(2)}`);
      total += subtotal;
    }

    const cartContent = `🛒 *Tu Carrito:*
${cartItems.join('\n')}

*Total: ${total.toFixed(2)}*

Escribe *pedido* para confirmar o *cancelar* para reiniciar.`;

    await this.sendMessage(userJid, session.sessionId, cartContent);
  }

  private async handleCreateOrder(userJid: string, session: UserSessionDocument) {
    if (session.cart.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'No puedes crear un pedido con el carrito vacío.');
      return;
    }

    const empresa = await this.empresasService.findOneByCode(session.company!.code);
    if (!empresa) {
      await this.sendMessage(userJid, session.sessionId, 'Hubo un error al procesar tu pedido. La empresa no fue encontrada.');
      return;
    }

    const cliente = await this.clientesService.findOrCreateByWhatsApp(userJid);

    const items = session.cart.map(item => ({
      sku: item.sku,
      cantidad: item.quantity,
    }));

    const total = session.cart.reduce((sum, item) => sum + (item.quantity * item.precioVenta), 0);

    const pedidoDto: CreatePedidoDto = {
      clienteId: cliente._id.toString(),
      empresaId: empresa._id.toString(),
      items: items,
      totalPrecio: total,
    };

    try {
      await this.pedidosService.create(pedidoDto);
      
      await this.sendMessage(userJid, session.sessionId, empresa.saludoDespedida || '¡Gracias por tu compra! Hemos recibido tu pedido y lo estamos procesando.');
      
      // En lugar de borrar la sesión, la reseteamos para futuras compras
      await this.resetSession(userJid, session, false);

    } catch (error) {
      this.logger.error(`Error creating order for ${userJid}:`, error);
      await this.sendMessage(userJid, session.sessionId, 'Tuvimos un problema al registrar tu pedido. Por favor, intenta de nuevo más tarde.');
    }
  }

  async sendMessage(to: string, sessionId: string, message: string): Promise<void> {
    this.logger.log(`Sending message to ${to} via session ${sessionId}: "${message}"`);
    await this.whatsappService.sendMessage(sessionId, to, message);
  }
}
