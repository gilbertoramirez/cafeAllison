import Link from "next/link";
import { Field, PageTitle } from "@/components/admin/ui";
import { all, get } from "@/lib/db";
import { centsToInput, money } from "@/lib/format";
import { daysLabel, parseDays, productLabel, WEEKDAYS, type Product } from "@/lib/types";
import { saveProduct, toggleProduct } from "../../actions";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ id?: string; nuevo?: string }> }) {
  const sp = await searchParams;
  const products = await all<Product>("SELECT * FROM products ORDER BY (SELECT MIN(p2.sort) FROM products p2 WHERE p2.category = products.category), category, sort, name");
  const editing = sp.id ? await get<Product>("SELECT * FROM products WHERE id = ?", [Number(sp.id)]) : undefined;
  const showForm = Boolean(editing || sp.nuevo);
  const categories = [...new Set(products.map((p) => p.category))];

  return (
    <div className="space-y-5">
      <PageTitle actions={<Link href="?nuevo=1" className="btn-primary">+ Agregar producto</Link>}>Menú</PageTitle>

      {showForm && (
        <form action={saveProduct} className="card grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <h2 className="font-semibold sm:col-span-2 lg:col-span-4">{editing ? `Editar: ${productLabel(editing)}` : "Nuevo producto"}</h2>
          <Field label="Nombre" className="lg:col-span-2">
            <input name="name" className="input" required defaultValue={editing?.name} />
          </Field>
          <Field label="Tamaño (opcional)" hint="Ej. CH 8oz. Los tamaños con el mismo nombre se agrupan en la tienda.">
            <input name="size" className="input" defaultValue={editing?.size} />
          </Field>
          <Field label="Categoría">
            <input name="category" className="input" list="cats" required defaultValue={editing?.category} />
            <datalist id="cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Orden en el menú">
            <input name="sort" type="number" className="input" defaultValue={editing?.sort ?? 0} />
          </Field>
          <Field label="Descripción" className="sm:col-span-2 lg:col-span-4">
            <input name="description" className="input" defaultValue={editing?.description} />
          </Field>
          <Field label="Precio de venta ($)">
            <input name="price" type="number" step="0.01" min="0" className="input" required defaultValue={editing ? centsToInput(editing.price) : ""} />
          </Field>
          <Field label="Costo por unidad ($)" hint="Lo que te cuesta prepararlo. Se usa para calcular la ganancia.">
            <input name="cost" type="number" step="0.01" min="0" className="input" defaultValue={editing ? centsToInput(editing.cost) : ""} />
          </Field>
          <Field label="URL de imagen (opcional)" className="lg:col-span-2">
            <input name="image_url" type="url" className="input" defaultValue={editing?.image_url} placeholder="https://…" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="track_stock" defaultChecked={Boolean(editing?.track_stock)} />
            Controlar existencias (pan, piezas empacadas…)
          </label>
          {!editing && (
            <Field label="Existencia inicial">
              <input name="stock" type="number" min="0" className="input" defaultValue={0} />
            </Field>
          )}
          <Field label="Avisar cuando queden">
            <input name="min_stock" type="number" min="0" className="input" defaultValue={editing?.min_stock ?? 5} />
          </Field>
          <fieldset className="sm:col-span-2 lg:col-span-4">
            <legend className="label">Días que se vende en línea (sin marcar = todos)</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" name="days" value={i} defaultChecked={parseDays(editing?.available_days ?? "").includes(i)} />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={editing ? Boolean(editing.active) : true} />
            Visible en el menú
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button className="btn-primary">Guardar</button>
            <Link href="/admin/productos" className="btn-secondary">
              Cancelar
            </Link>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="hidden sm:table-cell">Categoría</th>
              <th className="text-right">Precio</th>
              <th className="hidden text-right sm:table-cell">Costo</th>
              <th className="text-right">Margen</th>
              <th className="hidden text-right sm:table-cell">Existencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
              return (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td className="font-medium">
                    {productLabel(p)}
                    {p.available_days && <span className="badge ml-2 bg-amber-50 text-amber-800">{daysLabel(p.available_days)}</span>}
                    {!p.active && <span className="badge ml-2 bg-gray-100">Oculto</span>}
                  </td>
                  <td className="hidden sm:table-cell">{p.category}</td>
                  <td className="text-right tabular-nums">{money(p.price)}</td>
                  <td className="hidden text-right tabular-nums sm:table-cell">{money(p.cost)}</td>
                  <td className={`text-right tabular-nums ${margin < 40 ? "text-amber-700" : ""}`}>{margin}%</td>
                  <td className={`hidden text-right tabular-nums sm:table-cell ${p.track_stock && p.stock <= p.min_stock ? "font-semibold text-red-700" : ""}`}>
                    {p.track_stock ? p.stock : "—"}
                  </td>
                  <td className="text-right">
                    <Link href={`?id=${p.id}`} className="mr-2 block text-cafe-700 underline sm:mr-3 sm:inline">
                      Editar
                    </Link>
                    <form action={toggleProduct.bind(null, p.id)} className="inline">
                      <button className="text-cafe-600 underline">{p.active ? "Ocultar" : "Mostrar"}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

