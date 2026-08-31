// Modal de receta (barista/cliente/admin) y modal de merma.
import React, { useState, useEffect } from 'react';
import {
  ChevronLeft, ClipboardList, Droplets, Sparkles, Check, X, Pencil,
  Coffee, Clock, Thermometer, CupSoda, Milk, Gauge as GaugeIcon,
} from 'lucide-react';
import * as api from '../api/client.js';
import { getProduct, labelOf, SIZE_OPTIONS, MERMA_MOTIVOS, customizationSummary } from '../lib/catalog.js';
import { buildRecipe } from '../lib/recipes.js';
import { Sheet, Stepper } from './ui.jsx';

function iconForParam(label) {
  const l = label.toLowerCase();
  if (l.includes('gramaje')) return Coffee;
  if (l.includes('molienda')) return Sparkles;
  if (l.includes('ajuste')) return GaugeIcon;
  if (l.includes('tiempo') || l.includes('licuado')) return Clock;
  if (l.includes('rendimiento')) return Droplets;
  if (l.includes('temperatura')) return Thermometer;
  return Coffee;
}

export function RecipeModal({ ticket, onClose, onFinish, readOnly, override, onEdit }) {
  const product = getProduct(ticket.productId);
  const recipe = buildRecipe(product, ticket, override);
  const sizeLabel = product?.sizes ? labelOf(SIZE_OPTIONS, ticket.size || '12') : '—';
  const lecheIng = recipe.ingredientes.find(i => i.label.toLowerCase().includes('leche'));
  const texturaLeche = (override && override.texturaLeche) || 'Microespuma suave y sedosa';
  const showFicha = recipe.params.fields.length > 0;
  const showTextura = !!lecheIng && product?.tipo === 'bebida';

  const specRows = [
    { Icon: CupSoda, label: 'Tamaño de taza', value: sizeLabel },
    ...recipe.params.fields.map(f => ({ Icon: iconForParam(f.label), label: f.label, value: f.value })),
    ...(lecheIng ? [{ Icon: Milk, label: 'Leche', value: lecheIng.cantidad }] : []),
    ...(showTextura ? [{ Icon: Sparkles, label: 'Textura de la leche', value: texturaLeche }] : []),
    ...(product?.tipo === 'bebida' ? [{ Icon: GaugeIcon, label: 'Presión', value: '9 Bar' }] : []),
  ];

  return (
    <>
      <div className="recipe-modal-backdrop" onClick={onClose} />
      <div className="recipe-modal">
        <div className="recipe-header">
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><ChevronLeft size={20} /></button>
          <div className="recipe-header-title">{readOnly ? product?.name : (ticket.folio || '')}</div>
          <div style={{ width: 40 }} />
        </div>

        <div className="recipe-hero">
          <span className="recipe-hero-icon">{product?.icon}</span>
          <h2>{product?.name}</h2>
          <span className="recipe-hero-sub">{customizationSummary(ticket) || 'Estándar'}</span>
        </div>

        {ticket.notas && <div className="recipe-section"><div className="order-notes">"{ticket.notas}"</div></div>}

        {showFicha && (
          <div className="recipe-section">
            <div className="recipe-section-title"><ClipboardList size={15} /> Ficha técnica</div>
            <div className="spec-table">
              {specRows.map((row, i) => (
                <div key={i} className="spec-row">
                  <span className="spec-icon"><row.Icon size={16} /></span>
                  <span className="spec-label">{row.label}</span>
                  <span className="spec-value">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="recipe-section">
          <div className="recipe-section-title"><Droplets size={15} /> Ingredientes</div>
          <div className="ingredient-list">
            {recipe.ingredientes.map((ing, i) => (
              <div key={i} className="ingredient-row"><span>{ing.label}</span><span className="ingredient-qty">{ing.cantidad}</span></div>
            ))}
          </div>
        </div>

        {showTextura && (
          <div className="recipe-section">
            <div className="recipe-section-title"><Sparkles size={15} /> Guía de textura de la leche</div>
            <div className="texture-guide">
              <div className="texture-row good">
                <Check size={16} className="texture-icon" />
                <div className="texture-text"><strong>Perfecta</strong><span>Brillante y sedosa, sin burbujas grandes.</span></div>
              </div>
              <div className="texture-row bad">
                <X size={16} className="texture-icon" />
                <div className="texture-text"><strong>Demasiado aire</strong><span>Burbujas grandes, textura aireada.</span></div>
              </div>
              <div className="texture-row bad">
                <X size={16} className="texture-icon" />
                <div className="texture-text"><strong>Demasiado líquida</strong><span>Aguada, sin cuerpo ni brillo.</span></div>
              </div>
            </div>
          </div>
        )}

        <div className="recipe-section">
          <div className="recipe-section-title"><ClipboardList size={15} /> Pasos de preparación</div>
          <div className="steps-list">
            {recipe.pasos.map((p, i) => (
              <div key={i} className="step-row"><span className="step-num">{i + 1}</span><span>{p}</span></div>
            ))}
          </div>
        </div>

        <div className="finish-btn-wrap">
          {readOnly ? (
            <div className="recipe-footer-actions">
              {onEdit && <button className="btn-secondary" onClick={onEdit}><Pencil size={14} /> Editar receta</button>}
              <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Volver</button>
            </div>
          ) : ticket.status === 'terminado' ? (
            <div className="already-done"><Check size={16} /> Bebida terminada</div>
          ) : (
            <button className="finish-btn" onClick={onFinish}><Check size={18} /> Terminar bebida</button>
          )}
        </div>
      </div>
    </>
  );
}

export function MermaModal({ ticket, onClose, onSave }) {
  const [materias, setMaterias] = useState([]);
  const [materiaId, setMateriaId] = useState(null);
  const [motivo, setMotivo] = useState(MERMA_MOTIVOS[0]);
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState('');

  useEffect(() => {
    api.getMaterias()
      .then(rows => {
        const activas = rows.filter(m => m.activo !== false);
        setMaterias(activas);
        if (activas[0]) setMateriaId(activas[0].id);
      })
      .catch(() => {});
  }, []);

  const materia = materias.find(m => m.id === materiaId);

  return (
    <Sheet title="Registrar merma" onClose={onClose}>
      <div className="option-group">
        <div className="option-label">Insumo afectado</div>
        <div className="option-row">
          {materias.length === 0
            ? <span style={{ color: 'var(--ink-faint)', fontSize: 12 }}>Cargando insumos…</span>
            : materias.map(m => (
                <button key={m.id} className={`option-chip ${materiaId === m.id ? 'selected' : ''}`} onClick={() => setMateriaId(m.id)}>{m.nombre}</button>
              ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Motivo</div>
        <div className="option-row">
          {MERMA_MOTIVOS.map(m => (
            <button key={m} className={`option-chip ${motivo === m ? 'selected' : ''}`} onClick={() => setMotivo(m)}>{m}</button>
          ))}
        </div>
      </div>
      <div className="option-group">
        <div className="option-label">Cantidad {materia ? `(${materia.unidad})` : ''}</div>
        <Stepper value={cantidad} onChange={setCantidad} />
      </div>
      <div className="option-group">
        <div className="option-label">Observación (opcional)</div>
        <textarea className="notes-input" rows={2} value={nota} onChange={e => setNota(e.target.value)} />
      </div>
      <div className="sheet-footer">
        <span />
        <button className="btn-danger" disabled={!materia} onClick={() => {
          onSave({
            materiaPrimaId: materia.id,
            cantidad,
            unidad: materia.unidad,
            motivo,
            observacion: nota || undefined,
            pedidoItemId: ticket ? ticket.id : undefined,
          });
          onClose();
        }}>
          Registrar merma
        </button>
      </div>
    </Sheet>
  );
}
