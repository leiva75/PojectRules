import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

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
}

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

function formatTime(date: Date | null): string {
  if (!date) return "-";
  return date.toLocaleTimeString("es-ES", {
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

export async function generateReportPDF(options: ReportOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 40, bottom: 40, left: 30, right: 30 },
      bufferPages: true,
    });

    const buffers: Buffer[] = [];
    const passThrough = new PassThrough();

    passThrough.on("data", (chunk) => buffers.push(chunk));
    passThrough.on("end", () => resolve(Buffer.concat(buffers)));
    passThrough.on("error", reject);

    doc.pipe(passThrough);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("CRONOS FICHAJES", { align: "center" });

    doc.moveDown(0.3);
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(options.title, { align: "center" });

    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(options.subtitle, { align: "center" });

    doc.moveDown(0.3);
    doc
      .fontSize(8)
      .fillColor("#666666")
      .text(`Generado: ${formatDateTime(options.generatedAt)}`, { align: "right" });

    doc.fillColor("#000000");
    doc.moveDown(1);

    const colWidths = {
      lastName: 70,
      firstName: 70,
      inTime: 90,
      inSig: 60,
      outTime: 90,
      outSig: 60,
      inLoc: 90,
      outLoc: 90,
    };

    const headers = [
      { text: "Apellido", width: colWidths.lastName },
      { text: "Nombre", width: colWidths.firstName },
      { text: "Entrada", width: colWidths.inTime },
      { text: "Firma Ent.", width: colWidths.inSig },
      { text: "Salida", width: colWidths.outTime },
      { text: "Firma Sal.", width: colWidths.outSig },
      { text: "Ubicación Ent.", width: colWidths.inLoc },
      { text: "Ubicación Sal.", width: colWidths.outLoc },
    ];

    let y = doc.y;
    let x = doc.page.margins.left;

    doc.rect(x, y, pageWidth, 20).fill("#1e3a5f");

    doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");

    x = doc.page.margins.left + 5;
    for (const header of headers) {
      doc.text(header.text, x, y + 6, { width: header.width - 10, align: "left" });
      x += header.width;
    }

    y += 20;
    doc.fillColor("#000000").font("Helvetica");

    const ROW_HEIGHT = 45;
    const SIG_HEIGHT = 35;
    const SIG_WIDTH = 50;

    for (let i = 0; i < options.records.length; i++) {
      const record = options.records[i];

      if (y + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;

        x = doc.page.margins.left;
        doc.rect(x, y, pageWidth, 20).fill("#1e3a5f");
        doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");

        x = doc.page.margins.left + 5;
        for (const header of headers) {
          doc.text(header.text, x, y + 6, { width: header.width - 10, align: "left" });
          x += header.width;
        }

        y += 20;
        doc.fillColor("#000000").font("Helvetica");
      }

      if (i % 2 === 0) {
        doc.rect(doc.page.margins.left, y, pageWidth, ROW_HEIGHT).fill("#f5f5f5");
      }

      doc.fillColor("#000000").fontSize(7);

      x = doc.page.margins.left + 5;
      const textY = y + 5;

      doc.text(record.lastName || "-", x, textY, { width: colWidths.lastName - 10 });
      x += colWidths.lastName;

      doc.text(record.firstName || "-", x, textY, { width: colWidths.firstName - 10 });
      x += colWidths.firstName;

      doc.text(formatDateTime(record.inTimestamp), x, textY, { width: colWidths.inTime - 10 });
      x += colWidths.inTime;

      if (record.inSignatureData && record.inSignatureData.startsWith("data:image")) {
        try {
          const base64Data = record.inSignatureData.split(",")[1];
          const imageBuffer = Buffer.from(base64Data, "base64");
          doc.image(imageBuffer, x, y + 5, { width: SIG_WIDTH, height: SIG_HEIGHT, fit: [SIG_WIDTH, SIG_HEIGHT] });
        } catch {
          doc.text("(firma)", x, textY, { width: colWidths.inSig - 10 });
        }
      } else {
        doc.text("-", x, textY, { width: colWidths.inSig - 10 });
      }
      x += colWidths.inSig;

      doc.text(formatDateTime(record.outTimestamp), x, textY, { width: colWidths.outTime - 10 });
      x += colWidths.outTime;

      if (record.outSignatureData && record.outSignatureData.startsWith("data:image")) {
        try {
          const base64Data = record.outSignatureData.split(",")[1];
          const imageBuffer = Buffer.from(base64Data, "base64");
          doc.image(imageBuffer, x, y + 5, { width: SIG_WIDTH, height: SIG_HEIGHT, fit: [SIG_WIDTH, SIG_HEIGHT] });
        } catch {
          doc.text("(firma)", x, textY, { width: colWidths.outSig - 10 });
        }
      } else {
        doc.text("-", x, textY, { width: colWidths.outSig - 10 });
      }
      x += colWidths.outSig;

      const inMapUrl = getMapUrl(record.inLatitude, record.inLongitude);
      if (inMapUrl) {
        doc
          .fillColor("#0066cc")
          .text("Ver en mapa", x, textY, {
            width: colWidths.inLoc - 10,
            link: inMapUrl,
            underline: true,
          });
        doc.fillColor("#000000");
      } else {
        doc.text("-", x, textY, { width: colWidths.inLoc - 10 });
      }
      x += colWidths.inLoc;

      const outMapUrl = getMapUrl(record.outLatitude, record.outLongitude);
      if (outMapUrl) {
        doc
          .fillColor("#0066cc")
          .text("Ver en mapa", x, textY, {
            width: colWidths.outLoc - 10,
            link: outMapUrl,
            underline: true,
          });
        doc.fillColor("#000000");
      } else {
        doc.text("-", x, textY, { width: colWidths.outLoc - 10 });
      }

      y += ROW_HEIGHT;
    }

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor("#666666")
        .text(
          `Página ${i + 1} de ${totalPages}`,
          doc.page.margins.left,
          doc.page.height - 30,
          { align: "center", width: pageWidth }
        );
    }

    doc.end();
  });
}
