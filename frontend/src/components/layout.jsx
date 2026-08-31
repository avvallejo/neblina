// Armazón adaptable: barra lateral (escritorio), riel (tablet) y navegación
// inferior (móvil), con topbar por pantalla.
import React from 'react';
import { Coffee, LogOut, Building2 } from 'lucide-react';

// items: [{ id, label, Icon, badge? }]
export function AppShell({
  brand, // { nombre, logo }
  items, active, onSelect,
  user, roleLabel,
  sedeNombre,          // sede fija (personal)
  sedes, sedeActiva, onChangeSede, // switcher (solo admin general)
  onLogout,
  title, subtitle, topRight, children, wide,
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className={`brand-mark${brand?.logo ? ' has-logo' : ''}`}>
            {brand?.logo ? <img src={brand.logo} alt="" /> : <Coffee size={22} />}
          </span>
          <div>
            <div className="sidebar-brand-name">{brand?.nombre || 'Mi Cafetería'}</div>
            <div className="sidebar-brand-sub">{roleLabel}</div>
          </div>
        </div>

        {sedes && sedes.length > 0 && (
          <div className="sede-switcher" style={{ marginBottom: 12 }}>
            <label><Building2 size={12} /><span>Sucursal activa</span></label>
            <select value={sedeActiva || ''} onChange={e => onChangeSede(e.target.value)}>
              {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}

        <nav className="sidebar-nav">
          {items.map(it => (
            <button key={it.id} className={`nav-item ${active === it.id ? 'active' : ''}`} onClick={() => onSelect(it.id)}>
              <it.Icon size={19} />
              <span className="nav-label">{it.label}</span>
              {it.badge > 0 && <span className="nav-badge">{it.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {user && (
            <div className="sidebar-user">
              <span className={`usuario-avatar role-${user.rol || 'admin'}`}>{(user.nombre || '?').charAt(0).toUpperCase()}</span>
              <div>
                <div className="sidebar-user-name">{user.nombre}</div>
                <div className="sidebar-user-role">{sedeNombre || roleLabel}</div>
              </div>
            </div>
          )}
          {onLogout && (
            <button className="sidebar-logout" onClick={onLogout}><LogOut size={16} /><span>Salir</span></button>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <div>
              <div className="topbar-title">{title}</div>
              {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
            </div>
          </div>
          <div className="topbar-right">
            {topRight}
            {/* En móvil no hay barra lateral: el botón de salir vive aquí. */}
            {onLogout && (
              <button className="topbar-logout" aria-label="Cerrar sesión"
                      onClick={() => { if (window.confirm('¿Cerrar la sesión?')) onLogout(); }}>
                <LogOut size={16} /><span>Salir</span>
              </button>
            )}
          </div>
        </header>
        <main className={`page${wide ? ' wide' : ''}`}>{children}</main>
      </div>

      <nav className="bottomnav">
        <div className="bottomnav-inner">
          {items.map(it => (
            <button key={it.id} className={`tab-btn ${active === it.id ? 'active' : ''}`} onClick={() => onSelect(it.id)}>
              <span className="tab-icon-badge">
                <it.Icon size={20} />
                {it.badge > 0 && <span className="badge-count">{it.badge}</span>}
              </span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
