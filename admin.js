/**
 * ==========================================================================
 * DC EL DESTAPE - CONTROLADOR WEB ADMINISTRATIVA DE ESCRITORIO (admin.js)
 * Optimiza la visualización de productos en tarjetas verticales de gran
 * formato con fotos amplias, navegación ágil y atajos de PC.
 * ==========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  // Esperar brevemente a que app.js inicialice el estado base
  setTimeout(() => {
    inicializarAdminDesktop();
  }, 200);
});

function inicializarAdminDesktop() {
  // Sobreescribir renderizarInventario para mostrar tarjetas con fotos grandes
  instalarRenderizadoProductosDesktop();
  configurarAtajosTecladoDesktop();

  // Si ya hay productos cargados en el estado, renderizar inmediatamente
  if (window.state && window.state.productos && Object.keys(window.state.productos).length > 0) {
    if (typeof window.renderizarInventario === "function") {
      window.renderizarInventario();
    }
  }
}

/**
 * Sobreescribe renderizarInventario para generar tarjetas de licores en formato grande
 */
function instalarRenderizadoProductosDesktop() {
  window.renderizarInventario = function() {
    const contenedor = document.getElementById("productsList");
    if (!contenedor || !window.state || !window.state.productos) return;

    const inputSearch = document.getElementById("searchInventory");
    const filtroTexto = (inputSearch ? inputSearch.value : "").toLowerCase().trim();
    const stockMap = typeof window.calcularStockPorCodigo === "function" ? window.calcularStockPorCodigo() : {};

    const todosProds = Object.values(window.state.productos);
    const totalCount = todosProds.length;
    const conStockCount = todosProds.filter(p => (stockMap[p.codigo] || 0) > 0).length;
    const agotadosCount = totalCount - conStockCount;

    const elTodos = document.getElementById("countStockTodos");
    const elCon = document.getElementById("countStockCon");
    const elSin = document.getElementById("countStockSin");
    if (elTodos) elTodos.textContent = totalCount;
    if (elCon) elCon.textContent = conStockCount;
    if (elSin) elSin.textContent = agotadosCount;

    let lista = todosProds.filter(p => {
      const st = stockMap[p.codigo] || 0;
      const matchEstado = window.state.filtroEstadoStock === "todos" ||
        (window.state.filtroEstadoStock === "constock" && st > 0) ||
        (window.state.filtroEstadoStock === "agotados" && st <= 0);

      const matchCat = window.state.categoriaSeleccionada === "Todas" || p.categoria === window.state.categoriaSeleccionada;
      const matchTxt = !filtroTexto ||
        p.nombre.toLowerCase().includes(filtroTexto) ||
        p.codigo.toLowerCase().includes(filtroTexto) ||
        (p.categoria && p.categoria.toLowerCase().includes(filtroTexto));
      return matchEstado && matchCat && matchTxt;
    });

    // Ordenar
    if (window.state.ordenActual === "az") {
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
    } else if (window.state.ordenActual === "za") {
      lista.sort((a, b) => b.nombre.localeCompare(a.nombre));
    } else if (window.state.ordenActual === "stock_asc") {
      lista.sort((a, b) => (stockMap[a.codigo] || 0) - (stockMap[b.codigo] || 0));
    } else if (window.state.ordenActual === "stock_desc") {
      lista.sort((a, b) => (stockMap[b.codigo] || 0) - (stockMap[a.codigo] || 0));
    }

    const prodCountEl = document.getElementById("prodCount");
    if (prodCountEl) prodCountEl.textContent = lista.length;

    if (lista.length === 0) {
      contenedor.innerHTML = `
        <div class="col-span-full text-center py-12 text-slate-500 space-y-3">
          <i data-lucide="package-search" class="w-12 h-12 mx-auto text-slate-600"></i>
          <p class="text-sm font-semibold text-slate-300">No se encontraron licores para la búsqueda seleccionada.</p>
          <div class="pt-2 flex items-center justify-center gap-2">
            <button type="button" onclick="limpiarFiltrosInventario()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl border border-slate-700">
              Limpiar Filtros
            </button>
            <button type="button" onclick="abrirModalProducto()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30">
              + Agregar Licor
            </button>
          </div>
        </div>
      `;
      if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
      if (typeof window.renderizarCategoriasPills === "function") window.renderizarCategoriasPills();
      return;
    }

    const detailedMap = typeof window.calcularStockDetalladoPorCodigo === "function" ? window.calcularStockDetalladoPorCodigo() : {};

    contenedor.innerHTML = lista.map(p => {
      const det = detailedMap[p.codigo] || { Carlos: 0, Daniel: 0, total: 0 };
      const stockVisual = window.state.vistaVendedor === "Carlos" 
        ? det.Carlos 
        : (window.state.vistaVendedor === "Daniel" ? det.Daniel : det.total);

      const isLow = stockVisual <= (p.stockMinimo || 2) && stockVisual > 0;
      const isOut = stockVisual <= 0;

      let stockBadgeClass = "bg-emerald-950/80 text-emerald-300 border-emerald-500/40";
      let stockStatusText = `${stockVisual} unids`;
      if (isOut) {
        stockBadgeClass = "bg-rose-950/80 text-rose-300 border-rose-500/40";
        stockStatusText = "Agotado (0)";
      } else if (isLow) {
        stockBadgeClass = "bg-amber-950/80 text-amber-300 border-amber-500/40";
        stockStatusText = `Bajo: ${stockVisual}`;
      }

      const imgFormatted = typeof window.formatearUrlImagen === "function" ? window.formatearUrlImagen(p.imagenUrl) : null;
      const hasImg = !!imgFormatted;
      const precioCRCFmt = typeof window.fmtCRC === "function" ? window.fmtCRC(p.precioVentaCRC || 0) : `₡${p.precioVentaCRC}`;
      const precioUSDFmt = typeof window.fmtUSD === "function" ? window.fmtUSD(p.precioVentaUSD || 0) : `$${p.precioVentaUSD}`;

      return `
        <div class="admin-product-card group">
          <!-- Header de Tarjeta: Código, Categoría y Badge de Stock -->
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-mono text-xs font-bold text-slate-400 bg-slate-800/90 px-2 py-0.5 rounded-lg border border-slate-700/60 shrink-0">${p.codigo}</span>
              <span class="text-xs font-semibold text-slate-400 truncate">${p.categoria || 'Licor'}</span>
            </div>
            <span class="text-xs font-bold px-2.5 py-0.5 rounded-full border ${stockBadgeClass} shrink-0">
              ${stockStatusText}
            </span>
          </div>

          <!-- Imagen Grande de Botella (Protagonista) -->
          <div class="admin-product-img-box foto-producto-btn group-hover:border-indigo-500/60 transition-colors" data-url="${imgFormatted || ''}" data-nombre="${p.nombre.replace(/"/g, '&quot;')}" title="Toca para ver foto completa">
            ${hasImg ? `
              <img src="${imgFormatted}" alt="${p.nombre}" loading="lazy" class="w-full h-full object-contain p-2"
                onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.classList.remove('hidden'); this.nextElementSibling.classList.add('flex');">
              <div class="hidden flex-col items-center justify-center text-slate-500 text-xs w-full h-full">
                <i data-lucide="wine" class="w-14 h-14 text-slate-600"></i>
              </div>
            ` : `
              <div class="flex flex-col items-center justify-center text-slate-600 text-xs">
                <i data-lucide="wine" class="w-14 h-14 text-slate-700"></i>
                <span class="text-slate-500 text-xs mt-1 font-medium">Sin imagen</span>
              </div>
            `}
            <div class="absolute bottom-2 right-2 bg-black/75 backdrop-blur-sm rounded-lg px-2 py-1 text-white text-xs flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <i data-lucide="zoom-in" class="w-3.5 h-3.5 text-amber-400"></i>
              <span class="font-bold">Ver</span>
            </div>
          </div>

          <!-- Título del Licor y Desglose de Existencias -->
          <div class="pt-1.5 flex-1 flex flex-col justify-between">
            <div>
              <h4 class="text-sm font-black text-white leading-snug cursor-pointer hover:text-indigo-300 transition-colors line-clamp-2" onclick="abrirModalProducto('${p.codigo}')">
                ${p.nombre}
              </h4>
            </div>

            <!-- Desglose de Stock por Vendedor -->
            <div class="flex items-center justify-between text-xs font-mono text-slate-400 bg-slate-950/80 px-2.5 py-1.5 rounded-xl border border-slate-800/80 mt-2">
              <span class="text-blue-300 font-semibold">Carlos: <b>${det.Carlos}</b></span>
              <span class="text-slate-700">|</span>
              <span class="text-violet-300 font-semibold">Daniel: <b>${det.Daniel}</b></span>
              <span class="text-slate-700">|</span>
              <span class="text-amber-300 font-bold">Total: <b>${det.total}</b></span>
            </div>
          </div>

          <!-- Precio de Venta y Botones de Acción -->
          <div class="flex items-center justify-between pt-3 mt-2.5 border-t border-slate-800/80 font-mono">
            <div>
              <div class="text-[11px] text-slate-400 font-sans font-medium">Precio Venta:</div>
              <div class="font-black text-emerald-400 text-base sm:text-lg">${precioCRCFmt}</div>
              <div class="text-xs text-slate-500 font-normal">${precioUSDFmt} USD</div>
            </div>

            <div class="flex items-center gap-1.5">
              <button onclick="abrirModalProducto('${p.codigo}')" class="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl active:scale-95 transition-all" title="Editar Producto">
                <i data-lucide="edit-2" class="w-4 h-4"></i>
              </button>
              <button onclick="agregarAlCarritoPorCodigo('${p.codigo}')" class="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-xs rounded-xl flex items-center gap-1.5 active:scale-95 shadow-md shadow-indigo-600/30 transition-all">
                <i data-lucide="plus" class="w-4 h-4"></i>
                <span>+ Vender</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
    if (typeof window.renderizarCategoriasPills === "function") {
      window.renderizarCategoriasPills();
    }
  };
}

/**
 * Atajos de teclado para PC
 */
function configurarAtajosTecladoDesktop() {
  document.addEventListener("keydown", (e) => {
    // F2: Ir a Ventas y enfocar el buscador
    if (e.key === "F2") {
      e.preventDefault();
      if (typeof window.cambiarVista === "function") window.cambiarVista("ventas");
      const search = document.getElementById("searchPos");
      if (search) search.focus();
    }
    // Escape: Cerrar modales abiertos
    if (e.key === "Escape") {
      const modales = [
        "modalProducto", "modalNuevoCliente", "modalMovimientoDinero",
        "modalPagoCuenta", "modalDetalleVenta", "modalLoginVendedor",
        "modalNuevaCuentaManual", "modalFotoCompleta", "modalLiquidacionComision"
      ];
      modales.forEach(id => {
        const m = document.getElementById(id);
        if (m && !m.classList.contains("hidden")) {
          m.classList.add("hidden");
          m.classList.remove("flex");
        }
      });
    }
  });
}
