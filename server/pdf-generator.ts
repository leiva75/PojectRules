import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import * as fs from "fs";
import * as path from "path";
import { TIMEZONE, ensureDateUTC, formatDateES, formatTimeES, formatDateTimeES } from "./timezone";

// Cache logo at module level to avoid repeated file reads
let cachedLogoBuffer: Buffer | null = null;
let logoLoadAttempted = false;

// Maximum signatures per PDF to prevent memory issues
const MAX_SIGNATURES_PER_PDF = 100;

export interface PunchRecord {
  lastName: string;
  firstName: string;
  inTimestamp: Date | string | null;
  inSignatureData: string | null;
  inLatitude: string | null;
  inLongitude: string | null;
  outTimestamp: Date | string | null;
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
  textPrimary: "#0f172a",
  textSecondary: "#374151",
  textMuted: "#6b7280",
  zebraLight: "#dce5f0",
  zebraWhite: "#ffffff",
  linkBadge: "#475569",
  linkBadgeBg: "#e2e8f0",
  borderLight: "#94a3b8",
  borderRow: "#cbd5e1",
  bgPage: "#fafbfc",
  white: "#ffffff",
};

function formatDateTime(date: Date | string | null): string {
  return formatDateTimeES(date);
}

function formatDate(date: Date | string | null): string {
  return formatDateES(date);
}

function getMapUrl(lat: string | null, lon: string | null): string | null {
  if (!lat || !lon) return null;
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

function calculateDurationMinutes(inTime: Date | string | null, outTime: Date | string | null): number | null {
  const inDate = ensureDateUTC(inTime);
  const outDate = ensureDateUTC(outTime);
  if (!inDate || !outDate) return null;
  const diffMs = outDate.getTime() - inDate.getTime();
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
      doc.image(logoBuffer, marginLeft, y, { height: 45 });
    } catch {
    }
  }

  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor(COLORS.navyDark)
    .text("CRONOS FICHAJES", marginLeft + 58, y + 6, { align: "left" });

  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .fillColor(COLORS.textPrimary)
    .text(options.title, marginLeft, y + 28, { align: "center", width: pageWidth });

  const rightX = marginLeft + pageWidth - 160;
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor(COLORS.textSecondary)
    .text(`Generado: ${formatDateTime(options.generatedAt)}`, rightX, y, { width: 160, align: "right" });

  if (options.periodStart && options.periodEnd) {
    doc.text(
      `Período: ${formatDate(options.periodStart)} - ${formatDate(options.periodEnd)}`,
      rightX,
      y + 14,
      { width: 160, align: "right" }
    );
  }

  y += 52;

  doc
    .moveTo(marginLeft, y)
    .lineTo(marginLeft + pageWidth, y)
    .strokeColor(COLORS.borderLight)
    .lineWidth(1.5)
    .stroke();

  return y + 10;
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

  const blockHeight = 45;
  const blockCount = options.isEmployeeReport ? 3 : 4;
  const blockWidth = (pageWidth - (blockCount - 1) * 12) / blockCount;

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
    doc.rect(x, y, blockWidth, blockHeight).fillColor("#e8f0f8").fill();

    doc.rect(x, y, blockWidth, blockHeight).strokeColor(COLORS.borderLight).lineWidth(0.75).stroke();

    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(COLORS.textSecondary)
      .text(item.label.toUpperCase(), x + 10, y + 10, { width: blockWidth - 20 });

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .fillColor(COLORS.textPrimary)
      .text(item.value, x + 10, y + 24, { width: blockWidth - 20 });

    x += blockWidth + 12;
  }

  return y + blockHeight + 18;
}

function drawTableHeader(
  doc: typeof PDFDocument.prototype,
  headers: { text: string; width: number }[],
  y: number,
  pageWidth: number
): number {
  const marginLeft = doc.page.margins.left;
  const headerHeight = 26;

  doc.rect(marginLeft, y, pageWidth, headerHeight).fill(COLORS.navyDark);

  doc
    .moveTo(marginLeft, y + headerHeight)
    .lineTo(marginLeft + pageWidth, y + headerHeight)
    .strokeColor(COLORS.navyMedium)
    .lineWidth(2)
    .stroke();

  doc.fillColor(COLORS.white).fontSize(9).font("Helvetica-Bold");

  let x = marginLeft + 6;
  for (const header of headers) {
    doc.text(header.text, x, y + 9, { width: header.width - 10, align: "left" });
    x += header.width;
  }

  return y + headerHeight + 2;
}

export async function generateReportPDF(options: ReportOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 28, bottom: 28, left: 28, right: 28 },
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
      lastName: 68,
      firstName: 68,
      inTime: 80,
      inSig: 115,
      outTime: 80,
      outSig: 115,
      duration: 52,
      inLoc: 60,
      outLoc: 60,
    };

    const headers = [
      { text: "APELLIDO", width: colWidths.lastName },
      { text: "NOMBRE", width: colWidths.firstName },
      { text: "ENTRADA", width: colWidths.inTime },
      { text: "FIRMA ENT.", width: colWidths.inSig },
      { text: "SALIDA", width: colWidths.outTime },
      { text: "FIRMA SAL.", width: colWidths.outSig },
      { text: "DURACIÓN", width: colWidths.duration },
      { text: "UBIC. ENT.", width: colWidths.inLoc },
      { text: "UBIC. SAL.", width: colWidths.outLoc },
    ];

    y = drawTableHeader(doc, headers, y, pageWidth);

    const ROW_HEIGHT = 70;
    const SIG_HEIGHT = 56;
    const SIG_WIDTH = 110;

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
        .strokeColor(COLORS.borderRow)
        .lineWidth(0.75)
        .stroke();

      doc.fillColor(COLORS.textPrimary).fontSize(12).font("Helvetica");

      let x = doc.page.margins.left + 6;
      const textY = y + 16;

      doc.font("Helvetica-Bold").fontSize(12).text(record.lastName || "-", x, textY, { width: colWidths.lastName - 4 });
      x += colWidths.lastName;

      doc.font("Helvetica").fontSize(12).text(record.firstName || "-", x, textY, { width: colWidths.firstName - 4 });
      x += colWidths.firstName;

      doc.fontSize(10).text(formatDateTime(record.inTimestamp), x, textY, { width: colWidths.inTime - 4 });
      x += colWidths.inTime;

      // Signature cell with white background and border
      const sigCellY = y + 4;
      const sigCellHeight = SIG_HEIGHT + 4;
      
      doc.rect(x + 2, sigCellY, SIG_WIDTH, sigCellHeight).fill(COLORS.white);
      doc.rect(x + 2, sigCellY, SIG_WIDTH, sigCellHeight).strokeColor(COLORS.borderLight).lineWidth(0.75).stroke();
      
      if (record.inSignatureBuffer) {
        try {
          doc.image(record.inSignatureBuffer, x + 4, sigCellY + 2, { 
            fit: [SIG_WIDTH - 4, sigCellHeight - 4],
            align: "center",
            valign: "center"
          });
        } catch {
          doc.fillColor(COLORS.textMuted).fontSize(8).text("(firma)", x + 2, sigCellY + sigCellHeight / 2 - 4, { width: SIG_WIDTH, align: "center" });
        }
      } else if (record.inSignatureSkipped) {
        doc.fillColor(COLORS.textMuted).fontSize(8).text("(firma)", x + 2, sigCellY + sigCellHeight / 2 - 4, { width: SIG_WIDTH, align: "center" });
      } else {
        doc.fillColor(COLORS.textMuted).fontSize(10).text("—", x + 2, sigCellY + sigCellHeight / 2 - 5, { width: SIG_WIDTH, align: "center" });
      }
      x += colWidths.inSig;

      doc.fillColor(COLORS.textPrimary).fontSize(10).text(formatDateTime(record.outTimestamp), x, textY, { width: colWidths.outTime - 4 });
      x += colWidths.outTime;

      // Signature cell with white background and border
      doc.rect(x + 2, sigCellY, SIG_WIDTH, sigCellHeight).fill(COLORS.white);
      doc.rect(x + 2, sigCellY, SIG_WIDTH, sigCellHeight).strokeColor(COLORS.borderLight).lineWidth(0.75).stroke();
      
      if (record.outSignatureBuffer) {
        try {
          doc.image(record.outSignatureBuffer, x + 4, sigCellY + 2, { 
            fit: [SIG_WIDTH - 4, sigCellHeight - 4],
            align: "center",
            valign: "center"
          });
        } catch {
          doc.fillColor(COLORS.textMuted).fontSize(8).text("(firma)", x + 2, sigCellY + sigCellHeight / 2 - 4, { width: SIG_WIDTH, align: "center" });
        }
      } else if (record.outSignatureSkipped) {
        doc.fillColor(COLORS.textMuted).fontSize(8).text("(firma)", x + 2, sigCellY + sigCellHeight / 2 - 4, { width: SIG_WIDTH, align: "center" });
      } else {
        doc.fillColor(COLORS.textMuted).fontSize(10).text("—", x + 2, sigCellY + sigCellHeight / 2 - 5, { width: SIG_WIDTH, align: "center" });
      }
      x += colWidths.outSig;

      const duration = calculateDurationMinutes(record.inTimestamp, record.outTimestamp);
      const durationStr = formatDuration(duration);
      const durationY = y + ROW_HEIGHT / 2 - 7;
      doc
        .fillColor(duration !== null ? COLORS.textPrimary : COLORS.textMuted)
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(durationStr, x, durationY, { width: colWidths.duration - 6, align: "center" });
      doc.font("Helvetica");
      x += colWidths.duration;

      // Map link badges
      const badgeY = y + ROW_HEIGHT / 2 - 8;
      const badgeWidth = 52;
      const badgeHeight = 16;
      
      const inMapUrl = getMapUrl(record.inLatitude, record.inLongitude);
      if (inMapUrl) {
        doc.rect(x + 2, badgeY, badgeWidth, badgeHeight).fill(COLORS.linkBadgeBg);
        doc.rect(x + 2, badgeY, badgeWidth, badgeHeight).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
        doc
          .fillColor(COLORS.linkBadge)
          .fontSize(8)
          .text("Ver mapa", x + 2, badgeY + 4, {
            width: badgeWidth,
            link: inMapUrl,
            underline: false,
            align: "center",
          });
      } else {
        doc.fillColor(COLORS.textMuted).fontSize(11).text("—", x, badgeY + 3, { width: colWidths.inLoc - 8, align: "center" });
      }
      x += colWidths.inLoc;

      const outMapUrl = getMapUrl(record.outLatitude, record.outLongitude);
      if (outMapUrl) {
        doc.rect(x + 2, badgeY, badgeWidth, badgeHeight).fill(COLORS.linkBadgeBg);
        doc.rect(x + 2, badgeY, badgeWidth, badgeHeight).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
        doc
          .fillColor(COLORS.linkBadge)
          .fontSize(8)
          .text("Ver mapa", x + 2, badgeY + 4, {
            width: badgeWidth,
            link: outMapUrl,
            underline: false,
            align: "center",
          });
      } else {
        doc.fillColor(COLORS.textMuted).fontSize(11).text("—", x, badgeY + 3, { width: colWidths.outLoc - 8, align: "center" });
      }

      y += ROW_HEIGHT;
    }

    if (options.isEmployeeReport && completedPairsCount > 0) {
      y += 12;
      const totalBlockWidth = 220;
      const totalBlockHeight = 42;
      const totalBlockX = doc.page.margins.left + pageWidth - totalBlockWidth;

      doc.rect(totalBlockX, y, totalBlockWidth, totalBlockHeight).fill("#e8f0f8");
      doc.rect(totalBlockX, y, totalBlockWidth, totalBlockHeight).strokeColor(COLORS.navyMedium).lineWidth(1.5).stroke();

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(COLORS.navyMedium)
        .text("TOTAL PERÍODO:", totalBlockX + 12, y + 10);

      doc
        .fontSize(16)
        .font("Helvetica-Bold")
        .fillColor(COLORS.textPrimary)
        .text(formatDurationShort(totalMinutes), totalBlockX + 12, y + 22, { width: totalBlockWidth - 24, align: "right" });
    }

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      const footerY = doc.page.height - 22;

      doc
        .moveTo(doc.page.margins.left, footerY - 6)
        .lineTo(doc.page.margins.left + pageWidth, footerY - 6)
        .strokeColor(COLORS.borderLight)
        .lineWidth(0.75)
        .stroke();

      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(COLORS.textSecondary)
        .text("CronosFichajes.es", doc.page.margins.left, footerY, { align: "left", width: pageWidth / 2 });

      doc.text(`Página ${i + 1} de ${totalPages}`, doc.page.margins.left + pageWidth / 2, footerY, {
        align: "right",
        width: pageWidth / 2,
      });
    }

    doc.end();
  });
}
