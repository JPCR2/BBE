<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import type { DatosEquipo } from "../api/equipos";
import { ETIQUETAS_TIPO, fechaCorta, hoyEnElHotel, normalizarNumeroSerie } from "../utilidades/formato";
import { limpiarCosto, sumarAnios, validarEquipo } from "../utilidades/validacionEquipo";

const props = withDefaults(
  defineProps<{
    modo: "alta" | "edicion";
    inicial?: Partial<DatosEquipo>;
    erroresServidor?: Record<string, string>;
    enviando?: boolean;
  }>(),
  { inicial: () => ({}), erroresServidor: () => ({}), enviando: false },
);

const emit = defineEmits<{ enviar: [datos: DatosEquipo]; cancelar: [] }>();

const vacio: DatosEquipo = {
  numeroSerie: "", tipo: "", marca: "", modelo: "", ubicacion: "",
  fechaAdquisicion: "", costo: "", folioFactura: "", fechaVencimientoGarantia: "", especificaciones: "",
};
const obligatorioEnAlta = props.modo === "alta" ? " *" : "";
const datos = reactive<DatosEquipo>({ ...vacio, ...props.inicial });
const errores = ref<Record<string, string>>({});
const formulario = ref<HTMLFormElement>();
const hoy = hoyEnElHotel();

// Los errores que devuelve la API se muestran junto a su campo.
watch(
  () => props.erroresServidor,
  async (nuevos) => {
    errores.value = { ...nuevos };
    await enfocarPrimerError();
  },
);

// Al corregir un campo, su mensaje de error desaparece.
for (const campo of Object.keys(vacio) as (keyof DatosEquipo)[]) {
  watch(() => datos[campo], () => {
    if (errores.value[campo]) {
      const { [campo]: _quitado, ...resto } = errores.value;
      errores.value = resto;
    }
  });
}

const serieNormalizada = computed(() => normalizarNumeroSerie(datos.numeroSerie));
const ayudaSerie = computed(() =>
  serieNormalizada.value !== "" && serieNormalizada.value !== datos.numeroSerie
    ? `Se guardará como ${serieNormalizada.value}`
    : "Se guarda sin espacios y en mayúsculas.",
);

// Garantía rápida: 1, 2 o 3 años desde la adquisición (o desde hoy si aún no se captura).
const baseGarantia = computed(() => datos.fechaAdquisicion || hoy);
function ponerGarantia(anios: number) {
  datos.fechaVencimientoGarantia = sumarAnios(baseGarantia.value, anios);
}

async function enfocarPrimerError() {
  await nextTick();
  formulario.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

async function enviar() {
  errores.value = validarEquipo(datos, hoy, props.modo);
  if (Object.keys(errores.value).length > 0) return enfocarPrimerError();
  emit("enviar", { ...datos, costo: limpiarCosto(datos.costo) });
}

const idError = (campo: string) => (errores.value[campo] ? `error-${campo}` : undefined);
</script>

<template>
  <form ref="formulario" class="tarjeta formulario" novalidate @submit.prevent="enviar">
    <div class="rejilla">
      <div class="campo">
        <label for="numeroSerie">Número de serie / Service Tag *</label>
        <input
          id="numeroSerie" v-model="datos.numeroSerie" class="entrada entrada-mono" autocomplete="off"
          placeholder="Como aparece en la etiqueta (en Dell, el Service Tag)"
          :aria-invalid="!!errores.numeroSerie" :aria-describedby="idError('numeroSerie') ?? 'ayuda-serie'"
        >
        <span v-if="errores.numeroSerie" id="error-numeroSerie" class="campo-error">{{ errores.numeroSerie }}</span>
        <span v-else id="ayuda-serie" class="campo-ayuda" :class="{ destacada: serieNormalizada !== datos.numeroSerie && serieNormalizada !== '' }">{{ ayudaSerie }}</span>
      </div>

      <div class="campo">
        <label for="tipo">Tipo *</label>
        <select id="tipo" v-model="datos.tipo" class="entrada" :aria-invalid="!!errores.tipo" :aria-describedby="idError('tipo')">
          <option value="">Selecciona el tipo</option>
          <option v-for="(etiqueta, valor) in ETIQUETAS_TIPO" :key="valor" :value="valor">{{ etiqueta }}</option>
        </select>
        <span v-if="errores.tipo" id="error-tipo" class="campo-error">{{ errores.tipo }}</span>
      </div>

      <div class="campo">
        <label for="marca">Marca *</label>
        <input id="marca" v-model="datos.marca" class="entrada" placeholder="Ej. Dell, HP, Lenovo" :aria-invalid="!!errores.marca" :aria-describedby="idError('marca')">
        <span v-if="errores.marca" id="error-marca" class="campo-error">{{ errores.marca }}</span>
      </div>

      <div class="campo">
        <label for="modelo">Modelo *</label>
        <input id="modelo" v-model="datos.modelo" class="entrada" placeholder="Ej. Latitude 5440" :aria-invalid="!!errores.modelo" :aria-describedby="idError('modelo')">
        <span v-if="errores.modelo" id="error-modelo" class="campo-error">{{ errores.modelo }}</span>
      </div>

      <div class="campo">
        <label for="ubicacion">Ubicación</label>
        <input id="ubicacion" v-model="datos.ubicacion" class="entrada" placeholder="Ej. Recepción, oficina de Contabilidad" :aria-invalid="!!errores.ubicacion" :aria-describedby="idError('ubicacion')">
        <span v-if="errores.ubicacion" id="error-ubicacion" class="campo-error">{{ errores.ubicacion }}</span>
      </div>

      <div class="campo">
        <label for="fechaAdquisicion">Fecha de adquisición</label>
        <input id="fechaAdquisicion" v-model="datos.fechaAdquisicion" type="date" class="entrada" :max="hoy" :aria-invalid="!!errores.fechaAdquisicion" :aria-describedby="idError('fechaAdquisicion')">
        <span v-if="errores.fechaAdquisicion" id="error-fechaAdquisicion" class="campo-error">{{ errores.fechaAdquisicion }}</span>
      </div>

      <div class="campo">
        <label for="costo">Costo</label>
        <div class="con-unidad" :class="{ invalido: !!errores.costo }">
          <span aria-hidden="true">$</span>
          <input id="costo" v-model="datos.costo" inputmode="decimal" placeholder="0.00" :aria-invalid="!!errores.costo" :aria-describedby="idError('costo') ?? (modo === 'alta' ? 'ayuda-costo' : undefined)">
          <span class="unidad">MXN</span>
        </div>
        <span v-if="errores.costo" id="error-costo" class="campo-error">{{ errores.costo }}</span>
      </div>

      <div class="campo">
        <label for="folioFactura">Folio de factura{{ obligatorioEnAlta }}</label>
        <input
          id="folioFactura" v-model="datos.folioFactura" class="entrada entrada-mono" maxlength="50" autocomplete="off"
          placeholder="Ej. FAC-A-10234" :aria-invalid="!!errores.folioFactura" :aria-describedby="idError('folioFactura') ?? 'ayuda-folio'"
        >
        <span v-if="errores.folioFactura" id="error-folioFactura" class="campo-error">{{ errores.folioFactura }}</span>
        <span v-else id="ayuda-folio" class="campo-ayuda">Los equipos de la misma factura salen juntos en el reporte de alta.</span>
      </div>

      <div class="campo">
        <label for="fechaVencimientoGarantia">Vencimiento de la garantía{{ obligatorioEnAlta }}</label>
        <input
          id="fechaVencimientoGarantia" v-model="datos.fechaVencimientoGarantia" type="date" class="entrada"
          :min="datos.fechaAdquisicion || undefined"
          :aria-invalid="!!errores.fechaVencimientoGarantia" :aria-describedby="idError('fechaVencimientoGarantia') ?? 'ayuda-garantia'"
        >
        <div class="rapidos-garantia" role="group" aria-label="Calcular el vencimiento de la garantía">
          <button v-for="anios in [1, 2, 3]" :key="anios" type="button" class="boton-enlace" @click="ponerGarantia(anios)">
            {{ anios }} {{ anios === 1 ? "año" : "años" }}
          </button>
        </div>
        <span v-if="errores.fechaVencimientoGarantia" id="error-fechaVencimientoGarantia" class="campo-error">{{ errores.fechaVencimientoGarantia }}</span>
        <span v-else id="ayuda-garantia" class="campo-ayuda">
          Los botones cuentan desde {{ datos.fechaAdquisicion ? `la adquisición (${fechaCorta(datos.fechaAdquisicion)})` : "hoy" }}.
        </span>
      </div>

      <div v-if="modo === 'edicion'" class="campo">
        <label for="estado">Estado</label>
        <select id="estado" v-model="datos.estado" class="entrada">
          <option value="ACTIVO">Activo</option>
          <option value="EN_MANTENIMIENTO">En mantenimiento</option>
        </select>
      </div>
      <p v-else id="ayuda-costo" class="campo-ayuda nota">El modelo, la serie, el costo, el folio y la garantía salen en el reporte de alta.</p>

      <div class="campo completo">
        <label for="especificaciones">Especificaciones</label>
        <textarea id="especificaciones" v-model="datos.especificaciones" class="entrada" rows="2" placeholder="Procesador, memoria RAM, almacenamiento, sistema operativo…" />
      </div>
    </div>

    <p v-if="errores._" class="aviso-error" role="alert">{{ errores._ }}</p>

    <div class="acciones">
      <button type="button" class="boton boton-secundario" @click="emit('cancelar')">Cancelar</button>
      <button type="submit" class="boton boton-primario" :disabled="enviando">
        {{ enviando ? "Guardando…" : modo === "alta" ? "Registrar equipo" : "Guardar cambios" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.formulario { display: flex; flex-direction: column; gap: 20px; max-width: 920px; }
.rejilla { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }
.completo { grid-column: 1 / -1; }
.nota { align-self: end; margin: 0; }
.con-unidad {
  display: flex; align-items: stretch; min-height: 44px; overflow: hidden;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); background: var(--superficie);
}
.con-unidad:focus-within { outline: 3px solid var(--primario); outline-offset: 2px; }
.con-unidad.invalido { border: 2px solid var(--peligro); }
.con-unidad > span { display: flex; align-items: center; padding: 0 10px; color: var(--texto-2); }
.con-unidad input { flex: 1; min-width: 0; border: 0; outline: none; font: inherit; color: var(--tinta); background: transparent; }
.con-unidad .unidad { padding: 0 12px; font-size: 13px; font-weight: 600; background: var(--superficie-suave); border-left: 1px solid var(--borde); }
.rapidos-garantia { display: flex; gap: 16px; }
.acciones { display: flex; justify-content: flex-end; gap: 12px; padding-top: 16px; border-top: 1px solid var(--linea); }
@media (max-width: 700px) { .rejilla { grid-template-columns: 1fr; } }
</style>
