# Diapositiva: concurrencia bajo carga

Imagen: `concurrencia-antes-despues.png` (1920 × 1080, lista para pegar). Números de
`RESULTADOS.md`, medidos en local con k6. Ninguno es estimado.

## Texto de la diapositiva

**Título:** 100 estudiantes pujando a la vez: sin rechazos falsos y en tiempo real

- **0 pujas rechazadas por error** (antes, 599 decían "saldo insuficiente" con saldo de sobra)
- **p95 de una puja: 4,5 s → 2,1 s** con 100 estudiantes, mientras otra sala cerraba en paralelo
- **Tiempo real: p95 de 149 ms** desde que se publica el evento hasta que llega al navegador
  (requisito: < 1 s)
- **0 liquidaciones perdidas** y garantías de dinero sin fallas: ningún saldo negativo, nada
  comprometido dos veces, un solo cobro por ronda

## Notas para quien presenta

1. **Cómo se midió.** k6 simula estudiantes que leen la sala y pujan cada 0 a 1 s. Después de
   cada corrida, `scripts/verify.mjs` revisa en las bases de datos que no se rompió ninguna regla
   de dinero ni de orden.
2. **Qué encontró la carga.** Wallet usaba transacciones `SERIALIZABLE`: con muchas pujas,
   billeteras distintas chocaban entre sí. Esos choques se mostraban como "saldo insuficiente", y
   una liquidación que chocaba se descartaba: el ganador quedaba sin cobrar.
3. **Qué se cambió** (ADR-0001 de wallet). Bloqueo corto de la fila de cada billetera en READ
   COMMITTED, cola de reintento para que ninguna liquidación se pierda, y un motivo en cada
   rechazo para que auction no confunda "ocupado" con "sin saldo".
4. **Cómo sabemos que no vuelve.** 7 pruebas de concurrencia contra PostgreSQL real corren en CI
   (fallan 5 con el código anterior), y la prueba de tiempo real exige < 1 s en cada build.

## Lo que no se debe afirmar

- Que sea capacidad de producción: k6 y los servicios comparten la misma máquina.
- Que la puja sea rápida con 100 personas: 2,1 s sigue siendo mucho. La fila de la ronda
  serializa todas las pujas (H1 en `RESULTADOS.md`), y eso queda como deuda técnica.
- Que se probó en Azure: los tokens de carga se firman con la llave local de auth.
