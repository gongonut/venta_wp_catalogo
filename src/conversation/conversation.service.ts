import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { Button, GenericMessage } from '../whatsapp/providers/whatsapp-provider.interface';
import { EmpresasService } from '../empresas/empresas.service';

import { ClientesService } from '../clientes/clientes.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { CreatePedidoDto } from '../pedidos/dto/create-pedido.dto';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SessionsService } from '../sessions/sessions.service';
import { UserSessionDocument } from '../sessions/schemas/session.schema';

@Injectable()
export class ConversationService implements OnModuleInit {
  private readonly logger = new Logger(ConversationService.name);
  private sessionTimers = new Map<string, { warning: NodeJS.Timeout; termination: NodeJS.Timeout }>();

  constructor(
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    private readonly sessionsService: SessionsService,
    private readonly empresasService: EmpresasService,
    
    private readonly clientesService: ClientesService,
    private readonly pedidosService: PedidosService,
  ) {}

  onModuleInit() {
    this.logger.log('ConversationService initialized for persistent sessions.');
  }

  public async handleIncomingMessage(message: GenericMessage) {
    this.logger.debug(`Processing message from ${message.from} via session ${message.sessionId}: "${message.text}"`);
    const userJid = message.from;
    let messageText = message.text.trim().toLowerCase();

    if (messageText === 'borrar_sesiones_clientes_ahora') {
      const result = await this.sessionsService.clearAllSessions();
      await this.sendMessage(userJid, message.sessionId, `Se han eliminado ${result.deletedCount} sesiones de clientes.`);
      return;
    }

    this.resetInactivityTimer(userJid, message.sessionId);

    const session = await this.sessionsService.findOrCreate(userJid, message.sessionId);

    if (session.numberedOptions && session.numberedOptions[messageText]) {
      messageText = session.numberedOptions[messageText];
    }

    // Universal commands
    if (['cancelar', 'terminar', 'finalizar'].includes(messageText)) {
      await this.resetSession(userJid, session);
      await session.save();
      return;
    }

    if (['regresar', 'volver'].includes(messageText)) {
      if (session.state === 'browsing_products') {
        messageText = 'categorias'; // Alias to existing back command
      } else {
        await this.handleGoBack(userJid, session);
        await session.save();
        return;
      }
    }

    switch (session.state) {
      case 'selecting_company':
        await this.handleCompanySelection(userJid, session, messageText);
        break;
      case 'selecting_category':
        await this.handleCategorySelection(userJid, session, messageText);
        break;
      case 'browsing_products':
        const detailRegex = /^(de|detalle)\s+(\S+)/;
        const detailMatch = messageText.match(detailRegex);

        if (detailMatch) {
          const [, , itemIdentifier] = detailMatch; // Adjusted to get the second group
          await this.handleProductDetail(userJid, session, itemIdentifier);
          break;
        }

        switch (messageText) {
          case 'pedido':
            await this.handleCreateOrder(userJid, session);
            break;
          case 'ver carrito':
            await this.handleShowCart(userJid, session);
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
    
    await session.save();
  }

  private async resetSession(userJid: string, session: UserSessionDocument, sendMessage = true, message?: string) {
    const oldSessionId = session.sessionId;
    session.company = undefined;
    session.cart = [];
    session.state = 'selecting_company';
    session.availableCategories = [];
    session.numberedOptions = {};

    if (this.sessionTimers.has(userJid)) {
      const timers = this.sessionTimers.get(userJid);
      clearTimeout(timers.warning);
      if (timers.termination) clearTimeout(timers.termination);
      this.sessionTimers.delete(userJid);
    }

    if (sendMessage) {
      const resetMessage = message || 'Sesión reiniciada. Para comenzar, elige una empresa.';
      await this.sendMessage(userJid, oldSessionId, resetMessage);
      if (!message) { // Only show company selection on manual reset
        await this.handleCompanySelection(userJid, session, '');
      }
    }
  }

  private resetInactivityTimer(userJid: string, sessionId: string) {
    if (this.sessionTimers.has(userJid)) {
      const timers = this.sessionTimers.get(userJid);
      clearTimeout(timers.warning);
      if (timers.termination) clearTimeout(timers.termination);
    }

    const warningTimer = setTimeout(() => {
      this.sendInactivityWarning(userJid, sessionId);
    }, 5 * 60 * 1000); // 5 minutes

    this.sessionTimers.set(userJid, { warning: warningTimer, termination: null });
  }

  private async sendInactivityWarning(userJid: string, sessionId: string) {
    await this.sendMessage(userJid, sessionId, 'Tu sesión está a punto de cerrarse por inactividad. Envía cualquier mensaje para mantenerla activa.');

    const terminationTimer = setTimeout(() => {
      this.endInactiveSession(userJid, sessionId);
    }, 2 * 60 * 1000); // 2 minutes

    const timers = this.sessionTimers.get(userJid);
    if (timers) {
        this.sessionTimers.set(userJid, { ...timers, termination: terminationTimer });
    }
  }

  private async endInactiveSession(userJid: string, sessionId: string) {
    const session = await this.sessionsService.findOrCreate(userJid, sessionId);
    if (session) {
        await this.resetSession(userJid, session, true, 'Tu sesión ha sido cerrada por inactividad.');
        await session.save();
        this.logger.log(`Session for ${userJid} terminated due to inactivity.`);
    }
    this.sessionTimers.delete(userJid);
  }

  private async handleGoBack(userJid: string, session: UserSessionDocument) {
    if (session.state === 'selecting_category') {
        session.state = 'selecting_company';
        session.numberedOptions = {};
        session.availableCategories = [];
        session.company = undefined;
        await this.handleCompanySelection(userJid, session, '');
    } else {
        await this.sendMessage(userJid, session.sessionId, "No hay un menú anterior al que regresar.");
    }
  }

  private async handleProductDetail(userJid: string, session: UserSessionDocument, itemIdentifier: string) {
    let sku: string | undefined;

    if (session.numberedOptions && session.numberedOptions[itemIdentifier]) {
      sku = session.numberedOptions[itemIdentifier];
    } else {
      sku = itemIdentifier.toUpperCase();
    }

    const producto = await this.empresasService.findProductBySku(session.company!.id, sku);

    if (producto) {
      await this.sendMessage(userJid, session.sessionId, producto.nombreLargo || producto.nombreCorto);
      if (producto.fotos && producto.fotos.length > 0) {
        await this.sendMessage(userJid, session.sessionId, "Fotos del producto:");
        for (const fotoUrl of producto.fotos) {
          await this.sendMessage(userJid, session.sessionId, fotoUrl);
        }
      }
    } else {
      await this.sendMessage(userJid, session.sessionId, `No se encontró el producto con identificador "${itemIdentifier}".`);
    }
  }

  private async showCategories(userJid: string, session: UserSessionDocument) {
    const categories = session.availableCategories;
    if (!categories || categories.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'No hay categorías definidas para esta empresa.');
      session.state = 'browsing_products';
      return;
    }

    session.state = 'selecting_category';
    session.numberedOptions = {};
    const text = 'Por favor, elige una categoría:';

    const categoryList = categories.map((c, index) => {
      const number = index + 1;
      session.numberedOptions[number] = c.toLowerCase();
      return `*${number}*. ${c}`;
    }).join('\n');

    await this.sendMessage(userJid, session.sessionId, `${text}\n${categoryList}`);

    session.numberedOptions['re'] = 'regresar';
    const footer = `Escribe *cancelar* para reiniciar.\n\nOpciones:\n*RE*. Regresar a empresas`;

    const response = `${footer}\n\nEscribe el número de la categoría o el código de la opción.`;
    await this.sendMessage(userJid, session.sessionId, response);
  }

  private async handleCompanySelection(userJid: string, session: UserSessionDocument, messageText: string) {
    const empresa = await this.empresasService.findOneByName(messageText);

    if (empresa) {
      session.numberedOptions = {};
      session.company = { code: empresa.code, id: empresa._id.toString() };
      await this.sendMessage(userJid, session.sessionId, empresa.saludoBienvenida || `¡Bienvenido a ${empresa.nombre}!`);

      const categories = await this.empresasService.findProductCategories(session.company.id);
      if (categories && categories.length > 0) {
        session.availableCategories = categories;
        await this.showCategories(userJid, session);
      } else {
        session.state = 'browsing_products';
        const productos = await this.empresasService.findAllProducts(session.company.id);
        const productosEnStock = productos.filter(p => p.existencia > 0);

        if (productosEnStock.length > 0) {
          const productList = productosEnStock.map(p => `*${p.sku}* - ${p.nombreCorto} - ${p.precioVenta}`).join('\n');
          await this.sendMessage(userJid, session.sessionId, `Nuestro catálogo es:\n${productList}`);

          const orderingInstructions = `Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)
`;
          await this.sendMessage(userJid, session.sessionId, orderingInstructions);

          session.numberedOptions['vc'] = 'ver carrito';
          session.numberedOptions['fp'] = 'pedido';
          const optionsMessage = `Opciones:\n*DE*. Ver Detalle (ej: DE SKU)\n*VC*. Ver carrito\n*FP*. Finalizar pedido\n\nEscribe *cancelar* para reiniciar.`;
          await this.sendMessage(userJid, session.sessionId, optionsMessage);
        } else {
          await this.sendMessage(userJid, session.sessionId, 'Actualmente no tenemos productos en el catálogo.');
        }
      }
    } else {
      const empresas = await this.empresasService.findAll();
      const text = 'Hola, bienvenido. Por favor, elige una de nuestras empresas:';
      session.numberedOptions = {};

      if (empresas.length > 0 && empresas.length <= 3) {
        const buttons: Button[] = empresas.map(e => ({ id: e.nombre, text: e.nombre }));
        await this.sendButtons(userJid, session.sessionId, text, 'Escribe *cancelar*, *terminar* o *finalizar* para reiniciar', buttons);
      } else if (empresas.length > 3) {
        const companyList = empresas.map((e, index) => {
            const number = index + 1;
            session.numberedOptions[number] = e.nombre.toLowerCase();
            return `*${number}*. ${e.nombre}`;
        }).join('\n');
        await this.sendMessage(userJid, session.sessionId, `${text}\n${companyList}`);
        await this.sendMessage(userJid, session.sessionId, `Escribe el número de la empresa que deseas o *cancelar* / *terminar* / *finalizar* para reiniciar.`);
      } else {
        await this.sendMessage(userJid, session.sessionId, `${text}\nNo hay empresas configuradas.`);
      }
    }
  }

  private async handleCategorySelection(userJid: string, session: UserSessionDocument, messageText: string) {
    const chosenCategory = session.availableCategories?.find(c => c.toLowerCase() === messageText);

    if (chosenCategory) {
      session.state = 'browsing_products';
      session.numberedOptions = {};
      const productos = await this.empresasService.findProductsByCategory(session.company!.id, chosenCategory);
      const productosEnStock = productos.filter(p => p.existencia > 0);

      let productList = `Aquí están los productos de la categoría *${chosenCategory}*:\n\n`;
      
      if (productosEnStock.length > 0) {
        if (productosEnStock.length > 3) {
            productList += productosEnStock.map((p, index) => {
                const number = index + 1;
                session.numberedOptions[number] = p.sku;
                return `*${number}*. ${p.nombreCorto} - ${p.precioVenta}`;
            }).join('\n');
            await this.sendMessage(userJid, session.sessionId, productList);
            await this.sendMessage(userJid, session.sessionId, 'Para ordenar, envía: *Número Cantidad* (ej: *1 2*)');
        } else {
            productList += productosEnStock.map(p => `*${p.sku}* - ${p.nombreCorto} - ${p.precioVenta}`).join('\n');
            await this.sendMessage(userJid, session.sessionId, productList);
            await this.sendMessage(userJid, session.sessionId, 'Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)');
        }

        session.numberedOptions['rc'] = 'categorias';
        session.numberedOptions['vc'] = 'ver carrito';
        session.numberedOptions['fp'] = 'pedido';
        const optionsMessage = `Opciones:\n*DE*. Ver Detalle (ej: DE 1)\n*RC*. Volver a categorías (o escribe *regresar*)\n*VC*. Ver carrito\n*FP*. Finalizar pedido\n\nEscribe *cancelar* para reiniciar.`;
        await this.sendMessage(userJid, session.sessionId, optionsMessage);
      } else {
        await this.sendMessage(userJid, session.sessionId, `No hay productos en esta categoría.`);
        const optionsMessage = 'Escribe *RC*, *categorias* o *regresar* para volver a la lista.';
        await this.sendMessage(userJid, session.sessionId, optionsMessage);
      }
    } else {
      await this.sendMessage(userJid, session.sessionId, 'Categoría no válida. Por favor, elige una de la lista o escribe *cancelar*, *terminar* o *finalizar*.');
      await this.showCategories(userJid, session);
    }
  }

  private async handleOrdering(userJid: string, session: UserSessionDocument, messageText: string) {
    const orderRegex = /^(\S+)\s+(\d+)$/;
    const match = messageText.match(orderRegex);

    if (match) {
      let [, itemIdentifier, quantityStr] = match;
      const quantity = parseInt(quantityStr, 10);
      let sku: string | undefined;

      if (session.numberedOptions && session.numberedOptions[itemIdentifier]) {
        sku = session.numberedOptions[itemIdentifier];
      } else {
        sku = itemIdentifier.toUpperCase();
      }

      const producto = await this.empresasService.findProductBySku(session.company!.id, sku);
      
      if (producto) {
        const existingItem = session.cart.find(item => item.sku === producto.sku);
        if (existingItem) {
          existingItem.quantity = quantity;
        } else {
          session.cart.push({ sku: producto.sku, quantity, precioVenta: producto.precioVenta, nombreCorto: producto.nombreCorto });
        }
        await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${producto.nombreCorto}.`);
        
        session.numberedOptions['rc'] = 'categorias';
        session.numberedOptions['vc'] = 'ver carrito';
        session.numberedOptions['fp'] = 'pedido';
        const optionsMessage = `Opciones:\n*DE*. Ver Detalle (ej: DE 1)\n*RC*. Volver a categorías (o escribe *regresar*)\n*VC*. Ver carrito\n*FP*. Finalizar pedido\n\nPara agregar otro producto, usa el formato *SKU/Número Cantidad*. O escribe *cancelar* para reiniciar.`;
        await this.sendMessage(userJid, session.sessionId, optionsMessage);

      } else {
        await this.sendMessage(userJid, session.sessionId, `❌ No encontramos el producto con código "${itemIdentifier.toUpperCase()}". Por favor, verifica el código.`);
      }
    } else {
      session.numberedOptions['rc'] = 'categorias';
      session.numberedOptions['vc'] = 'ver carrito';
      session.numberedOptions['fp'] = 'pedido';
      await this.sendMessage(userJid, session.sessionId, "No entendí tu mensaje. Para ordenar, usa el formato *SKU/Número Cantidad*.");
      const optionsMessage = `Opciones:\n*DE*. Ver Detalle (ej: DE 1)\n*RC*. Volver a categorías (o escribe *regresar*)\n*VC*. Ver carrito\n*FP*. Finalizar pedido\n\nO escribe *cancelar* para reiniciar.`;
      await this.sendMessage(userJid, session.sessionId, optionsMessage);
    }
  }

  private async handleShowCart(userJid: string, session: UserSessionDocument) {
    if (session.cart.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'Tu carrito está vacío.');
      return;
    }
    let total = 0;
    const cartItems = session.cart.map(item => {
      const subtotal = item.quantity * item.precioVenta;
      total += subtotal;
      return `${item.quantity} x ${item.nombreCorto} (*${item.sku}*) - ${subtotal.toFixed(2)}`;
    });
    const cartContent = `🛒 *Tu Carrito:*
${cartItems.join('\n')}\n\n*Total: ${total.toFixed(2)}*`;
    await this.sendMessage(userJid, session.sessionId, cartContent);

    session.numberedOptions['rc'] = 'categorias';
    session.numberedOptions['fp'] = 'pedido';
    const optionsMessage = `Opciones:\n*RC*. Volver a categorías (o escribe *regresar*)\n*FP*. Confirmar pedido\n\nEscribe *cancelar* para reiniciar.`;
    await this.sendMessage(userJid, session.sessionId, optionsMessage);
  }

  private async handleCreateOrder(userJid: string, session: UserSessionDocument) {
    if (session.cart.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'No puedes crear un pedido con el carrito vacío.');
      return;
    }
    const empresa = await this.empresasService.findOne(session.company!.id);
    if (!empresa) {
      await this.sendMessage(userJid, session.sessionId, 'Hubo un error al procesar tu pedido. La empresa no fue encontrada.');
      return;
    }
    const cliente = await this.clientesService.findOrCreateByWhatsApp(userJid);
    const items = session.cart.map(item => ({ sku: item.sku, cantidad: item.quantity }));
    const total = session.cart.reduce((sum, item) => sum + (item.quantity * item.precioVenta), 0);
    const pedidoDto: CreatePedidoDto = {
      clienteId: cliente._id.toString(),
      empresaId: empresa._id.toString(),
      items: items,
      totalPrecio: total,
    };
    try {
      await this.pedidosService.create(pedidoDto);

      for (const item of pedidoDto.items) {
        await this.empresasService.decreaseStock(session.company!.id, item.sku, item.cantidad);
      }

      await this.sendMessage(userJid, session.sessionId, empresa.saludoDespedida || '¡Gracias por tu compra! Hemos recibido tu pedido y lo estamos procesando.');
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

  async sendButtons(to: string, sessionId: string, text: string, footer: string, buttons: Button[]): Promise<void> {
    this.logger.log(`Sending buttons to ${to} via session ${sessionId}: "${text}"`);
    await this.whatsappService.sendButtonsMessage(sessionId, to, text, footer, buttons);
  }
}
