import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import MenuBoard from './screens/MenuBoard.jsx';
const TableQr = React.lazy(() => import('./screens/TableQr.jsx'));
const PrintableMenu = React.lazy(() => import('./screens/PrintableMenu.jsx'));
import './index.css';

// ?pantalla=menu convierte esta URL en la PANTALLA DEL NEGOCIO (menú para una
// TV del local, con refresco automático). Cualquier otra URL carga la app.
const params = new URLSearchParams(window.location.search);
const esPantallaMenu = params.get('pantalla') === 'menu';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {params.get('pantalla') === 'qr-mesas' ? <React.Suspense fallback={<p>Preparando QR…</p>}><TableQr sucursalId={params.get('sucursal')}/></React.Suspense> : params.get('pantalla') === 'carta' ? <MenuBoard carta mesa={params.get('mesa')} sucursalId={params.get('sucursal')}/> : params.get('pantalla') === 'imprimir' ? <React.Suspense fallback={<p>Cargando menú imprimible…</p>}><PrintableMenu sucursalId={params.get('sucursal')}/></React.Suspense> : esPantallaMenu ? <MenuBoard sucursalId={params.get('sucursal')} /> : <App />}
  </React.StrictMode>
);
