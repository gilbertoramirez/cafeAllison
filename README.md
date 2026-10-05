# Café Allison — Punto de venta, tienda en línea y finanzas

Sistema para la cafetería con dos partes:

**Tienda para clientes** (`/`)
- Menú por categorías, carrito y pedido desde el celular.
- Entrega **a domicilio** (con costo de envío y pedido mínimo configurables, dirección, referencias y ubicación GPS) o **para recoger**.
- Formas de pago: **pago en línea con Stripe** (tarjeta), **efectivo al recibir** (pregunta con cuánto paga para llevar cambio) o **pedido por WhatsApp** (se arma el mensaje con el pedido completo y se envía a tu número).
- Página de **seguimiento del pedido** que se actualiza sola (Nuevo → Preparando → En camino → Entregado).

**Panel de administración** (`/admin`)
- **Resumen**: ventas de hoy y del mes, utilidad neta, pagos pendientes, pedidos activos, inventario bajo y cuánto necesitas vender para cubrir lo que debes pagar este mes.
- **Punto de venta**: caja para el mostrador, cobro en efectivo (con cálculo de cambio), tarjeta o transferencia.
- **Pedidos**: pedidos en línea y de WhatsApp en tiempo real, cambio de estado, marcar como pagado, abrir la dirección en el mapa y avisar al cliente por WhatsApp.
- **Menú**: alta y edición de productos, precio, **costo** (para calcular ganancia), margen, ocultar/mostrar.
- **Inventario**: existencias de productos (pan, comida) e **insumos** (café, leche, vasos), registro de **resurtido** que crea el gasto automáticamente y actualiza el costo, ajustes por merma o conteo, historial de movimientos.
- **Gastos**: renta, servicios, sueldos, resurtido, etc. Gastos **por pagar** con fecha de vencimiento y **recurrentes** (al pagar la renta se agenda la del siguiente mes).
- **Finanzas**: ventas, costo de lo vendido, utilidad bruta y neta, flujo de efectivo, ventas por día, productos más vendidos, gastos por categoría y ventas por canal/forma de pago.
- **Ajustes**: nombre, WhatsApp, horario, dirección, costo de envío, pedido mínimo, abrir/cerrar pedidos en línea.

## Empezar en tu computadora

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env.local   # edita ADMIN_PASSWORD
npm run dev
```

- Tienda: http://localhost:3000
- Panel: http://localhost:3000/admin (en desarrollo, si no defines `ADMIN_PASSWORD`, la contraseña es `admin`)

La primera vez se crea la base de datos `data/cafe.db` con un **menú de ejemplo**; edítalo desde *Admin → Menú* con tus productos y precios reales. Luego ve a *Ajustes* y pon tu número de WhatsApp.

## Pagos con Stripe

1. Crea una cuenta en https://dashboard.stripe.com (puedes probar en modo de prueba).
2. Copia la **Secret key** (`sk_test_...` o `sk_live_...`) en `STRIPE_SECRET_KEY`.
3. Crea un webhook en *Developers → Webhooks* apuntando a `https://TU-DOMINIO/api/stripe/webhook` con los eventos
   `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `checkout.session.expired`.
   Copia el *Signing secret* (`whsec_...`) en `STRIPE_WEBHOOK_SECRET`.
4. Para probar en local: `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Tarjeta de prueba: `4242 4242 4242 4242`.

El pedido se marca como **pagado** cuando Stripe confirma el pago (por webhook o al regresar el cliente a la página de seguimiento). Si el cliente no paga en 1 hora, el pedido se cancela y el inventario se regresa. Los reembolsos se hacen desde el panel de Stripe.

Desde el panel de Stripe puedes activar otros métodos de pago para México (por ejemplo OXXO) sin cambiar código.

## Publicarlo en internet (Vercel + Turso)

Vercel no guarda archivos entre peticiones, así que en producción la base de datos debe estar en **Turso** (SQLite en la nube, tiene plan gratuito):

1. Crea una base en https://turso.tech y obtén la URL (`libsql://...`) y un token.
2. Sube este repositorio a Vercel y define las variables de entorno: `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `SITE_URL` y, si usas Stripe, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
3. Las tablas y el menú de ejemplo se crean solos en el primer acceso.

También funciona en cualquier servidor con Node (Railway, Render, un VPS) usando el archivo SQLite local; solo asegúrate de que la carpeta `data/` esté en un disco persistente y de respaldarla.

## Cómo se calculan las ganancias

- **Utilidad bruta** = ventas cobradas − costo de los productos vendidos (el campo *Costo* de cada producto).
- **Utilidad neta** = utilidad bruta − gastos operativos pagados (renta, servicios, sueldos… sin contar resurtido, porque ese costo ya está en el costo de lo vendido).
- **Flujo de efectivo** = ventas − todo lo que pagaste (incluye compras de resurtido). Te dice cuánto dinero real te quedó.

Solo cuentan los pedidos **pagados** y no cancelados. Los pedidos en efectivo a domicilio cuentan cuando los marcas como pagados.

## Tecnología

Next.js (App Router), React, Tailwind CSS, SQLite/libSQL (`@libsql/client`) y Stripe Checkout. Montos guardados en centavos.
