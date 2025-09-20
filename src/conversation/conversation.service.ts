import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { Button, GenericMessage } from '../whatsapp/providers/whatsapp-provider.interface';
import { EmpresasService } from '../empresas/empresas.service';

import { ClientesService } from '../clientes/clientes.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { CreatePedidoDto } from '../pedidos/dto/create-pedido.dto';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SessionsService } from '../sessions/sessions.service';
import { UserSessionDocument } from '../sessions/schemas/session.schema';
import { Producto } from '../empresas/schemas/producto.schema';

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
    try {
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

      if (session.state !== 'selecting_presentation' && session.numberedOptions && session.numberedOptions[messageText]) {
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
        case 'selecting_presentation':
          await this.handlePresentationSelection(userJid, session, messageText);
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
    } catch (error) {
      this.logger.error(`Error processing message from ${message.from}: ${error.stack}`);
      await this.sendMessage(message.from, message.sessionId, 'Lo sentimos, ocurrió un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.');
    }
  }

  private async resetSession(userJid: string, session: UserSessionDocument, sendMessage = true, message?: string) {
    const oldSessionId = session.sessionId;
    session.company = undefined;
    session.cart = [];
    session.state = 'selecting_company';
    session.availableCategories = [];
    session.numberedOptions = {};
    session.pendingOrder = undefined;

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
    await this.sendMessage(userJid, sessionId, 'Tu sesión ha sido cerrada por inactividad.');
    const result = await this.sessionsService.delete(userJid);
    if (result.deletedCount > 0) {
        this.logger.log(`Session for ${userJid} terminated and deleted due to inactivity.`);
    }
    this.sessionTimers.delete(userJid);
  }

  private formatCurrency(amount: number): string {
    // In a real app, you might want to get the currency symbol from company settings
    const currencySymbol = '$'; 
    return `${currencySymbol}${amount.toFixed(2)}`;
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
    const footer = `Escribe *cancelar* para reiniciar.

Opciones:
*RE*. Regresar a empresas`;

    const response = `${footer}\n\nEscribe el número de la categoría o el código de la opción.`;
    await this.sendMessage(userJid, session.sessionId, response);
  }

  private async handleCompanySelection(userJid: string, session: UserSessionDocument, messageText: string) {
    let empresa;
    try {
      empresa = await this.empresasService.findOneByName(messageText);
    } catch (error) {
      this.logger.error(`Error finding company by name "${messageText}": ${error.stack}`);
    }

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
          const productList = productosEnStock.map(p => {
            const hasPresentations = p.presentacion && p.presentacion.size > 0;
            if (hasPresentations) {
                const availablePresentations = Array.from(p.presentacion.entries())
                    .filter(([, pres]) => pres.existencia > 0);
                if (availablePresentations.length > 0) {
                    const presentationLines = availablePresentations
                        .map(([name, pres]) => `  ${name} - ${this.formatCurrency(pres.precioventa)}`)
                        .join('\n');
                    return `*${p.sku}* - ${p.nombreCorto}\n${presentationLines}`;
                }
            }
            return `*${p.sku}* - ${p.nombreCorto} - ${this.formatCurrency(p.precioVenta)}`;
          }).join('\n\n');
          await this.sendMessage(userJid, session.sessionId, `Nuestro catálogo es:\n${productList}`);

          const orderingInstructions = `Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)\n`;
          await this.sendMessage(userJid, session.sessionId, orderingInstructions);

          session.numberedOptions['vc'] = 'ver carrito';
          session.numberedOptions['fp'] = 'pedido';
          const optionsMessage = `Opciones:
*DE*. Ver Detalle (ej: DE SKU)
*VC*. Ver carrito
*FP*. Finalizar pedido

Escribe *cancelar* para reiniciar.`;
          await this.sendMessage(userJid, session.sessionId, optionsMessage);
        } else {
          await this.sendMessage(userJid, session.sessionId, 'Actualmente no tenemos productos en el catálogo.');
        }
      }
    } else {
      const empresas = await this.empresasService.findAll();
      const text = 'Hola, bienvenido. Por favor, elige una de nuestras empresas:';
      session.numberedOptions = {};

      if (empresas.length > 0) {
        const companyList = empresas.map((e, index) => {
          const number = index + 1;
          session.numberedOptions[number] = e.nombre.toLowerCase();
          let companyDetails = `*${number}*. ${e.nombre}`;
          if (e.whatsApp) {
            companyDetails += `\n  Celular: ${e.whatsApp}`;
          }
          if (e.direccion) {
            companyDetails += `\n  Dirección: ${e.direccion}`;
          }
          return companyDetails;
        }).join('\n\n');
        await this.sendMessage(userJid, session.sessionId, `${text}\n\n${companyList}`);
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
                const hasPresentations = p.presentacion && p.presentacion.size > 0;
                if (hasPresentations) {
                    const availablePresentations = Array.from(p.presentacion.entries())
                        .filter(([, pres]) => pres.existencia > 0);
                    if (availablePresentations.length > 0) {
                        const presentationLines = availablePresentations
                            .map(([name, pres]) => `  ${name} - ${this.formatCurrency(pres.precioventa)}`)
                            .join('\n');
                        return `*${number}*. ${p.nombreCorto}\n${presentationLines}`;
                    }
                }
                return `*${number}*. ${p.nombreCorto} - ${this.formatCurrency(p.precioVenta)}`;
            }).join('\n\n');
            await this.sendMessage(userJid, session.sessionId, productList);
            await this.sendMessage(userJid, session.sessionId, 'Para ordenar, envía: *Número Cantidad* (ej: *1 2*)');
        } else {
            productList += productosEnStock.map(p => {
                const hasPresentations = p.presentacion && p.presentacion.size > 0;
                if (hasPresentations) {
                    const availablePresentations = Array.from(p.presentacion.entries())
                        .filter(([, pres]) => pres.existencia > 0);
                    if (availablePresentations.length > 0) {
                        const presentationLines = availablePresentations
                            .map(([name, pres]) => `  ${name} - ${this.formatCurrency(pres.precioventa)}`)
                            .join('\n');
                        return `*${p.sku}* - ${p.nombreCorto}\n${presentationLines}`;
                    }
                }
                return `*${p.sku}* - ${p.nombreCorto} - ${this.formatCurrency(p.precioVenta)}`;
            }).join('\n\n');
            await this.sendMessage(userJid, session.sessionId, productList);
            await this.sendMessage(userJid, session.sessionId, 'Para ordenar, envía: *SKU Cantidad* (ej: *PROD01 2*)');
        }

        session.numberedOptions['rc'] = 'categorias';
        session.numberedOptions['vc'] = 'ver carrito';
        session.numberedOptions['fp'] = 'pedido';
        const optionsMessage = `Opciones:
*DE*. Ver Detalle (ej: DE 1)
*RC*. Volver a categorías (o escribe *regresar*)
*VC*. Ver carrito
*FP*. Finalizar pedido

Escribe *cancelar* para reiniciar.`;
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

  private async handlePresentationSelection(userJid: string, session: UserSessionDocument, messageText: string) {
    const chosenOption = session.numberedOptions[messageText];
    if (!chosenOption) {
        await this.sendMessage(userJid, session.sessionId, 'Opción no válida. Por favor, elige un número de la lista.');
        return;
    }

    const producto = await this.empresasService.findProductBySku(session.company!.id, session.pendingOrder!.sku);
    
    if (!producto || !producto.presentacion) {
      await this.sendMessage(userJid, session.sessionId, 'Hubo un error al procesar tu selección. Por favor, intenta de nuevo.');
      session.state = 'browsing_products';
      session.pendingOrder = undefined;
      return;
    }

    const selectedPresentation = producto.presentacion.get(chosenOption);

    if (selectedPresentation && session.pendingOrder) {
        const { quantity } = session.pendingOrder;

        if (selectedPresentation.existencia < quantity) {
            await this.sendMessage(userJid, session.sessionId, `No hay suficiente stock para la presentación "${chosenOption}". Stock actual: ${selectedPresentation.existencia}. Por favor, elige otra presentación o una cantidad menor.`);
            return;
        }

        const existingItem = session.cart.find(item => item.sku === producto.sku && item.presentacion === chosenOption );

        if (existingItem) {
            existingItem.quantity = quantity;
        } else {
            session.cart.push({
                sku: producto.sku, 
                quantity, 
                precioVenta: selectedPresentation.precioventa, 
                nombreCorto: producto.nombreCorto,
                presentacion: chosenOption 
            });
        }

        await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${producto.nombreCorto} (${chosenOption}).`);

        session.state = 'browsing_products';
        session.pendingOrder = undefined;
        session.numberedOptions = {};

        session.numberedOptions['rc'] = 'categorias';
        session.numberedOptions['vc'] = 'ver carrito';
        session.numberedOptions['fp'] = 'pedido';
        const optionsMessage = `Opciones:\n*DE*. Ver Detalle (ej: DE 1)\n*RC*. Volver a categorías (o escribe *regresar*)\n*VC*. Ver carrito\n*FP*. Finalizar pedido\n\nPara agregar otro producto, usa el formato *SKU/Número [Presentación] Cantidad*. O escribe *cancelar* para reiniciar.`;
        await this.sendMessage(userJid, session.sessionId, optionsMessage);

    } else {
        await this.sendMessage(userJid, session.sessionId, 'Hubo un error al seleccionar la presentación. Por favor, intenta de nuevo.');
        session.state = 'browsing_products';
        session.pendingOrder = undefined;
    }
  }

  private async handleOrdering(userJid: string, session: UserSessionDocument, messageText: string) {
    const parts = messageText.split(/\s+/);
    if (parts.length < 2) {
      await this.sendDefaultHelpMessage(userJid, session);
      return;
    }

    const itemIdentifier = parts[0];
    const quantityStr = parts[parts.length - 1];
    const quantity = parseInt(quantityStr, 10);

    if (isNaN(quantity) || quantity <= 0) {
      await this.sendDefaultHelpMessage(userJid, session);
      return;
    }

    const presentationName = parts.length > 2 ? parts.slice(1, -1).join(' ') : undefined;

    let sku: string | undefined;
    if (session.numberedOptions && session.numberedOptions[itemIdentifier]) {
      sku = session.numberedOptions[itemIdentifier];
    } else {
      sku = itemIdentifier.toUpperCase();
    }

    const producto = await this.empresasService.findProductBySku(session.company!.id, sku);

    if (!producto) {
      await this.sendMessage(userJid, session.sessionId, `❌ No encontramos el producto con código "${sku}". Por favor, verifica el código.`);
      return;
    }

    const hasPresentations = producto.presentacion && producto.presentacion.size > 0;

    if (presentationName) {
      if (!hasPresentations) {
        await this.sendMessage(userJid, session.sessionId, `El producto "${producto.nombreCorto}" no tiene presentaciones. Intenta con: *${sku} ${quantity}*`);
        return;
      }

      const presentationKeys = Array.from(producto.presentacion.keys());
      const foundPresentationKey = presentationKeys.find(p => p.toLowerCase() === presentationName.toLowerCase());

      if (foundPresentationKey) {
        const selectedPresentation = producto.presentacion.get(foundPresentationKey)!;
        if (selectedPresentation.existencia < quantity) {
          await this.sendMessage(userJid, session.sessionId, `No hay suficiente stock para la presentación "${foundPresentationKey}". Stock actual: ${selectedPresentation.existencia}.`);
          return;
        }

        const existingItem = session.cart.find(item => item.sku === producto.sku && item.presentacion === foundPresentationKey);
        if (existingItem) {
          existingItem.quantity = quantity;
        } else {
          session.cart.push({
            sku: producto.sku,
            quantity,
            precioVenta: selectedPresentation.precioventa,
            nombreCorto: producto.nombreCorto,
            presentacion: foundPresentationKey,
          });
        }
        await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${producto.nombreCorto} (${foundPresentationKey}).`);
      } else {
        await this.sendMessage(userJid, session.sessionId, `Presentación "${presentationName}" no válida para "${producto.nombreCorto}". Las presentaciones disponibles son: ${presentationKeys.join(', ')}`);
        return;
      }
    } else { // No presentation name provided
      if (hasPresentations) {
        session.state = 'selecting_presentation';
        session.pendingOrder = { sku: producto.sku, quantity: quantity };
        session.numberedOptions = {};
        
        const presentationList = Array.from(producto.presentacion.entries()).map(([name, p], index) => {
          const optionNumber = index + 1;
          session.numberedOptions[optionNumber] = name;
          return p.existencia > 0
            ? `*${optionNumber}*. ${name} - ${this.formatCurrency(p.precioventa)}`
            : `~*${optionNumber}*. ${name} - ${this.formatCurrency(p.precioventa)}~ (Agotado)`;
        }).join('\n');

        await this.sendMessage(userJid, session.sessionId, `El producto "${producto.nombreCorto}" tiene varias presentaciones. Por favor, elige una:\n${presentationList}`);
        await this.sendMessage(userJid, session.sessionId, 'Escribe el número de la presentación que deseas.');
        return;
      } else {
        if (producto.existencia < quantity) {
          await this.sendMessage(userJid, session.sessionId, `No hay suficiente stock para "${producto.nombreCorto}". Stock actual: ${producto.existencia}.`);
          return;
        }
        const existingItem = session.cart.find(item => item.sku === producto.sku && !item.presentacion);
        if (existingItem) {
          existingItem.quantity = quantity;
        } else {
          session.cart.push({ sku: producto.sku, quantity, precioVenta: producto.precioVenta, nombreCorto: producto.nombreCorto });
        }
        await this.sendMessage(userJid, session.sessionId, `✅ Añadido: ${quantity} x ${producto.nombreCorto}.`);
      }
    }

    session.numberedOptions['rc'] = 'categorias';
    session.numberedOptions['vc'] = 'ver carrito';
    session.numberedOptions['fp'] = 'pedido';
    const optionsMessage = `Opciones:\n*DE*. Ver Detalle (ej: DE 1)\n*RC*. Volver a categorías (o escribe *regresar*)\n*VC*. Ver carrito\n*FP*. Finalizar pedido\n\nPara agregar otro producto, usa el formato *SKU/Número Cantidad*. O escribe *cancelar* para reiniciar.`;
    await this.sendMessage(userJid, session.sessionId, optionsMessage);
  }

  private async sendDefaultHelpMessage(userJid: string, session: UserSessionDocument) {
    session.numberedOptions['rc'] = 'categorias';
    session.numberedOptions['vc'] = 'ver carrito';
    session.numberedOptions['fp'] = 'pedido';
    await this.sendMessage(userJid, session.sessionId, "No entendí tu mensaje. Para ordenar, usa el formato *SKU/Número [Presentación] Cantidad*.");
    const optionsMessage = `Opciones:\n*DE*. Ver Detalle (ej: DE 1)\n*RC*. Volver a categorías (o escribe *regresar*)\n*VC*. Ver carrito\n*FP*. Finalizar pedido\n\nO escribe *cancelar* para reiniciar.`;
    await this.sendMessage(userJid, session.sessionId, optionsMessage);
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
      const displayName = item.presentacion ? `${item.nombreCorto} (${item.presentacion})` : item.nombreCorto;
      return `${item.quantity} x ${displayName} (*${item.sku}*) - ${this.formatCurrency(subtotal)}`;
    });
    const cartContent = `🛒 *Tu Carrito:*
${cartItems.join('\n')}

*Total: ${this.formatCurrency(total)}*`;
    await this.sendMessage(userJid, session.sessionId, cartContent);

    session.numberedOptions['rc'] = 'categorias';
    session.numberedOptions['fp'] = 'pedido';
    const optionsMessage = `Opciones:
*RC*. Volver a categorías (o escribe *regresar*)
*FP*. Confirmar pedido

Escribe *cancelar* para reiniciar.`;
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
    const items = session.cart.map(item => ({
      sku: item.sku,
      cantidad: item.quantity,
      presentacion: item.presentacion,
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

      for (const item of pedidoDto.items) {
        await this.empresasService.decreaseStock(session.company!.id, item.sku, item.cantidad, item.presentacion);
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
