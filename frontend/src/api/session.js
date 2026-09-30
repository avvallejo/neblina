// El contenido sin firma solo sirve para sincronizar la UI. La API verifica
// firma, caducidad, usuario activo y versión en cada petición.
export function sessionClaims(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { return null; }
}
export function newerSameSession(current, candidate) {
  const a=sessionClaims(current),b=sessionClaims(candidate);
  return !!(a&&b&&a.tipo==='staff'&&b.tipo==='staff'&&a.id===b.id&&a.suc===b.suc&&a.ver===b.ver&&b.exp>a.exp);
}
