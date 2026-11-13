# Café Allison — Punto de venta, tienda en línea y finanzas

Sistema para la cafetería con dos partes:

**Tienda para clientes** (`/`)
- Menú por categorías con fotos, **buscador** que tolera acentos y errores de dedo ("capuchno", "frape"), carrito y pedido desde el celular.
- Sugerencias **"¿Le agregas…?"** según lo que se compra junto.
- Entrega **a domicilio** (costo por **distancia** con Google Maps: envío base, km extra, distancia máxima y envío gratis) o **para recoger**.
- **Pedidos programados**: "lo antes posible" o día y hora dentro del horario; fuera de horario solo se programa.
- Formas de pago: **tarjeta con Stripe** (la comisión va en el precio y el cargo fijo en su propio renglón), **efectivo** o **WhatsApp**.
- Pestañas **Pedidos** (seguimiento en tiempo real y "Pedir de nuevo"), **Recompensas** (tarjeta de sellos) y **El café** (horario, ubicación, envíos).

**Panel de administración** (`/admin`)
- **Resumen**, **Pedidos** en tiempo real, **Finanzas**, **Gastos** e **Inventario** editable en cada renglón.
- **Punto de venta** con varios pedidos abiertos en pestañas, buscador, lealtad, impresión de tickets y cajón.
- **Corte de caja**: fondo inicial, entradas/salidas, efectivo esperado contra contado e historial.
- **Menú**: productos con **fotos desde el celular** (Vercel Blob), fotos por categoría, tamaños, días de venta y productos **solo en caja**.
- **Reparto**: mejor ruta para varios pedidos a domicilio; **Repartidores** con su propia app en `/repartidor` (teléfono + PIN, solo ven pedidos a domicilio).
- **Programa de lealtad**: 1 sello por día en compras desde el mínimo; con 10, bebida gratis de hasta 12 oz.
- **Avisos al celular con ntfy** de pedidos nuevos y cambios.
- **Ajustes**: datos del negocio, horario, envío por distancia, comisión en línea, lealtad, avisos e impresora.

## Empezar en tu computadora

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env.local   # edita ADMIN_PASSWORD
npm run dev
```

- Tienda: http://localhost:3000
- Panel: http://localhost:3000/admin (en desarrollo, si no defines `ADMIN_PASSWORD`, la contraseña es `admin`)

La primera vez se crea la base de datos local (`data/pglite`) con un **menú de ejemplo**; edítalo desde *Admin → Menú* con tus productos y precios reales. Luego ve a *Ajustes* y pon tu número de WhatsApp.

## Pagos con Stripe

1. Crea una cuenta en https://dashboard.stripe.com (puedes probar en modo de prueba).
2. Copia la **Secret key** (`sk_test_...` o `sk_live_...`) en `STRIPE_SECRET_KEY`.
3. Crea un webhook en *Developers → Webhooks* apuntando a `https://TU-DOMINIO/api/stripe/webhook` con los eventos
   `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `checkout.session.expired`.
   Copia el *Signing secret* (`whsec_...`) en `STRIPE_WEBHOOK_SECRET`.
4. Para probar en local: `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Tarjeta de prueba: `4242 4242 4242 4242`.

El pedido se marca como **pagado** cuando Stripe confirma el pago (por webhook o al regresar el cliente a la página de seguimiento). Si el cliente no paga en 1 hora, el pedido se cancela y el inventario se regresa. Los reembolsos se hacen desde el panel de Stripe.

Desde el panel de Stripe puedes activar otros métodos de pago para México (por ejemplo OXXO) sin cambiar código.

## Publicarlo en internet (Vercel + Neon)

La app usa **Postgres**. En Vercel la base de datos es **Neon** (tiene plan gratuito):

1. En tu proyecto de Vercel ve a **Storage → Create Database → Neon** (o *Marketplace → Neon*), créala y conéctala al proyecto marcando **Production y Preview**. Esto agrega `DATABASE_URL` automáticamente.
   - Alternativa: crea la base en https://neon.tech y pega su *connection string* (`postgresql://...?sslmode=require`) en la variable `DATABASE_URL`.
2. Define también `ADMIN_PASSWORD`, `SESSION_SECRET`, `SITE_URL` y, si usas Stripe, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` (en Production **y** Preview).
3. Vuelve a desplegar. Las tablas y el menú de ejemplo se crean solos en el primer acceso.
4. Comprueba en `https://TU-DOMINIO/api/salud` que diga `"databaseType": "postgres (Neon)"` y `"adminPassword": "configurada"`.

Sin `DATABASE_URL`, en tu computadora se usa **PGlite** (Postgres embebido, guardado en `data/pglite`), así que no necesitas instalar nada para probar. En Vercel sin `DATABASE_URL` funciona en modo demo con datos temporales (el panel lo avisa).

## Cómo se calculan las ganancias

- **Utilidad bruta** = ventas cobradas − costo de los productos vendidos (el campo *Costo* de cada producto).
- **Utilidad neta** = utilidad bruta − gastos operativos pagados (renta, servicios, sueldos… sin contar resurtido, porque ese costo ya está en el costo de lo vendido).
- **Flujo de efectivo** = ventas − todo lo que pagaste (incluye compras de resurtido). Te dice cuánto dinero real te quedó.

Solo cuentan los pedidos **pagados** y no cancelados. Los pedidos en efectivo a domicilio cuentan cuando los marcas como pagados.

## Tecnología

Next.js (App Router), React, Tailwind CSS, Postgres (Neon con `pg`, PGlite en local) y Stripe Checkout. Montos guardados en centavos.
