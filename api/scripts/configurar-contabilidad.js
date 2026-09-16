// Configuración inicial de contabilidad y mayordomía de una sede.
//   node scripts/configurar-contabilidad.js <uuid-sede>            → valida y REVIERTE (ensayo)
//   node scripts/configurar-contabilidad.js <uuid-sede> --apply    → aplica
// Deja lista la sede con las decisiones del negocio:
//   * diezmo 10 % y ofrenda 5 % sobre la utilidad NETA de cada mes;
//   * la contabilidad cuenta desde el 1 de septiembre de 2026;
//   * gastos fijos mensuales "Sueldo del dueño" ($6,000) y "Pago de préstamo"
//     ($6,000), cada uno ligado a su cuenta contable y pagadero desde el banco;
//   * fecha del saldo inicial de Caja y Banco (el monto lo captura el admin).
// Los valores se pueden cambiar con variables de entorno (SUELDO, PRESTAMO,
// DIEZMO, OFRENDA, INICIO). Requiere la migración 32. Idempotente.
const { pool } = require('../src/db');

const DIEZMO = Number(process.env.DIEZMO ?? 10);
const OFRENDA = Number(process.env.OFRENDA ?? 5);
const INICIO = process.env.INICIO || '2026-09-01';
const SUELDO = Number(process.env.SUELDO ?? 6000);
const PRESTAMO = Number(process.env.PRESTAMO ?? 6000);

async function main() {
  const sede = process.argv[2];
  const aplicar = process.argv.includes('--apply');
  if (!sede || !/^[0-9a-f-]{36}$/i.test(sede)) throw new Error('Indica el UUID de la sucursal: node scripts/configurar-contabilidad.js <uuid-sede> [--apply]');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(INICIO)) throw new Error('INICIO debe ser AAAA-MM-DD.');
  const c = await pool.connect();
  const resumen = { sede, aplicado: aplicar, configuracion: {}, gastosFijos: [], cuentasDinero: [], omitidos: [] };
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`conta-config:${sede}`]);
    const { rows: [suc] } = await c.query('SELECT id, nombre FROM sucursales WHERE id = $1', [sede]);
    if (!suc) throw new Error('No existe esa sucursal.');
    const { rows: [tabla] } = await c.query("SELECT 1 AS ok FROM information_schema.tables WHERE table_name = 'egresos'");
    if (!tabla) throw new Error('Falta la migración 32 (contabilidad). Corre bash db/migrar.sh primero.');
    await c.query('SELECT fn_contabilidad_semilla($1)', [sede]); // por si la sede es anterior a la migración
    const uno = async (sql, params) => (await c.query(sql, params)).rows[0];
    const cuenta = async clave => {
      const row = await uno('SELECT id, nombre FROM cuentas_contables WHERE sucursal_id = $1 AND clave = $2', [sede, clave]);
      if (!row) throw new Error(`Falta la cuenta contable "${clave}" en esta sede.`);
      return row;
    };
    const banco = await uno("SELECT id, nombre FROM cuentas_dinero WHERE sucursal_id = $1 AND clave = 'banco'", [sede]);
    const caja = await uno("SELECT id, nombre FROM cuentas_dinero WHERE sucursal_id = $1 AND clave = 'caja'", [sede]);

    // 1. Porcentajes de mayordomía y fecha de arranque.
    for (const [clave, valor] of [['diezmo_porcentaje', DIEZMO], ['ofrenda_porcentaje', OFRENDA], ['contabilidad_inicio', INICIO]]) {
      await c.query(
        `INSERT INTO configuracion (sucursal_id, clave, valor, actualizado_en) VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (sucursal_id, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
        [sede, clave, JSON.stringify(valor)]);
      resumen.configuracion[clave] = valor;
    }

    // 2. Gastos fijos del dueño: sueldo y préstamo.
    for (const g of [
      { concepto: 'Sueldo del dueño', categoria: 'Personal', monto: SUELDO, clave: 'sueldo_dueno', dia: 1 },
      { concepto: 'Pago de préstamo', categoria: 'Financiero', monto: PRESTAMO, clave: 'prestamo', dia: 1 },
    ]) {
      if (!(g.monto > 0)) { resumen.omitidos.push(`${g.concepto} (monto 0)`); continue; }
      const cc = await cuenta(g.clave);
      const ya = await uno('SELECT id FROM gastos_fijos WHERE sucursal_id = $1 AND lower(concepto) = lower($2)', [sede, g.concepto]);
      if (ya) {
        await c.query('UPDATE gastos_fijos SET monto_mensual = $2, categoria = $3, cuenta_contable_id = $4, cuenta_dinero_id = COALESCE(cuenta_dinero_id, $5), dia_pago = $6, activo = true WHERE id = $1',
          [ya.id, g.monto, g.categoria, cc.id, banco ? banco.id : null, g.dia]);
        resumen.omitidos.push(`${g.concepto} (ya existía; monto y cuenta actualizados)`);
      } else {
        await c.query(
          `INSERT INTO gastos_fijos (concepto, categoria, monto_mensual, sucursal_id, cuenta_contable_id, cuenta_dinero_id, dia_pago)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`, [g.concepto, g.categoria, g.monto, sede, cc.id, banco ? banco.id : null, g.dia]);
      }
      resumen.gastosFijos.push(`${g.concepto} $${g.monto}/mes → ${cc.nombre}${banco ? ` · se paga con ${banco.nombre}` : ''} (día ${g.dia})`);
    }

    // 3. Fecha del saldo inicial de Caja y Banco (el monto lo captura el admin).
    for (const cd of [caja, banco]) {
      if (!cd) continue;
      const { rows } = await c.query('UPDATE cuentas_dinero SET fecha_saldo_inicial = $2 WHERE id = $1 AND fecha_saldo_inicial IS NULL RETURNING id', [cd.id, INICIO]);
      if (rows.length) resumen.cuentasDinero.push(`${cd.nombre}: saldo inicial fechado al ${INICIO} (captura el monto en Contabilidad → Cuentas)`);
      else resumen.omitidos.push(`${cd.nombre} (ya tenía fecha de saldo inicial)`);
    }

    // 4. Efecto en precios: los gastos fijos entran al costo indirecto por unidad.
    const { rows: [costos] } = await c.query(
      `SELECT fn_gastos_fijos_totales_mes($1) AS gastos_mes, fn_costo_fijo_unitario($1) AS indirecto,
              (SELECT unidades_estimadas_mes FROM configuracion_margen WHERE sucursal_id = $1 ORDER BY actualizado_en DESC LIMIT 1) AS unidades`, [sede]);
    resumen.costos = {
      gastosFijosMes: Number(costos.gastos_mes),
      unidadesEstimadasMes: costos.unidades === null ? null : Number(costos.unidades),
      costoIndirectoPorUnidad: costos.indirecto === null ? null : Number(costos.indirecto),
      nota: costos.unidades
        ? 'El sueldo y el préstamo entran al costo indirecto de cada producto: revisa "precios por revisar" en Productos.'
        : 'Sin "unidades estimadas al mes" (Costos → Margen y volumen) los gastos fijos no se reparten en el precio.',
    };

    await c.query(aplicar ? 'COMMIT' : 'ROLLBACK');
    resumen.sucursal = suc.nombre;
    resumen.siguiente = aplicar
      ? 'En Contabilidad → Cuentas captura el saldo inicial de Caja y Banco; en Egresos confirma los gastos fijos del mes y registra los gastos ya pagados de septiembre; al terminar el mes, ciérralo.'
      : 'Ensayo sin cambios. Vuelve a correr con --apply para aplicar.';
    console.log(JSON.stringify(resumen, null, 2));
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
