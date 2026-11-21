# Ejecuciones reales con observabilidad completa

Fecha: 21 de noviembre de 2026. Horas locales de Colombia (UTC−05:00).
Registro generado después de las ejecuciones; no se modificaron sus marcas de tiempo.

| Prueba | Inicio local | Fin local | Curva programada | Peticiones | Errores HTTP | k6 / verificación | Paneles con muestras |
|---|---|---|---|---|---|---|---|
| Carga `load-fa69be4b` | 05:11:50 | 05:22:21 | 600 s | 97.988 | 0 | 0 / 0 | 64 de 64 |
| Estrés `stress-2db2c1ec` | 05:23:29 | 05:34:01 | 600 s | 196.874 | 0 | 0 / 0 | 64 de 64 |

La ventana completa añade unos 31 segundos de setup/teardown de k6 y cierre de conexiones.
Carga: 100 estudiantes en sala y 20 visitantes. Estrés: escalones hasta 400 estudiantes y
20 visitantes, con recuperación. Ambas verificaciones terminaron sin fallas ni avisos.
Las auditorías no encontraron paneles vacíos ni errores de PromQL. Los cinco servicios
aportaron métricas HTTP y de Node.js; cAdvisor, Postgres y RabbitMQ también fueron recolectados.

Archivos versionados: metadatos con timestamps UTC, resúmenes k6, verificación de invariantes,
informes y auditorías de las consultas. No incluyen JWT ni llaves privadas.

- [Informe de carga](load-report.md)
- [Informe de estrés](stress-report.md)
- [Grafana carga](http://localhost:3300/d/ecilost-overview?from=1795255910703&to=1795256510703&var-testid=load-fa69be4b)
- [Grafana estrés](http://localhost:3300/d/ecilost-overview?from=1795256609359&to=1795257209359&var-testid=stress-2db2c1ec)

Los enlaces requieren el Grafana local y las series conservadas en su volumen (retención 15 días).
Los archivos de esta carpeta permanecen como evidencia estática después de vencer esa retención.
