<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { registrarBaja, urlReporteBaja, verificarSeries, type ArticuloNuevo, type Baja, type DatosNuevaBaja, type EquipoParaBaja, type RevisionDeSeries } from "../api/bajas";
import { ErrorApi } from "../api/cliente";
import { listarEquipos, obtenerEquipo, type EquipoResumen } from "../api/equipos";
import DialogoConfirmar from "../componentes/DialogoConfirmar.vue";
import Icono from "../componentes/Icono.vue";
import InsigniaEstado from "../componentes/InsigniaEstado.vue";
import { mostrarAviso } from "../composables/useAvisos";
import { recargarAvisos } from "../composables/useAvisosMantenimiento";
import { MAXIMO_ARTICULOS_BAJA, MAXIMO_EQUIPOS_BAJA, articuloVacio, resumenRenglones, seriesDeTexto, validarBaja } from "../utilidades/bajas";
import { ETIQUETAS_TIPO, hoyEnElHotel, nombreCompleto } from "../utilidades/formato";

/**
 * Registrar una baja con el formato del hotel "Baja de equipo operacional":
 * equipos del inventario (cada uno con su motivo) y artículos sin número de
 * serie. Tras confirmar, se imprime el reporte y se firma a mano.
 */
const ruta = useRoute();
const hoy = hoyEnElHotel();

// ---------------------------------------------------- equipos del inventario
interface Elegido { equipo: EquipoParaBaja; observaciones: string; tiempoUso: string }
const elegidos = ref<Elegido[]>([]);
const avisoInicial = ref<{ texto: string; equipoId?: number } | null>(null);

const texto = ref("");
const resultados = ref<EquipoResumen[]>([]);
const buscando = ref(false);
const buscado = ref("");
const errorBusqueda = ref("");
let pausa: ReturnType<typeof setTimeout> | undefined;
let controlador: AbortController | undefined;

async function buscar() {
  const limpio = texto.value.trim();
  controlador?.abort();
  if (limpio === "") {
    resultados.value = [];
    buscado.value = "";
    buscando.value = false;
    return;
  }
  controlador = new AbortController();
  buscando.value = true;
  try {
    resultados.value = (await listarEquipos({ busqueda: limpio, porPagina: 20 }, controlador.signal)).datos;
    errorBusqueda.value = "";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    errorBusqueda.value = e instanceof ErrorApi ? e.message : "No se pudo buscar.";
  }
  buscado.value = limpio;
  buscando.value = false;
}
watch(texto, () => {
  clearTimeout(pausa);
  pausa = setTimeout(buscar, 250);
});
onBeforeUnmount(() => {
  clearTimeout(pausa);
  controlador?.abort();
});

const estaElegido = (id: number) => elegidos.value.some((e) => e.equipo.id === id);

function alternar(equipo: EquipoResumen) {
  if (estaElegido(equipo.id)) quitarEquipo(equipo.id);
  else if (!equipo.asignacionVigente) {
    elegidos.value.push({ equipo, observaciones: "", tiempoUso: "" });
    quitarError("equipos");
  }
}

function quitarEquipo(id: number) {
  elegidos.value = elegidos.value.filter((e) => e.equipo.id !== id);
  // Los errores por renglón cambian de posición: se vuelven a revisar al enviar.
  limpiarErroresDe("equipos.");
}

/** Copia el motivo del primer equipo a los que aún no tienen. */
function copiarPrimerMotivo() {
  const primero = elegidos.value[0]?.observaciones.trim();
  if (!primero) return;
  elegidos.value.forEach((e, i) => {
    if (e.observaciones.trim() === "") {
      e.observaciones = primero;
      quitarError(`equipos.${i}.observaciones`);
    }
  });
}

/** Copia el motivo y el tiempo de uso de un renglón a los demás equipos del mismo tipo que aún no los tienen. */
function aplicarAlMismoTipo(indice: number) {
  const origen = elegidos.value[indice];
  if (!origen) return;
  elegidos.value.forEach((e, i) => {
    if (i === indice || e.equipo.tipo !== origen.equipo.tipo) return;
    if (e.observaciones.trim() === "" && origen.observaciones.trim() !== "") {
      e.observaciones = origen.observaciones;
      quitarError(`equipos.${i}.observaciones`);
    }
    if (e.tiempoUso.trim() === "" && origen.tiempoUso.trim() !== "") e.tiempoUso = origen.tiempoUso;
  });
}
const cuantosDelMismoTipo = (tipo: string) => elegidos.value.filter((e) => e.equipo.tipo === tipo).length;

// --------------------------------- lista de números de serie (pegar o escanear)
const listaSeries = ref("");
const revisandoLista = ref(false);
const errorLista = ref("");
const revision = ref<(RevisionDeSeries & { agregados: number }) | null>(null);

/**
 * Revisa contra el inventario la lista pegada desde Excel (o escaneada, una
 * serie por renglón) y agrega de una vez los equipos que se pueden dar de baja.
 */
async function revisarLista() {
  const series = seriesDeTexto(listaSeries.value);
  if (series.length === 0) {
    errorLista.value = "Pega o escanea al menos un número de serie (uno por renglón).";
    return;
  }
  revisandoLista.value = true;
  errorLista.value = "";
  try {
    const resultado = await verificarSeries(series);
    let agregados = 0;
    for (const equipo of resultado.disponibles) {
      if (!estaElegido(equipo.id)) {
        elegidos.value.push({ equipo, observaciones: "", tiempoUso: "" });
        agregados++;
      }
    }
    if (agregados > 0) quitarError("equipos");
    revision.value = { ...resultado, agregados };
    // Se dejan en el cuadro solo las series con problema, para revisarlas.
    const conProblema = new Set([...resultado.noEncontrados, ...resultado.yaDeBaja.map((e) => e.numeroSerie), ...resultado.asignados.map((e) => e.numeroSerie)]);
    listaSeries.value = series.filter((serie) => conProblema.has(serie)).filter((serie, i, todas) => todas.indexOf(serie) === i).join("\n");
  } catch (e) {
    errorLista.value = e instanceof ErrorApi ? e.message : "No se pudo revisar la lista.";
  } finally {
    revisandoLista.value = false;
  }
}

// Desde la ficha del equipo llega ?equipo=ID con ese equipo ya elegido.
onMounted(async () => {
  const id = Number(ruta.query.equipo);
  if (!Number.isInteger(id) || id <= 0) return;
  try {
    const equipo = await obtenerEquipo(id);
    if (equipo.estado === "BAJA") {
      avisoInicial.value = { texto: `El equipo ${equipo.numeroSerie} ya está dado de baja${equipo.baja ? ` (folio ${equipo.baja.folio})` : ""}.`, equipoId: equipo.id };
    } else if (equipo.asignacionVigente) {
      avisoInicial.value = {
        texto: `${equipo.numeroSerie} está asignado a ${nombreCompleto(equipo.asignacionVigente.empleado)}. Registra la devolución antes de darlo de baja.`,
        equipoId: equipo.id,
      };
    } else {
      alternar(equipo);
    }
  } catch (e) {
    const motivo = e instanceof ErrorApi && e.estado !== 404 ? ` ${e.message}` : "";
    avisoInicial.value = {
      texto: e instanceof ErrorApi && e.estado === 404 ? "No encontramos ese equipo. Búscalo abajo." : `No se pudo cargar el equipo.${motivo}`,
    };
  }
});

// ------------------------------------------ artículos sin número de serie
const articulos = ref<ArticuloNuevo[]>([]);

async function agregarArticulo() {
  articulos.value.push(articuloVacio());
  quitarError("equipos");
  await nextTick();
  document.getElementById(`articulo-${articulos.value.length - 1}-descripcion`)?.focus();
}
function quitarArticulo(indice: number) {
  articulos.value.splice(indice, 1);
  limpiarErroresDe("articulos.");
}

// ----------------------------------------------------------- datos y errores
const datos = reactive({ fechaBaja: hoy, elaboro: "" });
const errores = ref<Record<string, string>>({});
const formulario = ref<HTMLFormElement>();

function quitarError(campo: string) {
  if (!errores.value[campo]) return;
  const { [campo]: _quitado, ...resto } = errores.value;
  errores.value = resto;
}
function limpiarErroresDe(prefijo: string) {
  errores.value = Object.fromEntries(Object.entries(errores.value).filter(([campo]) => !campo.startsWith(prefijo)));
}
watch(() => datos.fechaBaja, () => quitarError("fechaBaja"));
watch(() => datos.elaboro, () => quitarError("elaboro"));

const idError = (campo: string) => (errores.value[campo] ? `error-${campo.replaceAll(".", "-")}` : undefined);

async function enfocarPrimerError() {
  await nextTick();
  formulario.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

const cuerpo = (): DatosNuevaBaja => ({
  equipos: elegidos.value.map((e) => ({ id: e.equipo.id, observaciones: e.observaciones, tiempoUso: e.tiempoUso })),
  articulos: articulos.value.map((a) => ({ ...a })),
  ...datos,
});
const resumen = computed(() => resumenRenglones(elegidos.value.length, articulos.value.length));

// --------------------------------------------------- confirmar y registrar
const confirmando = ref(false);
const enviando = ref(false);
const errorEnvio = ref("");
const registrada = ref<(Baja & { mantenimientosCancelados: number }) | null>(null);

function revisar() {
  errores.value = validarBaja(cuerpo(), hoy);
  if (Object.keys(errores.value).length > 0) return enfocarPrimerError();
  errorEnvio.value = "";
  confirmando.value = true;
}

const mensajeConfirmacion = computed(() => {
  const partes: string[] = [];
  const n = elegidos.value.length;
  if (n > 0) {
    const series = elegidos.value.map((e) => e.equipo.numeroSerie);
    const cuales = series.length <= 5 ? series.join(", ") : `${series.slice(0, 5).join(", ")} y ${series.length - 5} más`;
    partes.push(
      `${n === 1 ? "El equipo" : "Los equipos"} ${cuales} ${n === 1 ? "saldrá" : "saldrán"} del inventario y ya no se ` +
      `${n === 1 ? "podrá editar, asignar ni darle" : "podrán editar, asignar ni darles"} mantenimiento. ` +
      "Sus mantenimientos programados se cancelarán.",
    );
  }
  if (articulos.value.length > 0) {
    partes.push(`También se ${articulos.value.length === 1 ? "registra 1 artículo" : `registran ${articulos.value.length} artículos`} sin número de serie.`);
  }
  partes.push("Esta acción no se puede deshacer.");
  return partes.join(" ");
});

async function confirmar() {
  enviando.value = true;
  errorEnvio.value = "";
  try {
    registrada.value = await registrarBaja(cuerpo());
    confirmando.value = false;
    mostrarAviso(`Baja registrada con el folio ${registrada.value.folio}.`);
    if (registrada.value.mantenimientosCancelados > 0) await recargarAvisos();
  } catch (e) {
    if (e instanceof ErrorApi && Object.keys(e.campos).length > 0) {
      errores.value = e.campos;
      confirmando.value = false;
      await enfocarPrimerError();
    } else {
      errorEnvio.value = e instanceof Error ? e.message : "No se pudo registrar la baja.";
    }
  } finally {
    enviando.value = false;
  }
}

function registrarOtra() {
  registrada.value = null;
  elegidos.value = [];
  articulos.value = [];
  texto.value = "";
  listaSeries.value = "";
  revision.value = null;
  avisoInicial.value = null;
  datos.fechaBaja = hoy; // quien captura se conserva
  errores.value = {};
}
</script>

<template>
  <div class="vista">
    <nav class="ruta" aria-label="Ruta de navegación">
      <RouterLink to="/bajas">Bajas</RouterLink><span aria-hidden="true">/</span><span>Registrar baja</span>
    </nav>

    <!-- ============================================================ éxito -->
    <template v-if="registrada">
      <h1 class="titulo-pagina">Registrar baja</h1>
      <section class="tarjeta exito" role="status">
        <span class="marca-exito"><Icono nombre="hecho" :tamano="28" :grosor="2.25" /></span>
        <h2>Baja registrada · <span class="serie">{{ registrada.folio }}</span></h2>
        <p>
          Se {{ registrada.equipos.length + registrada.articulos.length === 1 ? "registró" : "registraron" }} {{ resumenRenglones(registrada.equipos.length, registrada.articulos.length) }}.
          <template v-if="registrada.equipos.length === 1">El equipo ya aparece como dado de baja.</template>
          <template v-else-if="registrada.equipos.length > 1">Los equipos ya aparecen como dados de baja.</template>
          <template v-if="registrada.mantenimientosCancelados > 0">
            Se {{ registrada.mantenimientosCancelados === 1 ? "canceló 1 mantenimiento programado" : `cancelaron ${registrada.mantenimientosCancelados} mantenimientos programados` }}.
          </template>
        </p>
        <p class="consejo">Imprime el reporte y recaba las firmas del jefe departamental, el contralor de costos, el director general y el contralor general.</p>
        <div class="acciones">
          <a :href="urlReporteBaja(registrada.id)" target="_blank" rel="noopener" class="boton boton-primario">
            <Icono nombre="imprimir" :tamano="18" />Imprimir reporte de baja
          </a>
          <RouterLink to="/bajas" class="boton boton-secundario">Ver todas las bajas</RouterLink>
          <button type="button" class="boton boton-secundario" @click="registrarOtra">Registrar otra baja</button>
        </div>
      </section>
    </template>

    <!-- ======================================================= formulario -->
    <template v-else>
      <div class="encabezado-pagina">
        <div>
          <h1 class="titulo-pagina">Registrar baja</h1>
          <p class="subtitulo">Sale en el formato del hotel «Baja de equipo operacional» (Econova). Cada equipo lleva su motivo y las condiciones. Los campos con * son obligatorios.</p>
        </div>
      </div>

      <form ref="formulario" class="formulario" novalidate @submit.prevent="revisar">
        <!-- ------------------------------------------------ 1. equipos -->
        <section class="tarjeta seccion" aria-labelledby="titulo-equipos">
          <div>
            <h2 id="titulo-equipos">1. Equipos del inventario</h2>
            <p class="campo-ayuda">En el resumen, los equipos del mismo tipo y motivo salen juntos con su cantidad y costo; en la relación, cada uno aparece con su número de serie.</p>
          </div>

          <p v-if="avisoInicial" class="aviso-alerta" role="alert">
            {{ avisoInicial.texto }}
            <RouterLink v-if="avisoInicial.equipoId" :to="{ name: 'ficha-equipo', params: { id: avisoInicial.equipoId } }">Ir a la ficha</RouterLink>
          </p>

          <div class="campo">
            <label for="lista-series">Agregar por lista de números de serie</label>
            <textarea
              id="lista-series" v-model="listaSeries" class="entrada entrada-mono lista-series" rows="4" spellcheck="false"
              placeholder="Pega la columna de números de serie del Excel o escanéalos, uno por renglón"
              aria-describedby="ayuda-lista-series"
            />
            <span id="ayuda-lista-series" class="campo-ayuda">
              El sistema los compara contra el inventario: agrega los que se pueden dar de baja y te dice cuáles no existen, ya están dados de baja, siguen asignados o vienen repetidos.
            </span>
            <div>
              <button type="button" class="boton boton-secundario" :disabled="revisandoLista" @click="revisarLista">
                <Icono nombre="buscar" :tamano="18" />{{ revisandoLista ? "Revisando…" : "Revisar y agregar" }}
              </button>
            </div>
            <p v-if="errorLista" class="aviso-error" role="alert">{{ errorLista }}</p>
            <div v-if="revision" class="revision" role="status">
              <strong>Se revisaron {{ revision.revisadas }} {{ revision.revisadas === 1 ? "número de serie" : "números de serie" }}: se {{ revision.agregados === 1 ? "agregó 1 equipo" : `agregaron ${revision.agregados} equipos` }}.</strong>
              <ul>
                <li v-if="revision.noEncontrados.length">No están en el inventario ({{ revision.noEncontrados.length }}): <span class="serie">{{ revision.noEncontrados.join(", ") }}</span>. Regístralos primero o agrégalos como artículo sin número de serie.</li>
                <li v-if="revision.yaDeBaja.length">Ya están dados de baja ({{ revision.yaDeBaja.length }}): <span class="serie">{{ revision.yaDeBaja.map((e) => e.folio ? `${e.numeroSerie} (${e.folio})` : e.numeroSerie).join(", ") }}</span>.</li>
                <li v-if="revision.asignados.length">Siguen asignados ({{ revision.asignados.length }}): {{ revision.asignados.map((e) => `${e.numeroSerie} (${e.empleado})`).join(", ") }}. Registra su devolución primero.</li>
                <li v-if="revision.repetidos.length">Venían repetidos en la lista ({{ revision.repetidos.length }}): <span class="serie">{{ revision.repetidos.join(", ") }}</span>. Se tomaron una sola vez.</li>
              </ul>
            </div>
          </div>

          <div class="campo">
            <label for="buscar-baja">Buscar equipos</label>
            <input
              id="buscar-baja" v-model="texto" class="entrada entrada-mono" type="search" autocomplete="off"
              placeholder="Número de serie, marca, modelo o folio de factura"
              :aria-invalid="!!errores.equipos" :aria-describedby="idError('equipos') ?? 'ayuda-buscar-baja'"
            >
            <span v-if="errores.equipos" id="error-equipos" class="campo-error" role="alert">{{ errores.equipos }}</span>
            <span v-else id="ayuda-buscar-baja" class="campo-ayuda">
              Un equipo asignado no se puede dar de baja hasta registrar su devolución.
            </span>
          </div>

          <p v-if="errorBusqueda" class="aviso-error" role="alert">{{ errorBusqueda }}</p>
          <p v-else-if="buscando && resultados.length === 0" class="campo-ayuda">Buscando…</p>
          <p v-else-if="buscado !== '' && texto.trim() !== '' && resultados.length === 0" class="campo-ayuda">
            Ningún equipo del inventario coincide con «{{ buscado }}».
          </p>

          <div v-if="resultados.length > 0 && texto.trim() !== ''" class="resultados">
            <label v-for="equipo in resultados" :key="equipo.id" class="fila" :class="{ bloqueada: !!equipo.asignacionVigente }">
              <input type="checkbox" :checked="estaElegido(equipo.id)" :disabled="!!equipo.asignacionVigente" @change="alternar(equipo)">
              <span class="celda-doble">
                <span><span class="serie">{{ equipo.numeroSerie }}</span> · {{ equipo.marca }} {{ equipo.modelo }}</span>
                <span v-if="equipo.asignacionVigente" class="motivo-bloqueo">
                  Asignado a {{ nombreCompleto(equipo.asignacionVigente.empleado) }}: registra la devolución primero
                </span>
                <span v-else>{{ ETIQUETAS_TIPO[equipo.tipo] }}<template v-if="equipo.ubicacion"> · {{ equipo.ubicacion }}</template></span>
              </span>
              <InsigniaEstado v-if="equipo.estado !== 'ACTIVO'" :estado="equipo.estado" />
            </label>
          </div>

          <div v-if="elegidos.length > 0" class="renglones" aria-live="polite">
            <div class="renglones-titulo">
              <strong>{{ elegidos.length }} {{ elegidos.length === 1 ? "equipo elegido" : "equipos elegidos" }}</strong>
              <button v-if="elegidos.length > 1" type="button" class="boton-enlace" :disabled="!elegidos[0]!.observaciones.trim()" @click="copiarPrimerMotivo">
                Usar el primer motivo en los que están vacíos
              </button>
            </div>
            <div v-for="(elegido, i) in elegidos" :key="elegido.equipo.id" class="renglon-equipo">
              <div class="celda-doble identidad">
                <span class="serie">{{ elegido.equipo.numeroSerie }}</span>
                <span>{{ ETIQUETAS_TIPO[elegido.equipo.tipo] }} {{ elegido.equipo.marca }} {{ elegido.equipo.modelo }}</span>
              </div>
              <div class="campo motivo">
                <label :for="`equipo-${i}-observaciones`">Motivo y condiciones *</label>
                <input
                  :id="`equipo-${i}-observaciones`" v-model="elegido.observaciones" class="entrada" maxlength="255"
                  placeholder="Ej. No enciende, pantalla rota"
                  :aria-invalid="!!errores[`equipos.${i}.observaciones`]" :aria-describedby="idError(`equipos.${i}.observaciones`)"
                  @input="quitarError(`equipos.${i}.observaciones`)"
                >
                <span v-if="errores[`equipos.${i}.observaciones`]" :id="idError(`equipos.${i}.observaciones`)" class="campo-error">{{ errores[`equipos.${i}.observaciones`] }}</span>
              </div>
              <div class="campo tiempo">
                <label :for="`equipo-${i}-tiempoUso`">Tiempo de uso</label>
                <input
                  :id="`equipo-${i}-tiempoUso`" v-model="elegido.tiempoUso" class="entrada" maxlength="40" placeholder="Ej. 5 a 6 años"
                  :aria-invalid="!!errores[`equipos.${i}.tiempoUso`]" :aria-describedby="idError(`equipos.${i}.tiempoUso`) ?? `ayuda-equipo-${i}-tiempoUso`"
                  @input="quitarError(`equipos.${i}.tiempoUso`)"
                >
                <span v-if="errores[`equipos.${i}.tiempoUso`]" :id="idError(`equipos.${i}.tiempoUso`)" class="campo-error">{{ errores[`equipos.${i}.tiempoUso`] }}</span>
                <span v-else :id="`ayuda-equipo-${i}-tiempoUso`" class="campo-ayuda">Vacío: se calcula con la fecha de adquisición.</span>
              </div>
              <button
                v-if="cuantosDelMismoTipo(elegido.equipo.tipo) > 1" type="button" class="boton-enlace aplicar"
                :disabled="!elegido.observaciones.trim() && !elegido.tiempoUso.trim()" @click="aplicarAlMismoTipo(i)"
              >
                Aplicar a los demás «{{ ETIQUETAS_TIPO[elegido.equipo.tipo] }}»
              </button>
              <button type="button" class="quitar" :aria-label="`Quitar ${elegido.equipo.numeroSerie} de la baja`" @click="quitarEquipo(elegido.equipo.id)">
                <Icono nombre="cerrar" :tamano="18" :grosor="2" />
              </button>
            </div>
          </div>
          <p v-if="elegidos.length > MAXIMO_EQUIPOS_BAJA" class="aviso-error">Máximo {{ MAXIMO_EQUIPOS_BAJA }} equipos por baja. Quita algunos o haz otra baja.</p>
        </section>

        <!-- ---------------------------------------------- 2. artículos -->
        <section class="tarjeta seccion" aria-labelledby="titulo-articulos">
          <div>
            <h2 id="titulo-articulos">2. Artículos sin número de serie</h2>
            <p class="campo-ayuda">Baterías de UPS, tóners, equipos con el número de serie borrado o no visible… lo que no está registrado en el inventario.</p>
          </div>

          <div v-for="(articulo, i) in articulos" :key="i" class="renglon-articulo" role="group" :aria-label="`Artículo ${i + 1}`">
            <div class="campo descripcion">
              <label :for="`articulo-${i}-descripcion`">Descripción *</label>
              <input
                :id="`articulo-${i}-descripcion`" v-model="articulo.descripcion" class="entrada" maxlength="150" placeholder="Ej. Baterías UPS no-break"
                :aria-invalid="!!errores[`articulos.${i}.descripcion`]" :aria-describedby="idError(`articulos.${i}.descripcion`)"
                @input="quitarError(`articulos.${i}.descripcion`)"
              >
              <span v-if="errores[`articulos.${i}.descripcion`]" :id="idError(`articulos.${i}.descripcion`)" class="campo-error">{{ errores[`articulos.${i}.descripcion`] }}</span>
            </div>
            <div class="campo corto">
              <label :for="`articulo-${i}-cantidad`">Cantidad *</label>
              <input
                :id="`articulo-${i}-cantidad`" v-model="articulo.cantidad" class="entrada" inputmode="numeric"
                :aria-invalid="!!errores[`articulos.${i}.cantidad`]" :aria-describedby="idError(`articulos.${i}.cantidad`)"
                @input="quitarError(`articulos.${i}.cantidad`)"
              >
              <span v-if="errores[`articulos.${i}.cantidad`]" :id="idError(`articulos.${i}.cantidad`)" class="campo-error">{{ errores[`articulos.${i}.cantidad`] }}</span>
            </div>
            <div class="campo mediano">
              <label :for="`articulo-${i}-costo`">Costo total</label>
              <input
                :id="`articulo-${i}-costo`" v-model="articulo.costo" class="entrada" inputmode="decimal" placeholder="$ 0.00"
                :aria-invalid="!!errores[`articulos.${i}.costo`]" :aria-describedby="idError(`articulos.${i}.costo`)"
                @input="quitarError(`articulos.${i}.costo`)"
              >
              <span v-if="errores[`articulos.${i}.costo`]" :id="idError(`articulos.${i}.costo`)" class="campo-error">{{ errores[`articulos.${i}.costo`] }}</span>
            </div>
            <div class="campo mediano">
              <label :for="`articulo-${i}-tiempoUso`">Tiempo de uso</label>
              <input
                :id="`articulo-${i}-tiempoUso`" v-model="articulo.tiempoUso" class="entrada" maxlength="40" placeholder="Ej. 6 a 8 años"
                :aria-invalid="!!errores[`articulos.${i}.tiempoUso`]" :aria-describedby="idError(`articulos.${i}.tiempoUso`)"
                @input="quitarError(`articulos.${i}.tiempoUso`)"
              >
              <span v-if="errores[`articulos.${i}.tiempoUso`]" :id="idError(`articulos.${i}.tiempoUso`)" class="campo-error">{{ errores[`articulos.${i}.tiempoUso`] }}</span>
            </div>
            <div class="campo motivo">
              <label :for="`articulo-${i}-observaciones`">Motivo y condiciones *</label>
              <input
                :id="`articulo-${i}-observaciones`" v-model="articulo.observaciones" class="entrada" maxlength="255" placeholder="Ej. No retienen carga"
                :aria-invalid="!!errores[`articulos.${i}.observaciones`]" :aria-describedby="idError(`articulos.${i}.observaciones`)"
                @input="quitarError(`articulos.${i}.observaciones`)"
              >
              <span v-if="errores[`articulos.${i}.observaciones`]" :id="idError(`articulos.${i}.observaciones`)" class="campo-error">{{ errores[`articulos.${i}.observaciones`] }}</span>
            </div>
            <button type="button" class="quitar" :aria-label="`Quitar el artículo ${i + 1}`" @click="quitarArticulo(i)">
              <Icono nombre="cerrar" :tamano="18" :grosor="2" />
            </button>
          </div>

          <p v-if="errores.articulos" class="campo-error">{{ errores.articulos }}</p>
          <button type="button" class="boton boton-secundario agregar" :disabled="articulos.length >= MAXIMO_ARTICULOS_BAJA" @click="agregarArticulo">
            <Icono nombre="mas" :tamano="18" :grosor="2" />Agregar artículo
          </button>
        </section>

        <!-- -------------------------------------------------- 3. datos -->
        <section class="tarjeta seccion" aria-labelledby="titulo-acta">
          <h2 id="titulo-acta">3. Datos del reporte</h2>
          <div class="rejilla">
            <div class="campo">
              <label for="fechaBaja">Fecha de la baja *</label>
              <input id="fechaBaja" v-model="datos.fechaBaja" type="date" class="entrada" :max="hoy" :aria-invalid="!!errores.fechaBaja" :aria-describedby="idError('fechaBaja')">
              <span v-if="errores.fechaBaja" id="error-fechaBaja" class="campo-error">{{ errores.fechaBaja }}</span>
            </div>
            <div class="campo">
              <label for="elaboro">Capturó *</label>
              <input id="elaboro" v-model="datos.elaboro" class="entrada" maxlength="100" autocomplete="name" placeholder="Tu nombre completo" :aria-invalid="!!errores.elaboro" :aria-describedby="idError('elaboro') ?? 'ayuda-elaboro'">
              <span v-if="errores.elaboro" id="error-elaboro" class="campo-error">{{ errores.elaboro }}</span>
              <span v-else id="ayuda-elaboro" class="campo-ayuda">Queda en el sistema; no ocupa lugar de firma.</span>
            </div>
          </div>
          <p class="campo-ayuda">
            El reporte sale con el resumen por tipo de equipo, los espacios para firmar a mano (jefe departamental, contralor de costos, director general y contralor general) y la relación de cada equipo con su número de serie.
          </p>
        </section>

        <div class="acciones-formulario">
          <RouterLink to="/bajas" class="boton boton-secundario">Cancelar</RouterLink>
          <button type="submit" class="boton boton-peligro-solido" :disabled="elegidos.length > MAXIMO_EQUIPOS_BAJA">
            <Icono nombre="bajas" :tamano="18" />
            {{ resumen ? `Dar de baja ${resumen}` : "Dar de baja" }}
          </button>
        </div>
      </form>
    </template>

    <DialogoConfirmar
      v-if="confirmando"
      :titulo="`¿Dar de baja ${resumen}?`"
      :mensaje="mensajeConfirmacion"
      texto-confirmar="Sí, dar de baja"
      texto-volver="No, revisar"
      peligro
      :enviando="enviando"
      :error="errorEnvio"
      @confirmar="confirmar"
      @cerrar="confirmando = false"
    />
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 18px; }
.formulario { display: flex; flex-direction: column; gap: 20px; max-width: 1040px; }
.seccion { display: flex; flex-direction: column; gap: 16px; }
.seccion h2 { margin: 0 0 4px; font-size: 17px; font-weight: 700; }
.seccion > div > .campo-ayuda { margin: 0; }
.rejilla { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }
.resultados {
  display: flex; flex-direction: column; max-height: 320px; overflow-y: auto;
  border: 1px solid var(--borde); border-radius: var(--radio);
}
.fila {
  display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 14px;
  border-bottom: 1px solid var(--linea); cursor: pointer;
}
.fila:last-child { border-bottom: 0; }
.fila:hover { background: var(--superficie-suave); }
.fila .celda-doble { flex: 1; min-width: 0; }
.fila input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--peligro); }
.fila.bloqueada { cursor: not-allowed; }
.fila.bloqueada .serie { color: var(--texto-2); }
.motivo-bloqueo { color: var(--alerta) !important; font-weight: 600; }
.renglones { display: flex; flex-direction: column; gap: 10px; }
.renglones-titulo { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.renglon-equipo, .renglon-articulo {
  display: flex; align-items: flex-start; flex-wrap: wrap; gap: 12px;
  padding: 12px 14px; border: 1px solid var(--borde); border-radius: 10px; background: var(--superficie-suave);
}
.identidad { width: 220px; padding-top: 6px; }
.renglon-equipo .motivo { flex: 1; min-width: 220px; }
.renglon-equipo .tiempo { flex: 0 0 170px; }
.renglon-equipo .aplicar { align-self: center; }
.lista-series { min-height: 96px; resize: vertical; }
.revision { padding: 12px 14px; border-radius: var(--radio); background: var(--superficie-suave); border: 1px solid var(--borde); }
.revision ul { margin: 6px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.renglon-articulo .descripcion { flex: 2 1 220px; }
.renglon-articulo .corto { flex: 0 0 96px; }
.renglon-articulo .mediano { flex: 0 0 130px; }
.renglon-articulo .motivo { flex: 2 1 220px; }
.quitar {
  align-self: center; width: 44px; height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: 22px; background: transparent; color: var(--texto-2); cursor: pointer;
}
.quitar:hover { background: var(--peligro-fondo); color: var(--peligro); }
.agregar { align-self: flex-start; }
.aviso-alerta {
  margin: 0; padding: 12px 14px; border-radius: var(--radio);
  background: var(--alerta-fondo); color: var(--tinta); font-weight: 600;
}
.aviso-alerta a { margin-left: 6px; }
.acciones-formulario { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 12px; }
.exito { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; max-width: 920px; padding: 32px; }
.exito h2 { margin: 0; font-family: var(--fuente-titulo); font-weight: 600; font-size: 28px; }
.exito p { margin: 0; font-size: 16px; color: var(--texto-2); }
.exito .consejo { font-size: 14px; }
.marca-exito { width: 52px; height: 52px; border-radius: 26px; display: flex; align-items: center; justify-content: center; background: var(--exito-fondo); color: var(--exito); }
.acciones { display: flex; flex-wrap: wrap; gap: 12px; padding-top: 6px; }
@media (max-width: 700px) {
  .rejilla { grid-template-columns: 1fr; }
  .identidad { width: 100%; }
  .renglon-articulo .corto, .renglon-articulo .mediano { flex: 1 1 96px; }
}
</style>
