// Textos legibles para la bitácora (sin dependencias de React: se prueba con node --test).

const ACCIONES = {
  'materias-primas|crear': 'Dio de alta un insumo',
  'materias-primas|editar': 'Editó un insumo',
  'materias-primas|eliminar': 'Eliminó un insumo',
  'materias-primas|ajustar-stock': 'Ajustó existencias (conteo)',
  'materias-primas|salida-interna': 'Registró una salida interna',
  'materias-primas|lotes': 'Registró una compra',
  'compras|anular': 'Anuló una compra por error',
  'ajustes-inventario|descartar-costo': 'Quitó el costo de un ajuste (error de captura)',
  'mermas|crear': 'Registró una merma',
  'ajustes-inventario|editar': 'Corrigió un ajuste',
  'contabilidad|egresos/anular': 'Anuló un egreso',
  'contabilidad|egresos': 'Registró un egreso',
  'auth|login': 'Entró al sistema',
  'usuarios|crear': 'Creó un usuario',
  'usuarios|editar': 'Editó un usuario',
};

export function etiquetaAccion(entidad, accion, ruta = '') {
  if (ruta === '/api/auth/login') return 'Entró al sistema';
  return ACCIONES[`${entidad}|${accion}`] || `${accion || 'acción'} · ${entidad || ''}`.trim();
}

const CAMBIOS = {
  'materias_primas:crear': 'Dio de alta un insumo',
  'materias_primas:editar': 'Editó un insumo',
  'materias_primas:eliminar': 'Eliminó un insumo',
  'lotes:registrar_compra': 'Registró una compra',
  'lotes:anular_compra': 'Anuló una compra por error',
  'ajustes_stock:ajustar_stock': 'Ajustó existencias',
  'ajustes_stock:revertir': 'Revirtió un ajuste',
  'ajustes_stock:descartar_costo': 'Quitó el costo de un ajuste (error de captura)',
  'ajustes_stock:corregir': 'Corrigió fecha/motivo de un ajuste',
  'egresos:anular': 'Anuló un egreso',
};
export function etiquetaCambio(entidad, accion) {
  return CAMBIOS[`${entidad}:${accion}`] || `${accion} · ${entidad}`;
}

const NOMBRES_CAMPO = {
  nombre: 'Nombre', unidad: 'Unidad', stock_actual: 'Existencias', stock_minimo: 'Mínimo', stock_maximo: 'Máximo',
  costo_unitario: 'Costo unitario', activo: 'Activo', requiere_lote: 'Por lote', requiere_caducidad: 'Caducidad',
  cantidad: 'Cantidad', costoTotal: 'Costo total', stockAntes: 'Existencias antes', stockDespues: 'Existencias después',
  diferencia: 'Diferencia', insumo: 'Insumo', fechaContable: 'Fecha contable', registradoPor: 'Registrada por',
  impactoResultados: 'Costo que se quitó del estado de resultados', concepto: 'Concepto', monto: 'Monto',
};
const valor = v => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// "Campo: antes → después" para ediciones planas; un resumen "campo: valor" para altas.
export function resumenCambio(anterior, nuevo) {
  const claves = [...new Set([...Object.keys(anterior || {}), ...Object.keys(nuevo || {})])];
  return claves.map(k => {
    const nombre = NOMBRES_CAMPO[k] || k;
    const a = anterior && k in anterior ? valor(anterior[k]) : null;
    const d = nuevo && k in nuevo ? valor(nuevo[k]) : null;
    if (a !== null && d !== null) return `${nombre}: ${a} → ${d}`;
    return `${nombre}: ${a ?? d}`;
  });
}

export function esRechazada(estadoHttp) { return Number(estadoHttp) >= 400; }
export const ETIQUETAS_TIPO_MOVIMIENTO = { compra: 'Compra', consumo: 'Consumo', merma: 'Merma', ajuste: 'Ajuste', anulacion_compra: 'Compra anulada', correccion_captura: 'Corrección de captura' };
