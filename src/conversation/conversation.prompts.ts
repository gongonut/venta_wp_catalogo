import { COMMANDS } from './conversation.constants';
import { Producto } from '../empresas/schemas/producto.schema';
import { Empresa } from '../empresas/schemas/empresa.schema';

function formatCurrency(amount: number): string {
  const currencySymbol = '$'; // This could be dynamic in the future
  return `${currencySymbol}${amount.toFixed(2)}`;
}

export function buildCompanyListPrompt(empresas: (Empresa & { _id: any })[]): string {
  const companyList = empresas
    .map((e, index) => {
      const number = index + 1;
      let companyDetails = `*${number}*. ${e.nombre}`;
      if (e.whatsApp) {
        companyDetails += `\n  Celular: ${e.whatsApp}`;
      }
      if (e.direccion) {
        companyDetails += `\n  Dirección: ${e.direccion}`;
      }
      return companyDetails;
    })
    .join('\n\n');

  return `Hola, bienvenido. Por favor, elige una de nuestras empresas:\n\n${companyList}`;
}

export function buildCategoryListPrompt(categories: string[]): string {
  const categoryList = categories.map((c, index) => `*${index + 1}*. ${c}`).join('\n');
  return `Por favor, elige una categoría:\n${categoryList}`;
}

export function buildProductListPrompt(products: Producto[], instruction: string, useNumberedOptions: boolean = false, noProductsMessage: string = 'Actualmente no tenemos productos en el catálogo.'): string {
  const productsInStock = products.filter(p => p.existencia > 0);

  if (productsInStock.length === 0) {
    return noProductsMessage;
  }

  const productList = productsInStock.map((p, index) => {
    const identifier = useNumberedOptions ? `*${index + 1}*` : `*${p.sku}*`;
    const hasPresentations = p.presentacion && p.presentacion.size > 0;
    let productLine = `${identifier}. ${p.nombreCorto}`;

    if (hasPresentations) {
      const availablePresentations = Array.from(p.presentacion.entries())
        .filter(([, pres]) => pres.existencia > 0);
      if (availablePresentations.length > 0) {
        const presentationLines = availablePresentations
          .map(([name, pres]) => `  ${name} - ${formatCurrency(pres.precioventa)}`)
          .join('\n');
        productLine += `\n${presentationLines}`;
      } else {
        // If all presentations are out of stock, show the base price if available
        productLine += ` - ${formatCurrency(p.precioVenta)}`;
      }
    } else {
      productLine += ` - ${formatCurrency(p.precioVenta)}`;
    }
    return productLine;
  }).join('\n\n');

  return `Nuestro catálogo es:\n${productList}\n\n${instruction}`;
}

export function buildProductDetailPrompt(producto: Producto): string {
  let detail = producto.nombreLargo || producto.nombreCorto;
  if (producto.fotos && producto.fotos.length > 0) {
    detail += `\n\nFotos del producto:\n${producto.fotos.join('\n')}`;
  }
  return detail;
}

export function buildCartPrompt(cart: any[]): string {
  if (cart.length === 0) {
    return 'Tu carrito está vacío.';
  }
  let total = 0;
  const cartItems = cart.map(item => {
    const subtotal = item.quantity * item.precioVenta;
    total += subtotal;
    const displayName = item.presentacion ? `${item.nombreCorto} (${item.presentacion})` : item.nombreCorto;
    return `${item.quantity} x ${displayName} (*${item.sku}*) - ${formatCurrency(subtotal)}`;
  });

  return `🛒 *Tu Carrito:*
${cartItems.join('\n')}\n\n*Total: ${formatCurrency(total)}*`;
}

export function buildOptionsPrompt(options: { command: keyof typeof COMMANDS, customDescription?: string }[]): string {
  const optionsList = options.map(opt => {
    const command = COMMANDS[opt.command];
    return `*${command.mnemonic}*. ${opt.customDescription || command.name}`;
  }).join('\n');
  return `Opciones:\n${optionsList}`;
}

export function buildGeneralOptionsPrompt(): string {
  return buildOptionsPrompt([
    { command: 'REPEAT_MENU' },
    { command: 'CANCEL' },
  ]);
}

export function buildPresentationChoicePrompt(productName: string, presentations: [string, any][]): string {
  const presentationList = presentations.map(([name, p], index) => {
    const optionNumber = index + 1;
    return p.existencia > 0
      ? `*${optionNumber}*. ${name} - ${formatCurrency(p.precioventa)}`
      : `~*${optionNumber}*. ${name} - ${formatCurrency(p.precioventa)}~ (Agotado)`;
  }).join('\n');

  return `El producto *${productName}* tiene varias presentaciones. Por favor, elige una y la cantidad (ej: *1 2* o *Grande 2*):\n${presentationList}`;
}
