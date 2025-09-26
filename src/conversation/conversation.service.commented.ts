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

/**
 * Orquesta la conversación con el cliente, manejando el estado de la sesión y
 * respondiendo a los mensajes del usuario.
 */
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
    // Crea un mapa de mnemónicos de comandos para una búsqueda rápida.
    this.commandMap = new Map();
    for (const key in COMMANDS) {
      const commandKey = key as keyof typeof COMMANDS;
      this.commandMap.set(COMMANDS[commandKey].mnemonic, commandKey);
    }
  }

  onModuleInit() {
    this.logger.log('ConversationService initialized.');
  }

  /**
   * Punto de entrada principal para todos los mensajes entrantes de los usuarios.
   * Procesa el mensaje y dirige la conversación según el estado actual.
   * @param message El mensaje genérico recibido del proveedor de WhatsApp.
   */
  public async handleIncomingMessage(message: { from: string; sessionId: string; text: string; }) {
    try {
      this.logger.debug(`Processing message from ${message.from} via session ${message.sessionId}: "${message.text}"`);
      const userJid = message.from;
      let messageText = message.text.trim().toLowerCase();

      this.resetInactivityTimer(userJid, message.sessionId);

      const session = await this.sessionsService.findOrCreate(userJid, message.sessionId);

      // Si el mensaje es un número, intenta resolverlo a una opción guardada.
      if (session.numberedOptions && session.numberedOptions[messageText]) {
        messageText = session.numberedOptions[messageText];
      }

      const command = this.commandMap.get(messageText);

      // Maneja comandos universales que pueden ser ejecutados en cualquier estado.
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

      // Procesa el mensaje basado en el estado actual de la conversación.
      await this.processState(session, userJid, messageText, command);
      await session.save();
    } catch (error) {
      this.logger.error(`Error processing message from ${message.from}: ${error.stack}`);
      await this.sendMessage(message.from, message.sessionId, 'Lo sentimos, ocurrió un error al procesar tu mensaje.');
    }
  }

  /**
   * Dirige el flujo de la conversación a la función de manejo apropiada
   * basada en el estado de la sesión del usuario.
   * @param session La sesión del usuario.
   * @param userJid El JID del usuario.
   * @param messageText El texto del mensaje del usuario.
   * @param command El comando resuelto a partir del mensaje de texto.
   */
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
      default:
        this.logger.warn(`Unhandled state: ${session.state}`);
        await this.resetSession(userJid, session, true, 'Estado no reconocido, reiniciando sesión.');
        break;
    }
  }
  
  /**
   * Maneja la lógica cuando el usuario está en el estado de seleccionar una empresa.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param messageText El texto del mensaje del usuario.
   */
  private async handleCompanySelection(userJid: string, session: UserSessionDocument, messageText: string) {
    let empresa;
    try {
      empresa = await this.empresasService.findOneByName(messageText);
    } catch (error) {
      this.logger.error(`Error finding company by name "${messageText}": ${error.stack}`);
    }

    if (empresa) {
      // Si se encuentra una empresa, la guarda en la sesión y avanza.
      session.company = { code: empresa.code, id: empresa._id.toString() };
      await this.sendMessage(userJid, session.sessionId, empresa.saludoBienvenida || `¡Bienvenido a ${empresa.nombre}!`);
      
      const categories = await this.empresasService.findProductCategories(session.company.id);
      if (categories && categories.length > 0) {
        session.availableCategories = categories;
        await this.showCategories(userJid, session);
      } else {
        await this.showAllProducts(userJid, session);
      }
    } else {
      // Si no se encuentra una empresa, muestra la lista de empresas disponibles.
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

  /**
   * Muestra al usuario la lista de categorías de productos disponibles.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   */
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
      { command: 'RETURN_TO_COMPANIES' },
      { command: 'REPEAT_MENU' },
      { command: 'CANCEL' },
    ]);
    await this.sendMessage(userJid, session.sessionId, optionsPrompt);
  }
  
  /**
   * Maneja la selección de una categoría por parte del usuario.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param messageText El texto del mensaje del usuario.
   * @param command El comando resuelto.
   */
  private async handleCategorySelection(userJid: string, session: UserSessionDocument, messageText: string, command: keyof typeof COMMANDS | undefined) {
    if (command === 'RETURN_TO_COMPANIES') {
        await this.resetSession(userJid, session, true, 'Regresando a la selección de empresas.');
        return;
    }

    const chosenCategory = session.availableCategories?.find(c => c.toLowerCase() === messageText);

    if (chosenCategory) {
        session.state = ConversationState.BROWSING_PRODUCTS;
        session.numberedOptions = {};
        const productos = await this.empresasService.findProductsByCategory(session.company!.id, chosenCategory);
        const instruction = `Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)`;
        const prompt = prompts.buildProductListPrompt(productos, instruction, false, 'No hay productos en esta categoría.');
        await this.sendMessage(userJid, session.sessionId, prompt);
        
        const optionsPrompt = prompts.buildOptionsPrompt([
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

  /**
   * Muestra todos los productos de la empresa seleccionada.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   */
  private async showAllProducts(userJid: string, session: UserSessionDocument) {
    session.state = ConversationState.BROWSING_PRODUCTS;
    const productos = await this.empresasService.findAllProducts(session.company!.id);
    const instruction = `Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)`;
    const prompt = prompts.buildProductListPrompt(productos, instruction);
    await this.sendMessage(userJid, session.sessionId, prompt);

    const optionsPrompt = prompts.buildOptionsPrompt([
        { command: 'DETAIL', customDescription: 'Ver Detalle (ej: de SKU)' },
        { command: 'VIEW_CART' },
        { command: 'FINALIZE_ORDER' },
        { command: 'REPEAT_MENU' },
        { command: 'CANCEL' },
    ]);
    await this.sendMessage(userJid, session.sessionId, optionsPrompt);
  }

  /**
   * Maneja la entrada del usuario mientras navega por los productos.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param messageText El texto del mensaje del usuario.
   * @param command El comando resuelto.
   */
  private async handleProductBrowsing(userJid: string, session: UserSessionDocument, messageText: string, command: keyof typeof COMMANDS | undefined) {
    if (command) {
        switch (command) {
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
        }
    }

    // Comprueba si el usuario quiere ver el detalle de un producto.
    const detailRegex = new RegExp(`^${COMMANDS.DETAIL.mnemonic}\s+(\S+)`);
    const detailMatch = messageText.match(detailRegex);
    if (detailMatch) {
        const [, itemIdentifier] = detailMatch;
        await this.handleProductDetail(userJid, session, itemIdentifier);
        return;
    }

    // Por defecto, asume que el usuario está intentando ordenar un producto.
    await this.handleOrdering(userJid, session, messageText);
  }

  /**
   * Muestra información detallada de un producto específico.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param itemIdentifier El SKU o número del producto.
   */
  private async handleProductDetail(userJid: string, session: UserSessionDocument, itemIdentifier: string) {
    const sku = session.numberedOptions[itemIdentifier] || itemIdentifier.toUpperCase();
    const producto = await this.empresasService.findProductBySku(session.company!.id, sku);

    if (producto) {
        const detailPrompt = prompts.buildProductDetailPrompt(producto);
        await this.sendMessage(userJid, session.sessionId, detailPrompt);

        // Guarda el producto en la sesión para acciones posteriores (ej. agregar al carrito).
        session.pendingProduct = {
            sku: producto.sku,
            nombreCorto: producto.nombreCorto,
            precioVenta: producto.precioVenta,
            existencia: producto.existencia,
            presentacion: producto.presentacion,
        };
        session.state = ConversationState.AWAITING_PRODUCT_ACTION;
        session.numberedOptions = {};

        const options = [
            { command: 'ADD_TO_CART', mnemonic: '1' },
            { command: 'GO_BACK', mnemonic: '2' },
            { command: 'VIEW_CART', mnemonic: '3' },
            { command: 'FINALIZE_ORDER', mnemonic: '4' },
        ];

        const optionsPrompt = `¿Qué deseas hacer con *${producto.nombreCorto}*?\n\n` +
            options.map(opt => {
                session.numberedOptions[opt.mnemonic] = COMMANDS[opt.command].mnemonic;
                return `*${opt.mnemonic}*. ${COMMANDS[opt.command].name}`;
            }).join('\n');
        
        await this.sendMessage(userJid, session.sessionId, optionsPrompt);
    } else {
        await this.sendMessage(userJid, session.sessionId, `No se encontró el producto con identificador "${itemIdentifier}".`);
    }
  }
  
  /**
   * Espera la acción del usuario después de mostrar los detalles de un producto.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param messageText El texto del mensaje del usuario.
   * @param command El comando resuelto.
   */
  private async handleAwaitingProductAction(userJid: string, session: UserSessionDocument, messageText: string, command: keyof typeof COMMANDS | undefined) {
    const action = command || this.commandMap.get(messageText);
    if (!session.pendingProduct) {
        await this.resetSession(userJid, session, true, 'Error: No hay producto pendiente.');
        return;
    }
    if (!action) {
        await this.sendMessage(userJid, session.sessionId, 'Opción no válida. Por favor, elige una de las opciones.');
        await this.handleProductDetail(userJid, session, session.pendingProduct.sku);
        return;
    }

    switch (action) {
        case 'ADD_TO_CART':
            session.state = ConversationState.AWAITING_QUANTITY_FOR_PRODUCT;
            if (session.pendingProduct.presentacion && session.pendingProduct.presentacion.size > 0) {
                const presentations = Array.from(session.pendingProduct.presentacion.entries());
                const prompt = prompts.buildPresentationChoicePrompt(session.pendingProduct.nombreCorto, presentations);
                session.numberedOptions = {};
                presentations.forEach(([name], i) => {
                    session.numberedOptions[i + 1] = name;
                });
                await this.sendMessage(userJid, session.sessionId, prompt);
            } else {
                await this.sendMessage(userJid, session.sessionId, `¿Qué cantidad de *${session.pendingProduct.nombreCorto}* deseas agregar?`);
            }
            break;
        case 'GO_BACK':
            session.pendingProduct = undefined;
            await this.showCategories(userJid, session);
            break;
        case 'VIEW_CART':
            await this.handleShowCart(userJid, session);
            session.state = ConversationState.BROWSING_PRODUCTS;
            session.pendingProduct = undefined;
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

  /**
   * Maneja la entrada de la cantidad de un producto para agregarlo al carrito.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param messageText El texto del mensaje del usuario.
   */
  private async handleAwaitingQuantityForProduct(userJid: string, session: UserSessionDocument, messageText: string) {
    const { pendingProduct } = session;
    if (!pendingProduct) {
        await this.resetSession(userJid, session, true, 'Error: No hay producto pendiente.');
        return;
    }

    const parts = messageText.split(/\s+/);
    let quantityStr;
    let presentationIdentifier: string | undefined;

    // Determina la cantidad y la presentación a partir del mensaje.
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

    // Verifica el stock y agrega el producto al carrito.
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
        { command: 'VIEW_CART' },
        { command: 'FINALIZE_ORDER' },
        { command: 'RETURN_TO_CATEGORIES' },
        { command: 'REPEAT_MENU' },
    ]);
    await this.sendMessage(userJid, session.sessionId, optionsPrompt);
  }
  
  /**
   * Maneja el pedido de un producto directamente a través de SKU y cantidad.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param messageText El texto del mensaje del usuario.
   */
  private async handleOrdering(userJid: string, session: UserSessionDocument, messageText: string) {
    const parts = messageText.split(/\s+/);
    if (parts.length < 2) {
        await this.sendMessage(userJid, session.sessionId, 'Formato no reconocido. Para ordenar, usa: *SKU Cantidad*');
        return;
    }

    const sku = parts[0].toUpperCase();
    const quantity = parseInt(parts[1], 10);

    if (isNaN(quantity) || quantity <= 0) {
        await this.sendMessage(userJid, session.sessionId, 'Cantidad no válida.');
        return;
    }

    const producto = await this.empresasService.findProductBySku(session.company!.id, sku);
    if (!producto) {
        await this.sendMessage(userJid, session.sessionId, `Producto con SKU "${sku}" no encontrado.`);
        return;
    }

    if (producto.presentacion && producto.presentacion.size > 0) {
         await this.sendMessage(userJid, session.sessionId, `El producto ${producto.nombreCorto} tiene presentaciones. Usa la opción de detalle para agregarlo.`);
         await this.handleProductDetail(userJid, session, sku);
         return;
    }

    if (producto.existencia < quantity) {
        await this.sendMessage(userJid, session.sessionId, `Stock insuficiente para ${producto.nombreCorto}. Disponibles: ${producto.existencia}.`);
        return;
    }

    const existingItem = session.cart.find(item => item.sku === sku && !item.presentacion);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        session.cart.push({
            sku: producto.sku,
            quantity,
            precioVenta: producto.precioVenta,
            nombreCorto: producto.nombreCorto,
        });
    }

    await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${producto.nombreCorto}.`);
  }

  /**
   * Muestra el contenido actual del carrito de compras.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   */
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

  /**
   * Crea un nuevo pedido con los artículos en el carrito.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   */
  private async handleCreateOrder(userJid: string, session: UserSessionDocument) {
    if (session.cart.length === 0) {
        await this.sendMessage(userJid, session.sessionId, 'Tu carrito está vacío.');
        return;
    }
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
        await this.sendMessage(userJid, session.sessionId, empresa.saludoDespedida || '¡Gracias por tu compra! Tu pedido ha sido procesado.');
        await this.resetSession(userJid, session, false);
    } catch (error) {
        this.logger.error(`Error creating order: ${error}`);
        await this.sendMessage(userJid, session.sessionId, 'Hubo un problema al crear tu pedido.');
    }
  }
  
  /**
   * Maneja el comando para retroceder al menú anterior.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   */
  private async handleGoBack(userJid: string, session: UserSessionDocument) {
    switch (session.state) {
        case ConversationState.SELECTING_CATEGORY:
            await this.resetSession(userJid, session, true, 'Regresando a la selección de empresas.');
            break;
        case ConversationState.BROWSING_PRODUCTS:
            await this.showCategories(userJid, session);
            break;
        default:
            await this.sendMessage(userJid, session.sessionId, "No hay un menú anterior al que regresar.");
            break;
    }
  }

  /**
   * Repite el menú o las opciones actuales para el usuario.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   */
  private async handleRepeatMenu(userJid: string, session: UserSessionDocument) {
    switch (session.state) {
        case ConversationState.SELECTING_COMPANY:
            await this.handleCompanySelection(userJid, session, '');
            break;
        case ConversationState.SELECTING_CATEGORY:
            await this.showCategories(userJid, session);
            break;
        case ConversationState.BROWSING_PRODUCTS:
            await this.showAllProducts(userJid, session);
            break;
        case ConversationState.AWAITING_PRODUCT_ACTION:
            if(session.pendingProduct) {
                await this.handleProductDetail(userJid, session, session.pendingProduct.sku);
            } else {
                await this.resetSession(userJid, session, true, 'Error, no hay producto pendiente.');
            }
            break;
        default:
            await this.sendMessage(userJid, session.sessionId, 'No hay un menú para repetir en este momento.');
            break;
    }
  }

  /**
   * Reinicia la sesión del usuario, limpiando su estado y carrito.
   * @param userJid El JID del usuario.
   * @param session La sesión del usuario.
   * @param sendMessage Si se debe enviar un mensaje de confirmación.
   * @param message El mensaje de confirmación opcional.
   */
  private async resetSession(userJid: string, session: UserSessionDocument, sendMessage = true, message?: string) {
    const oldSessionId = session.sessionId;
    session.company = undefined;
    session.cart = [];
    session.state = ConversationState.SELECTING_COMPANY;
    session.availableCategories = [];
    session.numberedOptions = {};
    session.pendingProduct = undefined;

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
  
  /**
   * Reinicia el temporizador de inactividad para una sesión de usuario.
   * @param userJid El JID del usuario.
   * @param sessionId El ID de la sesión.
   */
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

  /**
   * Envía una advertencia de inactividad al usuario.
   * @param userJid El JID del usuario.
   * @param sessionId El ID de la sesión.
   */
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

  /**
   * Finaliza una sesión de usuario por inactividad.
   * @param userJid El JID del usuario.
   * @param sessionId El ID de la sesión.
   */
  private async endInactiveSession(userJid: string, sessionId: string) {
    await this.sendMessage(userJid, sessionId, 'Tu sesión ha sido cerrada por inactividad.');
    const result = await this.sessionsService.delete(userJid);
    if (result.deletedCount > 0) {
      this.logger.log(`Session for ${userJid} terminated due to inactivity.`);
    }
    this.sessionTimers.delete(userJid);
  }

  /**
   * Envía un mensaje de texto al usuario a través del servicio de WhatsApp.
   * @param to El JID del destinatario.
   * @param sessionId El ID de la sesión.
   * @param message El mensaje a enviar.
   */
  async sendMessage(to: string, sessionId: string, message: string): Promise<void> {
    this.logger.log(`Sending message to ${to} via session ${sessionId}: "${message}"`);
    await this.whatsappService.sendMessage(sessionId, to, message);
  }
}
