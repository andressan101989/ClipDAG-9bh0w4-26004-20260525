// One factual explanation for the two existing mobile Settings entry points.
// The present action is informational: it does not submit a request or mutate account data.
export const accountDeletionNotice = Object.freeze({
  effect: 'information_only',
  title: 'Información sobre eliminación de cuenta',
  message: 'Esta pantalla no elimina tu cuenta ni envía una solicitud. No modifica tus datos ni tu saldo. Los canales oficiales de contacto se mostrarán cuando estén verificados.',
  actionLabel: 'Entendido',
  rowLabel: 'Eliminación de cuenta',
  rowSublabel: 'Información; no se elimina desde aquí',
});
