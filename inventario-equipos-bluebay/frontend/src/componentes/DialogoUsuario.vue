<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { ETIQUETAS_ROL, type RolUsuario } from "../api/autenticacion";
import { ErrorApi } from "../api/cliente";
import { crearUsuario, editarUsuario, type CambiosUsuario, type Usuario } from "../api/usuarios";
import { errorContrasenaNueva, errorNombreUsuario, MINIMO_CONTRASENA, sugerirUsuario } from "../utilidades/contrasena";
import CampoContrasena from "./CampoContrasena.vue";
import Icono from "./Icono.vue";

/** Alta (sin `usuario`) o edición de un usuario del sistema. */
const props = defineProps<{ usuario?: Usuario; esUnoMismo?: boolean }>();
const emit = defineEmits<{ cerrar: []; guardado: [usuario: Usuario] }>();

const edicion = computed(() => props.usuario !== undefined);
const dialogo = ref<HTMLDialogElement>();
const formulario = ref<HTMLFormElement>();

const datos = reactive({
  nombre: props.usuario?.nombre ?? "",
  usuario: props.usuario?.usuario ?? "",
  rol: (props.usuario?.rol ?? "TECNICO") as RolUsuario,
  contrasena: "",
});
const errores = ref<Record<string, string | undefined>>({});
const error = ref("");
const enviando = ref(false);

const DESCRIPCION_ROL: Record<RolUsuario, string> = {
  TECNICO: "Inventario, empleados, asignaciones, mantenimiento y bajas.",
  ADMIN: "Todo lo del técnico y además crear, editar y desactivar usuarios.",
};

onMounted(() => {
  dialogo.value?.showModal();
  formulario.value?.querySelector<HTMLInputElement>("#nombre-usuario")?.focus();
});

// En el alta, el usuario se sugiere a partir del nombre hasta que lo escriban a mano.
let usuarioEscritoAMano = false;
watch(() => datos.nombre, (nombre) => {
  delete errores.value.nombre;
  if (!edicion.value && !usuarioEscritoAMano) datos.usuario = sugerirUsuario(nombre);
});
function alEscribirUsuario() {
  usuarioEscritoAMano = datos.usuario !== "";
  delete errores.value.usuario;
}
watch(() => datos.contrasena, () => delete errores.value.contrasena);

async function enfocarPrimerError() {
  await nextTick();
  formulario.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

function validar(): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  if (datos.nombre.trim() === "") e.nombre = "Escribe el nombre completo.";
  else if (datos.nombre.trim().length > 100) e.nombre = "Máximo 100 caracteres.";
  if (!edicion.value) {
    e.usuario = errorNombreUsuario(datos.usuario.trim().toLowerCase());
    e.contrasena = errorContrasenaNueva(datos.contrasena);
  }
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v));
}

async function guardar() {
  if (enviando.value) return;
  error.value = "";
  errores.value = validar();
  if (Object.keys(errores.value).length > 0) return enfocarPrimerError();

  enviando.value = true;
  try {
    let guardado: Usuario;
    if (props.usuario) {
      const cambios: CambiosUsuario = {};
      if (datos.nombre.trim() !== props.usuario.nombre) cambios.nombre = datos.nombre.trim();
      if (datos.rol !== props.usuario.rol) cambios.rol = datos.rol;
      if (Object.keys(cambios).length === 0) return emit("cerrar");
      guardado = await editarUsuario(props.usuario.id, cambios);
    } else {
      guardado = await crearUsuario({ nombre: datos.nombre.trim(), usuario: datos.usuario.trim().toLowerCase(), rol: datos.rol, contrasena: datos.contrasena });
    }
    emit("guardado", guardado);
  } catch (e) {
    if (e instanceof ErrorApi && Object.keys(e.campos).some((c) => c !== "_")) {
      errores.value = { ...e.campos };
      await enfocarPrimerError();
    } else {
      error.value = e instanceof ErrorApi ? e.message : "No se pudo guardar el usuario.";
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <dialog ref="dialogo" class="dialogo" aria-labelledby="titulo-dialogo-usuario" @close="emit('cerrar')" @cancel="emit('cerrar')">
    <form ref="formulario" novalidate @submit.prevent="guardar">
      <div class="dialogo-encabezado">
        <h2 id="titulo-dialogo-usuario">{{ edicion ? "Editar usuario" : "Nuevo usuario" }}</h2>
        <button type="button" class="dialogo-cerrar" aria-label="Cerrar" @click="emit('cerrar')"><Icono nombre="cerrar" /></button>
      </div>

      <div class="campo">
        <label for="nombre-usuario">Nombre completo *</label>
        <input id="nombre-usuario" v-model="datos.nombre" class="entrada" maxlength="100" autocomplete="off" placeholder="p. ej. Joel Polanco Cruz" :aria-invalid="!!errores.nombre" :aria-describedby="errores.nombre ? 'error-nombre-usuario' : undefined">
        <span v-if="errores.nombre" id="error-nombre-usuario" class="campo-error">{{ errores.nombre }}</span>
      </div>

      <div class="campo">
        <label for="usuario-usuario">Usuario para entrar {{ edicion ? "" : "*" }}</label>
        <input
          id="usuario-usuario" v-model="datos.usuario" class="entrada entrada-mono" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false"
          :readonly="edicion" :aria-invalid="!!errores.usuario" :aria-describedby="errores.usuario ? 'error-usuario-usuario' : 'ayuda-usuario-usuario'"
          @input="alEscribirUsuario"
        >
        <span v-if="errores.usuario" id="error-usuario-usuario" class="campo-error">{{ errores.usuario }}</span>
        <span v-else id="ayuda-usuario-usuario" class="campo-ayuda">
          {{ edicion ? "El usuario no se puede cambiar." : "Minúsculas sin acentos ni espacios; puede llevar punto o guion." }}
        </span>
      </div>

      <fieldset class="campo roles" :disabled="esUnoMismo">
        <legend>Rol *</legend>
        <label v-for="rol in (['TECNICO', 'ADMIN'] as const)" :key="rol" class="opcion-rol" :class="{ elegida: datos.rol === rol }">
          <input v-model="datos.rol" type="radio" name="rol" :value="rol">
          <span>
            <strong>{{ ETIQUETAS_ROL[rol] }}</strong>
            <small>{{ DESCRIPCION_ROL[rol] }}</small>
          </span>
        </label>
        <span v-if="esUnoMismo" class="campo-ayuda">No puedes cambiar tu propio rol; pídeselo a otro administrador.</span>
        <span v-if="errores.rol" class="campo-error">{{ errores.rol }}</span>
      </fieldset>

      <CampoContrasena
        v-if="!edicion"
        id="contrasena-usuario"
        v-model="datos.contrasena"
        etiqueta="Contraseña inicial *"
        autocomplete="new-password"
        :error="errores.contrasena"
        :ayuda="`Mínimo ${MINIMO_CONTRASENA} caracteres. Dásela en persona; después podrá cambiarla desde su menú.`"
      />

      <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>
      <div class="dialogo-acciones">
        <button type="button" class="boton boton-secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" class="boton boton-primario" :disabled="enviando">
          {{ enviando ? "Guardando…" : edicion ? "Guardar cambios" : "Crear usuario" }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.roles { margin: 0; padding: 0; border: 0; min-width: 0; }
.roles legend { padding: 0; margin-bottom: 6px; font-size: 14px; font-weight: 600; }
.opcion-rol {
  display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px;
  border: 1px solid var(--borde-fuerte); border-radius: var(--radio); cursor: pointer;
}
.opcion-rol + .opcion-rol { margin-top: 8px; }
.opcion-rol.elegida { border: 2px solid var(--primario); background: var(--primario-tenue); padding: 11px 13px; }
.opcion-rol input { margin-top: 3px; accent-color: var(--primario); width: 18px; height: 18px; }
.opcion-rol span { display: flex; flex-direction: column; gap: 2px; }
.opcion-rol small { font-size: 13px; color: var(--texto-2); }
.roles:disabled .opcion-rol { cursor: not-allowed; opacity: 0.7; }
.entrada[readonly] { background: var(--superficie-suave); color: var(--texto-2); }
</style>
