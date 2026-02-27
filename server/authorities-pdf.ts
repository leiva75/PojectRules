import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  TIMEZONE,
  ensureDateUTC,
  formatDateES,
  formatTimeES,
  formatDateTimeES,
  toSpainDateKey,
} from "./timezone";

let cachedLogoBuffer: Buffer | null = null;
let logoLoadAttempted = false;

function getLogoBuffer(): Buffer | null {
  if (logoLoadAttempted) return cachedLogoBuffer;
  logoLoadAttempted = true;
  try {
    const possiblePaths = [
      path.join(process.cwd(), "server", "assets", "logo.png"),
      path.join(process.cwd(), "client", "src", "assets", "logo-cronos.png"),
    ];
    for (const logoPath of possiblePaths) {
      if (fs.existsSync(logoPath)) {
        cachedLogoBuffer = fs.readFileSync(logoPath);
        return cachedLogoBuffer;
      }
    }
  } catch (error) {
    console.warn("[AUTH-PDF] Could not load logo:", error);
  }
  return null;
}

const COLORS = {
  navyDark: "#0f172a",
  navyMedium: "#1e3a5f",
  navyLight: "#334155",
  textPrimary: "#0f172a",
  textSecondary: "#374151",
  textMuted: "#6b7280",
  zebraLight: "#dce5f0",
  zebraWhite: "#ffffff",
  borderLight: "#94a3b8",
  borderRow: "#cbd5e1",
  white: "#ffffff",
  headerBg: "#e8f0f8",
  incidencia: "#b91c1c",
  incidenciaBg: "#fef2f2",
  correctionYes: "#d97706",
  pauseOk: "#15803d",
  pauseMissing: "#b91c1c",
};

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export interface RawPunch {
  id: string;
  employeeId: string;
  type: string;
  timestamp: Date | string;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
  signatureData: string | null;
  signatureSha256: string | null;
  signatureSignedAt: Date | string | null;
  source: string | null;
  isAuto: boolean | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface CorrectionRecord {
  originalPunchId: string;
  originalTimestamp: Date | string;
  originalType: string;
  newTimestamp: Date | string | null;
  newType: string | null;
  reason: string;
  correctedByName: string;
  correctionDate: Date | string;
  employeeId: string;
  employeeName: string;
}

export interface AuthoritiesReportOptions {
  scope: "month" | "year";
  year: number;
  month?: number;
  includeAnnexes: boolean;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  punches: RawPunch[];
  corrections: CorrectionRecord[];
}

interface DayRecord {
  dateKey: string;
  horaInicio: string;
  horaFin: string;
  totalMinutes: number;
  totalFormatted: string;
  pauseTaken: boolean;
  hasFirma: boolean;
  incidencias: string[];
  hasCorrection: boolean;
  hasSinSalida: boolean;
}

interface EmployeeSection {
  employeeId: string;
  fullName: string;
  days: DayRecord[];
  totalMinutes: number;
}

function formatDurationHHMM(minutes: number): string {
  if (minutes <= 0) return "00:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function formatDateKeyES(dateKey: string): string {
  const [y, mo, d] = dateKey.split("-");
  return `${d}/${mo}/${y}`;
}

function hasPunchSignature(punch: RawPunch): boolean {
  return !!(punch.signatureSha256 || punch.signatureData || punch.signatureSignedAt);
}

function processPunches(
  punches: RawPunch[],
  corrections: CorrectionRecord[]
): EmployeeSection[] {
  const correctionsByPunchId = new Set<string>();
  for (const c of corrections) {
    correctionsByPunchId.add(c.originalPunchId);
  }

  const employeeMap = new Map<
    string,
    {
      name: string;
      dayMap: Map<
        string,
        { inPunches: RawPunch[]; outPunches: RawPunch[]; hasBreak: boolean; hasFirma: boolean; punchIds: string[] }
      >;
    }
  >();

  for (const punch of punches) {
    const empId = punch.employeeId;
    const ts = ensureDateUTC(punch.timestamp);
    if (!ts) continue;

    if (!employeeMap.has(empId)) {
      employeeMap.set(empId, {
        name: `${punch.employee.lastName}, ${punch.employee.firstName}`,
        dayMap: new Map(),
      });
    }

    const emp = employeeMap.get(empId)!;
    const dateKey = toSpainDateKey(ts);

    if (!emp.dayMap.has(dateKey)) {
      emp.dayMap.set(dateKey, { inPunches: [], outPunches: [], hasBreak: false, hasFirma: false, punchIds: [] });
    }

    const day = emp.dayMap.get(dateKey)!;
    day.punchIds.push(punch.id);
    if (hasPunchSignature(punch)) {
      day.hasFirma = true;
    }

    if (punch.type === "BREAK_START") {
      day.hasBreak = true;
    } else if (punch.type === "IN") {
      day.inPunches.push(punch);
    } else if (punch.type === "OUT") {
      day.outPunches.push(punch);
    }
  }

  const sections: EmployeeSection[] = [];

  const sortedEmployees = Array.from(employeeMap.entries()).sort((a, b) =>
    a[1].name.localeCompare(b[1].name, "es")
  );

  for (const [empId, empData] of sortedEmployees) {
    const days: DayRecord[] = [];
    let empTotalMinutes = 0;

    const sortedDays = Array.from(empData.dayMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    for (const [dateKey, dayData] of sortedDays) {
      const incidencias: string[] = [];

      dayData.inPunches.sort(
        (a, b) => ensureDateUTC(a.timestamp)!.getTime() - ensureDateUTC(b.timestamp)!.getTime()
      );
      dayData.outPunches.sort(
        (a, b) => ensureDateUTC(a.timestamp)!.getTime() - ensureDateUTC(b.timestamp)!.getTime()
      );

      let totalMinutes = 0;
      const inCopy = [...dayData.inPunches];
      const outCopy = [...dayData.outPunches];
      let hasSinSalida = false;

      const pairs: { inP: RawPunch | null; outP: RawPunch | null }[] = [];
      while (inCopy.length > 0 || outCopy.length > 0) {
        if (inCopy.length > 0 && outCopy.length > 0) {
          const inTs = ensureDateUTC(inCopy[0].timestamp)!.getTime();
          const outTs = ensureDateUTC(outCopy[0].timestamp)!.getTime();
          if (inTs <= outTs) {
            const inP = inCopy.shift()!;
            const outP = outCopy.shift()!;
            pairs.push({ inP, outP });
          } else {
            pairs.push({ inP: null, outP: outCopy.shift()! });
          }
        } else if (inCopy.length > 0) {
          pairs.push({ inP: inCopy.shift()!, outP: null });
        } else {
          pairs.push({ inP: null, outP: outCopy.shift()! });
        }
      }

      for (const pair of pairs) {
        if (pair.inP && pair.outP) {
          const inTime = ensureDateUTC(pair.inP.timestamp)!.getTime();
          const outTime = ensureDateUTC(pair.outP.timestamp)!.getTime();
          const diff = Math.floor((outTime - inTime) / 60000);
          if (diff >= 0) totalMinutes += diff;
        } else if (pair.inP && !pair.outP) {
          incidencias.push("Sin salida");
          hasSinSalida = true;
        } else if (!pair.inP && pair.outP) {
          incidencias.push("Sin entrada");
        }
      }

      if (dayData.inPunches.length > 1) {
        incidencias.push("Doble entrada");
      }
      if (dayData.outPunches.length > 1) {
        incidencias.push("Doble salida");
      }

      if (totalMinutes >= 300 && !dayData.hasBreak) {
        incidencias.push("Sin pausa (+5h)");
      }

      const horaInicio =
        dayData.inPunches.length > 0
          ? formatTimeES(dayData.inPunches[0].timestamp)
          : "—";
      const horaFin =
        dayData.outPunches.length > 0
          ? formatTimeES(dayData.outPunches[dayData.outPunches.length - 1].timestamp)
          : "—";

      const hasCorrection = dayData.punchIds.some((id) => correctionsByPunchId.has(id));

      empTotalMinutes += totalMinutes;

      days.push({
        dateKey,
        horaInicio,
        horaFin,
        totalMinutes,
        totalFormatted: formatDurationHHMM(totalMinutes),
        pauseTaken: dayData.hasBreak,
        hasFirma: dayData.hasFirma,
        incidencias,
        hasCorrection,
        hasSinSalida,
      });
    }

    sections.push({
      employeeId: empId,
      fullName: empData.name,
      days,
      totalMinutes: empTotalMinutes,
    });
  }

  return sections;
}

function computeDatasetHash(sections: EmployeeSection[]): string {
  const data = JSON.stringify(
    sections.map((s) => ({
      id: s.employeeId,
      days: s.days.map((d) => ({
        date: d.dateKey,
        start: d.horaInicio,
        end: d.horaFin,
        total: d.totalFormatted,
        pause: d.pauseTaken,
        issues: d.incidencias,
        corrected: d.hasCorrection,
      })),
      totalMinutes: s.totalMinutes,
    }))
  );
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function generateAuthoritiesPDF(
  options: AuthoritiesReportOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margins: { top: 40, bottom: 40, left: 36, right: 36 },
      bufferPages: true,
    });

    const buffers: Buffer[] = [];
    const passThrough = new PassThrough();
    passThrough.on("data", (chunk) => buffers.push(chunk));
    passThrough.on("end", () => resolve(Buffer.concat(buffers)));
    passThrough.on("error", reject);
    doc.pipe(passThrough);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const marginLeft = doc.page.margins.left;
    const logoBuffer = getLogoBuffer();

    const sections = processPunches(options.punches, options.corrections);
    const documentId = crypto.randomUUID();
    const datasetHash = computeDatasetHash(sections);

    const subtitle =
      options.scope === "month"
        ? `Mes: ${MONTH_NAMES[(options.month || 1) - 1]} ${options.year}`
        : `Año: ${options.year}`;

    drawCoverPage(doc, {
      logoBuffer,
      pageWidth,
      marginLeft,
      subtitle,
      generatedAt: options.generatedAt,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
      documentId,
      datasetHash,
      totalEmployees: sections.length,
      totalDays: sections.reduce((sum, s) => sum + s.days.length, 0),
    });

    const pageBottom = doc.page.height - doc.page.margins.bottom - 40;
    let currentY = pageBottom;

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const minRowsToShow = Math.min(section.days.length, 3);
      const estimatedHeight = 36 + 18 + 18 + (minRowsToShow * 20) + 30 + 14;
      const spaceLeft = pageBottom - currentY;

      if (si === 0 || spaceLeft < estimatedHeight) {
        doc.addPage();
        currentY = drawEmployeeSection(doc, section, pageWidth, marginLeft, logoBuffer, true);
      } else {
        currentY = drawEmployeeSection(doc, section, pageWidth, marginLeft, logoBuffer, false, currentY);
      }
    }

    if (options.includeAnnexes) {
      const inOutPunches = options.punches.filter(
        (p) => p.type === "IN" || p.type === "OUT"
      );
      if (inOutPunches.length > 0) {
        doc.addPage();
        drawAnnexA(doc, inOutPunches, pageWidth, marginLeft, logoBuffer);
      }

      if (options.corrections.length > 0) {
        doc.addPage();
        drawAnnexB(doc, options.corrections, pageWidth, marginLeft, logoBuffer);
      }
    }

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 28;
      doc
        .moveTo(marginLeft, footerY - 6)
        .lineTo(marginLeft + pageWidth, footerY - 6)
        .strokeColor(COLORS.borderLight)
        .lineWidth(0.75)
        .stroke();
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor(COLORS.textSecondary)
        .text("CronosFichajes.es", marginLeft, footerY, {
          width: pageWidth / 2,
          align: "left",
        });
      doc.text(`Página ${i + 1} de ${totalPages}`, marginLeft + pageWidth / 2, footerY, {
        width: pageWidth / 2,
        align: "right",
      });
    }

    doc.end();
  });
}

function drawSmallHeader(
  doc: typeof PDFDocument.prototype,
  title: string,
  pageWidth: number,
  marginLeft: number,
  logoBuffer: Buffer | null
): number {
  let y = doc.page.margins.top;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, marginLeft, y, { height: 24 });
    } catch {}
  }
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyDark)
    .text("CRONOS FICHAJES", marginLeft + 30, y + 3);
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor(COLORS.textSecondary)
    .text(title, marginLeft + 30, y + 14);
  y += 28;
  doc
    .moveTo(marginLeft, y)
    .lineTo(marginLeft + pageWidth, y)
    .strokeColor(COLORS.borderLight)
    .lineWidth(1)
    .stroke();
  return y + 6;
}

interface CoverOptions {
  logoBuffer: Buffer | null;
  pageWidth: number;
  marginLeft: number;
  subtitle: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  documentId: string;
  datasetHash: string;
  totalEmployees: number;
  totalDays: number;
}

function drawCoverPage(doc: typeof PDFDocument.prototype, opts: CoverOptions) {
  let y = doc.page.margins.top + 30;

  if (opts.logoBuffer) {
    try {
      doc.image(opts.logoBuffer, opts.marginLeft + opts.pageWidth / 2 - 25, y, {
        height: 50,
      });
      y += 58;
    } catch {
      y += 8;
    }
  }

  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyDark)
    .text("CRONOS FICHAJES", opts.marginLeft, y, {
      width: opts.pageWidth,
      align: "center",
    });
  y += 24;

  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .fillColor(COLORS.textPrimary)
    .text("Registro horario — Informe para Autoridades", opts.marginLeft, y, {
      width: opts.pageWidth,
      align: "center",
    });
  y += 22;

  doc
    .fontSize(12)
    .font("Helvetica")
    .fillColor(COLORS.textSecondary)
    .text(opts.subtitle, opts.marginLeft, y, { width: opts.pageWidth, align: "center" });
  y += 30;

  doc
    .moveTo(opts.marginLeft + 100, y)
    .lineTo(opts.marginLeft + opts.pageWidth - 100, y)
    .strokeColor(COLORS.borderLight)
    .lineWidth(1)
    .stroke();
  y += 18;

  const infoItems = [
    { label: "Generado:", value: formatDateTimeES(opts.generatedAt) },
    {
      label: "Período:",
      value: `${formatDateES(opts.periodStart)} — ${formatDateES(opts.periodEnd)}`,
    },
    { label: "Empleados:", value: opts.totalEmployees.toString() },
    { label: "Días con registro:", value: opts.totalDays.toString() },
  ];

  for (const item of infoItems) {
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor(COLORS.textPrimary)
      .text(item.label, opts.marginLeft + 80, y, { continued: true, width: 120 });
    doc.font("Helvetica").fillColor(COLORS.textSecondary).text(` ${item.value}`);
    y += 16;
  }

  y += 20;
  doc
    .moveTo(opts.marginLeft + 100, y)
    .lineTo(opts.marginLeft + opts.pageWidth - 100, y)
    .strokeColor(COLORS.borderLight)
    .lineWidth(0.5)
    .stroke();
  y += 14;

  doc
    .fontSize(7)
    .font("Helvetica-Bold")
    .fillColor(COLORS.textMuted)
    .text("ID Documento:", opts.marginLeft + 80, y);
  doc
    .fontSize(6)
    .font("Courier")
    .text(opts.documentId, opts.marginLeft + 80, y + 10);
  y += 22;

  doc
    .fontSize(7)
    .font("Helvetica-Bold")
    .fillColor(COLORS.textMuted)
    .text("Hash SHA-256 del dataset:", opts.marginLeft + 80, y);
  doc
    .fontSize(5)
    .font("Courier")
    .text(opts.datasetHash, opts.marginLeft + 80, y + 10);
}

function drawEmployeeSection(
  doc: typeof PDFDocument.prototype,
  section: EmployeeSection,
  pageWidth: number,
  marginLeft: number,
  logoBuffer: Buffer | null,
  isNewPage: boolean,
  startY?: number
): number {
  let y: number;

  if (isNewPage) {
    y = drawSmallHeader(
      doc,
      "Registro horario — Informe para Autoridades",
      pageWidth,
      marginLeft,
      logoBuffer
    );
  } else {
    y = startY! + 8;
    doc
      .moveTo(marginLeft, y)
      .lineTo(marginLeft + pageWidth, y)
      .strokeColor(COLORS.borderLight)
      .lineWidth(0.5)
      .stroke();
    y += 8;
  }

  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyDark)
    .text(`Empleado: ${section.fullName}`, marginLeft, y);
  y += 18;

  const colWidths = {
    fecha: 62,
    inicio: 50,
    fin: 50,
    total: 45,
    pausa: 45,
    firma: 35,
    incidencias: 165,
    correcciones: 70,
  };

  const headers = [
    { text: "Fecha", width: colWidths.fecha },
    { text: "Inicio", width: colWidths.inicio },
    { text: "Fin", width: colWidths.fin },
    { text: "Total", width: colWidths.total },
    { text: "Pausa", width: colWidths.pausa },
    { text: "Firma", width: colWidths.firma },
    { text: "Incidencias", width: colWidths.incidencias },
    { text: "Corr.", width: colWidths.correcciones },
  ];

  y = drawTableHeaderRow(doc, headers, y, pageWidth, marginLeft);

  const ROW_HEIGHT = 20;

  for (let i = 0; i < section.days.length; i++) {
    const day = section.days[i];

    if (y + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom - 50) {
      doc.addPage();
      y = drawSmallHeader(
        doc,
        "Registro horario — Informe para Autoridades",
        pageWidth,
        marginLeft,
        logoBuffer
      );
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(COLORS.textSecondary)
        .text(`Empleado: ${section.fullName} (cont.)`, marginLeft, y);
      y += 14;
      y = drawTableHeaderRow(doc, headers, y, pageWidth, marginLeft);
    }

    const hasIssue = day.hasSinSalida || day.incidencias.length > 0;
    const rowColor = hasIssue
      ? COLORS.incidenciaBg
      : i % 2 === 0
      ? COLORS.zebraLight
      : COLORS.zebraWhite;
    doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(rowColor);
    doc
      .moveTo(marginLeft, y + ROW_HEIGHT)
      .lineTo(marginLeft + pageWidth, y + ROW_HEIGHT)
      .strokeColor(COLORS.borderRow)
      .lineWidth(0.5)
      .stroke();

    let x = marginLeft + 4;
    const textY = y + 5;

    doc
      .fontSize(7.5)
      .font("Helvetica")
      .fillColor(COLORS.textPrimary)
      .text(formatDateKeyES(day.dateKey), x, textY, { width: colWidths.fecha - 8 });
    x += colWidths.fecha;

    doc.text(day.horaInicio, x, textY, { width: colWidths.inicio - 8 });
    x += colWidths.inicio;

    doc.text(day.horaFin, x, textY, { width: colWidths.fin - 8 });
    x += colWidths.fin;

    doc
      .font("Helvetica-Bold")
      .text(day.totalFormatted, x, textY, { width: colWidths.total - 8 });
    x += colWidths.total;

    const showPause = day.totalMinutes >= 300;
    if (showPause) {
      doc
        .font("Helvetica-Bold")
        .fillColor(day.pauseTaken ? COLORS.pauseOk : COLORS.pauseMissing)
        .text(day.pauseTaken ? "Sí" : "No", x, textY, { width: colWidths.pausa - 8, align: "center" });
    } else {
      doc
        .font("Helvetica")
        .fillColor(COLORS.textMuted)
        .text("—", x, textY, { width: colWidths.pausa - 8, align: "center" });
    }
    x += colWidths.pausa;

    doc
      .font("Helvetica-Bold")
      .fillColor(day.hasFirma ? COLORS.navyMedium : COLORS.textMuted)
      .text(day.hasFirma ? "Sí" : "No", x, textY, { width: colWidths.firma - 8, align: "center" });
    x += colWidths.firma;

    const incText = day.incidencias.length > 0 ? day.incidencias.join(", ") : "—";
    doc
      .fillColor(day.incidencias.length > 0 ? COLORS.incidencia : COLORS.textMuted)
      .fontSize(6.5)
      .font(day.incidencias.length > 0 ? "Helvetica-Bold" : "Helvetica")
      .text(incText, x, textY + 1, { width: colWidths.incidencias - 8 });
    x += colWidths.incidencias;

    doc
      .fontSize(7.5)
      .font("Helvetica-Bold")
      .fillColor(day.hasCorrection ? COLORS.correctionYes : COLORS.textMuted)
      .text(day.hasCorrection ? "Sí" : "No", x, textY, {
        width: colWidths.correcciones - 8,
        align: "center",
      });

    y += ROW_HEIGHT;
  }

  y += 6;
  const totalBlockW = 180;
  const totalBlockH = 24;
  const totalBlockX = marginLeft + pageWidth - totalBlockW;

  doc.rect(totalBlockX, y, totalBlockW, totalBlockH).fill(COLORS.headerBg);
  doc
    .rect(totalBlockX, y, totalBlockW, totalBlockH)
    .strokeColor(COLORS.navyMedium)
    .lineWidth(1)
    .stroke();

  doc
    .fontSize(8)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyMedium)
    .text("TOTAL PERÍODO:", totalBlockX + 8, y + 5);
  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .fillColor(COLORS.textPrimary)
    .text(formatDurationHHMM(section.totalMinutes), totalBlockX + 8, y + 4, {
      width: totalBlockW - 16,
      align: "right",
    });

  y += totalBlockH + 4;

  doc
    .fontSize(6)
    .font("Helvetica")
    .fillColor(COLORS.textMuted)
    .text(
      "Total = tiempo efectivo de trabajo. El descanso (20 min) es obligatorio a partir de 6h de trabajo continuado.",
      marginLeft,
      y,
      { width: pageWidth }
    );

  return y + 10;
}

function drawTableHeaderRow(
  doc: typeof PDFDocument.prototype,
  headers: { text: string; width: number }[],
  y: number,
  pageWidth: number,
  marginLeft: number
): number {
  const headerHeight = 18;
  doc.rect(marginLeft, y, pageWidth, headerHeight).fill(COLORS.navyDark);

  doc.fillColor(COLORS.white).fontSize(7).font("Helvetica-Bold");
  let x = marginLeft + 4;
  for (const header of headers) {
    doc.text(header.text, x, y + 5, { width: header.width - 8, align: "left" });
    x += header.width;
  }
  return y + headerHeight + 1;
}

function drawAnnexA(
  doc: typeof PDFDocument.prototype,
  punches: RawPunch[],
  pageWidth: number,
  marginLeft: number,
  logoBuffer: Buffer | null
) {
  let y = drawSmallHeader(
    doc,
    "Anexo A — Detalle de eventos",
    pageWidth,
    marginLeft,
    logoBuffer
  );

  doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyDark)
    .text("Anexo A: Detalle de eventos del período", marginLeft, y);
  y += 16;

  const sorted = [...punches].sort(
    (a, b) => ensureDateUTC(a.timestamp)!.getTime() - ensureDateUTC(b.timestamp)!.getTime()
  );

  const colWidths = {
    fecha: 70,
    hora: 50,
    tipo: 48,
    empleado: 130,
    ubicacion: 115,
    firma: 35,
    fuente: 75,
  };

  const headers = [
    { text: "Fecha", width: colWidths.fecha },
    { text: "Hora", width: colWidths.hora },
    { text: "Tipo", width: colWidths.tipo },
    { text: "Empleado", width: colWidths.empleado },
    { text: "Ubicación", width: colWidths.ubicacion },
    { text: "Firma", width: colWidths.firma },
    { text: "Fuente", width: colWidths.fuente },
  ];

  y = drawTableHeaderRow(doc, headers, y, pageWidth, marginLeft);

  const ROW_HEIGHT = 16;

  for (let i = 0; i < sorted.length; i++) {
    const punch = sorted[i];

    if (y + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      y = drawSmallHeader(
        doc,
        "Anexo A — Detalle de eventos (cont.)",
        pageWidth,
        marginLeft,
        logoBuffer
      );
      y = drawTableHeaderRow(doc, headers, y, pageWidth, marginLeft);
    }

    const rowColor = i % 2 === 0 ? COLORS.zebraLight : COLORS.zebraWhite;
    doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(rowColor);
    doc
      .moveTo(marginLeft, y + ROW_HEIGHT)
      .lineTo(marginLeft + pageWidth, y + ROW_HEIGHT)
      .strokeColor(COLORS.borderRow)
      .lineWidth(0.5)
      .stroke();

    let x = marginLeft + 4;
    const textY = y + 4;
    doc.fontSize(6.5).font("Helvetica").fillColor(COLORS.textPrimary);

    doc.text(formatDateES(punch.timestamp), x, textY, { width: colWidths.fecha - 8 });
    x += colWidths.fecha;

    doc.text(formatTimeES(punch.timestamp), x, textY, { width: colWidths.hora - 8 });
    x += colWidths.hora;

    doc
      .font("Helvetica-Bold")
      .text(punch.type === "IN" ? "Entrada" : "Salida", x, textY, {
        width: colWidths.tipo - 8,
      });
    x += colWidths.tipo;

    doc
      .font("Helvetica")
      .text(
        `${punch.employee.lastName}, ${punch.employee.firstName}`,
        x,
        textY,
        { width: colWidths.empleado - 8 }
      );
    x += colWidths.empleado;

    const hasLocation = punch.latitude && punch.longitude;
    if (hasLocation) {
      const lat = parseFloat(punch.latitude!).toFixed(4);
      const lon = parseFloat(punch.longitude!).toFixed(4);
      const acc = punch.accuracy ? `±${parseFloat(punch.accuracy).toFixed(0)}m` : "";
      doc
        .fillColor(COLORS.navyMedium)
        .text(`${lat}, ${lon} ${acc}`, x, textY, { width: colWidths.ubicacion - 8 });
    } else {
      doc
        .fillColor(COLORS.textMuted)
        .text("—", x, textY, { width: colWidths.ubicacion - 8, align: "center" });
    }
    x += colWidths.ubicacion;

    const hasSig = hasPunchSignature(punch);
    doc
      .fillColor(hasSig ? COLORS.navyMedium : COLORS.textMuted)
      .font("Helvetica-Bold")
      .text(hasSig ? "Sí" : "No", x, textY, { width: colWidths.firma - 8, align: "center" });
    x += colWidths.firma;

    doc
      .font("Helvetica")
      .fillColor(COLORS.textSecondary)
      .text(punch.source || "—", x, textY, { width: colWidths.fuente - 8 });

    y += ROW_HEIGHT;
  }
}

function drawAnnexB(
  doc: typeof PDFDocument.prototype,
  corrections: CorrectionRecord[],
  pageWidth: number,
  marginLeft: number,
  logoBuffer: Buffer | null
) {
  let y = drawSmallHeader(
    doc,
    "Anexo B — Correcciones",
    pageWidth,
    marginLeft,
    logoBuffer
  );

  doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyDark)
    .text("Anexo B: Correcciones del período", marginLeft, y);
  y += 16;

  const ROW_HEIGHT = 44;

  for (let i = 0; i < corrections.length; i++) {
    const c = corrections[i];

    if (y + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      y = drawSmallHeader(
        doc,
        "Anexo B — Correcciones (cont.)",
        pageWidth,
        marginLeft,
        logoBuffer
      );
    }

    const rowColor = i % 2 === 0 ? COLORS.zebraLight : COLORS.zebraWhite;
    doc.rect(marginLeft, y, pageWidth, ROW_HEIGHT).fill(rowColor);
    doc
      .rect(marginLeft, y, pageWidth, ROW_HEIGHT)
      .strokeColor(COLORS.borderRow)
      .lineWidth(0.5)
      .stroke();

    const col1 = marginLeft + 6;
    const col2 = marginLeft + pageWidth / 2;
    let textY = y + 5;

    doc.fontSize(7).font("Helvetica-Bold").fillColor(COLORS.textPrimary);
    doc.text(`Empleado: ${c.employeeName}`, col1, textY);
    doc.font("Helvetica").fillColor(COLORS.textSecondary);
    doc.text(`Autor: ${c.correctedByName}`, col2, textY);
    textY += 11;

    doc.fontSize(6.5).fillColor(COLORS.textPrimary);
    doc.text(
      `Original: ${formatDateTimeES(c.originalTimestamp)} (${c.originalType})`,
      col1,
      textY
    );
    if (c.newTimestamp || c.newType) {
      doc.text(
        `Corregido: ${c.newTimestamp ? formatDateTimeES(c.newTimestamp) : "—"} ${c.newType ? `(${c.newType})` : ""}`,
        col2,
        textY
      );
    }
    textY += 11;

    doc
      .fontSize(6.5)
      .fillColor(COLORS.textSecondary)
      .text(`Motivo: ${c.reason}`, col1, textY, { width: pageWidth / 2 - 12 });
    doc.text(`Fecha corrección: ${formatDateTimeES(c.correctionDate)}`, col2, textY);

    y += ROW_HEIGHT;
  }
}

