/**
 * ==========================================================================
 * DC EL DESTAPE - APP PREVENTA Y PEDIDOS (PWA SATÉLITE)
 * ==========================================================================
 * Módulos:
 * 1. Catálogo de Productos (Precios de venta CRC/USD, sin stock ni costos)
 * 2. Pedidos / Encargos de Clientes (Enviados al Sheets central)
 * 3. Clientes (Filtrados por vendedor para privacidad total)
 * ==========================================================================
 */

// Formatters
const fmtUSD = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(n) ? n : 0);
const fmtCRC = (n) => new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
const parseNum = (val, fallback = 0) => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "number") return isNaN(val) ? fallback : val;
  const str = String(val).trim().replace(/[₡$]/g, "").replace(/,/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? fallback : num;
};

const PORTAL_TOKEN = "dc_sec_EQE1RFEi6q3rMeXkjUUQQj5Q4u7sSbxx";

// Helper para formatear URLs de imágenes (Google Drive, lh3, thumbnail, base64 o web directa)
function formatearUrlImagen(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return '';
  const trimmed = urlOrId.trim();
  if (!trimmed) return '';

  // 1. Data URLs directas (Base64)
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  // 2. Extraer ID de Google Drive (varios formatos conocidos)
  let driveId = null;

  // Formato /file/d/ID/view o /file/d/ID
  const matchFileD = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchFileD && matchFileD[1]) driveId = matchFileD[1];

  // Formato id=ID o ?id=ID
  if (!driveId) {
    const matchIdParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchIdParam && matchIdParam[1]) driveId = matchIdParam[1];
  }

  // Formato lh3.googleusercontent.com/d/ID
  if (!driveId) {
    const matchGoogleUserContent = trimmed.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (matchGoogleUserContent && matchGoogleUserContent[1]) driveId = matchGoogleUserContent[1];
  }

  // Formato drive.google.com/open?id=ID o /uc?id=ID
  if (!driveId) {
    const matchUc = trimmed.match(/drive\.google\.com\/(?:uc|open)\?.*id=([a-zA-Z0-9_-]+)/);
    if (matchUc && matchUc[1]) driveId = matchUc[1];
  }

  // Si pegó directamente el ID alfanumérico de Drive (25 a 50 caracteres)
  if (!driveId && /^[a-zA-Z0-9_-]{25,50}$/.test(trimmed)) {
    driveId = trimmed;
  }

  if (driveId) {
    // drive.google.com/thumbnail?id=ID&sz=w600 funciona en móvil y escritorio sin restricciones CORS
    return `https://drive.google.com/thumbnail?id=${driveId}&sz=w600`;
  }

  // 3. URLs web directas (http/https)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  return trimmed;
}

// Visor de foto en pantalla completa (Lightbox)
function abrirFotoCompleta(url, nombre) {
  const modal = document.getElementById("modalFotoCompleta");
  const img = document.getElementById("modalFotoImg");
  const titulo = document.getElementById("modalFotoTitulo");
  if (!modal || !img) return;

  if (!url) {
    mostrarToast("Este licor no tiene foto asignada", "info");
    return;
  }

  img.onerror = function() {
    this.onerror = null;
    const idMatch = this.src.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      this.src = `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1200`;
    } else {
      this.style.display = 'none';
    }
  };

  img.src = "";
  img.style.display = "";
  img.src = formatearUrlImagen(url);
  img.alt = nombre || "Licor";

  if (titulo) {
    titulo.textContent = nombre || "Producto";
  }

  modal.classList.remove("hidden", "opacity-0", "pointer-events-none");
  modal.classList.add("flex", "opacity-100");
  inicializarIconos();
  document.body.style.overflow = "hidden";
}

function cerrarFotoCompleta() {
  const modal = document.getElementById("modalFotoCompleta");
  if (!modal) return;
  modal.classList.add("opacity-0", "pointer-events-none");
  modal.classList.remove("opacity-100");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 200);
  document.body.style.overflow = "";
}

// Cerrar con tecla Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarFotoCompleta();
});

// Estado Global
let state = {
  vendedor: "Colaborador",
  productos: [],
  categoriaSeleccionada: "Todas",
  busquedaProducto: "",
  ordenProductos: "az",
  
  // Clientes
  clientes: [], // Lista filtrada que pertenece a este vendedor
  busquedaCliente: "",
  
  // Pedido en construcción
  pedidoCarrito: [], // [{ codigo, nombre, cantidad, precioVentaCRC, precioVentaUSD }]
  pedidoClienteSeleccionado: null,
  
  // Historial de pedidos de este vendedor
  misPedidos: [],
  
  // Facturas consolidadas de este vendedor (pedidos facturados por Carlos/Daniel)
  facturas: [],
  busquedaFactura: "",
  
  // Comisiones
  filtroPeriodoComision: "todos",
  porcentajeComision: 13,
  liquidaciones: [], // Liquidaciones pagadas por Carlos/Daniel
  
  config: {
    sheetsUrl: "",
    tipoCambio: 520
  },
  
  colaOffline: []
};

// ==========================================================================
// INICIALIZACIÓN
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  cargarEstadoLocal();
  comprobarVendedor();
  aplicarConfigUI();
  inicializarIconos();
  renderizarTodo();

  // Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Red
  window.addEventListener("online", () => {
    actualizarBannerConexion();
    if (state.config.sheetsUrl) sincronizarConSheets(false);
  });
  window.addEventListener("offline", () => {
    actualizarBannerConexion();
  });

  if (state.config.sheetsUrl && navigator.onLine) {
    sincronizarConSheets(false);
  }
});

function inicializarIconos() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } catch (e) {}
}

function mostrarToast(msg, tipo = "info") {
  const toast = document.getElementById("toast");
  const box = document.getElementById("toastBox");
  const text = document.getElementById("toastMsg");
  const icon = document.getElementById("toastIcon");
  if (!toast || !box || !text) return;

  text.textContent = msg;
  box.className = "px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-medium border ";

  if (tipo === "success") {
    box.className += "bg-emerald-950 border-emerald-500/50 text-emerald-200";
    if (icon) icon.setAttribute("data-lucide", "check-circle");
  } else if (tipo === "error") {
    box.className += "bg-rose-950 border-rose-500/50 text-rose-200";
    if (icon) icon.setAttribute("data-lucide", "alert-circle");
  } else {
    box.className += "bg-slate-900 border-amber-500/40 text-amber-200";
    if (icon) icon.setAttribute("data-lucide", "info");
  }

  inicializarIconos();
  toast.classList.remove("opacity-0", "pointer-events-none", "-translate-y-20");
  toast.classList.add("opacity-100", "translate-y-0");

  setTimeout(() => {
    toast.classList.add("opacity-0", "pointer-events-none", "-translate-y-20");
    toast.classList.remove("opacity-100", "translate-y-0");
  }, 3500);
}

// ==========================================================================
// PERSISTENCIA LOCAL
// ==========================================================================
function cargarEstadoLocal() {
  const v = localStorage.getItem("pv_vendedor");
  if (v) state.vendedor = v;

  const cfg = localStorage.getItem("pv_config");
  if (cfg) {
    try { state.config = { ...state.config, ...JSON.parse(cfg) }; } catch(e) {}
  } else {
    // Si no está en pv_config, intentar heredar del sistema principal si comparte origen
    const mainCfg = localStorage.getItem("inv_config_v2") || localStorage.getItem("destape_sheets_url");
    if (mainCfg) {
      try {
        if (mainCfg.startsWith("http")) state.config.sheetsUrl = mainCfg;
        else {
          const parsed = JSON.parse(mainCfg);
          if (parsed.sheetsUrl) state.config.sheetsUrl = parsed.sheetsUrl;
        }
      } catch(e) {}
    }
  }

  // Leer parámetro URL ?api= si se abrió mediante enlace
  const urlParams = new URLSearchParams(window.location.search);
  const apiParam = urlParams.get("api");
  if (apiParam && apiParam.startsWith("http")) {
    state.config.sheetsUrl = apiParam;
    localStorage.setItem("pv_config", JSON.stringify(state.config));
  }
  const vendParam = urlParams.get("vendedor");
  if (vendParam) {
    state.vendedor = vendParam;
    localStorage.setItem("pv_vendedor", vendParam);
  }

  const prods = localStorage.getItem("pv_productos");
  if (prods) {
    try { state.productos = JSON.parse(prods); } catch(e) { state.productos = []; }
  } else {
    const mainProds = localStorage.getItem("inv_productos_v2");
    if (mainProds) {
      try {
        const parsed = JSON.parse(mainProds);
        const list = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (list.length > 0) {
          state.productos = list.map(p => ({
            codigo: String(p.codigo || "").trim(),
            nombre: String(p.nombre || "").trim(),
            categoria: String(p.categoria || "General").trim(),
            precioVentaCRC: parseNum(p.precioVentaCRC, 0),
            precioVentaUSD: parseNum(p.precioVentaUSD, 0),
            imagenUrl: String(p.imagenUrl || p.imagen || "").trim()
          }));
          guardarProductosLocal();
        }
      } catch(e) {}
    }
  }

  const cli = localStorage.getItem("pv_clientes");
  if (cli) {
    try { state.clientes = JSON.parse(cli); } catch(e) { state.clientes = []; }
  }

  const peds = localStorage.getItem("pv_pedidos");
  if (peds) {
    try { state.misPedidos = JSON.parse(peds); } catch(e) { state.misPedidos = []; }
  }

  const facts = localStorage.getItem("pv_facturas");
  if (facts) {
    try { state.facturas = JSON.parse(facts); } catch(e) { state.facturas = []; }
  }

  const liqs = localStorage.getItem("pv_liquidaciones");
  if (liqs) {
    try { state.liquidaciones = JSON.parse(liqs); } catch(e) { state.liquidaciones = []; }
  }

  const carr = localStorage.getItem("pv_carrito");
  if (carr) {
    try { state.pedidoCarrito = JSON.parse(carr); } catch(e) { state.pedidoCarrito = []; }
  }

  const cola = localStorage.getItem("pv_cola_offline");
  if (cola) {
    try { state.colaOffline = JSON.parse(cola); } catch(e) { state.colaOffline = []; }
  }
}

function guardarProductosLocal() {
  localStorage.setItem("pv_productos", JSON.stringify(state.productos));
}
function guardarClientesLocal() {
  localStorage.setItem("pv_clientes", JSON.stringify(state.clientes));
}
function guardarPedidosLocal() {
  // Solo guardar en localStorage los pedidos de este vendedor
  const miVend = String(state.vendedor || "").trim().toLowerCase();
  const soloMios = miVend
    ? (state.misPedidos || []).filter(p => String(p.vendedor || "").trim().toLowerCase() === miVend)
    : (state.misPedidos || []);
  localStorage.setItem("pv_pedidos", JSON.stringify(soloMios));
}
function guardarFacturasLocal() {
  localStorage.setItem("pv_facturas", JSON.stringify(state.facturas || []));
}
function guardarLiquidacionesLocal() {
  localStorage.setItem("pv_liquidaciones", JSON.stringify(state.liquidaciones || []));
}
function guardarCarritoLocal() {
  localStorage.setItem("pv_carrito", JSON.stringify(state.pedidoCarrito));
}
function guardarColaLocal() {
  localStorage.setItem("pv_cola_offline", JSON.stringify(state.colaOffline));
  actualizarBadgeCola();
}

function actualizarBadgeCola() {
  const badge = document.getElementById("syncBadge");
  if (!badge) return;
  const count = state.colaOffline ? state.colaOffline.length : 0;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function actualizarBannerConexion() {
  const banner = document.getElementById("offlineSyncBanner");
  if (!banner) return;
  if (!navigator.onLine) {
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

// ==========================================================================
// GESTIÓN DE IDENTIDAD DE VENDEDOR
// ==========================================================================
function comprobarVendedor() {
  if (!state.vendedor || state.vendedor === "Colaborador" || state.vendedor.trim() === "") {
    abrirModalVendedor(true);
  }
  actualizarUIVendedor();
}

function abrirModalVendedor(forzado = false) {
  const modal = document.getElementById("modalVendedor");
  const input = document.getElementById("inputNombreVendedor");
  const btnCerrar = document.getElementById("btnCerrarModalVendedor");
  if (input) input.value = state.vendedor || "";
  if (btnCerrar) {
    if (forzado) btnCerrar.classList.add("hidden");
    else btnCerrar.classList.remove("hidden");
  }
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
}

function cerrarModalVendedor() {
  const modal = document.getElementById("modalVendedor");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function guardarNombreVendedor() {
  const input = document.getElementById("inputNombreVendedor");
  const val = (input ? input.value : "").trim();
  if (!val) {
    mostrarToast("Por favor ingresa tu nombre de vendedor o colaborador.", "error");
    return;
  }
  state.vendedor = val;
  localStorage.setItem("pv_vendedor", val);
  cerrarModalVendedor();
  actualizarUIVendedor();
  mostrarToast(`Perfil activo: ${val} 👤`, "success");
  
  // Re-sincronizar para cargar clientes de este vendedor
  if (state.config.sheetsUrl && navigator.onLine) {
    sincronizarConSheets(false);
  } else {
    renderizarTodo();
  }
}

function actualizarUIVendedor() {
  const headerName = document.getElementById("headerVendedorNombre");
  const badgeCli = document.getElementById("clientesVendedorBadge");
  if (headerName) headerName.textContent = state.vendedor || "Mi Perfil";
  if (badgeCli) badgeCli.textContent = state.vendedor || "Mi Perfil";
}

function aplicarConfigUI() {
  const tc = document.getElementById("headerExchangeRate");
  if (tc) tc.textContent = state.config.tipoCambio || 520;
  actualizarBadgeCola();
  actualizarBannerConexion();
}

// ==========================================================================
// MODAL CONFIGURACIÓN SHEETS
// ==========================================================================
function abrirModalConfig() {
  const modal = document.getElementById("modalConfig");
  const inputUrl = document.getElementById("configSheetsUrl");
  const inputTC = document.getElementById("configTipoCambio");
  if (inputUrl) inputUrl.value = state.config.sheetsUrl || "";
  if (inputTC) inputTC.value = state.config.tipoCambio || 520;
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
}

function cerrarModalConfig() {
  const modal = document.getElementById("modalConfig");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function guardarConfiguracionForm() {
  const inputUrl = document.getElementById("configSheetsUrl");
  const inputTC = document.getElementById("configTipoCambio");
  const url = (inputUrl ? inputUrl.value : "").trim();
  const tc = parseNum(inputTC ? inputTC.value : 520, 520);

  state.config.sheetsUrl = url;
  state.config.tipoCambio = tc;
  localStorage.setItem("pv_config", JSON.stringify(state.config));
  aplicarConfigUI();
  cerrarModalConfig();
  mostrarToast("Configuración guardada ⚙️", "success");

  if (url && navigator.onLine) {
    sincronizarConSheets(true);
  }
}

// ==========================================================================
// VACIAR CACHÉ, BORRAR DATOS Y ACTUALIZAR APP
// ==========================================================================
async function forzarActualizacionApp() {
  if (!confirm("¿Deseas vaciar el caché del navegador y forzar la descarga de la versión más reciente?")) return;

  mostrarToast("Vaciando caché y buscando última versión... ⏳", "info");

  try {
    // 1. Limpiar todos los cachés de CacheStorage (Service Worker)
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map(key => caches.delete(key)));
    }

    // 2. Desregistrar Service Workers activos para forzar instalación limpia
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    mostrarToast("¡Caché eliminado! Recargando aplicación... 🚀", "success");

    // 3. Forzar recarga con query timestamp
    setTimeout(() => {
      window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
    }, 800);
  } catch (err) {
    console.error("Error al limpiar caché:", err);
    window.location.reload(true);
  }
}

function limpiarCacheLocal() {
  if (confirm("¿Borrar todos los datos locales y sincronizar todo desde cero directamente con Google Sheets?")) {
    const sheetsUrl = state.config.sheetsUrl;
    const vendedor = state.vendedor;
    const config = { ...state.config };

    // Limpiar claves locales de la app preventa
    localStorage.removeItem("pv_productos");
    localStorage.removeItem("pv_clientes");
    localStorage.removeItem("pv_pedidos");
    localStorage.removeItem("pv_facturas");
    localStorage.removeItem("pv_carrito");
    localStorage.removeItem("pv_cola_offline");

    // Reiniciar estado en memoria
    state.productos = [];
    state.clientes = [];
    state.misPedidos = [];
    state.facturas = [];
    state.pedidoCarrito = [];
    state.colaOffline = [];

    // Preservar configuración y vendedor
    state.config = config;
    state.vendedor = vendedor;
    localStorage.setItem("pv_config", JSON.stringify(config));
    localStorage.setItem("pv_vendedor", vendedor);

    renderizarTodo();
    mostrarToast("Datos locales eliminados. Sincronizando con Sheets... 🧹", "info");

    if (sheetsUrl && navigator.onLine) {
      sincronizarConSheets(true);
    }
  }
}

// ==========================================================================
// NAVEGACIÓN DE VISTAS
// ==========================================================================
function cambiarVista(vista) {
  ["productos", "pedidos", "facturas", "comision", "clientes"].forEach(v => {
    const el = document.getElementById("view" + capitalizar(v));
    const tab = document.getElementById("navTab-" + v);
    if (el) {
      if (v === vista) el.classList.remove("hidden");
      else el.classList.add("hidden");
    }
    if (tab) {
      if (v === vista) tab.classList.add("active");
      else tab.classList.remove("active");
    }
  });

  if (vista === "productos") renderizarProductos();
  if (vista === "pedidos") renderizarModuloPedidos();
  if (vista === "facturas") renderizarFacturas();
  if (vista === "comision") renderizarComisiones();
  if (vista === "clientes") renderizarClientes();

  window.scrollTo({ top: 0, behavior: "smooth" });
  inicializarIconos();
}

function capitalizar(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderizarTodo() {
  renderizarProductos();
  renderizarModuloPedidos();
  renderizarFacturas();
  renderizarComisiones();
  renderizarClientes();
  actualizarBadgeCola();
}

// ==========================================================================
// 1. MÓDULO PRODUCTOS (CATÁLOGO DIGITAL CON PRECIOS DE VENTA)
// ==========================================================================
function renderizarProductos() {
  const cont = document.getElementById("productosList");
  const countEl = document.getElementById("prodCount");
  if (!cont) return;

  renderizarPillsCategorias();

  let prods = [...state.productos];
  const q = (state.busquedaProducto || "").toLowerCase().trim();
  const cat = state.categoriaSeleccionada || "Todas";

  if (cat !== "Todas") {
    prods = prods.filter(p => String(p.categoria || "").toLowerCase() === cat.toLowerCase());
  }

  if (q) {
    prods = prods.filter(p => 
      String(p.nombre || "").toLowerCase().includes(q) ||
      String(p.codigo || "").toLowerCase().includes(q) ||
      String(p.categoria || "").toLowerCase().includes(q)
    );
  }

  // Ordenar
  if (state.ordenProductos === "az") {
    prods.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  } else if (state.ordenProductos === "za") {
    prods.sort((a, b) => String(b.nombre).localeCompare(String(a.nombre)));
  } else if (state.ordenProductos === "precio_asc") {
    prods.sort((a, b) => parseNum(a.precioVentaCRC) - parseNum(b.precioVentaCRC));
  } else if (state.ordenProductos === "precio_desc") {
    prods.sort((a, b) => parseNum(b.precioVentaCRC) - parseNum(a.precioVentaCRC));
  }

  if (countEl) countEl.textContent = prods.length;

  if (prods.length === 0) {
    if (!state.config.sheetsUrl) {
      cont.innerHTML = `
        <div class="text-center py-10 px-4 bg-gradient-to-b from-slate-900/90 to-slate-950 border border-amber-500/30 rounded-3xl space-y-3 shadow-xl">
          <div class="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
            <i data-lucide="link" class="w-6 h-6"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white">Vincular con Google Sheets</h3>
            <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Conecta la URL de Google Apps Script para descargar el catálogo de licores y sincronizar pedidos.</p>
          </div>
          <button onclick="abrirModalConfig()" class="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 active:scale-95 transition-all inline-flex items-center gap-2">
            <i data-lucide="settings" class="w-4 h-4"></i>
            <span>Configurar Enlace de Sheets</span>
          </button>
        </div>
      `;
    } else {
      cont.innerHTML = `
        <div class="text-center py-10 px-4 bg-slate-900/60 rounded-3xl border border-slate-800 space-y-3">
          <i data-lucide="wine" class="w-10 h-10 mx-auto text-amber-400/60 stroke-1"></i>
          <div>
            <p class="text-xs font-bold text-slate-300">${q ? "No se encontraron licores con esa búsqueda." : "Catálogo listo para sincronizar."}</p>
            <p class="text-[11px] text-slate-400 mt-0.5">${q ? "Intenta con otro término o borra el filtro." : "Presiona el botón para descargar los licores y precios desde la nube."}</p>
          </div>
          ${!q ? `
            <button onclick="sincronizarConSheets(true)" class="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs rounded-xl active:scale-95 transition-all inline-flex items-center gap-1.5">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
              <span>Sincronizar Licores Ahora</span>
            </button>
          ` : ''}
        </div>
      `;
    }
    inicializarIconos();
    return;
  }

  cont.innerHTML = prods.map(p => {
    const pCRC = parseNum(p.precioVentaCRC, 0);
    const pUSD = parseNum(p.precioVentaUSD, 0);
    const imgUrlFormatted = formatearUrlImagen(p.imagenUrl);

    // Cantidad ya presente en el pedido actual si existe
    const enPedido = state.pedidoCarrito.find(it => it.codigo === p.codigo);
    const cantEnPedido = enPedido ? enPedido.cantidad : 0;

    const imgHtml = imgUrlFormatted
      ? `
        <div onclick="abrirFotoCompleta('${imgUrlFormatted}', '${p.nombre.replace(/'/g, "\\'")}')" class="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-slate-950 border border-slate-700/80 shadow-inner shrink-0 cursor-pointer group">
          <img src="${imgUrlFormatted}" alt="${p.nombre}" 
            onerror="this.onerror=null; const m=this.src.match(/[?&]id=([a-zA-Z0-9_-]+)/); if(m){this.src='https://drive.google.com/thumbnail?id='+m[1]+'&sz=w800';}else{this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-2xl\\'>🍷</div>';}"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
            <span class="opacity-0 group-hover:opacity-100 bg-black/60 text-white rounded-full p-1 text-[10px] transition-opacity">
              <i data-lucide="zoom-in" class="w-3.5 h-3.5"></i>
            </span>
          </div>
          <span class="absolute bottom-1 right-1 bg-black/70 text-[9px] text-amber-300 font-mono px-1 rounded backdrop-blur-xs">🔍 Ver</span>
        </div>
      `
      : `
        <div class="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 flex flex-col items-center justify-center text-slate-500 shrink-0">
          <span class="text-3xl mb-0.5">🍷</span>
          <span class="text-[9px] text-slate-500 font-mono font-medium">Sin foto</span>
        </div>
      `;

    return `
      <div class="bg-slate-900/90 border border-slate-800/90 hover:border-amber-500/40 rounded-3xl p-3 flex gap-3 shadow-md hover:shadow-xl transition-all">
        ${imgHtml}

        <div class="min-w-0 flex-1 flex flex-col justify-between py-0.5">
          <div>
            <div class="flex items-center justify-between gap-1 mb-0.5">
              <span class="text-[9.5px] font-bold uppercase tracking-wider text-amber-400/90 font-mono block truncate">${p.categoria || 'Licor'}</span>
              <span class="text-[9px] text-slate-500 font-mono shrink-0">${p.codigo}</span>
            </div>
            <h3 class="text-sm font-bold text-white leading-snug line-clamp-2">${p.nombre || p.codigo}</h3>
          </div>

          <div class="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
            <div class="font-mono">
              <span class="text-sm font-black text-emerald-400 block leading-none">${fmtCRC(pCRC)}</span>
              ${pUSD > 0 ? `<span class="text-[10px] text-slate-400 leading-none">(${fmtUSD(pUSD)})</span>` : ''}
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              ${cantEnPedido > 0 ? `
                <span class="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/80 border border-amber-500/40 px-2 py-1 rounded-xl">
                  ${cantEnPedido}x
                </span>
              ` : ''}
              <button onclick="agregarAlPedidoDesdeCatalogo('${p.codigo}')" class="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1 active:scale-95 transition-all shadow-md shadow-amber-500/20">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                <span>Pedir</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  inicializarIconos();
}

function renderizarPillsCategorias() {
  const cont = document.getElementById("categoryPills");
  if (!cont) return;

  const categorias = ["Todas"];
  state.productos.forEach(p => {
    const c = String(p.categoria || "General").trim();
    if (c && !categorias.includes(c)) categorias.push(c);
  });

  cont.innerHTML = categorias.map(c => `
    <button onclick="filtrarCategoria('${c}')" class="cat-pill ${state.categoriaSeleccionada === c ? 'active' : ''} px-3.5 py-1.5 rounded-full shrink-0 font-bold text-xs">
      ${c}
    </button>
  `).join("");
}

function filtrarCategoria(cat) {
  state.categoriaSeleccionada = cat;
  renderizarProductos();
}

function filtrarProductos() {
  const input = document.getElementById("searchProductos");
  state.busquedaProducto = input ? input.value : "";
  renderizarProductos();
}

function cambiarOrden() {
  const ordenes = ["az", "za", "precio_asc", "precio_desc"];
  const labels = {
    az: "A-Z",
    za: "Z-A",
    precio_asc: "₡ Menor",
    precio_desc: "₡ Mayor"
  };
  const actualIdx = ordenes.indexOf(state.ordenProductos);
  const nextIdx = (actualIdx + 1) % ordenes.length;
  state.ordenProductos = ordenes[nextIdx];
  const lbl = document.getElementById("sortLabel");
  if (lbl) lbl.textContent = labels[state.ordenProductos];
  renderizarProductos();
}

// ==========================================================================
// 2. MÓDULO PEDIDOS (ENCARGOS)
// ==========================================================================
function agregarAlPedidoDesdeCatalogo(codigo) {
  const p = state.productos.find(prod => prod.codigo === codigo);
  if (!p) return;

  const ya = state.pedidoCarrito.find(it => it.codigo === codigo);
  if (ya) {
    ya.cantidad += 1;
  } else {
    state.pedidoCarrito.push({
      codigo: p.codigo,
      nombre: p.nombre || p.codigo,
      imagenUrl: p.imagenUrl || "",
      cantidad: 1,
      precioVentaCRC: parseNum(p.precioVentaCRC, 0),
      precioVentaUSD: parseNum(p.precioVentaUSD, 0)
    });
  }

  guardarCarritoLocal();
  mostrarToast(`1x ${p.nombre} agregado al pedido 🛍️`, "success");
  renderizarProductos();
  renderizarModuloPedidos();

  // Actualizar indicador en barra inferior
  const badgeNav = document.getElementById("navPedidosBadge");
  if (badgeNav) badgeNav.classList.remove("hidden");
}

function renderizarModuloPedidos() {
  poblarSelectorClientesPedido();
  renderizarItemsPedidoActual();
  renderizarMisPedidosHistorial();
}

function poblarSelectorClientesPedido() {
  const select = document.getElementById("pedidoClienteSelect");
  if (!select) return;

  const misClientes = obtenerClientesPropios();
  const seleccionado = state.pedidoClienteSeleccionado || "";

  select.innerHTML = '<option value="">-- Selecciona un cliente registrado --</option>';
  misClientes.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    const pts = parseNum(c.puntos, 0);
    opt.textContent = `${c.nombre} (${c.telefono})${pts > 0 ? ` [🎁 ${pts.toLocaleString()} pts]` : ''}`;
    if (c.id === seleccionado) opt.selected = true;
    select.appendChild(opt);
  });
}

function onPedidoClienteChange() {
  const select = document.getElementById("pedidoClienteSelect");
  state.pedidoClienteSeleccionado = select ? select.value : "";
}

function renderizarItemsPedidoActual() {
  const cont = document.getElementById("pedidoItemsList");
  const countBadge = document.getElementById("pedidoItemsCount");
  const totalUnidsEl = document.getElementById("pedidoTotalUnidades");
  const totalCRCEl = document.getElementById("pedidoTotalCRC");
  if (!cont) return;

  const items = state.pedidoCarrito || [];
  if (countBadge) countBadge.textContent = items.length;

  let totalUnidades = 0;
  let totalMontoCRC = 0;

  if (items.length === 0) {
    cont.innerHTML = `
      <div class="py-4 text-center text-slate-500 text-xs bg-slate-950/40 rounded-2xl border border-slate-800/60">
        No hay licores en el pedido todavía.
      </div>
    `;
    if (totalUnidsEl) totalUnidsEl.textContent = "0 unids";
    if (totalCRCEl) totalCRCEl.textContent = "₡0";
    const badgeNav = document.getElementById("navPedidosBadge");
    if (badgeNav) badgeNav.classList.add("hidden");
    return;
  }

  cont.innerHTML = items.map((it, idx) => {
    totalUnidades += it.cantidad;
    const subCRC = it.cantidad * it.precioVentaCRC;
    totalMontoCRC += subCRC;

    const imgUrlFormateada = formatearUrlImagen(it.imagenUrl);
    const imgHtml = imgUrlFormateada 
      ? `<img src="${imgUrlFormateada}" alt="${it.nombre}" class="w-12 h-12 rounded-xl object-cover border border-slate-700/80 bg-slate-900 shrink-0 cursor-pointer" onclick="abrirFotoCompleta('${imgUrlFormateada}', '${it.nombre.replace(/'/g, "\\'")}')" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0\\'>🍾</div>';">`
      : `<div class="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0 text-base">🍾</div>`;

    return `
      <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2.5">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          ${imgHtml}
          <div class="min-w-0 flex-1">
            <h4 class="text-xs font-bold text-white truncate">${it.nombre}</h4>
            <span class="text-[11px] font-mono text-emerald-400 font-bold">${fmtCRC(subCRC)}</span>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0 font-mono">
          <button onclick="ajustarCantidadItemPedido(${idx}, -1)" class="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs active:scale-95">-</button>
          <span class="text-xs font-black text-white w-6 text-center">${it.cantidad}</span>
          <button onclick="ajustarCantidadItemPedido(${idx}, 1)" class="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs active:scale-95">+</button>
          <button onclick="eliminarItemPedido(${idx})" class="w-6 h-6 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-500/30 text-rose-400 flex items-center justify-center text-xs ml-1" title="Quitar">✕</button>
        </div>
      </div>
    `;
  }).join("");

  if (totalUnidsEl) totalUnidsEl.textContent = `${totalUnidades} unids`;
  if (totalCRCEl) totalCRCEl.textContent = fmtCRC(totalMontoCRC);

  const badgeNav = document.getElementById("navPedidosBadge");
  if (badgeNav) badgeNav.classList.remove("hidden");
}

function ajustarCantidadItemPedido(idx, delta) {
  if (!state.pedidoCarrito[idx]) return;
  state.pedidoCarrito[idx].cantidad += delta;
  if (state.pedidoCarrito[idx].cantidad <= 0) {
    state.pedidoCarrito.splice(idx, 1);
  }
  guardarCarritoLocal();
  renderizarItemsPedidoActual();
}

function eliminarItemPedido(idx) {
  state.pedidoCarrito.splice(idx, 1);
  guardarCarritoLocal();
  renderizarItemsPedidoActual();
}

function vaciarCarritoPedido() {
  if (state.pedidoCarrito.length === 0) return;
  if (!confirm("¿Deseas vaciar todos los licores de este pedido?")) return;
  state.pedidoCarrito = [];
  guardarCarritoLocal();
  renderizarItemsPedidoActual();
  mostrarToast("Pedido vaciado", "info");
}

function guardarPedidoActual() {
  if (!state.pedidoCarrito || state.pedidoCarrito.length === 0) {
    mostrarToast("Agrega al menos un licor al pedido.", "error");
    return;
  }

  const cliId = state.pedidoClienteSeleccionado;
  if (!cliId) {
    mostrarToast("Debes seleccionar un cliente para registrar el encargo.", "error");
    return;
  }

  const cli = state.clientes.find(c => c.id === cliId);
  const clienteNombre = cli ? cli.nombre : "Cliente General";
  const clienteTelefono = cli ? cli.telefono : "";

  const ahora = new Date();
  const idPedido = "PED-" + ahora.toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();

  const pedidoObj = {
    id: idPedido,
    fecha: ahora.toISOString(),
    vendedor: state.vendedor || "Colaborador",
    cliente: clienteNombre,
    clienteTelefono: clienteTelefono,
    estado: "pendiente",
    items: state.pedidoCarrito.map(it => ({
      codigo: it.codigo,
      nombre: it.nombre,
      cantidad: it.cantidad,
      precioVentaCRC: it.precioVentaCRC,
      precioVentaUSD: it.precioVentaUSD
    }))
  };

  state.misPedidos.unshift(pedidoObj);
  guardarPedidosLocal();

  // Encolar y sincronizar con Google Sheets
  encolarAccionSync("registrarPedido", { pedido: pedidoObj });

  // Limpiar pedido actual
  state.pedidoCarrito = [];
  state.pedidoClienteSeleccionado = null;
  guardarCarritoLocal();

  renderizarModuloPedidos();
  mostrarToast(`¡Pedido ${idPedido} registrado exitosamente para ${clienteNombre}! 🚀`, "success");
}

// ==========================================================================
// BÚSQUEDA DINÁMICA DE PRODUCTOS PARA EL PEDIDO
// ==========================================================================
function buscarProductosParaPedido(query) {
  const dropdown = document.getElementById("pedidoResultadosBusqueda");
  const btnLimpiar = document.getElementById("btnLimpiarBuscadorPedido");
  if (!dropdown) return;

  const q = String(query || "").trim().toLowerCase();
  if (btnLimpiar) {
    if (q) btnLimpiar.classList.remove("hidden");
    else btnLimpiar.classList.add("hidden");
  }

  if (!q) {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
    return;
  }

  // Filtrar productos por nombre o código
  const coincidencias = (state.productos || []).filter(p => {
    const nom = String(p.nombre || "").toLowerCase();
    const cod = String(p.codigo || "").toLowerCase();
    const cat = String(p.categoria || "").toLowerCase();
    return nom.includes(q) || cod.includes(q) || cat.includes(q);
  }).slice(0, 15); // Limitar a 15 para velocidad

  if (coincidencias.length === 0) {
    dropdown.innerHTML = `
      <div class="p-3 text-center text-xs text-slate-400">
        No se encontró ningún licor que coincida con "<b>${q}</b>"
      </div>
    `;
    dropdown.classList.remove("hidden");
    return;
  }

  dropdown.innerHTML = coincidencias.map(p => {
    const pCRC = parseNum(p.precioVentaCRC, 0);
    const pUSD = parseNum(p.precioVentaUSD, 0);
    const yaEnCarrito = (state.pedidoCarrito || []).find(it => it.codigo === p.codigo);
    const cantYa = yaEnCarrito ? yaEnCarrito.cantidad : 0;
    const imgUrlFormatted = formatearUrlImagen(p.imagenUrl);

    const miniImg = imgUrlFormatted
      ? `<img src="${imgUrlFormatted}" alt="${p.nombre}" 
          onerror="this.onerror=null; const m=this.src.match(/[?&]id=([a-zA-Z0-9_-]+)/); if(m){this.src='https://drive.google.com/thumbnail?id='+m[1]+'&sz=w400';}else{this.style.display='none';}" 
          class="w-11 h-11 rounded-xl object-cover bg-slate-950 border border-slate-700/80 shrink-0">`
      : `<div class="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-base shrink-0">🍷</div>`;

    return `
      <div onclick="seleccionarProductoParaPedido('${p.codigo}')" class="p-2.5 hover:bg-slate-800/80 cursor-pointer flex items-center justify-between gap-3 transition-colors">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          ${miniImg}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-bold text-white truncate">${p.nombre}</span>
              ${cantYa > 0 ? `<span class="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold">${cantYa} en pedido</span>` : ''}
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
              ${p.codigo} • ${p.categoria || 'General'}
            </div>
          </div>
        </div>
        <div class="text-right shrink-0 font-mono">
          <span class="text-xs font-bold text-emerald-400 block">${fmtCRC(pCRC)}</span>
          ${pUSD > 0 ? `<span class="text-[10px] text-slate-400">(${fmtUSD(pUSD)})</span>` : ''}
        </div>
      </div>
    `;
  }).join("");

  dropdown.classList.remove("hidden");
}

function seleccionarProductoParaPedido(codigo) {
  const p = (state.productos || []).find(prod => prod.codigo === codigo);
  if (!p) return;

  const ya = state.pedidoCarrito.find(it => it.codigo === codigo);
  if (ya) {
    ya.cantidad += 1;
  } else {
    state.pedidoCarrito.push({
      codigo: p.codigo,
      nombre: p.nombre || p.codigo,
      imagenUrl: p.imagenUrl || "",
      cantidad: 1,
      precioVentaCRC: parseNum(p.precioVentaCRC, 0),
      precioVentaUSD: parseNum(p.precioVentaUSD, 0)
    });
  }

  guardarCarritoLocal();
  mostrarToast(`1x ${p.nombre} sumado al pedido 🛍️`, "success");
  renderizarItemsPedidoActual();

  // Actualizar indicador en barra inferior
  const badgeNav = document.getElementById("navPedidosBadge");
  if (badgeNav) badgeNav.classList.remove("hidden");

  // Limpiar input y cerrar dropdown
  limpiarBuscadorPedido();
}

function limpiarBuscadorPedido() {
  const input = document.getElementById("pedidoBuscarProductoInput");
  const dropdown = document.getElementById("pedidoResultadosBusqueda");
  const btnLimpiar = document.getElementById("btnLimpiarBuscadorPedido");
  if (input) {
    input.value = "";
    input.focus();
  }
  if (dropdown) {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
  }
  if (btnLimpiar) btnLimpiar.classList.add("hidden");
}

// Cerrar dropdown al hacer click fuera
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("pedidoResultadosBusqueda");
  const input = document.getElementById("pedidoBuscarProductoInput");
  if (!dropdown || !input) return;
  if (!dropdown.contains(e.target) && e.target !== input) {
    dropdown.classList.add("hidden");
  }
});

function renderizarMisPedidosHistorial() {
  const cont = document.getElementById("misPedidosList");
  const countEl = document.getElementById("misPedidosCount");
  if (!cont) return;

  // Solo mostrar pedidos del vendedor actual (seguridad en render)
  const miVend = String(state.vendedor || "Colaborador").trim().toLowerCase();
  const lista = (state.misPedidos || []).filter(p => {
    const vend = String(p.vendedor || "").trim().toLowerCase();
    return vend === miVend;
  });
  if (countEl) countEl.textContent = lista.length;

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="text-center py-6 text-slate-500 text-xs">
        No has registrado pedidos todavía.
      </div>
    `;
    return;
  }

  cont.innerHTML = lista.map(p => {
    const fStr = p.fecha ? new Date(p.fecha).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "S/F";
    const totalBotellas = (p.items || []).reduce((acc, it) => acc + parseNum(it.cantidad, 1), 0);
    const esComprado = p.estado === "comprado";

    return `
      <div class="p-3 bg-slate-950/80 border ${esComprado ? 'border-emerald-500/40' : 'border-slate-800'} rounded-2xl space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-mono font-bold text-amber-400 text-[11px]">${p.id}</span>
          <span class="text-[10px] text-slate-400 font-mono">${fStr}</span>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <span class="font-bold text-white text-xs block">${p.cliente}</span>
            ${p.clienteTelefono ? `<span class="text-[10px] text-slate-400 font-mono">📞 ${p.clienteTelefono}</span>` : ''}
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${esComprado ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40' : 'bg-amber-950/80 text-amber-300 border-amber-500/40'}">
            ${esComprado ? '✅ Comprado' : '⏳ Pendiente'}
          </span>
        </div>

        <div class="pt-1 border-t border-slate-800/80 text-[11px] text-slate-300 space-y-0.5">
          ${(p.items || []).map(it => `
            <div class="flex justify-between font-mono">
              <span class="truncate">${it.cantidad}x ${it.nombre}</span>
            </div>
          `).join("")}
          <div class="pt-1 flex items-center justify-between font-bold text-amber-400 font-mono">
            <span>Total unidades: ${totalBotellas} unids</span>
            <button onclick="compartirPedidoWhatsApp('${p.id}')" title="Enviar comprobante por WhatsApp" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg active:scale-95 font-sans font-bold text-[10px] flex items-center gap-1 transition-all">
              <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
              <span>WhatsApp</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  inicializarIconos();
}

// ==========================================================================
// COMPARTIR PEDIDO / FACTURA POR WHATSAPP (MISMOS DATOS QUE APP PRINCIPAL)
// ==========================================================================
function compartirPedidoWhatsApp(idPedido) {
  const p = (state.misPedidos || []).find(ped => ped.id === idPedido);
  if (!p) {
    mostrarToast("Pedido no encontrado.", "error");
    return;
  }

  const negocio = "DC EL DESTAPE LICORES";
  const telefono = "+506 8992-7936";
  const fecha = p.fecha ? new Date(p.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : new Date().toLocaleString();
  const vendedor = p.vendedor || state.vendedor || "Colaborador";

  let totalBotellas = 0;
  (p.items || []).forEach(i => totalBotellas += Number(i.cantidad || 1));

  let texto = `🍷 *${negocio.toUpperCase()}* 🍷\n`;
  texto += `📱 *Tel:* ${telefono}\n`;
  texto += `--------------------------------\n`;
  texto += `📋 *COMPROBANTE DE ENCARGO*\n`;
  texto += `📅 Fecha: ${fecha}\n`;
  texto += `🎫 N°: ${p.id}\n`;
  texto += `👤 Atendido por: ${vendedor}\n`;
  texto += `👤 Cliente: ${p.cliente || "General"}\n`;
  texto += `--------------------------------\n`;

  (p.items || []).forEach(i => {
    texto += `• *${i.cantidad}x* ${i.nombre}\n`;
  });

  texto += `--------------------------------\n`;
  texto += `📦 *TOTAL BOTELLAS ENCARGADAS:* ${totalBotellas} unids\n`;
  texto += `📌 *Estado:* ${p.estado === 'comprado' ? '✅ Comprado / En reparto' : '⏳ Pedido registrado (en gestión con distribuidora)'}\n\n`;
  texto += `¡Hemos anotado tu pedido de licores! Te contactaremos tan pronto las tengamos disponibles. 🍷\n\n`;
  texto += `📱 *Redes sociales:*\n`;
  texto += `📷 Instagram:\nhttps://www.instagram.com/dceldestape\n\n`;
  texto += `🔵 Facebook:\nhttps://www.facebook.com/share/1CHT3FRSc6/`;

  const telDestino = String(p.clienteTelefono || "").replace(/\D/g, "");
  const waUrl = telDestino 
    ? `https://wa.me/506${telDestino}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/?text=${encodeURIComponent(texto)}`;

  window.open(waUrl, "_blank");
}

function compartirFacturaWhatsApp(idFactura) {
  const f = (state.facturas || []).find(fact => fact.id === idFactura);
  if (!f) {
    mostrarToast("Factura no encontrada.", "error");
    return;
  }

  const negocio = "DC EL DESTAPE LICORES";
  const telefono = "+506 8992-7936";
  const fecha = f.fecha ? new Date(f.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : new Date().toLocaleString();
  const vendedorFacturo = f.facturadoPor || f.vendedor || "Carlos";

  let totalBotellas = 0;
  (f.items || []).forEach(i => totalBotellas += Number(i.cantidad || 1));

  let texto = `🍷 *${negocio.toUpperCase()}* 🍷\n`;
  texto += `📱 *Tel:* ${telefono}\n`;
  texto += `--------------------------------\n`;
  texto += `🧾 *COMPROBANTE DE COMPRA*\n`;
  texto += `📅 Fecha: ${fecha}\n`;
  texto += `🎫 N°: ${f.id}\n`;
  texto += `👤 Facturado por: ${vendedorFacturo}\n`;
  if (f.pedidoOrigenId) {
    texto += `📋 Pedido preventa: ${f.pedidoOrigenId}\n`;
    if (f.pedidoOrigenVendedor) texto += `🙋 Tomó pedido: ${f.pedidoOrigenVendedor}\n`;
  }
  texto += `👤 Cliente: ${f.cliente || "General"}\n`;
  texto += `--------------------------------\n`;

  (f.items || []).forEach(i => {
    texto += `• ${i.cantidad}x ${i.nombre} = ${fmtCRC(i.subtotalCRC || (i.cantidad * i.precioVentaCRC))} (${fmtUSD(i.subtotalUSD || (i.cantidad * i.precioVentaUSD))})\n`;
  });

  texto += `--------------------------------\n`;
  texto += `💳 *Método de Pago:* ${f.metodoPago || "Efectivo"}\n`;
  texto += `💵 *TOTAL CRC:* ${fmtCRC(f.totalCRC)}\n`;
  texto += `💵 *TOTAL USD:* ${fmtUSD(f.totalUSD)}\n\n`;
  texto += `¡Muchas gracias por su preferencia! 🍷\n\n`;
  texto += `📱 *Redes sociales:*\n`;
  texto += `📷 Instagram:\nhttps://www.instagram.com/dceldestape\n\n`;
  texto += `🔵 Facebook:\nhttps://www.facebook.com/share/1CHT3FRSc6/`;

  // Buscar teléfono del cliente en la lista de clientes o en pedidos
  let telDestino = "";
  const cliEncontrado = (state.clientes || []).find(c => String(c.nombre || "").trim().toLowerCase() === String(f.cliente || "").trim().toLowerCase());
  if (cliEncontrado && cliEncontrado.telefono) {
    telDestino = String(cliEncontrado.telefono).replace(/\D/g, "");
  } else {
    const pedEncontrado = (state.misPedidos || []).find(p => p.id === f.pedidoOrigenId);
    if (pedEncontrado && pedEncontrado.clienteTelefono) {
      telDestino = String(pedEncontrado.clienteTelefono).replace(/\D/g, "");
    }
  }

  const waUrl = telDestino
    ? `https://wa.me/506${telDestino}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/?text=${encodeURIComponent(texto)}`;

  window.open(waUrl, "_blank");
}

// ==========================================================================
// 3. MÓDULO FACTURAS (VENTAS DE PEDIDOS DE ESTE PREVENTA)
// ==========================================================================
function filtrarFacturas() {
  const input = document.getElementById("searchFacturas");
  state.busquedaFactura = input ? input.value : "";
  renderizarFacturas();
}

function descargarFacturaTicket(idFactura) {
  const f = (state.facturas || []).find(fact => fact.id === idFactura);
  if (!f) {
    mostrarToast("Factura no encontrada.", "error");
    return;
  }
  const negocio = "DC EL DESTAPE LICORES";
  const telefono = "+506 8992-7936";
  const fecha = f.fecha ? new Date(f.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : new Date().toLocaleString();
  const vendedorFacturo = f.facturadoPor || f.vendedor || "Carlos";

  let lines = [
    "==========================================",
    `        ${negocio.toUpperCase()}`,
    `         Tel: ${telefono}`,
    "==========================================",
    `COMPROBANTE / FACTURA: ${f.id}`,
    `Fecha: ${fecha}`,
    `Facturado por: ${vendedorFacturo}`,
    f.pedidoOrigenId ? `Pedido preventa: ${f.pedidoOrigenId}` : "",
    f.pedidoOrigenVendedor ? `Tomó pedido: ${f.pedidoOrigenVendedor}` : "",
    `Cliente: ${f.cliente || "Cliente General"}`,
    "------------------------------------------",
    "CANT  PRODUCTO                    TOTAL",
    "------------------------------------------"
  ].filter(Boolean);

  (f.items || []).forEach(i => {
    const cant = `${i.cantidad}x`.padEnd(5);
    const nom = (i.nombre || i.codigo || "").slice(0, 22).padEnd(23);
    const sub = fmtCRC(i.subtotalCRC || (i.cantidad * (i.precioVentaCRC || 0)));
    lines.push(`${cant} ${nom} ${sub}`);
  });

  lines.push("------------------------------------------");
  lines.push(`Método de Pago: ${f.metodoPago || "Efectivo"}`);
  lines.push(`TOTAL CRC: ${fmtCRC(f.totalCRC)}`);
  lines.push(`TOTAL USD: ${fmtUSD(f.totalUSD)}`);
  lines.push("==========================================");
  lines.push("       ¡Gracias por su preferencia!");
  lines.push("==========================================");

  const textContent = lines.join("\r\n");
  const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Comprobante_${f.id}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  mostrarToast(`Comprobante ${f.id} descargado.`, "success");
}

function renderizarFacturas() {
  const cont = document.getElementById("misFacturasList");
  const badge = document.getElementById("facturasCountBadge");
  if (!cont) return;

  const q = String(state.busquedaFactura || "").trim().toLowerCase();
  let lista = [...(state.facturas || [])];

  if (q) {
    lista = lista.filter(f => 
      String(f.id || "").toLowerCase().includes(q) ||
      String(f.cliente || "").toLowerCase().includes(q) ||
      String(f.pedidoOrigenId || "").toLowerCase().includes(q) ||
      (f.items || []).some(i => String(i.nombre || "").toLowerCase().includes(q))
    );
  }

  if (badge) badge.textContent = lista.length;

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="text-center py-10 text-slate-500 bg-slate-900/60 rounded-3xl border border-slate-800 space-y-2">
        <i data-lucide="receipt" class="w-10 h-10 mx-auto text-slate-600 stroke-1"></i>
        <p class="text-xs font-bold text-slate-400">${q ? "No hay facturas que coincidan con la búsqueda." : "Aún no tienes pedidos facturados."}</p>
        <p class="text-[11px] text-slate-500 max-w-xs mx-auto">Cuando Carlos o Daniel facturen uno de tus pedidos en el sistema principal, aparecerá aquí automáticamente con su comprobante descargable.</p>
        <div class="pt-2">
          <button onclick="sincronizarConSheets(true)" class="px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold rounded-xl text-xs inline-flex items-center gap-1.5 active:scale-95 transition-all">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            <span>Sincronizar y Descargar Facturas</span>
          </button>
        </div>
      </div>
    `;
    inicializarIconos();
    return;
  }

  cont.innerHTML = lista.map(f => {
    const fStr = f.fecha ? new Date(f.fecha).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "S/F";
    const totalBotellas = (f.items || []).reduce((acc, it) => acc + parseNum(it.cantidad, 1), 0);

    return `
      <div class="p-3.5 bg-slate-900/90 border border-emerald-500/30 rounded-2xl space-y-2.5 text-xs shadow-md">
        <!-- Cabecera Factura -->
        <div class="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40">
              🧾 Factura
            </span>
            <span class="font-mono font-bold text-white text-xs">${f.id}</span>
          </div>
          <span class="text-[10px] text-slate-400 font-mono">${fStr}</span>
        </div>

        <!-- Cliente y Facturador -->
        <div class="flex items-start justify-between gap-2">
          <div>
            <span class="text-xs font-bold text-white block">${f.cliente}</span>
            <span class="text-[10px] text-sky-400 font-mono">📋 Pedido origen: ${f.pedidoOrigenId || 'N/A'}</span>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[10px] text-slate-400 block">Facturó: <b class="text-emerald-300">${f.facturadoPor || f.vendedor}</b></span>
            <span class="text-[10px] text-slate-400 font-mono">${f.metodoPago || 'Efectivo'}</span>
          </div>
        </div>

        <!-- Ítems -->
        <div class="pt-1 border-t border-slate-800/80 text-[11px] text-slate-300 space-y-0.5">
          ${(f.items || []).map(it => `
            <div class="flex justify-between font-mono">
              <span class="truncate">${it.cantidad}x ${it.nombre}</span>
              <span class="text-emerald-400 font-bold ml-2 shrink-0">${fmtCRC(it.subtotalCRC || (it.cantidad * (it.precioVentaCRC || 0)))}</span>
            </div>
          `).join("")}
        </div>

        <!-- Totales y Botones de Acción -->
        <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
          <div>
            <span class="text-[10px] text-slate-400 block font-sans">Total (${totalBotellas} unids):</span>
            <span class="text-sm font-black text-emerald-400 font-mono">${fmtCRC(f.totalCRC)}</span>
            <span class="text-[10px] text-slate-400 font-mono ml-1">(${fmtUSD(f.totalUSD)})</span>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button onclick="descargarFacturaTicket('${f.id}')" title="Descargar comprobante en archivo" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold rounded-xl active:scale-95 transition-all flex items-center gap-1 text-[11px]">
              <i data-lucide="download" class="w-3.5 h-3.5 text-amber-400"></i>
              <span>Descargar</span>
            </button>

            <button onclick="compartirFacturaWhatsApp('${f.id}')" title="Enviar comprobante por WhatsApp" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl active:scale-95 transition-all flex items-center gap-1 shadow-md shadow-emerald-600/30 text-[11px]">
              <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
              <span>Enviar Ticket</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  inicializarIconos();
}

// ==========================================================================
// 4. MÓDULO COMISIONES (13% SOBRE VENTAS FACTURADAS)
// ==========================================================================
function filtrarPeriodoComision(periodo) {
  state.filtroPeriodoComision = periodo;

  // Actualizar estilos de botones de período
  ["todos", "mes", "semana", "hoy"].forEach(p => {
    const btn = document.getElementById("btnPeriodo-" + p);
    if (!btn) return;
    if (p === periodo) {
      btn.className = "px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-[11px] transition-all";
    } else {
      btn.className = "px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-[11px] transition-all";
    }
  });

  renderizarComisiones();
}

function renderizarComisiones() {
  const elTotalCRC = document.getElementById("comisionTotalCRC");
  const elTotalUSD = document.getElementById("comisionTotalUSD");
  const elVentasCRC = document.getElementById("comisionVentasCRC");
  const elLiquidadaCRC = document.getElementById("comisionLiquidadaCRC");
  const elVolumen = document.getElementById("comisionVolumenResumen");
  const elCount = document.getElementById("comisionFacturasCount");
  const badgeStatus = document.getElementById("comisionStatusBadge");
  const cont = document.getElementById("comisionDesgloseList");
  const contRecibos = document.getElementById("comisionRecibosList");
  const countRecibos = document.getElementById("comisionRecibosCount");

  if (!elTotalCRC || !cont) return;

  const pct = (Number(state.porcentajeComision) || 13) / 100;
  const tc = Number(state.config.tipoCambio) || 520;
  const periodo = state.filtroPeriodoComision || "todos";

  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  
  // Inicio de semana (lunes)
  const diaSemana = ahora.getDay() === 0 ? 6 : ahora.getDay() - 1;
  const inicioSemana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diaSemana).getTime();

  // Inicio de mes
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();

  // 1. Filtrar facturas según período
  let facturasFiltradas = (state.facturas || []).filter(f => {
    if (!f.fecha) return true;
    const t = new Date(f.fecha).getTime();
    if (isNaN(t)) return true;

    if (periodo === "hoy") return t >= inicioHoy;
    if (periodo === "semana") return t >= inicioSemana;
    if (periodo === "mes") return t >= inicioMes;
    return true;
  });

  let totalVentasCRC = 0;
  let totalVentasUSD = 0;
  let totalBotellas = 0;

  facturasFiltradas.forEach(f => {
    totalVentasCRC += parseNum(f.totalCRC, 0);
    totalVentasUSD += parseNum(f.totalUSD, 0);
    (f.items || []).forEach(i => totalBotellas += parseNum(i.cantidad, 1));
  });

  // Comisión generada total (13%)
  const comisionCRC = Math.round(totalVentasCRC * pct);
  const comisionUSD = totalVentasUSD > 0 ? (totalVentasUSD * pct) : (tc > 0 ? comisionCRC / tc : 0);

  // 2. Sumar liquidaciones pagadas por Carlos/Daniel
  let totalLiquidadoCRC = 0;
  let totalLiquidadoUSD = 0;
  (state.liquidaciones || []).forEach(l => {
    totalLiquidadoCRC += parseNum(l.montoCRC, 0);
    totalLiquidadoUSD += parseNum(l.montoUSD, 0);
  });

  // 3. Saldo Pendiente Reducido por Liquidaciones
  const saldoPendienteCRC = Math.max(0, comisionCRC - totalLiquidadoCRC);
  const saldoPendienteUSD = Math.max(0, comisionUSD - totalLiquidadoUSD);

  // Actualizar indicadores numéricos
  elTotalCRC.textContent = fmtCRC(saldoPendienteCRC);
  elTotalUSD.textContent = `(${fmtUSD(saldoPendienteUSD)} USD)`;
  if (elVentasCRC) elVentasCRC.textContent = fmtCRC(comisionCRC);
  if (elLiquidadaCRC) elLiquidadaCRC.textContent = fmtCRC(totalLiquidadoCRC);
  if (elVolumen) elVolumen.textContent = `${facturasFiltradas.length} facturas • ${totalBotellas} unids`;
  if (elCount) elCount.textContent = facturasFiltradas.length;

  if (badgeStatus) {
    if (saldoPendienteCRC === 0 && comisionCRC > 0) {
      badgeStatus.className = "text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40";
      badgeStatus.textContent = "✓ Al día (Liquidado)";
      elTotalCRC.className = "text-2xl font-black text-emerald-400";
    } else if (saldoPendienteCRC > 0) {
      badgeStatus.className = "text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40";
      badgeStatus.textContent = "⏳ Pendiente de cobro";
      elTotalCRC.className = "text-2xl font-black text-amber-400";
    } else {
      badgeStatus.className = "text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-slate-800 text-slate-400 border border-slate-700";
      badgeStatus.textContent = "Sin comisiones";
      elTotalCRC.className = "text-2xl font-black text-slate-400";
    }
  }

  // 4. Desglose de Facturas con badge de estado
  if (facturasFiltradas.length === 0) {
    cont.innerHTML = `
      <div class="text-center py-10 text-slate-500 bg-slate-900/60 rounded-3xl border border-slate-800 space-y-2">
        <i data-lucide="badge-percent" class="w-10 h-10 mx-auto text-slate-600 stroke-1"></i>
        <p class="text-xs font-bold text-slate-400">No hay facturas en este período (${periodo}).</p>
        <p class="text-[11px] text-slate-500 max-w-xs mx-auto">Tus comisiones del 13% se calculan automáticamente cuando Carlos o Daniel facturan tus pedidos.</p>
      </div>
    `;
  } else {
    // Determinar qué facturas ya están cubiertas por las liquidaciones
    let acumComision = 0;
    cont.innerHTML = facturasFiltradas.map(f => {
      const fStr = f.fecha ? new Date(f.fecha).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "S/F";
      const vCRC = parseNum(f.totalCRC, 0);
      const vUSD = parseNum(f.totalUSD, 0);
      const comFilaCRC = Math.round(vCRC * pct);
      const comFilaUSD = vUSD > 0 ? (vUSD * pct) : (tc > 0 ? comFilaCRC / tc : 0);
      const botesFila = (f.items || []).reduce((acc, it) => acc + parseNum(it.cantidad, 1), 0);

      acumComision += comFilaCRC;
      const yaLiquidada = acumComision <= totalLiquidadoCRC;

      return `
        <div class="p-3.5 bg-slate-900/90 border ${yaLiquidada ? 'border-emerald-500/30' : 'border-amber-500/30'} rounded-2xl space-y-2.5 text-xs shadow-md">
          <!-- Cabecera -->
          <div class="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div class="flex items-center gap-1.5">
              <span class="font-mono font-bold text-amber-400 text-xs">${f.id}</span>
              <span class="text-[10px] text-slate-400 font-mono">(${fStr})</span>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${yaLiquidada ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-amber-950/80 text-amber-300 border border-amber-500/40'}">
              ${yaLiquidada ? '✅ Liquidada' : '⏳ Pendiente'}
            </span>
          </div>

          <!-- Cliente y Pedido -->
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="text-xs font-bold text-white block">${f.cliente || "Cliente General"}</span>
              <span class="text-[10px] text-sky-400 font-mono">📋 Pedido: ${f.pedidoOrigenId || 'N/A'}</span>
            </div>
            <div class="text-right shrink-0">
              <span class="text-[10px] text-slate-400 block font-mono">Venta: <b>${fmtCRC(vCRC)}</b></span>
              <span class="text-[10px] text-slate-500 font-mono">${botesFila} botella(s)</span>
            </div>
          </div>

          <!-- Caja destacada de ganancia para el preventa -->
          <div class="p-2.5 ${yaLiquidada ? 'bg-emerald-950/40 border-emerald-500/40' : 'bg-slate-950/80 border-slate-800'} border rounded-xl flex items-center justify-between font-mono">
            <div>
              <span class="text-[10px] ${yaLiquidada ? 'text-emerald-300/80' : 'text-slate-400'} block font-sans">Tu Ganancia (${(pct * 100).toFixed(0)}%):</span>
              <span class="text-sm font-black ${yaLiquidada ? 'text-emerald-300' : 'text-amber-400'}">+${fmtCRC(comFilaCRC)}</span>
              <span class="text-[10px] text-slate-400 ml-1">(+${fmtUSD(comFilaUSD)})</span>
            </div>
            <button onclick="compartirComisionFacturaWhatsApp('${f.id}')" title="Compartir comprobante de comisión por WhatsApp" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-sans font-bold text-[10px] flex items-center gap-1 active:scale-95 transition-all">
              <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
              <span>WhatsApp</span>
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // 5. Renderizar Mis Recibos de Liquidación (Pagos Recibidos)
  if (contRecibos) {
    const misRecibos = [...(state.liquidaciones || [])];
    if (countRecibos) countRecibos.textContent = misRecibos.length;

    if (misRecibos.length === 0) {
      contRecibos.innerHTML = `
        <div class="p-6 text-center text-slate-500 space-y-1 text-xs">
          <p class="font-bold text-slate-400">Aún no tienes recibos de liquidación.</p>
          <p class="text-[11px] text-slate-500">Cuando Carlos o Daniel te liquiden comisiones en el sistema principal, tus comprobantes aparecerán aquí.</p>
        </div>
      `;
    } else {
      contRecibos.innerHTML = misRecibos.map(liq => {
        const fStr = liq.fecha ? new Date(liq.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "S/F";
        return `
          <div class="p-3 bg-slate-950/90 border border-emerald-500/30 rounded-2xl space-y-2 text-xs shadow-inner">
            <div class="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
              <div class="flex items-center gap-1.5">
                <span class="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                  🧾 Recibo de Pago
                </span>
                <span class="font-mono font-bold text-white text-xs">${liq.id}</span>
              </div>
              <span class="text-[10px] text-slate-400 font-mono">${fStr}</span>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <span class="text-slate-400 text-[10px] block font-sans">Liquidado por:</span>
                <b class="text-white text-xs">${liq.liquidadoPor || 'Carlos'}</b>
                <span class="text-[10px] text-slate-400 font-mono block">Vía: ${liq.metodoPago || 'SINPE'}</span>
              </div>
              <div class="text-right font-mono">
                <span class="text-sm font-black text-emerald-400 block leading-none">${fmtCRC(liq.montoCRC || 0)}</span>
                <span class="text-[10px] text-slate-400">(${fmtUSD(liq.montoUSD || 0)})</span>
              </div>
            </div>

            ${liq.notas ? `
              <div class="pt-1 border-t border-slate-800/80 text-[10px] text-slate-400 italic">
                Nota: "${liq.notas}"
              </div>
            ` : ''}
          </div>
        `;
      }).join("");
    }
  }

  inicializarIconos();
}

function compartirComisionFacturaWhatsApp(idFactura) {
  const f = (state.facturas || []).find(fact => fact.id === idFactura);
  if (!f) {
    mostrarToast("Factura no encontrada.", "error");
    return;
  }

  const pct = (Number(state.porcentajeComision) || 13) / 100;
  const vCRC = parseNum(f.totalCRC, 0);
  const comCRC = Math.round(vCRC * pct);
  const fecha = f.fecha ? new Date(f.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : new Date().toLocaleString();

  let texto = `💰 *LIQUIDACIÓN DE COMISIÓN (13%)* 💰\n`;
  texto += `🏢 *DC EL DESTAPE LICORES*\n`;
  texto += `--------------------------------\n`;
  texto += `👤 Preventa: ${state.vendedor || "Colaborador"}\n`;
  texto += `🧾 Factura N°: ${f.id}\n`;
  texto += `📋 Pedido origen: ${f.pedidoOrigenId || "N/A"}\n`;
  texto += `👤 Cliente: ${f.cliente || "General"}\n`;
  texto += `📅 Fecha: ${fecha}\n`;
  texto += `--------------------------------\n`;
  texto += `💵 Venta Facturada: ${fmtCRC(vCRC)}\n`;
  texto += `✨ *COMISIÓN GANADA (13%):* ${fmtCRC(comCRC)}\n`;
  texto += `--------------------------------\n`;
  texto += `Reporte generado automáticamente desde la App Preventa. 🍷`;

  const waUrl = `https://wa.me/?text=${encodeURIComponent(texto)}`;
  window.open(waUrl, "_blank");
}

// ==========================================================================
// 3. MÓDULO CLIENTES (AISLADOS POR VENDEDOR)
// ==========================================================================
function obtenerClientesPropios() {
  const miVend = String(state.vendedor || "Colaborador").trim().toLowerCase();
  return (state.clientes || []).filter(c => {
    const creador = String(c.creadoPor || c.vendedor || "").trim().toLowerCase();
    return creador === miVend;
  });
}

function renderizarClientes() {
  const cont = document.getElementById("misClientesList");
  if (!cont) return;

  const q = (state.busquedaCliente || "").toLowerCase().trim();
  let clientes = obtenerClientesPropios();

  if (q) {
    clientes = clientes.filter(c => 
      String(c.nombre || "").toLowerCase().includes(q) ||
      String(c.telefono || "").includes(q)
    );
  }

  if (clientes.length === 0) {
    cont.innerHTML = `
      <div class="text-center py-10 text-slate-500 bg-slate-900/60 rounded-3xl border border-slate-800 space-y-2">
        <i data-lucide="users" class="w-10 h-10 mx-auto text-slate-600 stroke-1"></i>
        <p class="text-xs font-bold text-slate-400">${q ? "No se encontraron clientes con esa búsqueda." : "No tienes clientes registrados todavía."}</p>
        <button onclick="abrirModalNuevoCliente()" class="px-3.5 py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs active:scale-95 shadow-md">
          ➕ Agregar mi primer cliente
        </button>
      </div>
    `;
    inicializarIconos();
    return;
  }

  cont.innerHTML = clientes.map(c => `
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-md hover:border-slate-700 transition-all">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          <h4 class="text-xs font-bold text-white truncate">${c.nombre}</h4>
          <span class="text-[10px] font-bold font-mono px-1.5 py-0.2 rounded-md bg-amber-950/80 text-amber-300 border border-amber-500/40">
            🎁 ${parseNum(c.puntos, 0).toLocaleString()} pts
          </span>
        </div>
        <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400 font-mono">
          <span>📞 ${c.telefono}</span>
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <a href="https://wa.me/506${String(c.telefono).replace(/\\D/g, '')}" target="_blank" class="p-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-400 active:scale-95 transition-all" title="WhatsApp">
          <i data-lucide="message-circle" class="w-4 h-4"></i>
        </a>
        <button onclick="abrirModalEditarCliente('${c.id}')" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-95 transition-all" title="Editar">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `).join("");

  inicializarIconos();
}

function filtrarClientes() {
  const input = document.getElementById("searchClientes");
  state.busquedaCliente = input ? input.value : "";
  renderizarClientes();
}

let _clienteEditandoId = null;

function abrirModalNuevoCliente() {
  _clienteEditandoId = null;
  const modal = document.getElementById("modalCliente");
  const titulo = document.getElementById("modalClienteTitulo");
  if (titulo) titulo.textContent = "Nuevo Cliente";
  document.getElementById("modalClienteNombre").value = "";
  document.getElementById("modalClienteTelefono").value = "";
  document.getElementById("modalClienteId").value = "";

  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
  setTimeout(() => document.getElementById("modalClienteNombre")?.focus(), 100);
}

function abrirModalEditarCliente(id) {
  _clienteEditandoId = id;
  const cli = state.clientes.find(c => c.id === id);
  if (!cli) return;

  const modal = document.getElementById("modalCliente");
  const titulo = document.getElementById("modalClienteTitulo");
  if (titulo) titulo.textContent = "Editar Cliente";
  document.getElementById("modalClienteNombre").value = cli.nombre;
  document.getElementById("modalClienteTelefono").value = cli.telefono;
  document.getElementById("modalClienteId").value = cli.id;

  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
}

function cerrarModalCliente() {
  const modal = document.getElementById("modalCliente");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function guardarClienteForm() {
  const nombreInput = document.getElementById("modalClienteNombre");
  const telInput = document.getElementById("modalClienteTelefono");
  const nombre = (nombreInput ? nombreInput.value : "").trim();
  const tel = (telInput ? telInput.value : "").trim().replace(/\\s+/g, "");

  if (!nombre || !tel) {
    mostrarToast("El nombre y teléfono son obligatorios.", "error");
    return;
  }

  const id = _clienteEditandoId || ("CLI-" + Date.now().toString().slice(-8));
  const ahora = new Date().toISOString();

  const clienteObj = {
    id,
    nombre,
    telefono: tel,
    puntos: 0,
    fechaRegistro: ahora,
    ultimaVenta: null,
    creadoPor: state.vendedor || "Colaborador"
  };

  const existIdx = state.clientes.findIndex(c => c.id === id || c.telefono === tel);
  if (existIdx !== -1) {
    state.clientes[existIdx] = { ...state.clientes[existIdx], nombre, telefono: tel, creadoPor: state.vendedor };
  } else {
    state.clientes.unshift(clienteObj);
  }

  guardarClientesLocal();
  encolarAccionSync("guardarCliente", { cliente: clienteObj });

  cerrarModalCliente();
  renderizarClientes();
  poblarSelectorClientesPedido();
  mostrarToast(`Cliente ${nombre} guardado 👤`, "success");
}

// ==========================================================================
// ==========================================================================
// CONTROL DEL OVERLAY DE BLOQUEO DURANTE SINCRONIZACIÓN
// ==========================================================================
function mostrarBloqueoSincronizacion(mensaje = "Sincronizando con Google Sheets...") {
  const overlay = document.getElementById("syncBlockingOverlay");
  const statusTxt = document.getElementById("syncBlockingOverlayStatus");
  if (statusTxt) statusTxt.textContent = mensaje;
  if (overlay) {
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
  }
}

function actualizarMensajeBloqueoSincronizacion(mensaje) {
  const statusTxt = document.getElementById("syncBlockingOverlayStatus");
  if (statusTxt) statusTxt.textContent = mensaje;
}

function ocultarBloqueoSincronizacion() {
  const overlay = document.getElementById("syncBlockingOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }
}

function describirAccionSyncPreventa(accion, datos) {
  datos = datos || {};
  switch (accion) {
    case "registrarPedido":
      return (datos.pedido && datos.pedido.id) ? ("Enviando pedido preventa (" + datos.pedido.id + ")...") : "Enviando pedido preventa...";
    case "guardarCliente":
      return (datos.cliente && datos.cliente.nombre) ? ("Guardando cliente (" + datos.cliente.nombre + ")...") : "Guardando cliente...";
    case "actualizarPuntos":
      return "Actualizando puntos de cliente...";
    case "eliminarPedido":
      return "Eliminando pedido (" + (datos.id || '') + ")...";
    default:
      return "Enviando " + accion + "...";
  }
}

// SINCRONIZACIÓN BIDIRECCIONAL CON GOOGLE SHEETS
// ==========================================================================
function encolarAccionSync(accion, datos) {
  if (!state.colaOffline) state.colaOffline = [];
  state.colaOffline.push({
    id: "SYNC-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    accion,
    datos,
    fecha: new Date().toISOString()
  });
  guardarColaLocal();

  if (navigator.onLine && state.config.sheetsUrl) {
    procesarColaSync();
  }
}

async function procesarColaSync() {
  if (!navigator.onLine || !state.config.sheetsUrl || !state.colaOffline || state.colaOffline.length === 0) return;

  const total = state.colaOffline.length;
  let procesados = 0;

  while (state.colaOffline && state.colaOffline.length > 0) {
    const item = state.colaOffline[0];
    procesados++;
    actualizarMensajeBloqueoSincronizacion(`[${procesados}/${total}] ${describirAccionSyncPreventa(item.accion, item.datos)}`);

    try {
      const payload = {
        action: item.accion,
        token: PORTAL_TOKEN,
        ...(item.datos || {})
      };

      const res = await fetch(state.config.sheetsUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json && json.success) {
        state.colaOffline.shift();
        guardarColaLocal();
        actualizarBadgeCola();
      } else {
        console.warn("Respuesta no exitosa al enviar:", item, json);
        break;
      }
    } catch (e) {
      console.warn("Fallo de red al procesar cola:", e);
      break;
    }
  }
}

async function sincronizarConSheets(mostrarMensaje = true) {
  if (!state.config.sheetsUrl) {
    if (mostrarMensaje) {
      mostrarToast("Configura la URL de Google Sheets en el botón ⚙️", "error");
      abrirModalConfig();
    }
    return;
  }

  if (!navigator.onLine) {
    if (mostrarMensaje) mostrarToast("Sin conexión a internet. Los datos están seguros en tu teléfono.", "info");
    return;
  }

  const icon = document.getElementById("syncIcon");
  if (icon) icon.classList.add("animate-spin");

  mostrarBloqueoSincronizacion("Iniciando sincronización con Google Sheets...");

  try {
    // 1. Vaciar cola pendiente primero si hay elementos
    if (state.colaOffline && state.colaOffline.length > 0) {
      actualizarMensajeBloqueoSincronizacion(`Subiendo ${state.colaOffline.length} cambios pendientes a Sheets...`);
      await procesarColaSync();
    }

    // 2. Descargar datos del backend
    actualizarMensajeBloqueoSincronizacion("Descargando catálogo, pedidos y facturas...");
    const url = `${state.config.sheetsUrl}?action=getTodo&token=${PORTAL_TOKEN}&t=${Date.now()}`;
    const res = await fetch(url);
    const json = await res.json();

    if (json && json.success && json.data) {
      // A. Productos: Reemplazo al 100% desde Sheets
      if (json.data.productos && Array.isArray(json.data.productos)) {
        state.productos = json.data.productos.map(p => ({
          codigo: String(p.codigo || "").trim(),
          nombre: String(p.nombre || "").trim(),
          categoria: String(p.categoria || "General").trim(),
          precioVentaCRC: parseNum(p.precioVentaCRC, 0),
          precioVentaUSD: parseNum(p.precioVentaUSD, 0),
          imagenUrl: String(p.imagenUrl || "").trim()
        }));
        guardarProductosLocal();
      }

      // B. Clientes: Reemplazo 100% desde Sheets con puntos actualizados
      if (json.data.clientes) {
        const rawCli = Array.isArray(json.data.clientes) ? json.data.clientes : Object.values(json.data.clientes);
        const miVend = String(state.vendedor || "Colaborador").trim().toLowerCase();

        // Encontrar los clientes creados por este vendedor en Sheets
        const misClientesServidor = rawCli.filter(c => {
          const creador = String(c.creadoPor || c.vendedor || "").trim().toLowerCase();
          return creador === miVend;
        }).map(c => ({
          id: String(c.id || "").trim(),
          nombre: String(c.nombre || "").trim(),
          telefono: String(c.telefono || "").trim(),
          puntos: parseNum(c.puntos, 0),
          fechaRegistro: c.fechaRegistro || "",
          ultimaVenta: c.ultimaVenta || null,
          creadoPor: c.creadoPor || state.vendedor
        }));

        // Mantener solo clientes locales pendientes en cola de sincronización
        const idsSheets = new Set(misClientesServidor.map(c => c.id));
        const localesPendientes = (state.colaOffline || [])
          .filter(item => item.accion === "guardarCliente" && item.datos && item.datos.cliente)
          .map(item => item.datos.cliente)
          .filter(c => !idsSheets.has(c.id));

        state.clientes = [...misClientesServidor, ...localesPendientes];
        guardarClientesLocal();
      }

      // C. Pedidos: Reemplazo 100% desde Sheets con estado actualizado (pendiente / comprado)
      if (json.data.pedidos && Array.isArray(json.data.pedidos)) {
        const miVend = String(state.vendedor || "Colaborador").trim().toLowerCase();
        const misPedidosServidor = json.data.pedidos.filter(p => {
          const vend = String(p.vendedor || "").trim().toLowerCase();
          return vend === miVend;
        });

        // Mantener solo pedidos locales en cola offline que aún no han subido
        const idsSheets = new Set(misPedidosServidor.map(p => p.id));
        const pedidosPendientesOffline = (state.colaOffline || [])
          .filter(item => item.accion === "registrarPedido" && item.datos && item.datos.pedido)
          .map(item => item.datos.pedido)
          .filter(p => !idsSheets.has(p.id));

        state.misPedidos = [...misPedidosServidor, ...pedidosPendientesOffline];
        guardarPedidosLocal();
      }

      // D. Facturas: Ventas de Sheets que corresponden a pedidos de este vendedor preventa
      const rawVentas = json.data.ultimasVentas || json.data.ventas || [];
      if (Array.isArray(rawVentas)) {
        const miVend = String(state.vendedor || "Colaborador").trim().toLowerCase();
        
        // 1. Recopilar todos los IDs de pedidos de este preventa (locales y del servidor)
        const misPedidosIds = new Set();
        // Mapa de clientes de mis pedidos (para coincidencia por cliente como fallback)
        const misClientesPedidos = new Set();
        (state.misPedidos || []).forEach(p => {
          if (p && p.id) misPedidosIds.add(String(p.id).trim().toLowerCase());
          if (p && p.cliente) misClientesPedidos.add(String(p.cliente).trim().toLowerCase());
        });
        if (json.data.pedidos && Array.isArray(json.data.pedidos)) {
          json.data.pedidos.forEach(p => {
            const pVend = String(p.vendedor || "").trim().toLowerCase();
            if (p && p.id && (pVend === miVend || miVend === "colaborador" || pVend.includes(miVend) || miVend.includes(pVend))) {
              misPedidosIds.add(String(p.id).trim().toLowerCase());
              if (p.cliente) misClientesPedidos.add(String(p.cliente).trim().toLowerCase());
            }
          });
        }

        console.log("[FACTURAS] miVend:", miVend, "misPedidosIds:", [...misPedidosIds], "totalVentas:", rawVentas.length);

        // 2. Mapa de facturas asociadas a pedidos de este preventa
        const mapVentas = new Map();
        rawVentas.forEach(v => {
          if (!v || !v.id) return;
          const origVend = String(v.pedidoOrigenVendedor || "").trim().toLowerCase();
          const vVend = String(v.vendedor || "").trim().toLowerCase();
          const pedId = String(v.pedidoOrigenId || "").trim().toLowerCase();
          const vCliente = String(v.cliente || "").trim().toLowerCase();

          // Comprobar si pertenece a este vendedor preventa por cualquiera de estas vías:
          const coincideVendedorOrigen = !!origVend && (origVend === miVend || origVend.includes(miVend) || miVend.includes(origVend));
          const coincidePedidoOrigenId = !!pedId && misPedidosIds.has(pedId);
          const coincideVendedorDirecto = !origVend && !pedId && (vVend === miVend || vVend.includes(miVend) || miVend.includes(vVend));
          
          // 4. Algún pedido de este preventa tiene vinculado el ID de esta factura
          let coincidePorIdFacturaEnPedido = false;
          const allPedidos = json.data.pedidos && Array.isArray(json.data.pedidos) ? json.data.pedidos : [];
          coincidePorIdFacturaEnPedido = allPedidos.some(p => 
            misPedidosIds.has(String(p.id).trim().toLowerCase()) && 
            (String(p.idFactura || p.idVenta || p.facturaId || "").trim().toLowerCase() === String(v.id).trim().toLowerCase())
          );

          // 5. Fallback: la venta tiene un cliente que coincide con uno de mis pedidos Y tiene pedidoOrigenId que apunta a mis pedidos
          const coincidePorCliente = !coincidePorIdFacturaEnPedido && !!vCliente && 
            misClientesPedidos.has(vCliente) &&
            allPedidos.some(p => 
              misPedidosIds.has(String(p.id).trim().toLowerCase()) &&
              String(p.cliente || "").trim().toLowerCase() === vCliente &&
              (p.estado === "comprado" || p.idFactura)
            );

          console.log("[FACTURAS] venta", v.id, "origVend:", origVend, "pedId:", pedId, 
            "| coincide:", coincideVendedorOrigen, coincidePedidoOrigenId, coincideVendedorDirecto, coincidePorIdFacturaEnPedido, coincidePorCliente);

          if (!coincideVendedorOrigen && !coincidePedidoOrigenId && !coincideVendedorDirecto && !coincidePorIdFacturaEnPedido && !coincidePorCliente) {
            return;
          }

          if (!mapVentas.has(v.id)) {
            // Determinar pedidoOrigenId real si no venía en la fila de venta
            let pedIdAsociado = v.pedidoOrigenId || "";
            if (!pedIdAsociado && misPedidosIds.size > 0) {
              const pedEncontrado = (state.misPedidos || []).find(p => 
                (p.idFactura && p.idFactura === v.id) ||
                (String(p.cliente || "").trim().toLowerCase() === String(v.cliente || "").trim().toLowerCase())
              );
              if (pedEncontrado) pedIdAsociado = pedEncontrado.id;
            }

            mapVentas.set(v.id, {
              id: v.id,
              fecha: v.fecha,
              cliente: v.cliente || "Cliente General",
              metodoPago: v.metodoPago || "Efectivo",
              vendedor: v.vendedor || "Carlos",
              facturadoPor: v.facturadoPor || v.vendedor || "Carlos",
              pedidoOrigenId: pedIdAsociado,
              pedidoOrigenVendedor: v.pedidoOrigenVendedor || state.vendedor || "",
              totalCRC: 0,
              totalUSD: 0,
              items: []
            });
          }

          const fact = mapVentas.get(v.id);
          if (Array.isArray(v.items) && v.items.length > 0) {
            v.items.forEach(it => {
              const cant = parseNum(it.cantidad, 1);
              const pCRC = parseNum(it.precioVentaCRC !== undefined ? it.precioVentaCRC : it.precioCRC, 0);
              const pUSD = parseNum(it.precioVentaUSD !== undefined ? it.precioVentaUSD : it.precioUSD, 0);
              const totCRC = parseNum(it.subtotalCRC !== undefined ? it.subtotalCRC : it.totalCRC, cant * pCRC);
              const totUSD = parseNum(it.subtotalUSD !== undefined ? it.subtotalUSD : it.totalUSD, cant * pUSD);
              fact.totalCRC += totCRC;
              fact.totalUSD += totUSD;
              fact.items.push({
                codigo: it.codigo || "",
                nombre: it.nombre || it.codigo || "Producto",
                cantidad: cant,
                precioVentaCRC: pCRC,
                precioVentaUSD: pUSD,
                subtotalCRC: totCRC,
                subtotalUSD: totUSD
              });
            });
          } else {
            const cant = parseNum(v.cantidad, 1);
            const pCRC = parseNum(v.precioCRC !== undefined ? v.precioCRC : v.precioVentaCRC, 0);
            const pUSD = parseNum(v.precioUSD !== undefined ? v.precioUSD : v.precioVentaUSD, 0);
            const totCRC = parseNum(v.totalCRC, cant * pCRC);
            const totUSD = parseNum(v.totalUSD, cant * pUSD);
            fact.totalCRC += totCRC;
            fact.totalUSD += totUSD;
            fact.items.push({
              codigo: v.codigo || "",
              nombre: v.nombre || v.codigo || "Producto",
              cantidad: cant,
              precioVentaCRC: pCRC,
              precioVentaUSD: pUSD,
              subtotalCRC: totCRC,
              subtotalUSD: totUSD
            });
          }
        });

        state.facturas = Array.from(mapVentas.values());
        guardarFacturasLocal();
      }

      // E. Liquidaciones: Pagos de comisiones recibidos de Carlos/Daniel
      if (json.data.liquidaciones && Array.isArray(json.data.liquidaciones)) {
        const miVend = String(state.vendedor || "Colaborador").trim().toLowerCase();
        state.liquidaciones = json.data.liquidaciones.filter(l => {
          const v = String(l.vendedorPreventa || "").trim().toLowerCase();
          return v === miVend;
        });
        guardarLiquidacionesLocal();
      }

      renderizarTodo();
      if (mostrarMensaje) {
        mostrarToast(`Sincronización completada (${state.productos.length} licores)`, "success");
      }
    } else {
      if (mostrarMensaje) mostrarToast("No se recibieron datos válidos de Sheets.", "error");
    }
  } catch (err) {
    console.error(err);
    if (mostrarMensaje) mostrarToast("Error al conectar: " + err.message, "error");
  } finally {
    if (icon) icon.classList.remove("animate-spin");
    ocultarBloqueoSincronizacion();
  }
}
