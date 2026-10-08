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
  vendedorTelefono: "", // Teléfono autenticado del vendedor
  productos: [],
  categoriaSeleccionada: "Todas",
  busquedaProducto: "",
  ordenProductos: "az",
  filtroStock: "todos",
  
  // Clientes
  clientes: [], // Lista filtrada que pertenece a este vendedor
  busquedaCliente: "",
  
  // Pedido en construcción
  pedidoCarrito: [], // [{ codigo, nombre, cantidad, precioVentaCRC, precioVentaUSD }]
  pedidoClienteSeleccionado: null,
  
  // Historial de pedidos de este vendedor
  misPedidos: [],

  // Historial de apartados de este vendedor
  misApartados: [],
  misAbonosApartados: [],
  busquedaApartados: "",
  filtroEstadoApartados: "activos",
  modoPedido: "pedido", // "pedido" | "apartado"
  
  // Facturas consolidadas de este vendedor (pedidos facturados por Carlos/Daniel)
  facturas: [],
  busquedaFactura: "",
  
  // Comisiones
  filtroPeriodoComision: "todos",
  porcentajeComision: 13,
  liquidaciones: [], // Liquidaciones pagadas por Carlos/Daniel
  
  // Existencias de stock asignadas (solo del dueño asignado: Carlos o Daniel)
  stockPorCodigo: {}, // { [cod]: stockDisponible }
  vendedoresLista: [], // Lista de vendedores activos registrados en Sheets
  
  config: {
    sheetsUrl: "",
    tipoCambio: 500
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

  const telSaved = localStorage.getItem("pv_vendedor_telefono");
  if (telSaved) state.vendedorTelefono = telSaved;

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
  const telParam = urlParams.get("tel") || urlParams.get("telefono");
  if (telParam) {
    state.vendedorTelefono = telParam.replace(/\D/g, "");
    localStorage.setItem("pv_vendedor_telefono", state.vendedorTelefono);
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

  const apts = localStorage.getItem("pv_apartados");
  if (apts) {
    try { state.misApartados = JSON.parse(apts); } catch(e) { state.misApartados = []; }
  }

  const abos = localStorage.getItem("pv_abonos_apartados");
  if (abos) {
    try { state.misAbonosApartados = JSON.parse(abos); } catch(e) { state.misAbonosApartados = []; }
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

  const stk = localStorage.getItem("pv_stock_vendedor");
  if (stk) {
    try { state.stockPorCodigo = JSON.parse(stk); } catch(e) { state.stockPorCodigo = {}; }
  }

  const vlist = localStorage.getItem("pv_vendedores_lista");
  if (vlist) {
    try { state.vendedoresLista = JSON.parse(vlist); } catch(e) { state.vendedoresLista = []; }
  }
}

function guardarStockLocal() {
  localStorage.setItem("pv_stock_vendedor", JSON.stringify(state.stockPorCodigo || {}));
}
function guardarVendedoresListaLocal() {
  localStorage.setItem("pv_vendedores_lista", JSON.stringify(state.vendedoresLista || []));
}

function guardarProductosLocal() {
  localStorage.setItem("pv_productos", JSON.stringify(state.productos));
}
function guardarClientesLocal() {
  localStorage.setItem("pv_clientes", JSON.stringify(state.clientes));
}
function guardarPedidosLocal() {
  // Guardar TODOS los pedidos en memoria (el filtrado por vendedor es solo de vista).
  // Filtrar aquí eliminaba del disco los pedidos de otros nombres/sesiones.
  localStorage.setItem("pv_pedidos", JSON.stringify(state.misPedidos || []));
}
function guardarApartadosLocal() {
  localStorage.setItem("pv_apartados", JSON.stringify(state.misApartados || []));
  localStorage.setItem("pv_abonos_apartados", JSON.stringify(state.misAbonosApartados || []));
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
// GESTIÓN DE IDENTIDAD DE VENDEDOR (Login por Teléfono)
// ==========================================================================
function comprobarVendedor() {
  // 1. Si no está configurada la URL de Google Sheets, pedir primero la URL
  if (!state.config || !state.config.sheetsUrl || !state.config.sheetsUrl.trim()) {
    abrirModalConfig();
    return;
  }

  // 2. Si ya está configurada la URL, validar identidad del vendedor (login por teléfono)
  if (!state.vendedorTelefono || !state.vendedor || state.vendedor === "Colaborador" || state.vendedor.trim() === "") {
    abrirModalVendedor(true);
  }
  actualizarUIVendedor();
}

function abrirModalVendedor(forzado = false) {
  const modal = document.getElementById("modalVendedor");
  const btnCerrar = document.getElementById("btnCerrarModalVendedor");
  const telInput = document.getElementById("inputTelefonoVendedor");
  const feedback = document.getElementById("vendedorLoginFeedback");

  if (btnCerrar) {
    if (forzado) btnCerrar.classList.add("hidden");
    else btnCerrar.classList.remove("hidden");
  }

  // Pre-rellenar teléfono si ya estaba guardado
  if (telInput && state.vendedorTelefono) {
    telInput.value = state.vendedorTelefono;
  }

  // Limpiar feedback previo
  if (feedback) {
    feedback.className = "hidden p-2.5 rounded-xl text-xs font-semibold";
    feedback.textContent = "";
  }

  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
  setTimeout(() => telInput && telInput.focus(), 100);
}

function cerrarModalVendedor() {
  const modal = document.getElementById("modalVendedor");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

async function validarEIngresarPorTelefono() {
  const telInput = document.getElementById("inputTelefonoVendedor");
  const feedback = document.getElementById("vendedorLoginFeedback");
  const btn = document.getElementById("btnIngresarVendedor");

  const rawTel = (telInput ? telInput.value : "").trim();
  const tel = rawTel.replace(/\D/g, ""); // quitar todo lo que no sea dígito
  const telShort = tel.startsWith("506") ? tel.slice(3) : tel; // quitar prefijo país si viene

  function showFeedback(msg, isError) {
    if (!feedback) return;
    feedback.textContent = msg;
    feedback.className = `p-2.5 rounded-xl text-xs font-semibold ${
      isError
        ? "bg-rose-950 border border-rose-500/40 text-rose-300"
        : "bg-amber-950 border border-amber-500/40 text-amber-300"
    }`;
    feedback.classList.remove("hidden");
  }

  function buscarEnLista(lista) {
    if (!Array.isArray(lista)) return null;

    // Normalizar entrada del usuario
    const digitsIngresados = tel; // solo dígitos
    const ultimos8Ingresados = digitsIngresados.length >= 8 ? digitsIngresados.slice(-8) : digitsIngresados;

    return lista.find(v => {
      if (!v) return false;
      const vTelRaw = String(v.telefono || "").trim();
      const vTelDigits = vTelRaw.replace(/\D/g, "");
      const ultimos8Vendedor = vTelDigits.length >= 8 ? vTelDigits.slice(-8) : vTelDigits;

      // 1. Coincidencia directa por dígitos limpios
      if (vTelDigits && (vTelDigits === digitsIngresados || vTelDigits === telShort || digitsIngresados === (vTelDigits.startsWith("506") ? vTelDigits.slice(3) : vTelDigits))) {
        return true;
      }

      // 2. Coincidencia por últimos 8 dígitos (número estándar en Costa Rica)
      if (ultimos8Ingresados.length === 8 && ultimos8Vendedor.length === 8 && ultimos8Ingresados === ultimos8Vendedor) {
        return true;
      }

      // 3. Coincidencia por inclusión
      if (vTelDigits && digitsIngresados && (vTelDigits.includes(digitsIngresados) || digitsIngresados.includes(vTelDigits))) {
        return true;
      }

      return false;
    });
  }

  if (!tel || tel.length < 7) {
    showFeedback("⚠️ Ingresa un número de teléfono válido.", true);
    return;
  }

  // Deshabilitar botón mientras se valida
  if (btn) btn.disabled = true;

  try {
    // 1. Siempre refrescar la lista de vendedores desde Sheets al presionar el botón
    let lista = state.vendedoresLista || [];

    if (!state.config || !state.config.sheetsUrl || !state.config.sheetsUrl.trim()) {
      showFeedback("⚠️ Falta configurar la URL de Google Sheets en la app.", true);
      setTimeout(() => {
        cerrarModalVendedor();
        abrirModalConfig();
      }, 1000);
      return;
    }

    if (navigator.onLine && state.config.sheetsUrl) {
      showFeedback("🔄 Verificando estado en Google Sheets...", false);
      try {
        const fetchUrl = `${state.config.sheetsUrl}?action=getVendedores&token=${PORTAL_TOKEN}&t=${Date.now()}`;
        const resp = await fetch(fetchUrl, { cache: "no-store" });
        const json = await resp.json();
        // El endpoint devuelve { success: true, data: [...] }
        const listaFresca = json && json.success && Array.isArray(json.data)
          ? json.data
          : (Array.isArray(json && json.vendedores) ? json.vendedores : null);

        if (listaFresca && listaFresca.length > 0) {
          state.vendedoresLista = listaFresca;
          guardarVendedoresListaLocal();
          lista = listaFresca;
        } else if (json && json.error) {
          console.warn("Sheets devolvió error:", json.error);
        }
      } catch (fetchErr) {
        console.warn("No se pudo refrescar la lista de vendedores:", fetchErr);
      }
    }

    // 2. Buscar el teléfono en la lista (fresca o local)
    console.log("[LOGIN VENDEDOR] Teléfono ingresado:", tel, "telShort:", telShort, "Total vendedores en lista:", (lista ? lista.length : 0), lista);
    const encontrado = buscarEnLista(lista);

    if (!encontrado) {
      if (!lista || lista.length === 0) {
        showFeedback("⚠️ No hay vendedores en la lista recibida de Google Sheets. Asegúrate de haber guardado al vendedor en el sistema principal o revisa la hoja 'Vendedores'.", true);
      } else {
        const resumenTels = lista.map(v => v.nombre + ": " + (v.telefono || "sin tel")).join(", ");
        console.warn("[LOGIN VENDEDOR] Teléfonos en lista recibida:", resumenTels);
        showFeedback(`❌ Teléfono (${tel}) no coincide con los registrados (${lista.length} vendedores en sistema). Consulta con Carlos o Daniel.`, true);
      }
      return;
    }

    if (String(encontrado.estado || "ACTIVO").toUpperCase() !== "ACTIVO") {
      showFeedback("🚫 Tu cuenta está inactiva. Consulta con Carlos o Daniel.", true);
      return;
    }

    // ÉXITO — guardar sesión
    state.vendedor = encontrado.nombre;
    state.vendedorTelefono = telShort || tel;
    state.porcentajeComision = parseFloat(encontrado.porcentajeComision) || 13;
    localStorage.setItem("pv_vendedor", state.vendedor);
    localStorage.setItem("pv_vendedor_telefono", state.vendedorTelefono);

    showFeedback("✅ Acceso correcto. Sincronizando catálogo y existencias...", false);

    // 3. Sincronizar catálogo, clientes y stock asignado de inmediato
    if (state.config.sheetsUrl && navigator.onLine) {
      const syncOk = await sincronizarConSheets(false);
      // Si fue inactivado durante la sincronización, abortar el ingreso
      if (syncOk === false || !state.vendedorTelefono || state.vendedor === "Colaborador") {
        return;
      }
    } else {
      renderizarTodo();
    }

    cerrarModalVendedor();
    actualizarUIVendedor();
    mostrarToast(`✅ Bienvenido, ${encontrado.nombre}`, "success");

  } catch (errG) {
    console.error("Error en validación de vendedor:", errG);
    showFeedback("❌ Error al validar: " + (errG.message || errG), true);
  } finally {
    if (btn) btn.disabled = false;
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
  if (tc) tc.textContent = state.config.tipoCambio || 500;
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
  if (inputTC) inputTC.value = state.config.tipoCambio || 500;
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
  const tc = parseNum(inputTC ? inputTC.value : 500, 500);

  state.config.sheetsUrl = url;
  state.config.tipoCambio = tc;
  localStorage.setItem("pv_config", JSON.stringify(state.config));
  aplicarConfigUI();
  cerrarModalConfig();
  mostrarToast("Configuración guardada ⚙️", "success");

  if (url && navigator.onLine) {
    sincronizarConSheets(true);
  }

  // Después de configurar la URL, pedir el teléfono si aún no se ha ingresado
  comprobarVendedor();
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
    localStorage.removeItem("pv_apartados");
    localStorage.removeItem("pv_abonos_apartados");
    localStorage.removeItem("pv_facturas");
    localStorage.removeItem("pv_liquidaciones");
    localStorage.removeItem("pv_carrito");
    localStorage.removeItem("pv_cola_offline");
    localStorage.removeItem("pv_stock_vendedor");
    localStorage.removeItem("pv_vendedores_lista");
    localStorage.removeItem("pv_vendedor_telefono");

    // Reiniciar estado en memoria
    state.productos = [];
    state.clientes = [];
    state.misPedidos = [];
    state.misApartados = [];
    state.misAbonosApartados = [];
    state.facturas = [];
    state.liquidaciones = [];
    state.pedidoCarrito = [];
    state.colaOffline = [];
    state.stockPorCodigo = {};
    state.vendedoresLista = [];
    state.vendedorTelefono = "";

    // Preservar configuración (el vendedor debe volver a autenticarse)
    state.config = config;
    state.vendedor = "Colaborador";
    localStorage.setItem("pv_config", JSON.stringify(config));
    localStorage.setItem("pv_vendedor", "Colaborador");

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
  ["productos", "pedidos", "apartados", "facturas", "comision", "clientes"].forEach(v => {
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
  if (vista === "apartados") renderizarModuloApartados();
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
  renderizarModuloApartados();
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

  // Filtro por stock
  if (state.filtroStock === "con_stock") {
    prods = prods.filter(p => {
      const cod = String(p.codigo || "").trim().toUpperCase();
      return (state.stockPorCodigo && state.stockPorCodigo[cod] > 0);
    });
  } else if (state.filtroStock === "sin_stock") {
    prods = prods.filter(p => {
      const cod = String(p.codigo || "").trim().toUpperCase();
      const s = state.stockPorCodigo && state.stockPorCodigo[cod];
      return !s || s <= 0;
    });
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
            
            <!-- Existencias de Stock Disponibles (Sin revelar a quién pertenece) -->
            <div class="mt-1 flex items-center gap-1.5">
              ${(() => {
                const cod = String(p.codigo || "").trim().toUpperCase();
                const stockDisponible = (state.stockPorCodigo && state.stockPorCodigo[cod] !== undefined) 
                  ? state.stockPorCodigo[cod] 
                  : 0;
                
                if (stockDisponible > 0) {
                  return `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-[10px] font-mono font-bold text-emerald-300">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>${stockDisponible} disponibles</span>
                    </span>
                  `;
                } else {
                  return `
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-950/80 border border-rose-500/30 text-[10px] font-mono font-bold text-rose-300">
                      <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      <span>Agotado</span>
                    </span>
                  `;
                }
              })()}
            </div>
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

function filtrarStock(modo) {
  // modo: "todos" | "con_stock" | "sin_stock"
  state.filtroStock = modo;

  // Actualizar visual de los botones
  const estilos = {
    todos:      { active: "bg-slate-700 text-white border-slate-600",      inactive: "bg-slate-900 text-slate-400 border-slate-700" },
    con_stock:  { active: "bg-emerald-950 text-emerald-300 border-emerald-500/60", inactive: "bg-slate-900 text-emerald-400 border-emerald-500/40" },
    sin_stock:  { active: "bg-rose-950 text-rose-300 border-rose-500/50",  inactive: "bg-slate-900 text-rose-400 border-rose-500/30" }
  };

  ["todos", "con_stock", "sin_stock"].forEach(m => {
    const btn = document.getElementById(`sfBtn-${m}`);
    if (!btn) return;
    const s = estilos[m];
    // Quitar clases de ambos estados
    btn.className = btn.className
      .replace(/bg-\S+/g, "").replace(/text-\S+/g, "").replace(/border-\S+/g, "").replace(/  +/g, " ").trim();
    // Agregar estado correcto
    const clsBase = "stock-pill px-3 py-1 rounded-full shrink-0 border transition-all text-xs font-bold";
    btn.className = `${clsBase} ${m === modo ? s.active : s.inactive}`;
  });

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

// --- EXPORTAR / COMPARTIR CATÁLOGO POR WHATSAPP ---
function abrirModalExportarCatalogo() {
  const modal = document.getElementById("modalExportarCatalogo");
  if (!modal) return;

  // Poblado dinámico del selector de categorías en el modal
  const selCat = document.getElementById("exportFiltroCategoria");
  if (selCat) {
    const categorias = ["Todas", ...new Set((state.productos || []).map(p => p.categoria || "General"))];
    selCat.innerHTML = categorias.map(c => `<option value="${c}">${c === "Todas" ? "Todas las categorías" : c}</option>`).join("");
    // Heredar categoría actualmente seleccionada si existe
    if (state.categoriaSeleccionada && categorias.includes(state.categoriaSeleccionada)) {
      selCat.value = state.categoriaSeleccionada;
    } else {
      selCat.value = "Todas";
    }
  }

  // Heredar filtro de stock si el usuario lo tenía activo
  const selStock = document.getElementById("exportFiltroStock");
  if (selStock) {
    selStock.value = (state.filtroStock === "sin_stock" || state.filtroStock === "todos") ? "todos" : "constock";
  }

  actualizarVistaPreviaExportarCatalogo();

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();
}

function cerrarModalExportarCatalogo() {
  const modal = document.getElementById("modalExportarCatalogo");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function generarTextoCatalogoWhatsApp() {
  const filtroStock = document.getElementById("exportFiltroStock") ? document.getElementById("exportFiltroStock").value : "constock";
  const filtroCategoria = document.getElementById("exportFiltroCategoria") ? document.getElementById("exportFiltroCategoria").value : "Todas";
  const mostrarCantidades = document.getElementById("exportMostrarCantidades") ? document.getElementById("exportMostrarCantidades").checked : true;

  const stockMap = state.stockPorCodigo || {};
  const todos = state.productos || [];

  // Filtrar según opciones
  let prods = todos.filter(p => {
    const cod = String(p.codigo || "").trim().toUpperCase();
    const st = (stockMap[cod] !== undefined) ? stockMap[cod] : (stockMap[p.codigo] || 0);
    if (filtroStock === "constock" && st <= 0) return false;
    if (filtroCategoria !== "Todas" && (p.categoria || "General") !== filtroCategoria) return false;
    return true;
  });

  // Ordenar por categoría y luego nombre
  prods.sort((a, b) => {
    const catA = (a.categoria || "General").localeCompare(b.categoria || "General");
    if (catA !== 0) return catA;
    return (a.nombre || "").localeCompare(b.nombre || "");
  });

  const negocio = "DC EL DESTAPE LICORES";
  const telefono = state.vendedorTelefono ? `+506 ${state.vendedorTelefono}` : "+506 8992-7936";
  const fechaHoy = new Date().toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });

  const getEmojiCategoria = (cat = "") => {
    const c = cat.toUpperCase();
    if (c.includes("WHISKY") || c.includes("WHISKEY") || c.includes("BOURBON")) return "🥃";
    if (c.includes("RON")) return "🍹";
    if (c.includes("TEQUILA")) return "🌵";
    if (c.includes("VODKA") || c.includes("GIN")) return "🍸";
    if (c.includes("VINO") || c.includes("CHAMPAGNE")) return "🍷";
    if (c.includes("CREMA")) return "☕";
    if (c.includes("CERVEZA")) return "🍺";
    return "🍾";
  };

  let texto = `✨━━━━━━━━━━━━━━━━━✨\n`;
  texto += `🥂 *${negocio.toUpperCase()}* 🥂\n`;
  texto += `📋 *MENÚ DE PRECIOS & DISPONIBILIDAD*\n`;
  texto += `🗓️ ${fechaHoy}  •  📱 ${telefono}\n`;
  texto += `✨━━━━━━━━━━━━━━━━━✨\n`;

  if (prods.length === 0) {
    texto += `\n_No hay productos disponibles con los filtros seleccionados._\n`;
  } else {
    let catActual = "";
    prods.forEach(p => {
      const cat = (p.categoria || "GENERAL").toUpperCase();
      if (cat !== catActual) {
        catActual = cat;
        const emoji = getEmojiCategoria(catActual);
        texto += `\n${emoji} ━━ *${catActual}* ━━\n`;
      }

      const cod = String(p.codigo || "").trim().toUpperCase();
      const st = (stockMap[cod] !== undefined) ? stockMap[cod] : (stockMap[p.codigo] || 0);
      const precioCRC = fmtCRC(p.precioVentaCRC || 0);
      
      let badgeStock = "";
      if (mostrarCantidades) {
        badgeStock = st > 0 ? ` _(🟢 ${st} disp.)_` : ` _(⏳ Encargo)_`;
      }

      // Formato limpio en colones
      texto += `▫️ *${p.nombre}*${badgeStock}\n    💰 *${precioCRC}*\n`;
    });
  }

  texto += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  texto += `🛵 *Entregas y envíos a convenir*\n`;
  texto += `📲 *Instagram:* instagram.com/dceldestape\n`;
  texto += `🔵 *Facebook:* facebook.com/share/1CHT3FRSc6/\n`;
  texto += `━━━━━━━━━━━━━━━━━━━━\n`;
  texto += `¡Escríbenos para apartar tus licores favoritos! 🥂✨`;

  return { texto, count: prods.length };
}

function actualizarVistaPreviaExportarCatalogo() {
  const preview = document.getElementById("exportPreviewText");
  const countEl = document.getElementById("exportItemsCount");
  const { texto, count } = generarTextoCatalogoWhatsApp();
  
  if (preview) preview.value = texto;
  if (countEl) countEl.textContent = count;
}

function copiarTextoCatalogoWhatsApp() {
  const { texto, count } = generarTextoCatalogoWhatsApp();
  if (!texto) {
    mostrarToast("No hay datos para copiar", "error");
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(() => {
      mostrarToast(`¡Catálogo de ${count} licores copiado al portapapeles! 📋`, "success");
    }).catch(() => {
      // Fallback manual con textarea
      const ta = document.getElementById("exportPreviewText");
      if (ta) {
        ta.select();
        document.execCommand("copy");
        mostrarToast(`¡Catálogo de ${count} licores copiado! 📋`, "success");
      }
    });
  } else {
    const ta = document.getElementById("exportPreviewText");
    if (ta) {
      ta.select();
      document.execCommand("copy");
      mostrarToast(`¡Catálogo de ${count} licores copiado! 📋`, "success");
    }
  }
}

function enviarCatalogoWhatsAppDirecto() {
  const { texto, count } = generarTextoCatalogoWhatsApp();
  if (!texto) {
    mostrarToast("No hay datos para exportar", "error");
    return;
  }
  const encoded = encodeURIComponent(texto);
  const url = `https://wa.me/?text=${encoded}`;
  window.open(url, "_blank");
  mostrarToast(`Abriendo WhatsApp con ${count} productos... 📲`, "success");
}

// ==========================================================================
// 2. MÓDULO PEDIDOS (ENCARGOS)
// ==========================================================================
function agregarAlPedidoDesdeCatalogo(codigo) {
  const p = state.productos.find(prod => prod.codigo === codigo);
  if (!p) return;

  const cod = String(codigo).trim().toUpperCase();
  const stockDisponible = (state.stockPorCodigo && state.stockPorCodigo[cod] !== undefined)
    ? state.stockPorCodigo[cod]
    : 0;

  const ya = state.pedidoCarrito.find(it => it.codigo === codigo);
  const cantActual = ya ? ya.cantidad : 0;

  // Si no hay stock físico disponible
  if (stockDisponible <= 0) {
    mostrarToast(`⚠️ Sin existencias disponibles de ${p.nombre}. Se agregará como encargo pendiente.`, "info");
  } else if (cantActual + 1 > stockDisponible) {
    mostrarToast(`⚠️ Solo hay ${stockDisponible} uds disponibles en inventario. Cantidad actual: ${cantActual + 1}`, "info");
  }

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

  if (state.modoPedido === "apartado") {
    actualizarCalculoApartadoPreventaUI();
  }

  const badgeNav = document.getElementById("navPedidosBadge");
  if (badgeNav) badgeNav.classList.remove("hidden");
}

function cambiarModoPedido(modo) {
  state.modoPedido = modo;
  const btnPedido = document.getElementById("btnModoPedido");
  const btnApartado = document.getElementById("btnModoApartado");
  const bannerApartado = document.getElementById("pedidoBannerModoApartado");
  const btnConfirmar = document.getElementById("btnConfirmarPedido");
  const headerIcon = document.getElementById("pedidoHeaderIcon");
  const headerIconCont = document.getElementById("pedidoHeaderIconContainer");
  const headerTitulo = document.getElementById("pedidoHeaderTitulo");
  const headerSubtitulo = document.getElementById("pedidoHeaderSubtitulo");
  const labelCliente = document.getElementById("pedidoLabelCliente");
  const totalLabel = document.getElementById("pedidoTotalLabel");

  if (modo === "apartado") {
    if (btnPedido) {
      btnPedido.className = "py-2 rounded-lg bg-transparent text-slate-400 hover:text-white flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (btnApartado) {
      btnApartado.className = "py-2 rounded-lg bg-blue-600 text-white shadow-md flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (bannerApartado) bannerApartado.classList.remove("hidden");
    if (btnConfirmar) {
      btnConfirmar.className = "w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider";
      btnConfirmar.innerHTML = `<i data-lucide="bookmark-check" class="w-4 h-4"></i><span>Confirmar y Reservar Apartado</span>`;
    }
    if (headerIconCont) headerIconCont.className = "p-2 rounded-xl bg-blue-500/20 text-blue-400";
    if (headerIcon) headerIcon.setAttribute("data-lucide", "bookmark");
    if (headerTitulo) headerTitulo.textContent = "Nuevo Apartado de Cliente";
    if (headerSubtitulo) headerSubtitulo.textContent = "Reserva mercadería y gestiona abonos";
    if (labelCliente) labelCliente.textContent = "Cliente del Apartado *";
    if (totalLabel) totalLabel.textContent = "Total Apartado:";
    actualizarCalculoApartadoPreventaUI();
    mostrarToast("Modo 'Apartado' (reserva con abono) 🔖", "info");
  } else {
    if (btnPedido) {
      btnPedido.className = "py-2 rounded-lg bg-amber-500 text-slate-950 shadow-md flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (btnApartado) {
      btnApartado.className = "py-2 rounded-lg bg-transparent text-slate-400 hover:text-white flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (bannerApartado) bannerApartado.classList.add("hidden");
    if (btnConfirmar) {
      btnConfirmar.className = "w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-2xl shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider";
      btnConfirmar.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i><span>Confirmar y Enviar Pedido</span>`;
    }
    if (headerIconCont) headerIconCont.className = "p-2 rounded-xl bg-amber-500/20 text-amber-400";
    if (headerIcon) headerIcon.setAttribute("data-lucide", "shopping-bag");
    if (headerTitulo) headerTitulo.textContent = "Nuevo Pedido / Encargo";
    if (headerSubtitulo) headerSubtitulo.textContent = "Para abastecer con la distribuidora";
    if (labelCliente) labelCliente.textContent = "Cliente del Pedido *";
    if (totalLabel) totalLabel.textContent = "Monto Venta Estimado:";
    mostrarToast("Modo 'Encargo / Pedido' 📋", "info");
  }

  inicializarIconos();
  renderizarItemsPedidoActual();
}

function actualizarCalculoApartadoPreventaUI() {
  const resumenBotellas = document.getElementById("pedidoApartadoResumenBotellas");
  const totalCRCEl = document.getElementById("pedidoApartadoTotalCRC");
  const saldoCRCEl = document.getElementById("pedidoApartadoSaldoCRC");
  const inputAbono = document.getElementById("pedidoApartadoAbonoCRC");

  let totalCRC = 0;
  let totalBotellas = 0;
  (state.pedidoCarrito || []).forEach(it => {
    totalCRC += (it.cantidad * (it.precioVentaCRC || 0));
    totalBotellas += it.cantidad;
  });

  const abono = Math.max(0, Number(inputAbono ? inputAbono.value : 0) || 0);
  const saldo = Math.max(0, totalCRC - abono);

  if (resumenBotellas) resumenBotellas.textContent = `${totalBotellas} botella(s)`;
  if (totalCRCEl) totalCRCEl.textContent = fmtCRC(totalCRC);
  if (saldoCRCEl) {
    saldoCRCEl.textContent = fmtCRC(saldo);
    if (saldo <= 0 && totalCRC > 0) {
      saldoCRCEl.className = "text-sm font-black text-emerald-400";
    } else {
      saldoCRCEl.className = "text-sm font-black text-amber-400";
    }
  }
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
  if (state.modoPedido === "apartado") {
    return guardarApartadoActual();
  }

  if (!state.pedidoCarrito || state.pedidoCarrito.length === 0) {
    mostrarToast("Agrega al menos un licor al pedido.", "error");
    return;
  }

  const vendActual = String(state.vendedor || "").trim();
  if (!vendActual || vendActual.toLowerCase() === "colaborador" || !state.vendedorTelefono) {
    mostrarToast("Ingresa con tu teléfono de vendedor antes de registrar pedidos.", "error");
    abrirModalVendedor(true);
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

function guardarApartadoActual() {
  if (!state.pedidoCarrito || state.pedidoCarrito.length === 0) {
    mostrarToast("Agrega al menos un licor al apartado.", "error");
    return;
  }

  const vendActual = String(state.vendedor || "").trim();
  if (!vendActual || vendActual.toLowerCase() === "colaborador" || !state.vendedorTelefono) {
    mostrarToast("Ingresa con tu teléfono de vendedor antes de registrar apartados.", "error");
    abrirModalVendedor(true);
    return;
  }

  const cliId = state.pedidoClienteSeleccionado;
  if (!cliId) {
    mostrarToast("Debes seleccionar un cliente para registrar el apartado.", "error");
    return;
  }

  const cli = state.clientes.find(c => c.id === cliId);
  const clienteNombre = cli ? cli.nombre : "Cliente General";
  const clienteTelefono = cli ? cli.telefono : "";

  const tc = Number(state.config.tipoCambio) || 500;
  let totalCRC = 0;
  let totalUSD = 0;
  state.pedidoCarrito.forEach(i => {
    const subCRC = i.cantidad * i.precioVentaCRC;
    const subUSD = i.cantidad * (i.precioVentaUSD || (i.precioVentaCRC / tc));
    totalCRC += subCRC;
    totalUSD += subUSD;
  });

  const inputAbono = document.getElementById("pedidoApartadoAbonoCRC");
  const abonoInicialCRC = Math.max(0, Number(inputAbono ? inputAbono.value : 0) || 0);

  if (abonoInicialCRC > totalCRC) {
    mostrarToast("El abono inicial no puede ser mayor al total del apartado.", "error");
    if (inputAbono) inputAbono.focus();
    return;
  }

  const abonoInicialUSD = abonoInicialCRC > 0 ? (abonoInicialCRC / tc) : 0;
  const saldoPendienteCRC = Math.max(0, totalCRC - abonoInicialCRC);
  const saldoPendienteUSD = Math.max(0, totalUSD - abonoInicialUSD);
  const metodoPagoAbono = document.getElementById("pedidoApartadoMetodoPago")?.value || "Efectivo";
  const fechaVenc = document.getElementById("pedidoApartadoFechaVenc")?.value || "";
  const notas = document.getElementById("pedidoApartadoNotas")?.value?.trim() || "";

  const ahora = new Date();
  const idApartado = "APT-" + ahora.toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const estado = saldoPendienteCRC <= 0 ? "Liquidado" : "Activo";

  const abonosList = [];
  if (abonoInicialCRC > 0) {
    const idAbono = "ABO-" + Date.now().toString().slice(-6);
    const abonoObj = {
      id: idAbono,
      fecha: ahora.toISOString(),
      idApartado: idApartado,
      cliente: clienteNombre,
      telefono: clienteTelefono,
      montoCRC: abonoInicialCRC,
      montoUSD: abonoInicialUSD,
      metodoPago: metodoPagoAbono,
      saldoRestanteCRC: saldoPendienteCRC,
      saldoRestanteUSD: saldoPendienteUSD,
      recibidoPor: state.vendedor,
      notas: "Abono inicial al momento de apartar"
    };
    abonosList.push(abonoObj);
    if (!state.misAbonosApartados) state.misAbonosApartados = [];
    state.misAbonosApartados.unshift(abonoObj);
  }

  const apartadoObj = {
    id: idApartado,
    fecha: ahora.toISOString(),
    vendedor: state.vendedor || "Colaborador",
    cliente: clienteNombre,
    clienteId: cli ? cli.id : null,
    clienteTelefono: clienteTelefono,
    items: state.pedidoCarrito.map(it => ({
      codigo: String(it.codigo || "").trim().toUpperCase(),
      nombre: String(it.nombre || it.codigo).trim(),
      cantidad: Number(it.cantidad || 1),
      precioVentaCRC: Number(it.precioVentaCRC || 0),
      precioVentaUSD: Number(it.precioVentaUSD || (it.precioVentaCRC / tc)),
      subtotalCRC: Number(it.cantidad || 1) * Number(it.precioVentaCRC || 0),
      subtotalUSD: Number(it.cantidad || 1) * Number(it.precioVentaUSD || (it.precioVentaCRC / tc))
    })),
    montoTotalCRC: totalCRC,
    montoTotalUSD: totalUSD,
    totalAbonadoCRC: abonoInicialCRC,
    totalAbonadoUSD: abonoInicialUSD,
    saldoPendienteCRC: saldoPendienteCRC,
    saldoPendienteUSD: saldoPendienteUSD,
    estado: estado,
    fechaVencimiento: fechaVenc,
    fechaEntrega: "",
    notas: notas,
    abonos: abonosList
  };

  if (!state.misApartados) state.misApartados = [];
  state.misApartados.unshift(apartadoObj);
  guardarApartadosLocal();

  // Encolar acción para sincronizar con Google Sheets
  encolarAccionSync("registrarApartado", {
    apartado: {
      ...apartadoObj,
      abonoInicialCRC: abonoInicialCRC,
      abonoInicialUSD: abonoInicialUSD,
      metodoPagoAbono: metodoPagoAbono
    }
  });

  // Limpiar pedido actual
  state.pedidoCarrito = [];
  state.pedidoClienteSeleccionado = null;
  guardarCarritoLocal();
  if (inputAbono) inputAbono.value = "0";
  const inNotas = document.getElementById("pedidoApartadoNotas");
  if (inNotas) inNotas.value = "";

  renderizarModuloPedidos();
  renderizarModuloApartados();

  mostrarToast(`¡Apartado ${idApartado} registrado para ${clienteNombre}! 🔖`, "success");

  // Compartir comprobante por WhatsApp
  compartirApartadoWhatsApp(idApartado);
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
    const esComprado = String(p.estado || "").trim().toLowerCase() === "comprado";

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

  const telDestino = String(p.clienteTelefono || "").replace(/\D/g, "").replace(/^506/, "");
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
    telDestino = String(cliEncontrado.telefono).replace(/\D/g, "").replace(/^506/, "");
  } else {
    const pedEncontrado = (state.misPedidos || []).find(p => p.id === f.pedidoOrigenId);
    if (pedEncontrado && pedEncontrado.clienteTelefono) {
      telDestino = String(pedEncontrado.clienteTelefono).replace(/\D/g, "").replace(/^506/, "");
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
  const tc = Number(state.config.tipoCambio) || 500;
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
  actualizarBotonContactos();
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
  actualizarBotonContactos();
  inicializarIconos();
}

// Selector de contactos del dispositivo (Contact Picker API: Chrome Android, HTTPS/localhost).
// Si no está disponible, el botón se oculta y se sigue digitando manual.
function contactosDisponibles() {
  try {
    return ("contacts" in navigator) && ("ContactsManager" in window);
  } catch (e) { return false; }
}

function actualizarBotonContactos() {
  // El botón siempre visible: si el navegador no soporta Contact Picker,
  // al pulsarlo se explica cómo hacerlo (Chrome Android + HTTPS).
  const b = document.getElementById("btnContactoCliente");
  if (!b) return;
  b.classList.remove("hidden");
  b.classList.add("flex");
}

async function seleccionarContactoTelefono() {
  const nombreInput = document.getElementById("modalClienteNombre");
  const telInput = document.getElementById("modalClienteTelefono");
  // 1. Nativo en Chrome/Edge Android (HTTPS o localhost)
  if (contactosDisponibles()) {
    try {
      const lista = await navigator.contacts.select(["name", "tel"], { multiple: false });
      if (!lista || lista.length === 0) return;
      const c = lista[0] || {};
      rellenarClienteDesdeContacto(
        String((c.name && c.name[0]) || "").trim(),
        String((Array.isArray(c.tel) ? c.tel[0] : "") || "").replace(/[^\d+]/g, "").trim()
      );
      return;
    } catch (e) {
      if (e && e.name === "NotAllowedError") mostrarToast("Permiso de contactos denegado.", "error");
      else if (!(e && e.name === "AbortError")) mostrarToast("No se pudo leer contactos.", "error");
      return;
    }
  }
  // 2. Fallback PC/escritorio: elegir desde archivo vCard (.vcf exportado de Google Contactos)
  const inp = document.getElementById("inputVcardContactos");
  if (inp) {
    mostrarToast("En PC elige tu archivo de contactos .vcf (se exporta gratis desde contacts.google.com).", "info");
    inp.click();
  } else {
    mostrarToast("En este navegador no se puede abrir la agenda. Usa Chrome en Android con la app instalada (HTTPS) o digita el número manual.", "info");
  }
}

function rellenarClienteDesdeContacto(nombre, tel) {
  const nombreInput = document.getElementById("modalClienteNombre");
  const telInput = document.getElementById("modalClienteTelefono");
  if (nombreInput && nombre && !String(nombreInput.value || "").trim()) nombreInput.value = nombre;
  if (telInput && tel) {
    telInput.value = tel;
    telInput.focus();
  }
  if (!tel) mostrarToast("El contacto no tiene teléfono.", "error");
}

// --- Importar agenda desde vCard (.vcf) para PC ---
let _contactosVcard = [];

function parseVcards(texto) {
  const contactos = [];
  const bloques = String(texto || "").split(/BEGIN:VCARD/i);
  for (const b of bloques) {
    if (!b || !b.trim()) continue;
    const lineas = b.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    let nombre = "";
    const tels = [];
    for (const ln of lineas) {
      const mFn = ln.match(/^FN[^:]*:(.*)$/i);
      if (mFn && !nombre) nombre = mFn[1].trim();
      const mTel = ln.match(/^TEL[^:]*:(.*)$/i);
      if (mTel) {
        const num = mTel[1].trim();
        if (!num) continue;
        const pref = /cell|mobile|iphone/i.test(ln) ? 0 : (/voice|pref/i.test(ln) ? 1 : 2);
        tels.push({ num, pref });
      }
    }
    if (!nombre) {
      const mN = b.match(/^N[^:]*:(.*)$/im);
      if (mN) {
        const p = mN[1].split(";");
        nombre = [(p[1] || ""), (p[0] || "")].join(" ").trim();
      }
    }
    tels.sort((a, z) => a.pref - z.pref);
    if (nombre || tels.length > 0) {
      contactos.push({ nombre: nombre || "(Sin nombre)", tel: tels.length > 0 ? tels[0].num : "" });
    }
  }
  return contactos;
}

function importarContactosVcard(input) {
  const f = input && input.files && input.files[0];
  if (!f) return;
  const lector = new FileReader();
  lector.onload = () => {
    try {
      _contactosVcard = parseVcards(lector.result);
    } catch (e) {
      _contactosVcard = [];
    }
    input.value = "";
    const sel = document.getElementById("selectContactoVcard");
    if (!_contactosVcard.length) {
      mostrarToast("No se encontraron contactos en ese archivo.", "error");
      if (sel) sel.classList.add("hidden");
      return;
    }
    if (_contactosVcard.length === 1) {
      if (sel) sel.classList.add("hidden");
      rellenarClienteDesdeContacto(_contactosVcard[0].nombre, _contactosVcard[0].tel);
      mostrarToast("Contacto importado ✅", "success");
      return;
    }
    if (sel) {
      sel.innerHTML = '<option value="">-- Elige un contacto (' + _contactosVcard.length + ') --</option>' +
        _contactosVcard.map((c, i) => `<option value="${i}">${String(c.nombre).slice(0, 40)}${c.tel ? " • " + String(c.tel).slice(0, 20) : ""}</option>`).join("");
      sel.classList.remove("hidden");
      mostrarToast("Selecciona el contacto de la lista 👇", "info");
    }
  };
  lector.onerror = () => {
    mostrarToast("No se pudo leer el archivo.", "error");
    input.value = "";
  };
  lector.readAsText(f);
}

function elegirContactoVcard(idx) {
  if (idx === "" || idx === null || idx === undefined) return;
  const c = _contactosVcard[Number(idx)];
  if (!c) return;
  rellenarClienteDesdeContacto(c.nombre === "(Sin nombre)" ? "" : c.nombre, c.tel);
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
    case "registrarApartado":
      return (datos.apartado && datos.apartado.id) ? ("Registrando apartado (" + datos.apartado.id + ")...") : "Registrando apartado...";
    case "abonarApartado":
      return (datos.idApartado) ? ("Enviando abono a apartado (" + datos.idApartado + ")...") : "Enviando abono a apartado...";
    case "entregarApartado":
      return (datos.idApartado) ? ("Marcando apartado como entregado (" + datos.idApartado + ")...") : "Marcando apartado entregado...";
    case "cancelarApartado":
      return (datos.idApartado) ? ("Cancelando apartado (" + datos.idApartado + ")...") : "Cancelando apartado...";
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

let procesandoColaSync = false;
async function procesarColaSync() {
  if (procesandoColaSync) return;
  if (!navigator.onLine || !state.config.sheetsUrl || !state.colaOffline || state.colaOffline.length === 0) return;
  procesandoColaSync = true;

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
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();

      if (json && json.success) {
        state.colaOffline.shift();
        guardarColaLocal();
        actualizarBadgeCola();
      } else {
        const detalle = (json && json.error) ? json.error : "respuesta no exitosa del servidor";
        console.warn("Respuesta no exitosa al enviar:", item, json);
        mostrarToast(`⚠️ No se pudo subir ${item.accion}: ${String(detalle).slice(0, 120)}`, "error");
        break;
      }
    } catch (e) {
      console.warn("Fallo de red al procesar cola:", e);
      mostrarToast(`⚠️ Sin conexión o error al subir ${item.accion}. Queda en cola (${state.colaOffline.length}).`, "error");
      break;
    }
  }
  procesandoColaSync = false;
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
            if (p && p.id && miVend !== "colaborador" && pVend === miVend) {
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
          // Comparación estricta (normalizada): solo lo realizado por este preventa
          const coincideVendedorOrigen = !!origVend && origVend === miVend;
          const coincidePedidoOrigenId = !!pedId && misPedidosIds.has(pedId);
          const coincideVendedorDirecto = !origVend && !pedId && vVend === miVend;
          
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

      // F. Vendedores y Asignación de Inventario (Carlos / Daniel)
      if (json.data.vendedores && Array.isArray(json.data.vendedores)) {
        state.vendedoresLista = json.data.vendedores;
        guardarVendedoresListaLocal();
      }

      // F.1 Validación estricta de estado del vendedor actual
      // Si el vendedor fue inactivado en Sheets por Carlos o Daniel, expulsarlo y bloquear el acceso
      const miVendActual = String(state.vendedor || "").trim().toLowerCase();
      const miTelActual = String(state.vendedorTelefono || "").replace(/\D/g, "");
      const miTelShortActual = miTelActual.startsWith("506") ? miTelActual.slice(3) : miTelActual;

      if (miVendActual && miVendActual !== "colaborador" && (state.vendedoresLista || []).length > 0) {
        const infoVendedorEnLista = (state.vendedoresLista || []).find(v => {
          const vNom = String(v.nombre || "").trim().toLowerCase();
          const vTel = String(v.telefono || "").replace(/\D/g, "");
          const vTelShort = vTel.startsWith("506") ? vTel.slice(3) : vTel;
          return (vNom === miVendActual) || (miTelActual && (vTel === miTelActual || vTelShort === miTelShortActual || vTel === miTelShortActual || vTelShort === miTelActual));
        });

        if (infoVendedorEnLista && String(infoVendedorEnLista.estado || "ACTIVO").toUpperCase() !== "ACTIVO") {
          console.warn("[SEGURIDAD] Vendedor inactivado detectado durante sincronización:", infoVendedorEnLista);
          // 1. Limpiar credenciales de sesión local
          state.vendedor = "Colaborador";
          state.vendedorTelefono = "";
          localStorage.removeItem("pv_vendedor");
          localStorage.removeItem("pv_vendedor_telefono");
          state.stockPorCodigo = {};
          guardarStockLocal();
          actualizarUIVendedor();

          // 2. Mostrar alerta explicativa solicitada
          const alertaInactivo = "🚫 Tu usuario está inactivo. Valida con Carlos o Daniel para verificar tu estado.";
          mostrarToast(alertaInactivo, "error");

          // 3. Abrir modal forzado con feedback de bloqueo
          abrirModalVendedor(true);
          const feedbackModal = document.getElementById("vendedorLoginFeedback");
          if (feedbackModal) {
            feedbackModal.textContent = alertaInactivo;
            feedbackModal.className = "p-2.5 rounded-xl text-xs font-semibold bg-rose-950 border border-rose-500/50 text-rose-300";
            feedbackModal.classList.remove("hidden");
          }
          return false;
        }
      }

      // G. Existencias Calculadas (Stock Asignado)
      // Se extrae únicamente el stock del socio al que esté asignado este vendedor.
      // La app satélite NO muestra de quién es el stock para proteger la privacidad.
      if (json.data.stockPorVendedor && typeof json.data.stockPorVendedor === "object") {
        const miVend = String(state.vendedor || "").trim().toLowerCase();
        const miTel = String(state.vendedorTelefono || "").replace(/\D/g, "");
        const miTelShort = miTel.startsWith("506") ? miTel.slice(3) : miTel;

        const vendedorInfo = (state.vendedoresLista || []).find(v => {
          const vNom = String(v.nombre || "").trim().toLowerCase();
          const vTel = String(v.telefono || "").replace(/\D/g, "");
          const vTelShort = vTel.startsWith("506") ? vTel.slice(3) : vTel;
          return (vNom === miVend) || (miTel && (vTel === miTel || vTelShort === miTelShort || vTel === miTelShort || vTelShort === miTel));
        });

        if (vendedorInfo) {
          if (vendedorInfo.nombre && state.vendedor !== vendedorInfo.nombre) {
            state.vendedor = vendedorInfo.nombre;
            localStorage.setItem("pv_vendedor", state.vendedor);
          }
          if (vendedorInfo.porcentajeComision) {
            state.porcentajeComision = parseFloat(vendedorInfo.porcentajeComision) || 13;
          }
        }

        const socioAsignado = (vendedorInfo && vendedorInfo.asignadoA) ? String(vendedorInfo.asignadoA).trim() : "Carlos";
        
        const mapaStock = {};
        Object.keys(json.data.stockPorVendedor).forEach(cod => {
          const s = json.data.stockPorVendedor[cod];
          if (s) {
            // Asignar exclusivamente las unidades de Carlos o de Daniel según la asignación
            const cant = socioAsignado === "Daniel" ? parseNum(s.Daniel, 0) : parseNum(s.Carlos, 0);
            mapaStock[cod] = cant;
          }
        });

        state.stockPorCodigo = mapaStock;
        guardarStockLocal();
      }

      // H. Apartados y Abonos de Apartados
      if (json.data.apartados !== undefined) {
        const miVend = String(state.vendedor || "Colaborador").trim().toLowerCase();
        const rawApartados = Array.isArray(json.data.apartados) ? json.data.apartados : [];
        const misApartadosServidor = rawApartados.filter(a => {
          const v = String(a.vendedor || "").trim().toLowerCase();
          return miVend !== "colaborador" && v === miVend;
        });

        // Mantener apartados en cola offline que aún no han subido
        const idsSheets = new Set(misApartadosServidor.map(a => String(a.id || "").trim()));
        const apartadosPendientesOffline = (state.colaOffline || [])
          .filter(item => item.accion === "registrarApartado" && item.datos && item.datos.apartado)
          .map(item => item.datos.apartado)
          .filter(a => !idsSheets.has(String(a.id || "").trim()));

        state.misApartados = [...misApartadosServidor, ...apartadosPendientesOffline];
        guardarApartadosLocal();
      }

      if (json.data.abonosApartados !== undefined) {
        const rawAbonos = Array.isArray(json.data.abonosApartados) ? json.data.abonosApartados : [];
        const misApartadosIds = new Set((state.misApartados || []).map(a => String(a.id || "").trim().toUpperCase()));
        
        // Guardar abonos de mis apartados
        state.misAbonosApartados = rawAbonos.filter(ab => misApartadosIds.has(String(ab.idApartado || "").trim().toUpperCase()));
        
        // Asociar abonos a cada apartado en memoria si no venían incrustados
        state.misApartados.forEach(a => {
          const abonosDeEste = state.misAbonosApartados.filter(ab => String(ab.idApartado || "").trim().toUpperCase() === String(a.id || "").trim().toUpperCase());
          if (abonosDeEste.length > 0) {
            a.abonos = abonosDeEste;
          }
        });

        guardarApartadosLocal();
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

// ==========================================================================
// MÓDULO DE APARTADOS (PREVENTA)
// ==========================================================================
function renderizarModuloApartados() {
  const cont = document.getElementById("misApartadosList");
  const countActivosBadge = document.getElementById("apartadosActivosCount");
  const saldoPendienteBadge = document.getElementById("apartadosSaldoPendienteCRC");
  const totalAbonadoBadge = document.getElementById("apartadosTotalAbonadoCRC");
  if (!cont) return;

  const lista = state.misApartados || [];
  const q = String(state.busquedaApartados || "").trim().toLowerCase();
  const filtroEstado = String(state.filtroEstadoApartados || "activos").trim().toLowerCase();

  // 1. Métricas globales de mis apartados
  let activosCount = 0;
  let saldoPendienteActivosCRC = 0;
  let totalAbonadoGlobalCRC = 0;

  lista.forEach(a => {
    const est = String(a.estado || "Activo").trim();
    const sal = parseNum(a.saldoPendienteCRC, 0);
    const abo = parseNum(a.totalAbonadoCRC, 0);
    totalAbonadoGlobalCRC += abo;

    if (est === "Activo") {
      activosCount++;
      saldoPendienteActivosCRC += sal;
    }
  });

  if (countActivosBadge) countActivosBadge.textContent = activosCount;
  if (saldoPendienteBadge) saldoPendienteBadge.textContent = fmtCRC(saldoPendienteActivosCRC);
  if (totalAbonadoBadge) totalAbonadoBadge.textContent = fmtCRC(totalAbonadoGlobalCRC);

  // Badge en el navbar inferior
  const navBadge = document.getElementById("navApartadosBadge");
  if (navBadge) {
    if (activosCount > 0) navBadge.classList.remove("hidden");
    else navBadge.classList.add("hidden");
  }

  // 2. Actualizar botones de filtro
  ["activos", "liquidados", "entregados", "todos"].forEach(f => {
    const btn = document.getElementById("filtroAptEstado-" + f);
    if (btn) {
      if (f === filtroEstado) {
        btn.className = "px-3 py-1 rounded-xl font-bold text-[11px] bg-blue-600 text-white transition-all active:scale-95 shrink-0 shadow-sm";
      } else {
        btn.className = "px-3 py-1 rounded-xl font-bold text-[11px] bg-slate-800 text-slate-300 hover:text-white transition-all active:scale-95 shrink-0";
      }
    }
  });

  // 3. Filtrar según estado y búsqueda (solo apartados de este preventa)
  const miVendRender = String(state.vendedor || "Colaborador").trim().toLowerCase();
  let filtrados = lista.filter(a => {
    if (String(a.vendedor || "").trim().toLowerCase() !== miVendRender) return false;
    const est = String(a.estado || "Activo").trim().toLowerCase();

    if (filtroEstado === "activos" && est !== "activo") return false;
    if (filtroEstado === "liquidados" && est !== "liquidado") return false;
    if (filtroEstado === "entregados" && est !== "entregado") return false;

    if (q) {
      const matchId = String(a.id || "").toLowerCase().includes(q);
      const matchCli = String(a.cliente || "").toLowerCase().includes(q);
      const matchTel = String(a.clienteTelefono || "").toLowerCase().includes(q);
      const matchVend = String(a.vendedor || "").toLowerCase().includes(q);
      const matchNotas = String(a.notas || "").toLowerCase().includes(q);
      const matchItems = (a.items || []).some(i => 
        String(i.nombre || "").toLowerCase().includes(q) || 
        String(i.codigo || "").toLowerCase().includes(q)
      );
      if (!matchId && !matchCli && !matchTel && !matchVend && !matchNotas && !matchItems) return false;
    }

    return true;
  });

  if (filtrados.length === 0) {
    cont.innerHTML = `
      <div class="text-center py-10 text-slate-500 bg-slate-900/60 rounded-3xl border border-slate-800 space-y-2.5">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-slate-800 flex items-center justify-center text-slate-500">
          <i data-lucide="bookmark-x" class="w-6 h-6 stroke-1"></i>
        </div>
        <p class="text-xs font-bold text-slate-300">${q ? "No se encontraron apartados con ese criterio." : "No hay apartados en esta sección."}</p>
        <p class="text-[11px] text-slate-500 max-w-xs mx-auto">Puedes registrar un nuevo apartado seleccionando la opción 'Apartado' en la pestaña de Pedidos.</p>
        <div class="pt-1">
          <button onclick="cambiarModoPedido('apartado'); cambiarVista('pedidos');" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs inline-flex items-center gap-1.5 active:scale-95 transition-all shadow-md">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
            <span>Crear Nuevo Apartado</span>
          </button>
        </div>
      </div>
    `;
    inicializarIconos();
    return;
  }

  cont.innerHTML = filtrados.map(a => {
    const est = String(a.estado || "Activo").trim();
    const fStr = a.fecha ? new Date(a.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "S/F";
    const totalCRC = parseNum(a.montoTotalCRC, 0);
    const abonadoCRC = parseNum(a.totalAbonadoCRC, 0);
    const saldoCRC = parseNum(a.saldoPendienteCRC, 0);
    const items = a.items || [];
    const abonos = a.abonos || [];

    let badgeEstado = "bg-blue-950/80 text-blue-300 border-blue-500/40";
    let iconEstado = "clock";
    let labelEstado = "Activo (En Proceso)";

    if (est === "Liquidado") {
      badgeEstado = "bg-emerald-950/80 text-emerald-300 border-emerald-500/40";
      iconEstado = "check-circle";
      labelEstado = "Liquidado (₡0 - Listo)";
    } else if (est === "Entregado") {
      badgeEstado = "bg-purple-950/80 text-purple-300 border-purple-500/40";
      iconEstado = "package-check";
      labelEstado = "Entregado al Cliente";
    } else if (est === "Cancelado") {
      badgeEstado = "bg-rose-950/80 text-rose-300 border-rose-500/40";
      iconEstado = "x-circle";
      labelEstado = "Cancelado";
    }

    // Progreso de pago
    const pct = totalCRC > 0 ? Math.min(100, Math.round((abonadoCRC / totalCRC) * 100)) : 100;

    return `
      <div class="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3 transition-all hover:border-slate-700">
        <!-- Encabezado de la tarjeta -->
        <div class="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-black text-white text-sm tracking-wide">${a.id}</span>
              <span class="px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase flex items-center gap-1 ${badgeEstado}">
                <i data-lucide="${iconEstado}" class="w-3 h-3"></i>
                <span>${labelEstado}</span>
              </span>
            </div>
            <div class="text-[11px] text-slate-400 font-sans mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>📅 ${fStr}</span>
              <span>•</span>
              <span>👤 Vend: <b class="text-slate-300">${a.vendedor || "Carlos"}</b></span>
              ${a.fechaVencimiento ? `<span>•</span><span class="text-amber-300 font-medium">⏳ Límite: ${a.fechaVencimiento}</span>` : ''}
            </div>
          </div>
          <div class="text-right font-mono shrink-0">
            <span class="text-xs text-slate-400 block font-sans">Total</span>
            <span class="text-base font-black text-white">${fmtCRC(totalCRC)}</span>
          </div>
        </div>

        <!-- Información del Cliente -->
        <div class="p-2.5 bg-slate-950/80 rounded-2xl border border-slate-800/80 flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <div class="p-1.5 rounded-xl bg-blue-500/20 text-blue-400">
              <i data-lucide="user" class="w-4 h-4"></i>
            </div>
            <div>
              <span class="font-bold text-white block leading-tight">${a.cliente || "Cliente General"}</span>
              ${a.clienteTelefono ? `<span class="text-[10px] text-slate-400 font-mono">📱 ${a.clienteTelefono}</span>` : '<span class="text-[10px] text-slate-500">Sin teléfono</span>'}
            </div>
          </div>
          ${a.clienteTelefono ? `
            <a href="https://wa.me/506${String(a.clienteTelefono).replace(/\\D/g, '').replace(/^506/, '')}" target="_blank"
              class="px-2 py-1 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-300 rounded-xl font-bold text-[10px] flex items-center gap-1 transition-all">
              <i data-lucide="message-circle" class="w-3 h-3"></i>
              <span>Chat</span>
            </a>
          ` : ''}
        </div>

        <!-- Lista de Productos Apartados -->
        <div class="space-y-1.5">
          <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Productos Apartados (${items.length}):</span>
          <div class="space-y-1 max-h-36 overflow-y-auto pr-1">
            ${items.map(it => `
              <div class="p-2 bg-slate-950/60 rounded-xl border border-slate-800/60 flex items-center justify-between text-xs font-mono">
                <div class="flex items-center gap-2 min-w-0 flex-1 font-sans">
                  <span class="font-black text-amber-400 shrink-0">${it.cantidad}x</span>
                  <span class="text-white truncate">${it.nombre || it.codigo}</span>
                </div>
                <span class="font-bold text-slate-300 font-mono text-[11px] shrink-0 ml-2">
                  ${fmtCRC(it.subtotalCRC || (it.cantidad * (it.precioVentaCRC || 0)))}
                </span>
              </div>
            `).join("")}
          </div>
        </div>

        <!-- Barra de Progreso y Saldos -->
        <div class="p-3 bg-slate-950/90 rounded-2xl border border-slate-800 space-y-2">
          <div class="flex items-center justify-between text-xs font-mono">
            <div>
              <span class="text-[10px] text-slate-400 font-sans block">Abonado (${pct}%)</span>
              <span class="font-bold text-emerald-400">${fmtCRC(abonadoCRC)}</span>
            </div>
            <div class="text-right">
              <span class="text-[10px] text-slate-400 font-sans block">Saldo Pendiente</span>
              <span class="font-black ${saldoCRC <= 0 ? 'text-emerald-400' : 'text-amber-400'}">${fmtCRC(saldoCRC)}</span>
            </div>
          </div>
          <!-- Barra gráfica -->
          <div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r ${saldoCRC <= 0 ? 'from-emerald-500 to-teal-400' : 'from-blue-500 to-indigo-500'} transition-all duration-500" style="width: ${pct}%"></div>
          </div>
        </div>

        <!-- Historial de Abonos (si tiene) -->
        ${abonos && abonos.length > 0 ? `
          <div class="p-2.5 bg-slate-950/60 rounded-2xl border border-slate-800/60 space-y-1.5">
            <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Historial de Abonos (${abonos.length}):</span>
            <div class="space-y-1 text-[11px] max-h-28 overflow-y-auto pr-1">
              ${abonos.map(ab => `
                <div class="flex items-center justify-between p-1.5 bg-slate-900 rounded-lg text-slate-300 font-mono">
                  <div class="font-sans flex items-center gap-1.5">
                    <i data-lucide="check" class="w-3 h-3 text-emerald-400 shrink-0"></i>
                    <span>${ab.fecha ? ab.fecha.slice(0, 16) : ''} (${ab.recibidoPor || state.vendedor})</span>
                    <span class="text-[10px] text-slate-500 font-mono">[${ab.metodoPago || 'Efectivo'}]</span>
                  </div>
                  <span class="font-bold text-emerald-400 font-mono">+${fmtCRC(ab.montoCRC || 0)}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ''}

        ${a.notas ? `<p class="text-[10.5px] text-slate-400 italic bg-slate-950/40 p-2 rounded-xl border border-slate-800/40">📝 ${a.notas}</p>` : ''}

        <!-- Botones de Acción -->
        <div class="pt-1 flex items-center justify-end gap-2 flex-wrap">
          <!-- WhatsApp Reenviar / Compartir -->
          <button onclick="compartirApartadoWhatsApp('${a.id}')" title="Enviar estado por WhatsApp"
            class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/30 text-xs">
            <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
            <span>WhatsApp</span>
          </button>

          <!-- Descargar Ticket -->
          <button onclick="imprimirTicketApartado('${a.id}')" title="Descargar comprobante en texto"
            class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl active:scale-95 transition-all flex items-center gap-1 text-xs">
            <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
            <span>Ticket</span>
          </button>

          <!-- Botón de Abono (si está Activo y con saldo > 0) -->
          ${est === "Activo" && saldoCRC > 0 ? `
            <button onclick="abrirModalAbonoApartado('${a.id}')"
              class="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-md shadow-blue-500/25 text-xs">
              <i data-lucide="hand-coins" class="w-3.5 h-3.5"></i>
              <span>+ Abonar</span>
            </button>
          ` : ''}

          <!-- Botón Entregar (si está Liquidado o si se decide entregar) -->
          ${est === "Liquidado" || (est === "Activo" && saldoCRC <= 0) ? `
            <button onclick="entregarApartadoConfirmar('${a.id}')"
              class="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/25 text-xs">
              <i data-lucide="package-check" class="w-3.5 h-3.5"></i>
              <span>Entregar</span>
            </button>
          ` : ''}

          <!-- Cancelar Apartado (solo si no está Entregado ni Cancelado) -->
          ${est !== "Entregado" && est !== "Cancelado" ? `
            <button onclick="cancelarApartadoConfirmar('${a.id}')" title="Cancelar apartado y liberar stock"
              class="px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-500/30 text-rose-300 font-bold rounded-xl active:scale-95 transition-all flex items-center gap-1 text-xs">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              <span>Cancelar</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  inicializarIconos();
}

function filtrarApartadosUI() {
  const input = document.getElementById("searchApartadosInput");
  state.busquedaApartados = input ? input.value : "";
  renderizarModuloApartados();
}

function cambiarFiltroEstadoApartados(estado) {
  state.filtroEstadoApartados = estado || "activos";
  renderizarModuloApartados();
}

function abrirModalAbonoApartado(idApartado) {
  const a = (state.misApartados || []).find(it => String(it.id).trim() === String(idApartado).trim());
  if (!a) {
    mostrarToast("Apartado no encontrado.", "error");
    return;
  }

  const modal = document.getElementById("modalRegistrarAbonoApartado");
  const subEl = document.getElementById("modalAbonoApartadoSubtitulo");
  const idEl = document.getElementById("modalAbonoIdApartado");
  const totalEl = document.getElementById("modalAbonoTotalCRC");
  const saldoEl = document.getElementById("modalAbonoSaldoCRC");
  const montoInput = document.getElementById("inputMontoAbonoCRC");
  const notasInput = document.getElementById("inputNotasAbono");

  if (idEl) idEl.value = a.id;
  if (subEl) subEl.textContent = `${a.id} • ${a.cliente || 'Cliente General'}`;
  if (totalEl) totalEl.textContent = fmtCRC(a.montoTotalCRC);
  if (saldoEl) saldoEl.textContent = fmtCRC(a.saldoPendienteCRC);
  if (montoInput) {
    montoInput.value = "";
    montoInput.max = a.saldoPendienteCRC;
    montoInput.placeholder = `Hasta ${fmtCRC(a.saldoPendienteCRC)}`;
  }
  if (notasInput) notasInput.value = "";

  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
  if (montoInput) setTimeout(() => montoInput.focus(), 150);
}

function cerrarModalAbonoApartado() {
  const modal = document.getElementById("modalRegistrarAbonoApartado");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function guardarNuevoAbonoApartado() {
  const idApartado = document.getElementById("modalAbonoIdApartado")?.value;
  const a = (state.misApartados || []).find(it => String(it.id).trim() === String(idApartado).trim());
  if (!a) {
    mostrarToast("Apartado no encontrado.", "error");
    return;
  }

  const montoInput = document.getElementById("inputMontoAbonoCRC");
  const montoCRC = Math.max(0, Number(montoInput ? montoInput.value : 0) || 0);

  if (montoCRC <= 0) {
    mostrarToast("Ingresa un monto válido mayor a 0.", "error");
    return;
  }

  if (montoCRC > Number(a.saldoPendienteCRC)) {
    mostrarToast(`El monto no puede superar el saldo pendiente (${fmtCRC(a.saldoPendienteCRC)}).`, "error");
    return;
  }

  const tc = Number(state.config.tipoCambio) || 500;
  const montoUSD = montoCRC / tc;
  const metodoPago = document.getElementById("selectMetodoPagoAbono")?.value || "Efectivo";
  const recibidoPor = state.vendedor || "Colaborador";
  const notas = document.getElementById("inputNotasAbono")?.value?.trim() || "";

  const idAbono = "ABO-" + Date.now().toString().slice(-6);
  const fechaISO = new Date().toISOString();

  // Actualizar apartado en memoria
  a.totalAbonadoCRC = (parseNum(a.totalAbonadoCRC, 0)) + montoCRC;
  a.totalAbonadoUSD = (parseNum(a.totalAbonadoUSD, 0)) + montoUSD;
  a.saldoPendienteCRC = Math.max(0, (parseNum(a.montoTotalCRC, 0)) - a.totalAbonadoCRC);
  a.saldoPendienteUSD = Math.max(0, (parseNum(a.montoTotalUSD, 0)) - a.totalAbonadoUSD);
  if (a.saldoPendienteCRC <= 0) {
    a.estado = "Liquidado";
  }

  const abonoObj = {
    id: idAbono,
    fecha: fechaISO,
    idApartado: a.id,
    cliente: a.cliente,
    telefono: a.clienteTelefono || "",
    montoCRC: montoCRC,
    montoUSD: montoUSD,
    metodoPago: metodoPago,
    saldoRestanteCRC: a.saldoPendienteCRC,
    saldoRestanteUSD: a.saldoPendienteUSD,
    recibidoPor: recibidoPor,
    notas: notas || "Abono a apartado"
  };

  if (!a.abonos) a.abonos = [];
  a.abonos.push(abonoObj);

  if (!state.misAbonosApartados) state.misAbonosApartados = [];
  state.misAbonosApartados.unshift(abonoObj);

  guardarApartadosLocal();

  // Encolar acción para sincronizar con Google Sheets
  encolarAccionSync("abonarApartado", {
    idApartado: a.id,
    abono: abonoObj
  });

  cerrarModalAbonoApartado();
  renderizarTodo();

  mostrarToast(`✅ Abono de ${fmtCRC(montoCRC)} registrado para ${a.cliente}. Saldo restante: ${fmtCRC(a.saldoPendienteCRC)}`, "success");

  // Compartir comprobante por WhatsApp
  compartirApartadoWhatsApp(a.id);
}

function entregarApartadoConfirmar(idApartado) {
  const a = (state.misApartados || []).find(it => String(it.id).trim() === String(idApartado).trim());
  if (!a) return;

  if (Number(a.saldoPendienteCRC) > 0) {
    if (!confirm(`⚠️ Este apartado aún tiene un saldo pendiente de ${fmtCRC(a.saldoPendienteCRC)}. ¿Deseas marcarlo como ENTREGADO de todos modos?`)) {
      return;
    }
  } else {
    if (!confirm(`¿Confirmar entrega de las botellas del apartado ${a.id} a ${a.cliente}?`)) {
      return;
    }
  }

  a.estado = "Entregado";
  a.fechaEntrega = new Date().toISOString();
  guardarApartadosLocal();

  encolarAccionSync("entregarApartado", {
    idApartado: a.id,
    entregadoPor: state.vendedor || "Colaborador"
  });

  renderizarTodo();
  mostrarToast(`📦 Apartado ${a.id} marcado como ENTREGADO con éxito.`, "success");
}

function cancelarApartadoConfirmar(idApartado) {
  const a = (state.misApartados || []).find(it => String(it.id).trim() === String(idApartado).trim());
  if (!a) return;

  const motivo = prompt(`¿Motivo de la cancelación del apartado ${a.id} (${a.cliente})?\n\nAl cancelar, las botellas reservadas volverán a estar disponibles en inventario:`);
  if (motivo === null) return;

  a.estado = "Cancelado";
  a.notas = `${a.notas ? a.notas + ' ' : ''}[CANCELADO: ${motivo.trim() || 'Sin motivo especificado'}]`;
  guardarApartadosLocal();

  encolarAccionSync("cancelarApartado", {
    idApartado: a.id,
    motivo: motivo.trim() || "Cancelado por el usuario",
    canceladoPor: state.vendedor || "Colaborador"
  });

  renderizarTodo();
  mostrarToast(`↩ Apartado ${a.id} cancelado.`, "info");
}

function compartirApartadoWhatsApp(idApartado) {
  const a = (state.misApartados || []).find(it => String(it.id).trim() === String(idApartado).trim());
  if (!a) {
    mostrarToast("Apartado no encontrado.", "error");
    return;
  }

  const negocio = "DC EL DESTAPE LICORES";
  const telefonoNegocio = "+506 8992-7936";
  const fecha = a.fecha ? new Date(a.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : new Date().toLocaleString();

  let texto = `🍷 *${negocio.toUpperCase()}* 🍷\n`;
  texto += `📱 *Tel:* ${telefonoNegocio}\n`;
  texto += `--------------------------------\n`;
  texto += `🔖 *COMPROBANTE DE APARTADO*\n`;
  texto += `📅 Fecha: ${fecha}\n`;
  texto += `🎫 N° Apartado: *${a.id}*\n`;
  texto += `👤 Cliente: *${a.cliente || "Cliente General"}*\n`;
  texto += `👤 Atendido por: ${a.vendedor || state.vendedor || "Colaborador"}\n`;
  if (a.fechaVencimiento) {
    texto += `⏳ Fecha límite de retiro: *${a.fechaVencimiento}*\n`;
  }
  texto += `--------------------------------\n`;
  texto += `📦 *PRODUCTOS RESERVADOS:*\n`;

  (a.items || []).forEach(i => {
    const cant = parseNum(i.cantidad, 1);
    const subCRC = parseNum(i.subtotalCRC, cant * parseNum(i.precioVentaCRC, 0));
    texto += `• ${cant}x ${i.nombre || i.codigo} = ${fmtCRC(subCRC)}\n`;
  });

  texto += `--------------------------------\n`;
  texto += `💵 *Total Apartado:* ${fmtCRC(a.montoTotalCRC)}\n`;
  texto += `💰 *Total Abonado:* ${fmtCRC(a.totalAbonadoCRC)}\n`;
  texto += `⚠️ *SALDO PENDIENTE:* *${fmtCRC(a.saldoPendienteCRC)}*\n`;
  
  const est = String(a.estado || "Activo").trim();
  if (est === "Liquidado" || parseNum(a.saldoPendienteCRC, 0) <= 0) {
    texto += `\n🎉 *¡APARTADO LIQUIDADO AL 100%!* Listo para retiro/entrega. ✅\n`;
  } else {
    texto += `\n🔒 _Mercadería reservada y apartada exclusivamente para usted._\n`;
  }

  if (a.abonos && a.abonos.length > 0) {
    texto += `\n📋 *Últimos abonos registrados:*\n`;
    a.abonos.slice(-3).forEach(ab => {
      texto += `  - ${ab.fecha ? ab.fecha.slice(0, 10) : ''}: +${fmtCRC(ab.montoCRC || 0)} (${ab.metodoPago || 'Efectivo'})\n`;
    });
  }

  texto += `\n¡Muchas gracias por su preferencia! 🍷\n\n`;
  texto += `📱 *Redes sociales:*\n`;
  texto += `📷 Instagram: https://www.instagram.com/dceldestape\n`;
  texto += `🔵 Facebook: https://www.facebook.com/share/1CHT3FRSc6/`;

  let telDestino = "";
  if (a.clienteTelefono) {
    telDestino = String(a.clienteTelefono).replace(/\\D/g, "").replace(/^506/, "");
  }

  const encoded = encodeURIComponent(texto);
  const waUrl = telDestino
    ? `https://wa.me/506${telDestino}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;

  window.open(waUrl, "_blank");
}

function imprimirTicketApartado(idApartado) {
  const a = (state.misApartados || []).find(it => String(it.id).trim() === String(idApartado).trim());
  if (!a) {
    mostrarToast("Apartado no encontrado.", "error");
    return;
  }

  const negocio = "DC EL DESTAPE LICORES";
  const telefono = "+506 8992-7936";
  const fecha = a.fecha ? new Date(a.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : new Date().toLocaleString();

  let lines = [
    "==========================================",
    `        ${negocio.toUpperCase()}`,
    `         Tel: ${telefono}`,
    "==========================================",
    `COMPROBANTE DE APARTADO: ${a.id}`,
    `Fecha: ${fecha}`,
    `Atendido por: ${a.vendedor || state.vendedor || "Colaborador"}`,
    `Cliente: ${a.cliente || "Cliente General"}`,
    a.clienteTelefono ? `Teléfono: ${a.clienteTelefono}` : "",
    a.fechaVencimiento ? `Fecha límite: ${a.fechaVencimiento}` : "",
    "------------------------------------------",
    "CANT  PRODUCTO                    TOTAL",
    "------------------------------------------"
  ].filter(Boolean);

  (a.items || []).forEach(i => {
    const cant = `${i.cantidad}x`.padEnd(5);
    const nom = (i.nombre || i.codigo || "").slice(0, 22).padEnd(23);
    const sub = fmtCRC(i.subtotalCRC || (i.cantidad * (i.precioVentaCRC || 0)));
    lines.push(`${cant} ${nom} ${sub}`);
  });

  lines.push("------------------------------------------");
  lines.push(`TOTAL APARTADO:   ${fmtCRC(a.montoTotalCRC)}`);
  lines.push(`TOTAL ABONADO:    ${fmtCRC(a.totalAbonadoCRC)}`);
  lines.push(`SALDO PENDIENTE:  ${fmtCRC(a.saldoPendienteCRC)}`);
  lines.push(`ESTADO:           ${a.estado || "Activo"}`);
  lines.push("==========================================");
  lines.push("   ¡Mercadería reservada con éxito!");
  lines.push("==========================================");

  const textContent = lines.join("\r\n");
  const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Ticket-Apartado-${a.id}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  mostrarToast("Ticket descargado 📄", "success");
}
