import React, { useState } from 'react';
import { categoryOf, categoryOptions } from '../lib/tvMenu.js';

export default function TvPersonalizationEditor({ value = {}, onChange, products, options }) {
  const categories = [...new Set(products.filter(p => p.activo !== false).map(categoryOf))];
  const [selected, setSelected] = useState('Calientes');
  const category = categories.includes(selected) ? selected : categories[0];
  const available = categoryOptions(products.filter(p => p.activo !== false && categoryOf(p) === category), options);
  const settings = value[category] || { visible: true, ocultas: [] };
  const update = change => onChange({ ...value, [category]: { ...settings, ...change } });
  const toggle = key => update({ ocultas: settings.ocultas?.includes(key) ? settings.ocultas.filter(k => k !== key) : [...(settings.ocultas || []), key] });
  return <fieldset style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginTop: 18 }}>
    <legend style={{ padding: '0 6px', fontWeight: 700 }}>“Hazlo tuyo” en la televisión</legend>
    <p className="branding-hint" style={{ marginBottom: 12 }}>Elige qué opciones verá el cliente en cada categoría. Solo cambia el menú con imágenes de la TV. Los tamaños no se muestran.</p>
    {category ? <>
      <label className="option-label" htmlFor="tv-extra-category">Categoría</label>
      <select id="tv-extra-category" className="text-input" value={category} onChange={e => setSelected(e.target.value)}>
        {categories.map(cat => <option key={cat}>{cat}</option>)}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', fontWeight: 700 }}>
        <input type="checkbox" checked={settings.visible !== false} onChange={e => update({ visible: e.target.checked })}/> Mostrar “Hazlo tuyo” en {category}
      </label>
      {settings.visible !== false && <>
        {available.length ? available.map(o => <label key={o.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <input type="checkbox" checked={!settings.ocultas?.includes(o.key)} onChange={() => toggle(o.key)}/>
          <span><small style={{ display: 'block', opacity: .7 }}>{o.group}</small>{o.label}</span>
        </label>) : <p className="branding-hint">Esta categoría no tiene opciones habilitadas en sus productos.</p>}
        {available.length > 0 && <p className="branding-hint">Si desmarcas todas las opciones, el panel desaparece y los productos aprovechan el espacio.</p>}
      </>}
    </> : <p className="branding-hint">Agrega productos para elegir las opciones de la pantalla.</p>}
  </fieldset>;
}
