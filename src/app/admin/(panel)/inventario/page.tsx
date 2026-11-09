import { Field, PageTitle } from "@/components/admin/ui";
import { all } from "@/lib/db";
import { centsToInput, dateTime, money } from "@/lib/format";
import { productLabel, type Product, type Supply } from "@/lib/types";
import { adjustStock, deleteSupply, restock, saveInventoryProduct, saveSupply } from "../../actions";

const UNITS = ["pza", "kg", "g", "litro", "ml", "paquete", "caja", "bolsa", "botella", "lata", "galón", "docena"];

/** Campo con etiqueta pequeña, para editar en renglón (también se entiende en celular). */
function Cell({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[11px] font-medium text-cafe-600">{label}</span>
      {children}
    </label>
  );
}

type Movement = {
  id: number;
  item_type: string;
  change: number;
  reason: string;
  note: string;
  created_at: string;
  name: string | null;
};

const REASON: Record<string, string> = {
  venta: "Venta",
  resurtido: "Resurtido",
  ajuste: "Ajuste",
  cancelacion: "Cancelación",
};

export default async function InventoryPage() {
  const [products, supplies, movements] = await Promise.all([
    all<Product>("SELECT * FROM products WHERE track_stock = 1 AND active = 1 ORDER BY name"),
    all<Supply>("SELECT * FROM supplies ORDER BY name"),
    all<Movement>(
      `SELECT m.*, CASE m.item_type WHEN 'product' THEN p.name || CASE WHEN p.size <> '' THEN ' (' || p.size || ')' ELSE '' END ELSE s.name END AS name
       FROM inventory_movements m
       LEFT JOIN products p ON m.item_type = 'product' AND p.id = m.item_id
       LEFT JOIN supplies s ON m.item_type = 'supply' AND s.id = m.item_id
       WHERE m.reason != 'venta'
       ORDER BY m.created_at DESC LIMIT 30`,
    ),
  ]);
  const inventoryValue =
    products.reduce((a, p) => a + Math.max(p.stock, 0) * p.cost, 0) +
    supplies.reduce((a, s) => a + Math.max(s.qty, 0) * s.cost_per_unit, 0);

  const itemOptions = (
    <>
      <option value="">Selecciona…</option>
      {products.length > 0 && (
        <optgroup label="Productos del menú">
          {products.map((p) => (
            <option key={`p${p.id}`} value={`product:${p.id}`}>
              {productLabel(p)} (hay {p.stock})
            </option>
          ))}
        </optgroup>
      )}
      {supplies.length > 0 && (
        <optgroup label="Insumos">
          {supplies.map((s) => (
            <option key={`s${s.id}`} value={`supply:${s.id}`}>
              {s.name} (hay {s.qty} {s.unit})
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <PageTitle>Inventario</PageTitle>
      <p className="-mt-3 text-sm text-cafe-600">
        Valor estimado del inventario: <strong>{money(inventoryValue)}</strong>
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={restock} className="card space-y-3">
          <h2 className="font-semibold">📥 Registrar resurtido (compra)</h2>
          <Field label="Producto o insumo">
            <select name="item" className="input" required>
              {itemOptions}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cantidad que entra">
              <input name="qty" type="number" step="any" min="0.01" className="input" required />
            </Field>
            <Field label="Costo total de la compra ($)">
              <input name="total_cost" type="number" step="0.01" min="0" className="input" />
            </Field>
          </div>
          <Field label="Nota (proveedor, factura…)">
            <input name="note" className="input" />
          </Field>
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="register_expense" defaultChecked /> Registrar como gasto de resurtido
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="expense_pending" /> Aún no lo pago (queda como pendiente)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="update_cost" defaultChecked /> Actualizar costo por unidad
            </label>
          </div>
          <button className="btn-primary">Guardar entrada</button>
        </form>

        <form action={adjustStock} className="card space-y-3">
          <h2 className="font-semibold">🔢 Ajustar conteo</h2>
          <p className="text-sm text-cafe-600">
            Úsalo cuando cuentes físicamente, haya merma o registres consumo de insumos (ej. leche usada en la semana).
          </p>
          <Field label="Producto o insumo">
            <select name="item" className="input" required>
              {itemOptions}
            </select>
          </Field>
          <Field label="Cantidad real que hay ahora">
            <input name="new_qty" type="number" step="any" min="0" className="input" required />
          </Field>
          <Field label="Motivo">
            <input name="note" className="input" placeholder="Conteo, merma, se echó a perder…" />
          </Field>
          <button className="btn-secondary">Ajustar</button>
        </form>
      </div>

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Productos con control de existencias</h2>
          <p className="text-sm text-cafe-600">Cambia lo que necesites y toca Guardar en ese renglón.</p>
        </div>
        {products.length === 0 ? (
          <p className="text-sm text-cafe-600">Activa “Controlar existencias” en un producto del menú.</p>
        ) : (
          <div className="divide-y divide-cafe-100">
            {products.map((p) => (
              <form
                key={p.id}
                action={saveInventoryProduct}
                className="grid grid-cols-2 items-end gap-2 py-3 sm:grid-cols-[minmax(10rem,1fr)_repeat(4,7rem)_auto]"
              >
                <input type="hidden" name="id" value={p.id} />
                <div className="col-span-2 self-center sm:col-span-1">
                  <p className="font-medium">{productLabel(p)}</p>
                  {p.stock <= p.min_stock && <p className="text-xs font-semibold text-red-700">⚠️ Por resurtir</p>}
                </div>
                <Cell label="Precio venta ($)">
                  <input name="price" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(p.price)} required />
                </Cell>
                <Cell label="Costo unitario ($)">
                  <input name="cost" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(p.cost)} />
                </Cell>
                <Cell label="Existencia">
                  <input
                    name="stock"
                    type="number"
                    step="1"
                    min="0"
                    className={`input ${p.stock <= p.min_stock ? "border-red-300 text-red-700" : ""}`}
                    defaultValue={p.stock}
                  />
                </Cell>
                <Cell label="Mínimo">
                  <input name="min_stock" type="number" step="1" min="0" className="input" defaultValue={p.min_stock} />
                </Cell>
                <button className="btn-secondary col-span-2 sm:col-span-1">Guardar</button>
              </form>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Insumos (café en grano, leche, vasos…)</h2>
          <p className="text-sm text-cafe-600">Cambia lo que necesites y toca Guardar en ese renglón.</p>
        </div>
        <datalist id="units">
          {UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <div className="divide-y divide-cafe-100">
          {supplies.map((s) => (
            <form
              key={s.id}
              action={saveSupply}
              className="grid grid-cols-2 items-end gap-2 py-3 sm:grid-cols-[minmax(10rem,1fr)_6.5rem_6rem_6rem_7rem_auto]"
            >
              <input type="hidden" name="id" value={s.id} />
              <Cell label="Nombre" className="col-span-2 sm:col-span-1">
                <input name="name" defaultValue={s.name} className="input" required />
              </Cell>
              <Cell label="Unidad">
                <input name="unit" defaultValue={s.unit} className="input" list="units" />
              </Cell>
              <Cell label="Hay">
                <input
                  name="qty"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={s.qty}
                  className={`input ${s.qty <= s.min_qty ? "border-red-300 text-red-700" : ""}`}
                />
              </Cell>
              <Cell label="Mínimo">
                <input name="min_qty" type="number" step="any" min="0" defaultValue={s.min_qty} className="input" />
              </Cell>
              <Cell label="Costo/unidad ($)">
                <input name="cost_per_unit" type="number" step="0.01" min="0" defaultValue={centsToInput(s.cost_per_unit)} className="input" />
              </Cell>
              <div className="flex items-center gap-3">
                <button className="btn-secondary">Guardar</button>
                <button formAction={deleteSupply.bind(null, s.id)} formNoValidate className="text-sm text-red-700 underline">
                  Borrar
                </button>
              </div>
            </form>
          ))}
        </div>
        <form action={saveSupply} className="flex flex-wrap items-end gap-2 border-t border-cafe-100 pt-3">
          <Field label="Nuevo insumo" className="flex-1">
            <input name="name" className="input" placeholder="Leche entera" required />
          </Field>
          <Field label="Unidad">
            <input name="unit" className="input w-24" placeholder="litro" list="units" />
          </Field>
          <Field label="Hay ahora">
            <input name="qty" type="number" step="any" min="0" className="input w-24" defaultValue={0} />
          </Field>
          <Field label="Mínimo">
            <input name="min_qty" type="number" step="any" min="0" className="input w-24" defaultValue={0} />
          </Field>
          <Field label="Costo/unidad ($)">
            <input name="cost_per_unit" type="number" step="0.01" min="0" className="input w-28" />
          </Field>
          <button className="btn-primary">Agregar</button>
        </form>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Últimos movimientos</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Artículo</th>
              <th>Tipo</th>
              <th className="text-right">Cambio</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">{dateTime(m.created_at)}</td>
                <td>{m.name ?? "(eliminado)"}</td>
                <td>{REASON[m.reason] ?? m.reason}</td>
                <td className={`text-right tabular-nums ${m.change < 0 ? "text-red-700" : "text-green-700"}`}>
                  {m.change > 0 ? "+" : ""}
                  {m.change}
                </td>
                <td className="text-cafe-600">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
