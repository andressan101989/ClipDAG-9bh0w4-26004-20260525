# LB4-F8-A-C1 — idempotencia y journal canónico

Base exacta: `codex/lb4-f8-a-live-battle-commission`, `f86a97b370e3b8b34e554c22e541b352bfc6b766`.
Rama correctiva: `codex/lb4-f8-a-c1-idempotency-ledger-integrity`.
Integración preservada: `9616f7ce5998017233b15d9eeb39740112e4bec6`.
El SHA del único commit correctivo se obtiene con `git rev-parse HEAD` en esta rama.

Antes de editar se verificaron base local, upstream, origin y `git ls-remote`: todos coincidentes. El worktree base estaba limpio y el nuevo worktree se creó directamente desde ese SHA. Los cambios de UI del directorio inicial no se tocaron. Supabase MCP `list_projects` identificó ClipDag y `list_migrations` confirmó, exclusivamente en lectura, que `20260905230823_live_gift_platform_commission_35` no estaba aplicada. La última versión registrada era `20260902141502`. No se ejecutó SQL productivo, ni despliegue, integración, force-push, amend, build o Metro.

## Causas y corrección

1. El replay LIVE filtraba por remitente/clave sin excluir Battle. Ahora su WHERE incluye `and gift.battle_id is null`. Se preservan los conflictos por otra sesión/regalo y el prefijo financiero Battle `live_battle:<battleId>:<idempotencyKey>`.
2. LIVE comprobaba sesión y catálogo mutables antes del replay. Ahora el orden es autenticación → clave no vacía y máximo 200 caracteres → advisory transaction lock de remitente/clave → replay/conflicto → autoridad mutable solo para operaciones nuevas. El cliente Battle ya usa ese máximo y las claves normales generadas por el cliente caben en él. El replay devuelve el saldo canónico BDAG actual, sin mover dinero.
3. Las RPC solo contrastaban `fee_collected`, que el núcleo devuelve incluso sin crédito de plataforma. Ambas llaman ahora a `private.verify_live_gift_journal` después del único `atomic_ledger_transfer` y antes del gift/score. Se mantiene la comprobación de respuesta como control adicional, nunca como única evidencia. No se reemplaza ni cambia el núcleo global.

La función exige cuentas de usuario con identidad, tipo y BDAG canónicos, y plataforma `owner_id IS NULL`, tipo `platform`, BDAG cuando fee > 0. Usa `INTO STRICT`, sin `LIMIT 1`. Comprueba todos los campos financieros esperados: origen, destino, iniciador, bruto, fee, moneda, estado completed, operación live_gift, clave y referencia. El journal debe contener exactamente un débito bruto, un crédito neto y un crédito de comisión positiva, o solo dos asientos cuando fee=0; ningún importe nulo/no positivo; suma firmada cero; un único txn_id y ninguna entrada ajena a ese journal. Un incumplimiento genera `55000 / live_gift_journal_invalid`; la excepción revierte toda la solicitud.

Privilegios: función privada `SECURITY INVOKER`, propietaria `postgres`, `search_path = ''`, nombres calificados, sin EXECUTE para PUBLIC, anon, authenticated o service_role. Las dos RPC conservan SECURITY DEFINER y la frontera autenticada. ACL y propietario se comprueban en PostgreSQL.

## Evidencia roja anterior a la implementación

- [red-structural.json](red-structural.json): 15 tests, 12 aprobados, 3 fallidos; 0 cancelados/skips/todo.
- [red-postgres.json](red-postgres.json): LIVE devuelve ID Battle, con 1 gift/1 transacción/3 asientos en vez de 2/2/6; replay cerrado rechaza con `live session is not active`; ausencia/cuenta de usuario/moneda incorrecta, en ambas RPC, devuelven `fee_collected=2` con `canonical_platform_credits=0`. También reproduce la aceptación incorrecta de una clave >200.

Los fallos se recogen en subtransacciones independientes para observarlos todos. La ejecución roja termina con error, no se declara aprobada; el cierre de la conexión revierte su transacción. El archivo del proof termina siempre en `rollback;`.

## Evidencia verde

| Caso | Viewer | Creador | Plataforma | Asientos | Score | Rosas |
|---|---:|---:|---:|---:|---:|---:|
| LIVE rosa 5 | -5 | +3 | +2 | 3 | — | — |
| Battle rosa 5 x1 | -5 | +3 | +2 | 3 | +5 | +1 |
| Battle rosa 5 x2 | -5 | +3 | +2 | 3 | +10 | +1 |
| LIVE 1 moneda | -1 | +1 | 0 | 2 | — | — |

Los cinco ejemplos 1/5/10/20/100 conservan netos 1/3/6/13/65 y comisiones 0/2/4/7/35. La fórmula permanece `floor((gross * 3500 + 5000) / 10000)`; multiplicadores solo afectan score bruto.

[green-postgres.json](green-postgres.json) contiene el proof original y 11 casos C1 aprobados, con ROLLBACK final. El bloque original verifica 3 gifts, 3 transacciones, 8 asientos y 1 score event. Cada caso C1 adicional se revierte aisladamente, incluso cuando pasa. El cruce usa el mismo sender/key primero en Battle y después en LIVE: 2 gifts, 2 transacciones, 6 asientos, journals separados/balanceados e IDs propios en ambos retries. Cerrar sesión y desactivar catálogo conserva ID y saldo actual, con cero movimientos adicionales. Conflictos, saldo insuficiente y seis variantes de plataforma inválida conservan íntegros balances, gifts, transacciones, ledger, idempotencia, score, boosts y power/rosas.

[concurrency.json](concurrency.json): dos clientes autenticados reales; misma clave LIVE → una operación/3 asientos; claves distintas → dos operaciones; Battle concurrente → 1 gift, 1 score event, score 5 y 1 rosa; cruce → 2/2/6 y un crédito canónico de plataforma en cada journal; replay cerrado → 0/0/0 adicionales y saldo actual 75; saldo para un regalo → 1 éxito, 1 rechazo, saldo 0. Fixtures eliminados al terminar.

## Regresión y límites

| Suite | Aprobados / ejecutados | Fallos / skips / cancelados / todo |
|---|---:|---:|
| F8-A/C1 | 15/15 | 0/0/0/0 |
| Finanzas/wallet/ledger/gifts | 98/98 | 0/0/0/0 |
| Live Battles | 402/402 | 0/0/0/0 |
| F6/F7 | 77/77 | 0/0/0/0 |
| Global Node (`tests/*.test.mjs`) | 1544/1544 | 0/0/0/0 |

También pasó `callPresentationPolicy.test.ts`, ejecutado con transpilación en memoria. El script separado `mediaConcurrencyRemote.test.ps1` no se ejecutó porque escribe en producción; no forma parte de la suite Node y no se cuenta como aprobado.

TypeScript `tsc --noEmit --pretty false`: salida 2 en base y C1, 237 diagnósticos en cada una, cero añadidos/eliminados tras normalizar únicamente el prefijo absoluto de worktree. No se presenta como TypeScript limpio.

Supabase `db lint --schema public,private,auth --level warning --fail-on none`, apuntado explícitamente a 127.0.0.1:55438: base y C1 tienen los mismos 25 hallazgos (11 warning, 7 warning extra, 7 error). Cero nuevos/eliminados; cero en split, verifier o RPC de gifts. Se alternaron base y candidato en la misma base desechable, restaurando C1 al terminar. `--fail-on none` permite recopilar todos los diagnósticos históricos, no convierte los errores en aprobación. [Comparación exacta](diagnostic-comparison.json), [base lint](db-lint-base.json), [C1 lint](db-lint-c1.json), [base TS](typescript-base.json), [C1 TS](typescript-c1.json).

PostgreSQL local: imagen Supabase `17.6.1.143` (servidor PostgreSQL 17.6), contenedor exclusivo C1. Se restauró un snapshot local de esquema F4D-A, sin datos productivos, y se aplicaron las migraciones posteriores del repositorio. Los datos estáticos del catálogo se reconstruyeron de sus SQL históricos exclusivamente en el fixture; ningún archivo de catálogo/precios cambió. El bootstrap necesitó pg_cron y el rol postgres para cargar F5 histórico; sus trabajos locales se desactivaron. Los diagnósticos de esquema histórico/desprovisto de extensiones externas están incluidos en la comparación, no atribuidos a C1. No hubo lectura de datos ni SQL productivos durante la preparación.

`git diff --check` aprobado. [Hashes SHA-256 normalizados a LF](lf-hashes.json): los once protegidos coinciden exactamente; hash de migración C1 `63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89`.

## Documentación consultada

Se usó la skill oficial Supabase. El [changelog](https://supabase.com/changelog) no indicó cambios aplicables a estas funciones. Documentación vigente de [funciones, SECURITY DEFINER, search_path y ACL](https://supabase.com/docs/guides/database/functions), [pruebas de base de datos](https://supabase.com/docs/guides/database/testing), [excepciones y rollback de subtransacciones](https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING) y [advisory transaction locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS). No se consultaron documentos de otros cambios económicos o servicios.
