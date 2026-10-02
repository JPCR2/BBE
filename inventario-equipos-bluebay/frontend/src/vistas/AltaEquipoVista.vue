<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ErrorApi } from "../api/cliente";
import { registrarEquipo, urlReporteAlta, type DatosEquipo, type FichaEquipo } from "../api/equipos";
import FormularioEquipo from "../componentes/FormularioEquipo.vue";
import Icono from "../componentes/Icono.vue";
import { mostrarAviso } from "../composables/useAvisos";

const router = useRouter();
const enviando = ref(false);
const erroresServidor = ref<Record<string, string>>({});
const registrado = ref<FichaEquipo | null>(null);
const claveFormulario = ref(0);

async function guardar(datos: DatosEquipo) {
  enviando.value = true;
  try {
    registrado.value = await registrarEquipo(datos);
    mostrarAviso(`Equipo registrado: ${registrado.value.numeroSerie}.`);
  } catch (e) {
    erroresServidor.value =
      e instanceof ErrorApi && Object.keys(e.campos).length > 0
        ? e.campos
        : { _: e instanceof Error ? e.message : "No se pudo registrar el equipo." };
  } finally {
    enviando.value = false;
  }
}

function registrarOtro() {
  registrado.value = null;
  erroresServidor.value = {};
  claveFormulario.value++;
}
</script>

<template>
  <div class="vista">
    <nav class="ruta" aria-label="Ruta de navegación">
      <RouterLink to="/inventario">Inventario</RouterLink><span aria-hidden="true">/</span><span>Registrar equipo</span>
    </nav>
    <div class="encabezado-pagina">
      <div>
        <h1 class="titulo-pagina">Registrar equipo</h1>
        <p class="subtitulo">Los campos con * son obligatorios. El equipo queda como Activo y sin asignar.</p>
      </div>
    </div>

    <FormularioEquipo
      v-if="!registrado" :key="claveFormulario" modo="alta"
      :errores-servidor="erroresServidor" :enviando="enviando"
      @enviar="guardar" @cancelar="router.push('/inventario')"
    />

    <section v-else class="tarjeta exito" role="status">
      <span class="marca-exito"><Icono nombre="hecho" :tamano="28" :grosor="2.25" /></span>
      <h2>Equipo registrado</h2>
      <p>
        <span class="serie">{{ registrado.numeroSerie }}</span> · {{ registrado.marca }} {{ registrado.modelo }}
        ya aparece en el inventario como Activo y sin asignar.
      </p>
      <p class="consejo">
        ¿Llegaron varios equipos en la misma factura? Regístralos todos y luego, en Inventario → «Reporte de alta»,
        busca el folio <span class="serie">{{ registrado.folioFactura }}</span> para imprimirlos juntos.
      </p>
      <div class="acciones">
        <a :href="urlReporteAlta([registrado.id])" target="_blank" rel="noopener" class="boton boton-primario">
          <Icono nombre="imprimir" :tamano="18" />Imprimir reporte de alta
        </a>
        <RouterLink :to="{ name: 'ficha-equipo', params: { id: registrado.id } }" class="boton boton-secundario">Ver ficha del equipo</RouterLink>
        <button type="button" class="boton boton-secundario" @click="registrarOtro">Registrar otro equipo</button>
        <RouterLink to="/inventario" class="boton boton-secundario">Ir al inventario</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 18px; }
.exito { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; max-width: 920px; padding: 32px; }
.exito h2 { margin: 0; font-family: var(--fuente-titulo); font-weight: 600; font-size: 28px; }
.exito p { margin: 0; font-size: 16px; color: var(--texto-2); }
.exito .consejo { font-size: 14px; }
.marca-exito { width: 52px; height: 52px; border-radius: 26px; display: flex; align-items: center; justify-content: center; background: var(--exito-fondo); color: var(--exito); }
.acciones { display: flex; flex-wrap: wrap; gap: 12px; padding-top: 6px; }
</style>
