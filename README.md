# ecilost-load-tests

Pruebas de carga de ECILOST contra el entorno **local** (Docker), con bases de datos aisladas
para no tocar los datos de desarrollo.

El backlog no fija metas de rendimiento (supuesto A4: "no se inventa ningun SLA"). Por eso estas
pruebas **miden y reportan** latencias y capacidad, y solo hacen fallar una corrida por:

- el unico requisito con numero: **tiempo real < 1 segundo** (precio, contador y transicion de ronda);
- las garantias de concurrencia del dominio: un unico ganador, ECICoin nunca comprometidos dos
  veces, aforo nunca superado e historial de pujas estrictamente creciente (`scripts/verify.mjs`).

## Aislamiento

Los servicios se levantan contra bases de carga dentro de los mismos contenedores de Docker:

| Servicio | Base de carga | Por que asi |
|---|---|---|
| catalog | esquema `catalog_load` en `ecilost_catalog` | Prisma recibe el esquema desde `?schema=` |
| auction | esquema `auction_load` en `ecilost_auction` | Igual; ademas fija `search_path` para su SQL crudo |
| wallet | base `ecilost_wallet_load` (esquema `wallet`) | Sus migraciones escriben el esquema `"wallet"` a mano |
| engagement | base `ecilost_engagement_load` (esquema `public`) | No le pasa el esquema a su adaptador de Prisma |
| auth | la de desarrollo | Solo publica el JWKS; nadie inicia sesion durante la carga |

Las URLs salen del `.env` de cada servicio (`scripts/lib/config.mjs`); nada de eso se imprime.

## Usuarios sinteticos

El login es solo con Google. `scripts/tokens.mjs` firma tokens con la **llave privada local** de
ecilost-auth-service y el mismo `kid`, issuer y audience que su `TokenService`, asi que los
servicios los aceptan al verificarlos contra el JWKS local. La llave se lee del `.env` de auth y no
se copia ni se imprime. **Solo sirve en local.** Los tokens quedan en `.data/` (no se versiona).

## Requisitos

- Node 22 o superior y Docker Desktop con los contenedores de los servicios
  (`ecilost-*-db`, `ecilost-rabbitmq`).
- Los repos de los servicios junto a este (`../ecilost-<servicio>-service`) con su `.env` y
  `npm install` hecho. Si un servicio no compila tras bajar cambios, regenera su cliente de
  Prisma con `npx prisma generate` en ese repo.
- [k6](https://k6.io) para los escenarios de carga (`winget install k6 --source winget`).

## Uso

```bash
npm install
npm run migrate                     # crea/actualiza las bases *_load (se puede repetir)
```

Levanta cada servicio en su propia terminal (auth primero):

```bash
node scripts/start-service.mjs auth
node scripts/start-service.mjs catalog
node scripts/start-service.mjs wallet
node scripts/start-service.mjs auction
node scripts/start-service.mjs engagement
```

Prueba de humo de la cadena completa:

```bash
node scripts/tokens.mjs --students 5
node scripts/setup.mjs --scenario smoke --students 5 --starts-in 8 --wait-active
node scripts/smoke.mjs
node scripts/verify.mjs
```

### `setup.mjs`

Todo por las APIs de los servicios: billeteras (emision inicial y recarga opcional), objetos en
catalog, la sala con sus rondas y la admision previa. Deja `.data/run.json` para k6 y `verify.mjs`.

| Opcion | Por defecto | Para que |
|---|---|---|
| `--scenario` | `smoke` | Nombre de la corrida |
| `--students` | 5 | Estudiantes que participan (tokens de `tokens.mjs`) |
| `--capacity` | = estudiantes | Aforo de la sala |
| `--rounds` | 1 | Rondas (un objeto por ronda) |
| `--starting-price` | 100 | Precio minimo de cada ronda |
| `--buy-now` | sin compra inmediata | Precio de compra inmediata de cada ronda |
| `--recharge` | 0 | Recarga de staff por estudiante, para pujas grandes |
| `--starts-in` | 20 | Segundos hasta que la sala se abre sola |
| `--admit false` | se admite | No admitir (para medir la admision con k6) |
| `--wait-active` | no | Esperar a que el reloj del servidor abra la sala |

Una ronda dura 3 minutos (8 como maximo con anti-sniping): cada corrida debe caber en ella.

### `verify.mjs`

Consultas de solo lectura sobre las bases de carga, limitadas a la sala de la corrida. Cada
comprobacion termina en `OK`, `AVISO` (esperable pero conviene mirarlo, por ejemplo reservas de
superados que se liberan al liquidar) o `FALLA`; con alguna `FALLA` sale con codigo 1.

## Empezar de cero

Las bases de carga son solo de esta prueba. Para vaciarlas, borra los esquemas `catalog_load` y
`auction_load` y las bases `ecilost_wallet_load` y `ecilost_engagement_load`, y corre de nuevo
`npm run migrate`. Las bases de desarrollo no se tocan.
