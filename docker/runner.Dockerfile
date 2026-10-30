# Ejecutor de las pruebas: Node 22 (scripts de preparacion, verificacion e informe), k6 y el
# cliente de Docker (para guardar los logs de los servicios de cada corrida). Con esta imagen el
# equipo solo necesita Docker: ni Node ni k6 instalados.
#
# El codigo no se copia: el compose monta el repo en /app, asi que editar un escenario no pide
# reconstruir. Solo las dependencias de npm quedan dentro de la imagen.
FROM grafana/k6:2.2.0 AS k6
FROM docker:29.3.1-cli AS docker-cli

FROM node:22-bookworm-slim
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
ENTRYPOINT ["node", "scripts/run.mjs"]
