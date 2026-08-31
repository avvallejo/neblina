import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import MenuBoard from './screens/MenuBoard.jsx';
import './index.css';

// ?pantalla=menu convierte esta URL en la PANTALLA DEL NEGOCIO (menú para una
// TV del local, con refresco automático). Cualquier otra URL carga la app.
const params = new URLSearchParams(window.location.search);
const esPantallaMenu = params.get('pantalla') === 'menu';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {esPantallaMenu ? <MenuBoard sucursalId={params.get('sucursal')} /> : <App />}
  </React.StrictMode>
);
