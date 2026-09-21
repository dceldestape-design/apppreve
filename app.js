/**
 * ==========================================================================
 * SISTEMA DE INVENTARIO Y VENTAS (LICORES & BEBIDAS) - v2.0 BI-MONEDA
 * ==========================================================================
 * Incluye catálogo de 54 licores, gestión de stock derivado, costo promedio
 * ponderado, soporte USD/CRC, exportación/importación Excel (.xlsx) y
 * sincronización bidireccional con Google Sheets.
 */

// --- Token de Autenticación Centralizado (Apps Internas) ---
const PORTAL_TOKEN = "dc_sec_EQE1RFEi6q3rMeXkjUUQQj5Q4u7sSbxx";

// --- Formatters ---
const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0
  );
const fmtCRC = (n) =>
  new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );
const fmtNum = (n) => new Intl.NumberFormat("es-CR").format(Number.isFinite(n) ? n : 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);
const parseNum = (val, fallback = 0) => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "number") return isNaN(val) ? fallback : val;
  const str = String(val).trim().replace(/[₡$]/g, "").trim();
  const clean = str.replace(/,/g, "");
  const num = parseFloat(clean);
  return isNaN(num) ? fallback : num;
};

// --- Catálogo y Compras Iniciales (Vacíos por defecto - Carga 100% desde Google Sheets) ---
const SEED_PRODUCTS = [];
const SEED_PURCHASES = [];

// --- Estado Global ---
let state = {
  productos: {}, // Mapa por código { "WHI-001": {...} }
  compras: [],
  ventas: [],
  movimientosDinero: [],
  colaSincronizacion: [], // Cola persistente para operaciones sin internet
  carrito: [],
  listaCompraActual: [], // Carrito de compras multi-producto
  // --- Maestro de Clientes, Pedidos y Cuentas ---
  clientes: {}, // Mapa por ID { "CLI-xxx": { id, nombre, telefono, puntos, fechaRegistro, ultimaVenta } }
  clienteSeleccionado: null, // cliente activo en la venta actual
  descuentoPuntosAplicado: 0, // descuento en CRC aplicado de puntos en la venta actual
  pedidos: [], // Lista de pedidos / encargos de clientes
  cuentas: [], // Lista de cuentas pendientes (Por Cobrar / Por Pagar)
  anulaciones: [], // Historial informativo de ventas anuladas
  liquidaciones: [], // Historial de comisiones liquidadas a preventistas
  filtroPreventaComision: "todos", // "todos" o nombre del preventista
  filtroCuentas: "",
  filtroTipoCuenta: "Por Cobrar", // "Por Cobrar" | "Por Pagar" | "todos"
  modoPOS: "venta", // "venta" | "pedido"
  config: {
    sheetsUrl: "",
    tipoCambio: 520,
    nombreNegocio: "DC El Destape",
    telefonoNegocio: "+506 8992-7936",
    // Configuración del sistema de puntos de fidelización (Predefinidos)
    puntosRazonCRC: 20,        // cada ₡20 = 1 punto
    puntosValorCRC: 1,         // 1 punto = ₡1 de descuento
    puntosMinimosCanje: 4000   // mínimo 4000 puntos para poder canjear
  },
  vendedorActual: "Carlos", // "Carlos" | "Daniel"
  vistaVendedor: "Carlos",   // "Carlos" | "Daniel" | "Consolidado"
  vendedores: ["Carlos", "Daniel"],
  filtroFinanzas: "todos",  // "todos" | "Empresa" | "Carlos" | "Daniel"
  categoriaSeleccionada: "Todas",
  filtroEstadoStock: "todos", // "todos" | "constock" | "agotados"
  ordenActual: "az",
  metodoPagoSeleccionado: "Efectivo",
  escanerActivo: null,
  modoEscaner: "buscar",
  ultimaVentaCompletada: null,
  ultimoPedidoCompletado: null,
  // Filtro para la vista de clientes
  filtroClientes: ""
};

// ==========================================================================
// INICIALIZACIÓN
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  cargarEstadoLocal();
  comprobarLoginVendedor();
  aplicarConfiguracionUI();
  inicializarIconos();
  actualizarIndicadorOffline();
  renderizarTodo();

  // Registrar Service Worker PWA para soporte Offline-First (solo en http:// o https://)
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.protocol === 'http:')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update();
    }).catch(() => {});
  }

  // Detectores de conexión en tiempo real
  window.addEventListener('online', () => {
    actualizarIndicadorOffline();
    if (state.colaSincronizacion && state.colaSincronizacion.length > 0) {
      mostrarToast(`Conexión recuperada. Sincronizando ${state.colaSincronizacion.length} cambios pendientes... 🌐`, "info");
      procesarColaSincronizacion(false);
    } else if (state.config.sheetsUrl) {
      sincronizarConSheets(false);
    }
  });

  window.addEventListener('offline', () => {
    actualizarIndicadorOffline();
    mostrarToast("Modo Offline activo (sin internet). Todo se guarda en tu teléfono 💾", "info");
  });

  // Procesar cola pendiente o sincronizar al abrir la app
  if (state.config.sheetsUrl && navigator.onLine) {
    if (state.colaSincronizacion && state.colaSincronizacion.length > 0) {
      procesarColaSincronizacion(false);
    } else {
      sincronizarConSheets(false);
    }
  }
});

function inicializarIconos() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    } else {
      setTimeout(() => {
        if (window.lucide && typeof window.lucide.createIcons === "function") {
          window.lucide.createIcons();
        }
      }, 100);
    }
  } catch (e) {
    console.warn("Lucide icons init:", e);
  }
}

// ==========================================================================
// GESTIÓN DE VENDEDORES (CARLOS Y DANIEL)
// ==========================================================================
function comprobarLoginVendedor() {
  // Siempre solicitar selección obligatoria de vendedor al ingresar a la app
  abrirModalSeleccionVendedor(true);
}

function abrirModalSeleccionVendedor(forzado = false) {
  const modal = document.getElementById("modalLoginVendedor");
  const btnCerrar = document.getElementById("btnCerrarLoginVendedor");
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

function cerrarModalLoginVendedor() {
  const modal = document.getElementById("modalLoginVendedor");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function seleccionarVendedorLogin(vendedor) {
  if (vendedor === "Consolidado") {
    state.vistaVendedor = "Consolidado";
  } else {
    state.vendedorActual = vendedor;
    state.vistaVendedor = vendedor;
  }
  localStorage.setItem("inv_vista_vendedor", state.vistaVendedor);

  actualizarUIVendedor();
  cerrarModalLoginVendedor();
  renderizarTodo();
  mostrarToast(`¡Bienvenido! Perfil activo: ${vendedor === "Consolidado" ? "Consolidado (Total)" : vendedor} 👤`, "success");
}

function cambiarVistaVendedor(vista) {
  state.vistaVendedor = vista;
  if (vista !== "Consolidado") {
    state.vendedorActual = vista;
  }
  localStorage.setItem("inv_vista_vendedor", vista);
  actualizarUIVendedor();
  renderizarDashboard();
  renderizarInventario();
}

function actualizarUIVendedor() {
  const labelHeader = document.getElementById("headerVendedorNombre");
  if (labelHeader) labelHeader.textContent = state.vistaVendedor === "Consolidado" ? "Consolidado" : state.vendedorActual;

  const posVendedor = document.getElementById("posVendedorNombre");
  if (posVendedor) posVendedor.textContent = state.vendedorActual;

  const compraVendSelect = document.getElementById("compraVendedor");
  if (compraVendSelect) compraVendSelect.value = state.vendedorActual;

  const labelInv = document.getElementById("inventarioVendedorLabel");
  if (labelInv) labelInv.textContent = state.vistaVendedor === "Consolidado" ? "Consolidado (Total)" : `Vendedor ${state.vistaVendedor}`;

  // Tabs styling for both Inventario and Dashboard tabs
  ["Carlos", "Daniel", "Consolidado"].forEach(v => {
    const btnInv = document.getElementById(`tabVendedor-${v}`);
    const btnDash = document.getElementById(`dashTabVendedor-${v}`);
    [btnInv, btnDash].forEach(btn => {
      if (btn) {
        if (state.vistaVendedor === v) {
          btn.className = "py-2 rounded-xl bg-indigo-600 text-white shadow-md flex items-center justify-center gap-1 active:scale-95 transition-all";
        } else {
          btn.className = "py-2 rounded-xl bg-transparent text-slate-400 hover:text-white flex items-center justify-center gap-1 active:scale-95 transition-all";
        }
      }
    });
  });
}

// ==========================================================================
// PERSISTENCIA LOCAL Y COSTOS DERIVADOS
// ==========================================================================
function cargarEstadoLocal() {
  const cfg = localStorage.getItem("inv_config_v2");
  if (cfg) state.config = { ...state.config, ...JSON.parse(cfg) };

  const prods = localStorage.getItem("inv_productos_v2");
  if (prods) {
    try { state.productos = JSON.parse(prods); } catch(e) { state.productos = {}; }
  } else {
    state.productos = {};
  }

  const comps = localStorage.getItem("inv_compras_v2");
  if (comps) {
    try { state.compras = JSON.parse(comps); } catch(e) { state.compras = []; }
  } else {
    state.compras = [];
  }

  const vts = localStorage.getItem("inv_ventas_v2");
  if (vts) state.ventas = JSON.parse(vts);

  const peds = localStorage.getItem("inv_pedidos_v2");
  if (peds) {
    try { state.pedidos = JSON.parse(peds); } catch(e) { state.pedidos = []; }
  }

  const fin = localStorage.getItem("inv_finanzas_v2");
  if (fin) state.movimientosDinero = JSON.parse(fin);

  const cola = localStorage.getItem("inv_sync_queue_v2");
  if (cola) {
    try {
      state.colaSincronizacion = JSON.parse(cola);
    } catch(e) {
      state.colaSincronizacion = [];
    }
  }

  const cli = localStorage.getItem("inv_clientes_v2");
  if (cli) {
    try { state.clientes = JSON.parse(cli); } catch(e) { state.clientes = {}; }
  }

  const ctas = localStorage.getItem("inv_cuentas_v2");
  if (ctas) {
    try { state.cuentas = JSON.parse(ctas); } catch(e) { state.cuentas = []; }
  }

  const anuls = localStorage.getItem("inv_anulaciones_v2");
  if (anuls) {
    try { state.anulaciones = JSON.parse(anuls); } catch(e) { state.anulaciones = []; }
  }

  const liqs = localStorage.getItem("inv_liquidaciones_v2");
  if (liqs) {
    try { state.liquidaciones = JSON.parse(liqs); } catch(e) { state.liquidaciones = []; }
  }

  const savedVista = localStorage.getItem("inv_vista_vendedor");
  if (savedVista) {
    state.vistaVendedor = savedVista;
    if (savedVista !== "Consolidado") state.vendedorActual = savedVista;
  }
}

function guardarProductosLocal() {
  localStorage.setItem("inv_productos_v2", JSON.stringify(state.productos));
}
function guardarComprasLocal() {
  localStorage.setItem("inv_compras_v2", JSON.stringify(state.compras));
}
function guardarVentasLocal() {
  localStorage.setItem("inv_ventas_v2", JSON.stringify(state.ventas));
}
function guardarPedidosLocal() {
  localStorage.setItem("inv_pedidos_v2", JSON.stringify(state.pedidos));
}
function guardarCuentasLocal() {
  localStorage.setItem("inv_cuentas_v2", JSON.stringify(state.cuentas));
}
function guardarAnulacionesLocal() {
  localStorage.setItem("inv_anulaciones_v2", JSON.stringify(state.anulaciones));
}
function guardarLiquidacionesLocal() {
  localStorage.setItem("inv_liquidaciones_v2", JSON.stringify(state.liquidaciones || []));
}
function guardarFinanzasLocal() {
  localStorage.setItem("inv_finanzas_v2", JSON.stringify(state.movimientosDinero));
}
function guardarColaLocal() {
  localStorage.setItem("inv_sync_queue_v2", JSON.stringify(state.colaSincronizacion));
  actualizarIndicadorOffline();
}
function guardarConfiguracionLocal() {
  localStorage.setItem("inv_config_v2", JSON.stringify(state.config));
}
function guardarClientesLocal() {
  localStorage.setItem("inv_clientes_v2", JSON.stringify(state.clientes));
}

// --- Cálculos de Stock Separado por Vendedor y Consolidado ---
function calcularStockDetalladoPorCodigo() {
  const detalle = {};
  
  // 1. Inicializar mapa con todos los productos del catálogo
  Object.values(state.productos).forEach(p => {
    const cod = String(p.codigo || "").trim().toUpperCase();
    if (!cod) return;
    const init = 0; // Stock se calcula 100% desde compras - ventas; ignorar Stock_Actual de Sheets
    detalle[cod] = {
      Carlos: 0,
      Daniel: 0,
      total: 0
    };
  });

  // 2. Sumar compras por vendedor
  state.compras.forEach(c => {
    const vend = String(c.vendedor || "Carlos").trim();
    const codPrincipal = String(c.codigo || "").trim().toUpperCase();
    
    // Si la compra tiene items[] anidados
    if (c.items && Array.isArray(c.items) && c.items.length > 0) {
      c.items.forEach(ci => {
        const ciCod = String(ci.codigo || codPrincipal).trim().toUpperCase();
        if (!ciCod) return;
        if (!detalle[ciCod]) detalle[ciCod] = { Carlos: 0, Daniel: 0, total: 0 };
        const cant = parseNum(ci.cantidad, 0);
        const itemVend = String(ci.vendedor || vend).trim();
        if (itemVend === "Daniel") {
          detalle[ciCod].Daniel += cant;
        } else {
          detalle[ciCod].Carlos += cant;
        }
        detalle[ciCod].total += cant;
      });
    } else if (codPrincipal) {
      if (!detalle[codPrincipal]) detalle[codPrincipal] = { Carlos: 0, Daniel: 0, total: 0 };
      const cant = parseNum(c.cantidad, 0);
      if (vend === "Daniel") {
        detalle[codPrincipal].Daniel += cant;
      } else {
        detalle[codPrincipal].Carlos += cant;
      }
      detalle[codPrincipal].total += cant;
    }
  });

  // 3. Restar ventas por vendedor
  state.ventas.forEach(v => {
    const vend = String(v.vendedor || "Carlos").trim();
    let items = [];
    if (v.items && Array.isArray(v.items)) {
      items = v.items;
    } else if (typeof v.items === "string") {
      try { items = JSON.parse(v.items); } catch(e) { items = []; }
    } else if (v.codigo) {
      items = [{ codigo: v.codigo, cantidad: v.cantidad, inventarioVendedor: v.inventarioVendedor || vend }];
    }

    items.forEach(i => {
      const cod = String(i.codigo || "").trim().toUpperCase();
      if (!cod) return;
      if (!detalle[cod]) detalle[cod] = { Carlos: 0, Daniel: 0, total: 0 };
      const cant = parseNum(i.cantidad, 0);
      const vendInv = String(i.inventarioVendedor || vend).trim();
      if (vendInv === "Daniel") {
        detalle[cod].Daniel -= cant;
      } else {
        detalle[cod].Carlos -= cant;
      }
      detalle[cod].total -= cant;
    });
  });

  return detalle;
}

function calcularStockPorCodigo(vista = state.vistaVendedor) {
  const det = calcularStockDetalladoPorCodigo();
  const mapa = {};
  Object.keys(det).forEach(cod => {
    if (vista === "Carlos") {
      mapa[cod] = det[cod].Carlos;
    } else if (vista === "Daniel") {
      mapa[cod] = det[cod].Daniel;
    } else {
      mapa[cod] = det[cod].total;
    }
  });
  return mapa;
}

function calcularCostosPorCodigo(vista = state.vistaVendedor) {
  const acc = {};
  const tcConfig = parseNum(state.config.tipoCambio, 520) || 520;

  state.compras.forEach(p => {
    const vend = String(p.vendedor || "Carlos").trim();
    if (vista === "Carlos" && vend !== "Carlos") return;
    if (vista === "Daniel" && vend !== "Daniel") return;

    const itemsAProcesar = (p.items && Array.isArray(p.items) && p.items.length > 0)
      ? p.items
      : [{
          codigo: p.codigo,
          cantidad: p.cantidad,
          costoUnitarioUSD: p.costoUnitarioUSD,
          costoUnitarioCRC: p.costoUnitarioCRC,
          tipoCambio: p.tipoCambio
        }];

    itemsAProcesar.forEach(item => {
      const cod = String(item.codigo || "").trim().toUpperCase();
      if (!cod) return;

      const cant = parseNum(item.cantidad, 0);
      if (cant <= 0) return;

      const tc = parseNum(item.tipoCambio || p.tipoCambio || tcConfig, 520) || 520;
      let cuUSD = parseNum(item.costoUnitarioUSD, 0);
      let cuCRC = parseNum(item.costoUnitarioCRC, 0);

      // Conversión bi-monetaria automática si falta una de las monedas
      if (cuUSD === 0 && cuCRC > 0) cuUSD = cuCRC / tc;
      if (cuCRC === 0 && cuUSD > 0) cuCRC = cuUSD * tc;

      if (!acc[cod]) acc[cod] = { cant: 0, totalUSD: 0, totalCRC: 0 };
      acc[cod].cant += cant;
      acc[cod].totalUSD += cant * cuUSD;
      acc[cod].totalCRC += cant * cuCRC;
    });
  });

  const out = {};
  Object.keys(acc).forEach(c => {
    const cUSD = acc[c].cant > 0 ? acc[c].totalUSD / acc[c].cant : 0;
    const cCRC = acc[c].cant > 0 ? acc[c].totalCRC / acc[c].cant : 0;
    out[c] = {
      usd: cUSD > 0 ? cUSD : (cCRC > 0 ? cCRC / tcConfig : 0),
      crc: cCRC > 0 ? cCRC : (cUSD > 0 ? cUSD * tcConfig : 0),
      fuente: "compras"
    };
  });

  Object.values(state.productos).forEach(p => {
    const cod = String(p.codigo || "").trim().toUpperCase();
    if (!cod) return;
    const refUSD = parseNum(p.costoRefUSD, 0);
    const refCRC = parseNum(p.costoRefCRC, 0);

    if (!out[cod] || (out[cod].usd === 0 && out[cod].crc === 0)) {
      if (refUSD > 0 || refCRC > 0) {
        out[cod] = {
          usd: refUSD > 0 ? refUSD : (refCRC > 0 ? refCRC / tcConfig : 0),
          crc: refCRC > 0 ? refCRC : (refUSD > 0 ? refUSD * tcConfig : 0),
          fuente: "referencia"
        };
      }
    }
  });

  return out;
}

// ==========================================================================
// NAVEGACIÓN Y VISTAS
// ==========================================================================
function cambiarVista(vista) {
  const vistas = ["dashboard", "inventario", "ventas", "compras", "finanzas", "configuracion", "clientes", "cuentas", "comisiones"];
  
  vistas.forEach(v => {
    const el = document.getElementById("view" + capitalizar(v));
    const nav = document.getElementById("navTab-" + v);
    if (el) {
      if (v === vista) {
        el.classList.remove("hidden");
        el.classList.add("active-view");
        if (nav) nav.classList.add("active");
      } else {
        el.classList.add("hidden");
        el.classList.remove("active-view");
        if (nav) nav.classList.remove("active");
      }
    }
  });

  const accesosPrincipales = ["dashboard", "inventario", "ventas", "clientes"];
  const navMas = document.getElementById("navTab-mas");
  if (navMas) navMas.classList.toggle("active", !accesosPrincipales.includes(vista));

  if (vista === "dashboard") renderizarDashboard();
  if (vista === "inventario") renderizarInventario();
  if (vista === "compras") poblarSelectCompras();
  if (vista === "ventas") renderizarCarrito();
  if (vista === "finanzas") renderizarFinanzas();
  if (vista === "clientes") renderizarClientes();
  if (vista === "cuentas") renderizarCuentas();
  if (vista === "comisiones") renderizarModuloComisiones();
  if (vista === "configuracion") {
    cargarConfigPuntosUI();
    const surl = document.getElementById("sheetsApiUrl");
    if (surl && state.config.sheetsApiUrl) surl.value = state.config.sheetsApiUrl;
    const bname = document.getElementById("businessNameInput");
    if (bname && state.config.nombreNegocio) bname.value = state.config.nombreNegocio;
    const tc = document.getElementById("exchangeRateInput");
    if (tc && state.config.tipoCambio) tc.value = state.config.tipoCambio;
    const ph = document.getElementById("businessPhoneInput");
    if (ph && state.config.telefonoNegocio) ph.value = state.config.telefonoNegocio;
    renderizarModuloAnulaciones();
  }

  inicializarIconos();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function abrirMenuMas() {
  const modal = document.getElementById("modalMenuMas");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();
}

function cerrarMenuMas() {
  const modal = document.getElementById("modalMenuMas");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function irDesdeMenuMas(vista) {
  cerrarMenuMas();
  cambiarVista(vista);
}

function capitalizar(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==========================================================================
// RENDERIZADO GENERAL
// ==========================================================================
function renderizarTodo() {
  aplicarConfiguracionUI();
  renderizarDashboard();
  renderizarInventario();
  poblarSelectCompras();
  renderizarHistorialCompras();
  renderizarCarrito();
  renderizarFinanzas();
  renderizarClientes();
  renderizarCuentas();
  renderizarHistorialAnulaciones();
  renderizarModuloComisiones();
  inicializarIconos();
}

function aplicarConfiguracionUI() {
  document.getElementById("appHeaderTitle").textContent = state.config.nombreNegocio || "Libro de Inventario";
  document.getElementById("headerExchangeRate").textContent = state.config.tipoCambio;

  const inputUrl = document.getElementById("sheetsApiUrl");
  if (inputUrl) inputUrl.value = state.config.sheetsUrl || "";

  const inputName = document.getElementById("businessNameInput");
  if (inputName) inputName.value = state.config.nombreNegocio || "Libro de Inventario";

  const inputTC = document.getElementById("exchangeRateInput");
  if (inputTC) inputTC.value = state.config.tipoCambio || 520;

  const inputPhone = document.getElementById("businessPhoneInput");
  if (inputPhone) inputPhone.value = state.config.telefonoNegocio || "";

  const inputCompraTC = document.getElementById("compraTipoCambio");
  if (inputCompraTC) inputCompraTC.value = state.config.tipoCambio || 520;

  const inputCompraFecha = document.getElementById("compraFecha");
  if (inputCompraFecha && !inputCompraFecha.value) inputCompraFecha.value = todayStr();

  actualizarBadgeConexion();
}

// ==========================================================================
// 1. DASHBOARD
// ==========================================================================
function renderizarDashboard() {
  const vista = state.vistaVendedor || "Consolidado";
  const stockMap = calcularStockPorCodigo(vista);
  const costMap = calcularCostosPorCodigo(vista);
  const tc = parseNum(state.config.tipoCambio, 520) || 520;

  // Actualizar subtítulo en el banner si existe
  const bannerSub = document.getElementById("dashBannerSubtitle");
  if (bannerSub) {
    bannerSub.innerHTML = vista === "Consolidado"
      ? `Control Ejecutivo • <span class="text-amber-300 font-bold">Consolidado Total</span> (Carlos & Daniel)`
      : `Vista Individual • Vendedor <span class="${vista === 'Daniel' ? 'text-violet-400' : 'text-blue-400'} font-bold">${vista}</span>`;
  }

  let costoUSD = 0, costoCRC = 0;
  let ventaUSD = 0, ventaCRC = 0;
  let totalUnidades = 0;
  let prodsConStock = 0;
  let sinExistencia = [];

  Object.values(state.productos).forEach(p => {
    const cod = String(p.codigo || "").trim().toUpperCase();
    const st = parseNum(stockMap[cod] !== undefined ? stockMap[cod] : stockMap[p.codigo], 0);

    if (st > 0) {
      prodsConStock++;
      totalUnidades += st;

      // Costo unitario
      const c = costMap[cod] || costMap[p.codigo] || { usd: 0, crc: 0 };
      let cuUSD = parseNum(c.usd, 0);
      let cuCRC = parseNum(c.crc, 0);

      // Conversión automática bi-monetaria si falta una moneda
      if (cuUSD === 0 && cuCRC > 0) cuUSD = cuCRC / tc;
      if (cuCRC === 0 && cuUSD > 0) cuCRC = cuUSD * tc;

      // Fallback a costos de referencia si compras dio 0
      if (cuUSD === 0 && cuCRC === 0) {
        const refUSD = parseNum(p.costoRefUSD, 0);
        const refCRC = parseNum(p.costoRefCRC, 0);
        cuUSD = refUSD > 0 ? refUSD : (refCRC > 0 ? refCRC / tc : 0);
        cuCRC = refCRC > 0 ? refCRC : (refUSD > 0 ? refUSD * tc : 0);
      }

      costoUSD += st * cuUSD;
      costoCRC += st * cuCRC;

      // Precio venta unitario con conversión bi-moneda
      let pvUSD = parseNum(p.precioVentaUSD, 0);
      let pvCRC = parseNum(p.precioVentaCRC, 0);
      if (pvUSD === 0 && pvCRC > 0) pvUSD = pvCRC / tc;
      if (pvCRC === 0 && pvUSD > 0) pvCRC = pvUSD * tc;

      ventaUSD += st * pvUSD;
      ventaCRC += st * pvCRC;
    } else {
      sinExistencia.push(p);
    }
  });

  const margenUSD = ventaUSD - costoUSD;
  const margenCRC = ventaCRC - costoCRC;

  document.getElementById("dashCostoUSD").textContent = fmtUSD(costoUSD);
  document.getElementById("dashCostoCRC").textContent = fmtCRC(costoCRC);
  document.getElementById("dashVentaUSD").textContent = fmtUSD(ventaUSD);
  document.getElementById("dashVentaCRC").textContent = fmtCRC(ventaCRC);
  document.getElementById("dashMargenUSD").textContent = fmtUSD(margenUSD);
  document.getElementById("dashMargenCRC").textContent = fmtCRC(margenCRC);

  document.getElementById("dashTotalUnidades").textContent = fmtNum(totalUnidades);
  document.getElementById("dashProdsConStock").textContent = `${prodsConStock} de ${Object.keys(state.productos).length}`;

  // --- Resumen de Cuentas Pendientes en Dashboard (Por Cobrar y Por Pagar) filtradas por vista ---
  let totCobrarBrutoCRC = 0;
  let totCobrarNetoCRC = 0;
  let totEnvioCxcCRC = 0;
  let totPagarCRC = 0;
  (state.cuentas || []).forEach(cta => {
    if (vista !== "Consolidado") {
      const vendCta = String(cta.vendedor || cta.socio || cta.registradoPor || "Carlos").trim();
      if (vendCta !== vista) return;
    }
    const saldo = parseNum(cta.saldoPendienteCRC, 0);
    if ((cta.estado || "Pendiente") !== "Pagado" && saldo > 0) {
      if (cta.tipo === "Por Cobrar") {
        const datosEnv = obtenerDatosEnvioCuenta(cta);
        totCobrarBrutoCRC += datosEnv.valorClienteCRC;
        totCobrarNetoCRC += datosEnv.valorNetoCRC;
        totEnvioCxcCRC += datosEnv.envioPendienteCRC;
      } else {
        totPagarCRC += saldo;
      }
    }
  });

  const dashCobrarEl = document.getElementById("dashCobrarCRC");
  const dashCobrarNetoEl = document.getElementById("dashCobrarNetoSub");
  const dashPagarEl = document.getElementById("dashPagarCRC");

  if (dashCobrarEl) dashCobrarEl.textContent = fmtCRC(totCobrarBrutoCRC);
  if (dashCobrarNetoEl) {
    if (totEnvioCxcCRC > 0) {
      dashCobrarNetoEl.innerHTML = `<span class="text-slate-400">Neto sin envíos:</span> <b class="text-emerald-300 font-mono">${fmtCRC(totCobrarNetoCRC)}</b>`;
    } else {
      dashCobrarNetoEl.innerHTML = "";
    }
  }
  if (dashPagarEl) dashPagarEl.textContent = fmtCRC(totPagarCRC);

  // --- Pedidos Pendientes de Clientes (filtrados por vista) ---
  renderizarConsolidadoPedidosDashboard();

  // Últimas ventas / movimientos filtrados por la vista activa
  const recentCont = document.getElementById("dashRecentSales");
  let ventasFiltradas = state.ventas || [];
  if (vista !== "Consolidado") {
    ventasFiltradas = ventasFiltradas.filter(v => String(v.vendedor || "Carlos").trim() === vista);
  }

  if (ventasFiltradas.length === 0) {
    recentCont.innerHTML = `<div class="text-center py-5 text-slate-500 text-xs">No hay ventas registradas aún para ${vista === "Consolidado" ? "la empresa" : vista}.</div>`;
  } else {
    const ultimas = ventasFiltradas.slice(0, 10);
    recentCont.innerHTML = ultimas.map((v, idx) => {
      const fecha = v.fecha ? new Date(v.fecha).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "";
      const vend = v.vendedor || "Carlos";
      const vendColor = vend === "Daniel" ? "text-violet-400 bg-violet-950/60 border-violet-500/30" : "text-blue-400 bg-blue-950/60 border-blue-500/30";
      const totCRC = parseNum(v.totalCRC !== undefined ? v.totalCRC : v.totalFinalCRC, 0);
      const totUSD = parseNum(v.totalUSD, 0);
      const envioCRC = parseNum(v.costoEnvioCRC, 0);
      const envioUSD = parseNum(v.costoEnvioUSD, 0);
      const vCod = v.codigo || (v.items && v.items[0] ? v.items[0].codigo : '') || '';
      const vUid = v.id ? `${v.id}_${vCod}_${idx}` : `VTA_ROW_${idx}`;
      const esPagoLuego = String(v.metodoPago || "").toLowerCase().includes("luego") || String(v.metodoPago || "").toLowerCase().includes("crédito");
      const originalIdx = state.ventas.indexOf(v);

      // Buscar si existe una cuenta asociada a ESTE movimiento específico
      const cuentaAsociada = (state.cuentas || []).find(cta => 
        cta.tipo === "Por Cobrar" && (
          cta.referenciaId === vUid ||
          (v.id && cta.referenciaId === v.id) ||
          (cta.referenciaId && v.id && cta.referenciaId.startsWith(`${v.id}_${vCod}`))
        )
      );

      // Determinar estado real de la cuenta
      let estadoBadgeHtml = '';
      if (cuentaAsociada) {
        const est = cuentaAsociada.estado || "Pendiente";
        if (est === "Pagado") {
          estadoBadgeHtml = `<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">✅ Liquidada</span>`;
        } else if (est === "Parcial") {
          estadoBadgeHtml = `<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300">⏳ Abono Parcial</span>`;
        } else {
          estadoBadgeHtml = `<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-950/80 border border-rose-500/40 text-rose-300">🕒 Por Cobrar</span>`;
        }
      } else if (esPagoLuego) {
        estadoBadgeHtml = `<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300">🕒 Pago Luego</span>`;
      }

      return `
        <div class="py-2.5 flex items-center justify-between border-b border-slate-800/60 last:border-0 gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span class="text-[9px] font-bold px-1.5 py-0.2 rounded border ${vendColor}">👤 ${vend}</span>
              <span class="text-xs font-bold text-white truncate max-w-[150px]">${v.cliente || "Venta General"}</span>
              ${estadoBadgeHtml}
            </div>
            <div class="text-[11px] text-slate-400 font-mono">
              ${fecha} • ${v.nombre ? `${v.nombre} (${v.cantidad || 1}x)` : `${v.items ? v.items.length : 1} prod(s)`} <span class="text-[10px] text-slate-500">(${v.metodoPago || "Efectivo"})</span>
            </div>
            ${v.items && v.items.some(it => it.inventarioVendedor && it.inventarioVendedor !== vend) ? `
              <div class="mt-1 flex flex-wrap gap-1">
                ${v.items.filter(it => it.inventarioVendedor && it.inventarioVendedor !== vend).map(it => `
                  <span class="text-[9px] font-bold px-1.5 py-0.2 rounded border bg-amber-950/70 border-amber-500/40 text-amber-300">
                    📦 ${it.cantidad}x ${it.nombre || it.codigo}: Stock de ${it.inventarioVendedor}
                  </span>
                `).join('')}
              </div>
            ` : ''}
            ${envioCRC > 0 ? `
              <div class="text-[10px] text-amber-300 font-mono mt-1 bg-amber-950/60 border border-amber-500/40 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                <span>🚚</span>
                <span>En factura <b>${v.id || 'N/A'}</b> se pagó el monto de flete o envío: <b>${fmtCRC(envioCRC)}</b>${envioUSD > 0 ? ` (${fmtUSD(envioUSD)})` : ''}</span>
              </div>
            ` : ''}
            ${v.pedidoOrigenId ? `
              <div class="mt-1 flex flex-wrap gap-1">
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-sky-950/70 border-sky-500/40 text-sky-300">
                  📋 Pedido: ${v.pedidoOrigenId}
                </span>
                ${v.pedidoOrigenVendedor ? `
                  <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-indigo-950/70 border-indigo-500/40 text-indigo-300">
                    🙋 Tomó: ${v.pedidoOrigenVendedor}
                  </span>
                ` : ''}
                ${v.facturadoPor && v.facturadoPor !== v.vendedor ? `
                  <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-emerald-950/70 border-emerald-500/40 text-emerald-300">
                    🧾 Facturó: ${v.facturadoPor}
                  </span>
                ` : ''}
              </div>
            ` : ''}
          </div>
          <div class="text-right font-mono shrink-0 space-y-0.5">
            <div class="text-xs font-black text-emerald-400">${fmtCRC(totCRC)}</div>
            <div class="text-[10px] text-slate-400">${fmtUSD(totUSD)}</div>
            <div class="pt-0.5">
              ${!cuentaAsociada && !esPagoLuego ? `
                <button onclick="pasarVentaIndividualACuentasPorCobrar(${originalIdx !== -1 ? originalIdx : idx})" title="Pasar a Cuentas por Cobrar" class="text-[9.5px] font-bold px-2 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900 border border-amber-500/40 text-amber-300 active:scale-95 transition-all">
                  + Cta Cobrar
                </button>
              ` : (cuentaAsociada && cuentaAsociada.estado === "Pagado" ? `
                <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-300">Cobrado</span>
              ` : `
                <button onclick="cambiarVista('cuentas')" title="Ver en Cuentas por Cobrar" class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-950/60 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-300 active:scale-95 transition-all">
                  Ver Cuenta
                </button>
              `)}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }
}

// ==========================================================================
// RENDERIZAR CONSOLIDADO DE PEDIDOS EN EL DASHBOARD
// ==========================================================================
function renderizarConsolidadoPedidosDashboard() {
  const container = document.getElementById("dashPedidosContainer");
  const badge = document.getElementById("dashPedidosBadge");
  const consolidadoLista = document.getElementById("dashConsolidadoLista");
  const pedidosList = document.getElementById("dashPedidosList");
  if (!container || !consolidadoLista || !pedidosList) return;

  const vista = state.vistaVendedor || "Consolidado";
  const vendedoresPropios = ["Carlos", "Daniel"]; // Vendedores de la app principal
  let pedidosPendientes = (state.pedidos || []).filter(p => {
    const est = String(p.estado || "pendiente").trim().toLowerCase();
    return est === "pendiente" || !est;
  });
  if (vista !== "Consolidado") {
    // Mostrar: pedidos del vendedor seleccionado + pedidos de colaboradores externos (preventa)
    // Los pedidos externos siempre se muestran para que Carlos/Daniel los puedan atender
    pedidosPendientes = pedidosPendientes.filter(p => {
      const vend = String(p.vendedor || "Carlos").trim();
      return vend.toLowerCase() === vista.toLowerCase() || !vendedoresPropios.some(vp => vp.toLowerCase() === vend.toLowerCase());
    });
  }

  if (pedidosPendientes.length === 0) {
    badge.textContent = "0 pendientes";
    badge.className = "text-[11px] font-bold font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700";
    consolidadoLista.innerHTML = `
      <div class="py-3 text-center text-xs text-slate-400 font-sans">
        ✨ No hay pedidos pendientes de clientes. Todo al día.
      </div>
    `;
    pedidosList.innerHTML = `
      <div class="py-2 text-center text-[11px] text-slate-500 font-sans">
        Usa el modo <b>"Encargo / Pedido"</b> en el TPV para registrar solicitudes.
      </div>
    `;
    return;
  }

  badge.textContent = `${pedidosPendientes.length} pendiente(s)`;
  badge.className = "text-[11px] font-bold font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30";

  // 1. Agrupar productos solicitados (Consolidado de botellas)
  const mapaConsolidado = {};
  pedidosPendientes.forEach(ped => {
    (ped.items || []).forEach(it => {
      const cod = it.codigo || it.nombre;
      if (!mapaConsolidado[cod]) {
        mapaConsolidado[cod] = {
          codigo: it.codigo,
          nombre: it.nombre,
          cantidad: 0
        };
      }
      mapaConsolidado[cod].cantidad += Number(it.cantidad || 1);
    });
  });

  const consolidadoArray = Object.values(mapaConsolidado);
  consolidadoLista.innerHTML = consolidadoArray.map(item => `
    <div class="py-1.5 flex items-center justify-between">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-black text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded-lg border border-amber-500/40 text-xs shrink-0">${item.cantidad}x</span>
        <span class="text-xs font-bold text-white truncate">${item.nombre}</span>
      </div>
      <span class="text-[10px] text-slate-400 font-mono shrink-0">${item.codigo}</span>
    </div>
  `).join("");

  // 2. Renderizar lista detallada de pedidos por cliente
  pedidosList.innerHTML = pedidosPendientes.map(ped => {
    const fecha = ped.fecha ? new Date(ped.fecha).toLocaleDateString("es-CR", { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : "";
    const itemsLineas = (ped.items || []).map(i => `<div class="flex justify-between"><span>${i.cantidad}x ${i.nombre}</span></div>`).join("");
    let totalBotellasPed = 0;
    (ped.items || []).forEach(i => totalBotellasPed += Number(i.cantidad || 1));
    const vendedoresPropios = ["Carlos", "Daniel"];
    const esExterno = !vendedoresPropios.includes(String(ped.vendedor || "Carlos").trim());

    return `
      <div class="bg-slate-950/70 border border-slate-800 rounded-xl overflow-hidden">
        <!-- Cabecera: Cliente + Fecha -->
        <div class="px-3 pt-2.5 pb-1.5 flex items-start justify-between gap-2 border-b border-slate-800/60">
          <div class="min-w-0">
            <span class="text-sm font-bold text-white block leading-tight">${ped.cliente || 'Cliente General'}</span>
            ${ped.clienteTelefono ? `<span class="text-[11px] text-amber-400/80 font-mono">📞 ${ped.clienteTelefono}</span>` : ''}
          </div>
          <span class="text-[10px] text-slate-400 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 font-mono shrink-0 text-right leading-tight">${fecha}</span>
        </div>

        <!-- Ítems -->
        <div class="px-3 py-2 text-[11px] text-slate-300 font-mono space-y-0.5 border-b border-slate-800/60">
          ${itemsLineas}
        </div>

        <!-- Totales + Quién anotó -->
        <div class="px-3 py-1.5 flex items-center justify-between border-b border-slate-800/60">
          <span class="text-[11px] text-amber-400 font-mono">
            Total: <b class="text-white">${totalBotellasPed} unids</b>
          </span>
          <span class="text-[10px] font-mono ${esExterno ? 'text-sky-400' : 'text-slate-400'}">
            ${esExterno ? '🔗 Preventa: ' : 'Anotó: '}<b>${ped.vendedor || 'Carlos'}</b>
          </span>
        </div>

        <!-- Botones de acción -->
        <div class="px-3 py-2 flex items-center gap-2">
          <button type="button" onclick="facturarPedido('${ped.id}')" class="flex-1 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-bold text-[11px] rounded-lg active:scale-95 transition-all flex items-center justify-center gap-1.5">
            <i data-lucide="receipt" class="w-3.5 h-3.5"></i>
            <span>Facturar</span>
          </button>
          <button type="button" onclick="marcarPedidoComprado('${ped.id}')" class="flex-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-bold text-[11px] rounded-lg active:scale-95 transition-all flex items-center justify-center gap-1.5">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            <span>Comprado</span>
          </button>
          <button type="button" onclick="cancelarPedido('${ped.id}')" title="Cancelar pedido" class="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg active:scale-95 transition-all shrink-0">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");



  inicializarIconos();
}

// ============================================================
// COPIAR LISTA DE PEDIDO AL PROVEEDOR
// ============================================================
function copiarPedidoProveedorTexto() {
  const pedidosPendientes = (state.pedidos || []).filter(p => p.estado === "pendiente" || !p.estado);
  if (pedidosPendientes.length === 0) {
    mostrarToast("No hay pedidos pendientes para solicitar", "info");
    return;
  }

  const mapaConsolidado = {};
  pedidosPendientes.forEach(ped => {
    (ped.items || []).forEach(it => {
      const cod = it.codigo || it.nombre;
      if (!mapaConsolidado[cod]) {
        mapaConsolidado[cod] = {
          codigo: it.codigo,
          nombre: it.nombre,
          cantidad: 0
        };
      }
      mapaConsolidado[cod].cantidad += Number(it.cantidad || 1);
    });
  });

  const negocio = state.config.nombreNegocio || "DC EL DESTAPE";
  const fecha = new Date().toLocaleDateString([], { dateStyle: 'medium' });

  let texto = `🍷 *PEDIDO CONSOLIDADO PARA PROVEEDOR* 🍷\n`;
  texto += `🏢 *${negocio.toUpperCase()}*\n`;
  texto += `📅 *Fecha:* ${fecha}\n`;
  texto += `----------------------------------------\n`;
  texto += `📦 *DETALLE DE BOTELLAS SOLICITADAS:*\n`;

  let totalBotellas = 0;
  Object.values(mapaConsolidado).forEach(item => {
    texto += `• *${item.cantidad}x* ${item.nombre} (Cod: ${item.codigo})\n`;
    totalBotellas += item.cantidad;
  });

  texto += `----------------------------------------\n`;
  texto += `📊 *TOTAL A ENCARGAR:* ${totalBotellas} unidades\n`;
  texto += `📌 *Pedidos de clientes atendidos:* ${pedidosPendientes.length}`;

  navigator.clipboard.writeText(texto).then(() => {
    mostrarToast(`📋 Lista de ${totalBotellas} botellas copiada al portapapeles`, "success");
  }).catch(() => {
    // Fallback prompt
    prompt("Copia el texto del pedido para enviar al proveedor:", texto);
  });
}

function marcarPedidoComprado(idPedido) {
  const ped = (state.pedidos || []).find(p => p.id === idPedido);
  if (!ped) return;

  ped.estado = "comprado";
  ped.fechaComprado = new Date().toISOString();
  guardarPedidosLocal();
  renderizarDashboard();
  mostrarToast(`Pedido de ${ped.cliente || 'cliente'} marcado como comprado ✅`, "success");

  // Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("marcarPedidoComprado", { id: idPedido });
}

function cancelarPedido(idPedido) {
  if (!confirm("¿Deseas eliminar este encargo?")) return;
  state.pedidos = (state.pedidos || []).filter(p => p.id !== idPedido);
  guardarPedidosLocal();
  renderizarDashboard();
  mostrarToast("Pedido eliminado", "info");

  // Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("eliminarPedido", { id: idPedido });
}

// ==========================================================================
// FACTURAR PEDIDO: Carga el pedido en el TPV y navega a Ventas
// ==========================================================================
function facturarPedido(idPedido) {
  const ped = (state.pedidos || []).find(p => p.id === idPedido);
  if (!ped) {
    mostrarToast("Pedido no encontrado.", "error");
    return;
  }

  // 1. Limpiar carrito actual
  state.carrito = [];
  state.clienteSeleccionado = null;
  state.descuentoPuntosAplicado = 0;

  // 2. Precargar ítems del pedido en el carrito
  const vendedorActual = state.vendedorActual || "Carlos";
  let algunoNoEncontrado = false;

  (ped.items || []).forEach(item => {
    const codNorm = String(item.codigo || "").trim().toUpperCase();
    const prod = state.productos[codNorm] || state.productos[item.codigo];
    if (!prod) {
      algunoNoEncontrado = true;
      return;
    }
    const pCRC = Number(prod.precioVentaCRC || 0);
    const pUSD = Number(prod.precioVentaUSD || 0);
    const cant = Number(item.cantidad || 1);
    const existing = state.carrito.find(c => String(c.codigo).trim().toUpperCase() === codNorm);
    if (existing) {
      existing.cantidad += cant;
    } else {
      state.carrito.push({
        codigo: prod.codigo,
        nombre: prod.nombre,
        imagenUrl: prod.imagenUrl || "",
        precioVentaCRC: pCRC,
        precioCRC: pCRC,
        precioOriginalCRC: pCRC,
        precioVentaUSD: pUSD,
        precioUSD: pUSD,
        costoRefUSD: Number(prod.costoRefUSD || 0),
        costoRefCRC: Number(prod.costoRefCRC || 0),
        cantidad: cant,
        stockMaximo: 9999,
        inventarioVendedor: vendedorActual
      });
    }
  });

  // 3. Preseleccionar cliente si existe en el sistema
  const clienteNombrePed = String(ped.cliente || "").trim().toLowerCase();
  const clienteEncontrado = Object.values(state.clientes || {}).find(c =>
    String(c.nombre || "").trim().toLowerCase() === clienteNombrePed
  );
  if (clienteEncontrado) {
    state.clienteSeleccionado = clienteEncontrado;
  }

  // 4. Guardar referencia al pedido que se está facturando (para trazabilidad al facturar)
  state.pedidoEnFacturacion = idPedido;
  state.pedidoOrigenVendedor = String(ped.vendedor || "").trim(); // Quién anotó el pedido original
  try {
    localStorage.setItem("inv_pedido_en_facturacion", idPedido);
    localStorage.setItem("inv_pedido_origen_vendedor", state.pedidoOrigenVendedor);
  } catch(e) {}

  // 5. Navegar a la pestaña Ventas
  cambiarVista("ventas");

  // 6. Actualizar el input del cliente en el TPV
  const clienteInput = document.getElementById("posClienteInput");
  if (clienteInput) {
    clienteInput.value = ped.cliente || "";
  }
  renderizarPanelCliente();

  if (algunoNoEncontrado) {
    mostrarToast(`⚠️ Algunos productos del pedido no se encontraron en el inventario.`, "info");
  } else {
    mostrarToast(`✅ Pedido de ${ped.cliente || 'cliente'} cargado en el TPV. Revisá y facturá cuando estés listo.`, "success");
  }
}

// ==========================================================================
// 2. INVENTARIO (PRODUCTOS)
// ==========================================================================
function filtrarEstadoStock(estado) {
  state.filtroEstadoStock = estado;
  
  const btnTodos = document.getElementById("filterStock-todos");
  const btnCon = document.getElementById("filterStock-constock");
  const btnSin = document.getElementById("filterStock-agotados");

  if (btnTodos && btnCon && btnSin) {
    btnTodos.className = estado === "todos" 
      ? "py-1.5 px-2 rounded-xl bg-indigo-600 text-white text-center border border-indigo-500/40 shadow-sm active:scale-95 transition-all"
      : "py-1.5 px-2 rounded-xl bg-slate-800 text-slate-300 text-center border border-slate-700 shadow-sm active:scale-95 transition-all";
      
    btnCon.className = estado === "constock"
      ? "py-1.5 px-2 rounded-xl bg-emerald-600 text-white text-center border border-emerald-500/40 shadow-sm active:scale-95 transition-all"
      : "py-1.5 px-2 rounded-xl bg-slate-800 text-emerald-400 text-center border border-slate-700 shadow-sm active:scale-95 transition-all";

    btnSin.className = estado === "agotados"
      ? "py-1.5 px-2 rounded-xl bg-rose-600 text-white text-center border border-rose-500/40 shadow-sm active:scale-95 transition-all"
      : "py-1.5 px-2 rounded-xl bg-slate-800 text-rose-400 text-center border border-slate-700 shadow-sm active:scale-95 transition-all";
  }

  renderizarInventario();
}

function renderizarInventario() {
  const contenedor = document.getElementById("productsList");
  const filtroTexto = (document.getElementById("searchInventory").value || "").toLowerCase().trim();
  const stockMap = calcularStockPorCodigo();
  const costMap = calcularCostosPorCodigo();

  const todosProds = Object.values(state.productos);
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
    const matchEstado = state.filtroEstadoStock === "todos" ||
      (state.filtroEstadoStock === "constock" && st > 0) ||
      (state.filtroEstadoStock === "agotados" && st <= 0);

    const matchCat = state.categoriaSeleccionada === "Todas" || p.categoria === state.categoriaSeleccionada;
    const matchTxt = !filtroTexto ||
      p.nombre.toLowerCase().includes(filtroTexto) ||
      p.codigo.toLowerCase().includes(filtroTexto) ||
      (p.categoria && p.categoria.toLowerCase().includes(filtroTexto));
    return matchEstado && matchCat && matchTxt;
  });

  // Ordenar
  if (state.ordenActual === "az") {
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
  } else if (state.ordenActual === "za") {
    lista.sort((a, b) => b.nombre.localeCompare(a.nombre));
  } else if (state.ordenActual === "stock_asc") {
    lista.sort((a, b) => (stockMap[a.codigo] || 0) - (stockMap[b.codigo] || 0));
  } else if (state.ordenActual === "stock_desc") {
    lista.sort((a, b) => (stockMap[b.codigo] || 0) - (stockMap[a.codigo] || 0));
  }

  const prodCountEl = document.getElementById("prodCount");
  if (prodCountEl) prodCountEl.textContent = lista.length;

  if (lista.length === 0) {
    const existeEnOtrasCategorias = filtroTexto ? todosProds.filter(p => 
      p.nombre.toLowerCase().includes(filtroTexto) || 
      p.codigo.toLowerCase().includes(filtroTexto)
    ) : [];

    let sugerenciaHtml = "";
    if (existeEnOtrasCategorias.length > 0 && state.categoriaSeleccionada !== "Todas") {
      const cats = Array.from(new Set(existeEnOtrasCategorias.map(x => x.categoria || "Otras"))).join(", ");
      sugerenciaHtml = `
        <div class="p-3 bg-amber-950/40 border border-amber-500/40 rounded-2xl space-y-2 mt-2">
          <p class="text-xs text-amber-200">🔍 Se encontraron <b>${existeEnOtrasCategorias.length}</b> resultado(s) en <b>${cats}</b>:</p>
          <button type="button" onclick="filtrarCategoria('Todas')" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md">
            Ver resultados en "Todas las categorías"
          </button>
        </div>
      `;
    }

    contenedor.innerHTML = `
      <div class="text-center py-10 text-slate-500 space-y-3">
        <i data-lucide="package-search" class="w-10 h-10 mx-auto text-slate-600"></i>
        <div>
          <p class="text-xs font-semibold text-slate-300">No se encontraron licores ${filtroTexto ? `para "<b>${filtroTexto}</b>"` : ''} en la categoría <span class="text-indigo-400 font-bold">${state.categoriaSeleccionada}</span>.</p>
        </div>
        ${sugerenciaHtml}
        <div class="pt-2 flex items-center justify-center gap-2">
          <button type="button" onclick="limpiarFiltrosInventario()" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl border border-slate-700 active:scale-95 transition-all">
            Limpiar Filtros
          </button>
          <button type="button" onclick="abrirModalProducto()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 active:scale-95 transition-all">
            + Agregar Licor
          </button>
        </div>
      </div>
    `;
    inicializarIconos();
    renderizarCategoriasPills();
    return;
  }

  const detailedMap = calcularStockDetalladoPorCodigo();

  contenedor.innerHTML = lista.map(p => {
    const det = detailedMap[p.codigo] || { Carlos: 0, Daniel: 0, total: 0 };
    const stockVisual = state.vistaVendedor === "Carlos" 
      ? det.Carlos 
      : (state.vistaVendedor === "Daniel" ? det.Daniel : det.total);

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

    const imgFormatted = formatearUrlImagen(p.imagenUrl);
    const hasImg = !!imgFormatted;

    return `
      <div class="bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-3 shadow-lg space-y-2.5 transition-all">
        <!-- Header: Code, Category & Stock Badge -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="font-mono text-[10px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/60 shrink-0">${p.codigo}</span>
            <span class="text-[10px] font-semibold text-slate-400 truncate">${p.categoria || 'Licor'}</span>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${stockBadgeClass} shrink-0">
            ${stockStatusText}
          </span>
        </div>

        <!-- Body: Photo + Name & Breakdown -->
        <div class="flex gap-3 items-center">
          <div class="relative w-20 h-20 rounded-2xl bg-slate-800 border border-slate-700/80 flex items-center justify-center shrink-0 overflow-hidden shadow-md cursor-pointer group foto-producto-btn" data-url="${imgFormatted || ''}" data-nombre="${p.nombre.replace(/"/g, '&quot;')}" title="Toca para ver foto completa">
            ${hasImg ? `
              <img src="${imgFormatted}" alt="${p.nombre}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.classList.remove('hidden'); this.nextElementSibling.classList.add('flex');">
              <div class="hidden flex-col items-center justify-center text-slate-500 text-[10px] w-full h-full">
                <i data-lucide="wine" class="w-7 h-7 text-slate-600"></i>
              </div>
            ` : `
              <div class="flex flex-col items-center justify-center text-slate-500 text-[10px]">
                <i data-lucide="wine" class="w-7 h-7 text-slate-600"></i>
                <span class="text-[8px] text-slate-500 mt-0.5">Sin foto</span>
              </div>
            `}
            <div class="absolute bottom-1 right-1 bg-black/60 backdrop-blur-sm rounded-md p-0.5 text-white/80 opacity-70 group-hover:opacity-100 transition-opacity">
              <i data-lucide="zoom-in" class="w-3 h-3"></i>
            </div>
          </div>

          <div class="min-w-0 flex-1">
            <h4 class="text-xs font-black text-white leading-snug cursor-pointer hover:text-indigo-300 transition-colors line-clamp-2" onclick="abrirModalProducto('${p.codigo}')">
              ${p.nombre}
            </h4>
            <div class="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-slate-400">
              <span class="text-blue-300">C: <b>${det.Carlos}</b></span>
              <span class="text-slate-600">|</span>
              <span class="text-violet-300">D: <b>${det.Daniel}</b></span>
              <span class="text-slate-600">|</span>
              <span class="text-amber-300">Tot: <b>${det.total}</b></span>
            </div>
          </div>
        </div>

        <!-- Pricing & Actions Row -->
        <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs font-mono">
          <div>
            <div class="text-[10px] text-slate-400 font-sans">Precio Venta</div>
            <div class="font-black text-emerald-400 text-sm">${fmtCRC(p.precioVentaCRC)}</div>
            <div class="text-[10px] text-slate-400 font-normal">${fmtUSD(p.precioVentaUSD)} USD</div>
          </div>

          <div class="flex items-center gap-1">
            <button onclick="abrirModalProducto('${p.codigo}')" class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl active:scale-95 transition-all" title="Editar Producto">
              <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="agregarAlCarritoPorCodigo('${p.codigo}')" class="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-[11px] rounded-xl flex items-center gap-1 active:scale-95 shadow-md shadow-indigo-600/20 transition-all">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              Vender
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  inicializarIconos();
  renderizarCategoriasPills();
}

function limpiarFiltrosInventario() {
  const s = document.getElementById("searchInventory");
  if (s) s.value = "";
  state.categoriaSeleccionada = "Todas";
  state.filtroEstadoStock = "todos";
  renderizarTodo();
}
function renderizarCategoriasPills() {
  const categorias = ["Todas", ...new Set(Object.values(state.productos).map(p => p.categoria || "General"))];
  const pillsCont = document.getElementById("categoryPills");
  pillsCont.innerHTML = categorias.map(c => `
    <button onclick="filtrarCategoria('${c}')" class="cat-pill ${c === state.categoriaSeleccionada ? 'active' : ''} px-3 py-1.5 rounded-full shrink-0">
      ${c}
    </button>
  `).join("");
}

function filtrarCategoria(cat) {
  state.categoriaSeleccionada = cat;
  renderizarInventario();
}

function filtrarInventario() {
  renderizarInventario();
}

function ordenarProductos() {
  const ordenes = ["az", "za", "stock_asc", "stock_desc"];
  const labels = { az: "A-Z", za: "Z-A", stock_asc: "Menor Stock", stock_desc: "Mayor Stock" };
  let nextIdx = (ordenes.indexOf(state.ordenActual) + 1) % ordenes.length;
  state.ordenActual = ordenes[nextIdx];
  document.getElementById("sortLabel").textContent = labels[state.ordenActual];
  renderizarInventario();
}

// ==========================================================================
// EXPORTAR CATÁLOGO DE PRECIOS Y STOCK PARA WHATSAPP
// ==========================================================================
function abrirModalExportarCatalogo() {
  const modal = document.getElementById("modalExportarCatalogo");
  if (!modal) return;

  // Poblado dinámico del selector de categorías en el modal
  const selCat = document.getElementById("exportFiltroCategoria");
  if (selCat) {
    const categorias = ["Todas", ...new Set(Object.values(state.productos || {}).map(p => p.categoria || "General"))];
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
    selStock.value = (state.filtroEstadoStock === "todos") ? "todos" : "constock";
  }

  actualizarVistaPreviaExportarCatalogo();

  modal.classList.remove("hidden");
  modal.classList.add("flex");
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

  const stockMap = calcularStockPorCodigo();
  const todos = Object.values(state.productos || {});
  const vistaVend = state.vistaVendedor || "Consolidado";

  // Filtrar según opciones
  let prods = todos.filter(p => {
    const st = stockMap[p.codigo] || 0;
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

  const negocio = state.config.nombreNegocio || "DC EL DESTAPE LICORES";
  const telefono = state.config.telefonoNegocio || "+506 8992-7936";
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

      const st = stockMap[p.codigo] || 0;
      const precioCRC = fmtCRC(p.precioVentaCRC || 0);
      
      let badgeStock = "";
      if (mostrarCantidades) {
        badgeStock = st > 0 ? ` _(🟢 ${st} disp.)_` : ` _(⏳ Encargo)_`;
      }

      // Formato limpio solo en colones
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
// MÓDULO: MAESTRO DE CLIENTES Y PUNTOS DE FIDELIZACIÓN
// ==========================================================================

// --- CRUD Clientes ---
function guardarCliente(obj) {
  // obj: { nombre, telefono, puntos?, fechaRegistro? }
  const tel = (obj.telefono || "").trim().replace(/\s+/g, "");
  if (!obj.nombre || !tel) { mostrarToast("Nombre y teléfono son requeridos.", "error"); return null; }

  // Buscar si ya existe por teléfono
  const existente = Object.values(state.clientes).find(c => c.telefono === tel);
  const id = existente ? existente.id : "CLI-" + Date.now().toString().slice(-8);
  const ahora = new Date().toISOString();

  const clienteObj = {
    id,
    nombre: obj.nombre.trim(),
    telefono: tel,
    puntos: existente ? (obj.puntos !== undefined ? obj.puntos : existente.puntos) : (obj.puntos || 0),
    fechaRegistro: existente ? existente.fechaRegistro : (obj.fechaRegistro || ahora),
    ultimaVenta: existente ? existente.ultimaVenta : null,
    creadoPor: existente ? (existente.creadoPor || "Carlos") : (obj.creadoPor || state.vendedorActual || "Carlos")
  };

  state.clientes[id] = clienteObj;
  guardarClientesLocal();
  encolarAccionSincronizacion("guardarCliente", { cliente: clienteObj });
  return clienteObj;
}

function buscarClientePorTelefono(tel) {
  const t = (tel || "").trim().replace(/\s+/g, "");
  return Object.values(state.clientes).find(c => c.telefono === t) || null;
}

function buscarClientesPorQuery(q) {
  if (!q) return Object.values(state.clientes);
  const ql = q.toLowerCase();
  return Object.values(state.clientes).filter(c =>
    c.nombre.toLowerCase().includes(ql) || c.telefono.includes(ql)
  );
}

function actualizarPuntosCliente(id, delta) {
  if (!state.clientes[id]) return;
  state.clientes[id].puntos = Math.max(0, (state.clientes[id].puntos || 0) + delta);
  guardarClientesLocal();
  encolarAccionSincronizacion("actualizarPuntos", { telefono: state.clientes[id].telefono, puntos: state.clientes[id].puntos });
}

// --- Selección de cliente en el POS ---
function seleccionarCliente(id) {
  state.clienteSeleccionado = state.clientes[id] || null;
  state.descuentoPuntosAplicado = 0;

  const input = document.getElementById("posClienteInput");
  if (input && state.clienteSeleccionado) {
    input.value = state.clienteSeleccionado.nombre;
  }

  const dropdown = document.getElementById("clienteDropdown");
  if (dropdown) {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
  }

  renderizarPanelCliente();
  renderizarCarrito();
}
function deseleccionarCliente() {
  state.clienteSeleccionado = null;
  state.descuentoPuntosAplicado = 0;
  const input = document.getElementById("posClienteInput");
  if (input) input.value = "";
  const dropdown = document.getElementById("clienteDropdown");
  if (dropdown) dropdown.classList.add("hidden");
  renderizarPanelCliente();
  renderizarCarrito();
}

function renderizarPanelCliente() {
  const panel = document.getElementById("panelPuntosCliente");
  if (!panel) return;

  const cli = state.clienteSeleccionado;
  if (!cli) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const config = state.config;
  const puntos = cli.puntos || 0;
  const valorCanje = Math.floor(puntos * (config.puntosValorCRC || 1));
  const puedesCanjear = puntos >= (config.puntosMinimosCanje || 100);
  const yaCanjeado = state.descuentoPuntosAplicado > 0;

  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="p-3 bg-amber-950/40 border border-amber-500/40 rounded-2xl space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs">👤</span>
          <div>
            <div class="font-bold text-white text-xs">${cli.nombre}</div>
            <div class="text-[10px] text-slate-400 font-mono">${cli.telefono}</div>
          </div>
        </div>
        <button onclick="deseleccionarCliente()" class="text-slate-500 hover:text-rose-400 text-xs">✕</button>
      </div>
      <div class="flex items-center justify-between text-xs">
        <span class="text-slate-300">Puntos acumulados:</span>
        <span class="font-black text-amber-300 font-mono">${puntos.toLocaleString()} pts <span class="text-amber-500/70 font-normal">(vale ${fmtCRC(valorCanje)})</span></span>
      </div>
      ${!yaCanjeado && puedesCanjear ? `
      <button onclick="abrirModalCanjeoPuntos()" class="w-full py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs rounded-xl active:scale-95 transition-all flex items-center justify-center gap-1.5">
        🎁 Canjear puntos como descuento
      </button>
      ` : yaCanjeado ? `
      <div class="flex items-center justify-between py-1.5 px-2 bg-emerald-950/40 border border-emerald-500/30 rounded-xl">
        <span class="text-xs text-emerald-300 font-bold">✓ Descuento aplicado:</span>
        <span class="text-xs font-black text-emerald-400 font-mono">-${fmtCRC(state.descuentoPuntosAplicado)}</span>
        <button onclick="quitarCanjeoPuntos()" class="text-[10px] text-rose-400 hover:text-rose-300 ml-2">Quitar</button>
      </div>
      ` : `
      <div class="text-[11px] text-slate-500 text-center">Mínimo ${config.puntosMinimosCanje} puntos para canjear.</div>
      `}
    </div>
  `;
  inicializarIconos();
}
function abrirModalCanjeoPuntos() {
  const cli = state.clienteSeleccionado;
  if (!cli) return;
  const config = state.config;
  const puntos = cli.puntos || 0;

  // Calcular total actual del carrito (sin descuento)
  let totalCarritoCRC = 0;
  state.carrito.forEach(i => totalCarritoCRC += i.cantidad * i.precioVentaCRC);

  const maxDescuento = Math.min(puntos * (config.puntosValorCRC || 1), totalCarritoCRC);

  const modal = document.getElementById("modalCanjeoPuntos");
  if (!modal) return;
  document.getElementById("canjePuntosDisponibles").textContent = puntos.toLocaleString();
  document.getElementById("canjePuntosValor").textContent = fmtCRC(puntos * (config.puntosValorCRC || 1));
  document.getElementById("canjePuntosMax").textContent = fmtCRC(maxDescuento);

  const slider = document.getElementById("canjePuntosSlider");
  const maxPuntos = Math.floor(maxDescuento / (config.puntosValorCRC || 1));
  slider.max = maxPuntos;
  slider.value = maxPuntos;
  actualizarSliderCanje();

  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function actualizarSliderCanje() {
  const slider = document.getElementById("canjePuntosSlider");
  const config = state.config;
  const puntosAUsar = Number(slider.value) || 0;
  const descuento = puntosAUsar * (config.puntosValorCRC || 1);
  const el = document.getElementById("canjePuntosResumen");
  if (el) el.textContent = `${puntosAUsar.toLocaleString()} puntos = -${fmtCRC(descuento)} de descuento`;
}

function confirmarCanjeoPuntos() {
  const slider = document.getElementById("canjePuntosSlider");
  const puntosAUsar = Number(slider.value) || 0;
  if (puntosAUsar <= 0) { mostrarToast("Seleccioná al menos 1 punto.", "error"); return; }

  state.descuentoPuntosAplicado = puntosAUsar * (state.config.puntosValorCRC || 1);
  cerrarModalCanjeoPuntos();
  renderizarPanelCliente();
  renderizarCarrito();
  mostrarToast(`Descuento de ${fmtCRC(state.descuentoPuntosAplicado)} aplicado 🎁`, "success");
}

function quitarCanjeoPuntos() {
  state.descuentoPuntosAplicado = 0;
  renderizarPanelCliente();
  renderizarCarrito();
  mostrarToast("Descuento de puntos eliminado.", "info");
}

function cerrarModalCanjeoPuntos() {
  const modal = document.getElementById("modalCanjeoPuntos");
  if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
}

// --- Búsqueda de cliente en el POS ---
function onClienteInputChange() {
  const q = (document.getElementById("posClienteInput").value || "").trim();
  const dropdown = document.getElementById("clienteDropdown");

  if (!q || q.length < 1) {
    dropdown.classList.add("hidden");
    return;
  }

  const resultados = buscarClientesPorQuery(q).slice(0, 6);
  if (resultados.length === 0) {
    dropdown.innerHTML = `
      <div class="p-2 text-xs text-slate-400">No encontrado.
        <button onclick="abrirModalNuevoCliente()" class="text-indigo-400 font-bold hover:underline ml-1">➕ Crear cliente</button>
      </div>`;
    dropdown.classList.remove("hidden");
    return;
  }

  dropdown.innerHTML = resultados.map(c => `
    <div onclick="seleccionarCliente('${c.id}')" class="px-3 py-2.5 hover:bg-slate-700 cursor-pointer flex items-center justify-between gap-2">
      <div>
        <div class="text-xs font-bold text-white">${c.nombre}</div>
        <div class="text-[11px] text-slate-400 font-mono">${c.telefono}</div>
      </div>
      <span class="text-[11px] font-bold text-amber-400 font-mono bg-amber-950/40 px-2 py-0.5 rounded-lg">🏅 ${(c.puntos||0).toLocaleString()} pts</span>
    </div>
  `).join("") + `
    <div onclick="abrirModalNuevoCliente()" class="px-3 py-2 hover:bg-slate-700 cursor-pointer text-indigo-400 font-bold text-xs flex items-center gap-1.5">
      <span>➕ Nuevo cliente</span>
    </div>
  `;
  dropdown.classList.remove("hidden");
}

function cerrarDropdownCliente(e) {
  if (!e.target.closest("#clienteDropdown") && !e.target.closest("#posClienteInput")) {
    const dd = document.getElementById("clienteDropdown");
    if (dd) dd.classList.add("hidden");
  }
}

function abrirModalNuevoCliente(prefillNombre = "") {
  _editandoClienteId = null;
  const dd = document.getElementById("clienteDropdown");
  if (dd) dd.classList.add("hidden");

  // Solo pre-llenar si se pasa explícitamente como argumento, de lo contrario siempre en blanco
  document.getElementById("modalClienteNombre").value = typeof prefillNombre === "string" ? prefillNombre : "";
  document.getElementById("modalClienteTelefono").value = "";
  document.getElementById("modalClientePuntos").value = "0";
  document.getElementById("modalClienteId").textContent = "Nuevo cliente";
  document.getElementById("btnEliminarCliente").classList.add("hidden");

  const modal = document.getElementById("modalCliente");
  if (modal) { modal.classList.remove("hidden"); modal.classList.add("flex"); }
  
  setTimeout(() => {
    document.getElementById("modalClienteNombre")?.focus();
  }, 100);

  inicializarIconos();
}

function abrirModalEditarCliente(id) {
  _editandoClienteId = id;
  const cli = state.clientes[id];
  if (!cli) return;

  document.getElementById("modalClienteNombre").value = cli.nombre;
  document.getElementById("modalClienteTelefono").value = cli.telefono;
  document.getElementById("modalClientePuntos").value = cli.puntos || 0;
  document.getElementById("modalClienteId").textContent = cli.id;
  document.getElementById("btnEliminarCliente").classList.remove("hidden");

  const modal = document.getElementById("modalCliente");
  if (modal) { modal.classList.remove("hidden"); modal.classList.add("flex"); }
  inicializarIconos();
}

function guardarClienteForm() {
  const nombreInput = document.getElementById("modalClienteNombre");
  const telInput = document.getElementById("modalClienteTelefono");
  const puntosInput = document.getElementById("modalClientePuntos");

  const nombre = (nombreInput?.value || "").trim();
  const telefono = (telInput?.value || "").trim();
  const puntos = parseInt(puntosInput?.value) || 0;

  if (!nombre || !telefono) { mostrarToast("Nombre y teléfono son requeridos.", "error"); return; }

  const clienteObj = _editandoClienteId
    ? { ...(state.clientes[_editandoClienteId] || {}), nombre, telefono, puntos }
    : { nombre, telefono, puntos };

  const guardado = guardarCliente(clienteObj);
  cerrarModalCliente();

  if (guardado) {
    seleccionarCliente(guardado.id);
    renderizarClientes();
    mostrarToast(`Cliente ${nombre} guardado 👤`, "success");
  }
}

function cerrarModalCliente() {
  _editandoClienteId = null;
  const nombreInput = document.getElementById("modalClienteNombre");
  const telInput = document.getElementById("modalClienteTelefono");
  const puntosInput = document.getElementById("modalClientePuntos");
  if (nombreInput) nombreInput.value = "";
  if (telInput) telInput.value = "";
  if (puntosInput) puntosInput.value = "0";

  const modal = document.getElementById("modalCliente");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function eliminarClienteActual() {
  if (!_editandoClienteId) return;
  const cli = state.clientes[_editandoClienteId];
  if (!cli) return;
  if (!confirm(`¿Eliminar a ${cli.nombre}? Esta acción no se puede deshacer.`)) return;

  const idAEliminar = _editandoClienteId;
  delete state.clientes[idAEliminar];
  guardarClientesLocal();
  cerrarModalCliente();
  if (state.clienteSeleccionado && state.clienteSeleccionado.id === idAEliminar) {
    deseleccionarCliente();
  }
  renderizarClientes();
  mostrarToast("Cliente eliminado.", "info");
}

// --- Vista Maestro de Clientes ---
function renderizarClientes() {
  const cont = document.getElementById("listaClientesMaestro");
  if (!cont) return;

  const q = state.filtroClientes || "";
  const lista = buscarClientesPorQuery(q).sort((a, b) => (b.puntos || 0) - (a.puntos || 0));
  const totalClientes = document.getElementById("contadorClientes");
  if (totalClientes) totalClientes.textContent = lista.length;

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="flex flex-col items-center justify-center py-10 text-slate-500 text-xs space-y-2">
        <i data-lucide="users" class="w-10 h-10 stroke-1 text-slate-600"></i>
        <span>${q ? "No hay clientes que coincidan." : "Aún no hay clientes registrados."}</span>
        <button onclick="abrirModalNuevoCliente()" class="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs active:scale-95 mt-2">➕ Agregar primer cliente</button>
      </div>
    `;
    inicializarIconos();
    return;
  }

  cont.innerHTML = lista.map(c => {
    const ultimaVenta = c.ultimaVenta ? new Date(c.ultimaVenta).toLocaleDateString() : "—";
    const puntos = c.puntos || 0;
    const valorPuntos = puntos * (state.config.puntosValorCRC || 1);
    return `
      <div onclick="abrirModalEditarCliente('${c.id}')" class="p-3 bg-slate-800/90 border border-slate-700/80 rounded-2xl flex items-center gap-3 cursor-pointer hover:bg-slate-800 active:scale-[0.99] transition-all">
        <div class="w-10 h-10 rounded-full bg-indigo-900/60 border border-indigo-500/30 flex items-center justify-center shrink-0 text-lg font-black text-indigo-300">
          ${c.nombre.charAt(0).toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-bold text-white truncate">${c.nombre}</div>
          <div class="text-[11px] text-slate-400 font-mono">${c.telefono} • Última: ${ultimaVenta}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-sm font-black text-amber-400 font-mono">🏅 ${puntos.toLocaleString()}</div>
          <div class="text-[10px] text-slate-500">${fmtCRC(valorPuntos)}</div>
        </div>
      </div>
    `;
  }).join("") + '<div class="h-4"></div>';
  inicializarIconos();
}

// --- Portal de Puntos de Clientes (Taberna) ---
function copiarEnlacePortalClientes() {
  const urlBase = window.location.href.split("?")[0].replace("index.html", "") + "puntos.html";
  const apiUrl = (state.config && state.config.sheetsUrl) ? state.config.sheetsUrl : "";
  const urlCompleta = apiUrl ? `${urlBase}?api=${encodeURIComponent(apiUrl)}` : urlBase;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(urlCompleta).then(() => {
      mostrarToast("¡Enlace del Portal de Clientes copiado! Envíalo por WhatsApp 🍻", "success");
    }).catch(() => {
      prompt("Copia este enlace para enviarlo a tus clientes:", urlCompleta);
    });
  } else {
    prompt("Copia este enlace para enviarlo a tus clientes:", urlCompleta);
  }
}

function abrirPortalClientes() {
  const urlBase = window.location.href.split("?")[0].replace("index.html", "") + "puntos.html";
  const apiUrl = (state.config && state.config.sheetsUrl) ? state.config.sheetsUrl : "";
  const urlCompleta = apiUrl ? `${urlBase}?api=${encodeURIComponent(apiUrl)}` : urlBase;
  window.open(urlCompleta, "_blank");
}

// ==========================================================================
// MÓDULO: CUENTAS PENDIENTES (POR COBRAR Y POR PAGAR)
// ==========================================================================

function filtrarTipoCuenta(tipo) {
  state.filtroTipoCuenta = tipo;
  ["cobrar", "liquidadas", "pagar", "todos"].forEach(t => {
    const btn = document.getElementById("tabCuentas-" + t);
    if (!btn) return;
    if (
      (t === "cobrar" && tipo === "Por Cobrar") || 
      (t === "liquidadas" && tipo === "Liquidadas") || 
      (t === "pagar" && tipo === "Por Pagar") || 
      (t === "todos" && tipo === "todos")
    ) {
      if (tipo === "Por Cobrar") {
        btn.className = "py-2 rounded-lg bg-emerald-600 text-white shadow-md text-center transition-all font-bold";
      } else if (tipo === "Liquidadas") {
        btn.className = "py-2 rounded-lg bg-cyan-700 text-white shadow-md text-center transition-all font-bold";
      } else if (tipo === "Por Pagar") {
        btn.className = "py-2 rounded-lg bg-rose-750 text-white shadow-md text-center transition-all font-bold";
      } else {
        btn.className = "py-2 rounded-lg bg-indigo-600 text-white shadow-md text-center transition-all font-bold";
      }
    } else {
      btn.className = "py-2 rounded-lg bg-transparent text-slate-400 hover:text-white text-center transition-all font-medium";
    }
  });
  renderizarCuentas();
}

// --- Cálculo de Datos de Envío y Desglose de Cuentas por Cobrar ---
function obtenerDatosEnvioCuenta(cta) {
  if (!cta) return { 
    costoEnvioCRC: 0, costoEnvioUSD: 0, 
    envioPendienteCRC: 0, envioPendienteUSD: 0, 
    valorClienteCRC: 0, valorClienteUSD: 0, 
    valorNetoCRC: 0, valorNetoUSD: 0, 
    tieneEnvio: false 
  };

  const tc = Number(state.config.tipoCambio || 520);
  let costoEnvioCRC = parseNum(cta.costoEnvioCRC, 0);

  // Si no está explícito en la cuenta, buscar la venta asociada en state.ventas
  if (costoEnvioCRC === 0 && cta.tipo === "Por Cobrar") {
    let vId = cta.ventaId;
    if (!vId && cta.referenciaId) {
      const match = cta.referenciaId.match(/VTA-[A-Za-z0-9-]+/i);
      if (match) vId = match[0];
    }
    if (!vId && cta.notas) {
      const match = cta.notas.match(/VTA-[A-Za-z0-9-]+/i);
      if (match) vId = match[0];
    }

    if (vId) {
      const ventasAsoc = (state.ventas || []).filter(v => v.id === vId);
      if (ventasAsoc.length > 0) {
        let envioTotalVenta = parseNum(ventasAsoc[0].costoEnvioCRC || ventasAsoc[0].envioCRC, 0);
        if (envioTotalVenta === 0 && ventasAsoc[0].notas) {
          const matchVentaNota = ventasAsoc[0].notas.match(/env[íi]o:\s*₡?\s*(\d+)/i) || ventasAsoc[0].notas.match(/flete:\s*₡?\s*(\d+)/i);
          if (matchVentaNota && matchVentaNota[1]) envioTotalVenta = parseNum(matchVentaNota[1], 0);
        }
        if (envioTotalVenta > 0) {
          const cuentasMismaVenta = (state.cuentas || []).filter(c => 
            c.tipo === "Por Cobrar" && (c.ventaId === vId || (c.referenciaId && c.referenciaId.includes(vId)) || (c.notas && c.notas.includes(vId)))
          );
          const totalMontoCuentas = cuentasMismaVenta.reduce((acc, c) => acc + parseNum(c.montoTotalCRC, 0), 0);
          if (totalMontoCuentas > 0 && cuentasMismaVenta.length > 1) {
            costoEnvioCRC = Math.round(envioTotalVenta * (parseNum(cta.montoTotalCRC, 0) / totalMontoCuentas));
          } else {
            costoEnvioCRC = envioTotalVenta;
          }
        }
      }
    }
  }

  // Si aún es 0, extraer de notas si fue registrado previamente como [Envío: ₡...]
  if (costoEnvioCRC === 0 && cta.notas) {
    const matchEnvio = cta.notas.match(/env[íi]o:\s*₡?\s*(\d+)/i) || cta.notas.match(/flete:\s*₡?\s*(\d+)/i);
    if (matchEnvio && matchEnvio[1]) {
      costoEnvioCRC = parseNum(matchEnvio[1], 0);
    }
  }

  const costoEnvioUSD = tc > 0 ? (costoEnvioCRC / tc) : 0;
  const saldoPendienteBrutoCRC = parseNum(cta.saldoPendienteCRC !== undefined ? cta.saldoPendienteCRC : cta.montoTotalCRC, 0);
  const totalBrutoCRC = parseNum(cta.montoTotalCRC || saldoPendienteBrutoCRC, 0);

  const ratioPendiente = totalBrutoCRC > 0 ? (saldoPendienteBrutoCRC / totalBrutoCRC) : 1;
  const envioPendienteCRC = Math.round(costoEnvioCRC * ratioPendiente);
  const envioPendienteUSD = tc > 0 ? (envioPendienteCRC / tc) : 0;

  // 1. Reporte para el Cliente (WhatsApp): Monto de venta completo sin descontar envío
  const valorClienteCRC = saldoPendienteBrutoCRC;
  const valorClienteUSD = tc > 0 ? (valorClienteCRC / tc) : 0;

  // 2. Para nosotros en el sistema: Valor real neto (venta - envío)
  const valorNetoCRC = Math.max(0, saldoPendienteBrutoCRC - envioPendienteCRC);
  const valorNetoUSD = tc > 0 ? (valorNetoCRC / tc) : 0;

  return {
    costoEnvioCRC,
    costoEnvioUSD,
    envioPendienteCRC,
    envioPendienteUSD,
    valorClienteCRC,
    valorClienteUSD,
    valorNetoCRC,
    valorNetoUSD,
    tieneEnvio: costoEnvioCRC > 0
  };
}

function editarEnvioCuenta(idCuenta) {
  const cta = state.cuentas.find(c => c.id === idCuenta);
  if (!cta) return;

  const datosEnv = obtenerDatosEnvioCuenta(cta);
  const actual = datosEnv.costoEnvioCRC || 0;
  const input = prompt(`Ingresa el monto de flete/envío de esta venta para ${cta.entidad} (₡ Colones):\n(Se descontará para obtener el valor neto real del sistema)`, actual);
  if (input === null) return;

  const nuevoEnvio = parseNum(input, 0);
  if (nuevoEnvio < 0) {
    mostrarToast("El envío no puede ser negativo", "error");
    return;
  }

  const tc = Number(state.config.tipoCambio || 520);
  cta.costoEnvioCRC = nuevoEnvio;
  cta.costoEnvioUSD = tc > 0 ? (nuevoEnvio / tc) : 0;

  let notasLimpias = (cta.notas || "").replace(/\s*\[Envío:.*?\]/gi, "").replace(/\s*\[Flete:.*?\]/gi, "");
  if (nuevoEnvio > 0) {
    notasLimpias += ` [Envío: ₡${nuevoEnvio}]`;
  }
  cta.notas = notasLimpias;

  guardarCuentasLocal();
  encolarAccionSincronizacion("actualizarCuenta", { cuenta: cta });
  renderizarCuentas();
  renderizarFinanzas();
  renderizarDashboard();
  mostrarToast(`Flete/Envío de ${fmtCRC(nuevoEnvio)} configurado para ${cta.entidad} 🚚`, "success");
}

function renderizarCuentas() {
  const cont = document.getElementById("listaCuentasPendientes");
  if (!cont) return;

  const q = (state.filtroCuentas || "").toLowerCase().trim();
  const filtroTipo = state.filtroTipoCuenta || "Por Cobrar";

  // Calcular métricas generales (con valor neto real venta - envío para nosotros)
  let totCobrarNetoCRC = 0, totCobrarNetoUSD = 0, countCobrar = 0;
  let totCobrarBrutoClienteCRC = 0, totalEnvioEnCxcCRC = 0;
  let totPagarCRC = 0, totPagarUSD = 0, countPagar = 0;

  state.cuentas.forEach(cta => {
    const estado = cta.estado || "Pendiente";
    const esPagado = estado === "Pagado" || (Number(cta.saldoPendienteCRC || 0) <= 0);

    if (!esPagado) {
      if (cta.tipo === "Por Cobrar") {
        const datosEnv = obtenerDatosEnvioCuenta(cta);
        totCobrarNetoCRC += datosEnv.valorNetoCRC; // Valor real para el sistema (venta - envio)
        totCobrarNetoUSD += datosEnv.valorNetoUSD;
        totCobrarBrutoClienteCRC += datosEnv.valorClienteCRC;
        totalEnvioEnCxcCRC += datosEnv.envioPendienteCRC;
        countCobrar++;
      } else {
        const saldoCRC = Number(cta.saldoPendienteCRC !== undefined ? cta.saldoPendienteCRC : cta.montoTotalCRC);
        const saldoUSD = Number(cta.saldoPendienteUSD !== undefined ? cta.saldoPendienteUSD : cta.montoTotalUSD);
        totPagarCRC += saldoCRC;
        totPagarUSD += saldoUSD;
        countPagar++;
      }
    }
  });

  // Actualizar Cards de resumen
  const elCobrarCRC = document.getElementById("cuentasTotalCobrarCRC");
  const elCobrarUSD = document.getElementById("cuentasTotalCobrarUSD");
  const elBadgeCobrar = document.getElementById("badgeCuentasCobrar");
  if (elCobrarCRC) elCobrarCRC.textContent = fmtCRC(totCobrarBrutoClienteCRC);
  if (elCobrarUSD) {
    if (totalEnvioEnCxcCRC > 0) {
      elCobrarUSD.innerHTML = `<span>${fmtUSD(totCobrarBrutoClienteCRC / (Number(state.config.tipoCambio) || 520))}</span><span class="block text-[9px] text-slate-400 font-normal">Neto sin envíos: <b class="text-emerald-300">${fmtCRC(totCobrarNetoCRC)}</b> (Envío: -${fmtCRC(totalEnvioEnCxcCRC)})</span>`;
    } else {
      elCobrarUSD.textContent = fmtUSD(totCobrarNetoUSD);
    }
  }
  if (elBadgeCobrar) elBadgeCobrar.textContent = countCobrar;

  const elPagarCRC = document.getElementById("cuentasTotalPagarCRC");
  const elPagarUSD = document.getElementById("cuentasTotalPagarUSD");
  const elBadgePagar = document.getElementById("badgeCuentasPagar");
  if (elPagarCRC) elPagarCRC.textContent = fmtCRC(totPagarCRC);
  if (elPagarUSD) elPagarUSD.textContent = fmtUSD(totPagarUSD);
  if (elBadgePagar) elBadgePagar.textContent = countPagar;

  const elCountTotal = document.getElementById("cuentasCountTotal");
  if (elCountTotal) elCountTotal.textContent = state.cuentas.length;

  // Actualizar widget en Dashboard respetando la vista seleccionada
  const vistaActual = state.vistaVendedor || "Consolidado";
  let dashBrutoCRC = 0;
  let dashNetoCRC = 0;
  let dashEnvioCRC = 0;
  let dashPagarCRC = 0;
  state.cuentas.forEach(cta => {
    if (vistaActual !== "Consolidado") {
      const vendCta = String(cta.vendedor || cta.socio || cta.registradoPor || "Carlos").trim();
      if (vendCta !== vistaActual) return;
    }
    const saldo = parseNum(cta.saldoPendienteCRC, 0);
    if ((cta.estado || "Pendiente") !== "Pagado" && saldo > 0) {
      if (cta.tipo === "Por Cobrar") {
        const datosEnv = obtenerDatosEnvioCuenta(cta);
        dashBrutoCRC += datosEnv.valorClienteCRC;
        dashNetoCRC += datosEnv.valorNetoCRC;
        dashEnvioCRC += datosEnv.envioPendienteCRC;
      } else {
        dashPagarCRC += saldo;
      }
    }
  });

  const dashCobrar = document.getElementById("dashCobrarCRC");
  const dashCobrarNetoSub = document.getElementById("dashCobrarNetoSub");
  const dashPagar = document.getElementById("dashPagarCRC");
  if (dashCobrar) dashCobrar.textContent = fmtCRC(dashBrutoCRC);
  if (dashCobrarNetoSub) {
    if (dashEnvioCRC > 0) {
      dashCobrarNetoSub.innerHTML = `<span class="text-slate-400">Neto sin envíos:</span> <b class="text-emerald-300 font-mono">${fmtCRC(dashNetoCRC)}</b>`;
    } else {
      dashCobrarNetoSub.innerHTML = "";
    }
  }
  if (dashPagar) dashPagar.textContent = fmtCRC(dashPagarCRC);

  // Filtrar lista para mostrar según la pestaña seleccionada
  let lista = state.cuentas.filter(cta => {
    const esPagado = cta.estado === "Pagado" || (Number(cta.saldoPendienteCRC || 0) <= 0);

    if (filtroTipo === "Por Cobrar") {
      // Solo cuentas por cobrar PENDIENTES o con abono parcial
      if (cta.tipo !== "Por Cobrar" || esPagado) return false;
    } else if (filtroTipo === "Liquidadas") {
      // Solo cuentas ya LIQUIDADAS / PAGADAS
      if (!esPagado) return false;
    } else if (filtroTipo === "Por Pagar") {
      // Solo cuentas por pagar
      if (cta.tipo !== "Por Pagar") return false;
    }

    if (q) {
      const ent = (cta.entidad || "").toLowerCase();
      const tel = (cta.telefono || "").toLowerCase();
      const ref = (cta.referenciaId || "").toLowerCase();
      const not = (cta.notas || "").toLowerCase();
      if (!ent.includes(q) && !tel.includes(q) && !ref.includes(q) && !not.includes(q)) return false;
    }
    return true;
  });

  // Ordenar: Pendientes con mayor saldo de primero, las más recientes primero
  lista.sort((a, b) => {
    const aPag = (a.estado === "Pagado" || Number(a.saldoPendienteCRC || 0) <= 0) ? 1 : 0;
    const bPag = (b.estado === "Pagado" || Number(b.saldoPendienteCRC || 0) <= 0) ? 1 : 0;
    if (aPag !== bPag) return aPag - bPag;
    const saldoDiff = (Number(b.saldoPendienteCRC || 0)) - (Number(a.saldoPendienteCRC || 0));
    if (saldoDiff !== 0) return saldoDiff;
    return new Date(b.fecha || 0) - new Date(a.fecha || 0);
  });

  if (lista.length === 0) {
    let mensajeVacio = "No hay cuentas registradas en esta sección.";
    if (filtroTipo === "Por Cobrar") {
      mensajeVacio = "¡Excelente! No tienes cuentas por cobrar pendientes de cobro 🎉";
    } else if (filtroTipo === "Liquidadas") {
      mensajeVacio = "No hay cuentas liquidadas en el historial.";
    } else if (filtroTipo === "Por Pagar") {
      mensajeVacio = "No tienes cuentas por pagar pendientes a proveedores.";
    }

    cont.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-slate-500 text-xs space-y-2 bg-slate-900/60 rounded-2xl border border-slate-800 text-center px-4">
        <i data-lucide="${filtroTipo === 'Por Cobrar' ? 'badge-check' : 'folder-open'}" class="w-10 h-10 stroke-1 ${filtroTipo === 'Por Cobrar' ? 'text-emerald-500' : 'text-slate-600'}"></i>
        <span class="font-bold text-slate-300">${q ? "No hay cuentas que coincidan con la búsqueda." : mensajeVacio}</span>
        ${filtroTipo === "Por Cobrar" && !q ? `
          <span class="text-[11px] text-slate-500 max-w-xs leading-relaxed">
            Las nuevas cuentas por cobrar se registran al vender con <b>'Pago Luego'</b> o usando <b>'+ Cta Cobrar'</b> en los movimientos.
          </span>
        ` : ''}
      </div>
    `;
    inicializarIconos();
    return;
  }

  cont.innerHTML = lista.map(cta => {
    const esCobrar = cta.tipo === "Por Cobrar";
    const esPagado = cta.estado === "Pagado" || (Number(cta.saldoPendienteCRC || 0) <= 0);
    const badgeColor = esPagado
      ? "bg-slate-800 text-slate-400 border-slate-700"
      : (esCobrar ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40" : "bg-rose-950/80 text-rose-300 border-rose-500/40");
    const estadoTexto = esPagado ? "✅ Liquidado" : (cta.estado === "Parcial" ? "⏳ Parcial" : "🔴 Pendiente");
    const iconTipo = esCobrar ? "arrow-down-left" : "arrow-up-right";
    const iconColor = esCobrar ? "text-emerald-400 bg-emerald-950/60" : "text-rose-400 bg-rose-950/60";

    const datosEnv = obtenerDatosEnvioCuenta(cta);
    const saldoCRC = Number(cta.saldoPendienteCRC !== undefined ? cta.saldoPendienteCRC : cta.montoTotalCRC);
    const saldoUSD = Number(cta.saldoPendienteUSD !== undefined ? cta.saldoPendienteUSD : cta.montoTotalUSD);
    const totalCRC = Number(cta.montoTotalCRC || 0);

    const fechaStr = cta.fecha ? new Date(cta.fecha).toLocaleDateString() : "";

    return `
      <div class="bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 border ${esPagado ? 'border-slate-800 opacity-70' : 'border-slate-700/90'} rounded-2xl p-3.5 shadow-lg space-y-2.5 transition-all">
        <!-- Top row: Type badge, status, date -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span class="p-1 rounded-lg ${iconColor} flex items-center justify-center">
              <i data-lucide="${iconTipo}" class="w-3.5 h-3.5"></i>
            </span>
            <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${badgeColor}">
              ${cta.tipo}
            </span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">${estadoTexto}</span>
            ${datosEnv.tieneEnvio && esCobrar && !esPagado ? `
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 flex items-center gap-1">
                🚚 Envío: -${fmtCRC(datosEnv.costoEnvioCRC)}
              </span>
            ` : ''}
          </div>
          <span class="text-[10px] text-slate-500 font-mono shrink-0">${fechaStr}</span>
        </div>

        <!-- Middle: Entity Name, Phone, Ref, Notes -->
        <div class="flex justify-between items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-black text-white truncate">${cta.entidad || 'Sin nombre'}</div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-2 flex-wrap">
              ${cta.telefono ? `<span>📞 ${cta.telefono}</span>` : ''}
              ${cta.referenciaId ? `<span>Ref: <b class="text-indigo-300">${cta.referenciaId}</b></span>` : ''}
              ${cta.vendedor ? `<span>Vend: <b>${cta.vendedor}</b></span>` : ''}
              ${esCobrar && !esPagado ? `
                <button type="button" onclick="editarEnvioCuenta('${cta.id}')" class="px-1.5 py-0.2 rounded border text-[9px] font-semibold flex items-center gap-0.5 ${datosEnv.tieneEnvio ? 'bg-amber-950/40 border-amber-500/30 text-amber-300 hover:bg-amber-900/60' : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'}" title="Ajustar monto de envío o flete de esta venta">
                  <span>🚚 ${datosEnv.tieneEnvio ? `Envío: -${fmtCRC(datosEnv.costoEnvioCRC)}` : '+ Flete/Envío'}</span>
                </button>
              ` : ''}
            </div>
            ${cta.notas ? `<div class="text-[10px] text-slate-400 italic mt-1 bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/80">${cta.notas}</div>` : ''}
          </div>

          <!-- Balance Amounts -->
          <div class="text-right font-mono shrink-0">
            <div class="text-[10px] ${datosEnv.tieneEnvio && esCobrar && !esPagado ? 'text-emerald-400 font-bold' : 'text-slate-400'}">
              ${datosEnv.tieneEnvio && esCobrar && !esPagado ? 'Neto Real Sistema:' : 'Saldo Pendiente:'}
            </div>
            <div class="text-sm font-black ${esPagado ? 'text-slate-400 line-through' : (esCobrar ? 'text-emerald-400' : 'text-rose-400')}">
              ${fmtCRC(datosEnv.tieneEnvio && esCobrar && !esPagado ? datosEnv.valorNetoCRC : saldoCRC)}
            </div>
            <div class="text-[10px] text-slate-400">
              ${fmtUSD(datosEnv.tieneEnvio && esCobrar && !esPagado ? datosEnv.valorNetoUSD : saldoUSD)}
            </div>
            ${datosEnv.tieneEnvio && esCobrar && !esPagado ? `
              <div class="text-[9px] text-slate-400 mt-0.5">
                <span>Venta: <b>${fmtCRC(datosEnv.valorClienteCRC)}</b></span><br>
                <span class="text-rose-400">Envío: <b>-${fmtCRC(datosEnv.envioPendienteCRC)}</b></span>
              </div>
            ` : (totalCRC > saldoCRC ? `<div class="text-[9px] text-slate-500">Total orig: ${fmtCRC(totalCRC)}</div>` : '')}
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 gap-2">
          <div class="flex items-center gap-1.5">
            ${cta.telefono ? `
              <a href="https://wa.me/506${cta.telefono.replace(/[^0-9]/g, '')}?text=Hola%20${encodeURIComponent(cta.entidad)},%20te%20saludamos%20de%20DC%20El%20Destape.%20Te%20recordamos%20el%20saldo%20pendiente%20de%20${encodeURIComponent(fmtCRC(datosEnv.valorClienteCRC))}.%20¡Pura%20vida!" target="_blank"
                class="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-400 rounded-lg text-[10px] font-bold flex items-center gap-1 active:scale-95"
                title="Enviar reporte al cliente por WhatsApp (monto de venta sin descontar envío)">
                <i data-lucide="message-circle" class="w-3 h-3"></i>
                <span>WhatsApp (${fmtCRC(datosEnv.valorClienteCRC)})</span>
              </a>
            ` : ''}
            <button onclick="eliminarCuenta('${cta.id}')" class="px-2 py-1 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 rounded-lg text-[10px] active:scale-95 transition-all">
              Eliminar
            </button>
          </div>

          ${!esPagado ? `
            <div class="flex items-center gap-1.5">
              <button onclick="abrirModalAbonoCuenta('${cta.id}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95 shadow-md shadow-indigo-600/30">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                <span>Abonar</span>
              </button>
              <button onclick="liquidarCuentaDirecto('${cta.id}')" class="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95" title="${datosEnv.tieneEnvio ? `Liquidar neto: ${fmtCRC(datosEnv.valorNetoCRC)} (Venta: ${fmtCRC(datosEnv.valorClienteCRC)} - Envío: ${fmtCRC(datosEnv.envioPendienteCRC)})` : 'Liquidar cuenta completa'}">
                <i data-lucide="check" class="w-3.5 h-3.5"></i>
                <span>Liquidar</span>
              </button>
            </div>
          ` : `
            <span class="text-[10px] text-emerald-400 font-bold font-mono flex items-center gap-1">
              <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Pagado totalmente
            </span>
          `}
        </div>
      </div>
    `;
  }).join("") + '<div class="h-6"></div>';

  inicializarIconos();
}

// --- Abonos a Cuentas ---
function abrirModalAbonoCuenta(idCuenta) {
  const cta = state.cuentas.find(c => c.id === idCuenta);
  if (!cta) return;

  const datosEnv = obtenerDatosEnvioCuenta(cta);

  document.getElementById("abonoCuentaId").value = idCuenta;
  document.getElementById("abonoEntidadNombre").textContent = `${cta.tipo}: ${cta.entidad}`;
  
  const saldoCRC = datosEnv.valorClienteCRC;
  const saldoUSD = datosEnv.valorClienteUSD;

  const elCRC = document.getElementById("abonoSaldoActualCRC");
  const elUSD = document.getElementById("abonoSaldoActualUSD");
  if (elCRC) {
    if (datosEnv.tieneEnvio && cta.tipo === "Por Cobrar") {
      elCRC.innerHTML = `<span>${fmtCRC(saldoCRC)}</span> <span class="text-[11px] text-emerald-400 font-normal block mt-0.5">(Neto real a recibir: ${fmtCRC(datosEnv.valorNetoCRC)} • Envío: -${fmtCRC(datosEnv.envioPendienteCRC)})</span>`;
    } else {
      elCRC.textContent = fmtCRC(saldoCRC);
    }
  }
  if (elUSD) elUSD.textContent = fmtUSD(saldoUSD);

  document.getElementById("abonoMontoCRC").value = "";
  document.getElementById("abonoMontoUSD").value = "";
  document.getElementById("abonoNota").value = "";

  const modal = document.getElementById("modalAbonoCuenta");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
  setTimeout(() => document.getElementById("abonoMontoCRC").focus(), 150);
}

function cerrarModalAbonoCuenta() {
  const modal = document.getElementById("modalAbonoCuenta");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function llenarAbonoTotal() {
  const idCuenta = document.getElementById("abonoCuentaId").value;
  const cta = state.cuentas.find(c => c.id === idCuenta);
  if (!cta) return;

  const datosEnv = obtenerDatosEnvioCuenta(cta);
  const saldoCRC = datosEnv.valorClienteCRC;
  const tc = Number(state.config.tipoCambio || 520);
  const saldoUSD = parseFloat((saldoCRC / tc).toFixed(2));

  document.getElementById("abonoMontoCRC").value = saldoCRC;
  document.getElementById("abonoMontoUSD").value = saldoUSD;
}

function autoConvertirAbono(fuente) {
  const tc = Number(state.config.tipoCambio || 520);
  const inCRC = document.getElementById("abonoMontoCRC");
  const inUSD = document.getElementById("abonoMontoUSD");

  if (fuente === "CRC") {
    const valCRC = parseFloat(inCRC.value) || 0;
    inUSD.value = valCRC > 0 ? (valCRC / tc).toFixed(2) : "";
  } else {
    const valUSD = parseFloat(inUSD.value) || 0;
    inCRC.value = valUSD > 0 ? Math.round(valUSD * tc) : "";
  }
}

function guardarAbonoCuenta() {
  const idCuenta = document.getElementById("abonoCuentaId").value;
  const cta = state.cuentas.find(c => c.id === idCuenta);
  if (!cta) return;

  const datosEnv = obtenerDatosEnvioCuenta(cta);
  const abonoCRC = parseFloat(document.getElementById("abonoMontoCRC").value) || 0;
  const abonoUSD = parseFloat(document.getElementById("abonoMontoUSD").value) || 0;
  const metodo = document.getElementById("abonoMetodoPago").value;
  const nota = document.getElementById("abonoNota").value.trim();

  if (abonoCRC <= 0 && abonoUSD <= 0) {
    mostrarToast("Ingresa un monto válido para el abono.", "error");
    return;
  }

  const saldoAnteriorCRC = Number(cta.saldoPendienteCRC !== undefined ? cta.saldoPendienteCRC : cta.montoTotalCRC);
  const saldoAnteriorUSD = Number(cta.saldoPendienteUSD !== undefined ? cta.saldoPendienteUSD : cta.montoTotalUSD);

  const nuevoSaldoCRC = Math.max(0, saldoAnteriorCRC - abonoCRC);
  const nuevoSaldoUSD = Math.max(0, saldoAnteriorUSD - abonoUSD);
  const nuevoEstado = nuevoSaldoCRC <= 0 ? "Pagado" : "Parcial";

  cta.saldoPendienteCRC = nuevoSaldoCRC;
  cta.saldoPendienteUSD = nuevoSaldoUSD;
  cta.estado = nuevoEstado;
  const notaExtra = ` [Abono ₡${abonoCRC} (${metodo}) el ${new Date().toLocaleDateString()}${nota ? ': ' + nota : ''}]`;
  cta.notas = (cta.notas || "") + notaExtra;

  guardarCuentasLocal();

  // Encolar acción para sincronizar con Google Sheets
  encolarAccionSincronizacion("abonarCuenta", {
    id: idCuenta,
    abonoCRC,
    abonoUSD,
    notas: `${metodo} - ${nota}`
  });

  cerrarModalAbonoCuenta();
  renderizarCuentas();
  renderizarFinanzas();
  renderizarDashboard();

  if (nuevoEstado === "Pagado") {
    mostrarToast(`¡Cuenta de ${cta.entidad} liquidada completamente! Dinero ingresado a Caja 💵`, "success");
    if (window.confetti) window.confetti({ particleCount: 70, spread: 60, origin: { y: 0.8 } });
  } else {
    mostrarToast(`Abono de ${fmtCRC(abonoCRC)} registrado. Saldo restante: ${fmtCRC(nuevoSaldoCRC)} 💵`, "success");
  }
}

function liquidarCuentaDirecto(idCuenta) {
  const cta = state.cuentas.find(c => c.id === idCuenta);
  if (!cta) return;

  const datosEnv = obtenerDatosEnvioCuenta(cta);
  const valorClienteCRC = datosEnv.valorClienteCRC;
  const valorNetoCRC = datosEnv.valorNetoCRC;
  const envioCRC = datosEnv.envioPendienteCRC;

  let mensajeConfirm = "";
  if (datosEnv.tieneEnvio && cta.tipo === "Por Cobrar") {
    mensajeConfirm = `¿Confirmas liquidar la cuenta de ${cta.entidad}?\n\n` +
      `• Cobrado al cliente (Venta): ${fmtCRC(valorClienteCRC)}\n` +
      `• Costo de envío descontado: -${fmtCRC(envioCRC)}\n` +
      `------------------------------------\n` +
      `• INGRESO NETO REAL A CAJA: ${fmtCRC(valorNetoCRC)}\n\n` +
      `¿Deseas registrar la liquidación completa?`;
  } else {
    mensajeConfirm = `¿Confirmas liquidar el saldo total de ${fmtCRC(valorClienteCRC)} de ${cta.entidad}?`;
  }

  if (!confirm(mensajeConfirm)) return;

  cta.saldoPendienteCRC = 0;
  cta.saldoPendienteUSD = 0;
  cta.estado = "Pagado";
  const notaLiquidacion = datosEnv.tieneEnvio && cta.tipo === "Por Cobrar"
    ? ` [Liquidado total: Cliente pagó ${fmtCRC(valorClienteCRC)}, Envío: -${fmtCRC(envioCRC)}, Ingreso neto real a caja: ${fmtCRC(valorNetoCRC)} el ${new Date().toLocaleDateString()}]`
    : ` [Liquidado total ${fmtCRC(valorClienteCRC)} el ${new Date().toLocaleDateString()}]`;
  cta.notas = (cta.notas || "") + notaLiquidacion;

  guardarCuentasLocal();
  encolarAccionSincronizacion("abonarCuenta", {
    id: idCuenta,
    abonoCRC: valorClienteCRC,
    abonoNetoCRC: valorNetoCRC,
    costoEnvioCRC: envioCRC,
    abonoUSD: datosEnv.valorClienteUSD,
    notas: `Liquidación completa (Neto caja: ${fmtCRC(valorNetoCRC)})`
  });

  renderizarCuentas();
  renderizarFinanzas();
  renderizarDashboard();
  
  const msgToast = datosEnv.tieneEnvio && cta.tipo === "Por Cobrar"
    ? `¡Cuenta de ${cta.entidad} liquidada! Ingreso neto a Caja: ${fmtCRC(valorNetoCRC)} (Envío: -${fmtCRC(envioCRC)}) 💵`
    : `¡Cuenta de ${cta.entidad} liquidada totalmente! Dinero sumado a Caja 💵`;
  mostrarToast(msgToast, "success");
  if (window.confetti) window.confetti({ particleCount: 70, spread: 60, origin: { y: 0.8 } });
}

function eliminarCuenta(idCuenta) {
  if (!confirm("¿Deseas eliminar este registro de cuenta pendiente?")) return;
  state.cuentas = state.cuentas.filter(c => c.id !== idCuenta);
  guardarCuentasLocal();
  renderizarCuentas();
  renderizarFinanzas();
  renderizarDashboard();
  mostrarToast("Cuenta eliminada.", "info");
  encolarAccionSincronizacion("eliminarCuenta", { id: idCuenta });
}

// --- Crear Cuenta Manual ---
function setTipoNuevaCuenta(tipo) {
  document.getElementById("nuevaCtaTipo").value = tipo;
  const btnCobrar = document.getElementById("btnTipoCtaCobrar");
  const btnPagar = document.getElementById("btnTipoCtaPagar");
  const lbl = document.getElementById("lblNuevaCtaEntidad");

  if (tipo === "Por Cobrar") {
    btnCobrar.className = "py-2.5 rounded-xl bg-emerald-600 text-white text-center border border-transparent";
    btnPagar.className = "py-2.5 rounded-xl bg-slate-800 text-slate-400 text-center border border-slate-700";
    if (lbl) lbl.textContent = "Nombre del Cliente *";
  } else {
    btnPagar.className = "py-2.5 rounded-xl bg-rose-600 text-white text-center border border-transparent";
    btnCobrar.className = "py-2.5 rounded-xl bg-slate-800 text-slate-400 text-center border border-slate-700";
    if (lbl) lbl.textContent = "Nombre del Proveedor *";
  }
}

function abrirModalNuevaCuenta() {
  document.getElementById("nuevaCtaEntidad").value = "";
  document.getElementById("nuevaCtaTelefono").value = "";
  document.getElementById("nuevaCtaMontoCRC").value = "";
  document.getElementById("nuevaCtaMontoUSD").value = "";
  document.getElementById("nuevaCtaVencimiento").value = "";
  document.getElementById("nuevaCtaNotas").value = "";
  setTipoNuevaCuenta("Por Cobrar");

  const modal = document.getElementById("modalNuevaCuenta");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
}

function cerrarModalNuevaCuenta() {
  const modal = document.getElementById("modalNuevaCuenta");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function autoConvertirNuevaCta(fuente) {
  const tc = Number(state.config.tipoCambio || 520);
  const inCRC = document.getElementById("nuevaCtaMontoCRC");
  const inUSD = document.getElementById("nuevaCtaMontoUSD");

  if (fuente === "CRC") {
    const valCRC = parseFloat(inCRC.value) || 0;
    inUSD.value = valCRC > 0 ? (valCRC / tc).toFixed(2) : "";
  } else {
    const valUSD = parseFloat(inUSD.value) || 0;
    inCRC.value = valUSD > 0 ? Math.round(valUSD * tc) : "";
  }
}

function guardarNuevaCuentaManual() {
  const tipo = document.getElementById("nuevaCtaTipo").value || "Por Cobrar";
  const entidad = document.getElementById("nuevaCtaEntidad").value.trim();
  const telefono = document.getElementById("nuevaCtaTelefono").value.trim();
  const montoCRC = parseFloat(document.getElementById("nuevaCtaMontoCRC").value) || 0;
  const montoUSD = parseFloat(document.getElementById("nuevaCtaMontoUSD").value) || 0;
  const vencimiento = document.getElementById("nuevaCtaVencimiento").value;
  const vendedor = document.getElementById("nuevaCtaVendedor").value || "Carlos";
  const notas = document.getElementById("nuevaCtaNotas").value.trim();

  if (!entidad) {
    mostrarToast("Ingresa el nombre del cliente o proveedor.", "error");
    return;
  }
  if (montoCRC <= 0 && montoUSD <= 0) {
    mostrarToast("Ingresa un monto válido.", "error");
    return;
  }

  const id = "CTA-" + Date.now().toString().slice(-6);
  const cuentaObj = {
    id,
    fecha: new Date().toISOString(),
    tipo,
    entidad,
    telefono,
    referenciaId: "MANUAL",
    montoTotalCRC: montoCRC,
    montoTotalUSD: montoUSD,
    saldoPendienteCRC: montoCRC,
    saldoPendienteUSD: montoUSD,
    estado: "Pendiente",
    fechaVencimiento: vencimiento,
    vendedor,
    notas
  };

  state.cuentas.unshift(cuentaObj);
  guardarCuentasLocal();
  encolarAccionSincronizacion("registrarCuenta", { cuenta: cuentaObj });

  cerrarModalNuevaCuenta();
  renderizarCuentas();
  mostrarToast(`Cuenta pendiente para ${entidad} guardada con éxito 📋`, "success");
}

// --- Editar precio de ítem en el carrito ---
function editarPrecioCarrito(codigo) {
  const codNorm = String(codigo).trim().toUpperCase();
  const item = state.carrito.find(i => String(i.codigo).trim().toUpperCase() === codNorm);
  if (!item) return;

  const prod = state.productos[codNorm] || state.productos[item.codigo];
  const precioCatalogo = prod ? Number(prod.precioVentaCRC || 0) : item.precioVentaCRC;
  if (item.precioOriginalCRC === undefined) {
    item.precioOriginalCRC = precioCatalogo;
  }

  const nombreEl = document.getElementById("editPrecioProductoNombre");
  const origEl = document.getElementById("editPrecioOriginal");
  const inputEl = document.getElementById("editPrecioInput");
  const codEl = document.getElementById("editPrecioCodigo");

  if (nombreEl) nombreEl.textContent = item.nombre;
  if (origEl) origEl.textContent = fmtCRC(item.precioOriginalCRC);
  if (inputEl) inputEl.value = item.precioVentaCRC;
  if (codEl) codEl.value = item.codigo;

  actualizarPreviewPrecioUSD();

  const modal = document.getElementById("modalEditarPrecio");
  if (modal) { 
    modal.classList.remove("hidden"); 
    modal.classList.add("flex"); 
  }
  setTimeout(() => {
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  }, 100);
}

function actualizarPreviewPrecioUSD() {
  const inputEl = document.getElementById("editPrecioInput");
  const equivEl = document.getElementById("editPrecioEquivUSD");
  if (!inputEl || !equivEl) return;
  const crc = parseNum(inputEl.value, 0);
  const tc = Number(state.config.tipoCambio) || 520;
  const usd = tc > 0 ? (crc / tc) : 0;
  equivEl.textContent = crc > 0 ? `≈ ${fmtUSD(usd)} USD` : "";
}

function ajustarPrecioDescuento(pct) {
  const codEl = document.getElementById("editPrecioCodigo");
  const inputEl = document.getElementById("editPrecioInput");
  if (!codEl || !inputEl) return;
  const codNorm = String(codEl.value).trim().toUpperCase();
  const item = state.carrito.find(i => String(i.codigo).trim().toUpperCase() === codNorm);
  if (!item) return;

  const base = item.precioOriginalCRC !== undefined ? item.precioOriginalCRC : item.precioVentaCRC;
  const nuevo = Math.round(base * (1 - pct));
  inputEl.value = nuevo;
  actualizarPreviewPrecioUSD();
}

function restablecerPrecioOriginal() {
  const codEl = document.getElementById("editPrecioCodigo");
  const inputEl = document.getElementById("editPrecioInput");
  if (!codEl || !inputEl) return;
  const codNorm = String(codEl.value).trim().toUpperCase();
  const item = state.carrito.find(i => String(i.codigo).trim().toUpperCase() === codNorm);
  if (!item) return;

  const base = item.precioOriginalCRC !== undefined ? item.precioOriginalCRC : item.precioVentaCRC;
  inputEl.value = base;
  actualizarPreviewPrecioUSD();
}

function aplicarNuevoPrecioCarrito() {
  const codEl = document.getElementById("editPrecioCodigo");
  const inputEl = document.getElementById("editPrecioInput");
  if (!codEl || !inputEl) return;

  const codigo = codEl.value;
  const codNorm = String(codigo).trim().toUpperCase();
  const nuevoPrecio = parseNum(inputEl.value, -1);

  if (nuevoPrecio < 0) { 
    mostrarToast("El precio no puede ser negativo.", "error"); 
    return; 
  }

  const item = state.carrito.find(i => String(i.codigo).trim().toUpperCase() === codNorm);
  if (item) {
    const tc = Number(state.config.tipoCambio) || 520;
    item.precioVentaCRC = nuevoPrecio;
    item.precioCRC = nuevoPrecio;
    item.precioVentaUSD = parseFloat((nuevoPrecio / tc).toFixed(2));
    item.precioUSD = parseFloat((nuevoPrecio / tc).toFixed(2));
    item._precioEditado = true;
  }

  cerrarModalEditarPrecio();
  renderizarCarrito();
  mostrarToast(`Precio actualizado: ${fmtCRC(nuevoPrecio)} ✅`, "success");
}

function cerrarModalEditarPrecio() {
  const modal = document.getElementById("modalEditarPrecio");
  if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
}

// ==========================================================================
// FORMATEADOR DE IMÁGENES / GOOGLE DRIVE
// ==========================================================================

// --------------------------------------------------------------------------
// LIGHTBOX: Foto en pantalla completa (para mostrar a clientes)
// --------------------------------------------------------------------------
function abrirFotoCompleta(url, nombre) {
  const modal = document.getElementById("modalFotoCompleta");
  const img = document.getElementById("fotoCompletaImg");
  const nombreEl = document.getElementById("fotoCompletaNombre");

  if (!modal || !img) return;

  if (!url) {
    mostrarToast("Este licor no tiene foto asignada", "info");
    return;
  }

  // Intentar cargar la URL principal; si falla intentar thumbnail más grande
  img.onerror = function() {
    this.onerror = null;
    // Extraer driveId si está en el src
    const idMatch = this.src.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      this.src = `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1200`;
    } else {
      // Sin fallback posible — ocultar imagen rota
      this.style.display = 'none';
    }
  };

  // Asegurarse de que el src siempre se actualice correctamente
  img.src = "";
  img.style.display = "";
  img.src = formatearUrlImagen(url);
  img.alt = nombre || "Licor";

  if (nombreEl) {
    const p = nombreEl.querySelector("p");
    if (p) p.textContent = nombre || "";
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();

  // Bloquear scroll de fondo
  document.body.style.overflow = "hidden";
}

function cerrarFotoCompleta() {
  const modal = document.getElementById("modalFotoCompleta");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  document.body.style.overflow = "";
}

// Cerrar con tecla Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarFotoCompleta();
});

// Delegación de eventos para fotos de productos en inventario (compatible móvil)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".foto-producto-btn");
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    const url = btn.dataset.url || "";
    const nombre = btn.dataset.nombre || "";
    abrirFotoCompleta(url, nombre);
  }
}, { passive: false });



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
    // drive.google.com/thumbnail?id=ID&sz=w400 funciona en móvil y escritorio sin restricciones CORS
    // lh3.googleusercontent.com/d/ID puede fallar en Android/iOS sin autenticación
    return `https://drive.google.com/thumbnail?id=${driveId}&sz=w400`;
  }

  // 3. URLs web directas (http/https)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  return trimmed;
}

function actualizarPreviewImagenModal() {
  const input = document.getElementById("prodImagenUrl");
  const preview = document.getElementById("prodImagenPreview");
  const placeholder = document.getElementById("prodImagenPlaceholder");
  const btnLimpiar = document.getElementById("btnLimpiarImagen");

  if (!input || !preview || !placeholder) return;

  const raw = (input.value || "").trim();
  if (!raw) {
    preview.src = "";
    preview.classList.add("hidden");
    placeholder.classList.remove("hidden");
    placeholder.innerHTML = `<i data-lucide="wine" class="w-6 h-6 text-slate-600 mb-0.5"></i><span>Sin foto</span>`;
    if (btnLimpiar) btnLimpiar.classList.add("hidden");
    inicializarIconos();
    return;
  }

  const formattedUrl = formatearUrlImagen(raw);
  preview.src = formattedUrl;
  preview.classList.remove("hidden");
  placeholder.classList.add("hidden");
  if (btnLimpiar) btnLimpiar.classList.remove("hidden");
}

function onImgPreviewError() {
  const preview = document.getElementById("prodImagenPreview");
  const placeholder = document.getElementById("prodImagenPlaceholder");
  
  // Intentar fallback si es de Google Drive
  if (preview && preview.src && preview.src.includes("lh3.googleusercontent.com/d/")) {
    const id = preview.src.split("/d/")[1];
    preview.src = `https://drive.google.com/thumbnail?id=${id}&sz=w500`;
    return;
  }

  if (preview) {
    preview.classList.add("hidden");
  }
  if (placeholder) {
    placeholder.classList.remove("hidden");
    placeholder.innerHTML = `<i data-lucide="alert-circle" class="w-6 h-6 text-amber-500 mb-0.5"></i><span class="text-amber-400 text-[10px]">No cargó imagen</span>`;
    inicializarIconos();
  }
}

function manejarSubidaImagenProducto(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    mostrarToast("El archivo seleccionado no es una imagen válida", "error");
    return;
  }

  mostrarToast("Procesando y optimizando imagen... ⏳", "info");

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // Redimensionar / comprimir imagen a máx 600px para no saturar memoria/almacenamiento
      const maxDim = 600;
      let width = img.width;
      let height = img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const base64Optimizada = canvas.toDataURL("image/jpeg", 0.82);
      const input = document.getElementById("prodImagenUrl");
      if (input) {
        input.value = base64Optimizada;
        actualizarPreviewImagenModal();
        mostrarToast("Foto cargada con éxito 📸", "success");
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function limpiarImagenModal() {
  const input = document.getElementById("prodImagenUrl");
  if (input) input.value = "";
  actualizarPreviewImagenModal();
}

// ==========================================================================
// MODAL DE PRODUCTO (DUAL CURRENCY & FOTO)
// ==========================================================================
function abrirModalProducto(productoOcodigo = null) {
  const modal = document.getElementById("modalProducto");
  const titulo = document.getElementById("modalProductoTitulo");
  const btnEliminar = document.getElementById("btnEliminarProducto");

  let producto = null;
  if (typeof productoOcodigo === "string") {
    producto = state.productos[productoOcodigo] || null;
  } else if (productoOcodigo && typeof productoOcodigo === "object") {
    producto = productoOcodigo;
  }

  if (producto) {
    titulo.innerHTML = `<i data-lucide="edit" class="w-5 h-5 text-amber-400"></i> Editar Licor (${producto.codigo})`;
    document.getElementById("prodCodigo").value = producto.codigo || "";
    document.getElementById("prodCodigo").disabled = true;
    document.getElementById("prodNombre").value = producto.nombre || "";
    document.getElementById("prodCategoria").value = producto.categoria || "";
    document.getElementById("prodImagenUrl").value = producto.imagenUrl || "";
    const cUSD = Number(producto.costoRefUSD || 0);
    const pUSD = Number(producto.precioVentaUSD || 0);
    document.getElementById("prodCostoRefUSD").value = cUSD;
    document.getElementById("prodCostoRefCRC").value = Number(producto.costoRefCRC || 0);
    
    // Si ya tiene costo y precio, calcular el margen que tiene actualmente
    let margenActual = 80;
    if (cUSD > 0 && pUSD >= cUSD) {
      margenActual = Number((((pUSD - cUSD) / cUSD) * 100).toFixed(1));
    }
    document.getElementById("prodMargenPorcentaje").value = margenActual;
    
    document.getElementById("prodPrecioVentaUSD").value = pUSD;
    document.getElementById("prodPrecioVentaCRC").value = Number(producto.precioVentaCRC || 0);
    document.getElementById("prodStock").value = 0; // No se usa: el stock real viene de compras/ventas
    document.getElementById("prodStockMinimo").value = Number(producto.stockMinimo || 2);
    
    calcularMargenYPrecioRecomendado('costoUSD', false);
    if (btnEliminar) btnEliminar.classList.remove("hidden");
  } else {
    titulo.innerHTML = `<i data-lucide="wine" class="w-5 h-5 text-amber-400"></i> Nuevo Licor`;
    document.getElementById("formProducto").reset();
    document.getElementById("prodCodigo").disabled = false;
    document.getElementById("prodCodigo").value = "LIC-" + Math.floor(100 + Math.random() * 900);
    document.getElementById("prodImagenUrl").value = "";
    document.getElementById("prodMargenPorcentaje").value = 80;
    document.getElementById("prodStockMinimo").value = 2;
    document.getElementById("prodCostoRefUSD").value = "";
    document.getElementById("prodCostoRefCRC").value = "0";
    document.getElementById("prodPrecioRecomendadoUSD").value = "0";
    document.getElementById("prodPrecioVentaUSD").value = "";
    document.getElementById("prodPrecioVentaCRC").value = "";
    if (btnEliminar) btnEliminar.classList.add("hidden");
  }

  actualizarPreviewImagenModal();
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();
}

function cerrarModalProducto() {
  const modal = document.getElementById("modalProducto");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function editarProducto(codigo) {
  const p = state.productos[codigo];
  if (p) abrirModalProducto(p);
}

// --------------------------------------------------------------------------
// CÁLCULO DE MARGEN (%) Y PRECIO RECOMENDADO SEGÚN FÓRMULA DEL USUARIO:
// Precio Recomendado = Precio Costo + (Precio Costo / 100 * Margen%)
// --------------------------------------------------------------------------
function calcularMargenYPrecioRecomendado(origen = 'costoUSD', autoAplicarVenta = true) {
  const tc = Number(state.config.tipoCambio) || 520;
  const costoUSD = parseFloat(document.getElementById("prodCostoRefUSD").value) || 0;
  const margenPct = parseFloat(document.getElementById("prodMargenPorcentaje").value) || 0;

  // 1. Costo Ref. en CRC automático: Costo USD * Tipo de Cambio
  const costoCRC = Math.round(costoUSD * tc);
  const inCostoCRC = document.getElementById("prodCostoRefCRC");
  if (inCostoCRC) inCostoCRC.value = costoCRC;

  // 2. Fórmula exacta: Costo + (Costo / 100 * Margen%)
  const precioRecomendadoUSD = costoUSD + (costoUSD * (margenPct / 100));
  const inRecUSD = document.getElementById("prodPrecioRecomendadoUSD");
  if (inRecUSD) inRecUSD.value = precioRecomendadoUSD > 0 ? precioRecomendadoUSD.toFixed(2) : "0";

  // 3. Si es un producto nuevo o se cambia el costo/margen, sugerir en los campos de venta si están vacíos o si autoAplicarVenta es true
  const inVentaUSD = document.getElementById("prodPrecioVentaUSD");
  const inVentaCRC = document.getElementById("prodPrecioVentaCRC");
  
  if (autoAplicarVenta && inVentaUSD) {
    inVentaUSD.value = precioRecomendadoUSD > 0 ? precioRecomendadoUSD.toFixed(2) : "";
    if (inVentaCRC) {
      inVentaCRC.value = precioRecomendadoUSD > 0 ? Math.round(precioRecomendadoUSD * tc) : "";
    }
  }
}

function aplicarPrecioRecomendado() {
  const recUSD = parseFloat(document.getElementById("prodPrecioRecomendadoUSD").value) || 0;
  if (recUSD <= 0) {
    mostrarToast("Ingresa primero el precio de costo en USD.", "info");
    return;
  }
  const tc = Number(state.config.tipoCambio) || 520;
  document.getElementById("prodPrecioVentaUSD").value = recUSD.toFixed(2);
  document.getElementById("prodPrecioVentaCRC").value = Math.round(recUSD * tc);
  mostrarToast("Precio recomendado aplicado a la venta 💵", "success");
}

function autoConvertirPrecio(origen) {
  const tc = Number(state.config.tipoCambio) || 520;
  if (origen === 'USD') {
    const usd = Number(document.getElementById("prodPrecioVentaUSD").value) || 0;
    document.getElementById("prodPrecioVentaCRC").value = usd > 0 ? Math.round(usd * tc) : "";
  } else {
    const crc = Number(document.getElementById("prodPrecioVentaCRC").value) || 0;
    document.getElementById("prodPrecioVentaUSD").value = crc > 0 ? (crc / tc).toFixed(2) : "";
  }
}

async function guardarProductoForm(e) {
  e.preventDefault();
  const codigo = document.getElementById("prodCodigo").value.trim().toUpperCase();
  const nombre = document.getElementById("prodNombre").value.trim();
  const categoria = document.getElementById("prodCategoria").value.trim() || "General";
  const imagenUrl = document.getElementById("prodImagenUrl").value.trim();
  const precioVentaUSD = Number(document.getElementById("prodPrecioVentaUSD").value) || 0;
  const precioVentaCRC = Number(document.getElementById("prodPrecioVentaCRC").value) || 0;
  const costoRefUSD = Number(document.getElementById("prodCostoRefUSD").value) || 0;
  const costoRefCRC = Number(document.getElementById("prodCostoRefCRC").value) || 0;
  const stockInicial = 0; // No se usa: el stock se calcula dinámicamente desde compras - ventas
  const stockMinimo = Number(document.getElementById("prodStockMinimo").value) || 2;

  const prodObj = {
    codigo,
    nombre,
    categoria,
    imagenUrl,
    precioVentaUSD,
    precioVentaCRC,
    costoRefUSD,
    costoRefCRC,
    stockInicial,
    stockMinimo
  };

  const esEdicion = !!state.productos[codigo];
  state.productos[codigo] = prodObj;
  guardarProductosLocal();
  
  // Si la categoría actual filtrada no coincide con la del nuevo producto, poner en "Todas"
  if (state.categoriaSeleccionada !== "Todas" && state.categoriaSeleccionada !== categoria) {
    state.categoriaSeleccionada = "Todas";
  }
  
  // Limpiar texto de búsqueda para mostrar la lista completa
  const inSearch = document.getElementById("searchInventory");
  if (inSearch && inSearch.value) inSearch.value = "";

  renderizarTodo();
  cerrarModalProducto();
  mostrarToast(esEdicion ? "Producto actualizado correctamente." : "Producto agregado correctamente.", "success");

  // Encolar y sincronizar
  encolarAccionSincronizacion(esEdicion ? "actualizarProducto" : "crearProducto", { producto: prodObj });
}

async function eliminarProductoActual() {
  const codigo = document.getElementById("prodCodigo").value;
  if (!confirm(`¿Eliminar definitivamente el producto ${codigo}?`)) return;

  delete state.productos[codigo];
  guardarProductosLocal();

  const inSearch = document.getElementById("searchInventory");
  if (inSearch && inSearch.value) inSearch.value = "";

  renderizarTodo();
  cerrarModalProducto();
  mostrarToast("Producto eliminado correctamente.", "info");

  // Encolar y sincronizar
  encolarAccionSincronizacion("eliminarProducto", { codigo });
}

// ==========================================================================
// 3. COMPRAS / ENTRADAS (Búsqueda predictiva y selección)
// ==========================================================================
function poblarSelectCompras() {
  const cod = document.getElementById("compraProductoCodigo")?.value;
  if (!cod) {
    limpiarSeleccionProductoCompra(false);
  }
}

function filtrarProductosCompra(q) {
  const dropdown = document.getElementById("compraProductoSugerencias");
  if (!dropdown) return;

  const ql = (q || "").trim().toLowerCase();
  const prods = Object.values(state.productos).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const stockMap = calcularStockPorCodigo();

  const filtrados = ql.length === 0
    ? prods.slice(0, 8)
    : prods.filter(p => 
        p.nombre.toLowerCase().includes(ql) || 
        p.codigo.toLowerCase().includes(ql) || 
        (p.categoria && p.categoria.toLowerCase().includes(ql))
      ).slice(0, 10);

  if (filtrados.length === 0) {
    dropdown.innerHTML = `
      <div class="p-3 text-xs text-slate-400 text-center">
        No se encontró ningún producto con "<strong>${q}</strong>".
      </div>
    `;
    dropdown.classList.remove("hidden");
    return;
  }

  dropdown.innerHTML = filtrados.map(p => {
    const imgUrl = formatearUrlImagen(p.imagenUrl);
    const imgHtml = imgUrl
      ? `<img src="${imgUrl}" alt="${p.nombre}" class="w-8 h-8 rounded-lg object-cover bg-slate-900 border border-slate-700 shrink-0" onerror="this.outerHTML='<div class=\\'w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-xs shrink-0\\'>🍷</div>'">`
      : `<div class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-xs shrink-0">🍷</div>`;

    const stock = stockMap[p.codigo] || 0;
    return `
      <div onclick="seleccionarProductoCompraPorCodigo('${p.codigo}')" class="px-3 py-2.5 hover:bg-slate-700/80 cursor-pointer flex items-center justify-between gap-2.5 transition-colors">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          ${imgHtml}
          <div class="min-w-0 flex-1">
            <div class="text-xs font-bold text-white truncate">${p.nombre}</div>
            <div class="text-[11px] text-slate-400 font-mono">${p.codigo} • ${p.categoria || 'Licor'}</div>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[11px] font-mono font-bold ${stock > 0 ? 'text-emerald-400' : 'text-slate-400'}">Stock: ${stock}</div>
          <div class="text-[10px] text-slate-500 font-mono">$${(p.costoRefUSD||0).toFixed(2)}</div>
        </div>
      </div>
    `;
  }).join("");

  dropdown.classList.remove("hidden");
  inicializarIconos();
}

function seleccionarProductoCompraPorCodigo(codigo) {
  const prod = state.productos[codigo];
  if (!prod) return;

  const tc = Number(document.getElementById("compraTipoCambio").value) || Number(state.config.tipoCambio) || 520;

  // Llenar campos del editor rápido de item
  document.getElementById("compraItemEditorCodigo").value = codigo;
  document.getElementById("compraItemEditorNombre").textContent = `${prod.nombre} (${prod.codigo})`;
  
  const imgUrl = formatearUrlImagen(prod.imagenUrl);
  const container = document.getElementById("compraItemEditorImg");
  if (container) {
    container.innerHTML = imgUrl
      ? `<img src="${imgUrl}" alt="${prod.nombre}" class="w-7 h-7 rounded-lg object-cover" onerror="this.outerHTML='🍷'">`
      : `🍷`;
  }

  // Pre-cargar costos de referencia
  const costoUSD = Number(prod.costoRefUSD || 0);
  const costoCRC = Number(prod.costoRefCRC || (costoUSD * tc));
  document.getElementById("compraItemEditorCantidad").value = 1;
  document.getElementById("compraItemEditorCostoUSD").value = costoUSD;
  document.getElementById("compraItemEditorCostoCRC").value = costoCRC;

  // Mostrar editor de item y ocultar dropdown
  document.getElementById("compraItemEditor")?.classList.remove("hidden");
  document.getElementById("compraProductoSugerencias")?.classList.add("hidden");
  document.getElementById("compraProductoBusqueda").value = "";

  document.getElementById("compraItemEditorCantidad")?.focus();
  inicializarIconos();
}

function cancelarItemCompra() {
  document.getElementById("compraItemEditor")?.classList.add("hidden");
  document.getElementById("compraProductoBusqueda").value = "";
}

function autoConvertirItemCompraCosto(origen) {
  const tc = Number(document.getElementById("compraTipoCambio").value) || Number(state.config.tipoCambio) || 520;
  const elUSD = document.getElementById("compraItemEditorCostoUSD");
  const elCRC = document.getElementById("compraItemEditorCostoCRC");
  if (origen === 'USD' && elUSD && elCRC) {
    const usd = Number(elUSD.value) || 0;
    elCRC.value = Math.round(usd * tc);
  } else if (origen === 'CRC' && elUSD && elCRC) {
    const crc = Number(elCRC.value) || 0;
    elUSD.value = (crc / tc).toFixed(2);
  }
}

function calcularSubtotalItemCompra() {
  // Función auxiliar para reactividad
}

function agregarItemAListaCompra() {
  const codigo = document.getElementById("compraItemEditorCodigo")?.value;
  const cant = Number(document.getElementById("compraItemEditorCantidad")?.value) || 0;
  const costoUSD = Number(document.getElementById("compraItemEditorCostoUSD")?.value) || 0;
  const costoCRC = Number(document.getElementById("compraItemEditorCostoCRC")?.value) || 0;

  if (!codigo || !state.productos[codigo]) {
    mostrarToast("Producto no válido", "error");
    return;
  }
  if (cant <= 0) {
    mostrarToast("La cantidad debe ser mayor a 0", "error");
    return;
  }

  const prod = state.productos[codigo];
  if (!state.listaCompraActual) state.listaCompraActual = [];

  const existente = state.listaCompraActual.find(i => i.codigo === codigo);
  if (existente) {
    existente.cantidad += cant;
    existente.costoUnitarioUSD = costoUSD;
    existente.costoUnitarioCRC = costoCRC;
  } else {
    state.listaCompraActual.push({
      codigo: prod.codigo,
      nombre: prod.nombre,
      imagenUrl: prod.imagenUrl || "",
      cantidad: cant,
      costoUnitarioUSD: costoUSD,
      costoUnitarioCRC: costoCRC
    });
  }

  document.getElementById("compraItemEditor")?.classList.add("hidden");
  document.getElementById("compraProductoBusqueda").value = "";
  renderizarListaCompraActual();
  mostrarToast(`+${cant} ${prod.nombre} añadido a la compra`, "success");
}

function modificarCantidadItemCompra(codigo, delta) {
  const item = state.listaCompraActual.find(i => i.codigo === codigo);
  if (!item) return;

  const nuevo = item.cantidad + delta;
  if (nuevo <= 0) {
    quitarItemDeListaCompra(codigo);
    return;
  }
  item.cantidad = nuevo;
  renderizarListaCompraActual();
}

function quitarItemDeListaCompra(codigo) {
  state.listaCompraActual = (state.listaCompraActual || []).filter(i => i.codigo !== codigo);
  renderizarListaCompraActual();
}

function vaciarListaCompra() {
  state.listaCompraActual = [];
  renderizarListaCompraActual();
}

function recalcularTotalesListaCompra() {
  renderizarListaCompraActual();
}

function renderizarListaCompraActual() {
  const cont = document.getElementById("compraListaItems");
  const countEl = document.getElementById("compraListaCount");
  const totalCRCEl = document.getElementById("compraTotalCRCDisplay");
  const totalUSDEl = document.getElementById("compraTotalUSDDisplay");
  if (!cont) return;

  const items = state.listaCompraActual || [];
  if (countEl) countEl.textContent = items.reduce((acc, i) => acc + i.cantidad, 0);

  let totalCRC = 0;
  let totalUSD = 0;

  if (items.length === 0) {
    cont.innerHTML = `
      <div class="py-4 text-center text-slate-500 text-xs">
        No has agregado productos a esta compra todavía.
      </div>
    `;
  } else {
    cont.innerHTML = items.map(item => {
      const subCRC = item.cantidad * item.costoUnitarioCRC;
      const subUSD = item.cantidad * item.costoUnitarioUSD;
      totalCRC += subCRC;
      totalUSD += subUSD;

      const imgUrl = formatearUrlImagen(item.imagenUrl);
      const imgHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${item.nombre}" class="w-8 h-8 rounded-lg object-cover bg-slate-900 border border-slate-700 shrink-0" onerror="this.outerHTML='🍷'">`
        : `🍷`;

      return `
        <div class="p-2 bg-slate-900/90 rounded-xl border border-slate-800 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-xs">${imgHtml}</div>
            <div class="min-w-0 flex-1">
              <h5 class="text-xs font-bold text-white truncate">${item.nombre}</h5>
              <div class="text-[10px] text-slate-400 font-mono">Costo: ₡${item.costoUnitarioCRC.toLocaleString()} ($${item.costoUnitarioUSD.toFixed(2)})</div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 bg-slate-800 rounded-lg p-1">
            <button type="button" onclick="modificarCantidadItemCompra('${item.codigo}', -1)" class="w-5 h-5 rounded bg-slate-700 text-white font-bold text-xs flex items-center justify-center active:scale-95">-</button>
            <span class="text-xs font-bold text-white w-4 text-center font-mono">${item.cantidad}</span>
            <button type="button" onclick="modificarCantidadItemCompra('${item.codigo}', 1)" class="w-5 h-5 rounded bg-slate-700 text-white font-bold text-xs flex items-center justify-center active:scale-95">+</button>
          </div>

          <div class="text-right min-w-[65px] font-mono">
            <div class="text-xs font-bold text-emerald-400">${fmtCRC(subCRC)}</div>
            <button type="button" onclick="quitarItemDeListaCompra('${item.codigo}')" class="text-[10px] text-rose-400 hover:text-rose-300">Quitar</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Sumar Costo de Envío de la Compra si se especificó
  const tc = Number(document.getElementById("compraTipoCambio")?.value) || Number(state.config.tipoCambio) || 520;
  const envioCRC = Number(document.getElementById("compraEnvioCRC")?.value) || 0;
  const envioUSD = tc > 0 ? (envioCRC / tc) : 0;

  totalCRC += envioCRC;
  totalUSD += envioUSD;

  if (totalCRCEl) totalCRCEl.textContent = fmtCRC(totalCRC);
  if (totalUSDEl) totalUSDEl.textContent = `${fmtUSD(totalUSD)} USD`;
  inicializarIconos();
}

function limpiarSeleccionProductoCompra(hacerFocus = true) {
  const busqueda = document.getElementById("compraProductoBusqueda");
  if (busqueda) busqueda.value = "";
  document.getElementById("compraItemEditor")?.classList.add("hidden");
  document.getElementById("compraProductoSugerencias")?.classList.add("hidden");
  if (hacerFocus && busqueda) busqueda.focus();
}

function cerrarDropdownProductosCompra(e) {
  if (!e.target.closest("#compraProductoSugerencias") && !e.target.closest("#compraProductoBusqueda")) {
    const dd = document.getElementById("compraProductoSugerencias");
    if (dd) dd.classList.add("hidden");
  }
}

async function guardarCompra() {
  const items = state.listaCompraActual || [];
  if (items.length === 0) {
    mostrarToast("Agrega al menos un producto a la lista de compra", "error");
    return;
  }

  const fecha = document.getElementById("compraFecha").value || todayStr();
  const vendedor = (document.getElementById("compraVendedor") ? document.getElementById("compraVendedor").value : state.vendedorActual) || "Carlos";
  const pagadoPor = (document.getElementById("compraFinanciadoPor") ? document.getElementById("compraFinanciadoPor").value : vendedor) || "Carlos";
  const tc = Number(document.getElementById("compraTipoCambio").value) || Number(state.config.tipoCambio) || 520;
  const proveedor = document.getElementById("compraProveedor").value.trim();
  const notas = document.getElementById("compraNotas").value.trim();
  const envioCRC = Number(document.getElementById("compraEnvioCRC")?.value) || 0;
  const envioUSD = tc > 0 ? (envioCRC / tc) : 0;

  let totalCant = 0;
  let totalUSD = 0;
  let totalCRC = 0;

  const itemsNormalizados = items.map(it => {
    totalCant += it.cantidad;
    const subUSD = it.cantidad * it.costoUnitarioUSD;
    const subCRC = it.cantidad * it.costoUnitarioCRC;
    totalUSD += subUSD;
    totalCRC += subCRC;
    return {
      codigo: it.codigo,
      nombre: it.nombre,
      vendedor,
      pagadoPor,
      cantidad: it.cantidad,
      costoUnitarioUSD: it.costoUnitarioUSD,
      tipoCambio: tc,
      costoUnitarioCRC: it.costoUnitarioCRC
    };
  });

  // Sumar flete/envío al total gastado en la compra (Productos + Envío)
  totalCRC += envioCRC;
  totalUSD += envioUSD;

  const idCompra = "CMP-" + Date.now().toString().slice(-6);
  const esCredito = document.getElementById("compraEsCredito") ? document.getElementById("compraEsCredito").checked : false;

  const compraObj = {
    id: idCompra,
    codigo: items[0].codigo,
    nombre: items.length === 1 ? items[0].nombre : `${items[0].nombre} +${items.length - 1} licores`,
    fecha,
    vendedor,
    pagadoPor: esCredito ? "Pendiente (Crédito)" : pagadoPor,
    esCredito,
    cantidad: totalCant,
    costoUnitarioUSD: (totalUSD - envioUSD) / (totalCant || 1),
    tipoCambio: tc,
    costoUnitarioCRC: (totalCRC - envioCRC) / (totalCant || 1),
    costoEnvioCRC: envioCRC,
    costoEnvioUSD: envioUSD,
    totalUSD,
    totalCRC,
    proveedor: proveedor || "Proveedor General",
    notas: notas || "",
    items: itemsNormalizados
  };

  // 1. Guardar en compras
  state.compras.unshift(compraObj);
  guardarComprasLocal();

  // 2. Si es a crédito, registrar automáticamente en Cuentas por Pagar
  if (esCredito) {
    const cuentaObj = {
      id: "CTA-" + Date.now().toString().slice(-6),
      fecha,
      tipo: "Por Pagar",
      entidad: proveedor || "Proveedor General",
      telefono: "",
      referenciaId: idCompra,
      montoTotalCRC: totalCRC,
      montoTotalUSD: totalUSD,
      saldoPendienteCRC: totalCRC,
      saldoPendienteUSD: totalUSD,
      estado: "Pendiente",
      fechaVencimiento: "",
      vendedor,
      notas: `Compra ${idCompra} (${compraObj.nombre}) a crédito a proveedor`
    };
    state.cuentas.unshift(cuentaObj);
    guardarCuentasLocal();
    encolarAccionSincronizacion("registrarCuenta", { cuenta: cuentaObj });
  }

  // 3. Limpiar lista de compra actual y campos
  state.listaCompraActual = [];
  document.getElementById("compraProveedor").value = "";
  if (document.getElementById("compraEnvioCRC")) document.getElementById("compraEnvioCRC").value = 0;
  document.getElementById("compraNotas").value = "";
  const chkCredito = document.getElementById("compraEsCredito");
  if (chkCredito) chkCredito.checked = false;
  limpiarSeleccionProductoCompra(false);
  renderizarListaCompraActual();

  // 4. Re-renderizar todo
  renderizarTodo();
  
  const detallePago = esCredito ? "A Crédito (Registrado en Cuentas por Pagar)" : (pagadoPor === "Empresa" ? "Caja Empresa" : `Financiada por ${pagadoPor}`);
  mostrarToast(`¡Compra de ${totalCant} botellas guardada! (${detallePago}) 📦`, "success");

  if (window.confetti) {
    window.confetti({ particleCount: 70, spread: 60, origin: { y: 0.8 } });
  }

  // 5. Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("registrarCompra", { compra: compraObj });
}

async function eliminarCompra(id) {
  if (!confirm("¿Deseas eliminar este registro de compra?")) return;
  const idStr = String(id).trim();

  // 1. Quitar de compras locales para que el stock baje de inmediato
  state.compras = (state.compras || []).filter(c => String(c.id).trim() !== idStr);
  guardarComprasLocal();

  // 2. Si la compra estaba pendiente en cola de sincronización para subirse, cancelarla
  if (state.colaSincronizacion && state.colaSincronizacion.length > 0) {
    const longitudAntes = state.colaSincronizacion.length;
    state.colaSincronizacion = state.colaSincronizacion.filter(item => {
      if (item.accion === "registrarCompra" && item.datos && item.datos.compra) {
        return String(item.datos.compra.id).trim() !== idStr;
      }
      return true;
    });
    if (state.colaSincronizacion.length !== longitudAntes) {
      guardarColaLocal();
    }
  }

  // 3. Limpiar cualquier Cuenta por Pagar asociada localmente
  if (state.cuentas && state.cuentas.length > 0) {
    const ctasAntes = state.cuentas.length;
    state.cuentas = state.cuentas.filter(cta => {
      const ref = String(cta.referenciaId || "").trim();
      const not = String(cta.notas || "").trim();
      const esDeEstaCompra = (ref === idStr || ref.includes(idStr) || not.includes(idStr)) && cta.tipo === "Por Pagar";
      return !esDeEstaCompra;
    });
    if (state.cuentas.length !== ctasAntes) {
      guardarCuentasLocal();
    }
  }

  // 4. Recordar ID eliminado en localStorage para evitar que _descargarDatosSheets la reincorpore antes de que Sheets la borre
  try {
    let eliminadasRecientes = JSON.parse(localStorage.getItem("inv_compras_eliminadas_ids") || "[]");
    if (!Array.isArray(eliminadasRecientes)) eliminadasRecientes = [];
    if (!eliminadasRecientes.includes(idStr)) {
      eliminadasRecientes.push(idStr);
      if (eliminadasRecientes.length > 100) eliminadasRecientes = eliminadasRecientes.slice(-100);
      localStorage.setItem("inv_compras_eliminadas_ids", JSON.stringify(eliminadasRecientes));
    }
  } catch(e) {}

  // 5. Renderizar interfaz inmediatamente con el nuevo stock reducido
  renderizarTodo();
  mostrarToast("Compra eliminada e inventario descontado.", "info");

  // 6. Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("eliminarCompra", { id: idStr });
}

function pasarCompraACuentasPorPagar(idCompra) {
  const c = state.compras.find(x => x.id === idCompra);
  if (!c) return;

  // Verificar si ya existe en cuentas
  const yaExiste = state.cuentas.find(cta => cta.referenciaId === idCompra && cta.tipo === "Por Pagar");
  if (yaExiste) {
    mostrarToast("Esta compra ya está registrada en Cuentas por Pagar.", "info");
    cambiarVista("cuentas");
    return;
  }

  const cant = Number(c.cantidad || 0);
  const cUSD = Number(c.costoUnitarioUSD || 0);
  const tc = Number(c.tipoCambio || state.config.tipoCambio || 520);
  const cCRC = Number(c.costoUnitarioCRC || (cUSD * tc));
  const totUSD = Number(c.totalUSD || (cant * cUSD));
  const totCRC = Number(c.totalCRC || (cant * cCRC));

  const cuentaObj = {
    id: "CTA-" + Date.now().toString().slice(-6),
    fecha: c.fecha || todayStr(),
    tipo: "Por Pagar",
    entidad: c.proveedor || "Proveedor General",
    telefono: "",
    referenciaId: c.id,
    montoTotalCRC: totCRC,
    montoTotalUSD: totUSD,
    saldoPendienteCRC: totCRC,
    saldoPendienteUSD: totUSD,
    estado: "Pendiente",
    fechaVencimiento: "",
    vendedor: c.vendedor || "Carlos",
    notas: `Compra ${c.id} (${c.nombre || c.codigo}) agregada a cuentas por pagar`
  };

  state.cuentas.unshift(cuentaObj);
  guardarCuentasLocal();
  encolarAccionSincronizacion("registrarCuenta", { cuenta: cuentaObj });
  renderizarTodo();
  mostrarToast(`Compra ${c.id} agregada a Cuentas por Pagar 📋`, "success");
  cambiarVista("cuentas");
}

function pasarVentaIndividualACuentasPorCobrar(idxVenta) {
  const v = state.ventas[idxVenta];
  if (!v) {
    mostrarToast("Venta no encontrada.", "error");
    return;
  }

  const vCod = v.codigo || (v.items && v.items[0] ? v.items[0].codigo : '') || `PROD_${idxVenta}`;
  const vUid = v.id ? `${v.id}_${vCod}_${idxVenta}` : `VTA_ROW_${idxVenta}_${Date.now()}`;

  // Verificar si ESTE movimiento exacto ya existe en cuentas
  const yaExiste = (state.cuentas || []).find(cta => 
    cta.tipo === "Por Cobrar" && (
      cta.referenciaId === vUid || 
      (cta.referenciaId && cta.referenciaId === `${v.id}_${vCod}_${idxVenta}`)
    )
  );
  
  if (yaExiste) {
    mostrarToast("Este movimiento específico ya está registrado en Cuentas por Cobrar.", "info");
    cambiarVista("cuentas");
    return;
  }

  const totCRC = Number(v.totalCRC || (v.totalFinalCRC || 0));
  const totUSD = Number(v.totalUSD || 0);
  const cliNombre = v.cliente || "Cliente General";
  
  if (!cliNombre || cliNombre.toLowerCase() === "cliente general") {
    mostrarToast("⚠️ No se puede pasar a CXC: el movimiento no tiene cliente específico asignado.", "error");
    return;
  }

  const nombreProd = v.nombre || (v.items && v.items[0] ? v.items[0].nombre : (v.codigo ? `Licor (${v.codigo})` : "Venta"));
  const cantProd = Number(v.cantidad || (v.items && v.items[0] ? v.items[0].cantidad : 1));
  
  // Buscar teléfono si está en el maestro de clientes
  let tel = "";
  if (v.clienteTelefono) {
    tel = v.clienteTelefono;
  } else if (state.clientes) {
    const matchCli = Object.values(state.clientes).find(c => c.nombre && c.nombre.toLowerCase() === cliNombre.toLowerCase());
    if (matchCli) tel = matchCli.telefono || "";
  }

  const envioVentaCRC = parseNum(v.costoEnvioCRC, 0);
  const tc = Number(state.config.tipoCambio || 520);
  const envioVentaUSD = parseNum(v.costoEnvioUSD, 0) || (tc > 0 ? envioVentaCRC / tc : 0);

  const cuentaObj = {
    id: "CTA-" + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10),
    fecha: v.fecha || new Date().toISOString(),
    tipo: "Por Cobrar",
    entidad: cliNombre,
    telefono: tel,
    referenciaId: vUid, // ID único por fila/movimiento exacto
    ventaId: v.id || "",
    montoTotalCRC: totCRC,
    montoTotalUSD: totUSD,
    saldoPendienteCRC: totCRC,
    saldoPendienteUSD: totUSD,
    costoEnvioCRC: envioVentaCRC,
    costoEnvioUSD: envioVentaUSD,
    estado: "Pendiente",
    fechaVencimiento: "",
    vendedor: v.vendedor || "Carlos",
    notas: `Movimiento: ${cantProd}x ${nombreProd} (${v.metodoPago || 'Efectivo'})${envioVentaCRC > 0 ? ` [Envío: ₡${envioVentaCRC}]` : ''}`
  };

  if (!state.cuentas) state.cuentas = [];
  state.cuentas.unshift(cuentaObj);
  guardarCuentasLocal();
  encolarAccionSincronizacion("registrarCuenta", { cuenta: cuentaObj });
  renderizarTodo();
  mostrarToast(`Cuenta por cobrar creada para: ${cantProd}x ${nombreProd} (${cliNombre}) 📋`, "success");
  cambiarVista("cuentas");
}

function pasarVentaACuentasPorCobrar(idVenta) {
  const idx = state.ventas.findIndex(x => x.id === idVenta);
  if (idx !== -1) {
    pasarVentaIndividualACuentasPorCobrar(idx);
  }
}

function renderizarHistorialCompras() {
  const cont = document.getElementById("comprasHistorialList");
  const countEl = document.getElementById("comprasCount");
  if (!cont) return;

  if (countEl) countEl.textContent = state.compras.length;

  if (state.compras.length === 0) {
    cont.innerHTML = `<div class="text-center py-4 text-slate-500">No hay compras registradas.</div>`;
    return;
  }

  const sorted = [...state.compras].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 20);
  cont.innerHTML = sorted.map(c => {
    const prod = state.productos[c.codigo];
    const nombre = prod ? prod.nombre : (c.nombre || c.codigo);
    const cant = Number(c.cantidad || 0);
    const cUSD = Number(c.costoUnitarioUSD || 0);
    const tc = Number(c.tipoCambio || state.config.tipoCambio || 520);
    const cCRC = Number(c.costoUnitarioCRC || (cUSD * tc));
    const totUSD = Number(c.totalUSD || (cant * cUSD));
    const totCRC = Number(c.totalCRC || (cant * cCRC));
    const vend = c.vendedor || "Carlos";
    const pagador = c.pagadoPor || vend;
    const vendColor = vend === "Daniel" ? "text-violet-400 bg-violet-950/60 border-violet-500/30" : "text-blue-400 bg-blue-950/60 border-blue-500/30";
    const esPend = pagador.includes("Crédito") || pagador.includes("Pendiente") || c.esCredito;
    const pagoColor = esPend ? "text-amber-300 bg-amber-950/60 border-amber-500/40" : (pagador === "Empresa" ? "text-emerald-300 bg-emerald-950/60 border-emerald-500/30" : pagador === "Daniel" ? "text-violet-300 bg-violet-950/60 border-violet-500/30" : "text-blue-300 bg-blue-950/60 border-blue-500/30");

    const yaEnCuentas = state.cuentas.some(cta => cta.referenciaId === c.id && cta.tipo === "Por Pagar");

    return `
      <div class="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 flex justify-between items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 mb-1 flex-wrap">
            <span class="text-[10px] font-bold px-1.5 py-0.2 rounded border ${vendColor}">📦 Stock: ${vend}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.2 rounded border ${pagoColor}">💳 Pagó: ${pagador}</span>
            <span class="text-[10px] text-slate-400 font-mono">${c.fecha || todayStr()}</span>
          </div>
          <div class="font-bold text-white truncate text-xs">${nombre} <span class="text-emerald-400 font-mono font-black">(+${cant})</span></div>
          <div class="text-[10px] text-slate-500 font-mono">${c.codigo} • Proveedor: <b>${c.proveedor || "General"}</b></div>
        </div>
        <div class="text-right font-mono shrink-0 ml-2 space-y-1">
          <div class="font-black text-white text-xs">${fmtUSD(totUSD)}</div>
          <div class="text-[10px] text-slate-400">${fmtCRC(totCRC)}</div>
          <div class="flex items-center justify-end gap-1.5 pt-0.5">
            ${!yaEnCuentas ? `
              <button onclick="pasarCompraACuentasPorPagar('${c.id}')" title="Agregar a Cuentas por Pagar" class="text-[10px] text-amber-400 hover:text-amber-300 font-bold bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-500/30">
                + Cta Pagar
              </button>
            ` : `
              <span class="text-[9px] text-emerald-400 font-bold font-sans">En Cuentas</span>
            `}
            <button onclick="eliminarCompra('${c.id}')" class="text-[10px] text-rose-400 hover:text-rose-300">Eliminar</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ==========================================================================
// 4. VENTAS (POS TÁCTIL)
// ==========================================================================
function filtrarPosProductos() {
  const txt = (document.getElementById("searchPos").value || "").toLowerCase().trim();
  const dropdown = document.getElementById("posSearchResults");
  const stockMap = calcularStockPorCodigo();

  if (!txt) {
    dropdown.classList.add("hidden");
    return;
  }

  const matches = Object.values(state.productos).filter(p =>
    p.nombre.toLowerCase().includes(txt) ||
    p.codigo.toLowerCase().includes(txt)
  ).slice(0, 6);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">No se encontró "${txt}".</div>`;
    dropdown.classList.remove("hidden");
    return;
  }

  dropdown.innerHTML = matches.map(p => {
    const st = stockMap[p.codigo] || 0;
    const imgUrl = formatearUrlImagen(p.imagenUrl);
    const imgHtml = imgUrl
      ? `<img src="${imgUrl}" alt="${p.nombre}" class="w-9 h-9 rounded-lg object-cover bg-slate-900 border border-slate-700 shrink-0" onerror="this.outerHTML='<div class=\\'w-9 h-9 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0\\'>🍷</div>'">`
      : `<div class="w-9 h-9 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0 text-xs">🍷</div>`;

    return `
      <div onclick="agregarAlCarritoPorCodigo('${p.codigo}')" class="p-2.5 hover:bg-slate-700/70 cursor-pointer flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0">
          ${imgHtml}
          <div class="min-w-0">
            <div class="text-xs font-bold text-white truncate">${p.nombre}</div>
            <div class="text-[10px] text-slate-400 font-mono">${p.codigo} • Stock: <b class="${st > 0 ? 'text-emerald-400' : 'text-rose-400'}">${st}</b></div>
          </div>
        </div>
        <div class="text-right font-mono shrink-0">
          <div class="text-xs font-black text-white">${fmtCRC(p.precioVentaCRC)}</div>
          <div class="text-[10px] text-teal-300">${fmtUSD(p.precioVentaUSD)}</div>
        </div>
      </div>
    `;
  }).join("");
  dropdown.classList.remove("hidden");
}

// Variable temporal para recordar la acción pendiente del modal de inventario cruzado
let accionPendienteInvCruzado = null;

function cerrarModalInventarioCruzado() {
  const modal = document.getElementById("modalInventarioCruzado");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  accionPendienteInvCruzado = null;
}

function abrirModalAlertaInventarioCruzado({ vendedorActual, otroVendedor, prod, stockActual, stockOtro, alAceptar }) {
  const modal = document.getElementById("modalInventarioCruzado");
  if (!modal) return;

  const prodNombreEl = document.getElementById("modalInvCruzadoProducto");
  const subtituloEl = document.getElementById("modalInvCruzadoSubtitulo");
  const labelSinEl = document.getElementById("modalInvCruzadoLabelVendedorSin");
  const stockSinEl = document.getElementById("modalInvCruzadoStockSin");
  const labelConEl = document.getElementById("modalInvCruzadoLabelVendedorCon");
  const stockConEl = document.getElementById("modalInvCruzadoStockCon");
  const mensajeEl = document.getElementById("modalInvCruzadoMensaje");
  const btnAceptarTextoEl = document.getElementById("modalInvCruzadoBtnAceptarTexto");
  const btnAceptarEl = document.getElementById("modalInvCruzadoBtnAceptar");

  if (prodNombreEl) prodNombreEl.textContent = prod.nombre || prod.codigo;
  if (subtituloEl) subtituloEl.textContent = `${otroVendedor} sí tiene stock disponible`;
  if (labelSinEl) labelSinEl.textContent = `Stock ${vendedorActual}:`;
  if (stockSinEl) stockSinEl.textContent = `${stockActual} unidad(es)`;
  if (labelConEl) labelConEl.textContent = `Stock ${otroVendedor}:`;
  if (stockConEl) stockConEl.textContent = `${stockOtro} unidad(es) disponible(s)`;

  if (mensajeEl) {
    mensajeEl.innerHTML = `⚠️ <b>${vendedorActual} no tiene inventario</b> de este producto, pero <b>${otroVendedor} sí tiene ${stockOtro} unidad(es)</b>.<br><br>¿Quieres agregar este producto con el inventario de <b>${otroVendedor}</b>?`;
  }

  if (btnAceptarTextoEl) {
    btnAceptarTextoEl.textContent = `Sí, agregar con inventario de ${otroVendedor}`;
  }

  accionPendienteInvCruzado = () => {
    cerrarModalInventarioCruzado();
    if (typeof alAceptar === "function") alAceptar();
  };

  if (btnAceptarEl) {
    btnAceptarEl.onclick = () => {
      if (accionPendienteInvCruzado) accionPendienteInvCruzado();
    };
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();
}

function agregarAlCarritoPorCodigo(codigo, forzarInventarioVendedor = null) {
  const codNorm = String(codigo).trim().toUpperCase();
  const prod = state.productos[codNorm] || state.productos[codigo];
  if (!prod) {
    mostrarToast("Producto no encontrado.", "error");
    return;
  }

  const vendedorActual = state.vendedorActual || "Carlos";
  const otroVendedor = vendedorActual === "Carlos" ? "Daniel" : "Carlos";
  const stockDetallado = calcularStockDetalladoPorCodigo();
  const stockActualVendedor = stockDetallado[codNorm] ? (stockDetallado[codNorm][vendedorActual] || 0) : 0;
  const stockOtroVendedor = stockDetallado[codNorm] ? (stockDetallado[codNorm][otroVendedor] || 0) : 0;

  // Si no se ha forzado el inventario y estamos en perfil individual (Carlos o Daniel)
  // y el vendedor actual NO tiene stock pero el otro vendedor SÍ tiene stock:
  if (!forzarInventarioVendedor && vendedorActual !== "Consolidado") {
    // Revisar cuánto ya tiene tomado en el carrito de su propio stock
    const enCarritoPropio = state.carrito.filter(item => 
      String(item.codigo).trim().toUpperCase() === codNorm && 
      (item.inventarioVendedor === vendedorActual || (!item.inventarioVendedor && vendedorActual !== "Consolidado"))
    ).reduce((sum, it) => sum + it.cantidad, 0);

    const stockRestantePropio = stockActualVendedor - enCarritoPropio;

    if (stockRestantePropio <= 0 && stockOtroVendedor > 0) {
      abrirModalAlertaInventarioCruzado({
        vendedorActual,
        otroVendedor,
        prod,
        stockActual: stockActualVendedor,
        stockOtro: stockOtroVendedor,
        alAceptar: () => {
          agregarAlCarritoPorCodigo(codigo, otroVendedor);
        }
      });
      return;
    }
  }

  const invVendedorAsignado = forzarInventarioVendedor || (vendedorActual === "Consolidado" ? "Carlos" : vendedorActual);

  // Buscar si ya existe un ítem en el carrito con el mismo código y el MISMO inventarioVendedor
  const enCarrito = state.carrito.find(item => 
    String(item.codigo).trim().toUpperCase() === codNorm &&
    (item.inventarioVendedor === invVendedorAsignado)
  );

  if (enCarrito) {
    enCarrito.cantidad += 1;
  } else {
    const pCRC = Number(prod.precioVentaCRC || 0);
    const pUSD = Number(prod.precioVentaUSD || 0);
    state.carrito.push({
      codigo: prod.codigo,
      nombre: prod.nombre,
      imagenUrl: prod.imagenUrl || "",
      precioVentaCRC: pCRC,
      precioCRC: pCRC,
      precioOriginalCRC: pCRC,
      precioVentaUSD: pUSD,
      precioUSD: pUSD,
      costoRefUSD: Number(prod.costoRefUSD || 0),
      costoRefCRC: Number(prod.costoRefCRC || 0),
      cantidad: 1,
      stockMaximo: forzarInventarioVendedor ? stockOtroVendedor : stockActualVendedor,
      inventarioVendedor: invVendedorAsignado
    });
  }

  if (forzarInventarioVendedor) {
    mostrarToast(`Agregado con inventario de ${forzarInventarioVendedor}: ${prod.nombre} 📦`, "success");
  } else if (stockActualVendedor <= 0) {
    mostrarToast(`Agregado: ${prod.nombre} (⚠️ Sin stock registrado).`, "info");
  } else {
    mostrarToast(`Agregado: ${prod.nombre}.`, "success");
  }

  reproducirBeep();
  const searchInput = document.getElementById("searchPos");
  if (searchInput) searchInput.value = "";
  const searchResults = document.getElementById("posSearchResults");
  if (searchResults) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
  }
  renderizarCarrito();
}

function modificarCantidadCarrito(codigo, delta, inventarioVendedor = null) {
  // Buscar ítem por código e inventarioVendedor si fue provisto
  const item = state.carrito.find(i => 
    i.codigo === codigo && (!inventarioVendedor || i.inventarioVendedor === inventarioVendedor)
  ) || state.carrito.find(i => i.codigo === codigo);

  if (!item) return;

  const codNorm = String(codigo).trim().toUpperCase();
  const vendedorActual = state.vendedorActual || "Carlos";
  const otroVendedor = vendedorActual === "Carlos" ? "Daniel" : "Carlos";
  const stockDetallado = calcularStockDetalladoPorCodigo();
  const stockActualVendedor = stockDetallado[codNorm] ? (stockDetallado[codNorm][vendedorActual] || 0) : 0;
  const stockOtroVendedor = stockDetallado[codNorm] ? (stockDetallado[codNorm][otroVendedor] || 0) : 0;

  // Si el usuario quiere AUMENTAR (+) y el stock propio ya está agotado pero el otro vendedor sí tiene stock:
  if (delta > 0 && item.inventarioVendedor === vendedorActual && vendedorActual !== "Consolidado") {
    const totalTomado = state.carrito.filter(it => 
      String(it.codigo).trim().toUpperCase() === codNorm && it.inventarioVendedor === vendedorActual
    ).reduce((sum, it) => sum + it.cantidad, 0);

    if (totalTomado >= stockActualVendedor && stockOtroVendedor > 0) {
      const prod = state.productos[codNorm] || { codigo, nombre: item.nombre };
      abrirModalAlertaInventarioCruzado({
        vendedorActual,
        otroVendedor,
        prod,
        stockActual: stockActualVendedor,
        stockOtro: stockOtroVendedor,
        alAceptar: () => {
          agregarAlCarritoPorCodigo(codigo, otroVendedor);
        }
      });
      return;
    }
  }

  const nuevo = item.cantidad + delta;
  if (nuevo <= 0) {
    eliminarDelCarrito(codigo, item.inventarioVendedor);
    return;
  }
  item.cantidad = nuevo;
  renderizarCarrito();
}

function eliminarDelCarrito(codigo, inventarioVendedor = null) {
  state.carrito = state.carrito.filter(i => 
    !(i.codigo === codigo && (!inventarioVendedor || i.inventarioVendedor === inventarioVendedor))
  );
  renderizarCarrito();
}

function vaciarCarrito() {
  state.carrito = [];
  renderizarCarrito();
}

function cambiarModoPOS(modo) {
  state.modoPOS = modo;
  const btnVenta = document.getElementById("btnModoVenta");
  const btnPedido = document.getElementById("btnModoPedido");
  const btnCheckout = document.getElementById("btnCheckout");
  const cartIcon = document.getElementById("cartHeaderIcon");
  const cartTitle = document.getElementById("cartHeaderTitle");
  const panelPuntos = document.getElementById("panelPuntosCliente");
  const totalesYPagos = document.getElementById("posTotalesYPagosContainer");
  const bannerPedido = document.getElementById("posBannerModoPedido");
  const cashHelper = document.getElementById("cashHelper");

  if (modo === "pedido") {
    if (btnVenta) {
      btnVenta.className = "py-2 rounded-lg bg-transparent text-slate-400 hover:text-white flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (btnPedido) {
      btnPedido.className = "py-2 rounded-lg bg-amber-600 text-white shadow-md flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (btnCheckout) {
      btnCheckout.className = "w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-extrabold rounded-xl shadow-lg shadow-amber-500/25 active:scale-95 transition-all flex items-center justify-center gap-2";
      btnCheckout.innerHTML = `<i data-lucide="clipboard-check" class="w-5 h-5"></i><span>GUARDAR ENCARGO DE BOTELLAS</span>`;
    }
    if (cartIcon) cartIcon.className = "w-4 h-4 text-amber-400";
    if (cartTitle) cartTitle.innerHTML = `Lista de Encargo (<span id="cartCount">${state.carrito.length}</span>)`;
    
    // Ocultar montos, métodos de pago, vuelto y puntos
    if (totalesYPagos) totalesYPagos.classList.add("hidden");
    if (panelPuntos) panelPuntos.classList.add("hidden");
    if (bannerPedido) bannerPedido.classList.remove("hidden");
    if (cashHelper) cashHelper.classList.add("hidden");

    mostrarToast("Modo 'Encargo / Pedido' (solo cantidades) 📋", "info");
  } else {
    if (btnVenta) {
      btnVenta.className = "py-2 rounded-lg bg-emerald-600 text-white shadow-md flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (btnPedido) {
      btnPedido.className = "py-2 rounded-lg bg-transparent text-slate-400 hover:text-white flex items-center justify-center gap-1.5 active:scale-95 transition-all";
    }
    if (btnCheckout) {
      btnCheckout.className = "w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-extrabold rounded-xl shadow-lg shadow-emerald-500/25 active:scale-95 transition-all flex items-center justify-center gap-2";
      btnCheckout.innerHTML = `<i data-lucide="check" class="w-5 h-5"></i><span>COMPLETAR VENTA</span>`;
    }
    if (cartIcon) cartIcon.className = "w-4 h-4 text-emerald-400";
    if (cartTitle) cartTitle.innerHTML = `Carrito de Venta (<span id="cartCount">${state.carrito.length}</span>)`;
    
    // Mostrar montos, métodos de pago y puntos
    if (totalesYPagos) totalesYPagos.classList.remove("hidden");
    if (bannerPedido) bannerPedido.classList.add("hidden");
    if (state.clienteSeleccionado && panelPuntos) panelPuntos.classList.remove("hidden");
    if (state.metodoPagoSeleccionado === "Efectivo" && cashHelper) cashHelper.classList.remove("hidden");

    mostrarToast("Modo 'Venta Directa' activado 🛍️", "info");
  }

  inicializarIconos();
  renderizarCarrito();
}

function renderizarCarrito() {
  const cont = document.getElementById("cartItemsList");
  const countEl = document.getElementById("cartCount");
  const totalCRCEl = document.getElementById("cartTotalCRC");
  const totalUSDEl = document.getElementById("cartTotalUSD");
  const pedidoTotalUnidades = document.getElementById("pedidoTotalUnidades");
  if (!cont) return;

  const esModoPedido = state.modoPOS === "pedido";

  let totalBrutoCRC = 0;
  let totalUSD = 0;
  let totalItems = 0;

  state.carrito.forEach(i => {
    totalBrutoCRC += (i.cantidad * i.precioVentaCRC);
    totalUSD += (i.cantidad * i.precioVentaUSD);
    totalItems += i.cantidad;
  });

  const descuento = state.descuentoPuntosAplicado || 0;
  const totalFinalCRC = Math.max(0, totalBrutoCRC - descuento);
  const tc = state.config.tipoCambio || 520;
  const totalFinalUSD = totalFinalCRC / tc;

  if (countEl) countEl.textContent = totalItems;
  if (pedidoTotalUnidades) pedidoTotalUnidades.textContent = `${totalItems} unids`;

  if (totalCRCEl && totalUSDEl) {
    if (descuento > 0) {
      totalCRCEl.innerHTML = `
        <span class="line-through text-slate-500 text-base font-bold">${fmtCRC(totalBrutoCRC)}</span>
        <span class="text-emerald-400 text-2xl font-black">${fmtCRC(totalFinalCRC)}</span>
        <span class="block text-[10px] text-amber-400 font-normal">-${fmtCRC(descuento)} descuento de puntos 🎁</span>
      `;
      totalUSDEl.textContent = `${fmtUSD(totalFinalUSD)} USD`;
    } else {
      totalCRCEl.textContent = fmtCRC(totalFinalCRC);
      totalUSDEl.textContent = `${fmtUSD(totalUSD)} USD`;
    }
  }

  if (state.carrito.length === 0) {
    cont.innerHTML = `
      <div class="flex flex-col items-center justify-center py-6 text-slate-500 text-xs">
        <i data-lucide="${esModoPedido ? 'clipboard-list' : 'shopping-cart'}" class="w-8 h-8 stroke-1 mb-1 text-slate-600"></i>
        <span>${esModoPedido ? 'Lista de encargo vacía. Agrega los licores pedidos.' : 'Carrito vacío. Agrega licores para vender.'}</span>
      </div>
    `;
  } else {
    cont.innerHTML = state.carrito.map(item => {
      const imgUrl = formatearUrlImagen(item.imagenUrl);
      const imgHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${item.nombre}" class="w-8 h-8 rounded-lg object-cover bg-slate-900 border border-slate-700 shrink-0" onerror="this.outerHTML='<div class=\\'w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0 text-xs\\'>🍷</div>'">`
        : `<div class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0 text-xs">🍷</div>`;

      const editado = item._precioEditado 
        ? 'text-amber-300 font-bold bg-amber-500/20 border-amber-500/40 hover:bg-amber-500/30' 
        : 'text-slate-400 bg-slate-800/80 border-slate-700/60 hover:text-amber-300 hover:bg-slate-750';

      const vendBadge = item.inventarioVendedor ? `
        <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border ${item.inventarioVendedor === 'Daniel' ? 'text-violet-300 bg-violet-950/80 border-violet-500/40' : 'text-blue-300 bg-blue-950/80 border-blue-500/40'}">
          📦 Stock ${item.inventarioVendedor}
        </span>
      ` : '';

      return `
        <div class="p-2.5 bg-slate-900/90 rounded-xl border border-slate-800 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            ${imgHtml}
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <h5 class="text-xs font-bold text-white truncate">${item.nombre}</h5>
                ${vendBadge}
              </div>
              ${esModoPedido ? `
                <div class="text-[10px] text-amber-400 font-mono">Encargo: <b class="text-white">${item.cantidad} botella(s)</b></div>
              ` : `
                <button type="button" onclick="editarPrecioCarrito('${item.codigo}')" class="text-[11px] font-mono flex items-center gap-1.5 px-2 py-0.5 rounded-lg border transition-all active:scale-95 mt-0.5 ${editado}" title="Clic para editar precio">
                  <span>${fmtCRC(item.precioVentaCRC)}</span>
                  <span class="text-[10px] text-amber-400 flex items-center gap-0.5">✏️ ${item._precioEditado ? '<span class="text-[9px] font-sans font-bold text-amber-300 uppercase">Editado</span>' : ''}</span>
                </button>
              `}
            </div>
          </div>

          <div class="flex items-center gap-1.5 bg-slate-800 rounded-lg p-1">
            <button onclick="modificarCantidadCarrito('${item.codigo}', -1, '${item.inventarioVendedor || ''}')" class="w-6 h-6 rounded bg-slate-700 text-white font-bold text-xs flex items-center justify-center active:scale-95">-</button>
            <span class="text-xs font-bold text-white w-5 text-center font-mono">${item.cantidad}</span>
            <button onclick="modificarCantidadCarrito('${item.codigo}', 1, '${item.inventarioVendedor || ''}')" class="w-6 h-6 rounded bg-slate-700 text-white font-bold text-xs flex items-center justify-center active:scale-95">+</button>
          </div>

          <div class="text-right min-w-[60px] font-mono">
            ${esModoPedido ? `
              <span class="text-xs font-black text-amber-400">${item.cantidad}x</span>
            ` : `
              <div class="text-xs font-black text-emerald-400">${fmtCRC(item.cantidad * item.precioVentaCRC)}</div>
            `}
            <button onclick="eliminarDelCarrito('${item.codigo}', '${item.inventarioVendedor || ''}')" class="text-[10px] text-rose-400 hover:text-rose-300 block ml-auto">Quitar</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Actualizar panel de fidelización si hay cliente seleccionado y no es pedido
  if (state.clienteSeleccionado && !esModoPedido) {
    renderizarPanelCliente();
  }

  calcularCambio();
  inicializarIconos();
}
function setPaymentMethod(metodo) {
  state.metodoPagoSeleccionado = metodo;
  document.querySelectorAll(".pay-btn").forEach(btn => {
    const txt = btn.textContent.trim().toLowerCase();
    const target = metodo.toLowerCase();
    if (txt.includes(target) || (target === "sinpe / transf." && txt.includes("sinpe")) || (target === "pago luego" && txt.includes("luego"))) {
      btn.classList.add("active");
      btn.classList.remove("bg-slate-900", "text-slate-300");
      if (metodo === "Pago Luego") {
        btn.classList.add("bg-amber-600", "text-white");
      } else {
        btn.classList.add("bg-indigo-600", "text-white");
      }
    } else {
      btn.classList.remove("active", "bg-indigo-600", "bg-amber-600", "text-white");
      btn.classList.add("bg-slate-900", "text-slate-300");
    }
  });

  const cashHelper = document.getElementById("cashHelper");
  const pagoLuegoHelper = document.getElementById("pagoLuegoHelper");

  if (cashHelper) {
    if (metodo === "Efectivo") cashHelper.classList.remove("hidden");
    else cashHelper.classList.add("hidden");
  }

  if (pagoLuegoHelper) {
    if (metodo === "Pago Luego") pagoLuegoHelper.classList.remove("hidden");
    else pagoLuegoHelper.classList.add("hidden");
  }
}

function calcularCambio() {
  const recibido = Number(document.getElementById("cashReceived").value) || 0;
  let totalBrutoCRC = 0;
  state.carrito.forEach(i => totalBrutoCRC += (i.cantidad * i.precioVentaCRC));
  const totalFinal = Math.max(0, totalBrutoCRC - (state.descuentoPuntosAplicado || 0));

  const cambio = recibido - totalFinal;
  const cambioEl = document.getElementById("cashChange");
  if (recibido > 0) {
    cambioEl.textContent = fmtCRC(Math.max(0, cambio));
  } else {
    cambioEl.textContent = fmtCRC(0);
  }
}

async function completarVenta() {
  if (state.modoPOS === "pedido") {
    return guardarPedidoCliente();
  }

  if (state.carrito.length === 0) {
    mostrarToast("El carrito está vacío.", "error");
    return;
  }

  const vendedor = state.vendedorActual || "Carlos";
  let totalBrutoCRC = 0, totalUSD = 0;
  let gananciaCRC = 0, gananciaUSD = 0;

  state.carrito.forEach(item => {
    const subCRC = item.cantidad * item.precioVentaCRC;
    const subUSD = item.cantidad * item.precioVentaUSD;
    const cCRC = item.cantidad * (item.costoRefCRC || 0);
    const cUSD = item.cantidad * (item.costoRefUSD || 0);

    totalBrutoCRC += subCRC;
    totalUSD += subUSD;
    gananciaCRC += (subCRC - cCRC);
    gananciaUSD += (subUSD - cUSD);
  });

  // --- Descuento y puntos ---
  const descuentoPuntos = state.descuentoPuntosAplicado || 0;
  const puntosCanjados = Math.floor(descuentoPuntos / (state.config.puntosValorCRC || 1));
  const totalFinalCRC = Math.max(0, totalBrutoCRC - descuentoPuntos);
  const puntosGanados = Math.floor(totalFinalCRC / (state.config.puntosRazonCRC || 100));

  // --- Nombre/ID de cliente ---
  const cli = state.clienteSeleccionado;
  const clienteInputVal = document.getElementById("posClienteInput")?.value?.trim();
  const clienteNombre = cli ? cli.nombre : (clienteInputVal || "Cliente General");
  const clienteId = cli ? cli.id : null;
  const clienteTelefono = cli ? cli.telefono : null;

  // Validación estricta: No se puede vender con 'Pago Luego' si no hay un cliente seleccionado/asignado
  if (state.metodoPagoSeleccionado === "Pago Luego") {
    if (!clienteNombre || clienteNombre.toLowerCase() === "cliente general") {
      mostrarToast("⚠️ Para vender con 'Pago Luego' debes asignar un cliente registrado.", "error");
      const inCli = document.getElementById("posClienteInput");
      if (inCli) {
        inCli.focus();
        inCli.classList.add("border-amber-500", "animate-pulse");
        setTimeout(() => inCli.classList.remove("border-amber-500", "animate-pulse"), 2500);
      }
      return;
    }
  }

  // Costo de Envío de la venta (gasto de entrega que resta del ingreso a la empresa)
  const envioVentaCRC = Number(document.getElementById("posEnvioCRC")?.value) || 0;
  const tcActual = Number(state.config.tipoCambio) || 520;
  const envioVentaUSD = tcActual > 0 ? (envioVentaCRC / tcActual) : 0;

  const idVenta = "VTA-" + Date.now().toString().slice(-6);

  const ventaObj = {
    id: idVenta,
    fecha: new Date().toISOString(),
    vendedor,
    items: state.carrito.map(it => {
      const pCRC = Number(it.precioVentaCRC !== undefined ? it.precioVentaCRC : (it.precioCRC || 0));
      const pUSD = Number(it.precioVentaUSD !== undefined ? it.precioVentaUSD : (it.precioUSD || 0));
      const cant = Number(it.cantidad || 1);
      return {
        codigo: it.codigo,
        nombre: it.nombre || it.codigo,
        imagenUrl: it.imagenUrl || "",
        cantidad: cant,
        precioVentaCRC: pCRC,
        precioCRC: pCRC,
        precioUnitarioCRC: pCRC,
        precioVentaUSD: pUSD,
        precioUSD: pUSD,
        precioUnitarioUSD: pUSD,
        costoRefCRC: Number(it.costoRefCRC || 0),
        costoRefUSD: Number(it.costoRefUSD || 0),
        subtotalCRC: cant * pCRC,
        subtotalUSD: cant * pUSD,
        _precioEditado: !!it._precioEditado,
        precioOriginalCRC: it.precioOriginalCRC !== undefined ? it.precioOriginalCRC : pCRC,
        inventarioVendedor: it.inventarioVendedor || vendedor
      };
    }),
    totalCRC: totalBrutoCRC,
    totalFinalCRC,
    totalUSD,
    costoEnvioCRC: envioVentaCRC,
    costoEnvioUSD: envioVentaUSD,
    gananciaCRC: (gananciaCRC - descuentoPuntos) - envioVentaCRC,
    gananciaUSD: gananciaUSD - envioVentaUSD,
    cliente: clienteNombre,
    clienteId,
    clienteTelefono,
    metodoPago: state.metodoPagoSeleccionado,
    descuentoPuntos,
    puntosGanados,
    puntosCanjados,
    // --- Trazabilidad de pedidos preventa ---
    facturadoPor: vendedor,                                           // Quien facturó (Carlos/Daniel)
    pedidoOrigenId: state.pedidoEnFacturacion || localStorage.getItem("inv_pedido_en_facturacion") || "", // ID del pedido original
    pedidoOrigenVendedor: state.pedidoOrigenVendedor || localStorage.getItem("inv_pedido_origen_vendedor") || "" // Quien tomó el pedido (colaborador)
  };

  // --- Actualizar puntos del cliente ---
  if (cli) {
    state.clientes[cli.id].ultimaVenta = ventaObj.fecha;
    actualizarPuntosCliente(cli.id, puntosGanados - puntosCanjados);
  }

  state.ventas.unshift(ventaObj);
  guardarVentasLocal();
  state.ultimaVentaCompletada = ventaObj;

  // --- Si es "Pago Luego", crear automáticamente registro en Cuentas por Cobrar POR CADA PRODUCTO ---
  if (state.metodoPagoSeleccionado === "Pago Luego") {
    if (!state.cuentas) state.cuentas = [];
    
    // Proporción de descuento de puntos si hubo
    const factorDescuento = totalBrutoCRC > 0 ? (totalFinalCRC / totalBrutoCRC) : 1;
    
    ventaObj.items.forEach((it, itIdx) => {
      const itSubBrutoCRC = it.cantidad * it.precioVentaCRC;
      const itSubCRC = Math.round(itSubBrutoCRC * factorDescuento);
      const itSubUSD = it.cantidad * it.precioVentaUSD;
      const itCod = it.codigo || `PROD_${itIdx}`;
      const itUid = `${idVenta}_${itCod}_${itIdx}`;
      const uniqueSuffix = Math.floor(Math.random() * 900 + 100);

      // Calcular envío proporcional por ítem
      const propSub = totalFinalCRC > 0 ? (itSubCRC / totalFinalCRC) : (1 / ventaObj.items.length);
      const itEnvioCRC = Math.round(envioVentaCRC * propSub);
      const itEnvioUSD = tcActual > 0 ? (itEnvioCRC / tcActual) : 0;

      const cuentaObj = {
        id: "CTA-" + Date.now().toString().slice(-6) + uniqueSuffix,
        fecha: ventaObj.fecha,
        tipo: "Por Cobrar",
        entidad: clienteNombre,
        telefono: clienteTelefono || "",
        referenciaId: itUid, // ID único por cada producto de la venta
        ventaId: idVenta,    // Referencia a la venta madre
        montoTotalCRC: itSubCRC,
        montoTotalUSD: itSubUSD,
        saldoPendienteCRC: itSubCRC,
        saldoPendienteUSD: itSubUSD,
        costoEnvioCRC: itEnvioCRC,   // Envío proporcional para descuento interno
        costoEnvioUSD: itEnvioUSD,
        estado: "Pendiente",
        fechaVencimiento: "",
        vendedor,
        notas: `Venta POS: ${it.cantidad}x ${it.nombre} (${idVenta})${itEnvioCRC > 0 ? ` [Envío: ₡${itEnvioCRC}]` : ''}`
      };


      state.cuentas.unshift(cuentaObj);
      encolarAccionSincronizacion("registrarCuenta", { cuenta: cuentaObj });
    });

    guardarCuentasLocal();
    mostrarToast(`Venta guardada: ${ventaObj.items.length} cuenta(s) por cobrar creadas para ${clienteNombre} 📋`, "info");
  }

  if (window.confetti) {
    window.confetti({ particleCount: 80, spread: 60, origin: { y: 0.8 } });
  }

  // --- Limpiar estado post-venta ---
  state.carrito = [];
  state.clienteSeleccionado = null;
  state.descuentoPuntosAplicado = 0;
  document.getElementById("cashReceived").value = "";
  if (document.getElementById("posEnvioCRC")) document.getElementById("posEnvioCRC").value = "0";
  const clienteInput = document.getElementById("posClienteInput");
  if (clienteInput) clienteInput.value = "";

  // --- Auto-completar pedido si se facturó desde un encargo ---
  const idPedOrig = state.pedidoEnFacturacion || localStorage.getItem("inv_pedido_en_facturacion") || "";
  if (idPedOrig) {
    state.pedidoEnFacturacion = null;
    state.pedidoOrigenVendedor = null;
    try {
      localStorage.removeItem("inv_pedido_en_facturacion");
      localStorage.removeItem("inv_pedido_origen_vendedor");
    } catch(e) {}
    const pedOrig = (state.pedidos || []).find(p => p.id === idPedOrig);
    if (pedOrig) {
      pedOrig.estado = "comprado";
      pedOrig.fechaComprado = new Date().toISOString();
      pedOrig.idFactura = idVenta;
      pedOrig.idVenta = idVenta;
      guardarPedidosLocal();
      encolarAccionSincronizacion("marcarPedidoComprado", { id: idPedOrig, idVenta: idVenta });
    }
  }

  renderizarTodo();
  renderizarPanelCliente();

  abrirModalRecibo(ventaObj);

  // Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("registrarVenta", { venta: ventaObj });
}

// ==========================================================================
// GUARDAR PEDIDO DE CLIENTE (ENCARGO)
// ==========================================================================
function guardarPedidoCliente() {
  if (state.carrito.length === 0) {
    mostrarToast("Agrega licores al pedido antes de guardar", "error");
    return;
  }

  const vendedor = state.vendedorActual || "Carlos";
  const cli = state.clienteSeleccionado;
  const clienteInputVal = document.getElementById("posClienteInput")?.value?.trim();
  const clienteNombre = cli ? cli.nombre : (clienteInputVal || "Cliente General");
  const clienteTelefono = cli ? cli.telefono : "";

  let totalCRC = 0;
  let totalUSD = 0;
  state.carrito.forEach(i => {
    totalCRC += (i.cantidad * i.precioVentaCRC);
    totalUSD += (i.cantidad * i.precioVentaUSD);
  });

  const idPedido = "PED-" + Date.now().toString().slice(-6);
  const pedidoObj = {
    id: idPedido,
    fecha: new Date().toISOString(),
    vendedor,
    cliente: clienteNombre,
    clienteId: cli ? cli.id : null,
    clienteTelefono: clienteTelefono,
    items: [...state.carrito],
    totalCRC,
    totalUSD,
    estado: "pendiente" // "pendiente" | "comprado"
  };

  if (!state.pedidos) state.pedidos = [];
  state.pedidos.unshift(pedidoObj);
  guardarPedidosLocal();
  state.ultimoPedidoCompletado = pedidoObj;

  if (window.confetti) {
    window.confetti({ particleCount: 60, spread: 50, origin: { y: 0.8 } });
  }

  // Limpiar carrito y campos
  state.carrito = [];
  state.clienteSeleccionado = null;
  const clienteInput = document.getElementById("posClienteInput");
  if (clienteInput) clienteInput.value = "";

  renderizarTodo();
  renderizarPanelCliente();

  mostrarToast(`📋 Pedido ${idPedido} guardado con éxito. Se agregó al consolidado del proveedor.`, "success");
  abrirModalRecibo(pedidoObj, true);

  // Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("registrarPedido", { pedido: pedidoObj });
}

// ==========================================================================
// MODAL RECIBO Y WHATSAPP
// ==========================================================================
function abrirModalRecibo(venta, esPedido = false) {
  const modal = document.getElementById("modalRecibo");
  document.getElementById("reciboNegocio").textContent = state.config.nombreNegocio || "DC EL DESTAPE LICORES";
  document.getElementById("reciboId").textContent = `${venta.id} (👤 ${venta.vendedor || state.vendedorActual})`;
  document.getElementById("reciboFecha").textContent = new Date(venta.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  document.getElementById("reciboMetodo").textContent = esPedido ? "Encargo de Botellas" : (venta.metodoPago || "Efectivo");
  
  const totalCRCEl = document.getElementById("reciboTotalCRC");
  const totalUSDEl = document.getElementById("reciboTotalUSD");

  if (esPedido) {
    let totalBotellas = 0;
    (venta.items || []).forEach(i => totalBotellas += Number(i.cantidad || 1));
    totalCRCEl.textContent = `${totalBotellas} botella(s)`;
    totalUSDEl.textContent = "(Encargo al proveedor)";
  } else {
    totalCRCEl.textContent = fmtCRC(venta.totalFinalCRC || venta.totalCRC);
    totalUSDEl.textContent = `(${fmtUSD(venta.totalUSD)} USD)`;
  }

  const puntosRow = document.getElementById("reciboPuntosRow");
  const puntosGanadosEl = document.getElementById("reciboPuntosGanados");
  if (puntosRow && puntosGanadosEl) {
    if (!esPedido && venta.puntosGanados && venta.puntosGanados > 0) {
      puntosRow.classList.remove("hidden");
      puntosRow.classList.add("flex");
      puntosGanadosEl.textContent = `+${venta.puntosGanados.toLocaleString()} pts (${venta.cliente || 'Cliente'})`;
    } else {
      puntosRow.classList.add("hidden");
      puntosRow.classList.remove("flex");
    }
  }

  const itemsCont = document.getElementById("reciboItems");
  if (itemsCont) {
    itemsCont.innerHTML = venta.items.map(i => `
      <div class="flex justify-between py-1 font-mono">
        <div>
          <span class="font-bold text-amber-600 font-sans">${i.cantidad}x</span> ${i.nombre}
        </div>
        <span class="font-bold ${esPedido ? 'text-amber-600' : 'text-slate-800'}">${esPedido ? `${i.cantidad} unids` : fmtCRC(i.cantidad * i.precioVentaCRC)}</span>
      </div>
    `).join("");
  }

  // --- Trazabilidad de pedido preventa ---
  const trazCont = document.getElementById("reciboTrazabilidad");
  if (trazCont) {
    if (!esPedido && venta.pedidoOrigenId) {
      trazCont.classList.remove("hidden");
      trazCont.innerHTML = `
        <div class="mt-2 pt-2 border-t border-gray-200 text-[11px] text-gray-500 space-y-0.5">
          <div class="font-bold text-gray-600 mb-0.5">📋 Trazabilidad de Encargo Preventa</div>
          <div>Pedido origen: <b class="text-gray-800">${venta.pedidoOrigenId}</b></div>
          ${venta.pedidoOrigenVendedor ? `<div>Tomó el pedido: <b class="text-gray-800">${venta.pedidoOrigenVendedor}</b></div>` : ''}
          ${venta.facturadoPor ? `<div>Facturó: <b class="text-gray-800">${venta.facturadoPor}</b></div>` : ''}
        </div>`;
    } else {
      trazCont.classList.add("hidden");
      trazCont.innerHTML = "";
    }
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();
}
function cerrarModalRecibo() {
  const modal = document.getElementById("modalRecibo");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function compartirReciboWhatsApp() {
  const v = state.modoPOS === "pedido" ? (state.ultimoPedidoCompletado || state.ultimaVentaCompletada) : (state.ultimaVentaCompletada || state.ultimoPedidoCompletado);
  if (!v) return;

  const esPedido = v.id && v.id.startsWith("PED-");
  const negocio = state.config.nombreNegocio || "DC EL DESTAPE LICORES";
  const telefono = state.config.telefonoNegocio || "+506 8992-7936";
  const fecha = new Date(v.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  const vendedor = v.vendedor || state.vendedorActual || "Carlos";

  let texto = `🍷 *${negocio.toUpperCase()}* 🍷\n`;
  texto += `📱 *Tel:* ${telefono}\n`;
  texto += `--------------------------------\n`;
  texto += esPedido ? `📋 *COMPROBANTE DE ENCARGO*\n` : `🧾 *COMPROBANTE DE COMPRA*\n`;
  texto += `📅 Fecha: ${fecha}\n`;
  texto += `🎫 N°: ${v.id}\n`;
  texto += `👤 Facturado por: ${v.facturadoPor || vendedor}\n`;
  if (v.pedidoOrigenId) {
    texto += `📋 Pedido preventa: ${v.pedidoOrigenId}\n`;
    if (v.pedidoOrigenVendedor) texto += `🙋 Tomó pedido: ${v.pedidoOrigenVendedor}\n`;
  }
  texto += `👤 Cliente: ${v.cliente || "General"}\n`;
  texto += `--------------------------------\n`;
  
  let totalBotellas = 0;
  v.items.forEach(i => {
    totalBotellas += Number(i.cantidad || 1);
    if (esPedido) {
      texto += `• *${i.cantidad}x* ${i.nombre}\n`;
    } else {
      texto += `• ${i.cantidad}x ${i.nombre} = ${fmtCRC(i.cantidad * i.precioVentaCRC)} (${fmtUSD(i.cantidad * i.precioVentaUSD)})\n`;
    }
  });

  if (!esPedido && v.descuentoPuntos && v.descuentoPuntos > 0) {
    texto += `🎁 *Descuento Puntos:* -${fmtCRC(v.descuentoPuntos)}\n`;
  }
  if (!esPedido && v.puntosGanados && v.puntosGanados > 0) {
    texto += `✨ *Puntos Ganados:* +${v.puntosGanados.toLocaleString()} pts\n`;
  }

  texto += `--------------------------------\n`;
  if (esPedido) {
    texto += `📦 *TOTAL BOTELLAS ENCARGADAS:* ${totalBotellas} unids\n`;
    texto += `📌 *Estado:* Pedido registrado (en gestión con proveedor)\n\n`;
    texto += `¡Hemos anotado tu pedido de licores! Te contactaremos tan pronto las tengamos disponibles. 🍷\n\n`;
  } else {
    texto += `💳 *Método de Pago:* ${v.metodoPago || "Efectivo"}\n`;
    texto += `💵 *TOTAL CRC:* ${fmtCRC(v.totalFinalCRC || v.totalCRC)}\n`;
    texto += `💵 *TOTAL USD:* ${fmtUSD(v.totalUSD)}\n\n`;
    texto += `¡Muchas gracias por su preferencia! 🍷\n\n`;
  }

  // Redes sociales al final con salto de línea
  texto += `📱 *Redes sociales:*\n`;
  texto += `📷 Instagram:\nhttps://www.instagram.com/dceldestape\n\n`;
  texto += `🔵 Facebook:\nhttps://www.facebook.com/share/1CHT3FRSc6/`;

  const encoded = encodeURIComponent(texto);
  const phoneClient = v.clienteTelefono ? v.clienteTelefono.replace(/[^0-9]/g, "") : "";
  const url = phoneClient ? `https://wa.me/506${phoneClient}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  window.open(url, "_blank");
}
function calcularSaldosFinancieros() {
  const tcActual = Number(state.config.tipoCambio) || 520;

  // 1. Total Ventas Facturadas y Gastos de Envío de Ventas
  // IMPORTANTE: state.ventas puede tener UNA fila por producto cuando vienen de Sheets,
  // por lo que hay que deduplicar tanto el total como el envío por ID de venta.
  let totalVentasCRC = 0;
  let totalVentasUSD = 0;
  let totalEnvioVentasCRC = 0;
  let totalEnvioVentasUSD = 0;

  // Primero, si la venta tiene items[] (formato local), usarla directamente.
  // Si no (formato Sheets fila-por-producto), deduplicar por ID.
  const ventasIdSet = new Set();

  state.ventas.forEach(v => {
    const vid = v.id || "";

    // Resolver costo de envío de la venta (si está en 0, buscar en notas o en cuenta CXC vinculada)
    let envCRC = parseNum(v.costoEnvioCRC, 0);
    if (envCRC === 0 && v.notas) {
      const matchEnv = v.notas.match(/env[íi]o:\s*₡?\s*(\d+)/i) || v.notas.match(/flete:\s*₡?\s*(\d+)/i);
      if (matchEnv && matchEnv[1]) envCRC = parseNum(matchEnv[1], 0);
    }
    if (envCRC === 0 && vid) {
      const ctaMatch = (state.cuentas || []).find(c => 
        c.tipo === "Por Cobrar" && (
          c.ventaId === vid || 
          (c.referenciaId && c.referenciaId.includes(vid)) || 
          (c.notas && c.notas.includes(vid))
        )
      );
      if (ctaMatch) {
        const datosEnvCta = obtenerDatosEnvioCuenta(ctaMatch);
        if (datosEnvCta.costoEnvioCRC > 0) {
          envCRC = datosEnvCta.costoEnvioCRC;
          v.costoEnvioCRC = envCRC;
        }
      }
    }
    const envUSD = tcActual > 0 ? (envCRC / tcActual) : 0;

    if (v.items && Array.isArray(v.items)) {
      // Formato local: objeto completo con items[], procesar una sola vez
      totalVentasCRC += Number(v.totalFinalCRC !== undefined ? v.totalFinalCRC : v.totalCRC) || 0;
      totalVentasUSD += Number(v.totalUSD) || 0;
      totalEnvioVentasCRC += envCRC;
      totalEnvioVentasUSD += envUSD;
    } else {
      // Formato Sheets: una fila por producto. Sumar totalCRC de cada fila individualmente,
      // pero el envío solo se suma una vez por ID de venta.
      totalVentasCRC += Number(v.totalCRC) || 0;
      totalVentasUSD += Number(v.totalUSD) || 0;

      if (vid && !ventasIdSet.has(vid)) {
        ventasIdSet.add(vid);
        totalEnvioVentasCRC += envCRC;
        totalEnvioVentasUSD += envUSD;
      }
    }
  });

  // 1.1 Cuentas por Cobrar Pendientes (Dinero que aún no ha ingresado físicamente a caja)
  // IMPORTANTE: Para el sistema interno, la deuda pendiente a favor de la empresa es el VALOR NETO REAL (Venta - Envío)
  let totalCxcPendienteCRC = 0;
  let totalCxcPendienteUSD = 0;
  let totalCxcBrutoClienteCRC = 0;
  let totalEnvioEnCxcCRC = 0;

  (state.cuentas || []).forEach(cta => {
    if (cta.tipo === "Por Cobrar" && (cta.estado || "Pendiente") !== "Pagado") {
      const datosEnv = obtenerDatosEnvioCuenta(cta);
      const sNetoCRC = datosEnv.valorNetoCRC;
      const sNetoUSD = datosEnv.valorNetoUSD;
      if (sNetoCRC > 0) {
        totalCxcPendienteCRC += sNetoCRC;
        totalCxcPendienteUSD += sNetoUSD;
        totalCxcBrutoClienteCRC += datosEnv.valorClienteCRC;
        totalEnvioEnCxcCRC += datosEnv.envioPendienteCRC;
      }
    }
  });

  // Ventas efectivamente cobradas en caja = (Total Facturado - CXC Pendiente Neto) - Costo de Envío de las ventas
  // Matemáticamente:
  // - Venta de contado (10,000 con 1,800 envío) => 10,000 - 0 CXC - 1,800 envío = 8,200 cobrados a caja.
  // - Venta pendiente en CXC (13,000 con 2,000 envío) => 13,000 - 11,000 CXC neto - 2,000 envío = 0 en caja (impacto nulo hasta que se cobre).
  // - Cuando el cliente liquida su CXC => CXC neto pasa a 0 => 13,000 - 0 CXC - 2,000 envío = 11,000 netos que ingresan a caja.
  const ventasFacturadasCobradasCRC = Math.max(0, totalVentasCRC - totalCxcPendienteCRC);
  const ventasEfectivamenteCobradasCRC = Math.max(0, ventasFacturadasCobradasCRC - totalEnvioVentasCRC);
  const ventasEfectivamenteCobradasUSD = tcActual > 0 ? (ventasEfectivamenteCobradasCRC / tcActual) : 0;

  // 2. Compras según quién las pagó / financió (incluye flete/envío si se pagó en la compra)
  let carlosFinanciaComprasCRC = 0;
  let carlosFinanciaComprasUSD = 0;
  let danielFinanciaComprasCRC = 0;
  let danielFinanciaComprasUSD = 0;
  let empresaPagaComprasCRC = 0;
  let empresaPagaComprasUSD = 0;

  state.compras.forEach(c => {
    const cant = Number(c.cantidad) || 1;
    const tc = Number(c.tipoCambio) || tcActual;
    const envioCompCRC = Number(c.costoEnvioCRC || 0);
    const envioCompUSD = Number(c.costoEnvioUSD || (tc > 0 ? envioCompCRC / tc : 0));
    const cUSD = Number(c.totalUSD) || (cant * (Number(c.costoUnitarioUSD) || 0) + envioCompUSD);
    const cCRC = Number(c.totalCRC) || (cant * (Number(c.costoUnitarioCRC) || 0) + envioCompCRC);
    const pagador = c.pagadoPor || c.vendedor || "Carlos";

    if (pagador === "Carlos") {
      carlosFinanciaComprasCRC += cCRC;
      carlosFinanciaComprasUSD += cUSD;
    } else if (pagador === "Daniel") {
      danielFinanciaComprasCRC += cCRC;
      danielFinanciaComprasUSD += cUSD;
    } else if (pagador === "Empresa") {
      empresaPagaComprasCRC += cCRC;
      empresaPagaComprasUSD += cUSD;
    }
  });

  // 3. Movimientos directos de dinero (Aportes, Pagos de Deuda, Gastos)
  let carlosAportesDirectosCRC = 0;
  let carlosAportesDirectosUSD = 0;
  let carlosReembolsosCRC = 0;
  let carlosReembolsosUSD = 0;

  let danielAportesDirectosCRC = 0;
  let danielAportesDirectosUSD = 0;
  let danielReembolsosCRC = 0;
  let danielReembolsosUSD = 0;

  let empresaGastosCRC = 0;
  let empresaGastosUSD = 0;
  let empresaCapitalPropioCRC = 0;  // Saldo inicial o capital propio de la empresa
  let empresaCapitalPropioUSD = 0;

  state.movimientosDinero.forEach(m => {
    const tc = Number(m.tipoCambio) || tcActual;
    const mCRC = Number(m.montoCRC) || ((Number(m.montoUSD) || 0) * tc);
    const mUSD = Number(m.montoUSD) || (mCRC / tc);

    if (m.tipo === "aporte_capital") {
      if (m.socio === "Carlos") {
        carlosAportesDirectosCRC += mCRC;
        carlosAportesDirectosUSD += mUSD;
      } else if (m.socio === "Daniel") {
        danielAportesDirectosCRC += mCRC;
        danielAportesDirectosUSD += mUSD;
      } else {
        // Socio vacío o "Empresa" = capital propio / saldo inicial de la empresa
        empresaCapitalPropioCRC += mCRC;
        empresaCapitalPropioUSD += mUSD;
      }
    } else if (m.tipo === "pago_socio") {
      if (m.socio === "Carlos") {
        carlosReembolsosCRC += mCRC;
        carlosReembolsosUSD += mUSD;
      } else if (m.socio === "Daniel") {
        danielReembolsosCRC += mCRC;
        danielReembolsosUSD += mUSD;
      }
    } else if (m.tipo === "gasto_operativo") {
      empresaGastosCRC += mCRC;
      empresaGastosUSD += mUSD;
    }
  });

  // Totales aportados y deudas de socios
  const carlosTotalAportadoCRC = carlosFinanciaComprasCRC + carlosAportesDirectosCRC;
  const carlosTotalAportadoUSD = carlosFinanciaComprasUSD + carlosAportesDirectosUSD;
  const carlosDeudaCRC = carlosTotalAportadoCRC - carlosReembolsosCRC;
  const carlosDeudaUSD = carlosTotalAportadoUSD - carlosReembolsosUSD;

  const danielTotalAportadoCRC = danielFinanciaComprasCRC + danielAportesDirectosCRC;
  const danielTotalAportadoUSD = danielFinanciaComprasUSD + danielAportesDirectosUSD;
  const danielDeudaCRC = danielTotalAportadoCRC - danielReembolsosCRC;
  const danielDeudaUSD = danielTotalAportadoUSD - danielReembolsosUSD;

  // Saldo real en caja de la Empresa (Solo dinero cobrado efectivamente menos envíos)
  const totalAportesSociosCRC = carlosAportesDirectosCRC + danielAportesDirectosCRC;
  const totalAportesSociosUSD = carlosAportesDirectosUSD + danielAportesDirectosUSD;
  const totalReembolsosSociosCRC = carlosReembolsosCRC + danielReembolsosCRC;
  const totalReembolsosSociosUSD = carlosReembolsosUSD + danielReembolsosUSD;

  // Saldo Real = Ventas Netas Cobradas + Capital Propio Empresa + Aportes Socios - Compras Empresa - Reembolsos - Gastos
  const saldoEmpresaCRC = ventasEfectivamenteCobradasCRC + empresaCapitalPropioCRC + totalAportesSociosCRC - empresaPagaComprasCRC - totalReembolsosSociosCRC - empresaGastosCRC;
  const saldoEmpresaUSD = tcActual > 0 ? (saldoEmpresaCRC / tcActual) : 0;

  return {
    tcActual,
    totalVentasCRC,
    totalVentasUSD: tcActual > 0 ? (totalVentasCRC / tcActual) : 0,
    totalEnvioVentasCRC,
    totalEnvioVentasUSD,
    cxcPendienteCRC: totalCxcPendienteCRC,
    cxcPendienteUSD: totalCxcPendienteUSD,
    ventasCobradasCRC: ventasEfectivamenteCobradasCRC,
    ventasCobradasUSD: ventasEfectivamenteCobradasUSD,
    empresa: {
      saldoCRC: saldoEmpresaCRC,
      saldoUSD: saldoEmpresaUSD,
      ventasCRC: totalVentasCRC,
      enviosVentasCRC: totalEnvioVentasCRC,
      cxcPendienteCRC: totalCxcPendienteCRC,
      cxcPendienteUSD: totalCxcPendienteUSD,
      cxcBrutoClienteCRC: totalCxcBrutoClienteCRC,
      envioEnCxcCRC: totalEnvioEnCxcCRC,
      gastosCRC: empresaGastosCRC + empresaPagaComprasCRC
    },
    carlos: {
      deudaCRC: carlosDeudaCRC,
      deudaUSD: tcActual > 0 ? (carlosDeudaCRC / tcActual) : 0,
      totalAportadoCRC: carlosTotalAportadoCRC,
      totalAportadoUSD: tcActual > 0 ? (carlosTotalAportadoCRC / tcActual) : 0,
      reembolsadoCRC: carlosReembolsosCRC
    },
    daniel: {
      deudaCRC: danielDeudaCRC,
      deudaUSD: tcActual > 0 ? (danielDeudaCRC / tcActual) : 0,
      totalAportadoCRC: danielTotalAportadoCRC,
      totalAportadoUSD: tcActual > 0 ? (danielTotalAportadoCRC / tcActual) : 0,
      reembolsadoCRC: danielReembolsosCRC
    }
  };
}

function renderizarFinanzas() {
  const fin = calcularSaldosFinancieros();

  // Actualizar Caja Empresa
  const elEmpresaCRC = document.getElementById("finSaldoEmpresaCRC");
  const elEmpresaUSD = document.getElementById("finSaldoEmpresaUSD");
  if (elEmpresaCRC) elEmpresaCRC.textContent = fmtCRC(fin.empresa.saldoCRC);
  if (elEmpresaUSD) elEmpresaUSD.textContent = fmtUSD(fin.empresa.saldoUSD);

  // Rubro Extra: Cuentas por Cobrar Pendientes (Dinero que falta por ingresar: Valor Neto Real)
  const elCxcCRC = document.getElementById("finCxcPendienteCRC");
  const elCxcUSD = document.getElementById("finCxcPendienteUSD");
  const elCxcBadge = document.getElementById("finCxcBadge");
  if (elCxcCRC) elCxcCRC.textContent = fmtCRC(fin.empresa.cxcPendienteCRC);
  if (elCxcUSD) {
    if (fin.empresa.envioEnCxcCRC > 0) {
      elCxcUSD.innerHTML = `<span>(${fmtUSD(fin.empresa.cxcPendienteUSD)} USD)</span><span class="block text-[9.5px] text-slate-400 font-sans mt-0.5">Bruto clientes: ${fmtCRC(fin.empresa.cxcBrutoClienteCRC)} | Envíos: -${fmtCRC(fin.empresa.envioEnCxcCRC)}</span>`;
    } else {
      elCxcUSD.textContent = `(${fmtUSD(fin.empresa.cxcPendienteUSD)} USD)`;
    }
  }
  if (elCxcBadge) {
    if (fin.empresa.cxcPendienteCRC > 0) {
      elCxcBadge.classList.remove("hidden");
    } else {
      elCxcBadge.classList.add("hidden");
    }
  }

  // Desglose de Ventas Cobradas
  const elVentasCobradas = document.getElementById("finVentasCobradasCRC");
  if (elVentasCobradas) elVentasCobradas.textContent = fmtCRC(fin.ventasCobradasCRC);

  const elVentasFacturadas = document.getElementById("finVentasFacturadasCRC");
  if (elVentasFacturadas) elVentasFacturadas.textContent = fmtCRC(fin.totalVentasCRC);

  // Actualizar Carlos
  const elCarlosCRC = document.getElementById("finDeudaCarlosCRC");
  const elCarlosUSD = document.getElementById("finDeudaCarlosUSD");
  if (elCarlosCRC) elCarlosCRC.textContent = fmtCRC(fin.carlos.deudaCRC);
  if (elCarlosUSD) elCarlosUSD.textContent = `(${fmtUSD(fin.carlos.deudaUSD)} USD)`;

  // Actualizar Daniel
  const elDanielCRC = document.getElementById("finDeudaDanielCRC");
  const elDanielUSD = document.getElementById("finDeudaDanielUSD");
  if (elDanielCRC) elDanielCRC.textContent = fmtCRC(fin.daniel.deudaCRC);
  if (elDanielUSD) elDanielUSD.textContent = `(${fmtUSD(fin.daniel.deudaUSD)} USD)`;

  renderizarHistorialFinanzas();
}

function obtenerListaVentasConsolidadas() {
  const map = new Map();
  
  (state.ventas || []).forEach(v => {
    const id = v.id || ("VTA-" + (v.fecha || ""));
    if (!map.has(id)) {
      map.set(id, {
        id: id,
        fecha: v.fecha,
        vendedor: v.vendedor || "Carlos",
        cliente: v.cliente || "Cliente General",
        metodoPago: v.metodoPago || "Efectivo",
        totalCRC: 0,
        totalUSD: 0,
        costoEnvioCRC: 0,
        costoEnvioUSD: 0,
        facturadoPor: v.facturadoPor || "",
        pedidoOrigenId: v.pedidoOrigenId || "",
        pedidoOrigenVendedor: v.pedidoOrigenVendedor || "",
        itemsSummary: []
      });
    }

    const sale = map.get(id);
    if (!sale.facturadoPor && v.facturadoPor) sale.facturadoPor = v.facturadoPor;
    if (!sale.pedidoOrigenId && v.pedidoOrigenId) sale.pedidoOrigenId = v.pedidoOrigenId;
    if (!sale.pedidoOrigenVendedor && v.pedidoOrigenVendedor) sale.pedidoOrigenVendedor = v.pedidoOrigenVendedor;

    const envCRC = parseNum(v.costoEnvioCRC, 0);
    const envUSD = parseNum(v.costoEnvioUSD, 0);
    if (envCRC > sale.costoEnvioCRC) sale.costoEnvioCRC = envCRC;
    if (envUSD > sale.costoEnvioUSD) sale.costoEnvioUSD = envUSD;

    if (v.items && Array.isArray(v.items)) {
      sale.totalCRC = parseNum(v.totalCRC !== undefined ? v.totalCRC : v.totalFinalCRC, 0);
      sale.totalUSD = parseNum(v.totalUSD, 0);
      sale.itemsSummary = v.items.map(i => `${i.cantidad}x ${i.nombre || i.codigo}`);
    } else {
      const cant = parseNum(v.cantidad, 1);
      const totCRC = parseNum(v.totalCRC, 0) || (cant * parseNum(v.precioCRC, 0));
      const totUSD = parseNum(v.totalUSD, 0) || (cant * parseNum(v.precioUSD, 0));
      sale.totalCRC += totCRC;
      sale.totalUSD += totUSD;
      sale.itemsSummary.push(`${cant}x ${v.nombre || v.codigo}`);
    }
  });

  return Array.from(map.values());
}

function renderizarHistorialFinanzas() {
  const cont = document.getElementById("finMovimientosList");
  const countEl = document.getElementById("finMovimientosCount");
  if (!cont) return;

  const filtro = state.filtroFinanzas || "todos";
  const tcActual = parseNum(state.config.tipoCambio, 520) || 520;

  // 1. Movimientos directos (Aportes, Pagos a socios, Gastos)
  const movsDirectos = (state.movimientosDinero || []).map(m => ({
    origen: 'movimiento',
    id: m.id,
    fecha: m.fecha,
    tipo: m.tipo,
    socio: m.socio || "",
    cuentaOrigen: m.cuentaOrigen || "",
    cuentaDestino: m.cuentaDestino || "",
    montoCRC: parseNum(m.montoCRC, 0),
    montoUSD: parseNum(m.montoUSD, 0),
    costoEnvioCRC: 0,
    costoEnvioUSD: 0,
    metodoPago: m.metodoPago || "SINPE Móvil",
    notas: m.notas || "",
    registradoPor: m.registradoPor || m.socio || "Carlos"
  }));

  // 2. Inyecciones de Dinero por Ventas del POS (Neto a Caja = Total Venta - Flete/Envío)
  const ventasConsolidadas = obtenerListaVentasConsolidadas().map(v => {
    const envioCRC = parseNum(v.costoEnvioCRC, 0);
    const envioUSD = parseNum(v.costoEnvioUSD, 0) || (tcActual > 0 ? envioCRC / tcActual : 0);
    const montoNetoCRC = Math.max(0, v.totalCRC - envioCRC);
    const montoNetoUSD = Math.max(0, v.totalUSD - envioUSD);

    let extraTraz = "";
    if (v.pedidoOrigenId) {
      extraTraz = ` • Pedido: ${v.pedidoOrigenId}${v.pedidoOrigenVendedor ? ` (${v.pedidoOrigenVendedor})` : ''}`;
    }

    return {
      origen: 'venta',
      id: v.id,
      fecha: v.fecha,
      tipo: 'venta_pos',
      socio: v.vendedor || "Carlos",
      cuentaOrigen: `Venta POS (${v.vendedor || "Carlos"})`,
      cuentaDestino: "Caja Empresa",
      montoCRC: montoNetoCRC,
      montoUSD: montoNetoUSD,
      totalBrutoCRC: v.totalCRC,
      totalBrutoUSD: v.totalUSD,
      costoEnvioCRC: envioCRC,
      costoEnvioUSD: envioUSD,
      metodoPago: v.metodoPago || "Efectivo",
      notas: `${v.itemsSummary.join(", ")}${v.cliente && v.cliente !== 'Cliente General' ? ` • Cl: ${v.cliente}` : ''}${extraTraz}`,
      registradoPor: v.facturadoPor || v.vendedor || "Carlos"
    };
  });

  // 3. Egresos por Compras pagadas directamente con fondos de la Empresa
  const comprasEmpresa = (state.compras || [])
    .filter(c => (c.pagadoPor === "Empresa" || c.financiadoPor === "Empresa"))
    .map(c => {
      const cant = parseNum(c.cantidad, 1);
      const tc = parseNum(c.tipoCambio || state.config.tipoCambio, 520) || 520;
      const envioCompCRC = parseNum(c.costoEnvioCRC, 0);
      const envioCompUSD = parseNum(c.costoEnvioUSD, 0) || (tc > 0 ? envioCompCRC / tc : 0);
      const cUSD = parseNum(c.totalUSD, 0) || (cant * parseNum(c.costoUnitarioUSD, 0) + envioCompUSD);
      const cCRC = parseNum(c.totalCRC, 0) || (cant * parseNum(c.costoUnitarioCRC, cUSD * tc) + envioCompCRC);

      return {
        origen: 'compra_empresa',
        id: c.id,
        fecha: c.fecha,
        tipo: 'compra_empresa',
        socio: c.vendedor || "Carlos",
        cuentaOrigen: "Caja Empresa",
        cuentaDestino: c.proveedor || "Proveedor",
        montoCRC: cCRC,
        montoUSD: cUSD,
        costoEnvioCRC: envioCompCRC,
        costoEnvioUSD: envioCompUSD,
        metodoPago: "Caja Empresa",
        notas: `Compra ${cant}x ${c.nombre || c.codigo} (${c.proveedor || 'Proveedor'})`,
        registradoPor: c.vendedor || "Carlos"
      };
    });

  // Combinar todos los movimientos
  let todosLosMovimientos = [...movsDirectos, ...ventasConsolidadas, ...comprasEmpresa];

  // Ordenar cronológicamente (más recientes primero)
  todosLosMovimientos.sort((a, b) => {
    const tA = a.fecha ? new Date(a.fecha).getTime() : 0;
    const tB = b.fecha ? new Date(b.fecha).getTime() : 0;
    return tB - tA;
  });

  // Filtrar según la pestaña seleccionada
  let lista = todosLosMovimientos;
  if (filtro === "Empresa") {
    lista = lista.filter(m => 
      m.tipo === "venta_pos" ||
      m.tipo === "compra_empresa" ||
      m.cuentaOrigen === "Empresa" || 
      m.cuentaDestino === "Empresa" || 
      m.tipo === "gasto_operativo" ||
      m.tipo === "aporte_capital" ||
      m.tipo === "pago_socio"
    );
  } else if (filtro === "Carlos") {
    lista = lista.filter(m => 
      m.socio === "Carlos" || 
      m.registradoPor === "Carlos" || 
      m.cuentaOrigen === "Carlos" || 
      m.cuentaDestino === "Carlos" ||
      (m.tipo === "venta_pos" && m.socio === "Carlos")
    );
  } else if (filtro === "Daniel") {
    lista = lista.filter(m => 
      m.socio === "Daniel" || 
      m.registradoPor === "Daniel" || 
      m.cuentaOrigen === "Daniel" || 
      m.cuentaDestino === "Daniel" ||
      (m.tipo === "venta_pos" && m.socio === "Daniel")
    );
  }

  if (countEl) countEl.textContent = lista.length;

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="text-center py-8 text-slate-500 space-y-2">
        <i data-lucide="wallet" class="w-8 h-8 mx-auto text-slate-600"></i>
        <p class="text-xs">No hay movimientos financieros registrados aún.</p>
        <p class="text-[10px] text-slate-600">Registra ventas, aportes o pagos para ver el flujo de caja en vivo.</p>
      </div>
    `;
    inicializarIconos();
    return;
  }

  cont.innerHTML = lista.map(m => {
    const isVenta = m.tipo === "venta_pos";
    const isAporte = m.tipo === "aporte_capital";
    const isPagoSocio = m.tipo === "pago_socio";
    const isGasto = m.tipo === "gasto_operativo";
    const isCompraEmpresa = m.tipo === "compra_empresa";

    let colorBadge = "bg-blue-950/60 text-blue-400 border-blue-500/30";
    let iconName = "plus-circle";
    let tituloTipo = "Aporte de Capital";
    let subtitulo = `${m.socio || "Socio"} -> Caja Empresa`;
    let signoMonto = "+";
    let colorMonto = "text-emerald-400";

    if (isVenta) {
      const vendBadge = m.socio === "Daniel" ? "text-violet-300" : "text-blue-300";
      colorBadge = "bg-emerald-950/80 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/20";
      iconName = "shopping-cart";
      tituloTipo = `Ingreso x Venta (${m.socio || "POS"})`;
      subtitulo = `Venta POS <span class="${vendBadge} font-bold">(${m.socio})</span> -> Caja Empresa`;
      signoMonto = "+";
      colorMonto = "text-emerald-400 font-black";
    } else if (isPagoSocio) {
      colorBadge = "bg-emerald-950/60 text-emerald-400 border-emerald-500/30";
      iconName = "arrow-up-right";
      tituloTipo = "Pago / Abono a Socio";
      subtitulo = `Caja Empresa -> ${m.socio || "Socio"}`;
      signoMonto = "-";
      colorMonto = "text-blue-400 font-black";
    } else if (isGasto) {
      colorBadge = "bg-rose-950/60 text-rose-400 border-rose-500/30";
      iconName = "receipt";
      tituloTipo = "Gasto Operativo";
      subtitulo = `Caja Empresa -> Gastos`;
      signoMonto = "-";
      colorMonto = "text-rose-400 font-black";
    } else if (isCompraEmpresa) {
      colorBadge = "bg-amber-950/60 text-amber-300 border-amber-500/30";
      iconName = "truck";
      tituloTipo = "Compra Pagada x Empresa";
      subtitulo = `Caja Empresa -> Proveedor`;
      signoMonto = "-";
      colorMonto = "text-amber-400 font-black";
    }

    const fechaStr = m.fecha ? new Date(m.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : todayStr();
    const montoCRC = parseNum(m.montoCRC, 0);
    const montoUSD = parseNum(m.montoUSD, 0);
    const envioCRC = parseNum(m.costoEnvioCRC, 0);
    const envioUSD = parseNum(m.costoEnvioUSD, 0);

    const fleteHtml = envioCRC > 0 ? `
      <div class="text-[10px] text-amber-300 font-mono mt-1.5 bg-amber-950/60 border border-amber-500/40 rounded-lg px-2 py-0.5 inline-flex items-center gap-1.5">
        <span>🚚</span>
        <span>En ${isVenta ? 'factura' : 'compra'} <b>${m.id}</b> se pagó el monto de flete o envío: <b>${fmtCRC(envioCRC)}</b>${envioUSD > 0 ? ` (${fmtUSD(envioUSD)})` : ''}</span>
      </div>
    ` : '';

    const actionRight = (m.origen === 'movimiento') ? `
      <button onclick="eliminarMovimientoDinero('${m.id}')" title="Eliminar transacción" class="text-slate-500 hover:text-rose-400 p-1 transition-all">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    ` : `
      <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
        ${isVenta ? 'POS 🛒' : 'COMPRA 📦'}
      </span>
    `;

    return `
      <div class="p-3 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1.5 hover:border-slate-700 transition-all">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold border ${colorBadge} flex items-center gap-1">
              <i data-lucide="${iconName}" class="w-3 h-3"></i>
              ${tituloTipo}
            </span>
            <span class="text-[10px] text-slate-400 font-mono">${fechaStr}</span>
          </div>
          ${actionRight}
        </div>

        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="font-bold text-white text-xs truncate">${subtitulo}</div>
            <div class="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5 truncate">
              <span>💳 ${m.metodoPago || 'Efectivo'}</span>
              ${m.notas ? `<span class="truncate">• 📝 ${m.notas}</span>` : ''}
            </div>
            ${fleteHtml}
          </div>
          <div class="text-right font-mono shrink-0">
            <div class="text-sm font-black ${colorMonto}">${signoMonto}${fmtCRC(montoCRC)}</div>
            <div class="text-[10px] text-slate-400">(${fmtUSD(montoUSD)})</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  inicializarIconos();
}

function filtrarHistorialFinanzas(filtro) {
  state.filtroFinanzas = filtro;
  ["todos", "empresa", "carlos", "daniel"].forEach(f => {
    const btn = document.getElementById(`finFilter-${f}`);
    if (btn) {
      if (f.toLowerCase() === filtro.toLowerCase()) {
        btn.className = "py-1 rounded-lg bg-indigo-600 text-white text-center font-bold";
      } else {
        btn.className = "py-1 rounded-lg bg-slate-900 text-slate-400 hover:text-white text-center font-bold";
      }
    }
  });
  renderizarHistorialFinanzas();
}

function abrirModalMovimientoDinero(tipoPredefinido = "aporte_capital", socioPredefinido = "") {
  const modal = document.getElementById("modalMovimientoDinero");
  if (!modal) return;

  const tipoSelect = document.getElementById("finTipoMovimiento");
  if (tipoSelect) tipoSelect.value = tipoPredefinido;

  const socioSelect = document.getElementById("finSocioSelect");
  if (socioSelect) {
    if (socioPredefinido) socioSelect.value = socioPredefinido;
    else socioSelect.value = state.vendedorActual || "Carlos";
  }

  const inputFecha = document.getElementById("finFecha");
  if (inputFecha) inputFecha.value = todayStr();

  const inputTC = document.getElementById("finTipoCambio");
  if (inputTC) inputTC.value = state.config.tipoCambio || 520;

  const inputCRC = document.getElementById("finMontoCRC");
  if (inputCRC) inputCRC.value = "";

  const inputUSD = document.getElementById("finMontoUSD");
  if (inputUSD) inputUSD.value = "";

  const inputNotas = document.getElementById("finNotas");
  if (inputNotas) inputNotas.value = "";

  actualizarCamposModalFinanzas();

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();
}

function cerrarModalMovimientoDinero() {
  const modal = document.getElementById("modalMovimientoDinero");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function actualizarCamposModalFinanzas() {
  const tipo = document.getElementById("finTipoMovimiento").value;
  const grupoSocio = document.getElementById("finGrupoSocio");
  const titulo = document.getElementById("modalFinanzasTitulo");

  if (tipo === "gasto_operativo") {
    if (grupoSocio) grupoSocio.classList.add("hidden");
    if (titulo) titulo.innerHTML = `<i data-lucide="receipt" class="w-4 h-4 text-rose-400"></i><span>Gasto Operativo de Empresa</span>`;
  } else if (tipo === "pago_socio") {
    if (grupoSocio) grupoSocio.classList.remove("hidden");
    if (titulo) titulo.innerHTML = `<i data-lucide="arrow-up-right" class="w-4 h-4 text-emerald-400"></i><span>Pagar / Abono a Socio</span>`;
  } else {
    if (grupoSocio) grupoSocio.classList.remove("hidden");
    if (titulo) titulo.innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4 text-blue-400"></i><span>Aporte de Capital a Empresa</span>`;
  }
  inicializarIconos();
}

function autoConvertirFinanzas(origen) {
  const tc = Number(document.getElementById("finTipoCambio").value) || Number(state.config.tipoCambio) || 520;
  const elCRC = document.getElementById("finMontoCRC");
  const elUSD = document.getElementById("finMontoUSD");

  if (origen === 'CRC' && elCRC && elUSD) {
    const crc = Number(elCRC.value) || 0;
    elUSD.value = crc > 0 ? (crc / tc).toFixed(2) : "";
  } else if (origen === 'USD' && elCRC && elUSD) {
    const usd = Number(elUSD.value) || 0;
    elCRC.value = usd > 0 ? Math.round(usd * tc) : "";
  }
}

async function guardarMovimientoDinero(e) {
  if (e) e.preventDefault();

  const tipo = document.getElementById("finTipoMovimiento").value;
  const socio = tipo !== "gasto_operativo" ? document.getElementById("finSocioSelect").value : "";
  const fecha = document.getElementById("finFecha").value || todayStr();
  const montoCRC = Number(document.getElementById("finMontoCRC").value) || 0;
  const tc = Number(document.getElementById("finTipoCambio").value) || Number(state.config.tipoCambio) || 520;
  const montoUSD = Number(document.getElementById("finMontoUSD").value) || (montoCRC / tc);
  const metodoPago = document.getElementById("finMetodoPago").value;
  const notas = document.getElementById("finNotas").value.trim();

  if (montoCRC <= 0) {
    mostrarToast("El monto debe ser mayor a 0.", "error");
    return;
  }

  let cuentaOrigen = "Empresa";
  let cuentaDestino = "Empresa";

  if (tipo === "aporte_capital") {
    cuentaOrigen = socio;
    cuentaDestino = "Empresa";
  } else if (tipo === "pago_socio") {
    cuentaOrigen = "Empresa";
    cuentaDestino = socio;
  } else if (tipo === "gasto_operativo") {
    cuentaOrigen = "Empresa";
    cuentaDestino = "Gasto Operativo";
  }

  const movObj = {
    id: "MOV-" + Date.now().toString().slice(-6),
    fecha,
    tipo,
    cuentaOrigen,
    cuentaDestino,
    socio,
    montoCRC,
    montoUSD,
    tipoCambio: tc,
    metodoPago,
    notas,
    registradoPor: state.vendedorActual || "Carlos"
  };

  state.movimientosDinero.unshift(movObj);
  guardarFinanzasLocal();
  renderizarFinanzas();
  cerrarModalMovimientoDinero();

  const msg = tipo === "aporte_capital" 
    ? `¡Aporte de ${socio} registrado! (+${fmtCRC(montoCRC)})` 
    : tipo === "pago_socio"
    ? `¡Pago a ${socio} registrado! (-${fmtCRC(montoCRC)})`
    : `Gasto registrado (-${fmtCRC(montoCRC)}).`;

  mostrarToast(msg, "success");

  // Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("registrarMovimiento", { movimiento: movObj });
}

async function eliminarMovimientoDinero(id) {
  if (!confirm("¿Deseas eliminar este movimiento financiero?")) return;

  state.movimientosDinero = state.movimientosDinero.filter(m => m.id !== id);
  guardarFinanzasLocal();
  renderizarFinanzas();
  mostrarToast("Movimiento eliminado localmente.", "info");

  // Encolar y sincronizar con Google Sheets
  encolarAccionSincronizacion("eliminarMovimiento", { id });
}

// ==========================================================================
// 6. IMPORTACIÓN Y EXPORTACIÓN EXCEL (.XLSX)
// ==========================================================================
async function exportarLibroExcel() {
  if (!window.XLSX) {
    mostrarToast("Cargando motor de Excel...", "info");
    return;
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  // Hoja Productos
  const prodRows = Object.values(state.productos).map(p => ({
    codigo: p.codigo,
    nombre: p.nombre,
    categoria: p.categoria || "",
    imagenUrl: p.imagenUrl || "",
    precioVentaUSD: p.precioVentaUSD || 0,
    precioVentaCRC: p.precioVentaCRC || 0,
    stockInicial: 0, // Stock se calcula desde compras - ventas; no exportar Stock_Actual de Sheets
    costoRefUSD: p.costoRefUSD || 0,
    costoRefCRC: p.costoRefCRC || 0
  }));

  // Hoja Compras
  const compRows = state.compras.map(p => ({
    id: p.id,
    fecha: p.fecha,
    vendedor: p.vendedor || "Carlos",
    pagadoPor: p.pagadoPor || p.vendedor || "Carlos",
    codigo: p.codigo,
    cantidad: p.cantidad,
    costoUnitarioUSD: p.costoUnitarioUSD,
    tipoCambio: p.tipoCambio,
    costoUnitarioCRC: p.costoUnitarioCRC,
    totalUSD: Number(p.cantidad || 0) * Number(p.costoUnitarioUSD || 0),
    totalCRC: Number(p.cantidad || 0) * Number(p.costoUnitarioCRC || 0),
    proveedor: p.proveedor || "",
    notas: p.notas || ""
  }));

  // Hoja Ventas
  const ventRows = [];
  state.ventas.forEach(v => {
    if (v.items) {
      v.items.forEach(i => {
        ventRows.push({
          id: v.id,
          fecha: v.fecha ? v.fecha.slice(0, 16).replace("T", " ") : todayStr(),
          vendedor: v.vendedor || "Carlos",
          codigo: i.codigo,
          nombre: i.nombre || "",
          cantidad: i.cantidad,
          precioUnitarioUSD: i.precioVentaUSD,
          precioUnitarioCRC: i.precioVentaCRC,
          totalUSD: (i.cantidad || 1) * (i.precioVentaUSD || 0),
          totalCRC: (i.cantidad || 1) * (i.precioVentaCRC || 0),
          cliente: v.cliente || "General",
          metodoPago: v.metodoPago || "Efectivo"
        });
      });
    }
  });

  // Hoja Finanzas
  const finRows = state.movimientosDinero.map(m => ({
    id: m.id,
    fecha: m.fecha,
    tipo: m.tipo,
    cuentaOrigen: m.cuentaOrigen,
    cuentaDestino: m.cuentaDestino,
    socio: m.socio || "",
    montoCRC: m.montoCRC,
    montoUSD: m.montoUSD,
    tipoCambio: m.tipoCambio,
    metodoPago: m.metodoPago || "SINPE Móvil",
    notas: m.notas || "",
    registradoPor: m.registradoPor || "Carlos"
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows), "Productos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compRows), "Compras");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventRows), "Ventas");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(finRows), "Finanzas");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventario_licores_${todayStr()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  mostrarToast("Archivo Excel descargado con éxito 📊", "success");
}

async function importarArchivoExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  mostrarToast("Leyendo archivo Excel...", "info");
  try {
    const XLSX = window.XLSX;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
        
        // Hojas
        const prodKey = wb.SheetNames.find(n => ["productos", "catalogo", "products"].includes(n.trim().toLowerCase()));
        const compKey = wb.SheetNames.find(n => ["compras", "purchases"].includes(n.trim().toLowerCase()));
        const ventKey = wb.SheetNames.find(n => ["ventas", "sales"].includes(n.trim().toLowerCase()));

        let importadosCount = 0;

        if (prodKey) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[prodKey], { defval: "" });
          rows.forEach(r => {
            const codigo = String(r.codigo || r.Codigo || r.SKU || "").trim();
            if (codigo) {
              state.productos[codigo] = {
                codigo,
                nombre: String(r.nombre || r.Nombre || codigo).trim(),
                categoria: String(r.categoria || r.Categoria || "General").trim(),
                imagenUrl: String(r.imagenUrl || r.Imagen_URL || r.imagen || r.foto || "").trim(),
                precioVentaUSD: Number(r.precioVentaUSD || r.PrecioVentaUSD || 0),
                precioVentaCRC: Number(r.precioVentaCRC || r.PrecioVentaCRC || 0),
                stockInicial: 0, // No se importa: el stock se calcula desde compras - ventas
                costoRefUSD: Number(r.costoRefUSD || r.CostoRefUSD || 0),
                costoRefCRC: Number(r.costoRefCRC || r.CostoRefCRC || 0)
              };
              importadosCount++;
            }
          });
          guardarProductosLocal();
        }

        if (compKey) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[compKey], { defval: "" });
          const comprasNuevas = rows.map(r => ({
            id: String(r.id || uid()),
            fecha: r.fecha ? new Date(r.fecha).toISOString().slice(0, 10) : todayStr(),
            vendedor: String(r.vendedor || r.Vendedor || "Carlos").trim(),
            codigo: String(r.codigo || r.Codigo).trim(),
            cantidad: Number(r.cantidad || 1),
            costoUnitarioUSD: Number(r.costoUnitarioUSD || 0),
            tipoCambio: Number(r.tipoCambio || state.config.tipoCambio || 520),
            costoUnitarioCRC: Number(r.costoUnitarioCRC || 0),
            proveedor: String(r.proveedor || r.Proveedor || ""),
            notas: String(r.notas || r.Notas || "")
          })).filter(c => c.codigo);
          state.compras = [...comprasNuevas, ...state.compras];
          guardarComprasLocal();
        }

        renderizarTodo();
        mostrarToast(`¡Importación exitosa! (${importadosCount} productos).`, "success");
      } catch (err) {
        mostrarToast("Error al procesar las hojas del Excel.", "error");
      }
    };
    reader.readAsArrayBuffer(file);
  } catch (e) {
    mostrarToast("No se pudo leer el archivo.", "error");
  }
}

// ==========================================================================
// 6. ESCÁNER DE CÓDIGO DE BARRAS / QR
// ==========================================================================
function abrirEscaner(modo = "buscar") {
  state.modoEscaner = modo;
  const modal = document.getElementById("modalEscaner");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  inicializarIconos();

  setTimeout(() => {
    iniciarCamara();
  }, 200);
}

function iniciarCamara() {
  if (state.escanerActivo) {
    state.escanerActivo.stop().catch(() => {});
  }

  const html5QrCode = new Html5Qrcode("reader");
  state.escanerActivo = html5QrCode;

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 15, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
    (decodedText) => onCodigoEscaneado(decodedText),
    () => {}
  ).catch(err => {
    mostrarToast("No se pudo acceder a la cámara.", "error");
    cerrarEscaner();
  });
}

function cerrarEscaner() {
  if (state.escanerActivo) {
    state.escanerActivo.stop().then(() => state.escanerActivo = null).catch(() => state.escanerActivo = null);
  }
  const modal = document.getElementById("modalEscaner");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function onCodigoEscaneado(codigo) {
  reproducirBeep();
  cerrarEscaner();

  if (state.modoEscaner === "nuevo_producto") {
    document.getElementById("prodCodigo").value = codigo;
    mostrarToast(`Código: ${codigo}`, "success");
  } else if (state.modoEscaner === "buscar") {
    document.getElementById("searchInventory").value = codigo;
    cambiarVista("inventario");
    filtrarInventario();
  } else if (state.modoEscaner === "compra") {
    seleccionarProductoCompraPorCodigo(codigo);
  } else if (state.modoEscaner === "venta") {
    agregarAlCarritoPorCodigo(codigo);
  }
}

function reproducirBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

// ==========================================================================
// 7. CONEXIÓN API CON GOOGLE APPS SCRIPT Y MOTOR OFFLINE-FIRST
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

function describirAccionSincronizacion(accion, datos) {
  datos = datos || {};
  switch (accion) {
    case "registrarVenta":
      return (datos.venta && datos.venta.id) ? ("Enviando venta (" + datos.venta.id + ")...") : "Enviando venta a Sheets...";
    case "registrarCompra":
      return (datos.compra && datos.compra.id) ? ("Enviando compra (" + datos.compra.id + ")...") : "Enviando compra a Sheets...";
    case "eliminarCompra":
      return "Eliminando compra (" + (datos.id || '') + ") en Sheets...";
    case "registrarPedido":
      return (datos.pedido && datos.pedido.id) ? ("Enviando pedido (" + datos.pedido.id + ")...") : "Enviando pedido a Sheets...";
    case "marcarPedidoComprado":
      return "Actualizando estado de pedido (" + (datos.id || '') + ")...";
    case "eliminarPedido":
      return "Eliminando pedido (" + (datos.id || '') + ") en Sheets...";
    case "registrarCuenta":
      return (datos.cuenta && datos.cuenta.id) ? ("Registrando cuenta (" + datos.cuenta.id + ")...") : "Registrando cuenta en Sheets...";
    case "abonarCuenta":
      return "Enviando abono de cuenta (" + (datos.id || '') + ")...";
    case "eliminarCuenta":
      return "Eliminando cuenta (" + (datos.id || '') + ") en Sheets...";
    case "guardarCliente":
      return (datos.cliente && datos.cliente.nombre) ? ("Guardando cliente (" + datos.cliente.nombre + ")...") : "Guardando cliente en Sheets...";
    case "actualizarPuntos":
      return "Actualizando puntos de cliente en Sheets...";
    case "crearProducto":
    case "actualizarProducto":
      return (datos.producto && datos.producto.nombre) ? ("Guardando producto (" + datos.producto.nombre + ")...") : "Guardando producto en Sheets...";
    case "eliminarProducto":
      return "Eliminando producto (" + (datos.codigo || '') + ")...";
    case "registrarMovimiento":
      return "Registrando movimiento de finanzas en Sheets...";
    case "eliminarMovimiento":
      return "Eliminando movimiento de finanzas en Sheets...";
    case "anularVenta":
      return "Enviando anulación de venta a Sheets...";
    case "registrarLiquidacion":
      return "Registrando liquidación de comisión...";
    case "eliminarLiquidacion":
      return "Eliminando liquidación...";
    default:
      return "Enviando " + accion + "...";
  }
}

let sincronizandoCola = false;

function encolarAccionSincronizacion(accion, datos) {
  if (!state.colaSincronizacion) state.colaSincronizacion = [];

  // Deduplicar en cola local para evitar reencolar el mismo objeto idéntico
  const payloadStr = JSON.stringify(datos || {});
  const yaExisteEnCola = state.colaSincronizacion.some(it => 
    it.accion === accion && JSON.stringify(it.datos || {}) === payloadStr
  );
  if (yaExisteEnCola) {
    console.log("[SYNC] Acción ya en cola pendiente, evitando duplicar:", accion);
    return;
  }

  const item = {
    id: "SYNC-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    accion: accion,
    datos: datos,
    fecha: new Date().toISOString()
  };

  state.colaSincronizacion.push(item);
  guardarColaLocal();
  actualizarIndicadorOffline();

  // Intentar sincronizar en segundo plano si hay conexión
  if (navigator.onLine && state.config.sheetsUrl) {
    procesarColaSincronizacion(false);
  }
}

async function procesarColaSincronizacion(mostrarFeedback = false) {
  if (sincronizandoCola) return;

  actualizarIndicadorOffline();

  if (!navigator.onLine) {
    if (mostrarFeedback) {
      mostrarToast(`Sin conexión. ${state.colaSincronizacion.length} cambios guardados localmente 💾`, "info");
    }
    return;
  }

  if (!state.config.sheetsUrl) {
    if (mostrarFeedback) {
      mostrarToast("Configura la URL de Google Sheets en Ajustes ⚙️.", "error");
    }
    return;
  }

  if (!state.colaSincronizacion || state.colaSincronizacion.length === 0) {
    if (mostrarFeedback) {
      await sincronizarConSheets(true);
    }
    actualizarIndicadorOffline();
    return;
  }

  sincronizandoCola = true;
  const icon = document.getElementById("syncIcon");
  if (icon) icon.classList.add("animate-spin");

  const totalAProcesar = state.colaSincronizacion.length;
  mostrarBloqueoSincronizacion(`Subiendo cambios a Google Sheets (1 de ${totalAProcesar})...`);

  try {
    let indexItem = 0;
    while (state.colaSincronizacion.length > 0) {
      const item = state.colaSincronizacion[0];
      indexItem++;
      const descripcion = describirAccionSincronizacion(item.accion, item.datos);
      actualizarMensajeBloqueoSincronizacion(`[${indexItem}/${totalAProcesar}] ${descripcion}`);

      try {
        await enviarPeticionSheets(item.accion, item.datos);
        // Si no arrojó excepción de red, se procesó
        state.colaSincronizacion.shift();
        guardarColaLocal();
        actualizarIndicadorOffline();
      } catch (err) {
        console.warn("Fallo temporal de red al procesar item de sincronización:", item, err);
        break; // Detener bucle y mantener los ítems restantes en cola
      }
    }

    if (state.colaSincronizacion.length === 0) {
      actualizarMensajeBloqueoSincronizacion("Descargando datos actualizados de Sheets...");
      // Descargar datos frescos sin volver a procesar cola (ya está vacía)
      sincronizandoCola = false; // liberar flag antes del GET
      await _descargarDatosSheets(mostrarFeedback);
      return;
    } else {
      mostrarToast(`Quedan ${state.colaSincronizacion.length} cambios pendientes por sincronizar.`, "info");
    }
  } catch (globalErr) {
    console.error("Error al procesar cola de sincronización:", globalErr);
  } finally {
    sincronizandoCola = false;
    if (icon) icon.classList.remove("animate-spin");
    actualizarIndicadorOffline();
    ocultarBloqueoSincronizacion();
  }
}

function actualizarIndicadorOffline() {
  const isOnline = navigator.onLine;
  const pendingCount = (state.colaSincronizacion || []).length;
  const badge = document.getElementById("syncPendingBadge");
  const banner = document.getElementById("offlineSyncBanner");
  const bannerText = document.getElementById("offlineSyncText");

  if (badge) {
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
      badge.classList.remove("hidden");
      badge.classList.add("flex");
    } else {
      badge.classList.add("hidden");
      badge.classList.remove("flex");
    }
  }

  if (banner && bannerText) {
    if (!isOnline) {
      bannerText.textContent = pendingCount > 0 
        ? `📡 Sin Internet (${pendingCount} cambios guardados localmente)`
        : `📡 Modo Offline: Trabajando 100% en memoria local`;
      banner.className = "max-w-md mx-auto px-3.5 py-1.5 mt-2 bg-amber-950/90 border border-amber-500/50 rounded-xl text-amber-200 text-xs font-bold flex items-center justify-between shadow-lg animate-pulse";
      banner.classList.remove("hidden");
    } else if (pendingCount > 0) {
      bannerText.textContent = `🟡 ${pendingCount} cambio(s) pendiente(s) por subir a Sheets.`;
      banner.className = "max-w-md mx-auto px-3.5 py-1.5 mt-2 bg-indigo-950/90 border border-indigo-500/50 rounded-xl text-indigo-200 text-xs font-bold flex items-center justify-between shadow-lg";
      banner.classList.remove("hidden");
    } else {
      // Si todo está sincronizado y hay internet, ocultar el banner para no saturar la pantalla
      banner.classList.add("hidden");
    }
  }

  actualizarBadgeConexion();
}

function actualizarBadgeConexion() {
  const badge = document.getElementById("sheetsConnectionBadge");
  if (!badge) return;

  const isOnline = navigator.onLine;
  const hasUrl = !!state.config.sheetsUrl;
  const pendingCount = (state.colaSincronizacion || []).length;

  if (!isOnline) {
    badge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-500/40 flex items-center gap-1";
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> Modo Offline`;
  } else if (pendingCount > 0) {
    badge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/40 flex items-center gap-1";
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> ${pendingCount} pendientes`;
  } else if (hasUrl) {
    badge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/40 flex items-center gap-1";
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Conectado a Sheets`;
  } else {
    badge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1";
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Sin URL Sheets`;
  }
}

async function enviarPeticionSheets(accion, datos = {}) {
  if (!state.config.sheetsUrl) throw new Error("No hay URL de Sheets configurada.");
  const payload = { action: accion, token: PORTAL_TOKEN, ...datos };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(state.config.sheetsUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function _descargarDatosSheets(mostrarMensaje = false) {
  if (!state.config.sheetsUrl) return;
  if (!navigator.onLine) return;

  const icon = document.getElementById("syncIcon");
  if (icon) icon.classList.add("animate-spin");

  try {
    const url = `${state.config.sheetsUrl}?action=getTodo&token=${PORTAL_TOKEN}&t=${Date.now()}`;
    const resp = await fetch(url, { cache: "no-store" });
    const json = await resp.json();

    console.log("[SYNC] Respuesta de Sheets:", JSON.stringify({ 
      success: json.success, 
      pedidosCount: json.data ? (json.data.pedidos || []).length : "N/A",
      productosCount: json.data ? (json.data.productos || []).length : "N/A"
    }));

    if (json.success && json.data) {
      // 1. Productos: Reflejar fielmente la hoja Productos de Sheets
      if (json.data.productos !== undefined) {
        const mapa = {};
        if (Array.isArray(json.data.productos)) {
          json.data.productos.forEach(p => { 
            if (p && p.codigo) {
              const cod = String(p.codigo).trim().toUpperCase();
              p.codigo = cod;
              p.nombre = String(p.nombre || cod).trim();
              p.categoria = String(p.categoria || "General").trim();
              p.costoRefUSD = parseNum(p.costoRefUSD, 0);
              p.costoRefCRC = parseNum(p.costoRefCRC, 0);
              p.precioVentaUSD = parseNum(p.precioVentaUSD, 0);
              p.precioVentaCRC = parseNum(p.precioVentaCRC, 0);
              p.stockInicial = 0; // Neutralizar: el stock real viene de compras - ventas (no de Stock_Actual en Sheets)
              p.stockMinimo = parseNum(p.stockMinimo, 2);
              p.imagenUrl = String(p.imagenUrl || p.imagen || "").trim();
              mapa[cod] = p;
            }
          });
        }
        state.productos = mapa;
        guardarProductosLocal();
      }

      // 2. Compras: Reflejar fielmente la hoja Compras de Sheets
      if (json.data.ultimasCompras !== undefined || json.data.compras !== undefined) {
        const rawComps = json.data.ultimasCompras || json.data.compras || [];

        // Obtener IDs de compras recientemente eliminadas o en proceso de eliminación
        let eliminadasRecientes = [];
        try {
          eliminadasRecientes = JSON.parse(localStorage.getItem("inv_compras_eliminadas_ids") || "[]");
        } catch(e) { eliminadasRecientes = []; }
        const setEliminadas = new Set((Array.isArray(eliminadasRecientes) ? eliminadasRecientes : []).map(x => String(x).trim()));

        // Agregar también cualquier ID pendiente en cola con accion === "eliminarCompra"
        (state.colaSincronizacion || [])
          .filter(it => it.accion === "eliminarCompra" && it.datos && it.datos.id)
          .forEach(it => setEliminadas.add(String(it.datos.id).trim()));

        const comprasServidor = (Array.isArray(rawComps) ? rawComps : [])
          .filter(c => c && c.id && !setEliminadas.has(String(c.id).trim()))
          .map(c => {
            return {
              ...c,
              codigo: String(c.codigo || "").trim().toUpperCase(),
              cantidad: parseNum(c.cantidad, 1),
              costoUnitarioUSD: parseNum(c.costoUnitarioUSD, 0),
              costoUnitarioCRC: parseNum(c.costoUnitarioCRC, 0),
              tipoCambio: parseNum(c.tipoCambio, state.config.tipoCambio || 520),
              totalUSD: parseNum(c.totalUSD, 0),
              totalCRC: parseNum(c.totalCRC, 0),
              costoEnvioCRC: parseNum(c.costoEnvioCRC, 0),
              costoEnvioUSD: parseNum(c.costoEnvioUSD, 0)
            };
          });

        // Asegurar que compras locales pendientes en cola de sincronización no se borren antes de subir (siempre que no hayan sido eliminadas)
        const idsSheets = new Set(comprasServidor.map(c => String(c.id || "").trim()));
        const comprasPendientes = (state.colaSincronizacion || [])
          .filter(it => it.accion === "registrarCompra" && it.datos && it.datos.compra)
          .map(it => it.datos.compra)
          .filter(c => c && c.id && !idsSheets.has(String(c.id).trim()) && !setEliminadas.has(String(c.id).trim()));

        state.compras = [...comprasPendientes, ...comprasServidor];
        guardarComprasLocal();
      }

      // 3. Ventas: Reflejar fielmente la hoja Ventas de Sheets
      if (json.data.ultimasVentas !== undefined || json.data.ventas !== undefined) {
        const rawVents = json.data.ultimasVentas || json.data.ventas || [];
        state.ventas = Array.isArray(rawVents) ? rawVents.map(v => {
          if (!v) return v;
          const pUSD = parseNum(v.precioUSD !== undefined ? v.precioUSD : v.precioVentaUSD, 0);
          const pCRC = parseNum(v.precioCRC !== undefined ? v.precioCRC : v.precioVentaCRC, 0);
          return {
            ...v,
            codigo: String(v.codigo || "").trim().toUpperCase(),
            cantidad: parseNum(v.cantidad, 1),
            inventarioVendedor: String(v.inventarioVendedor || v.vendedor || "Carlos").trim(),
            precioUSD: pUSD,
            precioVentaUSD: pUSD,
            precioCRC: pCRC,
            precioVentaCRC: pCRC,
            totalUSD: parseNum(v.totalUSD, 0),
            totalCRC: parseNum(v.totalCRC, 0),
            costoEnvioCRC: parseNum(v.costoEnvioCRC, 0),
            costoEnvioUSD: parseNum(v.costoEnvioUSD, 0),
            facturadoPor: String(v.facturadoPor || "").trim(),
            pedidoOrigenId: String(v.pedidoOrigenId || "").trim(),
            pedidoOrigenVendedor: String(v.pedidoOrigenVendedor || "").trim()
          };
        }) : [];
        guardarVentasLocal();
      }

      // 4. Finanzas: Reflejar fielmente la hoja Finanzas de Sheets
      if (json.data.finanzas !== undefined) {
        const rawFin = Array.isArray(json.data.finanzas) ? json.data.finanzas : [];
        state.movimientosDinero = rawFin.map(m => {
          if (!m) return m;
          return {
            ...m,
            montoCRC: parseNum(m.montoCRC, 0),
            montoUSD: parseNum(m.montoUSD, 0)
          };
        });
        guardarFinanzasLocal();
      }

      // 5. Clientes: Reflejar fielmente la hoja Clientes de Sheets
      if (json.data.clientes !== undefined) {
        const mapaCli = {};
        if (Array.isArray(json.data.clientes)) {
          json.data.clientes.forEach(c => { if (c && c.id) mapaCli[c.id] = c; });
        } else if (typeof json.data.clientes === "object" && json.data.clientes !== null) {
          Object.assign(mapaCli, json.data.clientes);
        }
        state.clientes = mapaCli;
        guardarClientesLocal();
      }

      // 6. Pedidos: sincronizar Sheets + únicamente los pedidos pendientes en cola offline local
      if (json.data.pedidos !== undefined) {
        const rawPedidosSheets = Array.isArray(json.data.pedidos) ? json.data.pedidos : [];
        const pedidosSheets = rawPedidosSheets.map(p => {
          if (!p) return p;
          const est = String(p.estado || "pendiente").trim().toLowerCase();
          return {
            ...p,
            id: String(p.id || "").trim(),
            estado: est,
            vendedor: String(p.vendedor || "Carlos").trim(),
            cliente: String(p.cliente || "Cliente General").trim()
          };
        }).filter(p => p && p.id);

        const idsPedidosSheets = new Set(pedidosSheets.map(p => p.id));
        const pedidosSoloLocales = (state.pedidos || []).filter(p =>
          p && p.id && !idsPedidosSheets.has(p.id) &&
          (state.colaSincronizacion || []).some(q => q.datos && q.datos.pedido && q.datos.pedido.id === p.id)
        );
        state.pedidos = [...pedidosSheets, ...pedidosSoloLocales];
        guardarPedidosLocal();
      }

      // 7. Cuentas: sincronizar Sheets + únicamente las cuentas pendientes en cola offline local
      if (json.data.cuentas !== undefined) {
        const cuentasSheets = Array.isArray(json.data.cuentas) ? json.data.cuentas : [];
        const cuentasLocalesMap = new Map((state.cuentas || []).map(c => [c.id, c]));
        
        // Cuentas con abonos o liquidaciones pendientes en la cola local
        const abonosPendientesCola = new Map();
        (state.colaSincronizacion || []).forEach(q => {
          if (q.accion === "abonarCuenta" && q.datos && q.datos.id) {
            abonosPendientesCola.set(String(q.datos.id).toLowerCase(), q.datos);
          }
        });

        // Preservar metadatos locales y estado de liquidación reciente
        cuentasSheets.forEach(c => {
          const loc = cuentasLocalesMap.get(c.id) || Array.from(cuentasLocalesMap.values()).find(l => l.referenciaId && l.referenciaId === c.referenciaId);
          if (loc) {
            if (!c.costoEnvioCRC && loc.costoEnvioCRC) c.costoEnvioCRC = loc.costoEnvioCRC;
            if (!c.costoEnvioUSD && loc.costoEnvioUSD) c.costoEnvioUSD = loc.costoEnvioUSD;
            if (!c.ventaId && loc.ventaId) c.ventaId = loc.ventaId;

            // Si localmente ya estaba liquidada o tiene un abono pendiente en cola
            const tieneAbonoEnCola = abonosPendientesCola.has(String(c.id).toLowerCase()) || (c.referenciaId && abonosPendientesCola.has(String(c.referenciaId).toLowerCase()));
            if (loc.estado === "Pagado" || Number(loc.saldoPendienteCRC || 0) <= 0 || tieneAbonoEnCola) {
              if (loc.estado === "Pagado" || Number(loc.saldoPendienteCRC || 0) <= 0) {
                c.estado = "Pagado";
                c.saldoPendienteCRC = 0;
                c.saldoPendienteUSD = 0;
              } else if (loc.saldoPendienteCRC !== undefined) {
                c.saldoPendienteCRC = loc.saldoPendienteCRC;
                c.saldoPendienteUSD = loc.saldoPendienteUSD;
                c.estado = loc.estado;
              }
              if (loc.notas && !c.notas.includes(loc.notas)) {
                c.notas = loc.notas;
              }
            }
          }

          // Normalizar estado
          if (Number(c.saldoPendienteCRC || 0) <= 0 || String(c.estado || "").toLowerCase() === "pagado") {
            c.estado = "Pagado";
            c.saldoPendienteCRC = 0;
            c.saldoPendienteUSD = 0;
          }
        });

        const idsCuentasSheets = new Set(cuentasSheets.map(c => c.id || c.referenciaId));
        const cuentasSoloLocales = (state.cuentas || []).filter(c =>
          c && (c.id || c.referenciaId) &&
          !idsCuentasSheets.has(c.id) && !idsCuentasSheets.has(c.referenciaId) &&
          (state.colaSincronizacion || []).some(q => {
            const cId = q.datos && (q.datos.id || (q.datos.cuenta && q.datos.cuenta.id));
            const cRef = q.datos && (q.datos.referenciaId || (q.datos.cuenta && q.datos.cuenta.referenciaId));
            return (cId === c.id || cRef === c.referenciaId || cId === c.referenciaId);
          })
        );
        state.cuentas = [...cuentasSheets, ...cuentasSoloLocales];
        guardarCuentasLocal();
      }

      // 8. Anulaciones: Reflejar hoja Anulaciones de Sheets (historial informativo)
      if (json.data.anulaciones !== undefined) {
        state.anulaciones = Array.isArray(json.data.anulaciones) ? json.data.anulaciones : [];
        guardarAnulacionesLocal();
      }

      // 9. Liquidaciones: Reflejar hoja Liquidaciones de Sheets
      if (json.data.liquidaciones !== undefined) {
        state.liquidaciones = Array.isArray(json.data.liquidaciones) ? json.data.liquidaciones : [];
        guardarLiquidacionesLocal();
      }

      renderizarTodo();
      actualizarBadgeConexion();
      if (mostrarMensaje) {
        const nProd = Object.keys(state.productos || {}).length;
        const nFin = (state.movimientosDinero || []).length;
        mostrarToast(`📊 Sincronizado al 100% con Sheets (${nProd} productos, ${nFin} mov. dinero)`, "success");
      }
    } else {
      console.warn("[SYNC] Respuesta inesperada:", json);
      const detalleError = json && json.error ? ` (${json.error})` : "";
      if (mostrarMensaje) mostrarToast("Error: Sheets no devolvió datos válidos" + detalleError + ".", "error");
    }
  } catch (err) {
    console.error("[SYNC] Error al conectar:", err);
    if (mostrarMensaje) mostrarToast("Error al conectar con Google Sheets: " + err.message, "error");
  } finally {
    if (icon) icon.classList.remove("animate-spin");
  }
}

async function sincronizarConSheets(mostrarMensaje = true) {
  if (!state.config.sheetsUrl) {
    if (mostrarMensaje) mostrarToast("Configura la URL de Google Sheets en Ajustes.", "error");
    return;
  }
  if (!navigator.onLine) {
    if (mostrarMensaje) mostrarToast("Sin conexión a internet. Los datos locales están seguros.", "info");
    return;
  }

  // Si hay cola pendiente, procesarColaSincronizacion se encargará de subirla con overlay y luego descargar
  if (state.colaSincronizacion && state.colaSincronizacion.length > 0) {
    await procesarColaSincronizacion(mostrarMensaje);
    return;
  }

  // Si no hay cola, mostrar bloqueo mientras descarga datos frescos
  mostrarBloqueoSincronizacion("Descargando inventario y ventas de Google Sheets...");
  try {
    await _descargarDatosSheets(mostrarMensaje);
  } finally {
    ocultarBloqueoSincronizacion();
  }
}

function guardarConfiguracionSheets() {
  const url = document.getElementById("sheetsApiUrl").value.trim();
  state.config.sheetsUrl = url;
  guardarConfiguracionLocal();
  actualizarBadgeConexion();
  mostrarToast("URL guardada.", "success");
  if (url) sincronizarConSheets(true);
}

async function probarConexionSheets() {
  const url = document.getElementById("sheetsApiUrl").value.trim();
  if (!url) {
    mostrarToast("Ingresa una URL primero.", "error");
    return;
  }
  mostrarToast("Probando conexión...", "info");
  try {
    const resp = await fetch(`${url}?action=ping&token=${PORTAL_TOKEN}`);
    const json = await resp.json();
    if (json.success) mostrarToast("¡Conexión Exitosa con Google Sheets! 🎉", "success");
  } catch(e) {
    mostrarToast("Verifica que la Web App tenga acceso público.", "error");
  }
}

async function diagnosticarPedidos() {
  if (!state.config.sheetsUrl) {
    mostrarToast("Ingresa la URL de Sheets en Ajustes.", "error");
    return;
  }
  mostrarToast("Consultando encargos en Sheets...", "info");
  try {
    const resp = await fetch(`${state.config.sheetsUrl}?action=getPedidos&token=${PORTAL_TOKEN}&t=${Date.now()}`, { cache: "no-store" });
    const json = await resp.json();
    console.log("[DIAG] getPedidos completo:", json);

    if (json && json.success) {
      let listaPedidos = [];
      if (Array.isArray(json.data)) {
        listaPedidos = json.data;
      } else if (json.data && Array.isArray(json.data.pedidos)) {
        listaPedidos = json.data.pedidos;
      }

      const total = listaPedidos.length;
      const pendientes = listaPedidos.filter(p => p.estado === "pendiente" || !p.estado).length;
      
      state.pedidos = listaPedidos;
      guardarPedidosLocal();
      renderizarTodo();

      if (total === 0) {
        mostrarToast("⚠️ La hoja Pedidos está creada en Sheets pero no tiene filas con encargos.", "info");
      } else {
        mostrarToast(`✅ ${total} encargo(s) sincronizado(s) (${pendientes} pendiente(s))`, "success");
      }
    } else {
      mostrarToast("❌ Error en respuesta: " + JSON.stringify(json).slice(0, 120), "error");
    }
  } catch(e) {
    mostrarToast("❌ Error de red: " + e.message, "error");
    console.error("[DIAG] Error:", e);
  }
}

function guardarPreferenciasNegocio() {
  state.config.nombreNegocio = document.getElementById("businessNameInput").value.trim() || "Libro de Inventario";
  state.config.tipoCambio = Number(document.getElementById("exchangeRateInput").value) || 520;
  state.config.telefonoNegocio = document.getElementById("businessPhoneInput").value.trim();
  guardarConfiguracionLocal();
  renderizarTodo();
  mostrarToast("Ajustes actualizados.", "success");
}

function guardarConfigPuntos() {
  const razon = Number(document.getElementById("puntosRazonCRCInput").value);
  const valor = Number(document.getElementById("puntosValorCRCInput").value);
  const minimo = Number(document.getElementById("puntosMinimosCajeInput").value);

  if (!razon || razon < 1) {
    mostrarToast("Ingresa una razón válida (ej: 100).", "error");
    return;
  }
  if (!valor || valor < 1) {
    mostrarToast("Ingresa un valor de punto válido (ej: 5).", "error");
    return;
  }
  if (!minimo || minimo < 1) {
    mostrarToast("Ingresa un mínimo de puntos válido (ej: 100).", "error");
    return;
  }

  state.config.puntosRazonCRC = razon;
  state.config.puntosValorCRC = valor;
  state.config.puntosMinimosCanje = minimo;
  guardarConfiguracionLocal();

  // Mostrar resumen
  const box = document.getElementById("puntosSummaryBox");
  const txt = document.getElementById("puntosSummaryText");
  if (box && txt) {
    txt.innerHTML = `
      • Por cada ₡${razon.toLocaleString()} gastados → <b>1 punto</b><br>
      • 1 punto equivale a <b>₡${valor.toLocaleString()}</b> de descuento<br>
      • Mínimo <b>${minimo} puntos</b> para poder canjear<br>
      • Ej: con 500 puntos → descuento de <b>${fmtCRC(500 * valor)}</b>
    `;
    box.classList.remove("hidden");
  }

  mostrarToast("✅ Configuración de puntos guardada.", "success");
}

function cargarConfigPuntosUI() {
  const c = state.config;
  const razonEl = document.getElementById("puntosRazonCRCInput");
  const valorEl = document.getElementById("puntosValorCRCInput");
  const minimoEl = document.getElementById("puntosMinimosCajeInput");
  if (razonEl) razonEl.value = c.puntosRazonCRC || 20;
  if (valorEl) valorEl.value = c.puntosValorCRC !== undefined ? c.puntosValorCRC : 1;
  if (minimoEl) minimoEl.value = c.puntosMinimosCanje || 4000;
}

async function recargarCatalogoSemilla() {
  if (confirm("¿Descargar y actualizar todos los datos limpios directamente desde Google Sheets?")) {
    if (!state.config.sheetsUrl) {
      mostrarToast("Debes ingresar la URL de Google Sheets primero en Ajustes.", "error");
      return;
    }
    await sincronizarConSheets(true);
  }
}

async function forzarActualizacionApp() {
  if (!confirm("¿Deseas vaciar el caché del navegador y forzar la descarga de la versión más reciente?")) return;

  mostrarToast("Vaciando caché y buscando última versión... ⏳", "info");

  try {
    // 1. Limpiar todos los cachés de CacheStorage (Service Worker)
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map(key => caches.delete(key)));
    }

    // 2. Desregistrar Service Workers activos para obligar instalación limpia
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    mostrarToast("¡Caché eliminado! Recargando aplicación... 🚀", "success");

    // 3. Forzar recarga con bypass de caché
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
    const config = { ...state.config };
    localStorage.clear();
    
    // Restaurar configuración básica
    if (sheetsUrl) {
      localStorage.setItem("inv_config_v2", JSON.stringify(config));
    }
    
    // Reiniciar estado en memoria
    state.productos = {};
    state.compras = [];
    state.ventas = [];
    state.pedidos = [];
    state.cuentas = [];
    state.movimientosDinero = [];
    state.clientes = {};
    state.colaSincronizacion = [];

    renderizarTodo();
    mostrarToast("Memoria local reiniciada. Descargando datos limpios de Sheets...", "info");

    if (sheetsUrl) {
      _descargarDatosSheets(true);
    } else {
      location.reload();
    }
  }
}

// ==========================================================================
// MÓDULO DE ANULACIÓN DE VENTAS (CONFIGURACIONES)
// ==========================================================================
let ventaSeleccionadaParaAnular = null;

function renderizarModuloAnulaciones() {
  poblarSelectorVentasParaAnular();
  renderizarHistorialAnulaciones();
  const selectResp = document.getElementById("anularVendedorResponsable");
  if (selectResp) selectResp.value = state.vendedorActual || "Carlos";
}

function obtenerListaVentasAgrupadas() {
  const ventas = state.ventas || [];
  const agrupadas = new Map();

  ventas.forEach((v, idx) => {
    if (!v) return;
    const id = String(v.id || ("VTA_LOCAL_" + idx)).trim();
    if (!agrupadas.has(id)) {
      const pCRC = parseNum(v.precioCRC !== undefined ? v.precioCRC : v.precioVentaCRC, 0);
      const pUSD = parseNum(v.precioUSD !== undefined ? v.precioUSD : v.precioVentaUSD, 0);
      const cant = parseNum(v.cantidad, 1);
      const subCRC = parseNum(v.totalCRC !== undefined ? v.totalCRC : v.totalFinalCRC, cant * pCRC);
      const subUSD = parseNum(v.totalUSD, cant * pUSD);
      const vendVenta = String(v.vendedor || "Carlos").trim();
      const invVend = String(v.inventarioVendedor || vendVenta).trim();

      let items = [];
      if (v.items && Array.isArray(v.items) && v.items.length > 0) {
        items = v.items.map(it => ({
          codigo: it.codigo,
          nombre: it.nombre || it.codigo,
          cantidad: parseNum(it.cantidad, 1),
          precioCRC: parseNum(it.precioVentaCRC !== undefined ? it.precioVentaCRC : it.precioCRC, 0),
          precioUSD: parseNum(it.precioVentaUSD !== undefined ? it.precioVentaUSD : it.precioUSD, 0),
          subtotalCRC: parseNum(it.subtotalCRC, parseNum(it.cantidad, 1) * parseNum(it.precioVentaCRC || it.precioCRC, 0)),
          subtotalUSD: parseNum(it.subtotalUSD, parseNum(it.cantidad, 1) * parseNum(it.precioVentaUSD || it.precioUSD, 0)),
          inventarioVendedor: String(it.inventarioVendedor || vendVenta).trim()
        }));
      } else if (v.codigo) {
        items = [{
          codigo: v.codigo,
          nombre: v.nombre || v.codigo,
          cantidad: cant,
          precioCRC: pCRC,
          precioUSD: pUSD,
          subtotalCRC: subCRC,
          subtotalUSD: subUSD,
          inventarioVendedor: invVend
        }];
      }

      agrupadas.set(id, {
        id: id,
        fecha: v.fecha || "",
        vendedor: vendVenta,
        cliente: v.cliente || "Cliente General",
        clienteTelefono: v.clienteTelefono || "",
        metodoPago: v.metodoPago || "Efectivo",
        totalCRC: subCRC,
        totalUSD: subUSD,
        items: items
      });
    } else {
      // Venta en formato Sheets (fila por producto con mismo id)
      const ventaPadre = agrupadas.get(id);
      const pCRC = parseNum(v.precioCRC !== undefined ? v.precioCRC : v.precioVentaCRC, 0);
      const pUSD = parseNum(v.precioUSD !== undefined ? v.precioUSD : v.precioVentaUSD, 0);
      const cant = parseNum(v.cantidad, 1);
      const subCRC = parseNum(v.totalCRC, cant * pCRC);
      const subUSD = parseNum(v.totalUSD, cant * pUSD);
      const vendVenta = String(v.vendedor || ventaPadre.vendedor || "Carlos").trim();
      const invVend = String(v.inventarioVendedor || vendVenta).trim();

      ventaPadre.totalCRC += subCRC;
      ventaPadre.totalUSD += subUSD;
      ventaPadre.items.push({
        codigo: v.codigo,
        nombre: v.nombre || v.codigo,
        cantidad: cant,
        precioCRC: pCRC,
        precioUSD: pUSD,
        subtotalCRC: subCRC,
        subtotalUSD: subUSD,
        inventarioVendedor: invVend
      });
    }
  });

  return Array.from(agrupadas.values());
}

function poblarSelectorVentasParaAnular(filtroTexto = "") {
  const select = document.getElementById("anularSelectVenta");
  if (!select) return;

  const ventas = obtenerListaVentasAgrupadas();
  const q = String(filtroTexto).trim().toLowerCase();

  const filtradas = ventas.filter(v => {
    if (!q) return true;
    const matchId = String(v.id || "").toLowerCase().includes(q);
    const matchCli = String(v.cliente || "").toLowerCase().includes(q);
    const matchItems = (v.items || []).some(it => 
      String(it.nombre || "").toLowerCase().includes(q) || 
      String(it.codigo || "").toLowerCase().includes(q)
    );
    return matchId || matchCli || matchItems;
  });

  select.innerHTML = '<option value="">-- Elige una venta de la lista --</option>';

  if (filtradas.length === 0) {
    select.innerHTML += '<option value="" disabled>No se encontraron ventas coincidentes</option>';
    return;
  }

  filtradas.forEach(v => {
    const fStr = v.fecha ? new Date(v.fecha).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "S/F";
    const nProds = v.items && v.items.length > 0 ? v.items.length : 1;
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = `${v.id} • ${fStr} • ${v.cliente} (${fmtCRC(v.totalCRC)}) [${v.vendedor}]`;
    select.appendChild(opt);
  });
}

function filtrarVentasParaAnular() {
  const input = document.getElementById("anularBusquedaVenta");
  poblarSelectorVentasParaAnular(input ? input.value : "");
}

function seleccionarVentaParaAnular() {
  const select = document.getElementById("anularSelectVenta");
  const box = document.getElementById("anularDetalleVentaBox");
  if (!select || !box) return;

  const idSeleccionado = select.value;
  if (!idSeleccionado) {
    box.classList.add("hidden");
    ventaSeleccionadaParaAnular = null;
    return;
  }

  const ventas = obtenerListaVentasAgrupadas();
  const venta = ventas.find(v => v.id === idSeleccionado);
  if (!venta) {
    box.classList.add("hidden");
    ventaSeleccionadaParaAnular = null;
    return;
  }

  ventaSeleccionadaParaAnular = venta;

  // Llenar campos de la tarjeta
  document.getElementById("anularDetalleId").textContent = venta.id;
  const vendBadge = document.getElementById("anularDetalleVendedorFacturo");
  vendBadge.textContent = `Facturó: ${venta.vendedor}`;
  vendBadge.className = venta.vendedor === "Daniel" 
    ? "px-2 py-0.5 rounded text-[10px] font-bold bg-violet-950/80 border border-violet-500/40 text-violet-300"
    : "px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950/80 border border-blue-500/40 text-blue-300";

  document.getElementById("anularDetalleCliente").textContent = venta.cliente || "Cliente General";
  document.getElementById("anularDetalleFecha").textContent = venta.fecha ? new Date(venta.fecha).toLocaleString() : "Sin fecha";
  document.getElementById("anularDetalleTotal").textContent = `${fmtCRC(venta.totalCRC)} (${fmtUSD(venta.totalUSD)})`;

  // Renderizar desglose de productos y vendedor del inventario
  const listCont = document.getElementById("anularDetalleItemsList");
  listCont.innerHTML = (venta.items || []).map(it => {
    const duenoInv = it.inventarioVendedor || venta.vendedor || "Carlos";
    const esCruzado = duenoInv !== venta.vendedor;
    const invColor = duenoInv === "Daniel" ? "text-violet-300 bg-violet-950/60 border-violet-500/30" : "text-blue-300 bg-blue-950/60 border-blue-500/30";

    return `
      <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-800">
        <div class="min-w-0 flex-1 pr-2">
          <div class="font-bold text-white truncate">${it.nombre || it.codigo}</div>
          <div class="text-[10px] text-slate-400 font-mono">${it.cantidad} unidad(es) • ${fmtCRC(it.subtotalCRC || 0)}</div>
        </div>
        <div class="shrink-0 text-right">
          <span class="inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-lg border ${invColor}">
            <span>📦 Stock:</span>
            <span>${duenoInv}</span>
          </span>
          ${esCruzado ? '<div class="text-[9px] text-amber-300 font-bold mt-0.5">⚠️ Inventario Cruzado</div>' : ''}
        </div>
      </div>
    `;
  }).join("");

  box.classList.remove("hidden");
  inicializarIconos();
}

async function confirmarYEjecutarAnulacion() {
  if (!ventaSeleccionadaParaAnular) {
    mostrarToast("Selecciona una venta primero", "error");
    return;
  }

  const venta = ventaSeleccionadaParaAnular;
  const responsable = document.getElementById("anularVendedorResponsable")?.value || state.vendedorActual || "Carlos";
  const motivo = document.getElementById("anularMotivoInput")?.value?.trim() || "Anulación manual";

  const confirmMsg = `¿Estás seguro de anular la factura ${venta.id}?\n\n` +
    `• Vendedor que facturó: ${venta.vendedor}\n` +
    `• Anulado por: ${responsable}\n` +
    `• El inventario regresará exactamente al vendedor correspondiente.\n` +
    `• Se eliminarán las cuentas por cobrar vinculadas.\n` +
    `• Esta acción no se puede deshacer.`;

  if (!confirm(confirmMsg)) return;

  const fechaAnul = new Date().toISOString();

  // 1. Crear registros de anulación informativos locales
  const nuevosRegistrosAnulacion = (venta.items || []).map(it => {
    const idAnul = "ANU-" + Date.now().toString().slice(-6) + Math.floor(Math.random() * 900 + 100);
    const invStock = String(it.inventarioVendedor || venta.vendedor || "Carlos").trim();
    return {
      id: idAnul,
      fecha: fechaAnul,
      idVenta: venta.id,
      vendedorFacturo: venta.vendedor,
      inventarioDe: invStock,
      codigo: it.codigo,
      nombre: it.nombre || it.codigo,
      cantidad: it.cantidad,
      totalCRC: it.subtotalCRC || 0,
      totalUSD: it.subtotalUSD || 0,
      cliente: venta.cliente || "",
      anuladoPor: responsable,
      motivo: motivo
    };
  });

  if (!state.anulaciones) state.anulaciones = [];
  state.anulaciones.unshift(...nuevosRegistrosAnulacion);
  guardarAnulacionesLocal();

  // 2. Remover la venta de state.ventas (descuento del inventario y finanzas queda revertido)
  state.ventas = (state.ventas || []).filter(v => String(v.id || "").trim() !== String(venta.id).trim());
  guardarVentasLocal();

  // 3. Eliminar Cuentas por Cobrar (CXC) generadas por esta venta
  let cxcBorradas = 0;
  if (state.cuentas && state.cuentas.length > 0) {
    const prevLen = state.cuentas.length;
    state.cuentas = state.cuentas.filter(c => {
      const ref = String(c.referenciaId || "");
      const vid = String(c.ventaId || "");
      const not = String(c.notas || "");
      const match = ref.includes(venta.id) || vid === venta.id || not.includes(venta.id);
      return !match;
    });
    cxcBorradas = prevLen - state.cuentas.length;
    guardarCuentasLocal();
  }

  // 4. Encolar acción de sincronización para Google Sheets
  const payloadAnulacion = {
    idVenta: venta.id,
    vendedor: venta.vendedor,
    cliente: venta.cliente,
    anuladoPor: responsable,
    motivo: motivo,
    items: venta.items
  };
  encolarAccionSincronizacion("anularVenta", { datos: payloadAnulacion });

  // 5. Limpiar formulario y re-renderizar
  ventaSeleccionadaParaAnular = null;
  document.getElementById("anularDetalleVentaBox")?.classList.add("hidden");
  document.getElementById("anularBusquedaVenta").value = "";
  if (document.getElementById("anularMotivoInput")) document.getElementById("anularMotivoInput").value = "";
  poblarSelectorVentasParaAnular();
  renderizarHistorialAnulaciones();
  renderizarTodo();

  mostrarToast(`Factura ${venta.id} anulada por ${responsable}. Stock devuelto y ${cxcBorradas} CXC eliminada(s) 🔄`, "success");
}

function renderizarHistorialAnulaciones() {
  const cont = document.getElementById("anularHistorialList");
  const badge = document.getElementById("anularCountBadge");
  if (!cont) return;

  const lista = state.anulaciones || [];
  if (badge) badge.textContent = `${lista.length} registros`;

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="text-center py-5 text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800/60">
        No hay registros de ventas anuladas.
      </div>
    `;
    return;
  }

  cont.innerHTML = lista.map(a => {
    const fStr = a.fecha ? new Date(a.fecha).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "S/F";
    const invColor = a.inventarioDe === "Daniel" ? "text-violet-300 bg-violet-950/60 border-violet-500/30" : "text-blue-300 bg-blue-950/60 border-blue-500/30";
    const respColor = a.anuladoPor === "Daniel" ? "text-violet-400" : "text-blue-400";

    return `
      <div class="p-2.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-mono font-bold text-rose-400 text-[11px]">${a.idVenta || a.id}</span>
          <span class="text-[10px] text-slate-400 font-mono">${fStr}</span>
        </div>
        <div class="flex items-center justify-between text-slate-300">
          <span class="font-semibold text-white truncate max-w-[180px]">${a.nombre || a.codigo} (${a.cantidad}x)</span>
          <span class="font-mono font-bold text-slate-200">${fmtCRC(a.totalCRC || 0)}</span>
        </div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[10px]">
          <div class="text-slate-400">
            Anuló: <span class="font-bold ${respColor}">${a.anuladoPor || 'Carlos'}</span>
            ${a.cliente ? ` • <span class="text-slate-500">${a.cliente}</span>` : ''}
          </div>
          <span class="px-1.5 py-0.2 rounded border font-semibold ${invColor}">
            ↩ Stock devuelto a: <b>${a.inventarioDe || a.vendedorFacturo || 'Carlos'}</b>
          </span>
        </div>
        ${a.motivo ? `<div class="text-[9.5px] text-slate-500 italic">Motivo: "${a.motivo}"</div>` : ''}
      </div>
    `;
  }).join("");
}

// ==========================================================================
// TOAST NOTIFICACIONES
// ==========================================================================
function mostrarToast(mensaje, tipo = "info") {
  const toast = document.getElementById("toast");
  const box = document.getElementById("toastBox");
  const msgEl = document.getElementById("toastMsg");
  const iconEl = document.getElementById("toastIcon");

  msgEl.textContent = mensaje;

  if (tipo === "success") {
    box.className = "px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold bg-emerald-600 text-white border-emerald-400";
    iconEl.setAttribute("data-lucide", "check-circle-2");
  } else if (tipo === "error") {
    box.className = "px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold bg-rose-600 text-white border-rose-400";
    iconEl.setAttribute("data-lucide", "alert-circle");
  } else {
    box.className = "px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold bg-indigo-600 text-white border-indigo-400";
    iconEl.setAttribute("data-lucide", "info");
  }

  inicializarIconos();
  toast.classList.remove("-translate-y-20", "opacity-0", "pointer-events-none");
  toast.classList.add("translate-y-0", "opacity-100");

  setTimeout(() => {
    toast.classList.add("-translate-y-20", "opacity-0", "pointer-events-none");
    toast.classList.remove("translate-y-0", "opacity-100");
  }, 3000);
}

// ==========================================================================
// MÓDULO: COMISIONES Y LIQUIDACIONES DE PREVENTISTAS (APP SATÉLITE)
// ==========================================================================

let _preventaLiqActual = null;
let _saldoMaxLiqActual = 0;

function filtrarPreventistaComision(preventa) {
  state.filtroPreventaComision = preventa;
  renderizarModuloComisiones();
}

function calcularDatosComisionesPreventistas() {
  const pct = 0.13; // 13% fijo sobre ventas facturadas
  const tc = Number(state.config.tipoCambio) || 520;

  // Agrupar ventas por preventista
  const preventasMap = new Map();

  // 1. Analizar ventas facturadas
  (state.ventas || []).forEach(v => {
    if (!v) return;
    const origVend = String(v.pedidoOrigenVendedor || "").trim();
    if (!origVend) return; // Solo ventas originadas en app satélite

    if (!preventasMap.has(origVend)) {
      preventasMap.set(origVend, {
        nombre: origVend,
        totalVentasCRC: 0,
        totalVentasUSD: 0,
        totalComisionCRC: 0,
        totalComisionUSD: 0,
        totalLiquidadoCRC: 0,
        totalLiquidadoUSD: 0,
        saldoPendienteCRC: 0,
        saldoPendienteUSD: 0,
        facturas: [],
        liquidaciones: []
      });
    }

    const data = preventasMap.get(origVend);
    const cant = parseNum(v.cantidad, 1);
    const pCRC = parseNum(v.precioCRC !== undefined ? v.precioCRC : v.precioVentaCRC, 0);
    const pUSD = parseNum(v.precioUSD !== undefined ? v.precioUSD : v.precioVentaUSD, 0);
    const totCRC = parseNum(v.totalCRC, cant * pCRC);
    const totUSD = parseNum(v.totalUSD, cant * pUSD);

    data.totalVentasCRC += totCRC;
    data.totalVentasUSD += totUSD;

    // Guardar factura para desglose
    data.facturas.push({
      id: v.id,
      fecha: v.fecha,
      cliente: v.cliente || "Cliente General",
      producto: v.nombre || v.codigo || "Licor",
      cantidad: cant,
      totalCRC: totCRC,
      totalUSD: totUSD,
      comisionCRC: Math.round(totCRC * pct),
      comisionUSD: totUSD > 0 ? (totUSD * pct) : (totCRC * pct / tc),
      pedidoOrigenId: v.pedidoOrigenId || "",
      facturadoPor: v.facturadoPor || v.vendedor || "Carlos"
    });
  });

  // 2. Incluir preventistas que tengan liquidaciones pero no ventas actuales
  (state.liquidaciones || []).forEach(liq => {
    if (!liq) return;
    const vend = String(liq.vendedorPreventa || "Colaborador").trim();
    if (!preventasMap.has(vend)) {
      preventasMap.set(vend, {
        nombre: vend,
        totalVentasCRC: 0,
        totalVentasUSD: 0,
        totalComisionCRC: 0,
        totalComisionUSD: 0,
        totalLiquidadoCRC: 0,
        totalLiquidadoUSD: 0,
        saldoPendienteCRC: 0,
        saldoPendienteUSD: 0,
        facturas: [],
        liquidaciones: []
      });
    }
    const data = preventasMap.get(vend);
    data.liquidaciones.push(liq);
    data.totalLiquidadoCRC += parseNum(liq.montoCRC, 0);
    data.totalLiquidadoUSD += parseNum(liq.montoUSD, 0);
  });

  // 3. Calcular comisiones y saldos
  preventasMap.forEach(data => {
    data.totalComisionCRC = Math.round(data.totalVentasCRC * pct);
    data.totalComisionUSD = data.totalVentasUSD > 0 
      ? Math.round(data.totalVentasUSD * pct * 100) / 100 
      : Math.round((data.totalComisionCRC / tc) * 100) / 100;

    data.saldoPendienteCRC = Math.max(0, data.totalComisionCRC - data.totalLiquidadoCRC);
    data.saldoPendienteUSD = Math.max(0, data.totalComisionUSD - data.totalLiquidadoUSD);
  });

  return preventasMap;
}

function renderizarModuloComisiones() {
  const elPendCRC = document.getElementById("comisionesGlobalPendienteCRC");
  const elPendUSD = document.getElementById("comisionesGlobalPendienteUSD");
  const elPrevCount = document.getElementById("comisionesGlobalPreventasCount");
  const elLiqCRC = document.getElementById("comisionesGlobalLiquidadoCRC");
  const elLiqUSD = document.getElementById("comisionesGlobalLiquidadoUSD");
  const elLiqCount = document.getElementById("comisionesGlobalLiquidacionesCount");
  const contPills = document.getElementById("comisionesPillsVendedores");
  const contLista = document.getElementById("comisionesListaPreventistas");
  const contHistorial = document.getElementById("comisionesHistorialLista");
  const countHistorial = document.getElementById("comisionesHistorialCount");

  if (!elPendCRC || !contLista) return;

  const preventasMap = calcularDatosComisionesPreventistas();
  const listaPreventistas = Array.from(preventasMap.values());

  // 1. Totales Globales
  let globalPendCRC = 0;
  let globalPendUSD = 0;
  let preventasConSaldo = 0;
  let globalLiqCRC = 0;
  let globalLiqUSD = 0;

  listaPreventistas.forEach(p => {
    globalPendCRC += p.saldoPendienteCRC;
    globalPendUSD += p.saldoPendienteUSD;
    if (p.saldoPendienteCRC > 0) preventasConSaldo++;
    globalLiqCRC += p.totalLiquidadoCRC;
    globalLiqUSD += p.totalLiquidadoUSD;
  });

  elPendCRC.textContent = fmtCRC(globalPendCRC);
  elPendUSD.textContent = `${fmtUSD(globalPendUSD)} USD`;
  if (elPrevCount) elPrevCount.textContent = `${preventasConSaldo} preventista(s) con saldo`;

  elLiqCRC.textContent = fmtCRC(globalLiqCRC);
  elLiqUSD.textContent = `${fmtUSD(globalLiqUSD)} USD`;
  if (elLiqCount) elLiqCount.textContent = `${(state.liquidaciones || []).length} liquidaciones registradas`;

  // 2. Renderizar Pills Selector de Preventista
  if (contPills) {
    const filtro = state.filtroPreventaComision || "todos";
    let pillsHTML = `
      <button onclick="filtrarPreventistaComision('todos')" id="pillPreventa-todos" 
        class="px-3 py-1.5 rounded-xl font-bold text-[11px] shrink-0 transition-all ${filtro === 'todos' ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
        Todos (${listaPreventistas.length})
      </button>
    `;
    listaPreventistas.forEach(p => {
      const active = filtro === p.nombre;
      pillsHTML += `
        <button onclick="filtrarPreventistaComision('${p.nombre.replace(/'/g, "\\'")}')" id="pillPreventa-${p.nombre.replace(/[^a-zA-Z0-9]/g, '_')}" 
          class="px-3 py-1.5 rounded-xl font-bold text-[11px] shrink-0 transition-all ${active ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
          ${p.nombre} ${p.saldoPendienteCRC > 0 ? '⚡' : '✓'}
        </button>
      `;
    });
    contPills.innerHTML = pillsHTML;
  }

  // 3. Renderizar Tarjetas de Preventistas
  const filtroActual = state.filtroPreventaComision || "todos";
  const filtrados = filtroActual === "todos" 
    ? listaPreventistas 
    : listaPreventistas.filter(p => p.nombre === filtroActual);

  if (filtrados.length === 0) {
    contLista.innerHTML = `
      <div class="p-8 text-center text-slate-500 bg-slate-900/60 rounded-3xl border border-slate-800 space-y-2">
        <i data-lucide="badge-percent" class="w-10 h-10 mx-auto text-slate-600 stroke-1"></i>
        <p class="text-xs font-bold text-slate-300">No hay ventas facturadas con origen en preventa satélite.</p>
        <p class="text-[11px] text-slate-500 max-w-xs mx-auto">Cuando un preventista envíe un pedido y tú o Daniel lo facturen, se calculará automáticamente el 13% de comisión aquí.</p>
      </div>
    `;
  } else {
    contLista.innerHTML = filtrados.map((p, idx) => {
      const tieneSaldo = p.saldoPendienteCRC > 0;
      const badgeSaldoClass = tieneSaldo 
        ? "bg-amber-950/80 text-amber-300 border-amber-500/40"
        : "bg-emerald-950/80 text-emerald-300 border-emerald-500/40";
      const badgeSaldoTxt = tieneSaldo ? "⏳ Saldo Pendiente" : "✅ Al día (Liquidado)";

      return `
        <div class="bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 border ${tieneSaldo ? 'border-amber-500/40' : 'border-slate-800'} rounded-3xl p-4 shadow-xl space-y-3">
          <!-- Cabecera Tarjeta Preventista -->
          <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div class="flex items-center gap-2">
              <div class="p-2 rounded-xl ${tieneSaldo ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}">
                <i data-lucide="user-check" class="w-4 h-4"></i>
              </div>
              <div>
                <h3 class="text-sm font-black text-white">${p.nombre}</h3>
                <span class="text-[10px] text-slate-400 font-mono">Preventa Satélite</span>
              </div>
            </div>
            <span class="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${badgeSaldoClass}">
              ${badgeSaldoTxt}
            </span>
          </div>

          <!-- Métricas Financieras de Comisión -->
          <div class="grid grid-cols-3 gap-2 text-center font-mono">
            <div class="p-2 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <span class="text-[9px] text-slate-400 font-sans block uppercase font-bold">Ventas Totales</span>
              <b class="text-white text-xs block truncate">${fmtCRC(p.totalVentasCRC)}</b>
              <span class="text-[9px] text-slate-500">${fmtUSD(p.totalVentasUSD)}</span>
            </div>

            <div class="p-2 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <span class="text-[9px] text-emerald-400 font-sans block uppercase font-bold">Comisión (13%)</span>
              <b class="text-emerald-400 text-xs block truncate">${fmtCRC(p.totalComisionCRC)}</b>
              <span class="text-[9px] text-slate-500">${fmtUSD(p.totalComisionUSD)}</span>
            </div>

            <div class="p-2 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <span class="text-[9px] text-slate-400 font-sans block uppercase font-bold">Ya Pagado</span>
              <b class="text-slate-300 text-xs block truncate">${fmtCRC(p.totalLiquidadoCRC)}</b>
              <span class="text-[9px] text-slate-500">${fmtUSD(p.totalLiquidadoUSD)}</span>
            </div>
          </div>

          <!-- Saldo Pendiente y Botón Liquidar -->
          <div class="p-3 bg-slate-950 rounded-2xl border ${tieneSaldo ? 'border-amber-500/50' : 'border-slate-800'} flex items-center justify-between gap-3">
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-400 block font-sans">Saldo a Liquidar:</span>
              <div class="text-lg font-black ${tieneSaldo ? 'text-amber-400' : 'text-emerald-400'} font-mono leading-none mt-0.5">
                ${fmtCRC(p.saldoPendienteCRC)}
              </div>
              <span class="text-[10px] text-slate-500 font-mono">${fmtUSD(p.saldoPendienteUSD)} USD</span>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button onclick="toggleAcordeonFacturas('acordeon-${idx}')" 
                class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs flex items-center gap-1 active:scale-95 transition-all">
                <i data-lucide="receipt" class="w-3.5 h-3.5 text-slate-400"></i>
                <span>${p.facturas.length} Fact.</span>
              </button>

              ${tieneSaldo ? `
                <button onclick="abrirModalLiquidacion('${p.nombre.replace(/'/g, "\\'")}')" 
                  class="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 active:scale-95 transition-all">
                  <i data-lucide="badge-dollar-sign" class="w-4 h-4"></i>
                  <span>Liquidar</span>
                </button>
              ` : `
                <span class="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-1 rounded-xl">
                  ✓ Al día
                </span>
              `}
            </div>
          </div>

          <!-- Acordeón de Facturas Asociadas -->
          <div id="acordeon-${idx}" class="hidden pt-2 border-t border-slate-800/80 space-y-2">
            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
              📋 Facturas Facturadas por Central (${p.facturas.length}):
            </span>
            <div class="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
              ${p.facturas.length === 0 ? `
                <div class="text-xs text-slate-500 italic p-2">Sin facturas registradas.</div>
              ` : p.facturas.map(f => {
                const fStr = f.fecha ? new Date(f.fecha).toLocaleDateString([], { month: 'short', day: 'numeric' }) : "S/F";
                return `
                  <div class="p-2 bg-slate-900/90 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono">
                    <div class="min-w-0 flex-1 pr-2">
                      <div class="flex items-center gap-1.5">
                        <span class="font-bold text-white">${f.id}</span>
                        <span class="text-[10px] text-slate-400 font-sans truncate">• ${f.cliente}</span>
                      </div>
                      <div class="text-[10px] text-slate-500 font-sans truncate">
                        ${f.producto} (x${f.cantidad}) • ${fStr}
                      </div>
                    </div>
                    <div class="text-right shrink-0">
                      <span class="text-white font-bold block">${fmtCRC(f.totalCRC)}</span>
                      <span class="text-emerald-400 text-[10px] font-bold">+${fmtCRC(f.comisionCRC)} (13%)</span>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // 4. Renderizar Historial de Liquidaciones Realizadas
  if (contHistorial) {
    const liquidaciones = [...(state.liquidaciones || [])];
    if (countHistorial) countHistorial.textContent = liquidaciones.length;

    if (liquidaciones.length === 0) {
      contHistorial.innerHTML = `
        <div class="p-6 text-center text-slate-500 space-y-1 text-xs">
          <p class="font-bold text-slate-400">Aún no hay liquidaciones registradas.</p>
          <p class="text-[11px] text-slate-500">Cuando liquides la comisión de un preventista, el recibo se guardará aquí.</p>
        </div>
      `;
    } else {
      contHistorial.innerHTML = liquidaciones.map(liq => {
        const fStr = liq.fecha ? new Date(liq.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "S/F";
        return `
          <div class="p-3 bg-slate-950/80 border border-emerald-500/20 rounded-2xl space-y-2 text-xs shadow-inner">
            <div class="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
              <div class="flex items-center gap-1.5">
                <span class="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                  🧾 Liquidación
                </span>
                <span class="font-mono font-bold text-white text-xs">${liq.id}</span>
              </div>
              <span class="text-[10px] text-slate-400 font-mono">${fStr}</span>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <span class="text-slate-400 text-[10px] block">Preventista:</span>
                <b class="text-white text-xs">${liq.vendedorPreventa || 'Colaborador'}</b>
              </div>
              <div class="text-right font-mono">
                <span class="text-sm font-black text-emerald-400 block leading-none">${fmtCRC(liq.montoCRC || 0)}</span>
                <span class="text-[10px] text-slate-400">(${fmtUSD(liq.montoUSD || 0)})</span>
              </div>
            </div>

            <div class="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <div>
                <span>Pagó: <b class="text-indigo-300">${liq.liquidadoPor || 'Carlos'}</b> via <b class="text-amber-300">${liq.metodoPago || 'SINPE'}</b></span>
                ${liq.notas ? `<div class="text-[10px] text-slate-500 italic">"${liq.notas}"</div>` : ''}
              </div>

              <div class="flex items-center gap-1.5 shrink-0">
                <button onclick="compartirLiquidacionWhatsApp('${liq.id}')" title="Enviar comprobante por WhatsApp" 
                  class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 active:scale-95 transition-all">
                  <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
                  <span>WhatsApp</span>
                </button>
                <button onclick="eliminarLiquidacionComision('${liq.id}')" title="Eliminar liquidación" 
                  class="p-1 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/50 text-rose-300 rounded-lg active:scale-95 transition-all">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  inicializarIconos();
}

function toggleAcordeonFacturas(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden");
}

// ==========================================================================
// MODAL DE LIQUIDACIÓN DE COMISIONES
// ==========================================================================

function abrirModalLiquidacion(vendedor) {
  const modal = document.getElementById("modalLiquidacionComision");
  const prevMap = calcularDatosComisionesPreventistas();
  const data = prevMap.get(vendedor);

  if (!data) {
    mostrarToast("No se encontraron datos para " + vendedor, "error");
    return;
  }

  _preventaLiqActual = vendedor;
  _saldoMaxLiqActual = data.saldoPendienteCRC;

  const tc = Number(state.config.tipoCambio) || 520;
  const nombreEl = document.getElementById("modalLiqPreventaNombre");
  const inputVend = document.getElementById("modalLiqPreventaInput");
  const elSaldoCRC = document.getElementById("modalLiqSaldoPendienteCRC");
  const elSaldoUSD = document.getElementById("modalLiqSaldoPendienteUSD");
  const inputMontoCRC = document.getElementById("modalLiqMontoCRC");
  const inputMontoUSD = document.getElementById("modalLiqMontoUSD");
  const selResp = document.getElementById("modalLiqResponsable");

  if (nombreEl) nombreEl.textContent = vendedor;
  if (inputVend) inputVend.value = vendedor;
  if (elSaldoCRC) elSaldoCRC.textContent = fmtCRC(data.saldoPendienteCRC);
  if (elSaldoUSD) elSaldoUSD.textContent = `${fmtUSD(data.saldoPendienteUSD)} USD`;

  // Prellenar con el saldo total pendiente
  if (inputMontoCRC) inputMontoCRC.value = data.saldoPendienteCRC;
  if (inputMontoUSD) inputMontoUSD.value = (data.saldoPendienteCRC / tc).toFixed(2);
  if (selResp) selResp.value = state.vendedorActual || "Carlos";

  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  inicializarIconos();
}

function cerrarModalLiquidacion() {
  const modal = document.getElementById("modalLiquidacionComision");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function setMontoLiqTotal() {
  const tc = Number(state.config.tipoCambio) || 520;
  const inputMontoCRC = document.getElementById("modalLiqMontoCRC");
  const inputMontoUSD = document.getElementById("modalLiqMontoUSD");
  if (inputMontoCRC) inputMontoCRC.value = _saldoMaxLiqActual;
  if (inputMontoUSD) inputMontoUSD.value = (_saldoMaxLiqActual / tc).toFixed(2);
}

function autoConvertirModalLiq(moneda) {
  const tc = Number(state.config.tipoCambio) || 520;
  const inputCRC = document.getElementById("modalLiqMontoCRC");
  const inputUSD = document.getElementById("modalLiqMontoUSD");
  if (!inputCRC || !inputUSD || tc <= 0) return;

  if (moneda === "CRC") {
    const valCRC = parseNum(inputCRC.value, 0);
    inputUSD.value = (valCRC / tc).toFixed(2);
  } else {
    const valUSD = parseNum(inputUSD.value, 0);
    inputCRC.value = Math.round(valUSD * tc);
  }
}

async function guardarLiquidacionModal(e) {
  if (e && e.preventDefault) e.preventDefault();

  const vendedor = _preventaLiqActual;
  const inputMontoCRC = document.getElementById("modalLiqMontoCRC");
  const inputMontoUSD = document.getElementById("modalLiqMontoUSD");
  const selResp = document.getElementById("modalLiqResponsable");
  const selMetodo = document.getElementById("modalLiqMetodo");
  const checkFin = document.getElementById("modalLiqCheckFinanzas");
  const inputNotas = document.getElementById("modalLiqNotas");

  const montoCRC = parseNum(inputMontoCRC ? inputMontoCRC.value : 0, 0);
  const montoUSD = parseNum(inputMontoUSD ? inputMontoUSD.value : 0, 0);
  const resp = selResp ? selResp.value : "Carlos";
  const metodo = selMetodo ? selMetodo.value : "SINPE";
  const registrarFin = checkFin ? checkFin.checked : true;
  const notas = inputNotas ? inputNotas.value.trim() : "";

  if (montoCRC <= 0) {
    mostrarToast("Ingresa un monto válido para liquidar.", "error");
    return;
  }

  const ahora = new Date();
  const idLiq = "LIQ-" + UtilitiesDateLocal(ahora);

  const liqObj = {
    id: idLiq,
    fecha: ahora.toISOString(),
    vendedorPreventa: vendedor,
    montoCRC: montoCRC,
    montoUSD: montoUSD,
    liquidadoPor: resp,
    metodoPago: metodo,
    facturasIds: "",
    notas: notas,
    registrarEnFinanzas: registrarFin
  };

  if (!state.liquidaciones) state.liquidaciones = [];
  state.liquidaciones.unshift(liqObj);
  guardarLiquidacionesLocal();

  // Si registró egreso en Finanzas localmente
  if (registrarFin) {
    const movObj = {
      id: "FIN-" + idLiq,
      fecha: todayStr(),
      tipo: "Egreso",
      cuentaOrigen: "Caja Chica",
      cuentaDestino: "Gasto de Comisiones (" + vendedor + ")",
      socio: resp,
      montoUSD: montoUSD,
      tipoCambio: Number(state.config.tipoCambio) || 520,
      montoCRC: montoCRC,
      metodoPago: metodo,
      notas: `Pago comisiones a ${vendedor} (${idLiq}) ${notas ? '- ' + notas : ''}`,
      registradoPor: resp
    };
    state.movimientosDinero.unshift(movObj);
    guardarFinanzasLocal();
    encolarSincronizacion("registrarMovimiento", { movimiento: movObj });
  }

  // Encolar y sincronizar liquidación en Google Sheets
  encolarSincronizacion("registrarLiquidacion", { liquidacion: liqObj });

  cerrarModalLiquidacion();
  renderizarModuloComisiones();
  renderizarFinanzas();

  mostrarToast(`¡Liquidación de ${fmtCRC(montoCRC)} a ${vendedor} registrada con éxito! 💰`, "success");

  // Preguntar si desea enviar comprobante por WhatsApp
  setTimeout(() => {
    if (confirm(`¿Deseas enviar el comprobante de liquidación a ${vendedor} por WhatsApp?`)) {
      compartirLiquidacionWhatsApp(idLiq);
    }
  }, 400);

  if (state.config.sheetsUrl && navigator.onLine) {
    procesarColaSincronizacion(false);
  }
}

function UtilitiesDateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}${s}`;
}

function compartirLiquidacionWhatsApp(idLiquidacion) {
  const liq = (state.liquidaciones || []).find(l => l.id === idLiquidacion);
  if (!liq) {
    mostrarToast("Liquidación no encontrada.", "error");
    return;
  }

  const negocio = "DC EL DESTAPE LICORES";
  const fecha = liq.fecha ? new Date(liq.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : new Date().toLocaleString();

  let texto = `🍷 *${negocio.toUpperCase()}* 🍷\n`;
  texto += `--------------------------------\n`;
  texto += `🧾 *COMPROBANTE DE LIQUIDACIÓN DE COMISIÓN*\n`;
  texto += `📅 Fecha: ${fecha}\n`;
  texto += `🎫 N° Comprobante: *${liq.id}*\n`;
  texto += `👤 Preventista: *${liq.vendedorPreventa}*\n`;
  texto += `👤 Liquidado por: *${liq.liquidadoPor}*\n`;
  texto += `💳 Método de Pago: *${liq.metodoPago}*\n`;
  texto += `--------------------------------\n`;
  texto += `💰 *MONTO LIQUIDADO:* *${fmtCRC(liq.montoCRC)}*\n`;
  texto += `💵 *Equivalente USD:* *${fmtUSD(liq.montoUSD)}*\n`;
  if (liq.notas) texto += `📝 Notas: ${liq.notas}\n`;
  texto += `--------------------------------\n`;
  texto += `✅ Tu comisión ha sido liquidada exitosamente. Tu saldo pendiente en la aplicación ha sido actualizado.\n\n`;
  texto += `¡Muchas gracias por tu esfuerzo y ventas! 🚀🍷`;

  // Buscar teléfono del preventista si existe en clientes
  let tel = "";
  const cli = Object.values(state.clientes || {}).find(c => 
    c.nombre && c.nombre.toLowerCase().includes(liq.vendedorPreventa.toLowerCase())
  );
  if (cli && cli.telefono) tel = String(cli.telefono).replace(/\D/g, "");

  const waUrl = tel 
    ? `https://wa.me/506${tel}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/?text=${encodeURIComponent(texto)}`;

  window.open(waUrl, "_blank");
}

function eliminarLiquidacionComision(idLiq) {
  if (!confirm(`¿Eliminar la liquidación ${idLiq}? El saldo del preventista volverá a quedar como pendiente.`)) return;

  state.liquidaciones = (state.liquidaciones || []).filter(l => l.id !== idLiq);
  guardarLiquidacionesLocal();

  encolarSincronizacion("eliminarLiquidacion", { id: idLiq });
  renderizarModuloComisiones();
  mostrarToast(`Liquidación ${idLiq} eliminada.`, "info");

  if (state.config.sheetsUrl && navigator.onLine) {
    procesarColaSincronizacion(false);
  }
}
