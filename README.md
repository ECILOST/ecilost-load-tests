# ecilost-load-tests

Pruebas de carga de ECILOST contra el entorno **local** (Docker), con bases de datos aisladas
para no tocar los datos de desarrollo.

El backlog no fija metas de rendimiento (supuesto A4: "no se inventa ningun SLA"). Por eso estas
pruebas **miden y reportan** latencias y capacidad, y solo hacen fallar una corrida por:

- el unico requisito con numero: **tiempo real < 1 segundo** (precio, contador y transicion de ronda);
- las garantias de concurrencia del dominio: un unico ganador, ECICoin nunca comprometidos dos
  veces, aforo nunca superado e historial de pujas estrictamente creciente (`scripts/verify.mjs`).

## Aislamiento

El sistema completo corre en Docker con su propia infraestructura (`compose/docker-compose.yml`,
proyecto `ecilost-load`): un Postgres 17 (puerto 55432), RabbitMQ (55672, consola en 55673) y
Azurite. Los contenedores de desarrollo (`ecilost-*-db`, `ecilost-rabbitmq`) no se tocan.

| Servicio | Base de carga | Esquema |
|---|---|---|
| auth | `ecilost_auth_load` | `auth` |
| catalog | `ecilost_catalog_load` | `catalog` |
| wallet | `ecilost_wallet_load` | `wallet` (sus migraciones lo escriben a mano) |
| auction | `ecilost_auction_load` | `auction` |
| engagement | `ecilost_engagement_load` | `public` (no le pasa esquema a su adaptador) |

Una base por servicio en un solo servidor, como Neon en Azure. Los servicios se construyen con su
propio Dockerfile y leen su `.env`; el compose solo reemplaza lo que apunta a `localhost`
(base, broker, JWKS, Azurite) y activa `METRICS_ENABLED`. Los nombres de las bases estan en
`scripts/lib/config.mjs` y en el compose: si cambias uno, cambia el otro.

## Usuarios sinteticos

El login es solo con Google. `scripts/tokens.mjs` firma tokens con la **llave privada local** de
ecilost-auth-service y el mismo `kid`, issuer y audience que su `TokenService`, asi que los
servicios los aceptan al verificarlos contra el JWKS local. La llave se lee del `.env` de auth y no
se copia ni se imprime. **Solo sirve en local.** Los tokens quedan en `.data/` (no se versiona).

## Requisitos

- Node 22 o superior y Docker Desktop.
- Los repos de los servicios junto a este (`../ecilost-<servicio>-service`) con su `.env` y
  `npm install` hecho (las migraciones se aplican con su Prisma CLI).
- [k6](https://k6.io) para los escenarios de carga (`winget install k6 --source winget`).

## Uso

```bash
npm install
npm run stack:infra                 # Postgres, RabbitMQ y Azurite de la carga
npm run migrate                     # crea/actualiza las bases *_load (se puede repetir)
npm run stack:up                    # construye y levanta los cinco servicios (espera healthy)
```

`npm run stack:up:azure` levanta los servicios con los limites de Azure Container Apps
(0.25 vCPU, 0.5 GiB). `npm run stack:down` los apaga sin borrar los volumenes.
`node scripts/start-service.mjs <servicio>` sigue sirviendo para depurar un servicio fuera de
Docker contra la misma infraestructura.

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

Las bases de carga son solo de esta prueba. `docker compose -f compose/docker-compose.yml down -v`
borra sus volumenes; despues `npm run stack:infra` y `npm run migrate`. Las bases de desarrollo no
se tocan.
