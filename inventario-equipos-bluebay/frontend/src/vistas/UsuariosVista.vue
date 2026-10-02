<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ETIQUETAS_ROL } from "../api/autenticacion";
import { ErrorApi } from "../api/cliente";
import { editarUsuario, listarUsuarios, type Usuario } from "../api/usuarios";
import DialogoConfirmar from "../componentes/DialogoConfirmar.vue";
import DialogoRestablecerContrasena from "../componentes/DialogoRestablecerContrasena.vue";
import DialogoUsuario from "../componentes/DialogoUsuario.vue";
import Icono from "../componentes/Icono.vue";
import { mostrarAviso } from "../composables/useAvisos";
import { establecerUsuario, inicialesDe, sesion } from "../composables/useSesion";
import { fechaHora } from "../utilidades/formato";

const usuarios = ref<Usuario[]>([]);
const cargando = ref(true);
const error = ref("");

/** Diálogo abierto: alta, edición, restablecer contraseña o (des)activar. */
const dialogo = ref<
  | { tipo: "alta" }
  | { tipo: "edicion" | "restablecer" | "activar"; usuario: Usuario }
  | null
>(null);
const enviando = ref(false);
const errorConfirmar = ref("");

const activos = computed(() => usuarios.value.filter((u) => u.activo).length);
const esYo = (u: Usuario) => u.id === sesion.usuario?.id;

async function cargar() {
  cargando.value = true;
  error.value = "";
  try {
    usuarios.value = (await listarUsuarios()).datos;
  } catch (e) {
    error.value = e instanceof ErrorApi ? e.message : "No se pudo cargar la lista de usuarios.";
  } finally {
    cargando.value = false;
  }
}
onMounted(cargar);

function reemplazar(guardado: Usuario) {
  const indice = usuarios.value.findIndex((u) => u.id === guardado.id);
  if (indice === -1) usuarios.value.push(guardado);
  else usuarios.value[indice] = guardado;
  // Mismo orden que la API: activos primero y luego por nombre.
  usuarios.value.sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, "es"));
  // Si el administrador se corrige el nombre, el encabezado también cambia.
  if (esYo(guardado) && sesion.usuario) establecerUsuario({ ...sesion.usuario, nombre: guardado.nombre });
}

function alCrear(usuario: Usuario) {
  reemplazar(usuario);
  dialogo.value = null;
  mostrarAviso(`Usuario «${usuario.usuario}» creado. Ya puede iniciar sesión.`);
}

function alEditar(usuario: Usuario) {
  reemplazar(usuario);
  dialogo.value = null;
  mostrarAviso("Cambios guardados.");
}

function alRestablecer(usuario: Usuario) {
  reemplazar(usuario);
  dialogo.value = null;
  mostrarAviso(`Contraseña de «${usuario.usuario}» restablecida.`);
}

function pedirCambioDeEstado(usuario: Usuario) {
  errorConfirmar.value = "";
  dialogo.value = { tipo: "activar", usuario };
}

async function cambiarEstado() {
  if (enviando.value) return;
  if (dialogo.value?.tipo !== "activar") return;
  const { usuario } = dialogo.value;
  enviando.value = true;
  errorConfirmar.value = "";
  try {
    const guardado = await editarUsuario(usuario.id, { activo: !usuario.activo });
    reemplazar(guardado);
    dialogo.value = null;
    mostrarAviso(guardado.activo ? `«${guardado.usuario}» puede volver a entrar.` : `«${guardado.usuario}» ya no puede entrar al sistema.`);
  } catch (e) {
    errorConfirmar.value = e instanceof ErrorApi ? e.message : "No se pudo guardar el cambio.";
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="vista">
    <div class="encabezado-pagina">
      <div>
        <h1 class="titulo-pagina">Usuarios</h1>
        <p class="subtitulo">Quién puede entrar al sistema. Esta sección solo la ven los administradores.</p>
      </div>
      <button type="button" class="boton boton-primario" @click="dialogo = { tipo: 'alta' }">
        <Icono nombre="mas" :tamano="18" :grosor="2" />Nuevo usuario
      </button>
    </div>

    <p v-if="error" class="aviso-error" role="alert">
      {{ error }} <button type="button" class="boton-enlace" @click="cargar">Reintentar</button>
    </p>

    <div class="contenedor-tabla">
      <table class="tabla" aria-label="Usuarios del sistema" :aria-busy="cargando">
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Usuario</th>
            <th scope="col">Rol</th>
            <th scope="col">Estado</th>
            <th scope="col">Último acceso</th>
            <th scope="col"><span class="oculto-visual">Acciones</span></th>
          </tr>
        </thead>
        <tbody v-if="usuarios.length > 0">
          <tr v-for="u in usuarios" :key="u.id" :class="{ apagado: !u.activo }">
            <td>
              <span class="persona">
                <span class="avatar" aria-hidden="true">{{ inicialesDe(u.nombre) }}</span>
                <span>{{ u.nombre }}</span>
                <span v-if="esYo(u)" class="insignia insignia-primaria">Tú</span>
              </span>
            </td>
            <td class="serie">{{ u.usuario }}</td>
            <td>{{ ETIQUETAS_ROL[u.rol] }}</td>
            <td>
              <span v-if="!u.activo" class="insignia insignia-neutra">Inactivo</span>
              <span v-else-if="u.bloqueado" class="insignia insignia-peligro" :title="`Bloqueado hasta ${fechaHora(u.bloqueadoHasta)}`">Bloqueado</span>
              <span v-else class="insignia insignia-exito">Activo</span>
            </td>
            <td>{{ u.ultimoAcceso ? fechaHora(u.ultimoAcceso) : "Nunca ha entrado" }}</td>
            <td class="acciones">
              <button type="button" class="boton boton-secundario chico" :aria-label="`Editar a ${u.nombre}`" @click="dialogo = { tipo: 'edicion', usuario: u }">
                <Icono nombre="editar" :tamano="16" />Editar
              </button>
              <template v-if="!esYo(u)">
                <button type="button" class="boton boton-secundario chico" :aria-label="`Restablecer la contraseña de ${u.nombre}`" @click="dialogo = { tipo: 'restablecer', usuario: u }">
                  <Icono nombre="llave" :tamano="16" />{{ u.bloqueado ? "Desbloquear" : "Contraseña" }}
                </button>
                <button
                  type="button" class="boton chico" :class="u.activo ? 'boton-peligro' : 'boton-secundario'"
                  :aria-label="`${u.activo ? 'Desactivar' : 'Reactivar'} a ${u.nombre}`"
                  @click="pedirCambioDeEstado(u)"
                >
                  {{ u.activo ? "Desactivar" : "Reactivar" }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="cargando && usuarios.length === 0" class="estado-vacio">Cargando usuarios…</p>
      <div class="pie-tabla">{{ activos }} {{ activos === 1 ? "usuario activo" : "usuarios activos" }} de {{ usuarios.length }}</div>
    </div>

    <section class="tarjeta roles" aria-labelledby="titulo-roles">
      <h2 id="titulo-roles">¿Qué puede hacer cada rol?</h2>
      <dl>
        <dt>Técnico</dt>
        <dd>Inventario, empleados, asignaciones, mantenimiento y bajas.</dd>
        <dt>Administrador</dt>
        <dd>Todo lo del técnico y además crear, editar y desactivar usuarios.</dd>
      </dl>
      <p class="subtitulo">Los usuarios no se borran: se desactivan, para conservar el historial. Tras 5 contraseñas incorrectas seguidas, el usuario se bloquea 15 minutos; para desbloquearlo antes, restablece su contraseña.</p>
    </section>

    <DialogoUsuario v-if="dialogo?.tipo === 'alta'" @cerrar="dialogo = null" @guardado="alCrear" />
    <DialogoUsuario v-if="dialogo?.tipo === 'edicion'" :usuario="dialogo.usuario" :es-uno-mismo="esYo(dialogo.usuario)" @cerrar="dialogo = null" @guardado="alEditar" />
    <DialogoRestablecerContrasena v-if="dialogo?.tipo === 'restablecer'" :usuario="dialogo.usuario" @cerrar="dialogo = null" @guardado="alRestablecer" />
    <DialogoConfirmar
      v-if="dialogo?.tipo === 'activar'"
      :titulo="dialogo.usuario.activo ? 'Desactivar usuario' : 'Reactivar usuario'"
      :mensaje="dialogo.usuario.activo
        ? `${dialogo.usuario.nombre} ya no podrá entrar al sistema y se cerrarán sus sesiones abiertas. Su historial se conserva y puedes reactivarlo cuando quieras.`
        : `${dialogo.usuario.nombre} podrá volver a entrar con su contraseña de antes.`"
      :texto-confirmar="dialogo.usuario.activo ? 'Desactivar' : 'Reactivar'"
      :peligro="dialogo.usuario.activo"
      :enviando="enviando"
      :error="errorConfirmar"
      @confirmar="cambiarEstado"
      @cerrar="dialogo = null"
    />
  </div>
</template>

<style scoped>
.vista { display: flex; flex-direction: column; gap: 24px; }
.persona { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.apagado td { color: var(--texto-2); }
.apagado .avatar { background: var(--neutro-fondo); color: var(--texto-2); }
.acciones { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.chico { min-height: 36px; padding: 0 12px; font-size: 14px; gap: 6px; }
.roles dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 12px; }
.roles dt { font-weight: 700; }
.roles dd { margin: 0; }
.contenedor-tabla { overflow-x: auto; }
@media (max-width: 700px) {
  .roles dl { grid-template-columns: 1fr; }
  .roles dd { margin-bottom: 8px; }
}
</style>
