# 📖 Guía Paso a Paso: Conectar tu App Móvil con Google Sheets

Esta guía te explica cómo configurar tu hoja de cálculo en **Google Drive** para que funcione como la base de datos de tu aplicación móvil en menos de 5 minutos.

---

## 🟢 PASO 1: Crear tu Hoja de Google Sheets

1. Ve a [Google Drive](https://drive.google.com/) o [Google Sheets](https://sheets.new).
2. Crea una nueva hoja de cálculo en blanco.
3. Nómbrala como gustes, por ejemplo: **`BD_Inventario_MiNegocio`**.

---

## 🟢 PASO 2: Abrir el Editor de Apps Script

1. En el menú superior de tu hoja de cálculo, haz clic en **`Extensiones`** > **`Apps Script`**.
2. Se abrirá una nueva pestaña con el editor de código.
3. Borra cualquier código que aparezca por defecto en el archivo `Código.gs`.
4. Abre el archivo **`google_apps_script.gs`** (que generamos en la carpeta de tu proyecto) y copia todo su contenido.
5. Pega todo el código dentro del editor de Apps Script.
6. Haz clic en el icono de guardar 💾 (**Guardar proyecto**).

---

## 🟢 PASO 3: Inicializar las Tablas Automáticamente

1. En la barra superior del editor de Apps Script, verás un selector de funciones al lado del botón **Ejecutar**.
2. Selecciona la función **`inicializarSistema`**.
3. Haz clic en el botón **`Ejecutar`**.
4. Google te pedirá permisos por primera vez:
   - Haz clic en **Revisar permisos**.
   - Elige tu cuenta de Google.
   - Si sale un aviso de "Google no ha verificado esta app", haz clic en **Avanzado** (o *Configuración avanzada*) y luego en **Ir a Proyecto (no seguro)**.
   - Haz clic en **Permitir**.
5. ¡Listo! Si vuelves a tu hoja de Google Sheets, verás que automáticamente se crearon las 4 pestañas:
   - 📦 **`Productos`** (con columnas de código, nombre, precios, stock y alertas).
   - 🛒 **`Compras`** (para registrar entradas y proveedores).
   - 💵 **`Ventas`** (para registrar salidas, clientes y ganancias).
   - 📋 **`Movimientos`** (auditoría automática de entradas y salidas).

---

## 🟢 PASO 4: Publicar la API Web (Desplegar)

1. En la esquina superior derecha de Apps Script, haz clic en el botón azul **`Implementar`** (o *Deploy*) > **`Nueva implementación`**.
2. En el engranaje ⚙️ de la izquierda (Seleccionar tipo), elige **`Aplicación web`**.
3. Configura los campos de la siguiente manera:
   - **Descripción**: `API Inventario Móvil`
   - **Ejecutar como**: `Yo (tu correo de Google)`
   - **Quién tiene acceso**: **`Cualquier usuario`** *(⚠️ Muy importante: Debe ser "Cualquier usuario" para que la app móvil pueda leer y guardar datos sin pedir login de Google)*.
4. Haz clic en **`Implementar`**.
5. Google te mostrará una ventana con la **URL de la aplicación web** (algo como `https://script.google.com/macros/s/AKfycb.../exec`).
6. **Copia esa URL**.

---

## 🟢 PASO 5: Conectar la App Móvil

1. Abre tu aplicación móvil (el archivo `index.html` o desde tu servidor/navegador).
2. Toca en la pestaña **Ajustes / Configuración** (icono de engranaje ⚙️ abajo a la derecha).
3. Pega la URL en el campo **`URL de Google Apps Script Web App`**.
4. Toca en el botón **`Guardar y Conectar`** y luego en **`Probar`**.
5. Verás el indicador verde: `Conectado a Google Sheets`.
6. Toca el botón de sincronizar 🔄 en la barra superior: ¡tus productos de Google Sheets se cargarán al instante!

---

## 📱 PASO 6: Cómo Instalar la App en tu Teléfono (Android / iPhone)

La aplicación está diseñada con tecnología **PWA (Progressive Web App)**:

### En Android (Google Chrome):
1. Abre el enlace de tu app en Google Chrome.
2. Toca los **3 puntos** del menú de Chrome (arriba a la derecha).
3. Selecciona **`Instalar aplicación`** o **`Agregar a la pantalla principal`**.
4. Se creará un icono como el de cualquier aplicación nativa en tu pantalla de inicio.

### En iPhone / iPad (Safari):
1. Abre el enlace de tu app en **Safari**.
2. Toca el botón de **Compartir** (el cuadro con una flecha hacia arriba en la barra inferior).
3. Desliza hacia abajo y selecciona **`Agregar al inicio`** (o *Add to Home Screen*).
4. Toca en **Agregar**.

---

## 💡 Funcionalidades Destacadas de tu App

- 📸 **Escáner con Cámara**: Usa la cámara para escanear códigos de barras reales en inventario, ventas y compras.
- 🛒 **Punto de Venta Móvil**: Vende en segundos, calcula el cambio en efectivo y valida existencias.
- 🧾 **Tickets por WhatsApp**: Envía el comprobante digital al cliente en un toque.
- 📊 **Auditoría Automática**: Cada venta o compra descuenta/suma el stock en Google Sheets en tiempo real y calcula tus ganancias automáticamente.
