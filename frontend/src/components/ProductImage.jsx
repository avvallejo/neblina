import React from 'react';

// La foto cargada tiene prioridad; el emoji se usa si no hay foto.
export default function ProductImage({ product, size = '1.5em' }) {
  return product?.imagen
    ? <img src={product.imagen} alt={product.name || ''} style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle', borderRadius: 6 }} />
    : <>{product?.icon || '☕'}</>;
}
