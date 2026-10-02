<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import logoBlueBay from "../activos/logo-blue-bay.png";
import { iniciarSesion } from "../api/autenticacion";
import { ErrorApi } from "../api/cliente";
import Icono from "../componentes/Icono.vue";
import { destinoSeguro, establecerUsuario } from "../composables/useSesion";

const ruta = useRoute();
const router = useRouter();

const datos = reactive({ usuario: "", contrasena: "" });
const errores = ref<{ usuario?: string; contrasena?: string }>({});
const error = ref("");
const enviando = ref(false);
const verContrasena = ref(false);
const mayusculas = ref(false);
const campoUsuario = ref<HTMLInputElement>();
const campoContrasena = ref<HTMLInputElement>();

onMounted(() => campoUsuario.value?.focus());
watch(() => datos.usuario, () => delete errores.value.usuario);
watch(() => datos.contrasena, () => delete errores.value.contrasena);

/** Avisa si Bloq Mayús está activo: es la causa más común de "contraseña incorrecta". */
function revisarMayusculas(evento: KeyboardEvent) {
  if (typeof evento.getModifierState === "function") mayusculas.value = evento.getModifierState("CapsLock");
}

async function entrar() {
  // Enter dos veces seguidas envía el formulario aunque el botón esté desactivado.
  if (enviando.value) return;
  error.value = "";
  const faltan: typeof errores.value = {};
  if (datos.usuario.trim() === "") faltan.usuario = "Escribe tu usuario.";
  if (datos.contrasena === "") faltan.contrasena = "Escribe tu contraseña.";
  errores.value = faltan;
  if (faltan.usuario) return campoUsuario.value?.focus();
  if (faltan.contrasena) return campoContrasena.value?.focus();

  enviando.value = true;
  try {
    const { usuario } = await iniciarSesion(datos.usuario, datos.contrasena);
    establecerUsuario(usuario);
    await router.replace(destinoSeguro(ruta.query.redirigir));
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudo iniciar sesión. Inténtalo de nuevo.";
    if (e instanceof ErrorApi && e.codigo === "DATOS_INVALIDOS") errores.value = e.campos;
    // Tras un intento fallido se borra la contraseña para volver a escribirla.
    if (e instanceof ErrorApi && ["CREDENCIALES_INVALIDAS", "USUARIO_BLOQUEADO"].includes(e.codigo)) {
      datos.contrasena = "";
      await nextTick();
      campoContrasena.value?.focus();
    }
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="pantalla-login">
    <section class="marca" aria-hidden="true">
      <img :src="logoBlueBay" alt="" class="logo" width="360" height="137">
      <p class="sistema">Sistemas · Equipos de cómputo</p>
      <p class="lema">Inventario, asignaciones, mantenimiento y bajas del hotel en un solo lugar.</p>
    </section>

    <main class="lado-formulario">
      <form class="tarjeta-login" novalidate aria-labelledby="titulo-login" @submit.prevent="entrar">
        <div class="encabezado-login">
          <span class="sello"><Icono nombre="candado" :tamano="22" /></span>
          <h1 id="titulo-login">Iniciar sesión</h1>
          <p>Entra con el usuario que te dio el Departamento de Sistemas.</p>
        </div>

        <p v-if="error" class="aviso-error" role="alert">{{ error }}</p>

        <div class="campo">
          <label for="usuario-login">Usuario</label>
          <input
            id="usuario-login"
            ref="campoUsuario"
            v-model="datos.usuario"
            class="entrada"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            maxlength="40"
            placeholder="p. ej. jpolanco"
            :aria-invalid="!!errores.usuario"
            :aria-describedby="errores.usuario ? 'error-usuario-login' : undefined"
          >
          <span v-if="errores.usuario" id="error-usuario-login" class="campo-error">{{ errores.usuario }}</span>
        </div>

        <div class="campo">
          <label for="contrasena-login">Contraseña</label>
          <div class="con-boton">
            <input
              id="contrasena-login"
              ref="campoContrasena"
              v-model="datos.contrasena"
              class="entrada"
              name="password"
              :type="verContrasena ? 'text' : 'password'"
              autocomplete="current-password"
              maxlength="200"
              :aria-invalid="!!errores.contrasena"
              :aria-describedby="[errores.contrasena ? 'error-contrasena-login' : '', mayusculas ? 'aviso-mayusculas' : ''].join(' ').trim() || undefined"
              @keydown="revisarMayusculas"
              @keyup="revisarMayusculas"
            >
            <button
              type="button"
              class="ver"
              :aria-pressed="verContrasena"
              :aria-label="verContrasena ? 'Ocultar contraseña' : 'Mostrar contraseña'"
              :title="verContrasena ? 'Ocultar contraseña' : 'Mostrar contraseña'"
              @click="verContrasena = !verContrasena"
            >
              <Icono :nombre="verContrasena ? 'ojo-cerrado' : 'ojo'" />
            </button>
          </div>
          <span v-if="errores.contrasena" id="error-contrasena-login" class="campo-error">{{ errores.contrasena }}</span>
          <span v-if="mayusculas" id="aviso-mayusculas" class="aviso-mayusculas">Bloq Mayús está activado.</span>
        </div>

        <button type="submit" class="boton boton-primario entrar" :disabled="enviando">
          {{ enviando ? "Entrando…" : "Entrar" }}
        </button>

        <p class="ayuda">¿Olvidaste tu contraseña? Pide a un administrador del sistema que te la restablezca.</p>
      </form>
    </main>
  </div>
</template>

<style scoped>
.pantalla-login { display: grid; grid-template-columns: minmax(320px, 44%) 1fr; min-height: 100vh; }
.marca {
  display: flex; flex-direction: column; justify-content: center; gap: 16px; padding: 48px 56px;
  background: var(--lateral); color: #E8EEF2;
}
.logo { width: min(320px, 100%); height: auto; }
.sistema { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lateral-tenue); }
.lema { margin: 12px 0 0; max-width: 34ch; font-family: var(--fuente-titulo); font-size: 26px; line-height: 1.3; color: #FFFFFF; }

.lado-formulario { display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
.tarjeta-login {
  display: flex; flex-direction: column; gap: 18px; width: min(420px, 100%); padding: 32px;
  background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-tarjeta);
}
.encabezado-login { display: flex; flex-direction: column; gap: 8px; }
.encabezado-login h1 { margin: 4px 0 0; font-family: var(--fuente-titulo); font-weight: 600; font-size: 32px; line-height: 1.1; }
.encabezado-login p { margin: 0; color: var(--texto-2); }
.sello {
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: 22px; background: var(--primario-suave); color: var(--primario);
}
.con-boton { position: relative; display: flex; }
.con-boton .entrada { flex: 1; padding-right: 52px; }
.ver {
  position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
  width: 44px; height: 40px; display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--radio); background: transparent; color: var(--texto-2); cursor: pointer;
}
.ver:hover { color: var(--tinta); }
.aviso-mayusculas { font-size: 13px; font-weight: 600; color: var(--alerta); }
.entrar { width: 100%; min-height: 48px; font-size: 16px; }
.ayuda { margin: 0; font-size: 13px; color: var(--texto-2); text-align: center; }

@media (max-width: 800px) {
  .pantalla-login { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .marca { padding: 24px; gap: 8px; }
  .logo { width: 180px; }
  .lema { display: none; }
  .lado-formulario { align-items: flex-start; padding: 24px 16px 40px; }
  .tarjeta-login { padding: 24px 20px; }
}
</style>
