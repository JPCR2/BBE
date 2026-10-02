<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ErrorApi } from "../api/cliente";
import { listarEquipos, type EquipoResumen, type Mantenimiento, type TipoMantenimiento } from "../api/equipos";
import { crearMantenimiento, editarMantenimiento, type DatosEditarMantenimiento } from "../api/mantenimientos";
import { ETIQUETAS_TIPO, fechaCorta, hoyEnElHotel } from "../utilidades/formato";
import { ETIQUETAS_TIPO_MANTENIMIENTO } from "../utilidades/mantenimiento";
import Icono from "./Icono.vue";

type EquipoElegible = Pick<EquipoResumen, "id" | "numeroSerie" | "marca" | "modelo" | "tipo">;

/**
 * Programa un mantenimiento, registra uno que ya se hizo o, si recibe
 * `mantenimiento`, lo reprograma o corrige.
 */
const props = defineProps<{
  equipo?: EquipoElegible;
  mantenimiento?: Mantenimiento & { equipo?: EquipoElegible };
  /** Fecha sugerida (por ejemplo, el día elegido en el calendario). */
  fechaInicial?: string;
}>();
const emit = defineEmits<{ guardado: [mensaje: string]; cerrar: [] }>();

const hoy = hoyEnElHotel();
const editando = computed(() => !!props.mantenimiento);
const dialogo = ref<HTMLDialogElement>();

const original = props.mantenimiento;
const formulario = reactive({
  modo: "PROGRAMADO" as "PROGRAMADO" | "REALIZADO",
  tipo: (original?.tipo ?? "") as TipoMantenimiento | "",
  fecha: original?.fechaProgramada ?? (props.fechaInicial && props.fechaInicial >= hoy ? props.fechaInicial : ""),
  descripcion: original?.descripcion ?? "",
  responsable: original?.responsable ?? "",
});
const errores = ref<Record<string, string>>({});
const errorGeneral = ref("");
const enviando = ref(false);

// ------------------------------------------------------- elección del equipo
const equipoElegido = ref<EquipoElegible | null>(props.equipo ?? original?.equipo ?? null);
const eligeEquipo = !equipoElegido.value;
const textoEquipos = ref("");
const opcionesEquipos = ref<EquipoResumen[]>([]);
const cargandoEquipos = ref(false);
let pausa: ReturnType<typeof setTimeout> | undefined;

async function buscarEquipos() {
  cargandoEquipos.value = true;
  try {
    opcionesEquipos.value = (await listarEquipos({ busqueda: textoEquipos.value.trim(), porPagina: 6 })).datos;
  } catch (e) {
    errorGeneral.value = e instanceof ErrorApi ? e.message : "No se pudieron cargar los equipos.";
  }
  cargandoEquipos.value = false;
}
function alEscribirEquipo() {
  clearTimeout(pausa);
  pausa = setTimeout(buscarEquipos, 250);
}

onMounted(() => {
  dialogo.value?.showModal();
  if (eligeEquipo) buscarEquipos();
});

// ------------------------------------------------------------- validación
const esRealizado = computed(() => !editando.value && formulario.modo === "REALIZADO");
const campoFecha = computed(() => (esRealizado.value ? "fechaRealizacion" : "fechaProgramada"));

function validar(): boolean {
  const e: Record<string, string> = {};
  if (!equipoElegido.value) e.equipoId = "Selecciona un equipo.";
  if (!formulario.tipo) e.tipo = "Selecciona si es preventivo o correctivo.";
  if (formulario.descripcion.trim() === "") e.descripcion = "Describe qué se hará o qué se hizo.";
  const fechaCambio = !editando.value || formulario.fecha !== original?.fechaProgramada;
  if (!formulario.fecha) {
    e[campoFecha.value] = esRealizado.value ? "Elige la fecha en que se realizó." : "Elige la fecha programada.";
  } else if (esRealizado.value && formulario.fecha > hoy) {
    e[campoFecha.value] = "La fecha de realización no puede ser futura.";
  } else if (!esRealizado.value && fechaCambio && formulario.fecha < hoy) {
    e[campoFecha.value] = "La fecha programada no puede ser anterior a hoy. Si ya se hizo, regístralo como realizado.";
  }
  errores.value = e;
  return Object.keys(e).length === 0;
}

/** Al editar solo se envía lo que cambió (así un vencido se puede corregir sin moverle la fecha). */
function cambios(): DatosEditarMantenimiento {
  const c: DatosEditarMantenimiento = {};
  if (formulario.tipo && formulario.tipo !== original!.tipo) c.tipo = formulario.tipo;
  if (formulario.descripcion.trim() !== original!.descripcion) c.descripcion = formulario.descripcion.trim();
  if (formulario.responsable.trim() !== (original!.responsable ?? "")) c.responsable = formulario.responsable.trim();
  if (formulario.fecha !== original!.fechaProgramada) c.fechaProgramada = formulario.fecha;
  return c;
}

async function guardar() {
  errorGeneral.value = "";
  if (!validar()) return;
  const equipo = equipoElegido.value!;
  enviando.value = true;
  try {
    if (editando.value) {
      const datos = cambios();
      if (Object.keys(datos).length === 0) {
        errorGeneral.value = "No hay cambios que guardar.";
        return;
      }
      await editarMantenimiento(original!.id, datos);
      emit(
        "guardado",
        datos.fechaProgramada
          ? `Mantenimiento de ${equipo.numeroSerie} reprogramado para el ${fechaCorta(datos.fechaProgramada)}.`
          : `Mantenimiento de ${equipo.numeroSerie} actualizado.`,
      );
    } else {
      const comunes = { equipoId: equipo.id, tipo: formulario.tipo, descripcion: formulario.descripcion.trim(), responsable: formulario.responsable.trim() };
      if (esRealizado.value) {
        await crearMantenimiento({ estado: "REALIZADO", ...comunes, fechaRealizacion: formulario.fecha });
        emit("guardado", `Mantenimiento de ${equipo.numeroSerie} registrado como realizado.`);
      } else {
        await crearMantenimiento({ estado: "PROGRAMADO", ...comunes, fechaProgramada: formulario.fecha });
        emit("guardado", `Mantenimiento de ${equipo.numeroSerie} programado para el ${fechaCorta(formulario.fecha)}.`);
      }
    }
  } catch (e) {
    if (e instanceof ErrorApi) {
      errores.value = { ...e.campos };
      if (Object.keys(e.campos).length === 0 || e.campos._) errorGeneral.value = e.campos._ ?? e.message;
    } else {
      errorGeneral.value = "No se pudo guardar el mantenimiento.";
    }
  } finally {
    enviando.value = false;
  }
}

const titulo = computed(() => (editando.value ? "Reprogramar o corregir" : "Programar mantenimiento"));
const textoBoton = computed(() => {
  if (enviando.value) return "Guardando…";
  if (editando.value) return "Guardar cambios";
  return esRealizado.value ? "Registrar como realizado" : "Programar";
});
</script>

<template>
  <dialog ref="dialogo" class="dialogo" aria-labelledby="titulo-programar" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form novalidate @submit.prevent="guardar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-programar">{{ titulo }}</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>

      <div v-if="equipoElegido && !eligeEquipo" class="resumen-equipo">
        <Icono nombre="inventario" :tamano="22" />
        <span class="celda-doble">
          <span class="serie">{{ equipoElegido.numeroSerie }}</span>
          <span>{{ equipoElegido.marca }} {{ equipoElegido.modelo }} · {{ ETIQUETAS_TIPO[equipoElegido.tipo] }}</span>
        </span>
      </div>

      <div v-else class="campo">
        <label for="buscar-equipo-mantenimiento">Equipo *</label>
        <input
          id="buscar-equipo-mantenimiento" v-model="textoEquipos" class="entrada entrada-mono" type="search"
          placeholder="Número de serie, marca o modelo" autocomplete="off" :aria-invalid="!!errores.equipoId" @input="alEscribirEquipo"
        >
        <div class="lista-opciones">
          <button
            v-for="opcion in opcionesEquipos" :key="opcion.id" type="button" class="opcion-persona"
            :aria-pressed="equipoElegido?.id === opcion.id" @click="equipoElegido = opcion; errores.equipoId = ''"
          >
            <span class="avatar" aria-hidden="true"><Icono v-if="equipoElegido?.id !== opcion.id" nombre="inventario" :tamano="18" /><template v-else>✓</template></span>
            <span class="celda-doble">
              <span class="serie">{{ opcion.numeroSerie }}</span>
              <span>{{ opcion.marca }} {{ opcion.modelo }} · {{ ETIQUETAS_TIPO[opcion.tipo] }}</span>
            </span>
          </button>
          <p v-if="!cargandoEquipos && opcionesEquipos.length === 0" class="campo-ayuda sin-datos">Ningún equipo coincide con la búsqueda.</p>
        </div>
        <span v-if="errores.equipoId" class="campo-error">{{ errores.equipoId }}</span>
      </div>

      <fieldset v-if="!editando" class="grupo">
        <legend>¿Qué quieres registrar?</legend>
        <div class="segmentos">
          <label :class="{ activo: formulario.modo === 'PROGRAMADO' }">
            <input v-model="formulario.modo" type="radio" name="modo" value="PROGRAMADO" @change="formulario.fecha = ''">
            <span><strong>Programarlo</strong><small>Se hará en una fecha futura</small></span>
          </label>
          <label :class="{ activo: formulario.modo === 'REALIZADO' }">
            <input v-model="formulario.modo" type="radio" name="modo" value="REALIZADO" @change="formulario.fecha = hoy">
            <span><strong>Ya se realizó</strong><small>Por ejemplo, un correctivo urgente</small></span>
          </label>
        </div>
      </fieldset>

      <fieldset class="grupo">
        <legend>Tipo de mantenimiento *</legend>
        <div class="segmentos">
          <label v-for="(etiqueta, valor) in ETIQUETAS_TIPO_MANTENIMIENTO" :key="valor" :class="{ activo: formulario.tipo === valor }">
            <input v-model="formulario.tipo" type="radio" name="tipo" :value="valor" @change="errores.tipo = ''">
            <span><strong>{{ etiqueta }}</strong><small>{{ valor === "PREVENTIVO" ? "Limpieza, revisión, actualización" : "Reparar una falla" }}</small></span>
          </label>
        </div>
        <span v-if="errores.tipo" class="campo-error">{{ errores.tipo }}</span>
      </fieldset>

      <div class="fila">
        <div class="campo">
          <label for="fecha-mantenimiento">{{ esRealizado ? "Fecha en que se realizó *" : "Fecha programada *" }}</label>
          <input
            id="fecha-mantenimiento" v-model="formulario.fecha" class="entrada" type="date"
            :min="esRealizado ? undefined : hoy" :max="esRealizado ? hoy : undefined"
            :aria-invalid="!!errores[campoFecha]" @input="errores[campoFecha] = ''"
          >
          <span v-if="errores[campoFecha]" class="campo-error">{{ errores[campoFecha] }}</span>
          <span v-else-if="!esRealizado" class="campo-ayuda">Se avisará en Inicio 7 días antes.</span>
        </div>
        <div class="campo">
          <label for="responsable-mantenimiento">Responsable</label>
          <input id="responsable-mantenimiento" v-model="formulario.responsable" class="entrada" maxlength="100" placeholder="Quién lo hará o lo hizo">
          <span v-if="errores.responsable" class="campo-error">{{ errores.responsable }}</span>
        </div>
      </div>

      <div class="campo">
        <label for="descripcion-mantenimiento">Descripción *</label>
        <textarea
          id="descripcion-mantenimiento" v-model="formulario.descripcion" class="entrada" rows="3" maxlength="2000"
          :placeholder="esRealizado ? 'Qué se hizo. Ej. Se reemplazó el teclado' : 'Qué se hará. Ej. Limpieza interna y revisión de ventiladores'"
          :aria-invalid="!!errores.descripcion" @input="errores.descripcion = ''"
        />
        <span v-if="errores.descripcion" class="campo-error">{{ errores.descripcion }}</span>
      </div>

      <p v-if="errorGeneral" class="aviso-error" role="alert">{{ errorGeneral }}</p>

      <div class="dialogo-acciones">
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-primario" :disabled="enviando">{{ textoBoton }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.sin-datos { padding: 16px; margin: 0; }
.grupo { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 8px; }
.grupo legend { padding: 0; margin-bottom: 8px; font-size: 14px; font-weight: 600; }
.segmentos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.segmentos label {
  display: flex; align-items: flex-start; gap: 10px; min-height: 56px; padding: 10px 14px;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); cursor: pointer;
}
.segmentos label.activo { border: 2px solid var(--primario); background: var(--primario-tenue); padding: 9px 13px; }
.segmentos input { margin-top: 3px; accent-color: var(--primario); }
.segmentos span { display: flex; flex-direction: column; gap: 2px; }
.segmentos small { font-size: 13px; color: var(--texto-2); }
.fila { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 600px) {
  .segmentos, .fila { grid-template-columns: 1fr; }
}
</style>
