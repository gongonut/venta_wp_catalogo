import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientesService } from '../clientes/clientes.service';
import { EmpresasService } from '../empresas/empresas.service';
import { CreatePedidoDto } from '../pedidos/dto/create-pedido.dto';
import { PedidosService } from '../pedidos/pedidos.service';
import { UserSessionDocument } from '../sessions/schemas/session.schema';
import { SessionsService } from '../sessions/sessions.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { COMMANDS, ConversationState } from './conversation.constants';
import * as prompts from './conversation.prompts';
import { WAMessage } from '@whiskeysockets/baileys';

@Injectable()
export class ConversationService implements OnModuleInit {
  private readonly logger = new Logger(ConversationService.name);
  private sessionTimers = new Map<string, { warning: NodeJS.Timeout; termination: NodeJS.Timeout }>();
  private commandMap: Map<string, keyof typeof COMMANDS>;

  constructor(
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    private readonly sessionsService: SessionsService,
    private readonly empresasService: EmpresasService,
    private readonly clientesService: ClientesService,
    private readonly pedidosService: PedidosService,
    private readonly configService: ConfigService,
  ) {
    this.commandMap = new Map();
    for (const key in COMMANDS) {
      const commandKey = key as keyof typeof COMMANDS;
      this.commandMap.set(COMMANDS[commandKey].mnemonic, commandKey);
    }
  }

  onModuleInit() {
    this.logger.log('ConversationService initialized.');
  }

  public async handleIncomingMessage(message: { from: string; sessionId: string; text: string; originalMessage: any; }) {
    try {
      this.logger.debug(`Processing message from ${message.from} via session ${message.sessionId}: "${message.text}"`);
      const userJid = message.from;
      let messageText = message.text.trim().toLowerCase();

      // Handle vendor replies
      const vendorReply = await this.handleVendorReply(message);
      if (vendorReply) {
        return;
      }

      if (messageText === 'borrar_sesiones_clientes_ahora') {
        const result = await this.sessionsService.clearAllSessions();
        const count = result.deletedCount || 0;
        await this.sendMessage(userJid, message.sessionId, `Se han borrado ${count} sesiones.`);
        this.logger.log(`All sessions deleted by user command from ${userJid}. Count: ${count}`);
        return;
      }

      this.resetInactivityTimer(userJid, message.sessionId);

      const session = await this.sessionsService.findOrCreate(userJid, message.sessionId);

      // Resolve numbered options first
      if (session.numberedOptions && session.numberedOptions[messageText]) {
        messageText = session.numberedOptions[messageText];
      }

      const command = this.commandMap.get(messageText);

      // Universal commands
      if (command) {
        if (command === 'CANCEL' || command === 'FINISH' || command === 'END') {
          await this.resetSession(userJid, session);
          await session.save();
          return;
        }
        if (command === 'GO_BACK') {
          await this.handleGoBack(userJid, session);
          await session.save();
          return;
        }
        if (command === 'REPEAT_MENU') {
          await this.handleRepeatMenu(userJid, session);
          await session.save();
          return;
        }
      }

      await this.processState(session, userJid, messageText, command);
      await session.save();
    } catch (error) {
      this.logger.error(`Error processing message from ${message.from}: ${error.stack}`);
      await this.sendMessage(message.from, message.sessionId, 'Lo sentimos, ocurrió un error al procesar tu mensaje.');
    }
  }

  private async processState(session: UserSessionDocument, userJid: string, messageText: string, command: keyof typeof COMMANDS | undefined) {
    switch (session.state) {
      case ConversationState.SELECTING_COMPANY:
        await this.handleCompanySelection(userJid, session, messageText);
        break;
      case ConversationState.SELECTING_CATEGORY:
        await this.handleCategorySelection(userJid, session, messageText, command);
        break;
      case ConversationState.BROWSING_PRODUCTS:
        await this.handleProductBrowsing(userJid, session, messageText, command);
        break;
      case ConversationState.AWAITING_PRODUCT_ACTION:
        await this.handleAwaitingProductAction(userJid, session, messageText, command);
        break;
      case ConversationState.AWAITING_QUANTITY_FOR_PRODUCT:
        await this.handleAwaitingQuantityForProduct(userJid, session, messageText);
        break;
      case ConversationState.AWAITING_CUSTOMER_DATA:
        await this.handleAwaitingCustomerData(userJid, session, messageText);
        break;
      case ConversationState.CHATTING:
        await this.handleChatting(userJid, session, messageText, command);
        break;
      default:
        this.logger.warn(`Unhandled state: ${session.state}`);
        await this.resetSession(userJid, session, true, 'Estado no reconocido, reiniciando sesión.');
        break;
    }
  }
  
  private async handleCompanySelection(userJid: string, session: UserSessionDocument, messageText: string) {
    let empresa;
    try {
      empresa = await this.empresasService.findOneByName(messageText);
    } catch (error) {
      this.logger.error(`Error finding company by name "${messageText}": ${error.stack}`);
    }

    if (empresa) {
      session.company = { code: empresa.code, id: empresa._id.toString(), name: empresa.nombre };
      await this.sendMessage(userJid, session.sessionId, empresa.saludoBienvenida || `¡Bienvenido a ${empresa.nombre}!`);
      
      const categories = await this.empresasService.findProductCategories(session.company.id);
      if (categories && categories.length > 0) {
        session.availableCategories = categories;
        await this.showCategories(userJid, session);
      } else {
        await this.showAllProducts(userJid, session);
      }
    } else {
      const empresas = await this.empresasService.findAll();
      if (empresas.length > 0) {
        const prompt = prompts.buildCompanyListPrompt(empresas);
        session.numberedOptions = {};
        empresas.forEach((e, i) => {
          session.numberedOptions[i + 1] = e.nombre.toLowerCase();
        });
        await this.sendMessage(userJid, session.sessionId, prompt);
        await this.sendMessage(userJid, session.sessionId, prompts.buildGeneralOptionsPrompt());
      } else {
        await this.sendMessage(userJid, session.sessionId, 'No hay empresas configuradas.');
      }
    }
  }

  private async showCategories(userJid: string, session: UserSessionDocument) {
    const categories = session.availableCategories;
    if (!categories || categories.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'No hay categorías definidas.');
      await this.showAllProducts(userJid, session);
      return;
    }

    session.state = ConversationState.SELECTING_CATEGORY;
    const prompt = prompts.buildCategoryListPrompt(categories);
    session.numberedOptions = {};
    categories.forEach((c, i) => {
      session.numberedOptions[i + 1] = c.toLowerCase();
    });
    
    await this.sendMessage(userJid, session.sessionId, prompt);
    const optionsPrompt = prompts.buildOptionsPrompt([
      { command: 'CHAT' },
      { command: 'RETURN_TO_COMPANIES' },
      { command: 'REPEAT_MENU' },
      { command: 'CANCEL' },
    ]);
    await this.sendMessage(userJid, session.sessionId, optionsPrompt);
  }
  
  private async handleCategorySelection(userJid: string, session: UserSessionDocument, messageText: string, command: keyof typeof COMMANDS | undefined) {
    if (command === 'CHAT') {
      await this.startChatting(userJid, session);
      return;
    }
    if (command === 'FINALIZE_ORDER') {
        await this.handleCreateOrder(userJid, session);
        return;
    }
    if (command === 'RETURN_TO_COMPANIES') {
        await this.resetSession(userJid, session, true, 'Regresando a la selección de empresas.');
        return;
    }

    const chosenCategory = session.availableCategories?.find(c => c.toLowerCase() === messageText);

    if (chosenCategory) {
        session.state = ConversationState.BROWSING_PRODUCTS;
        session.numberedOptions = {};
        const productos = await this.empresasService.findProductsByCategory(session.company!.id, chosenCategory);
        const instruction = `Para ordenar, envía: *SKU [presentación] Cantidad* (ej: *PROD01 [50g] 2*)`;
        const prompt = prompts.buildProductListPrompt(productos, instruction, false, 'No hay productos en esta categoría.');
        await this.sendMessage(userJid, session.sessionId, prompt);
        
        const optionsPrompt = prompts.buildOptionsPrompt([
            { command: 'CHAT' },
            { command: 'DETAIL', customDescription: 'Ver Detalle (ej: de SKU)' },
            { command: 'RETURN_TO_CATEGORIES' },
            { command: 'VIEW_CART' },
            { command: 'FINALIZE_ORDER' },
            { command: 'REPEAT_MENU' },
            { command: 'CANCEL' },
        ]);
        await this.sendMessage(userJid, session.sessionId, optionsPrompt);
    } else {
        await this.sendMessage(userJid, session.sessionId, 'Categoría no válida. Por favor, elige una de la lista.');
        await this.showCategories(userJid, session);
    }
  }

  private async showAllProducts(userJid: string, session: UserSessionDocument) {
    session.state = ConversationState.BROWSING_PRODUCTS;
    const productos = await this.empresasService.findAllProducts(session.company!.id);
    const instruction = `Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)`;
    const prompt = prompts.buildProductListPrompt(productos, instruction);
    await this.sendMessage(userJid, session.sessionId, prompt);

    const optionsPrompt = prompts.buildOptionsPrompt([
        { command: 'CHAT' },
        { command: 'DETAIL', customDescription: 'Ver Detalle (ej: de SKU)' },
        { command: 'VIEW_CART' },
        { command: 'FINALIZE_ORDER' },
        { command: 'REPEAT_MENU' },
        { command: 'CANCEL' },
    ]);
    await this.sendMessage(userJid, session.sessionId, optionsPrompt);
  }

  private async handleProductBrowsing(userJid: string, session: UserSessionDocument, messageText: string, command: keyof typeof COMMANDS | undefined) {
    const parts = messageText.split(/\s+/);
    const firstPart = parts[0];

    if (command) {
        switch (command) {
            case 'CHAT':
                await this.startChatting(userJid, session);
                return;
            case 'CREATE_ORDER':
            case 'FINALIZE_ORDER':
                await this.handleCreateOrder(userJid, session);
                return;
            case 'VIEW_CART':
                await this.handleShowCart(userJid, session);
                return;
            case 'RETURN_TO_CATEGORIES':
                await this.showCategories(userJid, session);
                return;
            case 'DETAIL':
                await this.sendMessage(userJid, session.sessionId, 'Por favor, indica el SKU del producto que quieres ver (ej: de 001).');
                return;
        }
    }

    if (firstPart === COMMANDS.DETAIL.mnemonic && parts.length > 1) {
        const itemIdentifier = parts[1];
        await this.handleProductDetail(userJid, session, itemIdentifier);
        return;
    }

    // Default to ordering
    await this.handleOrdering(userJid, session, messageText);
  }

  private async handleProductDetail(userJid: string, session: UserSessionDocument, itemIdentifier: string) {
    const sku = session.numberedOptions[itemIdentifier] || itemIdentifier.toUpperCase();
    const producto = await this.empresasService.findProductBySku(session.company!.id, sku);

    if (producto) {
        session.pendingProduct = {
            sku: producto.sku,
            nombreCorto: producto.nombreCorto,
            precioVenta: producto.precioVenta,
            existencia: producto.existencia,
            presentacion: producto.presentacion,
        };
        session.state = ConversationState.AWAITING_PRODUCT_ACTION;
        session.numberedOptions = {};

        const detailPrompt = prompts.buildProductDetailPrompt(producto);

        const hasPresentations = producto.presentacion && producto.presentacion.size > 0;
        
        let orderInstruction = 'Para agregar al carrito, envía la cantidad (ej: *2*).';
        if (hasPresentations) {
            const presentations = Array.from(producto.presentacion.entries());
            const presentationList = presentations.map(([name, p], index) => {
                const optionNumber = index + 1;
                session.numberedOptions[optionNumber] = name;
                const price = `${p.precioventa.toFixed(2)}`;
                return p.existencia > 0
                  ? `*${optionNumber}*. ${name} (${price})`
                  : `~*${optionNumber}*. ${name}~ (Agotado)`;
              }).join('\n');

            const examplePresentation = presentations[0]?.[0] || 'presentacion';
            orderInstruction = `Para agregar, envía el número o nombre de la presentación y la cantidad (ej: *1 2* o *${examplePresentation} 2*).\n\nPresentaciones:\n${presentationList}`;
        }

        const otherOptions: { command: keyof typeof COMMANDS; customDescription?: string; }[] = [
            { command: 'CHAT' },
            { command: 'GO_BACK' },
            { command: 'RETURN_TO_CATEGORIES' },
            { command: 'VIEW_CART' },
            { command: 'FINALIZE_ORDER' },
            { command: 'REPEAT_MENU' },
            { command: 'CANCEL' },
        ];
        const optionsPrompt = prompts.buildOptionsPrompt(otherOptions);

        await this.sendMessage(userJid, session.sessionId, `${detailPrompt}\n\n${orderInstruction}`);
        await this.sendMessage(userJid, session.sessionId, optionsPrompt);
    } else {
        await this.sendMessage(userJid, session.sessionId, `No se encontró el producto con identificador "${itemIdentifier}".`);
    }
  }
  
  private async handleAwaitingProductAction(userJid: string, session: UserSessionDocument, messageText: string, command: keyof typeof COMMANDS | undefined) {
    const action = command || this.commandMap.get(messageText);
    if (!session.pendingProduct) {
        await this.resetSession(userJid, session, true, 'Error: No hay producto pendiente.');
        return;
    }
    
    if (!action) {
        // If no command is found, assume the user is specifying a quantity for the pending product.
        await this.handleAwaitingQuantityForProduct(userJid, session, messageText);
        return;
    }

    switch (action) {
        case 'CHAT':
            await this.startChatting(userJid, session);
            return;
        case 'GO_BACK':
            session.pendingProduct = undefined;
            await this.showCategories(userJid, session); // Or showAllProducts if no categories
            break;
        case 'VIEW_CART':
            await this.handleShowCart(userJid, session);
            // After showing cart, re-show the product detail prompt
            await this.handleProductDetail(userJid, session, session.pendingProduct.sku);
            break;
        case 'FINALIZE_ORDER':
            await this.handleCreateOrder(userJid, session);
            break;
        default:
             await this.sendMessage(userJid, session.sessionId, 'Opción no válida.');
             await this.handleProductDetail(userJid, session, session.pendingProduct.sku);
             break;
    }
  }

  private async handleAwaitingQuantityForProduct(userJid: string, session: UserSessionDocument, messageText: string) {
    if (messageText === COMMANDS.FINALIZE_ORDER.mnemonic) {
        await this.handleCreateOrder(userJid, session);
        return;
    }

    const { pendingProduct } = session;
    if (!pendingProduct) {
        await this.resetSession(userJid, session, true, 'Error: No hay producto pendiente.');
        return;
    }

    // Hotfix: Mongoose might return presentacion as an Object instead of a Map
    if (pendingProduct.presentacion && !(pendingProduct.presentacion instanceof Map)) {
        pendingProduct.presentacion = new Map(Object.entries(pendingProduct.presentacion));
    }

    const parts = messageText.split(/\s+/);
    let quantityStr: string;
    let presentationIdentifier: string | undefined;

    if (pendingProduct.presentacion && pendingProduct.presentacion.size > 0) {
        if (parts.length < 2) {
            await this.sendMessage(userJid, session.sessionId, 'Formato incorrecto. Envía la presentación y la cantidad (ej: *Grande 2* o *1 2*).');
            return;
        }
        quantityStr = parts[parts.length - 1];
        presentationIdentifier = parts.slice(0, -1).join(' ');
    } else {
        if (parts.length !== 1) {
            await this.sendMessage(userJid, session.sessionId, 'Formato incorrecto. Envía solo la cantidad (ej: *2*).');
            return;
        }
        quantityStr = parts[0];
    }

    const quantity = parseInt(quantityStr, 10);
    if (isNaN(quantity) || quantity <= 0) {
        await this.sendMessage(userJid, session.sessionId, 'Cantidad no válida. Debe ser un número mayor a 0.');
        return;
    }

    let presentationName = presentationIdentifier ? session.numberedOptions[presentationIdentifier] || presentationIdentifier : undefined;
    const selectedPresentation = presentationName ? pendingProduct.presentacion?.get(presentationName) : undefined;

    if (presentationIdentifier && !selectedPresentation) {
        await this.sendMessage(userJid, session.sessionId, `Presentación "${presentationIdentifier}" no válida.`);
        return;
    }

    const itemStock = selectedPresentation ? selectedPresentation.existencia : pendingProduct.existencia;
    if (itemStock < quantity) {
        await this.sendMessage(userJid, session.sessionId, `Stock insuficiente. Disponibles: ${itemStock}.`);
        return;
    }

    const existingItem = session.cart.find(item => item.sku === pendingProduct.sku && item.presentacion === presentationName);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        session.cart.push({
            sku: pendingProduct.sku,
            quantity,
            precioVenta: selectedPresentation ? selectedPresentation.precioventa : pendingProduct.precioVenta,
            nombreCorto: pendingProduct.nombreCorto,
            presentacion: presentationName,
        });
    }

    await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${pendingProduct.nombreCorto} ${presentationName ? `(${presentationName})` : ''}.`);
    
    session.state = ConversationState.BROWSING_PRODUCTS;
    session.pendingProduct = undefined;
    session.numberedOptions = {};

    const optionsPrompt = prompts.buildOptionsPrompt([
        { command: 'CHAT' },
        { command: 'VIEW_CART' },
        { command: 'FINALIZE_ORDER' },
        { command: 'RETURN_TO_CATEGORIES' },
        { command: 'REPEAT_MENU' },
        { command: 'CANCEL' },
    ]);
    await this.sendMessage(userJid, session.sessionId, `Puedes seguir agregando productos o elegir una opción:
${optionsPrompt}`);
  }
  
  private async handleOrdering(userJid: string, session: UserSessionDocument, messageText: string) {
    const parts = messageText.split(/\s+/);
    if (parts.length < 2) {
        await this.sendMessage(userJid, session.sessionId, 'Formato no reconocido. Para ordenar, usa: *SKU [presentacion] Cantidad*');
        return;
    }

    const sku = parts[0].toUpperCase();
    const producto = await this.empresasService.findProductBySku(session.company!.id, sku);

    if (!producto) {
        await this.sendMessage(userJid, session.sessionId, `Producto con SKU "${sku}" no encontrado.`);
        return;
    }

    if (producto.presentacion && !(producto.presentacion instanceof Map)) {
        producto.presentacion = new Map(Object.entries(producto.presentacion));
    }

    const hasPresentations = producto.presentacion && producto.presentacion.size > 0;
    
    let quantity;
    let presentationName;

    const lastPart = parts[parts.length - 1];
    const potentialQuantity = parseInt(lastPart, 10);

    if (isNaN(potentialQuantity) || potentialQuantity <= 0) {
        await this.sendMessage(userJid, session.sessionId, `Cantidad no válida. Te mostraré el detalle del producto para que puedas agregarlo.`);
        await this.handleProductDetail(userJid, session, sku);
        return;
    }
    quantity = potentialQuantity;

    if (parts.length > 2) { // SKU presentacion... Cantidad
        if (!hasPresentations) {
            await this.sendMessage(userJid, session.sessionId, `El producto ${producto.nombreCorto} no tiene presentaciones. Te mostraré el detalle.`);
            await this.handleProductDetail(userJid, session, sku);
            return;
        }
        const presentationIdentifier = parts.slice(1, -1).join(' ');
        
        let foundPresentationKey;
        for (const key of producto.presentacion.keys()) {
            if (key.toLowerCase() === presentationIdentifier) {
                foundPresentationKey = key;
                break;
            }
        }

        if (!foundPresentationKey) {
            await this.sendMessage(userJid, session.sessionId, `Presentación no válida para ${producto.nombreCorto}. Te mostraré el detalle.`);
            await this.handleProductDetail(userJid, session, sku);
            return;
        }
        presentationName = foundPresentationKey;

    } else { // SKU Cantidad
        if (hasPresentations) {
            await this.sendMessage(userJid, session.sessionId, `El producto ${producto.nombreCorto} tiene presentaciones. Debes especificar una. Te mostraré el detalle.`);
            await this.handleProductDetail(userJid, session, sku);
            return;
        }
    }

    const selectedPresentation = presentationName ? producto.presentacion.get(presentationName) : undefined;
    const itemStock = selectedPresentation ? selectedPresentation.existencia : producto.existencia;

    if (itemStock < quantity) {
        await this.sendMessage(userJid, session.sessionId, `Stock insuficiente. Disponibles: ${itemStock}.`);
        return;
    }

    const existingItem = session.cart.find(item => item.sku === sku && item.presentacion === presentationName);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        session.cart.push({
            sku: producto.sku,
            quantity,
            precioVenta: selectedPresentation ? selectedPresentation.precioventa : producto.precioVenta,
            nombreCorto: producto.nombreCorto,
            presentacion: presentationName,
        });
    }

    await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${producto.nombreCorto} ${presentationName ? `(${presentationName})` : ''}.`);
  }

  private async handleShowCart(userJid: string, session: UserSessionDocument) {
    const cartPrompt = prompts.buildCartPrompt(session.cart);
    await this.sendMessage(userJid, session.sessionId, cartPrompt);

    if (session.cart.length > 0) {
        const optionsPrompt = prompts.buildOptionsPrompt([
            { command: 'FINALIZE_ORDER', customDescription: 'Confirmar pedido' },
            { command: 'RETURN_TO_CATEGORIES' },
            { command: 'REPEAT_MENU' },
            { command: 'CANCEL' },
        ]);
        await this.sendMessage(userJid, session.sessionId, optionsPrompt);
    }
  }

  private async handleCreateOrder(userJid: string, session: UserSessionDocument) {
    if (session.cart.length === 0) {
      await this.sendMessage(userJid, session.sessionId, 'Tu carrito está vacío.');
      return;
    }

    const cliente = await this.clientesService.findOrCreateByWhatsApp(userJid);
    session.state = ConversationState.AWAITING_CUSTOMER_DATA;

    const nombreActual = cliente.nombre || 'No registrado';
    const direccionActual = cliente.direccion || 'No registrada';
    const telefonoActual = cliente.telefono || userJid.replace('@s.whatsapp.net', '');

    const prompt = `Para procesar tu pedido, necesitamos confirmar tus datos de entrega.\n\n` +
                   `*Datos actuales:*
` +
                   `*Nombre:* ${nombreActual}
` +
                   `*Dirección:* ${direccionActual}
` +
                   `*Teléfono:* ${telefonoActual}

` +
                   `*Para confirmar o actualizar, por favor envía tu información en un solo mensaje con el siguiente formato:*

` +
                   `*Nombre:* Tu nombre completo
` +
                   `*Dirección:* Tu dirección de entrega
` +
                   `*Teléfono:* Tu número de contacto (opcional)`;

    await this.sendMessage(userJid, session.sessionId, prompt);
  }

  private parseCustomerData(message: string): { nombre?: string; direccion?: string; telefono?: string } {
    const nombreMatch = message.match(/nombre:\s*([\s\S]*?)(?:\n\*dirección:|\n\*teléfono:|$)/i);
    const direccionMatch = message.match(/dirección:\s*([\s\S]*?)(?:\n\*nombre:|\n\*teléfono:|$)/i);
    const telefonoMatch = message.match(/teléfono:\s*([\s\S]*?)(?:\n\*nombre:|\n\*dirección:|$)/i);
  
    return {
      nombre: nombreMatch ? nombreMatch[1].trim() : undefined,
      direccion: direccionMatch ? direccionMatch[1].trim() : undefined,
      telefono: telefonoMatch ? telefonoMatch[1].trim() : undefined,
    };
  }
  
  private async handleAwaitingCustomerData(userJid: string, session: UserSessionDocument, messageText: string) {
    const data = this.parseCustomerData(messageText);

    if (!data.nombre && !data.direccion) {
        await this.sendMessage(userJid, session.sessionId, 'No pude entender tus datos. Por favor, envíalos en el formato solicitado.');
        return;
    }

    const cliente = await this.clientesService.findOrCreateByWhatsApp(userJid);

    if (data.nombre) cliente.nombre = data.nombre;
    if (data.direccion) cliente.direccion = data.direccion;
    if (data.telefono) cliente.telefono = data.telefono;
    
    await cliente.save();

    await this.executeOrderCreation(userJid, session);
  }

  private async executeOrderCreation(userJid: string, session: UserSessionDocument) {
    const empresa = await this.empresasService.findOne(session.company!.id);
    const cliente = await this.clientesService.findOrCreateByWhatsApp(userJid);
    const total = session.cart.reduce((sum, item) => sum + (item.quantity * item.precioVenta), 0);

    const pedidoDto: CreatePedidoDto = {
        clienteId: cliente._id.toString(),
        empresaId: empresa._id.toString(),
        items: session.cart.map(item => ({ sku: item.sku, cantidad: item.quantity, presentacion: item.presentacion })),
        totalPrecio: total,
    };

    try {
        await this.pedidosService.create(pedidoDto);
        for (const item of pedidoDto.items) {
            await this.empresasService.decreaseStock(session.company!.id, item.sku, item.cantidad, item.presentacion);
        }
    } catch (error) {
        console.error(`Error al procesar el pedido para ${userJid}:`, error);
        await this.sendMessage(userJid, session.sessionId, '🔴 Hubo un error al procesar tu pedido. Por favor, contacta a soporte.');
        return;
    }

    const customerName = cliente.nombre || 'Cliente';
    const customerAddress = cliente.direccion || 'No especificada';
    const customerPhone = cliente.telefono || userJid.replace('@s.whatsapp.net', '');
    const customerWhatsappLink = `https://wa.me/${userJid.replace('@s.whatsapp.net', '')}`;

    let companyNotificationMessage = `¡Nuevo Pedido Recibido!\n\n`;
    companyNotificationMessage += `*Cliente:* ${customerName}\n` +
                               `*Dirección de Entrega:* ${customerAddress}\n` +
                               `*Teléfono de Contacto:* ${customerPhone}\n` +
                               `*WhatsApp Cliente:* ${userJid.replace('@s.whatsapp.net', '')}\n` +
                               `*Enlace para chatear:* ${customerWhatsappLink}\n\n` +
                               `*Detalles del Pedido:*\n`;

    pedidoDto.items.forEach(item => {
        const cartItem = session.cart.find(cart => cart.sku === item.sku && cart.presentacion === item.presentacion);
        const itemName = cartItem ? cartItem.nombreCorto : item.sku;
        const presentation = item.presentacion ? ` (${item.presentacion})` : '';
        const price = cartItem ? ` (${cartItem.precioVenta.toFixed(2)} c/u)` : '';
        companyNotificationMessage += `- ${item.cantidad} x ${itemName}${presentation}${price}\n`;
    });

    companyNotificationMessage += `\n*Total:* ${total.toFixed(2)}
`;
    companyNotificationMessage += `
Por favor, contacta al cliente para coordinar la entrega.`;

    if (empresa.whatsApp) {
      try {
        const companyJid = `${empresa.codigoPais}${empresa.whatsApp}@s.whatsapp.net`;
        await this.whatsappService.sendMessage(session.sessionId, companyJid, companyNotificationMessage);
        this.logger.log(`Order notification sent to company ${empresa.nombre} (${companyJid}) for customer ${customerName}.`);
      } catch (error) {
        this.logger.error(`Failed to send order notification to company ${empresa.nombre} at ${empresa.whatsApp}: ${error.message}`);
      }
    } else {
        this.logger.warn(`Company ${empresa.nombre} does not have a WhatsApp number configured to receive order notifications.`);
    }

    await this.sendMessage(userJid, session.sessionId, empresa.saludoDespedida || '¡Gracias por tu compra! Tu pedido ha sido procesado.');
    await this.resetSession(userJid, session, false);
  }
  
  private async handleGoBack(userJid: string, session: UserSessionDocument) {
    switch (session.state) {
        case ConversationState.SELECTING_CATEGORY:
            await this.resetSession(userJid, session, true, 'Regresando a la selección de empresas.');
            break;
        case ConversationState.BROWSING_PRODUCTS:
            await this.showCategories(userJid, session);
            break;
        case ConversationState.AWAITING_PRODUCT_ACTION:
            session.pendingProduct = undefined;
            // Determine whether to show categories or all products based on previous state or available categories
            if (session.availableCategories && session.availableCategories.length > 0) {
                await this.showCategories(userJid, session);
            } else {
                await this.showAllProducts(userJid, session);
            }
            break;
        // Other cases can be added here
        default:
            await this.sendMessage(userJid, session.sessionId, "No hay un menú anterior al que regresar.");
            break;
    }
  }

  private async handleRepeatMenu(userJid: string, session: UserSessionDocument) {
    switch (session.state) {
        case ConversationState.SELECTING_COMPANY:
            await this.handleCompanySelection(userJid, session, '');
            break;
        case ConversationState.SELECTING_CATEGORY:
            await this.showCategories(userJid, session);
            break;
        case ConversationState.BROWSING_PRODUCTS:
            // This is a simplification. A more robust implementation might store the last category.
            await this.showAllProducts(userJid, session);
            break;
        case ConversationState.AWAITING_PRODUCT_ACTION:
            if(session.pendingProduct) {
                await this.handleProductDetail(userJid, session, session.pendingProduct.sku);
            } else {
                await this.resetSession(userJid, session, true, 'Error, no hay producto pendiente.');
            }
            break;
        // Other cases
        default:
            await this.sendMessage(userJid, session.sessionId, 'No hay un menú para repetir en este momento.');
            break;
    }
  }

  private async startChatting(userJid: string, session: UserSessionDocument) {
    if (!session.company) {
      await this.sendMessage(userJid, session.sessionId, 'Por favor, primero elige una empresa.');
      return;
    }
    session.previousState = session.state;
    session.state = ConversationState.CHATTING;
    const prompt = prompts.buildChatStartPrompt(session.company.name!);
    await this.sendMessage(userJid, session.sessionId, prompt);
  }

  private async stopChatting(userJid: string, session: UserSessionDocument) {
    session.state = session.previousState || ConversationState.SELECTING_CATEGORY;
    session.previousState = undefined;
    await this.sendMessage(userJid, session.sessionId, 'Has finalizado el chat.');
    await this.handleRepeatMenu(userJid, session);
  }

  private async handleChatting(userJid: string, session: UserSessionDocument, messageText: string, command: keyof typeof COMMANDS | undefined) {
    if (command === 'STOP_CHATTING') {
      await this.stopChatting(userJid, session);
      return;
    }

    const empresa = await this.empresasService.findOne(session.company!.id);
    if (!empresa || !empresa.whatsApp) {
      await this.sendMessage(userJid, session.sessionId, 'Lo sentimos, esta empresa no tiene un chat habilitado.');
      await this.stopChatting(userJid, session);
      return;
    }

    const cliente = await this.clientesService.findOrCreateByWhatsApp(userJid);
    const customerName = cliente.nombre || 'Cliente sin nombre';
    const customerPhone = userJid.replace('@s.whatsapp.net', '');

    const vendorMessage = prompts.buildVendorChatMessage(customerName, customerPhone, messageText) + `

[ref:${userJid}]`;
    const companyJid = `${empresa.codigoPais}${empresa.whatsApp}@s.whatsapp.net`;

    try {
      await this.whatsappService.sendMessage(session.sessionId, companyJid, vendorMessage);
      await this.sendMessage(userJid, session.sessionId, 'Tu mensaje ha sido enviado.');
    } catch (error) {
      this.logger.error(`Failed to forward message to company ${empresa.nombre}: ${error.message}`);
      await this.sendMessage(userJid, session.sessionId, 'Lo sentimos, no pudimos enviar tu mensaje. Inténtalo de nuevo más tarde.');
    }
  }

  private async handleVendorReply(message: { from: string; sessionId: string; text: string; originalMessage: WAMessage; }): Promise<boolean> {
    const vendorJid = message.from;
    const vendorPhoneNumber = vendorJid.split('@')[0];
    const empresa = await this.empresasService.findByWhatsApp(vendorPhoneNumber);

    if (!empresa) {
      return false; // Not a reply from a known vendor
    }

    const quotedInfo = message.originalMessage.message?.extendedTextMessage?.contextInfo;
    if (!quotedInfo || !quotedInfo.quotedMessage) {
      return false; // Not a reply
    }

    const originalQuotedMessage = quotedInfo.quotedMessage.conversation || quotedInfo.quotedMessage.extendedTextMessage?.text || '';
    const customerJidMatch = originalQuotedMessage.match(/\\\[ref:(\S+@s\\.whatsapp\\.net)\\\]/);

    if (customerJidMatch && customerJidMatch[1]) {
      const customerJid = customerJidMatch[1];
      const replyText = message.text;
      try {
        await this.whatsappService.sendMessage(message.sessionId, customerJid, `Respuesta de ${empresa.nombre}:\n${replyText}`);
        this.logger.log(`Relayed reply from vendor ${empresa.nombre} to customer ${customerJid}`);
        return true; // Message handled
      } catch (error) {
        this.logger.error(`Failed to relay vendor reply to ${customerJid}: ${error.message}`);
        return true; // Still considered handled to prevent further processing
      }
    }

    return false;
  }

  private async resetSession(userJid: string, session: UserSessionDocument, sendMessage = true, message?: string) {
    const oldSessionId = session.sessionId;
    session.company = undefined;
    session.cart = [];
    session.state = ConversationState.SELECTING_COMPANY;
    session.availableCategories = [];
    session.numberedOptions = {};
    session.pendingProduct = undefined;
    session.previousState = undefined;

    if (this.sessionTimers.has(userJid)) {
        const timers = this.sessionTimers.get(userJid)!;
        clearTimeout(timers.warning);
        if (timers.termination) clearTimeout(timers.termination);
        this.sessionTimers.delete(userJid);
    }

    if (sendMessage) {
        const resetMessage = message || 'Sesión reiniciada.';
        await this.sendMessage(userJid, oldSessionId, resetMessage);
        await this.handleCompanySelection(userJid, session, '');
    }
  }
  
  // Inactivity timer methods (sendInactivityWarning, endInactiveSession, resetInactivityTimer)
  // These methods remain unchanged as they are not directly related to the command refactoring.
  private resetInactivityTimer(userJid: string, sessionId: string) {
    if (this.sessionTimers.has(userJid)) {
      const timers = this.sessionTimers.get(userJid);
      clearTimeout(timers.warning);
      if (timers.termination) clearTimeout(timers.termination);
    }

    const warningTimeout = this.configService.get<number>('session.warningTimeout', 300000); // 5 minutes
    const warningTimer = setTimeout(() => {
      this.sendInactivityWarning(userJid, sessionId);
    }, warningTimeout);

    this.sessionTimers.set(userJid, { warning: warningTimer, termination: null });
  }

  private async sendInactivityWarning(userJid: string, sessionId: string) {
    await this.sendMessage(userJid, sessionId, 'Tu sesión está a punto de cerrarse por inactividad. Envía un mensaje para mantenerla activa.');
    const terminationTimeout = this.configService.get<number>('session.terminationTimeout', 120000); // 2 minutes
    const terminationTimer = setTimeout(() => {
      this.endInactiveSession(userJid, sessionId);
    }, terminationTimeout);

    const timers = this.sessionTimers.get(userJid);
    if (timers) {
      this.sessionTimers.set(userJid, { ...timers, termination: terminationTimer });
    }
  }

  private async endInactiveSession(userJid: string, sessionId: string) {
    await this.sendMessage(userJid, sessionId, 'Tu sesión ha sido cerrada por inactividad.');
    const result = await this.sessionsService.delete(userJid);
    if (result.deletedCount > 0) {
      this.logger.log(`Session for ${userJid} terminated due to inactivity.`);
    }
    this.sessionTimers.delete(userJid);
  }


  async sendMessage(to: string, sessionId: string, message: string): Promise<void> {
    this.logger.log(`Sending message to ${to} via session ${sessionId}: "${message}"`);
    await this.whatsappService.sendMessage(sessionId, to, message);
  }
}