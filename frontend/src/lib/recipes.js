// Construcción de la receta mostrada al barista/cliente, combinando el
// producto, la personalización elegida y el "override" guardado por el admin.
import { SIZE_OPTIONS, MILK_OPTIONS, COFFEE_OPTIONS, EXTRA_OPTIONS, labelOf } from './catalog.js';

// Ingrediente que agrega un extra: usa la porción configurada en el catálogo
// de opciones (Admin → Opciones); si no la tiene, un valor de referencia.
export function extraIngredient(ex) {
  const opt = EXTRA_OPTIONS.find(o => o.id === ex);
  if (opt && opt.esShot) return { label: 'Shot extra de café', cantidad: '18 g' };
  if (opt && opt.cantidad) return { label: opt.label, cantidad: formatCantidad(opt.cantidad, opt.unidad) };
  const map = {
    vainilla: { label: 'Jarabe de vainilla', cantidad: '15 ml' },
    caramelo: { label: 'Jarabe de caramelo', cantidad: '15 ml' },
    crema: { label: 'Crema batida', cantidad: '20 g' },
    chocolate: { label: 'Chocolate extra', cantidad: '15 g' },
    shot: { label: 'Shot extra de café', cantidad: '18 g' },
  };
  return map[ex] || { label: opt ? opt.label : ex, cantidad: '1 porción' };
}

// Cantidad mostrada para un ingrediente fijo: 0.015 l -> "15 ml", 0.5 kg -> "500 g".
export function formatCantidad(cantidad, unidad) {
  let n = Number(cantidad); let u = unidad;
  if (u === 'l' && n < 1) { n *= 1000; u = 'ml'; }
  else if (u === 'kg' && n < 1) { n *= 1000; u = 'g'; }
  const txt = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  if (u === 'pieza') return `${txt} ${n === 1 ? 'pieza' : 'piezas'}`;
  return `${txt} ${u}`;
}

// ml de leche para un tamaño: lo que el admin fijó en la receta del producto,
// si no el predeterminado de la sede (viene con las opciones de tamaño), si no
// un valor de referencia.
export function lecheMlPara(size, override) {
  const ov = override || {};
  if (ov.lecheMl && ov.lecheMl[size] !== undefined) return Number(ov.lecheMl[size]);
  const opt = SIZE_OPTIONS.find(s => s.id === size);
  if (opt && opt.lecheMl !== undefined) return Number(opt.lecheMl);
  return { 8: 180, 12: 280, 16: 360 }[size] || 280;
}

export function buildRecipe(product, sel, override) {
  if (!product) return { ingredientes: [], pasos: [], params: { type: 'simple', fields: [] } };

  if (product.tipo === 'snack') {
    return {
      ingredientes: [{ label: product.name, cantidad: '1 pieza' }, { label: 'Servilleta', cantidad: '1 pieza' }],
      pasos: ['Tomar producto de la vitrina', 'Verificar que esté fresco', 'Colocar en plato o bolsa de papel', 'Entregar junto con la bebida'],
      params: { type: 'simple', fields: [] },
    };
  }

  const ov = override || {};
  const size = sel.size || '12';
  const extras = sel.extras || [];
  const hasShotExtra = extras.includes('shot');
  const shots = hasShotExtra ? 2 : 1;
  const gramajeBase = ov.gramajePorShot || 18;
  const gramaje = gramajeBase * shots;
  const milkLabel = sel.milk ? labelOf(MILK_OPTIONS, sel.milk) : 'Leche entera';
  const coffeeLabel = sel.coffeeType ? labelOf(COFFEE_OPTIONS, sel.coffeeType) : 'Café tradicional';
  const ingredientes = [];
  let pasos = [];
  let params;

  // Ingredientes fijos reales (del inventario) cuando la receta ya se cargó de
  // la API; si no hay datos, se muestran los ingredientes típicos por nombre.
  const fijosReales = Array.isArray(ov.insumosFijos) ? ov.insumosFijos : null;
  const pushFijos = () => fijosReales.forEach(f => ingredientes.push({ label: f.label, cantidad: formatCantidad(f.cantidad, f.unidad) }));

  if (product.tipo === 'frappe') {
    if (product.coffeeType) ingredientes.push({ label: coffeeLabel, cantidad: `${gramaje} g` });
    const lecheFr = lecheMlPara(size, ov);
    if (fijosReales) {
      if (product.leche !== false) ingredientes.push({ label: milkLabel, cantidad: `${lecheFr} ml` });
      pushFijos();
    } else {
      const hielo = { 8: 120, 12: 180, 16: 240 }[size] || 180;
      ingredientes.push({ label: milkLabel, cantidad: `${lecheFr} ml` });
      ingredientes.push({ label: 'Hielo', cantidad: `${hielo} g` });
      ingredientes.push({ label: 'Base de frappé', cantidad: '30 ml' });
      if (product.name.includes('Oreo')) ingredientes.push({ label: 'Galleta Oreo triturada', cantidad: '2 piezas' });
    }
    extras.forEach(ex => ingredientes.push(extraIngredient(ex)));
    ingredientes.push({ label: `Vaso frío ${size} oz`, cantidad: '1 pieza' });
    ingredientes.push({ label: `Tapa domo ${size} oz`, cantidad: '1 pieza' });
    ingredientes.push({ label: 'Popote ancho', cantidad: '1 pieza' });

    if (ov.pasos && ov.pasos.length) {
      pasos = [...ov.pasos];
    } else {
      pasos.push('Agregar café molido, leche, hielo y base al vaso licuador');
      pasos.push('Licuar a velocidad alta 25-30 segundos hasta lograr textura cremosa');
      pasos.push('Servir en vaso frío');
      if (product.name.includes('Oreo')) pasos.push('Decorar con galleta Oreo triturada');
      if (extras.length) pasos.push('Agregar extras seleccionados');
      pasos.push('Colocar tapa domo y popote');
    }

    params = {
      type: 'frappe',
      fields: [
        { label: 'Molienda', value: ov.molienda || 'Gruesa' },
        { label: 'Tiempo de licuado', value: ov.tiempoLicuado || ov.tiempoExtraccion || '25-30 s' },
        { label: 'Rendimiento', value: '1 vaso' },
        { label: 'Temperatura', value: ov.temperatura || 'Frío / con hielo' },
      ],
    };
  } else {
    ingredientes.push({ label: coffeeLabel, cantidad: `${gramaje} g` });
    if (product.leche) ingredientes.push({ label: milkLabel, cantidad: `${lecheMlPara(size, ov)} ml` });
    if (fijosReales) {
      pushFijos();
    } else {
      if (product.name.includes('Moka')) ingredientes.push({ label: 'Chocolate', cantidad: '20 g' });
      if (product.name.includes('Caramel')) ingredientes.push({ label: 'Jarabe de caramelo', cantidad: '15 ml' });
      if (product.name.includes('Tonic')) { ingredientes.push({ label: 'Agua tónica', cantidad: '150 ml' }); ingredientes.push({ label: 'Hielo', cantidad: '100 g' }); }
    }
    extras.forEach(ex => ingredientes.push(extraIngredient(ex)));
    if (product.sizes) {
      ingredientes.push({ label: `Vaso ${product.frio ? 'frío' : 'caliente'} ${size} oz`, cantidad: '1 pieza' });
      ingredientes.push({ label: `Tapa ${size} oz`, cantidad: '1 pieza' });
    } else {
      ingredientes.push({ label: `Taza/vaso ${product.frio ? 'frío' : 'caliente'}`, cantidad: '1 pieza' });
    }
    if (product.frio) ingredientes.push({ label: 'Popote', cantidad: '1 pieza' });

    if (ov.pasos && ov.pasos.length) {
      pasos = [...ov.pasos];
    } else {
      pasos.push('Moler el café justo antes de preparar');
      pasos.push(`Tarar y dosificar ${gramaje} g de café molido`);
      pasos.push(`Extraer espresso ${shots > 1 ? 'doble' : 'sencillo'}`);
      if (product.leche) pasos.push('Vaporizar y texturizar la leche a 60-65°C');
      pasos.push(product.frio ? 'Servir sobre hielo' : 'Verter sobre el café en el vaso');
      if (extras.length) pasos.push('Agregar extras seleccionados');
      pasos.push('Colocar tapa y entregar a la barra de pedidos');
    }

    const moliendaDefault = sel.coffeeType === 'especial' ? 'Media (origen)' : 'Media-fina';
    const ajusteDefault = sel.coffeeType === 'especial' ? '4.2' : '3.5';
    params = {
      type: 'espresso',
      fields: [
        { label: 'Gramaje', value: `${gramaje} g` },
        { label: 'Molienda', value: sel.coffeeType === 'especial' ? (ov.moliendaEspecial || moliendaDefault) : (ov.molienda || moliendaDefault) },
        { label: 'Ajuste molino', value: sel.coffeeType === 'especial' ? (ov.ajusteMolinoEspecial || ajusteDefault) : (ov.ajusteMolino || ajusteDefault) },
        { label: 'Tiempo extracción', value: (sel.coffeeType === 'especial' ? (ov.tiempoExtraccionEspecial || ov.tiempoExtraccion) : ov.tiempoExtraccion) || (shots > 1 ? '50-55 s' : '26-30 s') },
        { label: 'Rendimiento', value: `${gramaje * 2} g aprox` },
        { label: 'Temperatura', value: ov.temperatura || (product.frio ? '92°C / servir frío' : '92°C') },
      ],
    };
  }

  return { ingredientes, pasos, params };
}
