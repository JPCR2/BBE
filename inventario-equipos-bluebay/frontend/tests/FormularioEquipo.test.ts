import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import FormularioEquipo from "../src/componentes/FormularioEquipo.vue";

afterEach(() => vi.useRealTimers());

const montar = (props = {}) => mount(FormularioEquipo, { props: { modo: "alta", ...props }, attachTo: document.body });

describe("FormularioEquipo", () => {
  it("al enviar vacío muestra los errores junto a cada campo y no envía nada", async () => {
    const envoltura = montar();
    await envoltura.find("form").trigger("submit");
    expect(envoltura.find("#error-numeroSerie").text()).toBe("Escribe el número de serie.");
    expect(envoltura.find("#error-tipo").exists()).toBe(true);
    expect(envoltura.find("#error-marca").exists()).toBe(true);
    expect(envoltura.find("#error-modelo").exists()).toBe(true);
    expect(envoltura.find("#numeroSerie").attributes("aria-invalid")).toBe("true");
    expect(envoltura.emitted("enviar")).toBeUndefined();
    envoltura.unmount();
  });

  it("muestra cómo se guardará el número de serie mientras se escribe", async () => {
    const envoltura = montar();
    await envoltura.find("#numeroSerie").setValue("demo sn 0007");
    expect(envoltura.find("#ayuda-serie").text()).toBe("Se guardará como DEMOSN0007");
    envoltura.unmount();
  });

  it("envía los datos con el costo limpio cuando todo es válido", async () => {
    const envoltura = montar();
    await envoltura.find("#numeroSerie").setValue("ABC-1");
    await envoltura.find("#tipo").setValue("LAPTOP");
    await envoltura.find("#marca").setValue("Dell");
    await envoltura.find("#modelo").setValue("Latitude 5440");
    await envoltura.find("#costo").setValue("$21,500.00");
    await envoltura.find("#folioFactura").setValue("FAC-A-10234");
    await envoltura.find("#fechaVencimientoGarantia").setValue("2027-03-15");
    await envoltura.find("form").trigger("submit");
    expect(envoltura.emitted("enviar")?.[0]?.[0]).toMatchObject({
      numeroSerie: "ABC-1", tipo: "LAPTOP", costo: "21500.00", folioFactura: "FAC-A-10234", fechaVencimientoGarantia: "2027-03-15",
    });
    envoltura.unmount();
  });

  it("muestra los errores que devuelve la API y los quita al corregir el campo", async () => {
    const envoltura = montar();
    await envoltura.setProps({ erroresServidor: { numeroSerie: "Ya existe un equipo con el número de serie ABC-1." } });
    expect(envoltura.find("#error-numeroSerie").text()).toBe("Ya existe un equipo con el número de serie ABC-1.");
    await envoltura.find("#numeroSerie").setValue("ABC-2");
    expect(envoltura.find("#error-numeroSerie").exists()).toBe(false);
    envoltura.unmount();
  });

  it("en modo edición muestra el selector de estado con los valores actuales", () => {
    const envoltura = montar({ modo: "edicion", inicial: { numeroSerie: "X-1", estado: "EN_MANTENIMIENTO" } });
    expect((envoltura.find("#estado").element as HTMLSelectElement).value).toBe("EN_MANTENIMIENTO");
    expect(envoltura.find("button[type=submit]").text()).toBe("Guardar cambios");
    envoltura.unmount();
  });

  it("en un alta pide el folio de factura y la garantía, y usa la etiqueta Service Tag", async () => {
    const envoltura = montar();
    expect(envoltura.find("label[for=numeroSerie]").text()).toBe("Número de serie / Service Tag *");
    expect(envoltura.find("label[for=folioFactura]").text()).toBe("Folio de factura *");
    await envoltura.find("form").trigger("submit");
    expect(envoltura.find("#error-folioFactura").text()).toBe("Escribe el folio de la factura.");
    expect(envoltura.find("#error-fechaVencimientoGarantia").text()).toBe("Elige la fecha en que vence la garantía.");
    envoltura.unmount();
  });

  it("los botones de garantía cuentan desde la adquisición, o desde hoy si no hay", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T16:00:00Z"));
    const envoltura = montar();
    const garantia = () => (envoltura.find("#fechaVencimientoGarantia").element as HTMLInputElement).value;
    const botones = envoltura.findAll(".rapidos-garantia button");
    expect(botones.map((b) => b.text())).toEqual(["1 año", "2 años", "3 años"]);

    await botones[0]!.trigger("click");
    expect(garantia()).toBe("2027-09-23");
    expect(envoltura.find("#ayuda-garantia").text()).toBe("Los botones cuentan desde hoy.");

    await envoltura.find("#fechaAdquisicion").setValue("2026-03-15");
    await botones[2]!.trigger("click");
    expect(garantia()).toBe("2029-03-15");
    expect(envoltura.find("#ayuda-garantia").text()).toBe("Los botones cuentan desde la adquisición (15/03/2026).");
    expect(envoltura.find("#fechaVencimientoGarantia").attributes("min")).toBe("2026-03-15");
    envoltura.unmount();
  });

  it("avisa si la garantía vence antes de la compra", async () => {
    const envoltura = montar({ inicial: { numeroSerie: "A", tipo: "LAPTOP", marca: "Dell", modelo: "X", folioFactura: "F-1", fechaAdquisicion: "2026-03-15", fechaVencimientoGarantia: "2026-03-01" } });
    await envoltura.find("form").trigger("submit");
    expect(envoltura.find("#error-fechaVencimientoGarantia").text()).toBe("La garantía no puede vencer antes de la fecha de adquisición.");
    expect(envoltura.emitted("enviar")).toBeUndefined();
    envoltura.unmount();
  });

  it("al editar un equipo antiguo, el folio y la garantía no son obligatorios", async () => {
    const envoltura = montar({ modo: "edicion", inicial: { numeroSerie: "VIEJO-1", tipo: "MONITOR", marca: "Samsung", modelo: "S24", estado: "ACTIVO" } });
    expect(envoltura.find("label[for=folioFactura]").text()).toBe("Folio de factura");
    await envoltura.find("form").trigger("submit");
    expect(envoltura.emitted("enviar")?.[0]?.[0]).toMatchObject({ numeroSerie: "VIEJO-1", folioFactura: "", fechaVencimientoGarantia: "" });
    envoltura.unmount();
  });
});
