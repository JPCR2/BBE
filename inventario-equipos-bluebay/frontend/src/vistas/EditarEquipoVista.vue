<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ErrorApi } from "../api/cliente";
import { editarEquipo, obtenerEquipo, type DatosEquipo, type FichaEquipo } from "../api/equipos";
import FormularioEquipo from "../componentes/FormularioEquipo.vue";
import { mostrarAviso } from "../composables/useAvisos";

const props = defineProps<{ id: string }>();
const router = useRouter();
const equipo = ref<FichaEquipo | null>(null);
const inicial = ref<Partial<DatosEquipo>>({});
const error = ref("");
const enviando = ref(false);
const erroresServidor = ref<Record<string, string>>({});

onMounted(async () => {
  try {
    const ficha = await obtenerEquipo(Number(props.id));
    equipo.value = ficha;
    inicial.value = {
      numeroSerie: ficha.numeroSerie,
      tipo: ficha.tipo,
      marca: ficha.marca,
      modelo: ficha.modelo,
      ubicacion: ficha.ubicacion ?? "",
      fechaAdquisicion: ficha.fechaAdquisicion ?? "",
      costo: ficha.costo ?? "",
      folioFactura: ficha.folioFactura ?? "",
      fechaVencimientoGarantia: ficha.fechaVencimientoGarantia ?? "",
      especificaciones: ficha.especificaciones ?? "",
      estado: ficha.estado === "EN_MANTENIMIENTO" ? "EN_MANTENIMIENTO" : "ACTIVO",
    };
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudo cargar el equipo.";
  }
});

async function guardar(datos: DatosEquipo) {
  enviando.value = true;
  try {
    await editarEquipo(Number(props.id), datos);
    mostrarAviso("Cambios guardados.");
    router.push({ name: "ficha-equipo", params: { id: props.id } });
  } catch (e) {
    erroresServidor.value =
      e instanceof ErrorApi && Object.keys(e.campos).length > 0
        ? e.campos
        : { _: e instanceof Error ? e.message : "No se pudieron guardar los cambios." };
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="vista">
    <nav class="ruta" aria-label="Ruta de navegación">
      <RouterLink to="/inventario">Inventario</RouterLink><span aria-hidden="true">/</span>
      <RouterLink v-if="equipo" :to="{ name: 'ficha-equipo', params: { id } }" class="serie">{{ equipo.numeroSerie }}</RouterLink>
      <span aria-hidden="true">/</span><span>Editar datos</span>
    </nav>
    <h1 class="titulo-pagina">Editar datos del equipo</h1>
    <p v-if="error" class="aviso-error">{{ error }}</p>
    <p v-else-if="equipo && equipo.estado === 'BAJA'" class="aviso-error">Este equipo está dado de baja y ya no se puede modificar.</p>
    <FormularioEquipo
      v-else-if="equipo" modo="edicion" :inicial="inicial"
      :errores-servidor="erroresServidor" :enviando="enviando"
      @enviar="guardar" @cancelar="router.push({ name: 'ficha-equipo', params: { id } })"
    />
    <p v-else class="subtitulo">Cargando…</p>
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 18px; }
</style>
