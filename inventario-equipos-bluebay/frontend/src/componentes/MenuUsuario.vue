<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { cerrarSesion, ETIQUETAS_ROL } from "../api/autenticacion";
import { ErrorApi } from "../api/cliente";
import { mostrarAviso } from "../composables/useAvisos";
import { establecerUsuario, inicialesDe, sesion } from "../composables/useSesion";
import DialogoCambiarContrasena from "./DialogoCambiarContrasena.vue";
import Icono from "./Icono.vue";

const router = useRouter();
const abierto = ref(false);
const cambiando = ref(false);
const saliendo = ref(false);
const contenedor = ref<HTMLElement>();
const boton = ref<HTMLButtonElement>();

function alternar() {
  abierto.value = !abierto.value;
  if (abierto.value) nextTick(() => contenedor.value?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
}

function cerrar(regresarFoco = false) {
  abierto.value = false;
  if (regresarFoco) boton.value?.focus();
}

/** Cierra el menú al hacer clic fuera de él. */
function alHacerClic(evento: MouseEvent) {
  if (abierto.value && !contenedor.value?.contains(evento.target as Node)) cerrar();
}
document.addEventListener("click", alHacerClic);
onBeforeUnmount(() => document.removeEventListener("click", alHacerClic));

/** Flechas arriba/abajo para moverse entre las opciones. */
function mover(paso: number) {
  const opciones = [...(contenedor.value?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const actual = opciones.indexOf(document.activeElement as HTMLElement);
  opciones[(actual + paso + opciones.length) % opciones.length]?.focus();
}

function abrirCambioContrasena() {
  cerrar();
  cambiando.value = true;
}

async function salir() {
  saliendo.value = true;
  try {
    await cerrarSesion();
    establecerUsuario(null);
    cerrar();
    await router.push({ name: "iniciar-sesion" });
    mostrarAviso("Cerraste sesión.");
  } catch (error) {
    // Si no se pudo avisar al servidor, la sesión sigue abierta: mejor decirlo.
    mostrarAviso(error instanceof ErrorApi ? `No se pudo cerrar la sesión: ${error.message}` : "No se pudo cerrar la sesión.", "error");
  } finally {
    saliendo.value = false;
  }
}
</script>

<template>
  <div v-if="sesion.usuario" ref="contenedor" class="menu-usuario" @keydown.esc="cerrar(true)">
    <button
      ref="boton"
      type="button"
      class="disparador"
      aria-haspopup="menu"
      :aria-expanded="abierto"
      aria-controls="opciones-usuario"
      @click.stop="alternar"
    >
      <span class="avatar" aria-hidden="true">{{ inicialesDe(sesion.usuario.nombre) }}</span>
      <span class="datos">
        <span class="nombre">{{ sesion.usuario.nombre }}</span>
        <span class="rol">{{ ETIQUETAS_ROL[sesion.usuario.rol] }}</span>
      </span>
      <Icono nombre="abajo" :tamano="16" />
    </button>
    <div v-show="abierto" id="opciones-usuario" class="opciones" role="menu" aria-label="Opciones de tu usuario" @keydown.down.prevent="mover(1)" @keydown.up.prevent="mover(-1)">
      <p class="cuenta">Usuario: <strong>{{ sesion.usuario.usuario }}</strong></p>
      <button type="button" role="menuitem" class="opcion" @click="abrirCambioContrasena">
        <Icono nombre="candado" :tamano="18" />Cambiar mi contraseña
      </button>
      <button type="button" role="menuitem" class="opcion" :disabled="saliendo" @click="salir">
        <Icono nombre="salir" :tamano="18" />{{ saliendo ? "Cerrando sesión…" : "Cerrar sesión" }}
      </button>
    </div>
    <DialogoCambiarContrasena v-if="cambiando" @cerrar="cambiando = false" />
  </div>
</template>

<style scoped>
.menu-usuario { position: relative; flex-shrink: 0; }
.disparador {
  display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 10px 4px 4px;
  border: 1px solid transparent; border-radius: 24px; background: transparent; font: inherit; color: var(--tinta); cursor: pointer;
}
.disparador:hover, .disparador[aria-expanded="true"] { background: var(--superficie-suave); border-color: var(--borde); }
.datos { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2; }
.nombre { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.rol { font-size: 12px; color: var(--texto-2); }
.opciones {
  position: absolute; right: 0; top: 52px; z-index: 30; min-width: 240px; padding: 6px;
  display: flex; flex-direction: column;
  background: var(--superficie); border: 1px solid var(--borde); border-radius: 10px; box-shadow: var(--sombra-flotante);
}
.cuenta { margin: 0; padding: 8px 12px 10px; border-bottom: 1px solid var(--linea); font-size: 13px; color: var(--texto-2); }
.cuenta strong { font-family: var(--fuente-mono); font-weight: 500; color: var(--tinta); }
.opcion {
  display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; margin-top: 4px;
  border: 0; border-radius: var(--radio); background: transparent; font: inherit; font-size: 14px; text-align: left; color: var(--tinta); cursor: pointer;
}
.opcion:hover:not(:disabled), .opcion:focus-visible { background: var(--primario-tenue); }
.opcion:disabled { cursor: wait; opacity: 0.6; }

@media (max-width: 900px) {
  .datos, .disparador > svg { display: none; }
  .disparador { padding: 4px; }
}
</style>
