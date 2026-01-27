import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import * as fs from "fs";
import * as path from "path";

// Cache logo at module level to avoid repeated file reads
let cachedLogoBuffer: Buffer | null = null;
let logoLoadAttempted = false;

// Maximum signatures per PDF to prevent memory issues
const MAX_SIGNATURES_PER_PDF = 100;

export interface PunchRecord {
  lastName: string;
  firstName: string;
  inTimestamp: Date | null;
  inSignatureData: string | null;
  inLatitude: string | null;
  inLongitude: string | null;
  outTimestamp: Date | null;
  outSignatureData: string | null;
  outLatitude: string | null;
  outLongitude: string | null;
}

export interface ReportOptions {
  title: string;
  subtitle: string;
  records: PunchRecord[];
  generatedAt: Date;
  periodStart?: Date;
  periodEnd?: Date;
  employeeName?: string;
  isEmployeeReport?: boolean;
}

const COLORS = {
  navyDark: "#0f172a",
  navyMedium: "#1e3a5f",
  navyLight: "#334155",
  textPrimary: "#1a1a1a",
  textSecondary: "#4b5563",
  textMuted: "#6b7280",
  zebraLight: "#e8eef4",
  zebraWhite: "#ffffff",
  linkBlue: "#3366aa",
  borderLight: "#d1d5db",
  bgPage: "#fafbfc",
  white: "#ffffff",
};

function formatDateTime(date: Date | null): string {
  if (!date) return "-";
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getMapUrl(lat: string | null, lon: string | null): string | null {
  if (!lat || !lon) return null;
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

function calculateDurationMinutes(inTime: Date | null, outTime: Date | null): number | null {
  if (!inTime || !outTime) return null;
  const diffMs = outTime.getTime() - inTime.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / (1000 * 60));
}

function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes < 0) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

function formatDurationShort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getLogoBuffer(): Buffer | null {
  if (logoLoadAttempted) {
    return cachedLogoBuffer;
  }
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
    console.warn("Could not load logo for PDF:", error);
  }
  return null;
}

// Pre-convert base64 signature to Buffer (only once per signature)
function signatureToBuffer(signatureData: string | null): Buffer | null {
  if (!signatureData || !signatureData.startsWith("data:image")) {
    return null;
  }
  try {
    const base64Data = signatureData.split(",")[1];
    if (!base64Data) return null;
    return Buffer.from(base64Data, "base64");
  } catch {
    return null;
  }
}

interface ProcessedRecord extends PunchRecord {
  inSignatureBuffer: Buffer | null;
  outSignatureBuffer: Buffer | null;
  inSignatureSkipped: boolean;
  outSignatureSkipped: boolean;
}

function drawHeader(
  doc: typeof PDFDocument.prototype,
  options: ReportOptions,
  pageWidth: number,
  logoBuffer: Buffer | null
): number {
  const marginLeft = doc.page.margins.left;
  let y = doc.page.margins.top;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, marginLeft, y, { height: 40 });
    } catch {
    }
  }

  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyDark)
    .text("CRONOS FICHAJES", marginLeft + 55, y + 5, { align: "left" });

  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .fillColor(COLORS.textPrimary)
    .text(options.title, marginLeft, y + 24, { align: "center", width: pageWidth });

  const rightX = marginLeft + pageWidth - 150;
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor(COLORS.textMuted)
    .text(`Generado: ${formatDateTime(options.generatedAt)}`, rightX, y, { width: 150, align: "right" });

  if (options.periodStart && options.periodEnd) {
    doc.text(
      `Período: ${formatDate(options.periodStart)} - ${formatDate(options.periodEnd)}`,
      rightX,
      y + 12,
      { width: 150, align: "right" }
    );
  }

  y += 48;

  doc
    .moveTo(marginLeft, y)
    .lineTo(marginLeft + pageWidth, y)
    .strokeColor(COLORS.borderLight)
    .lineWidth(1)
    .stroke();

  return y + 8;
}

function drawSummaryBlock(
  doc: typeof PDFDocument.prototype,
  options: ReportOptions,
  pageWidth: number,
  totalMinutes: number,
  uniqueEmployees: number
): number {
  const marginLeft = doc.page.margins.left;
  let y = doc.y + 5;

  const blockHeight = 40;
  const blockCount = options.isEmployeeReport ? 3 : 4;
  const blockWidth = (pageWidth - (blockCount - 1) * 10) / blockCount;

  const periodLabel = options.periodStart && options.periodEnd 
    ? `${formatDate(options.periodStart)} - ${formatDate(options.periodEnd)}`
    : options.subtitle || "-";
    
  const summaryItems = options.isEmployeeReport
    ? [
        { label: "Período", value: periodLabel },
        { label: "Total Registros", value: options.records.length.toString() },
        { label: "Total Horas", value: formatDurationShort(totalMinutes) },
      ]
    : [
        { label: "Período", value: periodLabel },
        { label: "Empleados", value: uniqueEmployees.toString() },
        { label: "Total Registros", value: options.records.length.toString() },
        { label: "Total Horas", value: formatDurationShort(totalMinutes) },
      ];

  let x = marginLeft;
  for (const item of summaryItems) {
    doc.rect(x, y, blockWidth, blockHeight).fillColor("#f1f5f9").fill();

    doc.rect(x, y, blockWidth, blockHeight).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();

    doc
      .fontSize(7)
      .font("Helvetica")
      .fillColor(COLORS.textMuted)
      .text(item.label.toUpperCase(), x + 8, y + 8, { width: blockWidth - 16 });

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLORS.textPrimary)
      .text(item.value, x + 8, y + 20, { width: blockWidth - 16 });

    x += blockWidth + 10;
  }

  return y + blockHeight + 15;
}

function drawTableHeader(
  doc: typeof PDFDocument.prototype,
  headers: { text: string; width: number }[],
  y: number,
  pageWidth: number
): number {
  const marginLeft = doc.page.margins.left;

  doc.rect(marginLeft, y, pageWidth, 22).fill(COLORS.navyMedium);

  doc.rect(marginLeft, y + 22, pageWidth, 0).strokeColor(COLORS.navyDark).lineWidth(2).stroke();

  doc.fillColor(COLORS.white).fontSize(8).font("Helvetica-Bold");

  let x = marginLeft + 5;
  for (const header of headers) {
    doc.text(header.text, x, y + 7, { width: header.width - 10, align: "left" });
    x += header.width;
  }

  return y + 24;
}

export async function generateReportPDF(options: ReportOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 35, bottom: 35, left: 25, right: 25 },
      bufferPages: true,
    });

    const buffers: Buffer[] = [];
    const passThrough = new PassThrough();

    passThrough.on("data", (chunk) => buffers.push(chunk));
    passThrough.on("end", () => resolve(Buffer.concat(buffers)));
    passThrough.on("error", reject);

    doc.pipe(passThrough);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const logoBuffer = getLogoBuffer();

    let totalMinutes = 0;
    let completedPairsCount = 0;
    const uniqueEmployees = new Set<string>();

    // Pre-process signatures to avoid repeated base64 decoding in loop
    let signatureCount = 0;
    const processedRecords: ProcessedRecord[] = options.records.map((record) => {
      const duration = calculateDurationMinutes(record.inTimestamp, record.outTimestamp);
      if (duration !== null && duration >= 0) {
        totalMinutes += duration;
        completedPairsCount++;
      }
      uniqueEmployees.add(`${record.lastName}-${record.firstName}`);
      
      // Only process signatures if under limit
      let inSigBuffer: Buffer | null = null;
      let outSigBuffer: Buffer | null = null;
      let inSigSkipped = false;
      let outSigSkipped = false;
      
      // Check if signature is valid (starts with data:image)
      const hasValidInSig = record.inSignatureData?.startsWith("data:image");
      const hasValidOutSig = record.outSignatureData?.startsWith("data:image");
      
      if (hasValidInSig) {
        if (signatureCount < MAX_SIGNATURES_PER_PDF) {
          inSigBuffer = signatureToBuffer(record.inSignatureData);
          if (inSigBuffer) signatureCount++;
        } else {
          inSigSkipped = true; // Over limit, mark as skipped
        }
      }
      
      if (hasValidOutSig) {
        if (signatureCount < MAX_SIGNATURES_PER_PDF) {
          outSigBuffer = signatureToBuffer(record.outSignatureData);
          if (outSigBuffer) signatureCount++;
        } else {
          outSigSkipped = true; // Over limit, mark as skipped
        }
      }
      
      return {
        ...record,
        inSignatureBuffer: inSigBuffer,
        outSignatureBuffer: outSigBuffer,
        inSignatureSkipped: inSigSkipped,
        outSignatureSkipped: outSigSkipped,
      };
    });

    let y = drawHeader(doc, options, pageWidth, logoBuffer);
    doc.y = y;

    y = drawSummaryBlock(doc, options, pageWidth, totalMinutes, uniqueEmployees.size);

    const colWidths = {
      lastName: 65,
      firstName: 65,
      inTime: 82,
      inSig: 55,
      outTime: 82,
      outSig: 55,
      duration: 50,
      inLoc: 80,
      outLoc: 80,
    };

    const headers = [
      { text: "Apellido", width: colWidths.lastName },
      { text: "Nombre", width: colWidths.firstName },
      { text: "Entrada", width: colWidths.inTime },
      { text: "Firma Ent.", width: colWidths.inSig },
      { text: "Salida", width: colWidths.outTime },
      { text: "Firma Sal.", width: colWidths.outSig },
      { text: "Duración", width: colWidths.duration },
      { text: "Ubic. Ent.", width: colWidths.inLoc },
      { text: "Ubic. Sal.", width: colWidths.outLoc },
    ];

    y = drawTableHeader(doc, headers, y, pageWidth);

    const ROW_HEIGHT = 42;
    const SIG_HEIGHT = 32;
    const SIG_WIDTH = 45;

    for (let i = 0; i < processedRecords.length; i++) {
      const record = processedRecords[i];

      if (y + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom - 25) {
        doc.addPage();
        y = drawHeader(doc, options, pageWidth, logoBuffer);
        y = drawTableHeader(doc, headers, y + 10, pageWidth);
      }

      const rowColor = i % 2 === 0 ? COLORS.zebraLight : COLORS.zebraWhite;
      doc.rect(doc.page.margins.left, y, pageWidth, ROW_HEIGHT).fill(rowColor);

      doc
        .moveTo(doc.page.margins.left, y + ROW_HEIGHT)
        .lineTo(doc.page.margins.left + pageWidth, y + ROW_HEIGHT)
        .strokeColor("#e5e7eb")
        .lineWidth(0.3)
        .stroke();

      doc.fillColor(COLORS.textPrimary).fontSize(7).font("Helvetica");

      let x = doc.page.margins.left + 5;
      const textY = y + 6;

      doc.font("Helvetica-Bold").text(record.lastName || "-", x, textY, { width: colWidths.lastName - 10 });
      x += colWidths.lastName;

      doc.font("Helvetica").text(record.firstName || "-", x, textY, { width: colWidths.firstName - 10 });
      x += colWidths.firstName;

      doc.text(formatDateTime(record.inTimestamp), x, textY, { width: colWidths.inTime - 10 });
      x += colWidths.inTime;

      // Use pre-processed signature buffer
      if (record.inSignatureBuffer) {
        try {
          doc.rect(x + 2, y + 4, SIG_WIDTH, SIG_HEIGHT).strokeColor("#d1d5db").lineWidth(0.5).stroke();
          doc.image(record.inSignatureBuffer, x + 3, y + 5, { width: SIG_WIDTH - 2, height: SIG_HEIGHT - 2, fit: [SIG_WIDTH - 2, SIG_HEIGHT - 2] });
        } catch {
          doc.fillColor(COLORS.textMuted).text("(firma)", x, textY + 10, { width: colWidths.inSig - 10, align: "center" });
        }
      } else if (record.inSignatureSkipped) {
        // Signature exists but was skipped due to limit
        doc.fillColor(COLORS.textMuted).text("(firma)", x, textY + 10, { width: colWidths.inSig - 10, align: "center" });
      } else {
        doc.fillColor(COLORS.textMuted).text("-", x, textY + 10, { width: colWidths.inSig - 10, align: "center" });
      }
      x += colWidths.inSig;

      doc.fillColor(COLORS.textPrimary).text(formatDateTime(record.outTimestamp), x, textY, { width: colWidths.outTime - 10 });
      x += colWidths.outTime;

      // Use pre-processed signature buffer
      if (record.outSignatureBuffer) {
        try {
          doc.rect(x + 2, y + 4, SIG_WIDTH, SIG_HEIGHT).strokeColor("#d1d5db").lineWidth(0.5).stroke();
          doc.image(record.outSignatureBuffer, x + 3, y + 5, { width: SIG_WIDTH - 2, height: SIG_HEIGHT - 2, fit: [SIG_WIDTH - 2, SIG_HEIGHT - 2] });
        } catch {
          doc.fillColor(COLORS.textMuted).text("(firma)", x, textY + 10, { width: colWidths.outSig - 10, align: "center" });
        }
      } else if (record.outSignatureSkipped) {
        // Signature exists but was skipped due to limit
        doc.fillColor(COLORS.textMuted).text("(firma)", x, textY + 10, { width: colWidths.outSig - 10, align: "center" });
      } else {
        doc.fillColor(COLORS.textMuted).text("-", x, textY + 10, { width: colWidths.outSig - 10, align: "center" });
      }
      x += colWidths.outSig;

      const duration = calculateDurationMinutes(record.inTimestamp, record.outTimestamp);
      const durationStr = formatDuration(duration);
      doc
        .fillColor(duration !== null ? COLORS.textPrimary : COLORS.textMuted)
        .font("Helvetica-Bold")
        .text(durationStr, x, textY + 10, { width: colWidths.duration - 10, align: "center" });
      doc.font("Helvetica");
      x += colWidths.duration;

      const inMapUrl = getMapUrl(record.inLatitude, record.inLongitude);
      if (inMapUrl) {
        doc
          .fillColor(COLORS.linkBlue)
          .fontSize(6)
          .text("Ver mapa", x, textY + 10, {
            width: colWidths.inLoc - 10,
            link: inMapUrl,
            underline: false,
          });
      } else {
        doc.fillColor(COLORS.textMuted).fontSize(7).text("-", x, textY + 10, { width: colWidths.inLoc - 10 });
      }
      x += colWidths.inLoc;

      const outMapUrl = getMapUrl(record.outLatitude, record.outLongitude);
      if (outMapUrl) {
        doc
          .fillColor(COLORS.linkBlue)
          .fontSize(6)
          .text("Ver mapa", x, textY + 10, {
            width: colWidths.outLoc - 10,
            link: outMapUrl,
            underline: false,
          });
      } else {
        doc.fillColor(COLORS.textMuted).fontSize(7).text("-", x, textY + 10, { width: colWidths.outLoc - 10 });
      }

      y += ROW_HEIGHT;
    }

    if (options.isEmployeeReport && completedPairsCount > 0) {
      y += 10;
      const totalBlockWidth = 200;
      const totalBlockX = doc.page.margins.left + pageWidth - totalBlockWidth;

      doc.rect(totalBlockX, y, totalBlockWidth, 35).fill("#f1f5f9");
      doc.rect(totalBlockX, y, totalBlockWidth, 35).strokeColor(COLORS.navyMedium).lineWidth(1).stroke();

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(COLORS.navyMedium)
        .text("TOTAL PERÍODO:", totalBlockX + 10, y + 8);

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor(COLORS.textPrimary)
        .text(formatDurationShort(totalMinutes), totalBlockX + 10, y + 18, { width: totalBlockWidth - 20, align: "right" });
    }

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      const footerY = doc.page.height - 25;

      doc
        .moveTo(doc.page.margins.left, footerY - 5)
        .lineTo(doc.page.margins.left + pageWidth, footerY - 5)
        .strokeColor(COLORS.borderLight)
        .lineWidth(0.5)
        .stroke();

      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor(COLORS.textMuted)
        .text("CronosFichajes.es", doc.page.margins.left, footerY, { align: "left", width: pageWidth / 2 });

      doc.text(`Página ${i + 1} de ${totalPages}`, doc.page.margins.left + pageWidth / 2, footerY, {
        align: "right",
        width: pageWidth / 2,
      });
    }

    doc.end();
  });
}
