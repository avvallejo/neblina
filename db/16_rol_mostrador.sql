-- ============================================================================
-- MIGRACIÓN 16 — ROL "MOSTRADOR" (CAJA + BARRA EN LA MISMA PERSONA)
-- ============================================================================
-- En sucursales chicas la misma persona levanta el pedido, cobra y prepara.
-- El rol `mostrador` reúne los permisos de cajero Y de barista: la API lo
-- acepta donde acepta cualquiera de los dos (middleware requireRole y
-- políticas de pago/descuento) y el frontend le muestra Caja y Barra con un
-- botón para cambiar entre ambas. No se toca ningún dato existente.
-- Requiere 00-15. Re-ejecutable.
-- ============================================================================

ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'mostrador';

COMMENT ON TYPE rol_usuario IS 'admin (general si sucursal_id es NULL), cajero, barista, mostrador (= cajero + barista, para sedes donde la misma persona cobra y prepara).';
