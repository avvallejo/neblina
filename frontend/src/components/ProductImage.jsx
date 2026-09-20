import React, { useState } from 'react';
import { productEmoji } from '../lib/productEmojis.js';

// La foto cargada tiene prioridad; el emoji se usa si no hay foto.
export default function ProductImage({ product, size = '1.5em' }) {
  const [failedImage, setFailedImage] = useState(null);
  return product?.imagen && product.imagen !== failedImage
    ? <img src={product.imagen} onError={() => setFailedImage(product.imagen)} alt={product.name || ''} style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle', borderRadius: 6 }} />
    : <span aria-hidden="true">{productEmoji(product)}</span>;
}
